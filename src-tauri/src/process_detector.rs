//! Zoom process and active meeting detection.
//!
//! Polls for Zoom process every 5 seconds. Distinguishes between Zoom running
//! idle (system tray) vs an active meeting by checking window titles on Linux.
//!
//! Emits Tauri events:
//! - `meeting-started` when an active Zoom meeting is detected
//! - `meeting-stopped` when the meeting ends (or Zoom closes)

#[cfg(target_os = "linux")]
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Get the DISPLAY env var, falling back to ":0" if not set.
/// xdotool and wmctrl require this to talk to the X server.
#[cfg(target_os = "linux")]
fn get_display() -> String {
    std::env::var("DISPLAY").unwrap_or_else(|_| ":1".to_string())
}

use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

/// Check interval for process detection.
const POLL_INTERVAL: Duration = Duration::from_secs(5);

/// Zoom process names by platform.
const ZOOM_PROCESS_NAMES: &[&str] = &[
    "zoom",       // Linux
    "zoom.us",    // macOS
    "Zoom.exe",   // Windows
    "ZoomWebviewHost", // Zoom sub-process (Linux)
];

/// Window titles (Linux only) that positively indicate an active Zoom meeting.
/// macOS uses the shared `is_meeting_title()` helper instead, matching Windows
/// rules so custom meeting topics ("Weekly Standup", lobby titles, etc.) work.
#[cfg(target_os = "linux")]
const MEETING_WINDOW_TITLES: &[&str] = &[
    "meeting",                       // Default meeting window title on Linux
    "zoom_linux_float_video_window", // Floating video thumbnail (active calls only)
    "cc_receiver",                   // Closed captions receiver (active calls only)
];

/// Window titles that Zoom shows when IDLE (no meeting). Any Zoom window title
/// NOT in this list and not empty is likely a meeting (custom topic name).
#[cfg(target_os = "linux")]
const IDLE_WINDOW_TITLES: &[&str] = &[
    "zoom workplace",
    "zoom workplace - licensed account",
    "zoom workplace - free account",
    "zoom",
    "recordings",
];

/// Additionally: if PipeWire/PulseAudio shows "ZOOM VoiceEngine" as an active
/// audio client, that's a strong signal of an active meeting (voice engine only
/// runs during calls).
// Reserved for the PipeWire-based meeting heuristic in `has_zoom_audio_client`
// below, which is not yet wired into the detection loop. Wire up or delete
// alongside that fn — see docs/planning/zoom-auto-join-url.md.
#[cfg(target_os = "linux")]
#[allow(dead_code)]
const AUDIO_MEETING_SIGNAL: &str = "zoom voiceengine";

/// Shared state for current meeting status.
pub struct MeetingState {
    pub in_meeting: AtomicBool,
    /// On Windows, the WMI subscription stashes URLs captured from the
    /// short-lived launcher `Zoom.exe` here. The detection loop consults
    /// the cache on each meeting-started transition so the tray-already-
    /// running case still produces a one-click join URL.
    #[cfg(target_os = "windows")]
    pub url_cache: crate::zoom_url_cache::ZoomUrlCache,
}

impl MeetingState {
    pub fn new() -> Self {
        Self {
            in_meeting: AtomicBool::new(false),
            #[cfg(target_os = "windows")]
            url_cache: crate::zoom_url_cache::ZoomUrlCache::new(),
        }
    }
}

/// Payload emitted with meeting-started event.
#[derive(Clone, serde::Serialize)]
pub struct MeetingStartedPayload {
    /// Zoom meeting URL (e.g., "https://zoom.us/j/1234567890"), if extractable.
    pub meeting_url: Option<String>,
}

