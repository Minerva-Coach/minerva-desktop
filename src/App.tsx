import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { PanelWindow } from "./components/PanelWindow";
import { OverlayWindow } from "./components/OverlayWindow";

export default function App() {
  const [windowLabel, setWindowLabel] = useState<string | null>(null);

  useEffect(() => {
    const label = getCurrentWebviewWindow().label;
    setWindowLabel(label);

    // Check for updates once on startup. Only run in the panel window so
    // panel + overlay don't both fire a check simultaneously.
    if (label === "panel") {
      (async () => {
        try {
          const update = await check();
          if (update) {
            console.log(`Update available: ${update.version}`);
            await update.downloadAndInstall();
            await relaunch();
          }
        } catch (err) {
          console.warn("Update check failed:", err);
        }
      })();
    }
  }, []);

  if (!windowLabel) return null;

  if (windowLabel === "panel") {
    return <PanelWindow />;
  }

  if (windowLabel === "overlay") {
    return <OverlayWindow />;
  }

  return null;
}
