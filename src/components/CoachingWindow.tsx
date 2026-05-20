import { useEffect, useState } from "react";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { apiFetch } from "../lib/api";

/**
 * Coaching Advice companion window. V1 surfaces recent dashboard advice
 * entries — opt-in only, so the user explicitly asked for this content
 * by toggling it on in the About modal.
 */

interface AdviceEntry {
  id: number;
  date: string;
  advice: string;
}

interface AdviceHistoryResponse {
  entries: AdviceEntry[];
}

function dashboardUrl(): string {
  if (import.meta.env.DEV) return "https://127.0.0.1:8000/dashboard";
  return "https://minervacoach.com/dashboard";
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function CoachingWindow() {
  const [entries, setEntries] = useState<AdviceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiFetch("/api/advice-history")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<AdviceHistoryResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        setEntries(data.entries ?? []);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load advice");
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
        <p className="text-sm font-semibold text-gray-100">Coaching Advice</p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          Recent suggestions from your dashboard.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading && <p className="text-[12px] text-gray-400">Loading…</p>}
        {error && !loading && (
          <p className="text-[12px] text-red-400">Couldn't load advice: {error}</p>
        )}
        {!loading && !error && entries.length === 0 && (
          <p className="text-[12px] text-gray-400">
            No advice yet. Once you complete a few meetings, suggestions will
            show up here.
          </p>
        )}
        {!loading && !error && entries.length > 0 && (
          <ul className="space-y-3">
            {entries.map((entry) => (
              <li key={entry.id} className="border-b border-gray-800 pb-3 last:border-b-0">
                <p className="text-[10px] uppercase tracking-wider text-gray-500">
                  {formatDate(entry.date)}
                </p>
                <p className="text-[12px] text-gray-200 leading-snug mt-1 whitespace-pre-wrap">
                  {entry.advice}
                </p>
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
          Open dashboard →
        </button>
      </div>
    </div>
  );
}
