import { useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAuth } from "../hooks/use-auth";
import { useSocket } from "../hooks/use-socket";
import { useDevChartData } from "../hooks/use-dev-events";
import { useConnectedAccounts } from "../hooks/use-connected-accounts";
import { useMeetingStatus } from "../hooks/use-meeting-status";
import { useWelcomeAcknowledged } from "../hooks/use-welcome-acknowledged";
import { usePresenceError } from "../hooks/use-presence";
import { useUpdaterContext } from "../contexts/updater-context";
import { AccountStatus } from "./panel/AccountStatus";
import { Gauges } from "./panel/Gauges";
import { DevMode } from "./panel/DevMode";
import { AboutModal } from "./panel/AboutModal";
import { PostMeetingModal } from "./panel/PostMeetingModal";
import { PasteLinkModal } from "./panel/PasteLinkModal";
import { ConnectPlatformGate } from "./panel/ConnectPlatformGate";
import { MacosPermissionGate } from "./panel/MacosPermissionGate";
import { WelcomeComplete } from "./panel/WelcomeComplete";
import { ConnectionIssueModal } from "./panel/ConnectionIssueModal";
import { apiFetch } from "../lib/api";
import { findBehavior } from "../constants/behaviors";

export function PanelWindow() {
  // macOS Screen Recording permission gate — granted on non-mac builds.
  // Renders ahead of the auth flow because without it, meeting detection is
  // silently broken even after the user signs in. Once granted, this stays
  // true for the lifetime of the process.
  const [macPermissionGranted, setMacPermissionGranted] = useState(false);

  const { isAuthenticated, loading, login, logout, lastAuthError } = useAuth();
  const { status: updateStatus, isStuck: updaterStuck } = useUpdaterContext();
  const {
    isConnected,
    activeMeetings,
    lastChartData,
    lastSocketError,
    sendMeetingStatus,
  } = useSocket();
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
    error: accountsError,
    refresh: refreshAccounts,
  } = useConnectedAccounts(isAuthenticated);
  const hasPlatformConnected =
    accounts.zoom.connected || accounts.teams.connected;
  const presenceError = usePresenceError();
  const { acknowledged: welcomeAcknowledged, acknowledge: acknowledgeWelcome } =
    useWelcomeAcknowledged();
  const { inMeeting, meetingUrl: detectedUrl } = useMeetingStatus();

  // Two-tier backend fallback when the local cmdline / WMI capture didn't
  // produce a complete join URL. Both paths are host-only — Zoom 404s for
  // guests, which cleanly degrades to the paste-link modal.
  //
  //   confno but no pwd  →  /api/zoom/meeting/<id>/join-url  (Phase 2)
  //   no URL at all      →  /api/zoom/meetings/live          (Phase 4)
  //
  // Phase 4 covers the host who joins from Zoom's Upcoming-Meetings tab —
  // no `zoommtg://` URL ever hits a process cmdline, so the Rust extractor
  // returns None and the WMI subscription sees no launcher process. See
  // docs/planning/zoom-auto-join-url.md.
  const [augmentedUrl, setAugmentedUrl] = useState<string | null>(null);
  const meetingUrl = augmentedUrl ?? detectedUrl;

  useEffect(() => {
    setAugmentedUrl(null);

    // Local extraction already produced a complete URL — nothing to fetch.
    if (detectedUrl && detectedUrl.includes("?pwd=")) return;

    let cancelled = false;
    const apply = async (path: string) => {
      try {
        const resp = await apiFetch(path);
        if (cancelled || !resp.ok) return;
        const data = await resp.json().catch(() => null);
        if (cancelled) return;
        if (data?.join_url) setAugmentedUrl(data.join_url);
      } catch {
        // Soft failure — leave the existing UX in place. Errors here are
        // expected for guests (404) and offline cases (network); the
        // paste-link fallback covers both.
      }
    };

    if (detectedUrl) {
      const m = detectedUrl.match(/zoom\.us\/j\/(\d+)/);
      if (!m) return;
      apply(`/api/zoom/meeting/${m[1]}/join-url`);
    } else if (inMeeting) {
      apply(`/api/zoom/meetings/live`);
    }

    return () => {
      cancelled = true;
    };
  }, [detectedUrl, inMeeting]);

  // Re-fetch accounts when bot becomes active (verification creates new identities)
  useEffect(() => {
    if (hasBotInMeeting) refreshAccounts();
  }, [hasBotInMeeting]);

  // Re-fetch accounts when the socket transitions to connected. The
  // accounts hook only retries on isAuthenticated transitions, so a
  // transient backend hiccup at startup (cold-boot Wi-Fi association,
  // local Flask still warming up, momentary minervacoach.com blip) used
  // to leave the user stuck on a stale "Couldn't load your account"
  // view. The socket proxy already retries every 5s -- when it finally
  // connects, we now know the backend is reachable, so accounts piggybacks
  // on that signal to self-heal.
  const prevSocketConnected = useRef(false);
  useEffect(() => {
    if (isConnected && !prevSocketConnected.current) {
      refreshAccounts();
    }
    prevSocketConnected.current = isConnected;
  }, [isConnected, refreshAccounts]);

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
  // Connection Issue modal: opens automatically on a fresh sign-in failure
  // (so non-technical users see the diagnostic without hunting for it) and
  // can also be opened by clicking the Disconnected status bar.
  const [connectionIssueOpen, setConnectionIssueOpen] = useState(false);
  const prevAuthError = useRef<string | null>(null);
  useEffect(() => {
    if (lastAuthError && lastAuthError !== prevAuthError.current) {
      setConnectionIssueOpen(true);
    }
    prevAuthError.current = lastAuthError;
  }, [lastAuthError]);
  // Auto-open the modal for accounts errors, but DEFERRED by 8 seconds so
  // a transient cold-boot failure (Flask still starting, Wi-Fi not yet
  // associated, momentary minervacoach.com blip) doesn't pop a scary
  // diagnostic at the user. The socket-reconnect effect above will
  // refresh accounts as soon as the backend comes back -- if that
  // succeeds inside the 8s window, the cleanup function cancels the
  // open. If the error persists past 8s it's a real problem worth
  // surfacing. The inline "Couldn't load your account" view still
  // appears immediately for users who happen to be looking, so we don't
  // hide the failure state -- just the unprompted modal flash.
  const prevAccountsError = useRef<string | null>(null);
  useEffect(() => {
    if (!accountsError || accountsError === prevAccountsError.current) {
      prevAccountsError.current = accountsError;
      return;
    }
    prevAccountsError.current = accountsError;
    const timer = setTimeout(() => {
      setConnectionIssueOpen(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, [accountsError]);
  const [postMeetingId, setPostMeetingId] = useState<number | null>(null);
  const [postMeetingMock, setPostMeetingMock] = useState<
    React.ComponentProps<typeof PostMeetingModal>["mockData"] | null
  >(null);

  // Banner shown when the user re-launches the app while it's already
  // running. Single-instance plugin in Rust intercepts the second launch
  // and emits `second-instance-launched`; we surface that here so the user
  // realizes the app was in the tray the whole time.
  const [secondInstanceBanner, setSecondInstanceBanner] = useState(false);
  useEffect(() => {
    const unlisten = listen("second-instance-launched", () => {
      setSecondInstanceBanner(true);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
  useEffect(() => {
    if (!secondInstanceBanner) return;
    const id = setTimeout(() => setSecondInstanceBanner(false), 8000);
    return () => clearTimeout(id);
  }, [secondInstanceBanner]);

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

  // Trigger post-meeting modal when an active meeting ends, and auto-open
  // the Icon Key window for the user's first few meeting starts so new
  // users learn what the floating coaching icons mean (issue #248).
  // Watch activeMeetings — the source of truth for "bot is coaching".
  const prevActiveMeetings = useRef<number[]>([]);
  useEffect(() => {
    const prev = prevActiveMeetings.current;
    const ended = prev.find((id) => !activeMeetings.includes(id));
    if (ended !== undefined) {
      setPostMeetingId(ended);
    }
    const started = activeMeetings.find((id) => !prev.includes(id));
    if (started !== undefined) {
      (async () => {
        try {
          const should = await invoke<boolean>("should_auto_show_icon_key");
          if (!should) return;
          await invoke("open_icon_key");
          await invoke("record_icon_key_shown");
        } catch (err) {
          console.warn("auto-open icon key failed:", err);
        }
      })();
    }
    prevActiveMeetings.current = activeMeetings;
  }, [activeMeetings]);

  // Push behavior counts into the macOS tray title (and Windows tooltip) so
  // the user can glance at the meeting state without opening the panel.
  // Driven by chartData, which already gates on hasBotInMeeting — when no bot
  // is coaching, chartData is null and the tray clears (#249).
  useEffect(() => {
    const title = chartData?.data.behaviors
      .map((b) => {
        const meta = findBehavior(b.name);
        const label = meta?.label ?? b.name.toUpperCase();
        return `${label}:${b.count}`;
      })
      .join(" ") ?? "";
    invoke("update_tray_title", { title }).catch((err) => {
      console.warn("update_tray_title failed:", err);
    });
  }, [chartData]);

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

  const handleVibeChange = (vibe: MeetingVibe) => {
    setMeetingVibe(vibe);
    if (!activeMeetingId) return;
    sendMeetingStatus(vibe, activeMeetingId);
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

  // The panel is draggable from any non-interactive surface, so the user can
  // grab almost anywhere — title bar, empty content gaps, modal backgrounds.
  // Skip drag on interactive elements (buttons, inputs, links, etc.) and on
  // anything explicitly opted-out via [data-no-drag].
  const handleDrag = async (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        "button, a, input, textarea, select, label, [role='button'], [role='link'], [data-no-drag]"
      )
    ) {
      return;
    }
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

      {/* Stuck-updater banner — shown after repeated check failures so the
          user knows their install isn't auto-updating (P2-G). */}
      {updaterStuck && (
        <div className="px-3 py-1.5 bg-amber-900/40 border-b border-amber-800/60 text-[10px] text-amber-100 leading-relaxed">
          Updates aren't downloading. Check your connection or reinstall from
          minervacoach.com to get the latest version.
        </div>
      )}

      {secondInstanceBanner && (
        <div className="px-3 py-1.5 bg-amber-900/40 border-b border-amber-800/60 text-[10px] text-amber-100 flex items-start justify-between gap-2">
          <span className="leading-relaxed">
            Minerva was already running. Look for its icon in your system tray
            to open it next time.
          </span>
          <button
            onClick={() => setSecondInstanceBanner(false)}
            className="text-amber-200 hover:text-white shrink-0"
            title="Dismiss"
          >
            ×
          </button>
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

      {connectionIssueOpen && (
        <ConnectionIssueModal
          title={
            !isAuthenticated
              ? "Sign-in didn't complete"
              : "Can't reach Minerva"
          }
          description={
            !isAuthenticated
              ? "Minerva couldn't finish signing you in. The details below help support figure out why."
              : "Minerva is having trouble talking to the server. Coaching may not start in your next meeting until this reconnects. The details below help support diagnose the cause."
          }
          socketError={lastSocketError}
          authError={lastAuthError}
          accountsError={accountsError}
          presenceError={presenceError}
          showRetry={!isAuthenticated}
          onRetry={login}
          onClose={() => setConnectionIssueOpen(false)}
        />
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {!macPermissionGranted ? (
          <MacosPermissionGate
            onGranted={() => setMacPermissionGranted(true)}
          />
        ) : !isAuthenticated ? (
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
            {lastAuthError && (
              <button
                onClick={() => setConnectionIssueOpen(true)}
                className="text-[10px] text-amber-400 hover:text-amber-300 underline transition-colors"
              >
                Last sign-in failed — show details
              </button>
            )}
          </div>
        ) : !accountsResolved ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <p className="text-[10px] text-gray-500">Loading your account…</p>
          </div>
        ) : accountsError && !hasPlatformConnected ? (
          // Distinct from ConnectPlatformGate: the user might already have
          // Zoom/Teams linked — we just couldn't reach the backend to
          // confirm. Showing the "connect platform" buttons here would push
          // them into a redundant OAuth flow.
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <p className="text-xs text-gray-300 font-medium">
              Couldn't load your account
            </p>
            <p className="text-[10px] text-gray-500 leading-relaxed px-2">
              We hit an error reading your connected platforms. Your Zoom and
              Teams links on minervacoach.com are unaffected — this is just
              the desktop app failing to fetch them.
            </p>
            <div className="flex flex-col gap-1.5 w-full max-w-[200px]">
              <button
                onClick={refreshAccounts}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
              >
                Try again
              </button>
              <button
                onClick={() => setConnectionIssueOpen(true)}
                className="text-[10px] text-amber-400 hover:text-amber-300 underline transition-colors"
              >
                Show details
              </button>
            </div>
          </div>
        ) : !hasPlatformConnected ? (
          <ConnectPlatformGate
            accounts={accounts}
            onRefresh={refreshAccounts}
          />
        ) : welcomeAcknowledged === null ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <p className="text-[10px] text-gray-500">Loading…</p>
          </div>
        ) : !welcomeAcknowledged ? (
          <WelcomeComplete onAcknowledge={acknowledgeWelcome} />
        ) : (
          <>
            <AccountStatus
              accounts={accounts}
              loading={accountsLoading}
              onRefresh={refreshAccounts}
            />
            {/* Heartbeat-failure banner: only relevant in a meeting, since
                presence is what tells the backend "user is in this Zoom call"
                so Recall.ai will auto-verify them. Without it the bot may
                never join — surface that proactively instead of silently. */}
            {inMeeting && presenceError && (
              <div className="py-2 px-2 rounded bg-amber-900/30 border border-amber-800/40 flex items-start justify-between gap-2">
                <p className="text-[10px] text-amber-200 leading-relaxed">
                  Minerva can't reach the server to register you in this
                  meeting. The bot may not join.
                </p>
                <button
                  onClick={() => setConnectionIssueOpen(true)}
                  className="text-[10px] text-amber-300 hover:text-amber-100 underline shrink-0 self-start"
                >
                  Details
                </button>
              </div>
            )}
            {renderMeetingSection()}
            <Gauges chartData={chartData} hasBotInMeeting={hasBotInMeeting} />
            {import.meta.env.DEV && <DevMode />}
          </>
        )}
      </div>

      {/* Status bar — clickable when authenticated-but-disconnected so the
          user can pop the diagnostic modal without hunting for it. */}
      {(() => {
        const showAsButton = isAuthenticated && !isConnected;
        const className =
          "w-full px-3 py-1 bg-gray-800 border-t border-gray-700 flex items-center gap-2 text-left" +
          (showAsButton ? " hover:bg-gray-700 cursor-pointer transition-colors" : "");
        const dot = (
          <div
            className={`w-2 h-2 rounded-full ${
              !isAuthenticated
                ? "bg-gray-600"
                : isConnected
                  ? "bg-green-500"
                  : "bg-red-500"
            }`}
          />
        );
        const label = !isAuthenticated
          ? "Not signed in"
          : isConnected
            ? "Connected"
            : "Disconnected — click for help";
        if (showAsButton) {
          return (
            <button
              type="button"
              className={className}
              onClick={() => setConnectionIssueOpen(true)}
              data-no-drag
              title="Show connection details"
            >
              {dot}
              <span className="text-[10px] text-gray-400">{label}</span>
            </button>
          );
        }
        return (
          <div className={className}>
            {dot}
            <span className="text-[10px] text-gray-500">{label}</span>
          </div>
        );
      })()}
    </div>
  );
}
