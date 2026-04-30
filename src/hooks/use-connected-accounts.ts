import { useCallback, useEffect, useState } from "react";
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
 */
export function useConnectedAccounts(isAuthenticated: boolean) {
  const [accounts, setAccounts] = useState<ConnectedAccounts>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [hasResolved, setHasResolved] = useState(false);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const resp = await apiFetch("/oauth/connected-accounts");
      if (resp.ok) {
        const data = await resp.json();
        setAccounts(data);
      }
    } catch (e) {
      console.warn("Failed to fetch connected accounts:", e);
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
      return;
    }
    refresh();
  }, [isAuthenticated, refresh]);

  return { accounts, loading, hasResolved, refresh };
}
