import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { io, Socket } from "socket.io-client";
import type { CoachingMessage, CompanionDataUpdate } from "../types/coaching";

interface UseSocketReturn {
  isConnected: boolean;
  activeMeetings: number[];
  lastCoachingMessage: CoachingMessage | null;
  lastChartData: CompanionDataUpdate | null;
}

export function useSocket(token: string | null): UseSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [activeMeetings, setActiveMeetings] = useState<number[]>([]);
  const [lastCoachingMessage, setLastCoachingMessage] =
    useState<CoachingMessage | null>(null);
  const [lastChartData, setLastChartData] =
    useState<CompanionDataUpdate | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) {
      // Disconnect if token is cleared
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setIsConnected(false);
        setActiveMeetings([]);
      }
      return;
    }

    let cancelled = false;

    async function connect() {
      const apiUrl = await invoke<string>("get_api_url");

      if (cancelled) return;

      const socket = io(apiUrl, {
        path: "/socket.io",
        transports: ["polling"],
        extraHeaders: {
          Authorization: `Bearer ${token}`,
        },
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
      });

      socketRef.current = socket;

      socket.on("connect", () => {
        if (!cancelled) setIsConnected(true);
      });

      socket.on("disconnect", () => {
        if (!cancelled) setIsConnected(false);
      });

      socket.on("connect_error", () => {
        if (!cancelled) setIsConnected(false);
      });

      // Backend sends this on successful connection with list of active meetings
      socket.on(
        "connected",
        (data: { user_id: number; meetings: number[]; timestamp: string }) => {
          if (!cancelled) setActiveMeetings(data.meetings);
        }
      );

      // Coaching messages from the bot during meetings
      socket.on("coaching_message", (data: CoachingMessage) => {
        if (!cancelled) setLastCoachingMessage(data);
      });

      // Chart data updates (stored for potential future use)
      socket.on("companion_data_update", (data: CompanionDataUpdate) => {
        if (!cancelled) setLastChartData(data);
      });
    }

    connect();

    return () => {
      cancelled = true;
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [token]);

  return { isConnected, activeMeetings, lastCoachingMessage, lastChartData };
}
