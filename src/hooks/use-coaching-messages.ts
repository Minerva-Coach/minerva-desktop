import { useEffect, useRef, useState } from "react";
import type { CoachingMessage } from "../types/coaching";

const DEFAULT_DISMISS_SECONDS = 30;

/**
 * Manages a queue of coaching messages with auto-dismiss.
 * Only shows the most recent message at a time (overlay is small).
 */
export function useCoachingMessages(
  lastMessage: CoachingMessage | null
) {
  const [currentMessage, setCurrentMessage] = useState<CoachingMessage | null>(
    null
  );
  const [isVisible, setIsVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!lastMessage) return;

    // Clear any existing dismiss timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Show the new message
    setCurrentMessage(lastMessage);
    setIsVisible(true);

    // Set auto-dismiss timer
    const dismissMs =
      (lastMessage.auto_dismiss_seconds ?? DEFAULT_DISMISS_SECONDS) * 1000;

    timerRef.current = setTimeout(() => {
      setIsVisible(false);
      // Wait for fade-out animation before clearing
      setTimeout(() => setCurrentMessage(null), 500);
    }, dismissMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [lastMessage]);

  const dismiss = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setIsVisible(false);
    setTimeout(() => setCurrentMessage(null), 500);
  };

  return { currentMessage, isVisible, dismiss };
}
