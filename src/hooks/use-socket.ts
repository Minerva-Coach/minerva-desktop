import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { CoachingMessage, CompanionDataUpdate } from "../types/coaching";

interface ConnectedPayload {
  user_id: number;
  meetings: number[];
  timestamp: string;
}

interface UseSocketReturn {
  isConnected: boolean;
  activeMeetings: number[];
  lastCoachingMessage: CoachingMessage | null;
  lastChartData: CompanionDataUpdate | null;
}

/**
 * Listen for SocketIO events proxied through Rust.
 *
 * The Rust socket_proxy connects to the backend SocketIO server (bypassing
 * webkit2gtk's TLS restrictions) and forwards events as Tauri events:
 * - socket-status: "connected" | "disconnected"
 * - socket-connected: { user_id, meetings, timestamp }
 * - socket-coaching-message: CoachingMessage
 * - socket-companion-data: CompanionDataUpdate
 */
export function useSocket(_token: string | null): UseSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [activeMeetings, setActiveMeetings] = useState<number[]>([]);
  const [lastCoachingMessage, setLastCoachingMessage] =
    useState<CoachingMessage | null>(null);
  const [lastChartData, setLastChartData] =
    useState<CompanionDataUpdate | null>(null);

  useEffect(() => {
    const unlisteners = [
      listen<string>("socket-status", (event) => {
        setIsConnected(event.payload === "connected");
      }),

      listen<ConnectedPayload>("socket-connected", (event) => {
        setIsConnected(true);
        setActiveMeetings(event.payload.meetings ?? []);
      }),

      listen<CoachingMessage>("socket-coaching-message", (event) => {
        setLastCoachingMessage(event.payload);
      }),

      listen<CompanionDataUpdate>("socket-companion-data", (event) => {
        setLastChartData(event.payload);
      }),
    ];

    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  return { isConnected, activeMeetings, lastCoachingMessage, lastChartData };
}
