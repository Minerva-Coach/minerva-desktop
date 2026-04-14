import { useCallback, useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { useAuth } from "../hooks/use-auth";
import { useSocket } from "../hooks/use-socket";
import { FloatingIcon } from "./overlay/FloatingIcon";
import type { CoachingMessage } from "../types/coaching";

interface ActiveIcon {
  id: number;
  message: CoachingMessage;
}

let iconCounter = 0;

/**
 * Transparent overlay window for floating coaching icons.
 * Icons appear and float upward when coaching events fire.
 */
export function OverlayWindow() {
  const { token } = useAuth();
  const { lastCoachingMessage } = useSocket(token);
  const [icons, setIcons] = useState<ActiveIcon[]>([]);

  // Enable click-through by default
  useEffect(() => {
    getCurrentWebviewWindow()
      .setIgnoreCursorEvents(true)
      .catch(() => {});
  }, []);

  // Handle real coaching messages from SocketIO
  useEffect(() => {
    if (!lastCoachingMessage) return;
    addIcon(lastCoachingMessage);
  }, [lastCoachingMessage]);

  // Handle dev mode simulated messages via Tauri events
  useEffect(() => {
    const unlisten = listen<CoachingMessage>("dev-coaching-message", (event) => {
      addIcon(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const addIcon = useCallback((message: CoachingMessage) => {
    const id = ++iconCounter;
    setIcons((prev) => [...prev, { id, message }]);

    // Remove after animation completes (4 seconds)
    setTimeout(() => {
      setIcons((prev) => prev.filter((i) => i.id !== id));
    }, 4000);
  }, []);

  const handleMouseEnter = useCallback(async () => {
    try {
      await getCurrentWebviewWindow().setIgnoreCursorEvents(false);
    } catch { /* ignore in dev */ }
  }, []);

  const handleMouseLeave = useCallback(async () => {
    try {
      await getCurrentWebviewWindow().setIgnoreCursorEvents(true);
    } catch { /* ignore in dev */ }
  }, []);

  return (
    <div
      className="w-full h-full relative overflow-hidden"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {icons.map((icon) => (
        <FloatingIcon key={icon.id} message={icon.message} />
      ))}
    </div>
  );
}
