//! Tauri IPC commands exposed to the React frontend.

use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use std::sync::LazyLock;

use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::auth;
use crate::process_detector::MeetingState;
use crate::socket_proxy::SocketState;

/// Filesystem location of the marker file that records whether the user has
/// dismissed the post-onboarding welcome screen. Stored in the app's
/// per-user data dir so it survives updates but is per-installation.
fn welcome_marker_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("welcome_acknowledged"))
}

/// Non-command helper used by `lib.rs` setup to decide whether to auto-show
/// the panel at startup.
pub fn welcome_acknowledged(app: &AppHandle) -> bool {
    welcome_marker_path(app)
        .map(|p| p.exists())
        .unwrap_or(false)
}

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

/// Open (or focus, if already open) the Icon Key window. This is a small
/// standalone window the user can leave visible while they learn what
/// each coaching icon means. Created on-demand rather than pre-declared
/// in tauri.conf.json so it doesn't consume resources for users who
/// never open it.
#[tauri::command]
pub async fn open_icon_key(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("icon-key") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "icon-key", WebviewUrl::App("index.html".into()))
        .title("Minerva Icon Key")
        .inner_size(380.0, 520.0)
        .min_inner_size(300.0, 320.0)
        .resizable(true)
        .always_on_top(false)
        .skip_taskbar(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
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

/// Show the panel and overlay windows, re-asserting their always-on-top
/// status. Windows occasionally demotes TOPMOST windows when another app
/// (Zoom) transitions into full-screen meeting mode, which can leave the
/// panel minimized to the taskbar. We call `unminimize` + `show` +
/// `set_always_on_top(true)` to recover from that state. No-op if the
/// window is already visible and on-top.
#[tauri::command]
pub async fn show_windows(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("panel") {
        let _ = w.unminimize();
        w.show().map_err(|e| e.to_string())?;
        let _ = w.set_always_on_top(true);
    }
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.unminimize();
        w.show().map_err(|e| e.to_string())?;
        let _ = w.set_always_on_top(true);
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

/// Whether the user has dismissed the post-onboarding welcome screen.
/// Frontend uses this to decide whether to render the welcome step.
#[tauri::command]
pub fn is_welcome_acknowledged(app: AppHandle) -> bool {
    welcome_acknowledged(&app)
}

/// Persist the user's acknowledgement of the welcome screen by creating an
/// empty marker file. Idempotent — safe to call repeatedly.
#[tauri::command]
pub fn acknowledge_welcome(app: AppHandle) -> Result<(), String> {
    let path = welcome_marker_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, b"").map_err(|e| e.to_string())
}

// --- macOS Screen Recording permission --------------------------------------
//
// Reading other apps' window titles on macOS requires the Screen Recording
// permission (TCC). We expose three thin Tauri commands so the React layer
// can:
//   1. detect the current state without prompting,
//   2. fire the system-level dialog the first time,
//   3. deep-link to System Settings if the user dismissed the dialog.
//
// Apps cannot grant themselves TCC — the user has to physically toggle the
// switch and (in the typical case) relaunch the app for the new permission
// to take effect. The frontend onboarding screen guides them through that.
//
// Non-macOS builds expose stubs so the frontend can call uniformly.

#[cfg(target_os = "macos")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// Returns "granted" or "denied" without prompting the user.
/// Cheap — checks the TCC database in-process.
#[tauri::command]
pub fn macos_screen_recording_status() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: CGPreflightScreenCaptureAccess is a leaf C function with
        // no preconditions; safe on any thread.
        if unsafe { CGPreflightScreenCaptureAccess() } {
            "granted"
        } else {
            "denied"
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        "granted"
    }
}

/// Triggers the system Screen Recording prompt. The OS only shows the dialog
/// the very first time per binary identity; subsequent calls are a no-op
/// from the user's perspective. Frontend should call
/// `macos_open_screen_recording_settings` as a fallback if the dialog
/// doesn't appear.
#[tauri::command]
pub fn macos_request_screen_recording() {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: see preflight above. Ignored return (we re-check via
        // the preflight call after the dialog closes).
        let _ = unsafe { CGRequestScreenCaptureAccess() };
    }
}

/// Open System Settings → Privacy & Security → Screen Recording.
/// Used when the user dismissed the system dialog or for re-grants on
/// macOS 15 Sequoia's weekly re-prompt cadence.
#[tauri::command]
pub fn macos_open_screen_recording_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