/// Start the process detection loop in a background task.
pub fn start_detection_loop(app: AppHandle, state: Arc<MeetingState>) {
    tauri::async_runtime::spawn(async move {
        let mut sys = System::new();
        let mut was_in_meeting = false;

        loop {
            sys.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing(),
            );

            let zoom_running = sys.processes().values().any(|p| {
                let name = p.name().to_string_lossy().to_lowercase();
                ZOOM_PROCESS_NAMES
                    .iter()
                    .any(|z| name == z.to_lowercase())
            });

            let in_meeting = if zoom_running {
                is_in_active_meeting()
            } else {
                false
            };

            state.in_meeting.store(in_meeting, Ordering::Relaxed);

            // Emit events on state transitions. Window visibility is
            // managed by the frontend — no Rust show/hide calls, which
            // trigger a tao/GTK panic on Linux via glib channel dispatch.
            if in_meeting && !was_in_meeting {
                let meeting_url = extract_zoom_meeting_url(&state);
                // Don't log the URL — it identifies a specific meeting (P3-G).
                log::debug!("Active Zoom meeting detected (url present: {})", meeting_url.is_some());
                let _ = app.emit("meeting-started", MeetingStartedPayload { meeting_url });
            } else if !in_meeting && was_in_meeting {
                log::debug!("Zoom meeting ended");
                let _ = app.emit("meeting-stopped", ());
            }

            was_in_meeting = in_meeting;
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    });
}

/// Extract the value of a URL query parameter from a string. Stops at any
/// character that can't legally appear in a URL query value as it sits on
/// a process command line: `&` (next param), whitespace, NUL, or quotes.
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn extract_url_param(haystack: &str, name: &str) -> Option<String> {
    let needle = format!("{name}=");
    let pos = haystack.find(&needle)?;
    let after = &haystack[pos + needle.len()..];
    let value: String = after
        .chars()
        .take_while(|c| !matches!(c, '&' | ' ' | '\t' | '\n' | '\r' | '\0' | '"' | '\''))
        .collect();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

/// Build a Zoom join URL from a process command line.
///
/// Zoom's launch URL on the cmdline looks like
/// `zoommtg://zoom.us/join?action=join&confno=XXXXX&pwd=YYYY&uname=Z...`.
/// We extract `confno` and `pwd` and reconstruct
/// `https://zoom.us/j/{confno}?pwd={pwd}` — the same form Recall.ai expects.
/// When `pwd` is missing we fall back to the bare `https://zoom.us/j/{confno}`
/// and let the caller decide what to do (Phase 1 tries it once and falls back
/// to a paste-link popup on failure).
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) fn build_zoom_url_from_cmdline(cmdline: &str) -> Option<String> {
    let confno = extract_url_param(cmdline, "confno")?;
    if !confno.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let url = match extract_url_param(cmdline, "pwd") {
        Some(pwd) => format!("https://zoom.us/j/{confno}?pwd={pwd}"),
        None => format!("https://zoom.us/j/{confno}"),
    };
    log::debug!("Extracted Zoom meeting URL: {url}");
    Some(url)
}

