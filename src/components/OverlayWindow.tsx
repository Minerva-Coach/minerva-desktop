import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useSocket } from "../hooks/use-socket";
import { FloatingIcon } from "./overlay/FloatingIcon";
import { BehaviorStations } from "./overlay/BehaviorStations";
import type { CoachingMessage } from "../types/coaching";

const INTRO_STORAGE_KEY = "minerva_overlay_intro_acked";
type IntroStage = "button" | "description" | "acknowledged";
function loadIntroStage(): IntroStage {
  return localStorage.getItem(INTRO_STORAGE_KEY) === "true" ? "acknowledged" : "button";
}

interface ActiveIcon {
  id: number;
  message: CoachingMessage;
}

let iconCounter = 0;

// Logical-pixel height of the header drag strip. Must match the header div's
// rendered height — keep in sync if the header layout changes.
const HEADER_DRAG_HEIGHT = 44;

// Polling interval for cursor-over-header detection. Tauri only supports
// per-window click-through, so we re-check the cursor at this rate to flip
// `setIgnoreCursorEvents` on entry/exit. ~12 Hz is fine for hover latency
// and barely registers in IPC traffic.
const CURSOR_POLL_MS = 80;

/**
 * Transparent overlay above the meeting window.
 *
 * Two modes:
 *
 * 1. **Normal** — HUD that's click-through everywhere *except* the header
 *    strip. The header is a permanent drag handle: hovering it disables
 *    click-through, mousedown calls `startDragging()`. Behavior stations
 *    and transient floating icons stay click-through so the meeting
 *    underneath remains usable.
 *
 * 2. **Reposition (fallback)** — entered from the About modal. Click-through
 *    is turned off for the *whole* window, a dashed border appears, and the
 *    user can drag from anywhere. Useful if the header is off-screen. Click
 *    the overlay or press Esc to exit.
 *
 * Setting the window click-through (`setIgnoreCursorEvents(true)`) on a
 * hidden window panics tao on Linux, so we only flip it after visibility.
 */
