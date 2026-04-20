//! SocketIO proxy — connects to the backend from Rust and forwards events
//! to the frontend via Tauri events.
//!
//! This avoids the webview TLS issue (webkit2gtk rejects self-signed certs).
//! The Rust reqwest client handles TLS with `danger_accept_invalid_certs` in
//! debug builds.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rust_socketio::{
    asynchronous::{Client, ClientBuilder},
    Payload, TransportType,
};
use tauri::{AppHandle, Emitter};

use crate::auth;

/// Shared state for the socket proxy.
///
/// `client` holds the connected socket when active, `None` otherwise.
/// Tauri commands read this to emit events without owning the proxy loop.
pub struct SocketState {
    pub connected: AtomicBool,
    pub client: tokio::sync::Mutex<Option<Client>>,
}

impl SocketState {
    pub fn new() -> Self {
        Self {
            connected: AtomicBool::new(false),
            client: tokio::sync::Mutex::new(None),
        }
    }
}

/// Start the SocketIO proxy loop.
pub fn start_socket_proxy(app: AppHandle, state: Arc<SocketState>) {
    tauri::async_runtime::spawn(async move {
        loop {
            // Wait for auth token
            let token = loop {
                if let Some(t) = auth::get_token() {
                    break t;
                }
                tokio::time::sleep(Duration::from_secs(5)).await;
            };

            let api_url = auth::get_api_url();
            log::info!("Socket proxy: connecting to {api_url}");

            let app_connect = app.clone();
            let state_connect = state.clone();
            let app_coaching = app.clone();
            let app_companion = app.clone();

            let mut builder = ClientBuilder::new(&api_url)
                .transport_type(TransportType::Polling)
                .opening_header("Authorization", format!("Bearer {token}"));

            // Accept self-signed certs in debug builds (local dev)
            if cfg!(debug_assertions) {
                if let Ok(tls) = native_tls::TlsConnector::builder()
                    .danger_accept_invalid_certs(true)
                    .build()
                {
                    builder = builder.tls_config(tls);
                }
            }

            let result = builder
                .on("connected", move |payload: Payload, _client: Client| {
                    let app = app_connect.clone();
                    let st = state_connect.clone();
                    Box::pin(async move {
                        st.connected.store(true, Ordering::Relaxed);
                        if let Payload::Text(values) = payload {
                            if let Some(data) = values.first() {
                                let _ = app.emit("socket-connected", data.clone());
                                log::info!("Socket proxy: connected, data={data}");
                            }
                        }
                    })
                })
                .on("coaching_message", move |payload: Payload, _client: Client| {
                    let app = app_coaching.clone();
                    Box::pin(async move {
                        if let Payload::Text(values) = payload {
                            if let Some(data) = values.first() {
                                let _ = app.emit("socket-coaching-message", data.clone());
                                log::debug!("Socket proxy: coaching_message forwarded");
                            }
                        }
                    })
                })
                .on("companion_data_update", move |payload: Payload, _client: Client| {
                    let app = app_companion.clone();
                    Box::pin(async move {
                        if let Payload::Text(values) = payload {
                            if let Some(data) = values.first() {
                                let _ = app.emit("socket-companion-data", data.clone());
                                log::debug!("Socket proxy: companion_data_update forwarded");
                            }
                        }
                    })
                })
                .on("error", |err, _| {
                    Box::pin(async move {
                        log::warn!("Socket proxy error: {err:?}");
                    })
                })
                .connect()
                .await;

            match result {
                Ok(client) => {
                    log::info!("Socket proxy: connected successfully");
                    state.connected.store(true, Ordering::Relaxed);
                    *state.client.lock().await = Some(client.clone());
                    let _ = app.emit("socket-status", "connected");

                    // Periodically emit refresh_meetings to join rooms
                    loop {
                        tokio::time::sleep(Duration::from_secs(10)).await;

                        // Check if token changed (logout/re-login)
                        let current_token = auth::get_token();
                        if current_token.as_deref() != Some(&token) {
                            log::info!("Socket proxy: token changed, reconnecting");
                            let _ = client.disconnect().await;
                            break;
                        }

                        // Emit refresh_meetings to join any new rooms
                        if let Err(e) = client
                            .emit("refresh_meetings", serde_json::json!({}))
                            .await
                        {
                            log::warn!("Socket proxy: refresh_meetings failed: {e}");
                            let _ = client.disconnect().await;
                            break;
                        }
                    }
                }
                Err(e) => {
                    log::warn!("Socket proxy: connection failed: {e}");
                }
            }

            state.connected.store(false, Ordering::Relaxed);
            *state.client.lock().await = None;
            let _ = app.emit("socket-status", "disconnected");

            // Wait before reconnecting
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}
