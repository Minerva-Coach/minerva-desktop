/**
 * Static rotating coaching tips shown in the panel when the user isn't
 * actively in a meeting. Refreshed by bumping this file in new releases,
 * rather than fetching from the backend, so the panel stays cheap to
 * render and doesn't need a live connection to be useful.
 */

export interface CoachingTip {
  emoji: string;
  title: string;
  body: string;
}

export const COACHING_TIPS: CoachingTip[] = [
  {
    emoji: "❓",
    title: "Ask one more open question",
    body: "Open-ended questions — 'what led to that?', 'how did that land?' — invite stories, not single-word answers.",
  },
  {
    emoji: "⏸",
    title: "Pause before responding",
    body: "A beat of silence after someone finishes often makes them add the most important part.",
  },
  {
    emoji: "📝",
    title: "Summarize at transitions",
    body: "A short recap before changing topics keeps everyone aligned and surfaces disagreements early.",
  },
  {
    emoji: "💭",
    title: "Name the feeling",
    body: "Reflecting an emotion you notice ('sounds frustrating') usually deepens the conversation faster than questions do.",
  },
  {
    emoji: "🎯",
    title: "State the intent",
    body: "A single sentence at the top — 'I want to leave this meeting with a decision on X' — anchors the whole conversation.",
  },
  {
    emoji: "👂",
    title: "Paraphrase, don't parrot",
    body: "Repeating back what you heard in your own words proves listening and invites correction if you missed something.",
  },
  {
    emoji: "⚖️",
    title: "Notice your speaking share",
    body: "If you've been talking more than 40% in a 1:1, try an open question and actually wait.",
  },
  {
    emoji: "🔎",
    title: "Dig before judging",
    body: "When you disagree, ask 'what am I missing?' before making your counter-point.",
  },
];
