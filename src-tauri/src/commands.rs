//! Tauri IPC commands exposed to the React frontend.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use std::sync::LazyLock;

use tauri::{AppHandle, Manager, State};

use crate::auth;
use crate::process_detector::MeetingState;

/// Shared reqwest client — accepts self-signed certs in debug builds.
/// Redirect following is disabled so we can detect auth failures (302 → /login).
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(cfg!(debug_assertions))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});

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

/// Proxy an API request through Rust's reqwest client.
/// This bypasses the webview's TLS restrictions (self-signed certs in dev).
#[tauri::command]
pub async fn api_request(
    method: String,
    path: String,
    body: Option<String>,
) -> Result<ApiResponse, String> {
    let api_url = auth::get_api_url();
    let url = format!("{api_url}{path}");

    let mut req = match method.to_uppercase().as_str() {
        "GET" => HTTP_CLIENT.get(&url),
        "POST" => HTTP_CLIENT.post(&url),
        "PUT" => HTTP_CLIENT.put(&url),
        "DELETE" => HTTP_CLIENT.delete(&url),
        "PATCH" => HTTP_CLIENT.patch(&url),
        other => return Err(format!("Unsupported method: {other}")),
    };

    // Add auth token if available
    if let Some(token) = auth::get_token() {
        req = req.header("Authorization", format!("Bearer {token}"));
    }
    req = req.header("Content-Type", "application/json");

    if let Some(body) = body {
        req = req.body(body);
    }

    let resp = req.send().await.map_err(|e| format!("Request failed: {e}"))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();

    Ok(ApiResponse { status, body })
}

#[derive(Clone, serde::Serialize)]
pub struct ApiResponse {
    pub status: u16,
    pub body: String,
}