/// Extract the Zoom meeting URL for the active meeting.
///
/// Zoom's desktop client receives its launch URL (`zoommtg://...`) on the
/// command line of the launcher process. Linux + macOS read that cmdline
/// from the active meeting process and feed it through
/// `build_zoom_url_from_cmdline()` to produce the Recall-compatible
/// `https://zoom.us/j/{confno}?pwd={pwd}` form.
///
/// **Windows is different**: a process's CommandLine is fixed at
/// CreateProcess time and never updates as Zoom is reused across meetings,
/// so live-process cmdline scans surface stale URLs forever once a launcher
/// Zoom.exe sticks around (observed: 3+ hours alive across multiple
/// meetings). Windows instead relies on a WMI subscription to
/// `__InstanceCreationEvent`, which captures the cmdline at the moment a
/// new `Zoom.exe` is created and caches it with a TTL; `take_fresh()`
/// consumes the entry so a single capture can only satisfy one meeting.
///
/// Returns `None` when no fresh URL is available (manual ID entry, in-app
/// upcoming-meetings join, instant meeting in a pre-running Zoom, or — on
/// macOS — when `ps` truncated the arg list before `pwd=`). The frontend
/// falls back to `/api/zoom/meetings/live` (Phase 4, host-only). See
/// `docs/planning/zoom-auto-join-url.md` for the broader rollout plan.
fn extract_zoom_meeting_url(state: &MeetingState) -> Option<String> {
    // Windows: WMI is the only local source of truth. A live-process
    // cmdline scan looks tempting (the launcher Zoom.exe carries the URL
    // on its argv), but a process's CommandLine is fixed at CreateProcess
    // time and never updates — so the same launcher Zoom.exe will keep
    // surfacing the *first* meeting's URL for the rest of its lifetime
    // (observed: PID alive for 3+ hours, instant-meeting started in-app,
    // cmdline still listing the original calendar-link's confno/pwd). The
    // WMI subscription side-steps this: it reads CommandLine at the
    // `__InstanceCreationEvent` moment and the cache's `take_fresh()`
    // consumes the entry on read, so stale data can't survive past one
    // `meeting-started` emission. When the cache is empty, the desktop
    // frontend falls back to `/api/zoom/meetings/live` (host-only) — see
    // PanelWindow.tsx.
    #[cfg(target_os = "windows")]
    if let Some(url) = state.url_cache.take_fresh() {
        log::debug!("Using Zoom URL captured by WMI subscription");
        return Some(url);
    }
    // Suppress unused-parameter warnings on the platforms that don't read
    // the cache. Cheap and keeps the call sites uniform.
    #[cfg(not(target_os = "windows"))]
    let _ = state;

    #[cfg(target_os = "linux")]
    {
        // Find zoom PID
        let output = Command::new("pgrep").arg("-x").arg("zoom").output().ok()?;
        let pids = String::from_utf8_lossy(&output.stdout);
        for pid in pids.lines() {
            let pid = pid.trim();
            if pid.is_empty() {
                continue;
            }
            // Read /proc/{pid}/cmdline (null-separated args)
            if let Ok(cmdline) = std::fs::read_to_string(format!("/proc/{pid}/cmdline")) {
                let cmdline = cmdline.replace('\0', " ");
                // NOTE: Linux support is being deprecated; pwd= parsing was
                // intentionally not extended here. The bare confno URL is
                // preserved for legacy installs only.
                if let Some(pos) = cmdline.find("confno=") {
                    let after = &cmdline[pos + 7..];
                    let confno: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
                    if !confno.is_empty() {
                        let url = format!("https://zoom.us/j/{confno}");
                        log::debug!("Extracted Zoom meeting URL: {url}");
                        return Some(url);
                    }
                }
            }
        }
        None
    }

    #[cfg(target_os = "macos")]
    {
        // Read the untruncated argv directly from the kernel for each Zoom
        // PID. `ps -eo args` truncates each arg list to ~512 chars; the
        // `pwd=` parameter on a real Zoom invite often falls past that
        // boundary, so the older codepath would surface a bare confno URL
        // and force the user into the paste-link fallback for any
        // password-protected meeting.
        let mut sys = System::new();
        sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing(),
        );
        let zoom_pids: Vec<i32> = sys
            .processes()
            .values()
            .filter(|p| {
                let n = p.name().to_string_lossy().to_lowercase();
                n == "zoom.us" || n == "zoom"
            })
            .map(|p| p.pid().as_u32() as i32)
            .collect();

        for pid in zoom_pids {
            let cmdline = match read_proc_args_macos(pid) {
                Some(s) => s,
                None => continue,
            };
            if cmdline.contains("confno=") {
                if let Some(url) = build_zoom_url_from_cmdline(&cmdline) {
                    return Some(url);
                }
            }
        }
        None
    }

    // Windows: no live-process cmdline scan — see the comment above the
    // `state.url_cache.take_fresh()` block for why. The early return on a
    // cache hit is the only successful Windows path here; everything else
    // falls back to `/api/zoom/meetings/live` in the frontend.
    #[cfg(target_os = "windows")]
    None
}

/// Check if Zoom has an active meeting window (not just idle in tray).
///
/// Linux: Uses wmctrl or xdotool to list window titles and checks if any
/// Zoom window has a title that isn't one of the known idle titles.
///
/// TODO(macOS): Use osascript or accessibility APIs
/// TODO(Windows): Use Windows API EnumWindows
fn is_in_active_meeting() -> bool {
    #[cfg(target_os = "linux")]
    {
        is_in_active_meeting_linux()
    }

    #[cfg(target_os = "macos")]
    {
        is_in_active_meeting_macos()
    }

    #[cfg(target_os = "windows")]
    {
        is_in_active_meeting_windows()
    }
}

