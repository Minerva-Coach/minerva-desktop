import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export type MeetingPlatform = "zoom" | "teams";

interface MeetingStartedPayload {
  meeting_platform: MeetingPlatform;
  meeting_url: string | null;
}

/**
 * Listen for meeting-started/meeting-stopped events from the Rust process
 * detector. Also manages window visibility — showing windows when a meeting
 * starts and hiding when it ends.
 */
export function useMeetingStatus() {
  const [inMeeting, setInMeeting] = useState(false);
  const [meetingUrl, setMeetingUrl] = useState<string | null>(null);
  const [meetingPlatform, setMeetingPlatform] =
    useState<MeetingPlatform | null>(null);

  useEffect(() => {
    // Sync initial state — the Rust detector may have already fired
    // `meeting-started` before React mounted (e.g. Zoom was already in a
    // meeting when the app launched). Without this the panel never shows.
    // The initial sync only knows "in a meeting" (not which platform);
    // the next meeting-started event will fill that in.
    invoke<boolean>("is_in_meeting")
      .then((active) => {
        if (active) {
          setInMeeting(true);
          invoke("show_windows").catch(console.warn);
        }
      })
      .catch(console.warn);

    const unlistenStart = listen<MeetingStartedPayload>(
      "meeting-started",
      (event) => {
        setInMeeting(true);
        setMeetingUrl(event.payload.meeting_url);
        setMeetingPlatform(event.payload.meeting_platform);
        invoke("show_windows").catch(console.warn);
      }
    );

    const unlistenStop = listen("meeting-stopped", () => {
      setInMeeting(false);
      setMeetingUrl(null);
      setMeetingPlatform(null);
      invoke("hide_windows").catch(console.warn);
    });

    return () => {
      unlistenStart.then((fn) => fn());
      unlistenStop.then((fn) => fn());
    };
  }, []);

  return { inMeeting, meetingUrl, meetingPlatform };
}
