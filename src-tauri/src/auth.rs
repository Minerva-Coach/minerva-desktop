//! Authentication flow for the desktop app.
//!
//! Opens the system browser for LinkedIn OAuth via the Minerva web app.
//! Captures the redirect on a temporary localhost server and stores the
//! signed auth token in the OS keychain.
//!
//! TEMPORARY: Desktop identity bridge — remove when Zoom Marketplace OAuth is approved.

use std::sync::Arc;

use keyring::Entry;
use tauri::{AppHandle, Emitter};

const KEYRING_SERVICE: &str = "com.minervacoach.desktop";
const KEYRING_KEY: &str = "auth_token";

/// Production backend URL.
const PROD_API_URL: &str = "https://minervacoach.com";

/// Local dev backend URL.
const DEV_API_URL: &str = "https://127.0.0.1:8000";

/// Get the backend API URL.
///
/// Priority: MINERVA_API_URL env var > debug/release default.
/// Debug builds default to local dev server; release builds default to production.
pub fn get_api_url() -> String {
    if let Ok(url) = std::env::var("MINERVA_API_URL") {
        return url;
    }

    if cfg!(debug_assertions) {
        DEV_API_URL.to_string()
    } else {
        PROD_API_URL.to_string()
    }
}

/// Get stored auth token from OS keychain.
pub fn get_token() -> Option<String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_KEY).ok()?;
    entry.get_password().ok()
}

/// Store auth token in OS keychain.
fn store_token(token: &str) -> Result<(), String> {
    let entry =
        Entry::new(KEYRING_SERVICE, KEYRING_KEY).map_err(|e| format!("Keyring error: {e}"))?;
    entry
        .set_password(token)
        .map_err(|e| format!("Failed to store token: {e}"))
}

/// Delete auth token from OS keychain.
pub fn delete_token() -> Result<(), String> {
    let entry =
        Entry::new(KEYRING_SERVICE, KEYRING_KEY).map_err(|e| format!("Keyring error: {e}"))?;
    // Ignore "not found" errors on delete
    let _ = entry.delete_credential();
    Ok(())
}

/// Start the OAuth flow:
/// 1. Bind a temporary localhost HTTP server on a random port
/// 2. Open the system browser to the Minerva login page with desktop_callback
/// 3. Wait for the redirect with the signed token
/// 4. Store the token and emit auth-complete event
pub fn start_auth_flow(app: AppHandle) {
    let app_clone = Arc::new(app);

    std::thread::spawn(move || {
        // Bind to a random available port on localhost
        let server = match tiny_http::Server::http("127.0.0.1:0") {
            Ok(s) => s,
            Err(e) => {
                log::error!("Failed to start auth callback server: {e}");
                let _ = app_clone.emit("auth-complete", AuthResult::error(&e.to_string()));
                return;
            }
        };

        let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
        if port == 0 {
            log::error!("Failed to get server port");
            let _ = app_clone.emit(
                "auth-complete",
                AuthResult::error("Failed to bind callback server"),
            );
            return;
        }

        let callback_url = format!("http://127.0.0.1:{port}/callback");
        let api_url = get_api_url();
        let login_url = format!("{api_url}/login?desktop_callback={callback_url}");

        log::info!("Opening browser for auth: {login_url}");

        // Open system browser
        if let Err(e) = open::that(&login_url) {
            log::error!("Failed to open browser: {e}");
            let _ = app_clone.emit(
                "auth-complete",
                AuthResult::error("Failed to open browser"),
            );
            return;
        }

        // Wait for the callback (timeout after 5 minutes)
        // tiny_http doesn't have built-in timeout, so we use a thread with a deadline
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);

        loop {
            if std::time::Instant::now() > deadline {
                log::warn!("Auth callback timeout (5 minutes)");
                let _ = app_clone.emit("auth-complete", AuthResult::error("Login timed out"));
                return;
            }

            // Non-blocking receive with short timeout
            match server.recv_timeout(std::time::Duration::from_secs(1)) {
                Ok(Some(request)) => {
                    let url = request.url().to_string();

                    // Parse the token from query params
                    if let Some(token) = extract_token_from_url(&url) {
                        // Store in keychain
                        match store_token(&token) {
                            Ok(()) => {
                                log::info!("Auth token stored successfully");

                                // Respond with a success page
                                let response = tiny_http::Response::from_string(SUCCESS_HTML)
                                    .with_header(
                                        "Content-Type: text/html"
                                            .parse::<tiny_http::Header>()
                                            .unwrap(),
                                    );
                                let _ = request.respond(response);

                                let _ =
                                    app_clone.emit("auth-complete", AuthResult::success());
                                return;
                            }
                            Err(e) => {
                                log::error!("Failed to store token: {e}");
                                let _ = app_clone
                                    .emit("auth-complete", AuthResult::error(&e));
                                return;
                            }
                        }
                    } else {
                        // Not the callback we're expecting — respond and keep waiting
                        let response = tiny_http::Response::from_string("Waiting for auth...");
                        let _ = request.respond(response);
                    }
                }
                Ok(None) => {
                    // Timeout — loop and check deadline
                    continue;
                }
                Err(e) => {
                    log::error!("Auth server error: {e}");
                    let _ = app_clone.emit(
                        "auth-complete",
                        AuthResult::error("Auth server error"),
                    );
                    return;
                }
            }
        }
    });
}

/// Extract token from callback URL like "/callback?token=abc123"
fn extract_token_from_url(url_path: &str) -> Option<String> {
    let full_url = format!("http://localhost{url_path}");
    let parsed = url::Url::parse(&full_url).ok()?;
    parsed
        .query_pairs()
        .find(|(key, _)| key == "token")
        .map(|(_, value)| value.into_owned())
}

#[derive(Clone, serde::Serialize)]
struct AuthResult {
    success: bool,
    error: Option<String>,
}

impl AuthResult {
    fn success() -> Self {
        Self {
            success: true,
            error: None,
        }
    }

    fn error(msg: &str) -> Self {
        Self {
            success: false,
            error: Some(msg.to_string()),
        }
    }
}

const SUCCESS_HTML: &str = r#"<!DOCTYPE html>
<html>
<head><title>Minerva Coach</title></head>
<body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8f9fa;">
  <div style="text-align: center;">
    <h2>Signed in successfully</h2>
    <p>You can close this tab and return to the Minerva desktop app.</p>
  </div>
</body>
</html>"#;