/// Windows meeting detection: enumerate top-level windows owned by Zoom.exe
/// and look for titles that only appear during active meetings.
///
/// Positive indicators (case-insensitive):
/// - "zoom meeting"           → standard meeting window
/// - "annotation - zoom"      → screen-sharing annotation toolbar
/// - ends with "zoom meeting" → lobby/pre-join (e.g. "Alice's Zoom Meeting")
///
/// Ignored as idle: blank titles, "Zoom Workplace", "Zoom".
#[cfg(target_os = "windows")]
fn is_in_active_meeting_windows() -> bool {
    use std::collections::HashSet;
    use windows::Win32::Foundation::{BOOL, FALSE, HWND, LPARAM, TRUE};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
    };

    struct EnumState {
        zoom_pids: HashSet<u32>,
        found_meeting: bool,
    }

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        // SAFETY: lparam is a pointer to EnumState passed in from the caller.
        let state = &mut *(lparam.0 as *mut EnumState);

        if !IsWindowVisible(hwnd).as_bool() {
            return TRUE;
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));
        if !state.zoom_pids.contains(&pid) {
            return TRUE;
        }

        let mut buf = [0u16; 256];
        let len = GetWindowTextW(hwnd, &mut buf);
        if len <= 0 {
            return TRUE;
        }
        let title = String::from_utf16_lossy(&buf[..len as usize])
            .trim()
            .to_lowercase();

        if is_meeting_title(&title) {
            // Don't log titles — meeting topics often contain customer/internal
            // info (P3-G).
            log::debug!("Windows meeting detected via title");
            state.found_meeting = true;
            return FALSE; // stop enumeration
        }

        TRUE
    }

    // Collect Zoom.exe PIDs. The caller already confirmed Zoom is running,
    // but we need PIDs to filter windows by owner (avoids matching unrelated
    // apps whose windows happen to contain "meeting" in their title).
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing(),
    );
    let zoom_pids: HashSet<u32> = sys
        .processes()
        .values()
        .filter(|p| {
            p.name()
                .to_string_lossy()
                .eq_ignore_ascii_case("zoom.exe")
        })
        .map(|p| p.pid().as_u32())
        .collect();

    if zoom_pids.is_empty() {
        return false;
    }

    let mut state = EnumState {
        zoom_pids,
        found_meeting: false,
    };

    unsafe {
        // EnumWindows returns Err if the callback stops enumeration early —
        // that's our "found a meeting" case, not a real error.
        let _ = EnumWindows(Some(enum_proc), LPARAM(&mut state as *mut _ as isize));
    }

    state.found_meeting
}

/// Title-based heuristic for "this is an active Zoom meeting window."
/// Shared between Windows and macOS — both Zoom desktop clients use the same
/// title conventions. Linux uses a separate code path because xdotool / wmctrl
/// titles include extra decoration the Cocoa/Win32 APIs strip out.
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn is_meeting_title(title: &str) -> bool {
    // Exact matches for meeting-only windows
    if title == "zoom meeting" || title == "annotation - zoom" {
        return true;
    }
    // Lobby / pre-join: "<name>'s Zoom Meeting"
    if title.ends_with(" zoom meeting") {
        return true;
    }
    false
}

#[cfg(target_os = "linux")]
fn is_in_active_meeting_linux() -> bool {
    // Strategy: Use positive signals that a meeting is happening.
    // 1. Check for a window titled "Meeting" (or meeting topic) owned by Zoom
    // 2. Check if ZOOM VoiceEngine is registered as a PipeWire/PulseAudio client

    // Signal 1: Window titles via xdotool
    let xdotool_result = has_meeting_window_xdotool();
    log::debug!("Meeting detection: xdotool={}", xdotool_result);
    if xdotool_result {
        return true;
    }

    // Signal 2: Window titles via wmctrl (fallback)
    if let Ok(output) = Command::new("wmctrl").env("DISPLAY", get_display()).arg("-l").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let wmctrl_result = check_window_titles(&stdout);
            log::debug!("Meeting detection: wmctrl={}", wmctrl_result);
            if wmctrl_result {
                return true;
            }
        }
    }

    // Audio detection (ZOOM VoiceEngine in PipeWire) is NOT used as a
    // standalone signal — it stays registered even when Zoom is idle in the
    // system tray, causing false positives.  Window title is the definitive
    // indicator of an active meeting.
    log::debug!("Meeting detection: no meeting signals found");
    false
}

