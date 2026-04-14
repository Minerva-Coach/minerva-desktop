import { useState } from "react";
import type { CoachingMessage } from "../../types/coaching";

interface FloatingIconProps {
  message: CoachingMessage;
}

/** Map message_type to emoji and human-readable label. */
function getIconInfo(message: CoachingMessage): { emoji: string; label: string } {
  const behavior = message.metadata?.behavior_name;

  switch (message.message_type) {
    case "coaching_tip":
      return {
        emoji: "\u{1F4A1}",
        label: behavior ? `Tip: ${behavior}` : "Coaching Tip",
      };
    case "positive_reinforcement":
      return {
        emoji: "\u{2B50}",
        label: behavior ? `Nice ${behavior}!` : "Great job!",
      };
    case "warning":
      return {
        emoji: "\u{26A0}\u{FE0F}",
        label: behavior ? `Watch: ${behavior}` : "Heads up",
      };
    case "summary":
      return { emoji: "\u{1F4CB}", label: "Summary" };
    case "insight":
      return { emoji: "\u{1F50D}", label: "Insight" };
    case "question":
      return { emoji: "\u{2753}", label: "Question" };
    case "onboarding":
      return { emoji: "\u{1F44B}", label: "Welcome" };
    case "priority_message":
      return {
        emoji: "\u{1F6A8}",
        label: behavior ? behavior : "Priority",
      };
    default:
      return { emoji: "\u{1F4AC}", label: "Message" };
  }
}

/**
 * A single coaching icon that floats upward and fades out.
 *
 * - Spawns at the bottom of the overlay strip
 * - Floats upward over ~3.5 seconds
 * - Fades in quickly, then fades out near the top
 * - Shows tooltip with label on hover
 */
export function FloatingIcon({ message }: FloatingIconProps) {
  const { emoji, label } = getIconInfo(message);
  const [showTooltip, setShowTooltip] = useState(false);

  // Random horizontal jitter within the 80px strip
  const xOffset = 10 + Math.random() * 40;

  return (
    <div
      className="absolute animate-float-up pointer-events-auto cursor-default"
      style={{ left: `${xOffset}px`, bottom: "0px" }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="relative">
        <span className="text-3xl drop-shadow-lg">{emoji}</span>
        {showTooltip && (
          <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 whitespace-nowrap bg-black/90 text-white text-[10px] px-2 py-1 rounded shadow-lg z-50 pointer-events-none">
            {label}
          </div>
        )}
      </div>
    </div>
  );
}
