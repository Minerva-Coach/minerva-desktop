import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";

type Status = "granted" | "denied" | "loading";

/**
 * Pre-everything permission gate for macOS.
 *
 * Reading other apps' window titles requires Screen Recording permission.
 * Without it, `is_in_active_meeting_macos()` always returns false, making
 * the app silently broken from the user's perspective. This component
 * walks the user through:
 *
 *   1. Firing the system dialog on first render (in-process; only ever
 *      shown the very first time per TCC identity).
 *   2. Deep-linking to System Settings if they dismissed it.
 *   3. Relaunching the app — TCC permissions are re-evaluated only on
 *      process startup, so a relaunch is required for the new grant to
 *      take effect.
 *
 * Polls status every 5 sec so users who flip the toggle and tab back
 * without restarting see the gate clear automatically (Sequoia and earlier
 * sometimes pick up the new permission without a restart, but most builds
 * still need one — the relaunch button is the predictable path).
 *
 * Renders nothing on non-macOS builds (the Rust command returns "granted"
 * unconditionally there).
 */
export function MacosPermissionGate({
  onGranted,
}: {
  onGranted: () => void;
}) {
  const [status, setStatus] = useState<Status>("loading");

  // Fire the system dialog once on first render. CGRequestScreenCaptureAccess
  // is only effective on first launch — after that, the only path to grant
  // is the open-settings deep-link below. Calling it unconditionally is
  // safe (no-op when the prompt has already been shown).
  useEffect(() => {
    invoke("macos_request_screen_recording").catch(() => {});
  }, []);

  // Poll the status. Initial check + every 5 sec.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const s = await invoke<string>("macos_screen_recording_status");
        if (cancelled) return;
        setStatus(s === "granted" ? "granted" : "denied");
        if (s === "granted") onGranted();
      } catch {
        if (!cancelled) {
          setStatus("granted");
          onGranted();
        }
      }
    };
    check();
    const id = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [onGranted]);

  const handleOpenSettings = () => {
    invoke("macos_open_screen_recording_settings").catch(() => {});
  };

  const handleRelaunch = () => {
    relaunch().catch(() => {});
  };

  if (status === "loading" || status === "granted") return null;

  return (
    <div className="flex flex-col h-full gap-3 px-1">
      <div className="space-y-1">
        <p className="text-xs text-gray-200 font-semibold">One quick step</p>
        <p className="text-[10px] text-gray-400 leading-relaxed">
          Minerva needs Screen Recording permission to detect when you're in
          a meeting. We use this only to read the Zoom window's title — we
          never capture or transmit any screen contents.
        </p>
      </div>

      <ol className="space-y-2 flex-1 text-[10px] text-gray-300 leading-relaxed">
        <li className="flex gap-2">
          <span className="text-blue-400 mt-0.5">1.</span>
          <span>
            Click <strong>Open System Settings</strong> below.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="text-blue-400 mt-0.5">2.</span>
          <span>
            Toggle <strong>Minerva Coach</strong> on under Screen Recording.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="text-blue-400 mt-0.5">3.</span>
          <span>
            Click <strong>Restart Minerva</strong>.
          </span>
        </li>
      </ol>

      <div className="space-y-1.5">
        <button
          onClick={handleOpenSettings}
          className="w-full px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 text-xs font-medium transition-colors"
        >
          Open System Settings
        </button>
        <button
          onClick={handleRelaunch}
          className="w-full px-3 py-2 rounded bg-gray-700 hover:bg-gray-600 text-xs font-medium transition-colors"
        >
          I've granted access — Restart Minerva
        </button>
      </div>
    </div>
  );
}
