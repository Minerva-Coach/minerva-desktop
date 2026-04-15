import { useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "../hooks/use-auth";
import { useSocket } from "../hooks/use-socket";
import { useDevChartData } from "../hooks/use-dev-events";
import { useConnectedAccounts } from "../hooks/use-connected-accounts";
import { useMeetingStatus } from "../hooks/use-meeting-status";
import { AccountStatus } from "./panel/AccountStatus";
import { Gauges } from "./panel/Gauges";
import { DevMode } from "./panel/DevMode";
import { apiFetch } from "../lib/api";

export function PanelWindow() {
  const { token, isAuthenticated, loading, login } = useAuth();
  const { isConnected, activeMeetings, lastChartData } = useSocket(token);
  const hasBotInMeeting = activeMeetings.length > 0;
  const devChartData = useDevChartData();
  const chartData = devChartData ?? lastChartData;
  const { accounts, loading: accountsLoading, refresh: refreshAccounts } =
    useConnectedAccounts(isAuthenticated);
  const { inMeeting, meetingUrl } = useMeetingStatus();

  // Invite state
  const [inviteStatus, setInviteStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [inviteError, setInviteError] = useState("");

  const handleInvite = async () => {
    if (!meetingUrl) return;
    setInviteStatus("sending");
    setInviteError("");

    try {
      const resp = await apiFetch("/api/meetings", {
        method: "POST",
        body: JSON.stringify({
          url: meetingUrl,
          title: "Desktop App Meeting",
          manual_join: true,
        }),
      });

      if (resp.ok) {
        setInviteStatus("sent");
      } else if (resp.status === 402) {
        setInviteStatus("error");
        setInviteError("Subscription required");
      } else {
        const data = await resp.json().catch(() => ({}));
        setInviteStatus("error");
        setInviteError(data.error || `Failed (${resp.status})`);
      }
    } catch {
      setInviteStatus("error");
      setInviteError("Network error");
    }
  };

  const handleHide = async () => {
    await invoke("hide_windows");
  };

  const handleDrag = async (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    await getCurrentWebviewWindow().startDragging();
  };

  if (loading) {
    return (
      <div className="w-full h-full bg-gray-900 text-white flex items-center justify-center rounded-xl">
        <span className="text-sm text-gray-400">Loading...</span>
      </div>
    );
  }

  // Determine what to show in the meeting section
  const renderMeetingSection = () => {
    if (!inMeeting) return null;

    // Bot is active — show live status
    if (hasBotInMeeting) {
      return (
        <div className="py-2 px-2 rounded bg-green-900/20 border border-green-800/30">
          <p className="text-[10px] text-green-300 font-medium">
            Minerva is coaching this meeting
          </p>
        </div>
      );
    }

    // Bot was just invited — waiting for it to join
    if (inviteStatus === "sent") {
      return (
        <div className="py-2 px-2 rounded bg-blue-900/20 border border-blue-800/30">
          <p className="text-[10px] text-blue-300">
            Minerva is joining your meeting...
          </p>
        </div>
      );
    }

    // Meeting detected, no bot — offer one-click invite
    if (meetingUrl) {
      return (
        <div className="space-y-1.5">
          <button
            onClick={handleInvite}
            disabled={inviteStatus === "sending"}
            className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-xs font-medium transition-colors"
          >
            {inviteStatus === "sending"
              ? "Inviting..."
              : "Invite Minerva to this meeting"}
          </button>
          {inviteStatus === "error" && (
            <p className="text-[10px] text-red-400">{inviteError}</p>
          )}
        </div>
      );
    }

    // Meeting detected but couldn't extract URL
    return (
      <p className="text-[10px] text-gray-500 italic">
        Meeting detected — paste the invite link to add Minerva
      </p>
    );
  };

  return (
    <div
      className="w-full h-full bg-gray-900 text-white flex flex-col rounded-xl overflow-hidden select-none"
      onMouseDown={handleDrag}
    >
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
        <span className="text-xs font-semibold tracking-wide text-gray-300">
          Minerva Coach
        </span>
        <div className="flex gap-1" data-no-drag>
          <button
            onClick={handleHide}
            className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:bg-gray-600 hover:text-white transition-colors text-xs"
            title="Hide Minerva"
          >
            _
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3" data-no-drag>
        {!isAuthenticated ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <p className="text-xs text-gray-300 font-medium">
              Connect your Minerva account
            </p>
            <p className="text-[10px] text-gray-500 leading-relaxed px-2">
              Sign in to link your meetings and receive real-time coaching
              feedback.
            </p>
            <button
              onClick={login}
              className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
            >
              Sign in to Minerva
            </button>
          </div>
        ) : (
          <>
            <AccountStatus
              accounts={accounts}
              loading={accountsLoading}
              onRefresh={refreshAccounts}
            />
            {renderMeetingSection()}
            <Gauges chartData={chartData} />
            <DevMode />
          </>
        )}
      </div>

      {/* Status bar */}
      <div className="px-3 py-1 bg-gray-800 border-t border-gray-700 flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${
            !isAuthenticated
              ? "bg-gray-600"
              : isConnected
                ? "bg-green-500"
                : "bg-red-500"
          }`}
        />
        <span className="text-[10px] text-gray-500">
          {!isAuthenticated
            ? "Not signed in"
            : isConnected
              ? "Connected"
              : "Disconnected"}
        </span>
      </div>
    </div>
  );
}
