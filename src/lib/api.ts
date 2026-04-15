import { invoke } from "@tauri-apps/api/core";

interface ApiResponse {
  status: number;
  body: string;
}

/**
 * Make an authenticated API request to the Minerva backend.
 *
 * Routes through Rust's reqwest client (via Tauri IPC) instead of browser
 * fetch. This allows accepting self-signed TLS certs in dev mode — the
 * webview's fetch() rejects them.
 */
export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const method = (options.method || "GET").toUpperCase();
  const body = options.body ? String(options.body) : null;

  const result = await invoke<ApiResponse>("api_request", {
    method,
    path,
    body,
  });

  // Wrap in a Response-like object so callers can use .ok, .status, .json()
  return new Response(result.body, {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
}
