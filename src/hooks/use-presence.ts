import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Track the most recent presence-heartbeat error reported by Rust.
 *
 * The heartbeat fires while a Zoom meeting is detected and is what tells
 * the backend "this user is in a meeting" so Recall.ai can auto-verify
 * them. If it fails, the bot may not join — but the rest of the app
 * looks fine, so the user has no idea why coaching never starts. This
 * hook lets the panel surface the failure inline.
 *
 * Cleared on `presence-ok` (a successful heartbeat) so a transient error
 * doesn't linger in the UI after recovery.
 */
export function usePresenceError(): string | null {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unlisteners = [
      listen<string>("presence-error", (event) => {
        setError(event.payload);
      }),
      listen("presence-ok", () => {
        setError(null);
      }),
    ];
    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  return error;
}
