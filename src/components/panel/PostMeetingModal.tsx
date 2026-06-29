import { useEffect, useRef, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { apiFetch } from "../../lib/api";

interface PostMeetingModalProps {
  meetingId: number;
  onClose: () => void;
  /**
   * Fired once, the first time the meeting's advice finishes processing and
   * becomes readable. The parent uses this to pop the panel back up from the
   * tray (the window hides when the meeting ends, but advice lands seconds-to-
   * minutes later). Not called for the dev mock path, the empty/timeout state,
   * or errors — only a genuine "your feedback is ready" moment.
   */
  onReady?: () => void;
  /**
   * Dev-only escape hatch — skip the API poll and render the given data
   * immediately. Used by the Simulate button in DevMode for iterating on
   * this modal without needing a real completed meeting.
   */
  mockData?: {
    advice?: string;
    actionItems?: ActionItem[];
    decisions?: Decision[];
  };
}

type AdviceState =
  | { kind: "loading" }
  | { kind: "ready"; text: string }
  | { kind: "empty" }
  | { kind: "error"; message: string };

interface ActionItem {
  description: string;
  assignee?: string | null;
}

interface Decision {
  summary: string;
  participants?: string[];
}

// Poll every 15s while the meeting_persister is still working. Advice
// generation is an LLM call that usually completes within a minute or two
// of a meeting ending, but can take longer for long meetings.
const POLL_INTERVAL_MS = 15_000;
// Stop polling after this long; user can still read advice on the dashboard.
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

// Static placeholder focus suggestions for v0.1.7. Wiring these up to the
// user's actual focus goals is a follow-up; the layout is here so beta
// users can react to the post-meeting flow end-to-end.
const SUGGESTED_FOCUS: string[] = [
  "Practice asking one more open-ended question per meeting",
  "Summarize before each major topic transition",
  "Reduce filler words when introducing yourself",
];

export function PostMeetingModal({
  meetingId,
  onClose,
  onReady,
  mockData,
}: PostMeetingModalProps) {
  const [advice, setAdvice] = useState<AdviceState>(() =>
    mockData?.advice
      ? { kind: "ready", text: mockData.advice }
      : { kind: "loading" }
  );
  const [actionItems, setActionItems] = useState<ActionItem[]>(
    mockData?.actionItems ?? []
  );
  const [decisions, setDecisions] = useState<Decision[]>(
    mockData?.decisions ?? []
  );
  const [rating, setRating] = useState<number>(3);

  // Pop the panel up from the tray the first time real advice lands. Guarded
  // by a ref so re-renders (e.g. productivity syncing on a later poll) don't
  // re-fire it. Skipped for the dev mock path — the window is already open.
  const readyFired = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    if (mockData || readyFired.current) return;
    if (advice.kind === "ready") {
      readyFired.current = true;
      onReadyRef.current?.();
    }
  }, [advice.kind, mockData]);

  useEffect(() => {
    if (mockData) return; // dev: skip polling
    let cancelled = false;
    const startedAt = Date.now();

    const poll = async () => {
      if (cancelled) return;
      try {
        const resp = await apiFetch("/api/individual_meeting", {
          method: "POST",
          body: JSON.stringify({ meeting_id: meetingId }),
        });
        if (!resp.ok) {
          // 404 usually means meeting hasn't finished persisting yet; keep trying.
          if (resp.status === 404 && Date.now() - startedAt < POLL_TIMEOUT_MS) {
            schedule();
            return;
          }
          if (!cancelled) {
            setAdvice({ kind: "error", message: `HTTP ${resp.status}` });
          }
          return;
        }
        const data = await resp.json();
        // Productivity is populated alongside advice and may land on an
        // earlier poll. Always sync it.
        const prod = data.productivity ?? {};
        if (!cancelled) {
          setActionItems(prod.action_items ?? []);
          setDecisions(prod.decisions ?? []);
        }

        const text = (data.meetingAdvice ?? "").trim();
        if (text) {
          if (!cancelled) setAdvice({ kind: "ready", text });
          return;
        }
        // Empty advice — keep polling until timeout.
        if (Date.now() - startedAt < POLL_TIMEOUT_MS) {
          schedule();
        } else if (!cancelled) {
          setAdvice({ kind: "empty" });
        }
      } catch (err) {
        if (!cancelled) {
          setAdvice({ kind: "error", message: String(err) });
        }
      }
    };

    const schedule = () => {
      if (cancelled) return;
      setTimeout(poll, POLL_INTERVAL_MS);
    };

    // Initial attempt after a short delay so the backend has a beat to
    // start persisting. Meeting just ended — advice almost never exists
    // in the first 5 seconds.
    setTimeout(poll, 3000);

    return () => {
      cancelled = true;
    };
  }, [meetingId, mockData]);

  return (
    <div className="absolute inset-0 z-10 bg-gray-900 text-white flex flex-col rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
        <span className="text-xs font-semibold tracking-wide text-gray-300">
          Post-Meeting Feedback
        </span>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded flex items-center justify-center text-gray-300 hover:bg-red-600 hover:text-white transition-colors text-base leading-none"
          title="Close"
          aria-label="Close post-meeting feedback"
        >
          ×
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-xs [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        <section>
          <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
            Advice from this meeting
          </h3>
          {advice.kind === "loading" && (
            <p className="text-[11px] text-gray-400 italic">
              Processing your feedback… this usually takes a minute or two.
            </p>
          )}
          {advice.kind === "ready" && (
            <p className="text-[11px] text-gray-200 leading-relaxed whitespace-pre-wrap">
              {advice.text}
            </p>
          )}
          {advice.kind === "empty" && (
            <p className="text-[11px] text-gray-400 italic">
              Your advice isn't ready yet. Check back on the My Meetings page
              in a few minutes.
            </p>
          )}
          {advice.kind === "error" && (
            <p className="text-[11px] text-red-400 italic">
              Couldn't load advice: {advice.message}
            </p>
          )}
        </section>

        {decisions.length > 0 && (
          <section className="pt-2 border-t border-gray-800">
            <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
              Decisions ({decisions.length})
            </h3>
            <ul className="space-y-1 text-[11px] text-gray-200">
              {decisions.map((d, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-green-400">✓</span>
                  <span className="flex-1">
                    {d.summary}
                    {d.participants && d.participants.length > 0 && (
                      <span className="text-gray-500">
                        {" "}
                        — {d.participants.join(", ")}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="pt-2 border-t border-gray-800">
          <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
            Suggested focus for next meeting
          </h3>
          <ul className="space-y-1 text-[11px] text-gray-300">
            {SUGGESTED_FOCUS.map((s, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-blue-400">•</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </section>

        {actionItems.length > 0 && (
          <section className="pt-2 border-t border-gray-800">
            <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
              Key Action Items
            </h3>
            <ul className="space-y-1 text-[11px] text-gray-200">
              {actionItems.slice(0, 2).map((item, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-blue-400">☐</span>
                  <span className="flex-1">
                    {item.description}
                    {item.assignee && (
                      <span className="text-gray-500"> — {item.assignee}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="pt-2 border-t border-gray-800">
          <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
            How did this meeting go?
          </h3>
          <div className="space-y-1.5">
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={rating}
              onChange={(e) => setRating(parseInt(e.target.value, 10))}
              className="w-full accent-blue-500"
            />
            <div className="flex justify-between text-[9px] text-gray-500">
              <span>Struggled</span>
              <span>OK</span>
              <span>Great</span>
            </div>
          </div>
        </section>

        <p className="pt-2 text-[10px] text-gray-500 leading-relaxed border-t border-gray-800">
          Full feedback — transcript, behavior breakdown, and charts — is
          available on the{" "}
          <button
            onClick={() => {
              const url =
                meetingId > 0
                  ? `https://minervacoach.com/my-meetings?meeting=${meetingId}`
                  : "https://minervacoach.com/my-meetings";
              openExternal(url).catch(console.warn);
            }}
            className="underline text-gray-400 hover:text-gray-200 cursor-pointer transition-colors"
          >
            My Meetings page
          </button>{" "}
          of your dashboard.
        </p>
      </div>
    </div>
  );
}
