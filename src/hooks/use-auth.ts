import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AuthResult } from "../types/coaching";

/**
 * Tracks whether a bearer token exists in the OS keychain. Intentionally
 * does NOT expose the token itself — `api_request` (Rust) reads it from
 * the keychain on every call and attaches the Authorization header in the
 * Rust process, so the webview never needs the bearer string.
 */
export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load presence-of-token from keychain on mount.
  useEffect(() => {
    invoke<boolean>("is_authenticated")
      .then((b) => setIsAuthenticated(Boolean(b)))
      .catch(() => setIsAuthenticated(false))
      .finally(() => setLoading(false));
  }, []);

  // Listen for auth-complete events (after browser OAuth).
  useEffect(() => {
    const unlisten = listen<AuthResult>("auth-complete", (event) => {
      if (event.payload.success) {
        invoke<boolean>("is_authenticated").then((b) =>
          setIsAuthenticated(Boolean(b))
        );
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for auth-expired events (401 from presence heartbeat).
  useEffect(() => {
    const unlisten = listen("auth-expired", () => {
      setIsAuthenticated(false);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const login = useCallback(async () => {
    await invoke("start_login");
  }, []);

  const logout = useCallback(async () => {
    await invoke("logout");
    setIsAuthenticated(false);
  }, []);

  return {
    isAuthenticated,
    loading,
    login,
    logout,
  };
}
