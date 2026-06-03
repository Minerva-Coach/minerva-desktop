import { useState } from "react";
import { emit } from "@tauri-apps/api/event";
import type { CoachingMessage, CompanionDataUpdate } from "../../types/coaching";

const SAMPLE_POST_MEETING = {
  advice:
    "You asked great open-ended questions early in the meeting, which helped the other person feel heard. Watch for times when you summarize before they've finished a thought — a brief pause would let them land their point before you recap. For your next one-on-one, try one summarizing statement near each topic transition rather than mid-answer.",
  actionItems: [
    { description: "Send the updated project brief to the team by EOD Friday", assignee: "Alex" },
    { description: "Schedule a follow-up review for the Q3 roadmap", assignee: "Test Zoom" },
    { description: "Share the retro notes in the #eng channel" },
  ],
  decisions: [
    { summary: "Move the launch to the second week of May", participants: ["Alex", "Test Zoom"] },
    { summary: "Adopt RFC-driven planning for all new features", participants: ["Test Zoom"] },
  ],
};

const SAMPLE_MESSAGES: Omit<CoachingMessage, "user_id" | "meeting_id" | "timestamp">[] = [
  // Praise — one per core behavior
  {
    text: "Great open-ended question — keep digging.",
    message_type: "positive_reinforcement",
    priority: "normal",
    metadata: { behavior: "OE", behavior_name: "Open-ended Questions" },
  },
  {
    text: "Nice empathy move there.",
    message_type: "positive_reinforcement",
    priority: "normal",
    metadata: { behavior: "EEV", behavior_name: "Exploring Emotions or Values" },
  },
  {
    text: "Good summary — that kept everyone aligned.",
    message_type: "positive_reinforcement",
    priority: "normal",
    metadata: { behavior: "SS", behavior_name: "Summarizing" },
  },
  {
    text: "Nice framing of your intent.",
    message_type: "positive_reinforcement",
    priority: "normal",
    metadata: { behavior: "IA", behavior_name: "Intent Alignment" },
  },
  // Suggestions — one per core behavior
  {
    text: "This might be a good time for an open-ended question.",
    message_type: "coaching_tip",
    priority: "normal",
    metadata: {
      behavior: "OE",
      behavior_name: "Open-ended Questions",
      suggestion_type: "behavior_not_used",
    },
  },
  {
    text: "Consider exploring how they're feeling about this.",
    message_type: "coaching_tip",
    priority: "normal",
    metadata: {
      behavior: "EEV",
      behavior_name: "Exploring Emotions or Values",
      suggestion_type: "behavior_not_used",
    },
  },
  {
    text: "Try paraphrasing what they just said.",
    message_type: "coaching_tip",
    priority: "normal",
    metadata: {
      behavior: "SS",
      behavior_name: "Summarizing",
      suggestion_type: "behavior_not_used",
    },
  },
  {
    text: "Name your intent before the next topic shift.",
    message_type: "coaching_tip",
    priority: "normal",
    metadata: {
      behavior: "IA",
      behavior_name: "Intent Alignment",
      suggestion_type: "behavior_not_used",
    },
  },
  // Warnings — one per warning type
  {
    text: "Your filler word usage has climbed — try pausing instead.",
    message_type: "priority_message",
    priority: "normal",
    metadata: { warning_type: "filler_words" },
  },
  {
    text: "You're speaking pretty fast — ease off and breathe.",
    message_type: "coaching_tip",
    priority: "normal",
    metadata: { warning_type: "speaking_speed" },
  },
  {
    text: "You've been doing most of the talking — make space for others.",
    message_type: "priority_message",
    priority: "normal",
    metadata: { warning_type: "talk_time_excessive" },
  },
  {
    text: "You've been quiet — consider jumping in.",
    message_type: "priority_message",
    priority: "low",
    metadata: { warning_type: "talk_time_insufficient" },
  },
];

function randomChartData(): CompanionDataUpdate {
  const me = 0.2 + Math.random() * 0.5;
  const others = (1 - me) * (0.4 + Math.random() * 0.4);
  const silence = 1 - me - others;
  return {
    meeting_id: 1,
    data: {
      talk_time: { me, others, silence },
      behaviors: [
        { name: "Open-ended Questions", count: Math.floor(Math.random() * 8), target: 5, scaled_target: 5 },
        { name: "Empathy", count: Math.floor(Math.random() * 6), target: 4, scaled_target: 4 },
      ],
      filler_words: {
        fraction: Math.random() * 0.08,
        top_2: ["um", "like"].slice(0, 1 + Math.floor(Math.random() * 2)),
      },
      focus_goals: [],
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Dev mode panel for testing coaching icons and gauge updates.
 * Sends fake events via Tauri event system (picked up by overlay window).
 */
export function DevMode() {
  const [enabled, setEnabled] = useState(false);
  const [intervalId, setIntervalId] = useState<ReturnType<typeof setInterval> | null>(null);
  let msgIndex = 0;

  const sendFakeMessage = async () => {
    const sample = SAMPLE_MESSAGES[msgIndex % SAMPLE_MESSAGES.length];
    msgIndex++;

    const message: CoachingMessage = {
      ...sample,
      user_id: 1,
      meeting_id: 1,
      timestamp: new Date().toISOString(),
    };

    // Emit via Tauri event system so both windows receive it
    await emit("dev-coaching-message", message);
    await emit("dev-chart-update", randomChartData());
  };

  const toggleDevMode = () => {
    if (enabled && intervalId) {
      clearInterval(intervalId);
      setIntervalId(null);
      setEnabled(false);
    } else {
      // Send one immediately, then every 8 seconds
      sendFakeMessage();
      const id = setInterval(sendFakeMessage, 8000);
      setIntervalId(id);
      setEnabled(true);
    }
  };

  return (
    <div className="border-t border-gray-700 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-600">Dev Mode</span>
        <button
          onClick={toggleDevMode}
          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
            enabled
              ? "bg-red-600 hover:bg-red-500 text-white"
              : "bg-gray-700 hover:bg-gray-600 text-gray-300"
          }`}
        >
          {enabled ? "Stop" : "Simulate"}
        </button>
      </div>
      {enabled && (
        <div className="mt-1 flex gap-1">
          <button
            onClick={sendFakeMessage}
            className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-[10px] text-gray-300 transition-colors"
          >
            Send Message
          </button>
        </div>
      )}
      <div className="mt-1 flex gap-1">
        <button
          onClick={() =>
            emit("dev-show-post-meeting", SAMPLE_POST_MEETING).catch(console.warn)
          }
          className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-[10px] text-gray-300 transition-colors"
        >
          Simulate Post-Meeting
        </button>
      </div>
      <div className="mt-1 flex gap-1 flex-wrap">
        <button
          onClick={() =>
            emit("meeting-started", {
              meeting_url: "https://zoom.us/j/1234567890?pwd=devmodepassword",
            }).catch(console.warn)
          }
          className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-[10px] text-gray-300 transition-colors"
          title="Fire meeting-started with a full URL (one-click button path)"
        >
          Sim Meeting (URL)
        </button>
        <button
          onClick={() =>
            emit("meeting-started", { meeting_url: null }).catch(console.warn)
          }
          className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-[10px] text-gray-300 transition-colors"
          title="Fire meeting-started with no URL (paste-fallback path)"
        >
          Sim Meeting (no URL)
        </button>
        <button
          onClick={() => emit("meeting-stopped").catch(console.warn)}
          className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-[10px] text-gray-300 transition-colors"
          title="Fire meeting-stopped"
        >
          Sim End
        </button>
      </div>
    </div>
  );
}
