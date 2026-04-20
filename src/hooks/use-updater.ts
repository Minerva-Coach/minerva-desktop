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

interface UseUpdaterOptions {
  /** Run a check once on mount. Defaults to true so the panel's startup
   *  check still fires; pass false for an About-modal-only usage. */
  checkOnMount?: boolean;
  /** When true, a successful check that finds an update immediately starts
   *  download + install. When false, just reports "available" and waits for
   *  the caller to invoke `installAvailable`. */
  autoInstall?: boolean;
}

export function useUpdater({
  checkOnMount = true,
  autoInstall = true,
}: UseUpdaterOptions = {}) {
  const [status, setStatus] = useState<UpdaterStatus>({ kind: "idle" });
  const pendingUpdate = useRef<Update | null>(null);

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
      await relaunch();
    } catch (err) {
      setStatus({ kind: "error", message: String(err) });
    }
  }, []);

  const checkNow = useCallback(async () => {
    setStatus({ kind: "checking" });
    try {
      const update = await check();
      if (!update) {
        setStatus({ kind: "up-to-date", checkedAt: Date.now() });
        return;
      }
      pendingUpdate.current = update;
      if (autoInstall) {
        await runInstall(update);
      } else {
        setStatus({ kind: "available", version: update.version });
      }
    } catch (err) {
      setStatus({ kind: "error", message: String(err) });
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

  return { status, checkNow, installAvailable };
}
