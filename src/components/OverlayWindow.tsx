import { useCallback, useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
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
  const { lastCoachingMessage, lastChartData } = useSocket();
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
      // Focus the overlay so Esc reaches it — the panel had focus before.
      getCurrentWebviewWindow().setFocus().catch(() => {});
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

  const addIcon = useCallback((message: CoachingMessage) => {
    const id = ++iconCounter;
    setIcons((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setIcons((prev) => prev.filter((i) => i.id !== id));
    }, 4000);
  }, []);

  // Dev-mode simulated messages. Only register the listener in dev — the
  // emitter is also dev-only (DevMode.tsx), so shipping the listener in
  // release is dead code and a cross-window UI-spoofing surface (P2-C).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const unlisten = listen<CoachingMessage>(
      "dev-coaching-message",
      (event) => addIcon(event.payload)
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addIcon]);

  // Reposition mode: let the user drag the window. Also exit if the user
  // "clicks" without moving (detected via position compare, because on
  // Windows the native drag consumes the mouseup and no `click` event fires
  // after startDragging() resolves).
  const handleRepositionMouseDown = useCallback(async (e: React.MouseEvent) => {
    if (!repositioning) return;
    e.preventDefault();
    const win = getCurrentWebviewWindow();
    try {
      const before = await win.outerPosition();
      await win.startDragging();
      const after = await win.outerPosition();
      if (before.x === after.x && before.y === after.y) {
        setRepositioning(false);
      }
    } catch {
      /* ignore */
    }
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
      className={`w-full h-full relative overflow-hidden rounded-lg bg-white/5 backdrop-blur-sm border border-white/10 ${
        repositioning ? "border-2 border-dashed border-blue-400 cursor-move" : ""
      }`}
      onMouseDown={handleRepositionMouseDown}
    >
      {repositioning && (
        <div className="absolute inset-x-0 top-0 bg-black/70 text-white text-[10px] p-2 text-center pointer-events-none flex items-center justify-center gap-3 z-10">
          <span>Drag to move</span>
          <button
            type="button"
            className="pointer-events-auto bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-[10px] font-medium cursor-pointer"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setRepositioning(false);
            }}
          >
            Done
          </button>
        </div>
      )}

      <div
        className="px-2 pt-1.5 pb-1 text-center"
        style={{
          // 4-corner hard outline + soft drop shadow so the text stays
          // readable on any meeting background (light slides, dark video, etc).
          textShadow:
            "1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000, 0 0 4px rgba(0,0,0,0.9)",
        }}
      >
        <p className="text-[15px] font-bold text-white leading-tight">
          Minerva Core Behavior Counts
        </p>
        <p className="text-[12px] font-medium text-white leading-tight">
          Reposition in the About menu — click <span aria-hidden="true">ⓘ</span>
        </p>
      </div>

      <BehaviorStations behaviors={lastChartData?.data.behaviors ?? []} />

      {icons.map((icon) => (
        <FloatingIcon key={icon.id} message={icon.message} />
      ))}
    </div>
  );
}
