//! Tauri IPC commands exposed to the React frontend.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, Manager, State};

use crate::auth;
use crate::process_detector::MeetingState;

/// Start the browser-based OAuth login flow.
#[tauri::command]
pub async fn start_login(app: AppHandle) -> Result<(), String> {
    auth::start_auth_flow(app);
    Ok(())
}

/// Log out: delete the stored auth token.
#[tauri::command]
pub async fn logout() -> Result<(), String> {
    auth::delete_token()
}

/// Get the stored auth token (if any).
#[tauri::command]
pub fn get_auth_token() -> Option<String> {
    auth::get_token()
}

/// Check if there is a stored auth token.
#[tauri::command]
pub fn is_authenticated() -> bool {
    auth::get_token().is_some()
}

/// Check if an active Zoom meeting is detected.
#[tauri::command]
pub fn is_in_meeting(state: State<'_, Arc<MeetingState>>) -> bool {
    state.in_meeting.load(Ordering::Relaxed)
}

/// Get the backend API URL (for frontend SocketIO connection).
#[tauri::command]
pub fn get_api_url() -> String {
    auth::get_api_url()
}

/// Hide the panel and overlay windows.
#[tauri::command]
pub async fn hide_windows(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("panel") {
        w.hide().map_err(|e| e.to_string())?;
    }
    if let Some(w) = app.get_webview_window("overlay") {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Show the panel and overlay windows.
#[tauri::command]
pub async fn show_windows(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("panel") {
        w.show().map_err(|e| e.to_string())?;
    }
    if let Some(w) = app.get_webview_window("overlay") {
        w.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}
