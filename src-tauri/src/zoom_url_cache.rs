//! Catches the ephemeral launcher `Zoom.exe` process that the Windows shell
//! spawns when a browser hands off a `zoommtg://...` URL to the protocol
//! handler. That process holds the full join URL (including `pwd=`) on its
//! command line for only a few hundred milliseconds before IPCing it to the
//! tray-resident Zoom and exiting.
//!
//! The detector's 5-second poll in `process_detector.rs` is far too slow to
//! see the launcher alive, so when Zoom is already running in the tray (the
//! dominant real-world case — Zoom autostarts at login, users click links
//! throughout the day) the cmdline-scan path finds *no* `Zoom.exe` with
//! `confno=` and the panel falls back to the paste-link UX.
//!
//! Fix: subscribe to `__InstanceCreationEvent` on `Win32_Process` filtered to
//! `Name='Zoom.exe'`. WMI delivers the event within ~1s of process creation,
//! while the launcher is still alive, so we read its `CommandLine` field
//! before it exits and cache the parsed URL. `extract_zoom_meeting_url()`
//! consults this cache before the live-process cmdline scan.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::process_detector::build_zoom_url_from_cmdline;

/// How long a captured URL stays valid in the cache. The launcher fires a
/// few hundred ms before Zoom's meeting window appears, the detection loop
/// polls every 5s, and we want headroom for a slow first paint or a brief
/// stall. 60s is comfortably above all of those without keeping stale URLs
/// around across meetings.
const URL_CACHE_TTL: Duration = Duration::from_secs(60);

/// Time between subscription-loop retries when WMI returns an error
/// (service hiccup, COM teardown, etc.). The cmdline-scan path still works
/// in this window, so this is just a "try to restore the better path"
/// cadence — no need to hammer.
const RETRY_DELAY: Duration = Duration::from_secs(10);

/// Cheap-to-clone handle around the captured URL. Multiple clones share the
/// same underlying slot, so a write from the WMI thread is visible to the
/// detection loop without any extra plumbing.
#[derive(Clone, Default)]
pub struct ZoomUrlCache {
    inner: Arc<Mutex<Option<(String, Instant)>>>,
}

impl ZoomUrlCache {
    pub fn new() -> Self {
        Self::default()
    }

    fn set(&self, url: String) {
        if let Ok(mut guard) = self.inner.lock() {
            *guard = Some((url, Instant::now()));
        }
    }

    /// Pop the cached URL if it was captured inside the TTL. Returning
    /// `Some` clears the slot so the next meeting doesn't accidentally
    /// reuse a stale URL — the detection loop calls this exactly once per
    /// false→true meeting transition.
    pub fn take_fresh(&self) -> Option<String> {
        let mut guard = self.inner.lock().ok()?;
        let (url, when) = guard.as_ref()?;
        if when.elapsed() < URL_CACHE_TTL {
            let url = url.clone();
            *guard = None;
            return Some(url);
        }
        *guard = None;
        None
    }
}

/// WMI event payload. The struct mirrors the shape of an
/// `__InstanceCreationEvent` wrapping a `Win32_Process`. Field names match
/// the WMI dictionary keys exactly, via `rename_all = "PascalCase"`.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
struct ZoomProcess {
    command_line: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
struct ProcessCreatedEvent {
    target_instance: ZoomProcess,
}

/// Spin up the WMI subscription on a dedicated OS thread. COM has thread
/// affinity, so the subscription must own its apartment for its entire
/// lifetime — `std::thread::spawn` gives us that, where the Tauri async
/// runtime would migrate the future between worker threads and break it.
///
/// Best-effort: if WMI is unavailable (service disabled, COM init fails,
/// etc.) we log and back off, leaving the existing cmdline-scan path as
/// the only URL source. The cache simply stays empty in that scenario.
pub fn start(cache: ZoomUrlCache) {
    std::thread::Builder::new()
        .name("zoom-wmi-capture".to_string())
        .spawn(move || loop {
            match subscribe_loop(&cache) {
                Ok(()) => {
                    // Stream ended cleanly (the WMI iterator exhausted —
                    // shouldn't happen in normal operation, but treat it as
                    // a transient failure and retry).
                    log::debug!("Zoom WMI subscription stream ended; retrying");
                }
                Err(e) => {
                    log::warn!("Zoom WMI subscription error: {e}");
                }
            }
            std::thread::sleep(RETRY_DELAY);
        })
        .expect("failed to spawn zoom-wmi-capture thread");
}

fn subscribe_loop(cache: &ZoomUrlCache) -> Result<(), String> {
    use wmi::{COMLibrary, WMIConnection};

    let com = COMLibrary::new().map_err(|e| format!("COM init: {e}"))?;
    let wmi = WMIConnection::new(com).map_err(|e| format!("WMI connect: {e}"))?;

    // WITHIN 1 = WMI checks for new processes every 1s. That's the lowest
    // reliable interval; tighter values risk missing the (already very
    // short) window where the launcher Zoom.exe is alive. Filtering on
    // `TargetInstance.Name = 'Zoom.exe'` happens server-side in WMI so
    // we don't get woken for every process creation on the box.
    let query = "SELECT * FROM __InstanceCreationEvent WITHIN 1 \
                 WHERE TargetInstance ISA 'Win32_Process' \
                 AND TargetInstance.Name = 'Zoom.exe'";

    let iter = wmi
        .raw_notification::<ProcessCreatedEvent>(query)
        .map_err(|e| format!("WMI query: {e}"))?;

    log::debug!("Zoom WMI subscription active");

    for result in iter {
        match result {
            Ok(evt) => {
                let cmd = match evt.target_instance.command_line {
                    Some(c) => c,
                    None => continue,
                };
                if !cmd.contains("confno=") {
                    // Non-meeting Zoom launches (autostart at login, IPC
                    // helpers, etc.) appear here too — just ignore them.
                    continue;
                }
                if let Some(url) = build_zoom_url_from_cmdline(&cmd) {
                    // Don't log the URL — meeting identifiers leak into
                    // shared logs otherwise (matches P3-G policy).
                    log::debug!(
                        "Zoom WMI captured a join URL from a launcher Zoom.exe"
                    );
                    cache.set(url);
                }
            }
            Err(e) => {
                // Most likely an isolated deserialize failure — the WMI
                // iterator keeps going. Log and continue.
                log::warn!("Zoom WMI event decode error: {e}");
            }
        }
    }

    Ok(())
}
