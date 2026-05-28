import { useEffect, useState } from "react";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { apiFetch } from "../lib/api";

/**
 * Read-only agenda view in v1. The AgendaItem shape mirrors the MVP
 * companion's use-agenda-items.ts so adding CRUD later means wiring
 * mutations, not restructuring the window.
 *
 * V1 surfaces the agenda for the user's next scheduled meeting (first
 * entry in /api/scheduled-meetings, which is ordered by start ASC).
 */

export interface AgendaItem {
  id: string;
  text: string;
  status: "planned" | "discussed" | "skipped" | "unplanned_discussed";
  order: number;
  parent_id: string | null;
}

interface ScheduledMeeting {
  id: number;
  title: string;
  start: string | null;
  agendaItems: AgendaItem[];
  hasAgenda: boolean;
}

interface ScheduledMeetingsResponse {
  scheduled: ScheduledMeeting[];
}

function dashboardUrl(): string {
  if (import.meta.env.DEV) return "https://127.0.0.1:8000/scheduled-meetings";
  return "https://minervacoach.com/scheduled-meetings";
}

const STATUS_LABEL: Record<AgendaItem["status"], string> = {
  planned: "Planned",
  discussed: "Discussed",
  skipped: "Skipped",
  unplanned_discussed: "Unplanned",
};

const STATUS_COLOR: Record<AgendaItem["status"], string> = {
  planned: "text-gray-300",
  discussed: "text-green-400",
  skipped: "text-gray-500 line-through",
  unplanned_discussed: "text-blue-300",
};

export function AgendaWindow() {
  const [nextMeeting, setNextMeeting] = useState<ScheduledMeeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiFetch("/api/scheduled-meetings")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ScheduledMeetingsResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        setNextMeeting(data.scheduled?.[0] ?? null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load agenda");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const items = nextMeeting?.agendaItems ?? [];

  return (
    <div className="w-full h-full bg-gray-900 text-white flex flex-col">
      <div className="px-4 py-3 bg-gray-800 border-b border-gray-700 shrink-0">
        <p className="text-sm font-semibold text-gray-100">Agenda</p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {nextMeeting?.title ?? "Your next scheduled meeting"}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading && <p className="text-[12px] text-gray-400">Loading…</p>}
        {error && !loading && (
          <p className="text-[12px] text-red-400">Couldn't load agenda: {error}</p>
        )}
        {!loading && !error && !nextMeeting && (
          <p className="text-[12px] text-gray-400">
            No upcoming meetings. Schedule one and add an agenda from the web
            dashboard.
          </p>
        )}
        {!loading && !error && nextMeeting && items.length === 0 && (
          <p className="text-[12px] text-gray-400">
            No agenda items yet for this meeting. Add some on the web dashboard.
          </p>
        )}
        {!loading && !error && items.length > 0 && (
          <ul className="space-y-1">
            {items.map((item) => (
              <li
                key={item.id}
                className="py-1.5 border-b border-gray-800 last:border-b-0 flex items-start gap-2"
              >
                <span className="text-[10px] uppercase tracking-wider text-gray-500 shrink-0 w-20 pt-0.5">
                  {STATUS_LABEL[item.status]}
                </span>
                <span className={`text-[12px] ${STATUS_COLOR[item.status]}`}>
                  {item.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="px-4 py-2 bg-gray-800 border-t border-gray-700 shrink-0">
        <button
          type="button"
          onClick={() => openShell(dashboardUrl()).catch(console.warn)}
          className="text-[11px] text-blue-400 hover:text-blue-300 underline"
        >
          Edit on web →
        </button>
      </div>
    </div>
  );
}