export function OverlayWindow() {
  const { lastCoachingMessage, lastChartData } = useSocket();
  const [icons, setIcons] = useState<ActiveIcon[]>([]);
  const [visible, setVisible] = useState(false);
  const [repositioning, setRepositioning] = useState(false);
  const [introStage, setIntroStage] = useState<IntroStage>(loadIntroStage);
  // Ref so the cursor-poll closure always sees the latest intro stage without
  // needing to be re-registered on every stage change.
  const introStageRef = useRef(introStage);
  useEffect(() => { introStageRef.current = introStage; }, [introStage]);

  const handleIntroAcknowledge = () => {
    localStorage.setItem(INTRO_STORAGE_KEY, "true");
    setIntroStage("acknowledged");
  };
  const handleIntroMoreInfo = () => invoke("open_icon_key").catch(console.warn);

  // Reposition (fallback) mode: the whole window is interactive so the user
  // can drag from anywhere. This is the only writer of click-through while
  // repositioning — the header poll below bails out in this mode.
  useEffect(() => {
    if (!visible || !repositioning) return;
    getCurrentWebviewWindow()
      .setIgnoreCursorEvents(false)
      .catch(() => {});
  }, [visible, repositioning]);

  // Normal mode: poll the cursor and *apply* the click-through state on every
  // tick. We can't use DOM mouseenter/leave because the window is click-through
  // whenever the cursor is outside the header, so those events never fire.
  //
  // The poll is the single, continuous authority for click-through here — it
  // re-asserts the correct state every tick rather than relying on a React
  // effect that only fires when a dependency changes. That matters because the
  // overlay's click-through can drift out from under React: a meeting start
  // races `setIgnoreCursorEvents` against the panel's `show_windows`
  // (show + set_always_on_top), and overlapping async toggles can land out of
  // order. Re-asserting every ~80ms means any such drift self-heals within one
  // interval instead of leaving the header stuck click-through (undraggable)
  // until the user enters/exits reposition mode. The `busy` guard serializes
  // ticks so two toggles are never in flight at once.
  useEffect(() => {
    if (!visible || repositioning) return;
    const win = getCurrentWebviewWindow();
    let cancelled = false;
    let busy = false;

    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const [cx, cy] = await invoke<[number, number]>("get_cursor_position");
        const [wpos, wsize, scale] = await Promise.all([
          win.outerPosition(),
          win.outerSize(),
          win.scaleFactor(),
        ]);
        const headerHeightPx = HEADER_DRAG_HEIGHT * scale;
        const introActive = introStageRef.current !== "acknowledged";
        const over =
          introActive ||
          (cx >= wpos.x &&
            cx < wpos.x + wsize.width &&
            cy >= wpos.y &&
            cy < wpos.y + headerHeightPx);
        // Interactive over the header (or the whole window when intro is
        // showing so the intro buttons are clickable).
        if (!cancelled) await win.setIgnoreCursorEvents(!over);
      } catch {
        /* ignore */
      } finally {
        busy = false;
      }
    };

    tick(); // apply immediately rather than waiting a full interval
    const interval = window.setInterval(tick, CURSOR_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
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

  // Reposition-mode (fallback) drag from anywhere. Same click-without-move
  // exit detection as before — on Windows the native drag consumes the
  // mouseup so no `click` event fires after startDragging() resolves.
  const handleRepositionMouseDown = useCallback(
    async (e: React.MouseEvent) => {
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
    },
    [repositioning]
  );

  // Header drag in normal mode. No mode-exit logic here — there's no mode
  // to exit; a no-movement click is just a no-op.
  const handleHeaderMouseDown = useCallback(
    async (e: React.MouseEvent) => {
      if (repositioning) return; // let the whole-window handler take it
      e.preventDefault();
      try {
        await getCurrentWebviewWindow().startDragging();
      } catch {
        /* ignore */
      }
    },
    [repositioning]
  );

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
      className={`w-full h-full relative overflow-hidden rounded-xl bg-slate-900/45 backdrop-blur-md border border-white/30 shadow-[0_4px_20px_rgba(0,0,0,0.45)] ${
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
        className="px-3 py-2 bg-slate-950/55 border-b border-white/25 flex items-center justify-center gap-2 select-none cursor-grab active:cursor-grabbing"
        style={{ height: `${HEADER_DRAG_HEIGHT}px` }}
        onMouseDown={handleHeaderMouseDown}
        title="Drag to move"
      >
        <span
          className="text-white/60 text-[14px] leading-none"
          aria-hidden="true"
        >
          ⋮⋮
        </span>
        <p
          className="text-[14px] font-bold text-white leading-tight tracking-wide"
          style={{
            textShadow:
              "1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000",
          }}
        >
          Minerva Core Behavior Counts
        </p>
      </div>

      <div className="px-2 pt-2 relative">
        <div className={`transition-opacity duration-300 ${introStage !== "acknowledged" ? "opacity-30 pointer-events-none select-none" : ""}`}>
          <BehaviorStations behaviors={lastChartData?.data.behaviors ?? []} />
        </div>

        {introStage === "button" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              onClick={() => setIntroStage("description")}
              className="px-3 py-1.5 rounded-lg bg-black/60 hover:bg-black/80 border border-white/30 text-[11px] text-white font-medium transition-colors shadow-lg"
            >
              What is this window?
            </button>
          </div>
        )}

        {introStage === "description" && (
          <div className="absolute inset-0 flex items-center justify-center px-1">
            <div className="w-full p-2.5 rounded-lg bg-slate-900/90 border border-white/20 shadow-lg space-y-2">
              <p className="text-[11px] text-gray-200 leading-relaxed">
                This window shows real-time coaching in the form of floating
                icons when you use one of our core skills: Summarizing
                Statement, Open-Ended Question, Exploring Emotions or Values,
                and Intent Alignment.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleIntroAcknowledge}
                  className="flex-1 px-2 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-[11px] text-white font-medium transition-colors"
                >
                  Got it
                </button>
                <button
                  onClick={handleIntroMoreInfo}
                  className="px-2 py-1.5 rounded bg-white/10 hover:bg-white/20 text-[11px] text-gray-200 font-medium transition-colors whitespace-nowrap"
                >
                  More info
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {icons.map((icon) => (
        <FloatingIcon key={icon.id} message={icon.message} />
      ))}
    </div>
  );
}
