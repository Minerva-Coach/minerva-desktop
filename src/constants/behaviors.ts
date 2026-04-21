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
  /** Alternate names the backend might send (e.g. the display name itself) */
  aliases?: string[];
}

export const COMPANION_BEHAVIORS: BehaviorMeta[] = [
  {
    code: "oe",
    label: "OE",
    displayName: "Open-Ended Questions",
    emoji: "❓",
    aliases: ["open-ended questions", "open ended questions"],
  },
  {
    code: "eev",
    label: "EEV",
    displayName: "Exploring Emotions or Values",
    emoji: "💭",
    aliases: ["empathy", "exploring emotions or values"],
  },
  {
    code: "ss",
    label: "SS",
    displayName: "Summarizing Statement",
    emoji: "📝",
    aliases: ["summarizing", "summarizing statement"],
  },
  {
    code: "ia",
    label: "IA",
    displayName: "Intent Alignment",
    emoji: "🎯",
    aliases: ["intent alignment", "inclusive actions"],
  },
];

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
