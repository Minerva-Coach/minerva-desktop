import { invoke } from "@tauri-apps/api/core";

/**
 * Make an authenticated API request to the Minerva backend.
 * Automatically adds the Bearer token from keychain.
 */
export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const [apiUrl, token] = await Promise.all([
    invoke<string>("get_api_url"),
    invoke<string | null>("get_auth_token"),
  ]);

  const headers = new Headers(options.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  headers.set("Content-Type", "application/json");

  return fetch(`${apiUrl}${path}`, {
    ...options,
    headers,
  });
}
