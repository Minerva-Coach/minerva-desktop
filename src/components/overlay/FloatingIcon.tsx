import type { CoachingMessage } from "../../types/coaching";
import {
  findBehavior,
  SUGGESTION_PREFIX,
  WARNING_ICONS,
} from "../../constants/behaviors";

interface FloatingIconProps {
  message: CoachingMessage;
}

/**
 * Pick an emoji for a coaching message from the fixed Icon Key vocabulary.
 *
 *   praise       (positive_reinforcement + behavior) → behavior emoji alone
 *   suggestion   (coaching_tip + behavior_not_used)  → ⏰ + behavior emoji
 *   warning      (warning_type in metadata)          → WARNING_ICONS[type]
 *
 * Returns null for messages that don't fit any known category so we don't
 * spam the overlay with icons that aren't documented in the Icon Key.
 */
function getEmoji(message: CoachingMessage): string | null {
  const md = message.metadata ?? {};
  const warningType = typeof md.warning_type === "string" ? md.warning_type : null;
  if (warningType && WARNING_ICONS[warningType]) {
    return WARNING_ICONS[warningType].emoji;
  }

  const behaviorHint =
    typeof md.behavior === "string"
      ? md.behavior
      : typeof md.behavior_name === "string"
        ? md.behavior_name
        : null;
  const behavior = behaviorHint ? findBehavior(behaviorHint) : null;

  if (message.message_type === "positive_reinforcement" && behavior) {
    return behavior.emoji;
  }
  if (message.message_type === "coaching_tip" && behavior) {
    // Suggestions ("behavior_not_used") use the paired prefix; anything
    // else with message_type=coaching_tip+behavior is treated the same
    // because behavior_analyzer currently only emits the one subtype.
    return `${SUGGESTION_PREFIX}${behavior.emoji}`;
  }

  return null;
}

/**
 * A single coaching icon that floats upward and fades out.
 *
 * - Spawns at the bottom of the overlay strip
 * - Floats upward over ~3.5 seconds
 * - Fades out below the BehaviorStations row so praise floaters (which
 *   share emojis with the station icons) don't merge into the static row
 * - No label — the Icon Key window documents what each emoji means.
 */
export function FloatingIcon({ message }: FloatingIconProps) {
  const emoji = getEmoji(message);
  if (!emoji) return null;

  // Anchor at the horizontal center with a small symmetric jitter so icons
  // stay clustered in the middle. We center via translateX(-50%) rather than
  // a left-edge offset so the icon's own width (a suggestion is ⏰ + emoji,
  // ~2x wider than a bare praise emoji) can't push it past the clipped window
  // edge. ±40px keeps even the widest icon well inside the 340px window.
  const xJitter = (Math.random() - 0.5) * 80;

  // Outer wrapper owns horizontal placement (translateX); the inner element
  // owns the float-up animation (which animates translateY). They must be
  // separate elements — a single element can only hold one `transform`, and
  // the keyframe's translateY would overwrite an inline translateX.
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: "50%",
        bottom: "0px",
        transform: `translateX(calc(-50% + ${xJitter}px))`,
      }}
    >
      <div className="animate-float-up">
        <span className="text-3xl drop-shadow-lg leading-none whitespace-nowrap">
          {emoji}
        </span>
      </div>
    </div>
  );
}
