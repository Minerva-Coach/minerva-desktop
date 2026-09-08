import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";

export interface CalendarAccount {
  identity_id: number;
  label: string | null;
  connected_at: string | null;
  has_subscription?: boolean;
}

export interface CalendarProvider {
  accounts: CalendarAccount[];
  connect_url: string | null;
  provider_available: boolean;
}

export interface CalendarStatus {
  microsoft: CalendarProvider;
  google: CalendarProvider;
}

/**
 * Fetch calendar subscription status from /api/calendar/linked-calendars.
 * Non-critical: errors are swallowed and status stays null.
 */
export function useCalendarStatus(isAuthenticated: boolean) {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const statusRef = useRef<CalendarStatus | null>(null);
  statusRef.current = status;

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    // Only show a loading state for the initial fetch. Once we have data,
    // periodic background polls (see ConnectCalendarGate) should update the
    // status silently instead of flipping the UI back to "Loading…".
    setLoading((prev) => (statusRef.current === null ? true : prev));
    try {
      const resp = await apiFetch("/api/calendar/linked-calendars");
      if (resp.ok) {
        const data = await resp.json();
        setStatus(data);
      }
    } catch {
      // Calendar status is non-critical — don't surface errors to the user.
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setStatus(null);
      return;
    }
    refresh();
  }, [isAuthenticated, refresh]);

  return { status, loading, refresh };
}
