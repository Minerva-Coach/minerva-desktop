//! Authentication flow for the desktop app.
//!
//! Opens the system browser for LinkedIn OAuth via the Minerva web app.
//! Captures the redirect on a temporary localhost server and stores the
//! signed auth token in the OS keychain.
//!
//! As of v0.1.9 the flow uses PKCE plus a server-issued nonce:
//!   1. POST /api/v1/desktop/auth-prepare → server returns a one-time `nonce`.
//!   2. Browser opens /login?desktop_callback=…&desktop_nonce=…&state=…
//!      &code_challenge=…&code_challenge_method=S256
//!   3. After OAuth, server redirects callback URL with `code` + `state`
//!      (NOT the bearer token).
//!   4. Loopback callback handler verifies method=GET, path=/callback,
//!      remote=loopback, and `state` matches.
//!   5. POST /api/v1/desktop/auth-exchange {code, code_verifier} → bearer token.
//!
//! TEMPORARY: Desktop identity bridge — remove when Zoom Marketplace OAuth is approved.

use std::net::IpAddr;
use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use keyring::Entry;
use rand::RngCore;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tiny_http::Method;

use crate::error_chain;
use crate::http_client::SHARED as HTTP_CLIENT;

const KEYRING_SERVICE: &str = "com.minervacoach.desktop";
const KEYRING_KEY: &str = "auth_token";

/// Production backend URL.
const PROD_API_URL: &str = "https://minervacoach.com";

/// Local dev backend URL.
const DEV_API_URL: &str = "https://127.0.0.1:8000";

