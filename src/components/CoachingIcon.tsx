import { useCallback, useEffect } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { CoachingMessage } from "../types/coaching";

interface CoachingIconProps {
  message: CoachingMessage;
  isVisible: boolean;
  onDismiss: () => void;
}

/** Map message_type to an emoji. */
function getEmoji(type: CoachingMessage["message_type"]): string {
  switch (type) {
    case "coaching_tip":
      return "\u{1F4A1}"; // light bulb
    case "positive_reinforcement":
      return "\u{2B50}"; // star
    case "warning":
      return "\u{26A0}\u{FE0F}"; // warning sign
    case "summary":
      return "\u{1F4CB}"; // clipboard
    case "insight":
      return "\u{1F50D}"; // magnifying glass
    case "question":
      return "\u{2753}"; // question mark
    case "onboarding":
      return "\u{1F44B}"; // waving hand
    case "priority_message":
      return "\u{1F6A8}"; // rotating light
    default:
      return "\u{1F4AC}"; // speech bubble
  }
}

/** Get border color for priority messages. */
function getBorderColor(color?: CoachingMessage["color"]): string {
  switch (color) {
    case "red":
      return "border-red-500";
    case "orange":
      return "border-orange-500";
    case "yellow":
      return "border-yellow-500";
    case "blue":
      return "border-blue-500";
    default:
      return "border-white/30";
  }
}

/**
 * Animated coaching icon that appears when a coaching message arrives.
 *
 * - Fades in with a scale animation
 * - Shows emoji based on message type
 * - On hover: disables click-through, shows tooltip with message text
 * - On mouse leave: re-enables click-through
 * - Auto-dismisses after configured time
 */
export function CoachingIcon({
  message,
  isVisible,
  onDismiss,
}: CoachingIconProps) {
  const emoji = getEmoji(message.message_type);
  const borderColor = getBorderColor(message.color);

  const handleMouseEnter = useCallback(async () => {
    try {
      const window = getCurrentWebviewWindow();
      await window.setIgnoreCursorEvents(false);
    } catch {
      // Ignore errors in dev mode
    }
  }, []);

  const handleMouseLeave = useCallback(async () => {
    try {
      const window = getCurrentWebviewWindow();
      await window.setIgnoreCursorEvents(true);
    } catch {
      // Ignore errors in dev mode
    }
  }, []);

  // Re-enable click-through on unmount
  useEffect(() => {
    return () => {
      getCurrentWebviewWindow()
        .setIgnoreCursorEvents(true)
        .catch(() => {});
    };
  }, []);

  return (
    <div
      className={`
        flex items-center justify-center
        ${isVisible ? "animate-fade-in" : "animate-fade-out"}
      `}
    >
      <button
        onClick={onDismiss}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`
          w-16 h-16 rounded-2xl
          bg-black/60 backdrop-blur-sm
          border-2 ${borderColor}
          flex items-center justify-center
          text-3xl cursor-pointer
          hover:bg-black/80 hover:scale-110
          transition-all duration-200
          shadow-lg
        `}
        title={message.text.length > 120 ? message.text.slice(0, 120) + "..." : message.text}
      >
        {emoji}
      </button>
    </div>
  );
}