/// Check for meeting windows via xdotool (looks for positive meeting signals).
#[cfg(target_os = "linux")]
fn has_meeting_window_xdotool() -> bool {
    // Search all windows owned by the main zoom process
    let zoom_pids: Vec<String> = if let Ok(output) = Command::new("pgrep").arg("-x").arg("zoom").output() {
        let pids: Vec<String> = String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        log::debug!("xdotool: found {} zoom PIDs: {:?}", pids.len(), pids);
        pids
    } else {
        log::debug!("xdotool: pgrep failed");
        return false;
    };

    for pid in &zoom_pids {
        match Command::new("xdotool").env("DISPLAY", get_display())
            .args(["search", "--pid", pid])
            .output()
        {
            Ok(output) if output.status.success() => {
                let window_ids = String::from_utf8_lossy(&output.stdout);
                let wid_count = window_ids.lines().count();
                log::debug!("xdotool: PID {} has {} windows", pid, wid_count);
                for wid in window_ids.lines() {
                    let wid = wid.trim();
                    if wid.is_empty() { continue; }
                    match Command::new("xdotool").env("DISPLAY", get_display())
                        .args(["getwindowname", wid])
                        .output()
                    {
                        Ok(name_output) => {
                            let title = String::from_utf8_lossy(&name_output.stdout)
                                .trim()
                                .to_lowercase();
                            if title.is_empty() {
                                continue;
                            }
                            // Check 1: Known meeting-only window titles
                            if MEETING_WINDOW_TITLES.iter().any(|mt| title == *mt) {
                                // Don't log titles — meeting topics often contain
                                // customer/internal info (P3-G).
                                log::debug!("Meeting window found (known title) wid={wid}");
                                return true;
                            }
                            // Check 2: Any title that isn't a known idle title
                            // is likely a custom meeting topic (e.g. "Weekly Standup")
                            if !IDLE_WINDOW_TITLES.iter().any(|it| title == *it) {
                                log::debug!("Meeting window found (custom title) wid={wid}");
                                return true;
                            }
                        }
                        Err(e) => {
                            log::debug!("xdotool getwindowname {} failed: {}", wid, e);
                        }
                    }
                }
            }
            Ok(output) => {
                log::debug!("xdotool search --pid {} exited with {:?}", pid, output.status.code());
            }
            Err(e) => {
                log::debug!("xdotool search --pid {} failed: {}", pid, e);
            }
        }
    }

    false
}

/// Check if ZOOM VoiceEngine is registered as a PipeWire audio client.
/// This only exists when Zoom is actively in a meeting with audio.
/// Not yet wired into the detection loop — see notes on `AUDIO_MEETING_SIGNAL`.
#[cfg(target_os = "linux")]
#[allow(dead_code)]
fn has_zoom_audio_client() -> bool {
    // Try wpctl (PipeWire)
    if let Ok(output) = Command::new("wpctl").arg("status").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
            if stdout.contains(AUDIO_MEETING_SIGNAL) {
                return true;
            }
        }
    }

    // Fallback: pw-cli
    if let Ok(output) = Command::new("pw-cli").arg("list-objects").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
            if stdout.contains(AUDIO_MEETING_SIGNAL) {
                return true;
            }
        }
    }

    false
}

/// Parse wmctrl -l output and check for Zoom meeting windows (positive match).
#[cfg(target_os = "linux")]
fn check_window_titles(wmctrl_output: &str) -> bool {
    for line in wmctrl_output.lines() {
        // wmctrl -l format: "0x01234567  0 hostname Window Title"
        let parts: Vec<&str> = line.splitn(4, char::is_whitespace).collect();
        if parts.len() < 4 {
            continue;
        }
        let title = parts[3].trim().to_lowercase();
        // wmctrl lists ALL windows, not just Zoom — only check known meeting titles
        if MEETING_WINDOW_TITLES.iter().any(|mt| title == *mt) {
            log::debug!("Meeting window found via wmctrl: {}", parts[3].trim());
            return true;
        }
    }
    false
}

