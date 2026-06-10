//! Process-wide shared `reqwest::Client`.
//!
//! Every reqwest::Client owns its own connection pool, rustls session cache,
//! and HTTP/2 stream state. The previous arrangement built three separate
//! clients (one in `commands::HTTP_CLIENT`, one per call in `auth::http_client`,
//! one inside the `presence` heartbeat task), so three independent TLS state
//! machines were talking to `minervacoach.com` at the same time during a
//! meeting. Consolidating to a single LazyLock means one pool, one set of
//! lifecycle transitions, and far less surface for rustls/h2 races.
//!
//! Config is identical to what each call site was building independently:
//! - `danger_accept_invalid_certs(cfg!(debug_assertions))` so local dev
//!   against `https://127.0.0.1:8000` (self-signed) just works while release
//!   builds keep full validation.
//! - `redirect::Policy::none()` so an auth-expired 302 to `/login` surfaces
//!   as a 302 rather than an unexpected HTML body.

use std::sync::LazyLock;

/// Shared client used by all HTTP call sites in the desktop app.
pub static SHARED: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(cfg!(debug_assertions))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("reqwest client build failed")
});
