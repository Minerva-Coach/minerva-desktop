import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PanelWindow } from "./components/PanelWindow";
import { OverlayWindow } from "./components/OverlayWindow";

export default function App() {
  const [windowLabel, setWindowLabel] = useState<string | null>(null);

  useEffect(() => {
    const label = getCurrentWebviewWindow().label;
    setWindowLabel(label);
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
