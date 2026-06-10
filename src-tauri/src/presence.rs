//! Presence heartbeat service.
//!
//! TEMPORARY: Desktop identity bridge — remove when Zoom Marketplace OAuth is approved.
//!
//! When an active Zoom meeting is detected, POSTs to the backend presence
//! endpoint every 60 seconds. When the meeting ends, sends a DELETE to clear.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::auth;
use crate::error_chain;
use crate::http_client::SHARED as HTTP_CLIENT;
use crate::process_detector::MeetingState;

/// How often to heartbeat during an active meeting.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(60);

/// How often to check state when not in a meeting.
const IDLE_CHECK_INTERVAL: Duration = Duration::from_secs(5);

/// Start the presence heartbeat loop.
///
/// Watches the shared MeetingState and heartbeats only when in_meeting is true.
/// Sends a single DELETE when the meeting ends.
pub fn start_heartbeat_loop(app: AppHandle, state: Arc<MeetingState>) {
    tauri::async_runtime::spawn(async move {
        let mut was_in_meeting = false;
        let mut heartbeat_counter: u64 = 0;

        loop {
            let in_meeting = state.in_meeting.load(Ordering::Relaxed);

            if in_meeting {
                // Only heartbeat every HEARTBEAT_INTERVAL worth of IDLE_CHECK_INTERVAL ticks
                let should_heartbeat = !was_in_meeting
                    || heartbeat_counter
                        .is_multiple_of(HEARTBEAT_INTERVAL.as_secs() / IDLE_CHECK_INTERVAL.as_secs());

                if should_heartbeat {
                    if let Some(token) = auth::get_token() {
                        let api_url = auth::get_api_url();
                        let url = format!("{api_url}/api/v1/desktop/presence");

                        // Heartbeat carries the installed client version so
                        // the backend can detect installs that have stopped
                        // auto-updating (P2-G).
                        let body = format!(
                            r#"{{"app_version":"{}"}}"#,
                            env!("CARGO_PKG_VERSION")
                        );

                        match HTTP_CLIENT
                            .post(&url)
                            .header("Authorization", format!("Bearer {token}"))
                            .header("Content-Type", "application/json")
                            .body(body)
                            .send()
                            .await
                        {
                            Ok(resp) if resp.status().is_success() => {
                                log::debug!("Presence heartbeat sent");
                                // Clear any stale presence-error banner the
                                // panel may be showing from a previous failure.
                                let _ = app.emit("presence-ok", ());
                            }
                            Ok(resp) if resp.status().as_u16() == 401 => {
                                log::warn!("Presence heartbeat: auth expired (401)");
                                let _ = app.emit("auth-expired", ());
                            }
                            Ok(resp) => {
                                let status = resp.status();
                                log::warn!(
                                    "Presence heartbeat failed: HTTP {status}"
                                );
                                // Surface to the React panel so the user sees
                                // why coaching may not start in this meeting.
                                // 401 already routes through `auth-expired` above.
                                let _ = app.emit(
                                    "presence-error",
                                    format!("HTTP {status} from /api/v1/desktop/presence"),
                                );
                            }
                            Err(e) => {
                                let chain = error_chain::format_chain(&e);
                                log::warn!("Presence heartbeat error: {chain}");
                                let _ = app.emit("presence-error", chain);
                            }
                        }
                    }
                }

                heartbeat_counter += 1;
            } else if was_in_meeting {
                // Meeting just ended — clear presence
                heartbeat_counter = 0;
                if let Some(token) = auth::get_token() {
                    let api_url = auth::get_api_url();
                    let url = format!("{api_url}/api/v1/desktop/presence");

                    match HTTP_CLIENT
                        .delete(&url)
                        .header("Authorization", format!("Bearer {token}"))
                        .send()
                        .await
                    {
                        Ok(_) => log::info!("Presence cleared (meeting ended)"),
                        Err(e) => log::warn!("Failed to clear presence: {e}"),
                    }
                }
            }

            was_in_meeting = in_meeting;
            tokio::time::sleep(IDLE_CHECK_INTERVAL).await;
        }
    });
}

