import { useCallback, useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { apiFetch } from "../lib/api";

interface PlatformIdentity {
  id: number;
  display_label: string;
  date_added: string | null;
}

interface PlatformStatus {
  connected: boolean;
  identities: PlatformIdentity[];
  connect_url?: string | null;
}

export interface ConnectedAccounts {
  zoom: PlatformStatus;
  teams: PlatformStatus;
  google: PlatformStatus;
}

const EMPTY: ConnectedAccounts = {
  zoom: { connected: false, identities: [] },
  teams: { connected: false, identities: [] },
  google: { connected: false, identities: [] },
};

/**
 * Fetch connected platform accounts from the backend.
 * Uses Bearer token auth via apiFetch.
 *
 * Distinguishes "fetched cleanly with empty result" from "fetch errored":
 * a 500 or network failure used to fall through to the ConnectPlatformGate
 * with EMPTY accounts, which made the user think their Zoom/Teams link
 * had been wiped. Now we surface `error` so the panel can render a
 * Connection Issue prompt instead.
 */
export function useConnectedAccounts(isAuthenticated: boolean) {
  const [accounts, setAccounts] = useState<ConnectedAccounts>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [hasResolved, setHasResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await apiFetch("/oauth/connected-accounts");
      if (resp.ok) {
        const data = await resp.json();
        setAccounts(data);
      } else if (resp.status === 401) {
        // Token revoked / expired — sign the user out the same way the
        // presence heartbeat does on 401.
        emit("auth-expired").catch(() => {});
        setError("Your sign-in expired. Please sign in again.");
      } else {
        setError(`/oauth/connected-accounts returned HTTP ${resp.status}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("Failed to fetch connected accounts:", msg);
      setError(`Couldn't reach Minerva to load your accounts: ${msg}`);
    } finally {
      setLoading(false);
      setHasResolved(true);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      // Reset on sign-out so a subsequent sign-in re-gates correctly.
      setAccounts(EMPTY);
      setHasResolved(false);
      setError(null);
      return;
    }
    refresh();
  }, [isAuthenticated, refresh]);

  return { accounts, loading, hasResolved, error, refresh };
}
