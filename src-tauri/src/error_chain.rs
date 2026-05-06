//! Walk an `std::error::Error` and its `source()` chain into one string.
//!
//! `Display` for common network error types (reqwest, rustls, hyper, etc.)
//! collapses the actual cause to a generic top-level message — "error
//! sending request for url", "I/O error", "transport error". The real
//! reason (TLS handshake failure, certificate untrusted, DNS refused,
//! connection reset) lives in the `source()` chain. The
//! ConnectionIssueModal pastes whatever string we emit straight into the
//! user's diagnostic blob, so we have to walk the chain or support gets a
//! useless one-liner.

/// Render `err` and its full `source()` chain joined by ` -> `.
pub fn format_chain(err: &dyn std::error::Error) -> String {
    let mut parts = vec![err.to_string()];
    let mut src = err.source();
    while let Some(s) = src {
        parts.push(s.to_string());
        src = s.source();
    }
    parts.join(" -> ")
}
