import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { apiFetch } from "../lib/api";

export type FontScale = "small" | "medium" | "large";

// Tauri webview zoom factors. "medium" is the anchor for the current design —
// change THIS value (and let small/large stay relative) to shift the default
// for everyone based on user feedback. Example: bumping medium to 1.18 makes
// the app feel one notch larger out of the box; small and large still bracket
// it.
//
// We use Tauri zoom rather than a CSS variable because the desktop UI is
// styled with absolute `text-[Npx]` declarations (100+ across 15 files) that
// a CSS-variable-on-html approach can't reach. Zoom scales the whole webview
// uniformly — text, padding, icons — keeping everything proportional.
export const SCALE_FACTORS: Record<FontScale, number> = {
  small: 0.88,
  medium: 1.0,
  large: 1.18,
};

const STORAGE_KEY = "minerva.fontScale";

function readCached(): FontScale {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "small" || v === "medium" || v === "large" ? v : "medium";
}

/**
 * Apply the cached font scale to the *current* webview window only.
 *
 * Called from App.tsx in every window so the user's choice is restored
 * immediately on app start, before the panel has reconciled with the backend.
 * Without this, every window would render briefly at zoom 1.0 and then snap
 * to the user's preference once the panel's reconcile fires — a visible flash
 * on Large.
 */
export async function applyCachedFontScale(): Promise<void> {
  try {
    const scale = readCached();
    await getCurrentWebviewWindow().setZoom(SCALE_FACTORS[scale]);
  } catch (err) {
    console.warn("applyCachedFontScale failed:", err);
  }
}

interface UseFontScaleReturn {
  scale: FontScale;
  saveScale: (next: FontScale) => Promise<void>;
}

/**
 * Panel-side hook: reconciles the locally-cached font scale with the
 * server-side preference at /api/settings (so a Small set on the dashboard
 * is honored in the desktop app and vice versa), and exposes saveScale for
 * the AboutModal picker.
 *
 * Mounted only in the panel — other windows just use applyCachedFontScale
 * at start-up and trust the Rust `set_font_scale` command to broadcast any
 * changes the panel makes to all windows.
 */
export function useFontScale(): UseFontScaleReturn {
  const [scale, setScale] = useState<FontScale>(() => readCached());

  // Reconcile with backend on mount. If the server value differs from the
  // locally-cached one (e.g. the user set it on the web dashboard), apply
  // the server value across all windows.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await apiFetch("/api/settings");
        if (cancelled || !resp.ok) return;
        const data = await resp.json();
        const next = data?.fontScale as FontScale | undefined;
        if (cancelled || !next || next === scale) return;
        localStorage.setItem(STORAGE_KEY, next);
        setScale(next);
        await invoke("set_font_scale", { factor: SCALE_FACTORS[next] });
      } catch {
        // Backend unreachable — keep the cached value and move on. The user
        // can still pick a new scale; the POST will retry implicitly.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally empty deps — fetch once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveScale = useCallback(
    async (next: FontScale) => {
      const previous = scale;
      setScale(next);
      localStorage.setItem(STORAGE_KEY, next);
      try {
        // Apply zoom to all windows immediately (don't wait for the network).
        await invoke("set_font_scale", { factor: SCALE_FACTORS[next] });

        // Persist server-side. The /api/settings POST handler expects the
        // whole settings object (partial sends clobber other fields), so
        // GET-merge-POST matches what the dashboard's useSettings does.
        const getResp = await apiFetch("/api/settings");
        const current = getResp.ok ? await getResp.json() : {};
        await apiFetch("/api/settings", {
          method: "POST",
          body: JSON.stringify({ ...current, fontScale: next }),
        });
      } catch (err) {
        // Roll back local state on failure so the picker reflects reality.
        setScale(previous);
        localStorage.setItem(STORAGE_KEY, previous);
        try {
          await invoke("set_font_scale", { factor: SCALE_FACTORS[previous] });
        } catch {
          // best-effort rollback
        }
        throw err;
      }
    },
    [scale]
  );

  return { scale, saveScale };
}