/// macOS meeting detection: enumerate on-screen windows owned by `zoom.us`
/// and look for titles that only appear during active meetings.
///
/// Uses `CGWindowListCopyWindowInfo` directly — the same API Granola, Loom,
/// Krisp, OBS, and Rewind use. Requires Screen Recording permission to read
/// `kCGWindowName`; without it, the field is omitted from the dictionary
/// and we silently return false (the React onboarding screen surfaces the
/// permission prompt — see `commands::macos_screen_recording_status`).
///
/// Replaces an earlier osascript-based stub that required the Accessibility
/// permission (~50ms per call, harder to explain to users) and only matched
/// the static `MEETING_WINDOW_TITLES` list — missing custom meeting topics
/// like "Weekly Standup" or lobby titles like "Alice's Zoom Meeting".
#[cfg(target_os = "macos")]
fn is_in_active_meeting_macos() -> bool {
    use core_foundation::array::CFArrayRef;
    use core_foundation::base::TCFType;
    use core_foundation::dictionary::CFDictionaryRef;
    use core_foundation::number::{CFNumber, CFNumberRef};
    use core_foundation::string::{CFString, CFStringRef};
    use core_graphics::window::{
        kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly, kCGWindowName,
        kCGWindowOwnerPID, CGWindowListCopyWindowInfo,
    };
    use std::collections::HashSet;
    use std::ffi::c_void;

    // CFDictionary / CFArray lookup helpers not exposed by core-foundation's
    // safe API at the granularity we need. Declared here to keep this file
    // self-contained; all calls live behind `unsafe`.
    extern "C" {
        fn CFArrayGetCount(arr: CFArrayRef) -> isize;
        fn CFArrayGetValueAtIndex(arr: CFArrayRef, idx: isize) -> *const c_void;
        fn CFDictionaryGetValueIfPresent(
            dict: CFDictionaryRef,
            key: *const c_void,
            value: *mut *const c_void,
        ) -> u8;
        fn CFRelease(cf: *const c_void);
        fn CFGetTypeID(cf: *const c_void) -> usize;
        fn CFNumberGetTypeID() -> usize;
        fn CFStringGetTypeID() -> usize;
    }

    // Collect zoom.us PIDs first. The window list spans every running app, so
    // we filter by owner PID rather than by title (which would let unrelated
    // apps with "meeting" in their title trigger false positives).
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing(),
    );
    let zoom_pids: HashSet<i64> = sys
        .processes()
        .values()
        .filter(|p| {
            let n = p.name().to_string_lossy().to_lowercase();
            n == "zoom.us" || n == "zoom"
        })
        .map(|p| p.pid().as_u32() as i64)
        .collect();
    if zoom_pids.is_empty() {
        return false;
    }

    let options = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
    // SAFETY: CGWindowListCopyWindowInfo is safe to call from any thread and
    // returns either NULL (when permission is denied / system is busy) or a
    // CFArrayRef we own (+1 refcount; released below).
    let arr_ref: CFArrayRef = unsafe { CGWindowListCopyWindowInfo(options, 0) };
    if arr_ref.is_null() {
        log::debug!(
            "CGWindowListCopyWindowInfo returned null — likely missing Screen Recording permission"
        );
        return false;
    }

    let mut found_meeting = false;
    let count = unsafe { CFArrayGetCount(arr_ref) };
    for i in 0..count {
        let dict_ptr = unsafe { CFArrayGetValueAtIndex(arr_ref, i) };
        if dict_ptr.is_null() {
            continue;
        }
        let dict_ref = dict_ptr as CFDictionaryRef;

        // --- Owner PID ---
        let mut value: *const c_void = std::ptr::null();
        let got = unsafe {
            CFDictionaryGetValueIfPresent(
                dict_ref,
                kCGWindowOwnerPID as *const c_void,
                &mut value,
            )
        };
        if got == 0 || value.is_null() {
            continue;
        }
        if unsafe { CFGetTypeID(value) } != unsafe { CFNumberGetTypeID() } {
            continue;
        }
        // SAFETY: type ID matched CFNumber; the pointer is owned by the
        // dictionary which we keep alive until end of scope via arr_ref.
        let pid = match unsafe { CFNumber::wrap_under_get_rule(value as CFNumberRef) }.to_i64() {
            Some(p) => p,
            None => continue,
        };
        if !zoom_pids.contains(&pid) {
            continue;
        }

        // --- Window name ---
        let mut value: *const c_void = std::ptr::null();
        let got = unsafe {
            CFDictionaryGetValueIfPresent(dict_ref, kCGWindowName as *const c_void, &mut value)
        };
        if got == 0 || value.is_null() {
            // kCGWindowName is omitted when the app lacks Screen Recording
            // permission. Skip silently — the user-facing prompt is owned
            // by the React onboarding screen.
            continue;
        }
        if unsafe { CFGetTypeID(value) } != unsafe { CFStringGetTypeID() } {
            continue;
        }
        let title = unsafe { CFString::wrap_under_get_rule(value as CFStringRef) }.to_string();
        let lower = title.trim().to_lowercase();
        if lower.is_empty() {
            continue;
        }

        if is_meeting_title(&lower) {
            // Don't log titles — meeting topics often contain customer/internal
            // info (P3-G).
            log::debug!("macOS meeting detected via title");
            found_meeting = true;
            break;
        }
    }

    // SAFETY: arr_ref came from CGWindowListCopyWindowInfo (+1 refcount).
    unsafe { CFRelease(arr_ref as *const c_void) };
    found_meeting
}

