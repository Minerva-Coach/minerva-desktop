import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

interface MeetingStartedPayload {
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

  useEffect(() => {
    const unlistenStart = listen<MeetingStartedPayload>(
      "meeting-started",
      (event) => {
        setInMeeting(true);
        setMeetingUrl(event.payload.meeting_url);
        invoke("show_windows").catch(console.warn);
      }
    );

    const unlistenStop = listen("meeting-stopped", () => {
      setInMeeting(false);
      setMeetingUrl(null);
      invoke("hide_windows").catch(console.warn);
    });

    return () => {
      unlistenStart.then((fn) => fn());
      unlistenStop.then((fn) => fn());
    };
  }, []);

  return { inMeeting, meetingUrl };
}
