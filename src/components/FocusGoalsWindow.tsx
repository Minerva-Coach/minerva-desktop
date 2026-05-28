import { useEffect, useState } from "react";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { apiFetch } from "../lib/api";

/**
 * Read-only mirror of the user's active focus goals. Full CRUD lives on
 * the web dashboard for v1 — the "Edit on web" link below is the
 * deliberate escape hatch.
 */

interface FocusTemplate {
  title: string;
  description?: string;
}

interface FocusGoal {
  id: number;
  customTitle: string | null;
  targetCount: number | null;
  template?: FocusTemplate;
}

interface FocusGoalsResponse {
  goals: FocusGoal[];
  maxGoals: number;
}

function dashboardUrl(): string {
  // Match the backend dev/prod split the rest of the app uses (see
  // parent CLAUDE.md — desktop expects https://127.0.0.1:8000 in dev,
  // https://minervacoach.com in prod). The shell allowlist in
  // tauri.conf.json already permits both hosts.
  if (import.meta.env.DEV) return "https://127.0.0.1:8000/dashboard/focus-goals";
  return "https://minervacoach.com/dashboard/focus-goals";
}

export function FocusGoalsWindow() {
  const [goals, setGoals] = useState<FocusGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiFetch("/api/focus-goals")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<FocusGoalsResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        setGoals(data.goals ?? []);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load goals");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="w-full h-full bg-gray-900 text-white flex flex-col">
      <div className="px-4 py-3 bg-gray-800 border-b border-gray-700 shrink-0">
        <p className="text-sm font-semibold text-gray-100">Your Focus Goals</p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          What you're practicing across meetings.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading && (
          <p className="text-[12px] text-gray-400">Loading…</p>
        )}
        {error && !loading && (
          <p className="text-[12px] text-red-400">Couldn't load goals: {error}</p>
        )}
        {!loading && !error && goals.length === 0 && (
          <p className="text-[12px] text-gray-400">
            No active goals yet. Add one on the dashboard to start tracking.
          </p>
        )}
        {!loading && !error && goals.length > 0 && (
          <ul className="space-y-2">
            {goals.map((g) => (
              <li
                key={g.id}
                className="py-2 border-b border-gray-800 last:border-b-0"
              >
                <p className="text-[12px] font-semibold text-gray-100">
                  {g.customTitle ?? g.template?.title ?? "Untitled goal"}
                </p>
                {g.template?.description && (
                  <p className="text-[11px] text-gray-400 leading-snug mt-0.5">
                    {g.template.description}
                  </p>
                )}
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
