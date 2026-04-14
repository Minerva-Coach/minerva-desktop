import { useState } from "react";
import { emit } from "@tauri-apps/api/event";
import type { CoachingMessage, CompanionDataUpdate } from "../../types/coaching";

const SAMPLE_MESSAGES: Omit<CoachingMessage, "user_id" | "meeting_id" | "timestamp">[] = [
  {
    text: "Great use of an open-ended question! This encourages deeper conversation.",
    message_type: "positive_reinforcement",
    priority: "normal",
    metadata: { behavior: "OE", behavior_name: "Open-ended Questions" },
  },
  {
    text: "Try paraphrasing what they just said to show you're actively listening.",
    message_type: "coaching_tip",
    priority: "normal",
    metadata: { behavior: "EEV", behavior_name: "Empathy & Validation" },
  },
  {
    text: "You've been speaking for a while. Consider pausing to let others contribute.",
    message_type: "warning",
    priority: "urgent",
    color: "orange",
    metadata: { behavior: "SS", behavior_name: "Speaking Share" },
  },
  {
    text: "Nice summary statement! Keeps everyone aligned.",
    message_type: "positive_reinforcement",
    priority: "normal",
    metadata: { behavior: "SS", behavior_name: "Summarizing" },
  },
  {
    text: "Consider acknowledging their concern before moving to the next topic.",
    message_type: "coaching_tip",
    priority: "normal",
    metadata: { behavior: "IA", behavior_name: "Inclusive Actions" },
  },
  {
    text: "Your filler word usage has increased. Try pausing instead of 'um'.",
    message_type: "priority_message",
    priority: "urgent",
    color: "yellow",
    auto_dismiss_seconds: 15,
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
        { name: "Open-ended Questions", count: Math.floor(Math.random() * 8), target: 5 },
        { name: "Empathy", count: Math.floor(Math.random() * 6), target: 4 },
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
    </div>
  );
}
