//! Minerva Coach Desktop App.
//!
//! A lightweight, always-on-top overlay that:
//! - Detects active Zoom meetings
//! - Heartbeats presence to the Minerva backend
//! - Displays transient coaching icons via SocketIO events
//!
//! TEMPORARY: The identity bridge features (presence heartbeat + meeting
//! detection) will be removed when Zoom Marketplace OAuth is approved.

mod auth;
mod commands;
mod presence;
mod process_detector;
mod socket_proxy;
#[cfg(not(target_os = "linux"))]
mod tray;

use std::sync::Arc;

use tauri::Manager;

use process_detector::MeetingState;
use socket_proxy::SocketState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let meeting_state = Arc::new(MeetingState::new());
    let socket_state = Arc::new(SocketState::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(meeting_state.clone())
        .manage(socket_state.clone())
        .invoke_handler(tauri::generate_handler![
            commands::start_login,
            commands::logout,
            commands::get_auth_token,
            commands::is_authenticated,
            commands::is_in_meeting,
            commands::get_api_url,
            commands::hide_windows,
            commands::show_windows,
            commands::api_request,
            commands::send_meeting_status,
            commands::get_app_version,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            log::info!("App started");

            // Start background services
            let state_clone = meeting_state.clone();
            process_detector::start_detection_loop(handle.clone(), state_clone);

            let state_clone = meeting_state.clone();
            presence::start_heartbeat_loop(handle.clone(), state_clone);

            // SocketIO proxy — connects from Rust to bypass webview TLS restrictions
            socket_proxy::start_socket_proxy(handle.clone(), socket_state.clone());

            // Enable launch-at-login by default in release builds. Skipped
            // in dev so we don't register the throwaway debug binary as a
            // login-launch item. Users can disable via OS settings (Task
            // Manager > Startup on Windows, Login Items on macOS).
            #[cfg(not(debug_assertions))]
            {
                use tauri_plugin_autostart::ManagerExt;
                let manager = app.autolaunch();
                match manager.is_enabled() {
                    Ok(false) => {
                        if let Err(e) = manager.enable() {
                            log::warn!("Failed to enable autostart: {e}");
                        } else {
                            log::info!("Autostart enabled");
                        }
                    }
                    Ok(true) => log::debug!("Autostart already enabled"),
                    Err(e) => log::warn!("Failed to query autostart status: {e}"),
                }
            }

            // System tray icon — Windows and macOS only. Linux's GTK tray
            // triggered tao panics in earlier testing.
            #[cfg(not(target_os = "linux"))]
            tray::setup(app)?;

            // Position windows on the right side of the primary monitor.
            // Panel: right edge, vertically centered.
            // Overlay: thin strip to the left of the panel for floating icons.
            if let Some(panel) = app.get_webview_window("panel") {
                if let Ok(Some(monitor)) = panel.primary_monitor() {
                    let ms = monitor.size();
                    let mp = monitor.position();

                    let panel_w = 280;
                    let panel_h = 420;
                    let panel_x = mp.x + ms.width as i32 - panel_w - 20;
                    let panel_y = mp.y + (ms.height as i32 - panel_h) / 2;
                    let _ = panel.set_position(tauri::PhysicalPosition {
                        x: panel_x,
                        y: panel_y,
                    });

                    if let Some(overlay) = app.get_webview_window("overlay") {
                        let overlay_w = 80;
                        let overlay_h = 600;
                        let overlay_x = panel_x - overlay_w - 10;
                        let overlay_y = mp.y + (ms.height as i32 - overlay_h) / 2;
                        let _ = overlay.set_position(tauri::PhysicalPosition {
                            x: overlay_x,
                            y: overlay_y,
                        });
                    }
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running minerva desktop app");
}
