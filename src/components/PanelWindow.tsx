import { useEffect, useRef, useState } from "react";
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
import { PostMeetingModal } from "./panel/PostMeetingModal";
import { PasteLinkModal } from "./panel/PasteLinkModal";
import { ConnectPlatformGate } from "./panel/ConnectPlatformGate";
import { apiFetch } from "../lib/api";

export function PanelWindow() {
  const { token, isAuthenticated, loading, login, logout } = useAuth();
  const { status: updateStatus } = useUpdaterContext();
  const { isConnected, activeMeetings, lastChartData } = useSocket(token);
  const hasBotInMeeting = activeMeetings.length > 0;
  const devChartData = useDevChartData();
  // Clear stats display when the bot isn't actively coaching — otherwise the
  // previous meeting's numbers would linger visible into the next one.
  // Dev-mode simulated data still shows up so the gauges UI can be
  // developed outside of real meetings.
  const chartData = devChartData ?? (hasBotInMeeting ? lastChartData : null);
  const {
    accounts,
    loading: accountsLoading,
    hasResolved: accountsResolved,
    refresh: refreshAccounts,
  } = useConnectedAccounts(isAuthenticated);
  const hasPlatformConnected =
    accounts.zoom.connected || accounts.teams.connected;
  const { inMeeting, meetingUrl: detectedUrl } = useMeetingStatus();

  // Phase 2 host fill-in: when the cmdline-extracted URL has confno but no
  // pwd= (typically because the user joined from Zoom's own upcoming-meetings
  // tab rather than a calendar link), ask the backend to look up the
  // password-bearing join_url via Zoom's /v2/meetings API. Only works for
  // meetings the authenticated user *hosts* — Zoom 404s otherwise, which
  // cleanly falls through to the existing one-click attempt → paste-modal
  // path. See docs/planning/zoom-auto-join-url.md Phase 2.
  const [augmentedUrl, setAugmentedUrl] = useState<string | null>(null);
  const meetingUrl = augmentedUrl ?? detectedUrl;

  useEffect(() => {
    setAugmentedUrl(null);
    if (!detectedUrl || detectedUrl.includes("?pwd=")) return;
    const m = detectedUrl.match(/zoom\.us\/j\/(\d+)/);
    if (!m) return;
    const confno = m[1];

    let cancelled = false;
    apiFetch(`/api/zoom/meeting/${confno}/join-url`)
      .then(async (resp) => {
        if (cancelled || !resp.ok) return;
        const data = await resp.json().catch(() => null);
        if (cancelled) return;
        if (data?.join_url) setAugmentedUrl(data.join_url);
      })
      .catch(() => {
        // Soft failure — leave detectedUrl in place and let the existing
        // one-click attempt → paste-fallback path handle it.
      });
    return () => {
      cancelled = true;
    };
  }, [detectedUrl]);

  // Re-fetch accounts when bot becomes active (verification creates new identities)
  useEffect(() => {
    if (hasBotInMeeting) refreshAccounts();
  }, [hasBotInMeeting]);

  // When the bot joins a meeting, Zoom often transitions to full-screen
  // meeting mode which can demote always-on-top windows and occasionally
  // minimize the panel on Windows. Defensively re-assert the panel's
  // visibility on the false → true transition.
  const prevHadBot = useRef(false);
  useEffect(() => {
    if (hasBotInMeeting && !prevHadBot.current) {
      invoke("show_windows").catch(console.warn);
    }
    prevHadBot.current = hasBotInMeeting;
  }, [hasBotInMeeting]);

  // Invite state
  const [inviteStatus, setInviteStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [inviteError, setInviteError] = useState("");
  const [pastedUrl, setPastedUrl] = useState("");
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [pasteModalInitialError, setPasteModalInitialError] = useState("");

  const [showAbout, setShowAbout] = useState(false);
  const [postMeetingId, setPostMeetingId] = useState<number | null>(null);
  const [postMeetingMock, setPostMeetingMock] = useState<
    React.ComponentProps<typeof PostMeetingModal>["mockData"] | null
  >(null);

  // Open About when the tray "About" menu item fires.
  useEffect(() => {
    const unlisten = listen("show-about", () => {
      setShowAbout(true);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Dev-mode: Simulate Post-Meeting button in DevMode emits this event.
  // Only effective when DevMode is rendered (i.e. under `tauri dev`), since
  // nothing else fires this event in a release build.
  useEffect(() => {
    const unlisten = listen<typeof postMeetingMock>(
      "dev-show-post-meeting",
      (event) => {
        setPostMeetingMock(event.payload);
        setPostMeetingId(-1); // sentinel; the modal won't hit the API with mockData set
      }
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Trigger post-meeting modal when an active meeting ends. Watch
  // activeMeetings (source of truth for "bot is coaching"); when a meeting
  // drops off the list, show the post-meeting popup for that id.
  const prevActiveMeetings = useRef<number[]>([]);
  useEffect(() => {
    const prev = prevActiveMeetings.current;
    const ended = prev.find((id) => !activeMeetings.includes(id));
    if (ended !== undefined) {
      setPostMeetingId(ended);
    }
    prevActiveMeetings.current = activeMeetings;
  }, [activeMeetings]);

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

  // Single dispatch path used by the inline paste form, the one-click
  // detected-URL button, and the paste-fallback modal.
  const dispatchInvite = async (
    url: string
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const resp = await apiFetch("/api/meetings", {
        method: "POST",
        body: JSON.stringify({
          url,
          title: "Desktop App Meeting",
          manual_join: true,
        }),
      });
      if (resp.ok) return { ok: true };
      if (resp.status === 402) return { ok: false, error: "Subscription required" };
      const data = await resp.json().catch(() => ({}));
      return { ok: false, error: data.error || `Failed (${resp.status})` };
    } catch {
      return { ok: false, error: "Network error" };
    }
  };

  const handleInvite = async () => {
    const url = pastedUrl.trim();
    if (!url) return;
    setInviteStatus("sending");
    setInviteError("");
    const result = await dispatchInvite(url);
    if (result.ok) {
      setInviteStatus("sent");
      setPastedUrl("");
    } else {
      setInviteStatus("error");
      setInviteError(result.error ?? "Failed");
    }
  };

  const handleOneClickInvite = async () => {
    if (!meetingUrl) return;
    setInviteStatus("sending");
    setInviteError("");
    const result = await dispatchInvite(meetingUrl);
    if (result.ok) {
      setInviteStatus("sent");
    } else {
      // One-click failed — surface the paste-link modal with the error so
      // the user can copy the full invite link (with password) from Zoom.
      setInviteStatus("idle");
      setPasteModalInitialError(result.error ?? "Couldn't add Minerva automatically");
      setPasteModalOpen(true);
    }
  };

  const openPasteModal = () => {
    setPasteModalInitialError("");
    setPasteModalOpen(true);
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

    // Meeting detected, no bot — pick UI based on whether the Rust
    // process detector extracted a join URL from Zoom's command line.
    if (meetingUrl) {
      return (
        <div className="space-y-1.5">
          <button
            onClick={handleOneClickInvite}
            disabled={inviteStatus === "sending"}
            className="w-full px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-xs font-medium transition-colors"
          >
            {inviteStatus === "sending" ? "Adding…" : "Add Minerva to this meeting"}
          </button>
          {inviteStatus === "error" && (
            <p className="text-[10px] text-red-400">{inviteError}</p>
          )}
          <button
            onClick={openPasteModal}
            className="w-full text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            Paste a different link
          </button>
        </div>
      );
    }

    // No URL detected — fall back to inline paste field. Happens when the
    // user joined from Zoom's own upcoming-meetings tab or typed an ID
    // manually, so the launch URL never hit Zoom.exe's cmdline. Phase 2
    // will narrow this case for hosts via the Zoom OAuth API.
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
      className="relative w-full h-full bg-gray-900 text-white flex flex-col rounded-xl overflow-hidden select-none"
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

      {postMeetingId !== null && !showAbout && (
        <PostMeetingModal
          meetingId={postMeetingId}
          mockData={postMeetingMock ?? undefined}
          onClose={() => {
            setPostMeetingId(null);
            setPostMeetingMock(null);
          }}
        />
      )}

      {pasteModalOpen && !showAbout && postMeetingId === null && (
        <PasteLinkModal
          initialError={pasteModalInitialError || undefined}
          onSubmit={dispatchInvite}
          onSent={() => setInviteStatus("sent")}
          onClose={() => {
            setPasteModalOpen(false);
            setPasteModalInitialError("");
          }}
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
        ) : !accountsResolved ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <p className="text-[10px] text-gray-500">Loading your account…</p>
          </div>
        ) : !hasPlatformConnected ? (
          <ConnectPlatformGate
            accounts={accounts}
            onRefresh={refreshAccounts}
          />
        ) : (
          <>
            <AccountStatus
              accounts={accounts}
              loading={accountsLoading}
              onRefresh={refreshAccounts}
            />
            {renderMeetingSection()}
            <Gauges chartData={chartData} hasBotInMeeting={hasBotInMeeting} />
            {import.meta.env.DEV && <DevMode />}
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
