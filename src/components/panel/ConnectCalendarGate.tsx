import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import type { CalendarStatus } from "../../hooks/use-calendar-status";

interface ConnectCalendarGateProps {
  status: CalendarStatus;
  onRefresh: () => void;
  onSkip: () => void;
}

/**
 * Onboarding gate shown after a meeting platform is connected, prompting the
 * user to also link Google or Microsoft calendar. Skippable — dismissing it
 * just moves on to the rest of setup, it doesn't block anything.
 */
export function ConnectCalendarGate({
  status,
  onRefresh,
  onSkip,
}: ConnectCalendarGateProps) {
  useEffect(() => {
    const id = setInterval(onRefresh, 3000);
    return () => clearInterval(id);
  }, [onRefresh]);

  const handleConnect = async (connectUrl: string | null | undefined) => {
    if (!connectUrl) return;
    if (connectUrl.startsWith("/")) {
      const apiUrl = await invoke<string>("get_api_url");
      await open(`${apiUrl}${connectUrl}`);
    } else {
      await open(connectUrl);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-2">
      <div className="space-y-1.5">
        <p className="text-xs text-gray-200 font-semibold">
          Connect your calendar
        </p>
        <p className="text-[10px] text-gray-400 leading-relaxed">
          Link Google or Microsoft calendar and Minerva auto-joins every
          meeting on it — Zoom, Teams, or Google Meet — no manual invite
          needed.
        </p>
      </div>

      <div className="w-full space-y-1.5">
        <button
          onClick={() => handleConnect(status.google.connect_url)}
          disabled={!status.google.provider_available || !status.google.connect_url}
          className="w-full px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-xs font-medium transition-colors"
          title={
            !status.google.provider_available
              ? "Pending Google's OAuth verification — available soon"
              : status.google.connect_url
                ? undefined
                : "Google Calendar isn't available yet"
          }
        >
          Connect Google Calendar
        </button>
        <button
          onClick={() => handleConnect(status.microsoft.connect_url)}
          disabled={!status.microsoft.provider_available || !status.microsoft.connect_url}
          className="w-full px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-xs font-medium transition-colors"
          title={
            !status.microsoft.provider_available
              ? "Pending verification — available soon"
              : status.microsoft.connect_url
                ? undefined
                : "Microsoft Calendar isn't available yet"
          }
        >
          Connect Microsoft Calendar
        </button>
      </div>

      <p className="text-[10px] text-gray-500 leading-relaxed">
        Finish the connection in your browser. We'll detect it and continue
        automatically.
      </p>

      <button
        onClick={onSkip}
        className="text-[10px] text-gray-500 hover:text-gray-300 underline transition-colors"
      >
        Skip for now
      </button>
    </div>
  );
}
