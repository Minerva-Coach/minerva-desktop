import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PanelWindow } from "./components/PanelWindow";
import { OverlayWindow } from "./components/OverlayWindow";
import { IconKeyWindow } from "./components/IconKeyWindow";
import { UpdaterProvider } from "./contexts/updater-context";

export default function App() {
  const [windowLabel, setWindowLabel] = useState<string | null>(null);

  useEffect(() => {
    setWindowLabel(getCurrentWebviewWindow().label);
  }, []);

  if (!windowLabel) return null;

  if (windowLabel === "panel") {
    // Only the panel owns the updater — overlay doesn't need it and running
    // both would double-fire the startup check.
    return (
      <UpdaterProvider>
        <PanelWindow />
      </UpdaterProvider>
    );
  }

  if (windowLabel === "overlay") {
    return <OverlayWindow />;
  }

  if (windowLabel === "icon-key") {
    return <IconKeyWindow />;
  }

  return null;
}
