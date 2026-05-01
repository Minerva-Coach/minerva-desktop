import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Tracks whether the user has dismissed the post-onboarding welcome screen.
 * Backed by a marker file in the Tauri app data dir, so the answer survives
 * sign-out and re-launches but is per-installation.
 *
 * `acknowledged === null` means we haven't checked yet — callers should treat
 * that as "don't decide yet" to avoid flashing the welcome between renders.
 */
export function useWelcomeAcknowledged() {
  const [acknowledged, setAcknowledged] = useState<boolean | null>(null);

  useEffect(() => {
    invoke<boolean>("is_welcome_acknowledged")
      .then(setAcknowledged)
      .catch((e) => {
        console.warn("is_welcome_acknowledged failed:", e);
        // If the IPC call fails we default to "acknowledged" so the user
        // isn't trapped on the welcome screen by an unrelated bug.
        setAcknowledged(true);
      });
  }, []);

  const acknowledge = useCallback(async () => {
    try {
      await invoke("acknowledge_welcome");
    } catch (e) {
      console.warn("acknowledge_welcome failed:", e);
    }
    setAcknowledged(true);
  }, []);

  return { acknowledged, acknowledge };
}