/// Read the untruncated argv of `pid` directly from the kernel via
/// `sysctl(CTL_KERN, KERN_PROCARGS2, …)`. Equivalent to `ps -p <pid> -o args`
/// but without the ~512-char truncation, which `ps` applies regardless of
/// terminal width.
///
/// Layout of the buffer per `man 1 ps` and the XNU source (`bsd/kern/kern_sysctl.c`):
///
/// ```text
///   [u32 argc][exec_path\0]([padding\0]*)[arg0\0][arg1\0]...[argN-1\0][env...]
/// ```
///
/// We skip the exec path and any padding NULs, then concatenate the argv
/// entries with single spaces to mimic `ps -o args` formatting — the rest of
/// the URL extraction (`build_zoom_url_from_cmdline`) is whitespace-tolerant.
#[cfg(target_os = "macos")]
fn read_proc_args_macos(pid: i32) -> Option<String> {
    use std::ffi::c_void;

    // sysctl MIB: { CTL_KERN, KERN_PROCARGS2, pid }
    const CTL_KERN: i32 = 1;
    const KERN_PROCARGS2: i32 = 49;

    // Query the system-wide max arg size first so we right-size the buffer.
    // Falls back to 256 KiB (the long-standing kernel default) if the sysctl
    // misbehaves.
    let mut argmax: i32 = 0;
    let mut size = std::mem::size_of::<i32>();
    let mut argmax_mib: [i32; 2] = [CTL_KERN, /* KERN_ARGMAX */ 8];
    let argmax_ok = unsafe {
        libc::sysctl(
            argmax_mib.as_mut_ptr(),
            2,
            &mut argmax as *mut _ as *mut c_void,
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    let argmax = if argmax_ok == 0 && argmax > 0 {
        argmax as usize
    } else {
        256 * 1024
    };

    let mut buf: Vec<u8> = vec![0; argmax];
    let mut size = buf.len();
    let mut mib: [i32; 3] = [CTL_KERN, KERN_PROCARGS2, pid];
    let rc = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            3,
            buf.as_mut_ptr() as *mut c_void,
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if rc != 0 {
        // EINVAL = process exited mid-call, EPERM = SIP-protected target,
        // ESRCH = no such process. All map to "no cmdline available."
        return None;
    }
    buf.truncate(size);
    if buf.len() < std::mem::size_of::<u32>() {
        return None;
    }

    let argc = u32::from_ne_bytes(buf[0..4].try_into().ok()?) as usize;
    let mut idx = 4usize;

    // Skip the exec path (NUL-terminated) and any zero-padding that follows.
    while idx < buf.len() && buf[idx] != 0 {
        idx += 1;
    }
    while idx < buf.len() && buf[idx] == 0 {
        idx += 1;
    }

    let mut parts: Vec<String> = Vec::with_capacity(argc);
    for _ in 0..argc {
        if idx >= buf.len() {
            break;
        }
        let start = idx;
        while idx < buf.len() && buf[idx] != 0 {
            idx += 1;
        }
        let slice = &buf[start..idx];
        // Lossy conversion — Zoom URLs are ASCII, but the env block that
        // follows argv may contain non-UTF8 bytes; we never reach it here,
        // but be defensive.
        parts.push(String::from_utf8_lossy(slice).into_owned());
        // Skip the trailing NUL.
        if idx < buf.len() {
            idx += 1;
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" "))
    }
}
