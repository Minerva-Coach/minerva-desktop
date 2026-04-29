//! Zoom process and active meeting detection.
//!
//! Polls for Zoom process every 5 seconds. Distinguishes between Zoom running
//! idle (system tray) vs an active meeting by checking window titles on Linux.
//!
//! Emits Tauri events:
//! - `meeting-started` when an active Zoom meeting is detected
//! - `meeting-stopped` when the meeting ends (or Zoom closes)

#[cfg(any(target_os = "linux", target_os = "macos"))]
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

/// Window titles that positively indicate an active Zoom meeting.
/// These only exist during active calls, not when Zoom is idle in the tray.
#[cfg(any(target_os = "linux", target_os = "macos"))]
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
#[cfg(target_os = "linux")]
const AUDIO_MEETING_SIGNAL: &str = "zoom voiceengine";

/// Shared state for current meeting status.
pub struct MeetingState {
    pub in_meeting: AtomicBool,
}

impl MeetingState {
    pub fn new() -> Self {
        Self {
            in_meeting: AtomicBool::new(false),
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
                let meeting_url = extract_zoom_meeting_url();
                log::info!("Active Zoom meeting detected (url={meeting_url:?})");
                let _ = app.emit("meeting-started", MeetingStartedPayload { meeting_url });
            } else if !in_meeting && was_in_meeting {
                log::info!("Zoom meeting ended");
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
fn build_zoom_url_from_cmdline(cmdline: &str) -> Option<String> {
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

/// Extract the Zoom meeting URL from the process command line.
///
/// Zoom's desktop client receives its launch URL (`zoommtg://...`) on the
/// command line of the active meeting process. We read that line per-platform
/// and feed it through `build_zoom_url_from_cmdline()` to produce the
/// Recall-compatible `https://zoom.us/j/{confno}?pwd={pwd}` form.
///
/// Returns `None` when no Zoom process is in a meeting, or when the cmdline
/// is missing the expected params (manual ID entry, in-app upcoming-meetings
/// join, or — on macOS — when `ps` truncated the arg list before `pwd=`).
/// See `docs/planning/zoom-auto-join-url.md` for the broader rollout plan
/// (Phase 2 backfills the missing-`pwd` case via Zoom OAuth for hosts).
fn extract_zoom_meeting_url() -> Option<String> {
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
        // macOS: use `ps -eo args` to get command lines for all processes.
        //
        // TODO(macOS truncation): `ps` truncates each arg list to ~512 chars.
        // The `pwd=` param on a real Zoom invite often falls past that
        // boundary, in which case we'll see `confno` but no `pwd` and the
        // caller will fall through to the paste-link popup. Proper fix:
        // call `sysctlbyname("kern.procargs2", ...)` (or the equivalent
        // CTL_KERN/KERN_PROCARGS2 mib) for each Zoom PID to read the
        // untruncated argv directly from the kernel. Stubbed here for now;
        // will be addressed once we have a Mac dev box. See planning doc
        // open question 2 in docs/planning/zoom-auto-join-url.md.
        let output = Command::new("ps").args(["-eo", "args"]).output().ok()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.contains("zoom.us") && line.contains("confno=") {
                if let Some(url) = build_zoom_url_from_cmdline(line) {
                    return Some(url);
                }
            }
        }
        None
    }

    #[cfg(target_os = "windows")]
    {
        // TODO(Phase 1.2): Read Zoom.exe's cmdline via PowerShell CIM and
        // feed it through build_zoom_url_from_cmdline().
        None
    }
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
            log::info!("Windows meeting detected via title: '{}'", title);
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

#[cfg(target_os = "windows")]
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
                                log::info!("Meeting window found (known title): '{}' (wid={})", title, wid);
                                return true;
                            }
                            // Check 2: Any title that isn't a known idle title
                            // is likely a custom meeting topic (e.g. "Weekly Standup")
                            if !IDLE_WINDOW_TITLES.iter().any(|it| title == *it) {
                                log::info!("Meeting window found (custom title): '{}' (wid={})", title, wid);
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
#[cfg(target_os = "linux")]
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

#[cfg(target_os = "macos")]
fn is_in_active_meeting_macos() -> bool {
    // Use osascript to get Zoom window titles
    let script = r#"
        tell application "System Events"
            if exists (process "zoom.us") then
                tell process "zoom.us"
                    set windowNames to name of every window
                end tell
                return windowNames as text
            end if
        end tell
        return ""
    "#;

    if let Ok(output) = Command::new("osascript").arg("-e").arg(script).output() {
        if output.status.success() {
            let titles = String::from_utf8_lossy(&output.stdout).to_lowercase();
            for title in titles.split(',') {
                let t = title.trim().to_lowercase();
                if MEETING_WINDOW_TITLES.iter().any(|mt| t == *mt) {
                    return true;
                }
            }
        }
    }

    false
}
