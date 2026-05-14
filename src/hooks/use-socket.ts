import { useCallback, useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { io, Socket } from "socket.io-client";
import type { AuthResult, CoachingMessage, CompanionDataUpdate } from "../types/coaching";

const PANEL_LABEL = "panel";

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
  sendMeetingStatus: (status: string, meetingId: number) => void;
}

/**
 * SocketIO connection — owned by the panel WebView, mirrored to other
 * windows via Tauri events.
 *
 * The panel window opens a real socket.io-client connection using the
 * WebView's network stack (WKWebView on macOS, WebView2 on Windows,
 * webkit2gtk on Linux). This is the same stack the user's browser uses,
 * so it transparently handles MDM-installed root CAs, captive portals,
 * Private Relay, corporate TLS-intercepting middleboxes, and whatever
 * else the user's IT environment imposes — none of which rustls or
 * native-tls see through reliably.
 *
 * Other windows (overlay, icon-key) listen for the re-broadcast Tauri
 * events the panel emits — same event names and payload shapes as the
 * old Rust proxy emitted, so consumers are unchanged.
 */
export function useSocket(): UseSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [activeMeetings, setActiveMeetings] = useState<number[]>([]);
  const [lastCoachingMessage, setLastCoachingMessage] =
    useState<CoachingMessage | null>(null);
  const [lastChartData, setLastChartData] =
    useState<CompanionDataUpdate | null>(null);
  const [lastSocketError, setLastSocketError] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const isPanel = getCurrentWebviewWindow().label === PANEL_LABEL;

  // Pull the current bearer token; refresh on auth-complete + auth-expired
  // so the socket reconnects with the new identity (or disconnects on logout).
  useEffect(() => {
    if (!isPanel) return;
    let cancelled = false;

    invoke<string | null>("get_auth_token")
      .then((t) => {
        if (!cancelled) setAuthToken(t ?? null);
      })
      .catch(() => {
        if (!cancelled) setAuthToken(null);
      });

    const unlistenAuth = listen<AuthResult>("auth-complete", (event) => {
      if (event.payload.success) {
        invoke<string | null>("get_auth_token").then((t) => {
          if (!cancelled) setAuthToken(t ?? null);
        });
      }
    });
    const unlistenExpired = listen("auth-expired", () => {
      if (!cancelled) setAuthToken(null);
    });

    return () => {
      cancelled = true;
      unlistenAuth.then((fn) => fn());
      unlistenExpired.then((fn) => fn());
    };
  }, [isPanel]);

  // Non-panel windows: subscribe to the broadcast Tauri events.
  useEffect(() => {
    if (isPanel) return;
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
  }, [isPanel]);

  // Panel: own the socket. Re-runs whenever the token changes, which is
  // the right thing to do on login, logout, and 401-driven expiry.
  useEffect(() => {
    if (!isPanel) return;
    if (!authToken) {
      // Logged out — tear any existing socket down so the next sign-in
      // gets a clean reconnect.
      socketRef.current?.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      emit("socket-status", "disconnected");
      return;
    }

    let cancelled = false;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;

    const setup = async () => {
      const apiUrl = await invoke<string>("get_api_url");
      if (cancelled) return;

      const socket = io(apiUrl, {
        // Polling only — matches what the prior Rust client did
        // (TransportType::Polling) and avoids the wss:// upgrade path,
        // which loses the Authorization header (browser WebSocket spec
        // doesn't allow custom headers). Adding "websocket" later is
        // backend-dependent: needs the socket.io middleware to
        // authenticate the upgrade off the established polling session
        // rather than re-checking the Authorization header.
        transports: ["polling"],
        auth: { token: authToken },
        extraHeaders: { Authorization: `Bearer ${authToken}` },
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        // Force a fresh handshake — don't reuse a stale session if the
        // user just signed in with a new identity.
        forceNew: true,
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        if (cancelled) return;
        setIsConnected(true);
        setLastSocketError(null);
        emit("socket-status", "connected");
      });

      socket.on("disconnect", (reason) => {
        if (cancelled) return;
        setIsConnected(false);
        emit("socket-status", "disconnected");
        // socket.io itself logs the reason; surface only to local state
        // if it's a non-trivial disconnect.
        if (reason !== "io client disconnect") {
          // No-op: reconnection is automatic. Don't spam socket-error
          // here or the ConnectionIssueModal will flash on every
          // momentary network blip.
        }
      });

      socket.on("connect_error", (err) => {
        if (cancelled) return;
        const message =
          (err as { message?: string } | null)?.message ?? String(err);
        setLastSocketError(message);
        emit("socket-error", message);
      });

      socket.on("connected", (payload: ConnectedPayload) => {
        if (cancelled) return;
        setIsConnected(true);
        setLastSocketError(null);
        setActiveMeetings(payload.meetings ?? []);
        emit("socket-connected", payload);
      });

      socket.on("coaching_message", (payload: CoachingMessage) => {
        if (cancelled) return;
        setLastCoachingMessage(payload);
        emit("socket-coaching-message", payload);
      });

      socket.on("companion_data_update", (payload: CompanionDataUpdate) => {
        if (cancelled) return;
        setLastChartData(payload);
        emit("socket-companion-data", payload);
      });

      // refresh_meetings every 10s, matching the prior Rust loop. This
      // is what triggers backend-side room re-joins when a meeting
      // starts mid-session.
      refreshTimer = setInterval(() => {
        socket.emit("refresh_meetings", {});
      }, 10_000);
    };

    setup().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      setLastSocketError(message);
      emit("socket-error", message);
    });

    return () => {
      cancelled = true;
      if (refreshTimer) clearInterval(refreshTimer);
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [isPanel, authToken]);

  const sendMeetingStatus = useCallback((status: string, meetingId: number) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      console.warn("sendMeetingStatus called but socket is not connected");
      return;
    }
    socket.emit("meeting_status", { status, meeting_id: meetingId });
  }, []);

  return {
    isConnected,
    activeMeetings,
    lastCoachingMessage,
    lastChartData,
    lastSocketError,
    sendMeetingStatus,
  };
}
