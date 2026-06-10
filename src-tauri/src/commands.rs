//! Tauri IPC commands exposed to the React frontend.

use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::auth;
use crate::error_chain;
use crate::http_client::SHARED as HTTP_CLIENT;
use crate::process_detector::MeetingState;

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

/// Start the browser-based OAuth login flow.
#[tauri::command]
pub async fn start_login(app: AppHandle) -> Result<(), String> {
    auth::start_auth_flow(app);
    Ok(())
}

/// Log out:
/// 1. POST /api/v1/desktop/logout so the server-side jti is revoked (the
///    bearer token can't be reused even if a copy was exfiltrated).
/// 2. Delete the stored auth token from the OS keychain.
///
/// Step 1 is best-effort — if the network is down or the server returns
/// an error, we still proceed to clear the local keychain so the user
/// isn't stuck signed in. The token will then expire naturally within
/// 90 days even without server-side revocation.
#[tauri::command]
pub async fn logout() -> Result<(), String> {
    if let Some(token) = auth::get_token() {
        let api_url = auth::get_api_url();
        let url = format!("{api_url}/api/v1/desktop/logout");
        let result = HTTP_CLIENT
            .post(&url)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await;
        match result {
            Ok(resp) if resp.status().is_success() => {
                log::debug!("Server-side desktop session revoked");
            }
            Ok(resp) => {
                log::warn!(
                    "Server-side logout returned non-success ({}); clearing keychain anyway",
                    resp.status()
                );
            }
            Err(e) => {
                log::warn!(
                    "Server-side logout failed ({e}); clearing keychain anyway"
                );
            }
        }
    }
    auth::delete_token()
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

/// Hand the stored bearer token to the panel WebView for socket.io auth.
///
/// `useAuth` deliberately doesn't expose the token (api_request reads it
/// from the keychain in-process), but the JS-side socket.io-client needs
/// it in the handshake `auth` payload. Tradeoff accepted: the token sits
/// in JS memory only while the panel is alive, our CSP forbids inline /
/// remote scripts, and the WebView never renders user-controlled HTML.
/// If this stops feeling acceptable, swap to a short-lived server-issued
/// socket ticket (POST /api/v1/desktop/socket-ticket → ~5min token).
#[tauri::command]
pub fn get_auth_token() -> Option<String> {
    auth::get_token()
}

/// Get the app's compile-time version (from Cargo.toml).
/// Used by the About modal to display the currently-running version.
#[tauri::command]
pub fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Diagnostic context shown in the Connection Issue modal so non-technical
/// users can copy a single block of text and paste it into a support email.
#[derive(Clone, serde::Serialize)]
pub struct DiagnosticContext {
    pub app_version: &'static str,
    pub os: &'static str,
    pub arch: &'static str,
    pub os_version: String,
    pub api_url: String,
    pub has_token: bool,
}

/// Return platform + auth context for the Connection Issue modal.
///
/// `os_version` is best-effort: on macOS we shell `sw_vers -productVersion`,
/// on Windows we use the `windows::Win32` `GetVersionExW` would require a
/// dependency we already have but with extra work — for now we just report
/// `std::env::consts::OS` as a coarse fallback. Recent error chains arrive
/// via `socket-error` / `auth-complete` Tauri events; the modal pairs them
/// with this context.
#[tauri::command]
pub fn get_diagnostic_context() -> DiagnosticContext {
    DiagnosticContext {
        app_version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        os_version: detect_os_version(),
        api_url: auth::get_api_url(),
        has_token: auth::get_token().is_some(),
    }
}

/// Best-effort OS version string. Empty on failure — the modal renders the
/// other fields regardless.
fn detect_os_version() -> String {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    String::from_utf8(o.stdout).ok()
                } else {
                    None
                }
            })
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "ver"])
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    String::from_utf8(o.stdout).ok()
                } else {
                    None
                }
            })
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        String::new()
    }
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

