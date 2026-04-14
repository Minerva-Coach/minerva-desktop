import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { CompanionDataUpdate } from "../types/coaching";

/**
 * Listen for dev mode simulated chart updates via Tauri events.
 * Merged with real SocketIO data in the panel.
 */
export function useDevChartData() {
  const [devChartData, setDevChartData] = useState<CompanionDataUpdate | null>(
    null
  );

  useEffect(() => {
    const unlisten = listen<CompanionDataUpdate>("dev-chart-update", (event) => {
      setDevChartData(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return devChartData;
}
