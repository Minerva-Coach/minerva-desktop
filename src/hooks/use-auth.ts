import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AuthResult } from "../types/coaching";

export function useAuth() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load token from keychain on mount
  useEffect(() => {
    invoke<string | null>("get_auth_token")
      .then((t) => setToken(t ?? null))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  // Listen for auth-complete events (after browser OAuth)
  useEffect(() => {
    const unlisten = listen<AuthResult>("auth-complete", (event) => {
      if (event.payload.success) {
        // Re-fetch token from keychain
        invoke<string | null>("get_auth_token").then((t) =>
          setToken(t ?? null)
        );
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for auth-expired events (401 from presence heartbeat)
  useEffect(() => {
    const unlisten = listen("auth-expired", () => {
      setToken(null);
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
    setToken(null);
  }, []);

  return {
    token,
    isAuthenticated: token !== null,
    loading,
    login,
    logout,
  };
}