/// Screen-space cursor position in physical pixels.
///
/// Used by the overlay to decide whether the cursor is over its drag-handle
/// header. Tauri only supports per-*window* click-through, so the overlay
/// polls this and toggles `setIgnoreCursorEvents` on header entry/exit —
/// preserving HUD-style click-through everywhere except the header strip.
#[tauri::command]
pub fn get_cursor_position(app: AppHandle) -> Result<(f64, f64), String> {
    let pos = app.cursor_position().map_err(|e| e.to_string())?;
    Ok((pos.x, pos.y))
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

/// Open (or focus) the Focus Goals companion window. Created on-demand
/// because gating means most users won't open it for their first few
/// sessions. Follows the same on-demand pattern as `open_icon_key`.
#[tauri::command]
pub async fn open_focus_goals(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("focus-goals") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "focus-goals", WebviewUrl::App("index.html".into()))
        .title("Focus Goals")
        .inner_size(380.0, 520.0)
        .min_inner_size(300.0, 320.0)
        .resizable(true)
        .always_on_top(false)
        .skip_taskbar(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Open (or focus) the Agenda companion window.
#[tauri::command]
pub async fn open_agenda(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("agenda") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "agenda", WebviewUrl::App("index.html".into()))
        .title("Agenda")
        .inner_size(420.0, 560.0)
        .min_inner_size(320.0, 360.0)
        .resizable(true)
        .always_on_top(false)
        .skip_taskbar(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Open (or focus) the Coaching Advice companion window.
#[tauri::command]
pub async fn open_coaching(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("coaching") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "coaching", WebviewUrl::App("index.html".into()))
        .title("Coaching Advice")
        .inner_size(380.0, 480.0)
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
///
/// `path` MUST be a server-relative path beginning with `/`. The path is
/// joined onto the API base URL via `Url::join`, which would otherwise
/// happily accept absolute URLs or `//other.host/x` and silently send
/// the bearer token to a different origin. After joining, the result's
/// host MUST equal the API base host — closes the credential-exfiltration
/// vector documented in P1-F (e.g. `path = "@evil.com/x"` would otherwise
/// produce `https://minervacoach.com@evil.com/x`).
#[tauri::command]
pub async fn api_request(
    method: String,
    path: String,
    body: Option<String>,
) -> Result<ApiResponse, String> {
    let api_url = auth::get_api_url();
    let url = build_api_url(&api_url, &path)?;

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

    let resp = req.send().await.map_err(|e| {
        // Preserve the source chain — reqwest's Display alone collapses
        // TLS / DNS / connection-refused all to "error sending request".
        format!("Request failed: {}", error_chain::format_chain(&e))
    })?;
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();

    Ok(ApiResponse { status, body })
}

#[derive(Clone, serde::Serialize)]
pub struct ApiResponse {
    pub status: u16,
    pub body: String,
}

/// Resolve a caller-supplied path against the API base URL, refusing any
/// input that would change the destination host.
///
/// Rejects:
///   - paths that don't start with `/` (e.g. `"@evil.com/x"`)
///   - paths containing `\` or `://`
///   - any successful join whose host differs from the base host
fn build_api_url(api_url: &str, path: &str) -> Result<String, String> {
    if !path.starts_with('/') {
        return Err("path must start with '/'".to_string());
    }
    if path.contains('\\') || path.contains("://") {
        return Err("path contains disallowed characters".to_string());
    }

    let base = reqwest::Url::parse(api_url)
        .map_err(|e| format!("invalid API base URL: {e}"))?;
    let joined = base
        .join(path)
        .map_err(|e| format!("could not join path: {e}"))?;

    if joined.host_str() != base.host_str() {
        return Err("path resolves to a different host".to_string());
    }
    if joined.scheme() != base.scheme() {
        return Err("path resolves to a different scheme".to_string());
    }
    if joined.port_or_known_default() != base.port_or_known_default() {
        return Err("path resolves to a different port".to_string());
    }

    Ok(joined.into())
}

#[cfg(test)]
mod tests {
    use super::build_api_url;

    #[test]
    fn build_api_url_accepts_normal_paths() {
        let u = build_api_url("https://minervacoach.com", "/api/whoami").unwrap();
        assert_eq!(u, "https://minervacoach.com/api/whoami");
    }

    #[test]
    fn build_api_url_rejects_at_sign_host_smuggle() {
        // Url::join("https://minervacoach.com", "@evil.com/x") happens to
        // resolve back into the base host, but the leading-`/` check fails
        // first. Guard belt-and-braces with both checks.
        assert!(build_api_url("https://minervacoach.com", "@evil.com/x").is_err());
    }

    #[test]
    fn build_api_url_rejects_protocol_relative() {
        assert!(build_api_url("https://minervacoach.com", "//evil.com/x").is_err());
    }

    #[test]
    fn build_api_url_rejects_absolute_url() {
        assert!(build_api_url("https://minervacoach.com", "https://evil.com/x").is_err());
    }

    #[test]
    fn build_api_url_rejects_backslash() {
        assert!(build_api_url("https://minervacoach.com", "/api\\..\\x").is_err());
    }

    #[test]
    fn build_api_url_normalizes_dotdot_within_host() {
        // ".." segments still resolve under the same host — that's fine, the
        // server can 404 if it doesn't recognize the path.
        let u = build_api_url("https://minervacoach.com", "/a/b/../c").unwrap();
        assert!(u.starts_with("https://minervacoach.com"));
    }
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

// --- Icon Key auto-open counter (#248) --------------------------------------
//
// New users won't recognize the floating coaching icons. Auto-open the Icon
// Key window for the first three meetings, then stop. Persisted as a small
// integer file in the per-user app data dir, same shape as the welcome
// marker. Per-installation by design — reinstall resets the counter.

const ICON_KEY_AUTO_OPEN_LIMIT: u32 = 3;

fn icon_key_count_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("icon_key_shown_count"))
}

fn read_icon_key_show_count(app: &AppHandle) -> u32 {
    icon_key_count_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(0)
}

/// Whether the icon key should auto-open at the next meeting start. True
/// while the user has seen it fewer than ICON_KEY_AUTO_OPEN_LIMIT times.
#[tauri::command]
pub fn should_auto_show_icon_key(app: AppHandle) -> bool {
    read_icon_key_show_count(&app) < ICON_KEY_AUTO_OPEN_LIMIT
}

/// Increment the persisted auto-open counter. Called from the frontend when
/// it auto-opens the icon key on a meeting start, so subsequent meetings
/// stop auto-opening once the limit is reached.
#[tauri::command]
pub fn record_icon_key_shown(app: AppHandle) -> Result<(), String> {
    let path = icon_key_count_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let next = read_icon_key_show_count(&app).saturating_add(1);
    std::fs::write(&path, next.to_string().as_bytes()).map_err(|e| e.to_string())
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

/// Update the system tray's title text (macOS) and tooltip (Windows).
///
/// `title` is rendered as text next to the tray icon on macOS — this is what
/// gives the "behavior counts at a glance" feel without opening the panel.
/// On Windows the same text is set as the tooltip (hover-only) since the
/// taskbar tray doesn't render text labels. On Linux the call is a best-
/// effort no-op (tray plugin not compiled there anyway).
///
/// Pass an empty string to clear back to the plain icon/default tooltip
/// between meetings.
#[tauri::command]
pub fn update_tray_title(app: AppHandle, title: String) -> Result<(), String> {
    let tray = app
        .tray_by_id("main")
        .ok_or_else(|| "tray icon not initialized".to_string())?;
    let value = if title.is_empty() { None } else { Some(title.as_str()) };
    tray.set_title(value).map_err(|e| e.to_string())?;
    let tooltip = if title.is_empty() { Some("Minerva Coach") } else { Some(title.as_str()) };
    tray.set_tooltip(tooltip).map_err(|e| e.to_string())?;
    Ok(())
}

/// Apply a font-size zoom factor to every webview window.
///
/// Tauri v2's `WebviewWindow::set_zoom` uniformly scales the entire webview —
/// text, padding, icons — which is the only sensible way to scale this app's
/// UI given it uses 100+ absolute `text-[Npx]` Tailwind declarations that a
/// CSS-variable approach can't reach. Applied to all windows in one call so
/// the panel, overlay, and icon-key stay visually in sync.
///
/// Factor is clamped to [0.5, 2.0]; the JS hook only sends values in the
/// 0.88..1.18 range today.
#[tauri::command]
pub fn set_font_scale(app: AppHandle, factor: f64) -> Result<(), String> {
    let factor = factor.clamp(0.5, 2.0);
    for (_label, window) in app.webview_windows() {
        window.set_zoom(factor).map_err(|e| e.to_string())?;
    }
    Ok(())
}
