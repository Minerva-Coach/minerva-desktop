import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

/**
 * Listen for meeting-started/meeting-stopped events from the Rust process
 * detector. Also manages window visibility — showing windows when a meeting
 * starts and hiding when it ends. This runs from the frontend (main thread)
 * to avoid the tao/GTK panic that occurs when Rust background threads call
 * show/hide directly.
 */
export function useMeetingStatus() {
  const [inMeeting, setInMeeting] = useState(false);

  useEffect(() => {
    const unlistenStart = listen("meeting-started", () => {
      setInMeeting(true);
      invoke("show_windows").catch(console.warn);
    });

    const unlistenStop = listen("meeting-stopped", () => {
      setInMeeting(false);
      invoke("hide_windows").catch(console.warn);
    });

    return () => {
      unlistenStart.then((fn) => fn());
      unlistenStop.then((fn) => fn());
    };
  }, []);

  return { inMeeting };
}