/// Get the backend API URL.
///
/// In debug builds, the MINERVA_API_URL env var can override the default
/// dev server URL. Release builds ignore the env var so an attacker with
/// env-write foothold can't redirect prod traffic (P2-A).
pub fn get_api_url() -> String {
    if cfg!(debug_assertions) {
        if let Ok(url) = std::env::var("MINERVA_API_URL") {
            return url;
        }
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

fn random_b64(byte_count: usize) -> String {
    let mut buf = vec![0u8; byte_count];
    rand::rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(&buf)
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

/// Ask the backend for a one-time nonce that authorizes a single login
/// attempt. Returns the nonce on success, an error string with full
/// reqwest source chain on failure — caller surfaces that into the
/// `auth-complete` event so the ConnectionIssueModal can show the real
/// reason (TLS / DNS / connection refused).
async fn fetch_auth_nonce(api_url: &str) -> Result<String, String> {
    let url = format!("{api_url}/api/v1/desktop/auth-prepare");
    let resp = HTTP_CLIENT
        .post(&url)
        .send()
        .await
        .map_err(|e| {
            format!("auth-prepare request failed: {}", error_chain::format_chain(&e))
        })?;
    if !resp.status().is_success() {
        return Err(format!(
            "auth-prepare returned HTTP {}",
            resp.status()
        ));
    }
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("auth-prepare invalid JSON: {}", error_chain::format_chain(&e)))?;
    body.get("nonce")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "auth-prepare response missing nonce".to_string())
}

/// Trade `{code, code_verifier}` for a bearer token. Returns the token on
/// success, an error string otherwise.
async fn exchange_code(
    api_url: &str,
    code: &str,
    verifier: &str,
) -> Result<String, String> {
    let url = format!("{api_url}/api/v1/desktop/auth-exchange");
    let resp = HTTP_CLIENT
        .post(&url)
        .json(&serde_json::json!({
            "code": code,
            "code_verifier": verifier,
        }))
        .send()
        .await
        .map_err(|e| {
            format!("auth-exchange request failed: {}", error_chain::format_chain(&e))
        })?;
    if !resp.status().is_success() {
        let status = resp.status();
        return Err(format!("auth-exchange returned {status}"));
    }
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| {
            format!("auth-exchange invalid JSON: {}", error_chain::format_chain(&e))
        })?;
    body.get("token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "auth-exchange response missing token".to_string())
}

/// Start the OAuth flow:
/// 1. Fetch a one-time nonce from the backend.
/// 2. Generate per-launch `state` + PKCE verifier/challenge.
/// 3. Bind a temporary localhost HTTP server on a random port.
/// 4. Open the system browser to /login with desktop_callback + nonce + state + challenge.
/// 5. Wait for the callback (GET /callback only, from a loopback peer, with matching state).
/// 6. POST /api/v1/desktop/auth-exchange to trade the code for a bearer token.
/// 7. Store the token and emit auth-complete event.
pub fn start_auth_flow(app: AppHandle) {
    let app_clone = Arc::new(app);

    std::thread::spawn(move || {
        let api_url = get_api_url();

        // Fetch the one-time nonce from the backend before doing anything
        // that's user-visible. Without it, /login will refuse the new flow
        // and we can't proceed to PKCE.
        let runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                log::error!("Failed to build tokio runtime: {e}");
                let _ = app_clone.emit("auth-complete", AuthResult::error("Internal error"));
                return;
            }
        };

        let nonce = match runtime.block_on(fetch_auth_nonce(&api_url)) {
            Ok(n) => n,
            Err(e) => {
                log::error!("Failed to fetch auth nonce from backend: {e}");
                let _ = app_clone.emit("auth-complete", AuthResult::error(&e));
                return;
            }
        };

        let state = random_b64(32);
        let verifier = random_b64(32);
        let challenge = pkce_challenge(&verifier);

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
        let login_url = format!(
            "{api_url}/login?desktop_callback={cb}&desktop_nonce={nonce}\
             &state={state}&code_challenge={challenge}&code_challenge_method=S256",
            cb = urlencoding_minimal(&callback_url),
            nonce = urlencoding_minimal(&nonce),
            state = urlencoding_minimal(&state),
            challenge = urlencoding_minimal(&challenge),
        );

        log::debug!("Opening browser for auth (port {port})");

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
                    // Reject anything that isn't a loopback GET /callback?…
                    // Methods other than GET, paths other than /callback, or
                    // peers from non-loopback addresses are answered with a
                    // generic 404 and the loop keeps waiting for the real
                    // callback. Any local process trying to race the redirect
                    // would still need to know `state`, which it doesn't.
                    if !is_acceptable_callback(&request) {
                        let _ = request.respond(
                            tiny_http::Response::from_string("Not found")
                                .with_status_code(404),
                        );
                        continue;
                    }

                    let url = request.url().to_string();
                    let parsed = match parse_callback_query(&url) {
                        Some(p) => p,
                        None => {
                            let _ = request.respond(
                                tiny_http::Response::from_string("Bad request")
                                    .with_status_code(400),
                            );
                            continue;
                        }
                    };

                    if parsed.state != state {
                        log::warn!("Auth callback rejected: state mismatch");
                        let _ = request.respond(
                            tiny_http::Response::from_string("Invalid state")
                                .with_status_code(400),
                        );
                        continue;
                    }

                    let token = match runtime
                        .block_on(exchange_code(&api_url, &parsed.code, &verifier))
                    {
                        Ok(t) => t,
                        Err(e) => {
                            log::error!("Auth code exchange failed: {e}");
                            let _ = request.respond(
                                tiny_http::Response::from_string(
                                    "Authorization failed — please try again.",
                                )
                                .with_status_code(400),
                            );
                            let _ = app_clone
                                .emit("auth-complete", AuthResult::error("Auth exchange failed"));
                            return;
                        }
                    };

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

                            let _ = app_clone.emit("auth-complete", AuthResult::success());
                            return;
                        }
                        Err(e) => {
                            log::error!("Failed to store token: {e}");
                            let _ = app_clone.emit("auth-complete", AuthResult::error(&e));
                            return;
                        }
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

struct CallbackParams {
    code: String,
    state: String,
}

/// Parse `?code=…&state=…` out of a tiny_http request URL like
/// `/callback?code=abc&state=xyz`. Returns None if either param is missing.
fn parse_callback_query(url_path: &str) -> Option<CallbackParams> {
    let full_url = format!("http://localhost{url_path}");
    let parsed = url::Url::parse(&full_url).ok()?;
    let mut code = None;
    let mut state = None;
    for (k, v) in parsed.query_pairs() {
        match k.as_ref() {
            "code" => code = Some(v.into_owned()),
            "state" => state = Some(v.into_owned()),
            _ => {}
        }
    }
    Some(CallbackParams {
        code: code?,
        state: state?,
    })
}

/// Method must be GET, path must start with /callback, peer must be loopback.
fn is_acceptable_callback(request: &tiny_http::Request) -> bool {
    if request.method() != &Method::Get {
        return false;
    }
    if !request.url().starts_with("/callback") {
        return false;
    }
    match request.remote_addr() {
        Some(addr) => match addr.ip() {
            IpAddr::V4(v4) => v4.is_loopback(),
            IpAddr::V6(v6) => v6.is_loopback(),
        },
        // tiny_http typically populates remote_addr; treat absence as suspicious.
        None => false,
    }
}

/// Minimal URL-encoding for query-string values we control. The values are
/// URL-safe-base64 (no padding) plus an http://127.0.0.1:N/callback string,
/// none of which contain characters that strictly require encoding — but
/// percent-encode the loopback callback URL anyway so a future change to
/// the encoding scheme can't accidentally break /login parsing.
fn urlencoding_minimal(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
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
