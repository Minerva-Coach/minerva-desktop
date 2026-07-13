/**
 * Companion-visible coaching behaviors.
 *
 * Mirrors `companion_visible=True` entries in
 * `backend/config/behavior_registry.py`. Kept in sync manually — if a new
 * behavior becomes companion-visible on the backend, add it here too.
 */

export interface BehaviorMeta {
  code: string; // lowercase, matches backend BehaviorData.name convention
  label: string; // uppercase abbreviation for compact display
  displayName: string;
  emoji: string;
  /** One-line definition surfaced in the Icon Key window. */
  definition: string;
  /** Alternate names the backend might send (e.g. the display name itself) */
  aliases?: string[];
  /** Temporarily excluded from display/flashing — e.g. the calculation
   * behind it isn't reliable yet. Still defined here so re-enabling it is a
   * one-line change. */
  hidden?: boolean;
}

export const COMPANION_BEHAVIORS: BehaviorMeta[] = [
  {
    code: "oe",
    label: "OE",
    displayName: "Open-Ended Questions",
    emoji: "❓",
    definition: "Improve conversation by digging deeper.",
    aliases: ["open-ended questions", "open ended questions"],
  },
  {
    code: "eev",
    label: "EEV",
    displayName: "Exploring Emotions or Values",
    emoji: "💭",
    definition: "Build trust by connecting deeply.",
    aliases: ["empathy", "exploring emotions or values"],
  },
  {
    code: "ss",
    label: "SS",
    displayName: "Summarizing Statement",
    emoji: "📝",
    definition: "Check for understanding by rephrasing.",
    aliases: ["summarizing", "summarizing statement"],
  },
  {
    code: "ia",
    label: "IA",
    displayName: "Intent Alignment",
    emoji: "🎯",
    definition: "Broach difficult topics by clarifying intentions.",
    aliases: ["intent alignment", "inclusive actions"],
    // Hidden for now — the underlying calculation isn't reliable yet.
    hidden: true,
  },
];

/** Behaviors shown in the Core Meeting Skills box and Icon Key. */
export const VISIBLE_COMPANION_BEHAVIORS = COMPANION_BEHAVIORS.filter(
  (b) => !b.hidden
);

/** Warning icon set. Backend emits these via `metadata.warning_type` on
 * priority_message (or coaching_tip for speaking_speed). */
export const WARNING_ICONS: Record<string, { emoji: string; label: string; definition: string }> = {
  filler_words: {
    emoji: "💬",
    label: "Filler words",
    definition: "You're using a lot of filler words (um, uh, like).",
  },
  speaking_speed: {
    emoji: "🏃",
    label: "Speaking too fast",
    definition: "Your talking pace has climbed — ease off and breathe.",
  },
  talk_time_excessive: {
    emoji: "🗣️⬆️",
    label: "Talk time high",
    definition: "You're speaking a lot relative to others — make space for them.",
  },
  talk_time_insufficient: {
    emoji: "🗣️⬇️",
    label: "Talk time low",
    definition: "You've been quiet — consider jumping in.",
  },
};

/**
 * Find a companion behavior by backend-reported name. The backend's
 * BehaviorData.name can be a lowercase code, an uppercase abbreviation, or
 * (in dev-mode simulated data) a human display name. Match defensively.
 */
export function findBehavior(name: string): BehaviorMeta | undefined {
  const n = name.trim().toLowerCase();
  return COMPANION_BEHAVIORS.find(
    (b) =>
      b.code === n ||
      b.label.toLowerCase() === n ||
      b.displayName.toLowerCase() === n ||
      (b.aliases?.some((a) => a.toLowerCase() === n) ?? false)
  );
}
