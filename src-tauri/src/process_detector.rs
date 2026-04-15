//! Zoom process and active meeting detection.
//!
//! Polls for Zoom process every 5 seconds. Distinguishes between Zoom running
//! idle (system tray) vs an active meeting by checking window titles on Linux.
//!
//! Emits Tauri events:
//! - `meeting-started` when an active Zoom meeting is detected
//! - `meeting-stopped` when the meeting ends (or Zoom closes)

use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Get the DISPLAY env var, falling back to ":0" if not set.
/// xdotool and wmctrl require this to talk to the X server.
fn get_display() -> String {
    std::env::var("DISPLAY").unwrap_or_else(|_| ":1".to_string())
}

use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, Manager};

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
const MEETING_WINDOW_TITLES: &[&str] = &[
    "meeting",                       // Default meeting window title on Linux
    "zoom_linux_float_video_window", // Floating video thumbnail (active calls only)
    "cc_receiver",                   // Closed captions receiver (active calls only)
];

/// Window titles that Zoom shows when IDLE (no meeting). Any Zoom window title
/// NOT in this list and not empty is likely a meeting (custom topic name).
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
                log::info!("Active Zoom meeting detected");
                let _ = app.emit("meeting-started", ());
            } else if !in_meeting && was_in_meeting {
                log::info!("Zoom meeting ended");
                let _ = app.emit("meeting-stopped", ());
            }

            was_in_meeting = in_meeting;
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    });
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
        // TODO: Implement Windows meeting detection
        // For now, assume any running Zoom means a meeting
        true
    }
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
