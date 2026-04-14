interface StatusIndicatorProps {
  connected: boolean;
  inMeeting: boolean;
}

/**
 * Tiny colored dot showing connection and meeting status.
 *
 * - Green: connected to backend + in active Zoom meeting
 * - Yellow: connected but no active meeting
 * - Red: disconnected from backend
 */
export function StatusIndicator({ connected, inMeeting }: StatusIndicatorProps) {
  const color = !connected
    ? "bg-red-500"
    : inMeeting
      ? "bg-green-500"
      : "bg-yellow-500";

  const title = !connected
    ? "Disconnected"
    : inMeeting
      ? "In meeting"
      : "Connected";

  return (
    <div className="absolute bottom-2 right-2" title={title}>
      <div
        className={`w-3 h-3 rounded-full ${color} ${connected ? "animate-pulse-dot" : ""}`}
      />
    </div>
  );
}
