import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

/**
 * Tracks per-feature visibility status for the companion windows
 * (focus goals, agenda, coaching). Mirrors GET /api/v1/desktop/feature-state.
 *
 * The backend decides locked/ready/dismissed; this hook just renders
 * what it's told and exposes mutations for the two user actions the
 * desktop owns: dismissing an intro and toggling a feature on/off.
 *
 * Mounted in the Panel; the AboutModal reads the same state via props
 * to avoid duplicate fetches.
 */

export type FeatureName = "focusGoals" | "agenda" | "coaching";

export type FeatureStatus = "locked" | "ready" | "dismissed";

export interface FeatureSlice {
  status: FeatureStatus;
  introSeen: boolean | null;
  unlockReason?: string;
  progress?: { current: number; required: number };
}

export interface FeatureState {
  focusGoals: FeatureSlice;
  agenda: FeatureSlice;
  coaching: FeatureSlice;
}

const SETTINGS_KEY_FOR_ENABLED: Record<FeatureName, string> = {
  focusGoals: "focusGoalsEnabled",
  agenda: "agendaEnabled",
  coaching: "coachingEnabled",
};

const SETTINGS_KEY_FOR_INTRO_SEEN: Record<FeatureName, string | null> = {
  focusGoals: "focusGoalsIntroSeen",
  agenda: "agendaIntroSeen",
  coaching: null,
};

interface UseFeatureStateReturn {
  state: FeatureState | null;
  loading: boolean;
  error: string | null;
  markIntroSeen: (feature: FeatureName) => Promise<void>;
  setEnabled: (feature: FeatureName, enabled: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

async function fetchState(): Promise<FeatureState> {
  const resp = await apiFetch("/api/v1/desktop/feature-state");
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as FeatureState;
}

async function patchSettings(body: Record<string, unknown>): Promise<void> {
  // Relies on the partial-update contract on /api/settings — only keys
  // present in this body get written, so unrelated preferences aren't
  // clobbered.
  const resp = await apiFetch("/api/settings", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

export function useFeatureState(): UseFeatureStateReturn {
  const [state, setState] = useState<FeatureState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const next = await fetchState();
      setState(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load feature state");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchState()
      .then((next) => {
        if (!cancelled) {
          setState(next);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load feature state");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const markIntroSeen = useCallback(async (feature: FeatureName) => {
    const settingsKey = SETTINGS_KEY_FOR_INTRO_SEEN[feature];
    if (!settingsKey) return; // coaching has no intro
    await patchSettings({ [settingsKey]: true });
    setState((prev) =>
      prev
        ? { ...prev, [feature]: { ...prev[feature], introSeen: true } }
        : prev
    );
  }, []);

  const setEnabled = useCallback(
    async (feature: FeatureName, enabled: boolean) => {
      const settingsKey = SETTINGS_KEY_FOR_ENABLED[feature];
      // Optimistic update — the server is the source of truth for
      // computed status (locked vs ready), so refresh after a successful
      // toggle so the UI reconciles if e.g. enabling unlocks a "ready".
      setState((prev) =>
        prev
          ? {
              ...prev,
              [feature]: {
                ...prev[feature],
                status: enabled
                  ? prev[feature].status === "dismissed"
                    ? "ready"
                    : prev[feature].status
                  : "dismissed",
              },
            }
          : prev
      );
      try {
        await patchSettings({ [settingsKey]: enabled });
        // Re-fetch so locked/ready transitions (e.g. enabling a locked
        // feature whose unlock criteria are now met) reflect correctly.
        await refresh();
      } catch (e) {
        // Roll back by re-fetching
        await refresh();
        throw e;
      }
    },
    [refresh]
  );

  return { state, loading, error, markIntroSeen, setEnabled, refresh };
}
