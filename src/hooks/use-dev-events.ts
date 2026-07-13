import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { CoachingMessage, CompanionDataUpdate } from "../types/coaching";

/**
 * Listen for dev mode simulated chart updates via Tauri events.
 * Merged with real SocketIO data in the panel.
 */
export function useDevChartData() {
  const [devChartData, setDevChartData] = useState<CompanionDataUpdate | null>(
    null
  );

  useEffect(() => {
    // Only register the dev event listener in development builds. The
    // emitter is also dev-only (DevMode.tsx), so leaving the listener in
    // production is dead code at best and a cross-window UI-spoofing
    // surface at worst (P2-C).
    if (!import.meta.env.DEV) return;
    const unlisten = listen<CompanionDataUpdate>("dev-chart-update", (event) => {
      setDevChartData(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return devChartData;
}

/**
 * Listen for dev mode simulated coaching messages via Tauri events.
 * Merged with real SocketIO data in the panel.
 */
export function useDevCoachingMessage() {
  const [devCoachingMessage, setDevCoachingMessage] =
    useState<CoachingMessage | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const unlisten = listen<CoachingMessage>(
      "dev-coaching-message",
      (event) => setDevCoachingMessage(event.payload)
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return devCoachingMessage;
}
