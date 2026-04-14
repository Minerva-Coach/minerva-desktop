import { useEffect } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

interface OverlayProps {
  children: React.ReactNode;
  /** When true, the window passes through all mouse events. */
  clickThrough: boolean;
}

/**
 * Root transparent overlay container.
 *
 * Click-through is controlled by the parent (App) based on whether
 * interactive content (AuthPrompt, hovered CoachingIcon) is showing.
 */
export function Overlay({ children, clickThrough }: OverlayProps) {
  useEffect(() => {
    getCurrentWebviewWindow()
      .setIgnoreCursorEvents(clickThrough)
      .catch(() => {});
  }, [clickThrough]);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center relative">
      {children}
    </div>
  );
}
