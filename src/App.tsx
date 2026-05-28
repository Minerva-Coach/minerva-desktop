import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PanelWindow } from "./components/PanelWindow";
import { OverlayWindow } from "./components/OverlayWindow";
import { IconKeyWindow } from "./components/IconKeyWindow";
import { FocusGoalsWindow } from "./components/FocusGoalsWindow";
import { AgendaWindow } from "./components/AgendaWindow";
import { CoachingWindow } from "./components/CoachingWindow";
import { UpdaterProvider } from "./contexts/updater-context";
import { applyCachedFontScale } from "./hooks/use-font-scale";

export default function App() {
  const [windowLabel, setWindowLabel] = useState<string | null>(null);

  useEffect(() => {
    setWindowLabel(getCurrentWebviewWindow().label);
    // Apply the user's last-known font scale immediately so this window
    // doesn't render at default zoom and then snap once the panel reconciles
    // with the backend. Runs in every window.
    applyCachedFontScale();
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

  if (windowLabel === "focus-goals") {
    return <FocusGoalsWindow />;
  }

  if (windowLabel === "agenda") {
    return <AgendaWindow />;
  }

  if (windowLabel === "coaching") {
    return <CoachingWindow />;
  }

  return null;
}
