//! Tauri IPC commands exposed to the React frontend.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use std::sync::LazyLock;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::auth;
use crate::process_detector::MeetingState;
use crate::socket_proxy::SocketState;

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

/// Get the app's compile-time version (from Cargo.toml).
/// Used by the About modal to display the currently-running version.
#[tauri::command]
pub fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Show or hide the coaching overlay window independently of meeting state.
///
/// Used by the About modal's "Show coaching overlay" toggle. Visibility
/// preference is persisted on the frontend (localStorage); this command is
/// just the imperative to apply it.
#[tauri::command]
pub async fn set_overlay_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("overlay") {
        if visible {
            w.show().map_err(|e| e.to_string())?;
        } else {
            w.hide().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Enter overlay reposition mode. Makes sure the overlay window is visible
/// (so it can receive cursor events once click-through is toggled off on
/// the frontend side) and fires the `overlay-reposition-enter` event that
/// the overlay listens for.
#[tauri::command]
pub async fn start_overlay_reposition(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("overlay") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
    }
    app.emit("overlay-reposition-enter", ())
        .map_err(|e| e.to_string())
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

/// Emit a "meeting_status" event on the shared SocketIO connection.
///
/// Mirrors the companion app's `How's it going?` feature — the user reports
/// their subjective read on the meeting, backend logs it against the
/// meeting_id for the product-metrics pipeline.
///
/// Expected status values: "going_well" | "neutral" | "struggling"
/// (backend accepts any string; these three are what the UI emits).
#[tauri::command]
pub async fn send_meeting_status(
    status: String,
    meeting_id: i64,
    state: State<'_, Arc<SocketState>>,
) -> Result<(), String> {
    let client = state
        .client
        .lock()
        .await
        .clone()
        .ok_or_else(|| "Socket not connected".to_string())?;

    client
        .emit(
            "meeting_status",
            serde_json::json!({ "status": status, "meeting_id": meeting_id }),
        )
        .await
        .map_err(|e| format!("Failed to emit meeting_status: {e}"))
}
