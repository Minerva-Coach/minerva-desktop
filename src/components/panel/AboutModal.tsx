import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openShell } from "@tauri-apps/plugin-shell";
import {
  enable as enableAutostart,
  disable as disableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { useUpdaterContext } from "../../contexts/updater-context";

const DASHBOARD_PROFILE_URL = "https://minervacoach.com/dashboard/profile";
const SUPPORT_EMAIL = "matt@minervacoach.com";
const THIRD_PARTY_LICENSES_URL =
  "https://github.com/Minerva-Coach/minerva-desktop/releases/latest/download/THIRD_PARTY_LICENSES.md";

interface AboutModalProps {
  onClose: () => void;
  onSignOut: () => void;
}

const OVERLAY_VISIBLE_KEY = "minerva.overlayVisible";

export function AboutModal({ onClose, onSignOut }: AboutModalProps) {
  const { status, checkNow } = useUpdaterContext();
  const [version, setVersion] = useState<string>("");
  const [autostartOn, setAutostartOn] = useState<boolean | null>(null);
  const [showUninstall, setShowUninstall] = useState(false);
  const [overlayOn, setOverlayOn] = useState<boolean>(() => {
    const saved = localStorage.getItem(OVERLAY_VISIBLE_KEY);
    return saved === null ? true : saved === "true";
  });

  useEffect(() => {
    invoke<string>("get_app_version")
      .then(setVersion)
      .catch(() => setVersion("unknown"));
    isAutostartEnabled()
      .then(setAutostartOn)
      .catch(() => setAutostartOn(null));
  }, []);

  const toggleAutostart = async () => {
    if (autostartOn === null) return;
    try {
      if (autostartOn) {
        await disableAutostart();
        setAutostartOn(false);
      } else {
        await enableAutostart();
        setAutostartOn(true);
      }
    } catch (err) {
      console.warn("autostart toggle failed:", err);
    }
  };

  const toggleOverlay = async () => {
    const next = !overlayOn;
    setOverlayOn(next);
    localStorage.setItem(OVERLAY_VISIBLE_KEY, String(next));
    try {
      await invoke("set_overlay_visible", { visible: next });
    } catch (err) {
      console.warn("overlay toggle failed:", err);
    }
  };

  const repositionOverlay = async () => {
    try {
      await invoke("start_overlay_reposition");
      onClose();
    } catch (err) {
      console.warn("reposition overlay failed:", err);
    }
  };

  const openIconKey = async () => {
    try {
      await invoke("open_icon_key");
    } catch (err) {
      console.warn("open icon key failed:", err);
    }
  };

  const formatCheckedAt = (ts: number) => {
    const now = Date.now();
    const delta = Math.round((now - ts) / 1000);
    if (delta < 60) return "just now";
    if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
    if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
    return new Date(ts).toLocaleDateString();
  };

  const updateLine = (() => {
    switch (status.kind) {
      case "checking":
        return "Checking for updates…";
      case "up-to-date":
        return `You're up to date. Last checked ${formatCheckedAt(status.checkedAt)}.`;
      case "available":
        return `Update available: v${status.version}`;
      case "downloading":
        if (status.total > 0) {
          const pct = Math.round((status.downloaded / status.total) * 100);
          return `Downloading v${status.version} — ${pct}%`;
        }
        return `Downloading v${status.version}…`;
      case "installing":
        return `Installing v${status.version}…`;
      case "error":
        return `Update check failed: ${status.message}`;
      case "idle":
      default:
        return "";
    }
  })();

  const isBusy = status.kind === "checking" || status.kind === "downloading" || status.kind === "installing";

  return (
    <div
      className="absolute inset-0 z-10 bg-gray-900 text-white flex flex-col rounded-xl overflow-hidden"
      data-no-drag
    >
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
        <span className="text-xs font-semibold tracking-wide text-gray-300">About</span>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded flex items-center justify-center text-gray-300 hover:bg-red-600 hover:text-white transition-colors text-base leading-none"
          title="Close"
          aria-label="Close about panel"
        >
          ×
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-xs [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        <div>
          <p className="text-gray-200 font-medium">Minerva Coach</p>
          <p className="text-[10px] text-gray-500">Version {version || "…"}</p>
        </div>

        <div className="space-y-1.5">
          {updateLine && (
            <p className="text-[10px] text-gray-400">{updateLine}</p>
          )}
          <button
            onClick={checkNow}
            disabled={isBusy}
            className="w-full px-2 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-[11px] font-medium transition-colors"
          >
            {isBusy ? "Working…" : "Check for updates"}
          </button>
        </div>

        <div className="flex items-center justify-between py-1">
          <span className="text-[11px] text-gray-300">Launch at login</span>
          <button
            type="button"
            onClick={toggleAutostart}
            disabled={autostartOn === null}
            className={`relative w-10 h-5 rounded-full transition-colors disabled:opacity-50 ${
              autostartOn ? "bg-blue-600" : "bg-gray-700"
            }`}
            aria-pressed={autostartOn === true}
            aria-label="Toggle launch at login"
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                autostartOn ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between py-1">
          <span className="text-[11px] text-gray-300">Show coaching overlay</span>
          <button
            type="button"
            onClick={toggleOverlay}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              overlayOn ? "bg-blue-600" : "bg-gray-700"
            }`}
            aria-pressed={overlayOn}
            aria-label="Toggle coaching overlay"
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                overlayOn ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        <button
          onClick={repositionOverlay}
          disabled={!overlayOn}
          className="w-full px-2 py-1.5 rounded bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-600 text-[11px] text-gray-200 transition-colors"
          title={overlayOn ? "Drag the overlay to a new position" : "Enable the overlay to reposition it"}
        >
          Reposition overlay
        </button>

        <button
          onClick={openIconKey}
          className="w-full px-2 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-[11px] text-gray-200 transition-colors"
          title="Open the icon key in a separate window you can leave open"
        >
          Icon key
        </button>

        <div className="pt-2 border-t border-gray-800 space-y-1.5">
          <button
            onClick={() => openShell(DASHBOARD_PROFILE_URL)}
            className="w-full text-left px-2 py-1.5 rounded hover:bg-gray-800 text-[11px] text-blue-400"
          >
            Manage connected accounts →
          </button>
          <button
            onClick={() => openShell(`mailto:${SUPPORT_EMAIL}`)}
            className="w-full text-left px-2 py-1.5 rounded hover:bg-gray-800 text-[11px] text-blue-400"
          >
            Contact support
          </button>
          <button
            onClick={() => openShell(THIRD_PARTY_LICENSES_URL)}
            className="w-full text-left px-2 py-1.5 rounded hover:bg-gray-800 text-[11px] text-blue-400"
          >
            Open source licenses
          </button>
          <button
            onClick={() => setShowUninstall((v) => !v)}
            className="w-full text-left px-2 py-1.5 rounded hover:bg-gray-800 text-[11px] text-gray-400"
          >
            {showUninstall ? "▾" : "▸"} How to uninstall
          </button>
          {showUninstall && (
            <div className="px-2 pb-2 text-[10px] text-gray-400 leading-relaxed space-y-1">
              <p>1. Sign out below so the backend deregisters this device.</p>
              <p>2. Open Windows Settings → Apps → Installed apps.</p>
              <p>3. Find "Minerva Coach" → ⋯ → Uninstall.</p>
              <p className="text-gray-500 italic">
                A stale "Minerva Coach" entry may remain in Task Manager →
                Startup tab after uninstall. You can disable it there.
              </p>
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-gray-800 space-y-1.5">
          <button
            onClick={onSignOut}
            className="w-full px-2 py-1.5 rounded bg-red-900/40 hover:bg-red-900/60 border border-red-800/60 text-[11px] text-red-200"
          >
            Sign out
          </button>
          <p className="text-[10px] text-gray-500 leading-relaxed">
            Signing out disconnects Minerva Coach on this device. Your Zoom
            and Microsoft Teams connections stay linked to your account and
            can be managed at minervacoach.com.
          </p>
        </div>
      </div>
    </div>
  );
}
