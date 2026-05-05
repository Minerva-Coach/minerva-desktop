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
  lastSocketError: string | null;
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
 * - socket-error: error chain string (most recent connect failure)
 */
export function useSocket(): UseSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [activeMeetings, setActiveMeetings] = useState<number[]>([]);
  const [lastCoachingMessage, setLastCoachingMessage] =
    useState<CoachingMessage | null>(null);
  const [lastChartData, setLastChartData] =
    useState<CompanionDataUpdate | null>(null);
  const [lastSocketError, setLastSocketError] = useState<string | null>(null);

  useEffect(() => {
    const unlisteners = [
      listen<string>("socket-status", (event) => {
        const connected = event.payload === "connected";
        setIsConnected(connected);
        if (connected) setLastSocketError(null);
      }),

      listen<ConnectedPayload>("socket-connected", (event) => {
        setIsConnected(true);
        setLastSocketError(null);
        setActiveMeetings(event.payload.meetings ?? []);
      }),

      listen<CoachingMessage>("socket-coaching-message", (event) => {
        setLastCoachingMessage(event.payload);
      }),

      listen<CompanionDataUpdate>("socket-companion-data", (event) => {
        setLastChartData(event.payload);
      }),

      listen<string>("socket-error", (event) => {
        setLastSocketError(event.payload);
      }),
    ];

    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  return {
    isConnected,
    activeMeetings,
    lastCoachingMessage,
    lastChartData,
    lastSocketError,
  };
}
