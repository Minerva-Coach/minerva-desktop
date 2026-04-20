import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAuth } from "../hooks/use-auth";
import { useSocket } from "../hooks/use-socket";
import { useDevChartData } from "../hooks/use-dev-events";
import { useConnectedAccounts } from "../hooks/use-connected-accounts";
import { useMeetingStatus } from "../hooks/use-meeting-status";
import { useUpdaterContext } from "../contexts/updater-context";
import { AccountStatus } from "./panel/AccountStatus";
import { Gauges } from "./panel/Gauges";
import { DevMode } from "./panel/DevMode";
import { AboutModal } from "./panel/AboutModal";
import { apiFetch } from "../lib/api";

export function PanelWindow() {
  const { token, isAuthenticated, loading, login, logout } = useAuth();
  const { status: updateStatus } = useUpdaterContext();
  const { isConnected, activeMeetings, lastChartData } = useSocket(token);
  const hasBotInMeeting = activeMeetings.length > 0;
  const devChartData = useDevChartData();
  const chartData = devChartData ?? lastChartData;
  const { accounts, loading: accountsLoading, refresh: refreshAccounts } =
    useConnectedAccounts(isAuthenticated);
  const { inMeeting } = useMeetingStatus();

  // Re-fetch accounts when bot becomes active (verification creates new identities)
  useEffect(() => {
    if (hasBotInMeeting) refreshAccounts();
  }, [hasBotInMeeting]);

  // Invite state
  const [inviteStatus, setInviteStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [inviteError, setInviteError] = useState("");
  const [pastedUrl, setPastedUrl] = useState("");

  const [showAbout, setShowAbout] = useState(false);

  // Open About when the tray "About" menu item fires.
  useEffect(() => {
    const unlisten = listen("show-about", () => {
      setShowAbout(true);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleSignOut = async () => {
    await logout();
    setShowAbout(false);
  };

  // Meeting status ("How's it going?") — mirrors the companion app feature.
  type MeetingVibe = "going_well" | "neutral" | "struggling";
  const [meetingVibe, setMeetingVibe] = useState<MeetingVibe | null>(null);
  const activeMeetingId = activeMeetings[0];

  // Reset vibe when the meeting ends.
  useEffect(() => {
    if (!hasBotInMeeting) setMeetingVibe(null);
  }, [hasBotInMeeting]);

  const handleVibeChange = async (vibe: MeetingVibe) => {
    setMeetingVibe(vibe);
    if (!activeMeetingId) return;
    try {
      await invoke("send_meeting_status", {
        status: vibe,
        meetingId: activeMeetingId,
      });
    } catch (err) {
      console.warn("send_meeting_status failed:", err);
    }
  };

  const handleInvite = async () => {
    const url = pastedUrl.trim();
    if (!url) return;
    setInviteStatus("sending");
    setInviteError("");

    try {
      const resp = await apiFetch("/api/meetings", {
        method: "POST",
        body: JSON.stringify({
          url,
          title: "Desktop App Meeting",
          manual_join: true,
        }),
      });

      if (resp.ok) {
        setInviteStatus("sent");
        setPastedUrl("");
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

    // Bot is active — show live status + "How's it going?" feedback
    if (hasBotInMeeting) {
      const vibes: { value: MeetingVibe; emoji: string; label: string }[] = [
        { value: "going_well", emoji: "😊", label: "Going well" },
        { value: "neutral", emoji: "😐", label: "Neutral" },
        { value: "struggling", emoji: "😟", label: "Struggling" },
      ];
      return (
        <div className="space-y-2">
          <div className="py-2 px-2 rounded bg-green-900/20 border border-green-800/30">
            <p className="text-[10px] text-green-300 font-medium">
              Minerva is coaching this meeting
            </p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-gray-400">How's it going?</span>
            <div className="flex gap-1">
              {vibes.map((v) => (
                <button
                  key={v.value}
                  onClick={() => handleVibeChange(v.value)}
                  title={v.label}
                  className={`w-7 h-7 rounded flex items-center justify-center text-base transition-colors ${
                    meetingVibe === v.value
                      ? "bg-blue-600 hover:bg-blue-500"
                      : "bg-gray-800 hover:bg-gray-700"
                  }`}
                >
                  {v.emoji}
                </button>
              ))}
            </div>
          </div>
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

    // Meeting detected, no bot — paste invite link
    return (
      <div className="space-y-1.5">
        <p className="text-[10px] text-gray-400">
          Paste your meeting invite link to add Minerva:
        </p>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={pastedUrl}
            onChange={(e) => setPastedUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleInvite()}
            placeholder="https://zoom.us/j/..."
            className="flex-1 px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-200 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none"
            disabled={inviteStatus === "sending"}
          />
          <button
            onClick={handleInvite}
            disabled={!pastedUrl.trim() || inviteStatus === "sending"}
            className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-xs font-medium transition-colors whitespace-nowrap"
          >
            {inviteStatus === "sending" ? "..." : "Invite"}
          </button>
        </div>
        {inviteStatus === "error" && (
          <p className="text-[10px] text-red-400">{inviteError}</p>
        )}
      </div>
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
            onClick={() => setShowAbout(true)}
            className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:bg-gray-600 hover:text-white transition-colors text-xs"
            title="About"
          >
            ⓘ
          </button>
          <button
            onClick={handleHide}
            className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:bg-gray-600 hover:text-white transition-colors text-xs"
            title="Hide Minerva"
          >
            _
          </button>
        </div>
      </div>

      {/* Update banner — visible when the updater is actively working */}
      {(updateStatus.kind === "downloading" ||
        updateStatus.kind === "installing") && (
        <div className="px-3 py-1.5 bg-blue-900/40 border-b border-blue-800/60 text-[10px] text-blue-200">
          {updateStatus.kind === "downloading"
            ? updateStatus.total > 0
              ? `Downloading v${updateStatus.version}… ${Math.round(
                  (updateStatus.downloaded / updateStatus.total) * 100
                )}%`
              : `Downloading v${updateStatus.version}…`
            : `Installing v${updateStatus.version}…`}
        </div>
      )}

      {showAbout && (
        <AboutModal
          onClose={() => setShowAbout(false)}
          onSignOut={handleSignOut}
        />
      )}

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
