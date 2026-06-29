import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

type MicrosoftCalendarStatus =
  | "connected"
  | "teams_connected_no_sub"
  | "needs_teams";
type GoogleCalendarStatus = "coming_soon" | "available" | "connected";

interface CalendarAccount<S extends string> {
  status: S;
  label: string | null;
  connected_at: string | null;
  connect_url: string | null;
}

export interface CalendarStatus {
  microsoft: CalendarAccount<MicrosoftCalendarStatus>;
  google: CalendarAccount<GoogleCalendarStatus>;
}

/**
 * Fetch calendar subscription status from /api/calendar/linked-calendars.
 * Non-critical: errors are swallowed and status stays null.
 */
export function useCalendarStatus(isAuthenticated: boolean) {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
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
