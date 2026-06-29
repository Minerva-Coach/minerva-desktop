import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdaterStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date"; checkedAt: number }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; downloaded: number; total: number }
  | { kind: "installing"; version: string }
  | { kind: "error"; message: string };

/**
 * Downgrade-protection floor. The updater refuses any update whose
 * `version` field is below this — defends against an attacker with
 * momentary release-repo write access re-pointing latest.json at an
 * older validly-signed bundle (P1-E). Bump in lockstep with the
 * shipping version whenever a release introduces security-critical
 * changes, so a previously-shipped binary can no longer be installed
 * via auto-update.
 */
const MIN_ACCEPTED_VERSION = "0.1.9";

/**
 * Compare two semver strings (major.minor.patch[-pre]). Returns:
 *   <0 if a < b, 0 if equal, >0 if a > b.
 * Pre-release suffixes are compared lexicographically; absence of a
 * suffix is treated as higher than any suffix (per semver §11.4).
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string): { nums: number[]; pre: string } => {
    const [core, pre = ""] = v.split("-", 2);
    const nums = core.split(".").map((s) => Number.parseInt(s, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums, pre };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === "") return 1; // release > any prerelease
  if (pb.pre === "") return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

interface UseUpdaterOptions {
  /** Run a check once on mount. Defaults to true so the panel's startup
   *  check still fires; pass false for an About-modal-only usage. */
  checkOnMount?: boolean;
  /** When true, a successful check that finds an update immediately starts
   *  download + install. When false, just reports "available" and waits for
   *  the caller to invoke `installAvailable`. */
  autoInstall?: boolean;
}

/**
 * After this many consecutive failed update checks (network down,
 * exception, downgrade rejected) we surface `isStuck=true` so the UI
 * can render a banner. Tracks within the lifetime of the React process;
 * a successful check resets the counter (P2-G).
 */
const STUCK_AFTER_FAILURES = 3;

export function useUpdater({
  checkOnMount = true,
  autoInstall = true,
}: UseUpdaterOptions = {}) {
  const [status, setStatus] = useState<UpdaterStatus>({ kind: "idle" });
  const [failureCount, setFailureCount] = useState(0);
  const pendingUpdate = useRef<Update | null>(null);
  const isStuck = failureCount >= STUCK_AFTER_FAILURES;

  const runInstall = useCallback(async (update: Update) => {
    setStatus({ kind: "downloading", version: update.version, downloaded: 0, total: 0 });
    let downloaded = 0;
    let total = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          setStatus({ kind: "downloading", version: update.version, downloaded: 0, total });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setStatus({ kind: "downloading", version: update.version, downloaded, total });
        } else if (event.event === "Finished") {
          setStatus({ kind: "installing", version: update.version });
        }
      });
      localStorage.setItem(
        "minerva_release_notes_pending",
        JSON.stringify({ version: update.version, body: update.body ?? "" })
      );
      await relaunch();
    } catch (err) {
      setStatus({ kind: "error", message: String(err) });
      setFailureCount((c) => c + 1);
    }
  }, []);

  const checkNow = useCallback(async () => {
    setStatus({ kind: "checking" });
    try {
      const update = await check();
      if (!update) {
        setStatus({ kind: "up-to-date", checkedAt: Date.now() });
        setFailureCount(0);
        return;
      }
      // Reject downgrades. Tauri's check() already refuses updates whose
      // version is below the *currently installed* version, but it trusts
      // the manifest. MIN_ACCEPTED_VERSION is a separately-baked floor,
      // so an attacker with manifest write access can't quietly walk the
      // user back to a known-vulnerable binary.
      if (compareSemver(update.version, MIN_ACCEPTED_VERSION) < 0) {
        setStatus({
          kind: "error",
          message: `Refused update ${update.version} below floor ${MIN_ACCEPTED_VERSION}`,
        });
        setFailureCount((c) => c + 1);
        return;
      }
      pendingUpdate.current = update;
      setFailureCount(0);
      if (autoInstall) {
        await runInstall(update);
      } else {
        setStatus({ kind: "available", version: update.version });
      }
    } catch (err) {
      setStatus({ kind: "error", message: String(err) });
      setFailureCount((c) => c + 1);
    }
  }, [autoInstall, runInstall]);

  const installAvailable = useCallback(async () => {
    const update = pendingUpdate.current;
    if (!update) return;
    await runInstall(update);
  }, [runInstall]);

  useEffect(() => {
    if (checkOnMount) {
      void checkNow();
    }
  }, [checkOnMount, checkNow]);

  return { status, checkNow, installAvailable, failureCount, isStuck };
}
