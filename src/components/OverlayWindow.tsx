import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { useAuth } from "../hooks/use-auth";
import { useSocket } from "../hooks/use-socket";
import { FloatingIcon } from "./overlay/FloatingIcon";
import { BehaviorStations } from "./overlay/BehaviorStations";
import type { CoachingMessage } from "../types/coaching";

interface ActiveIcon {
  id: number;
  message: CoachingMessage;
}

let iconCounter = 0;

/**
 * Transparent overlay above the meeting window.
 *
 * Two modes:
 *
 * 1. **Normal** — click-through HUD. Shows behavior count/target stations
 *    at the top of the strip and transient attaboy icons that float up
 *    past them when coaching events fire.
 *
 * 2. **Reposition** — toggled from the panel's About modal. Click-through
 *    is turned off, a dashed border appears, and the user can drag the
 *    window to a new position. Click the overlay or press Esc to exit.
 *
 * Setting the window click-through (`setIgnoreCursorEvents(true)`) on a
 * hidden window panics tao on Linux, so we only flip it after visibility.
 */
export function OverlayWindow() {
  const { token } = useAuth();
  const { lastCoachingMessage, lastChartData } = useSocket(token);
  const [icons, setIcons] = useState<ActiveIcon[]>([]);
  const [visible, setVisible] = useState(false);
  const [repositioning, setRepositioning] = useState(false);

  // Click-through policy: ON when visible AND NOT repositioning.
  useEffect(() => {
    if (!visible) return;
    getCurrentWebviewWindow()
      .setIgnoreCursorEvents(!repositioning)
      .catch(() => {});
  }, [visible, repositioning]);

  // Track meeting lifecycle from Rust and reposition toggle from panel.
  useEffect(() => {
    const unlistenStart = listen("meeting-started", () => setVisible(true));
    const unlistenStop = listen("meeting-stopped", () => {
      setVisible(false);
      setRepositioning(false);
    });
    const unlistenEnter = listen("overlay-reposition-enter", () => {
      setVisible(true);
      setRepositioning(true);
    });
    const unlistenExit = listen("overlay-reposition-exit", () =>
      setRepositioning(false)
    );

    return () => {
      unlistenStart.then((fn) => fn());
      unlistenStop.then((fn) => fn());
      unlistenEnter.then((fn) => fn());
      unlistenExit.then((fn) => fn());
    };
  }, []);

  // Real coaching messages.
  useEffect(() => {
    if (!lastCoachingMessage) return;
    addIcon(lastCoachingMessage);
  }, [lastCoachingMessage]);

  // Dev-mode simulated messages.
  useEffect(() => {
    const unlisten = listen<CoachingMessage>(
      "dev-coaching-message",
      (event) => addIcon(event.payload)
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const addIcon = useCallback((message: CoachingMessage) => {
    const id = ++iconCounter;
    setIcons((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setIcons((prev) => prev.filter((i) => i.id !== id));
    }, 4000);
  }, []);

  // Reposition mode: let the user drag the window. Clicking exits.
  const dragStartedRef = useRef(false);
  const handleRepositionMouseDown = useCallback(async (e: React.MouseEvent) => {
    if (!repositioning) return;
    e.preventDefault();
    dragStartedRef.current = false;
    try {
      await getCurrentWebviewWindow().startDragging();
      // startDragging() resolves after the drag ends. If the user actually
      // moved the window, we mark it so the subsequent click doesn't also
      // exit — treat drag as the primary action.
      dragStartedRef.current = true;
    } catch {
      /* ignore */
    }
  }, [repositioning]);

  const handleRepositionClick = useCallback(() => {
    if (!repositioning) return;
    // Finish reposition on a click that wasn't a drag.
    if (dragStartedRef.current) {
      dragStartedRef.current = false;
      return;
    }
    setRepositioning(false);
  }, [repositioning]);

  // Esc exits reposition mode too.
  useEffect(() => {
    if (!repositioning) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRepositioning(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [repositioning]);

  return (
    <div
      className={`w-full h-full relative overflow-hidden ${
        repositioning
          ? "bg-gray-900/60 border-2 border-dashed border-blue-400 rounded-lg cursor-move"
          : ""
      }`}
      onMouseDown={handleRepositionMouseDown}
      onClick={handleRepositionClick}
    >
      {repositioning && (
        <div className="absolute inset-x-0 top-0 bg-black/70 text-white text-[10px] p-2 text-center pointer-events-none">
          Drag to move
          <br />
          Click to finish
        </div>
      )}

      <BehaviorStations behaviors={lastChartData?.data.behaviors ?? []} />

      {icons.map((icon) => (
        <FloatingIcon key={icon.id} message={icon.message} />
      ))}
    </div>
  );
}
