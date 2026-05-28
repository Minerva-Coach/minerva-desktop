import { invoke } from "@tauri-apps/api/core";
import type {
  FeatureName,
  FeatureState,
} from "../../hooks/use-feature-state";

/**
 * Bite-sized first-reveal card for a newly-ready companion feature.
 *
 * Shows at most one feature at a time — picks the first ready+unseen
 * one from a fixed priority order so the user isn't stacked with
 * banners after a long absence. Once dismissed (Open or Not now), the
 * intro_seen flag persists server-side and this slot stays quiet for
 * good. Subsequent access goes through the About modal.
 */

const INTRO_COPY: Partial<Record<FeatureName, { title: string; body: string }>> =
  {
    focusGoals: {
      title: "Focus goals are ready",
      body: "Pick one or two skills to work on across meetings. Add them on the dashboard.",
    },
    agenda: {
      title: "Agenda is ready",
      body: "See your next meeting's agenda right here — set it on the dashboard.",
    },
    // Coaching has no intro — it's opt-in only from the About modal.
  };

const TAURI_COMMAND: Record<FeatureName, string> = {
  focusGoals: "open_focus_goals",
  agenda: "open_agenda",
  coaching: "open_coaching",
};

// Show priority: focus goals before agenda (focus is the broader behavior;
// agenda is per-meeting). Coaching never shows here.
const PRIORITY: FeatureName[] = ["focusGoals", "agenda"];

function pickIntro(state: FeatureState | null): FeatureName | null {
  if (!state) return null;
  for (const name of PRIORITY) {
    const slice = state[name];
    if (slice.status === "ready" && slice.introSeen === false) return name;
  }
  return null;
}

interface CompanionIntroBannerProps {
  state: FeatureState | null;
  markIntroSeen: (feature: FeatureName) => Promise<void>;
}

export function CompanionIntroBanner({
  state,
  markIntroSeen,
}: CompanionIntroBannerProps) {
  const feature = pickIntro(state);
  if (!feature) return null;
  const copy = INTRO_COPY[feature];
  if (!copy) return null;

  const handleOpen = async () => {
    try {
      await invoke(TAURI_COMMAND[feature]);
    } catch (e) {
      console.warn(`Failed to open ${feature} window:`, e);
    }
    // Mark seen regardless of whether the window open succeeded — the
    // user has clearly engaged with the prompt.
    markIntroSeen(feature).catch(console.warn);
  };

  const handleDismiss = () => {
    markIntroSeen(feature).catch(console.warn);
  };

  return (
    <div
      className="px-3 py-2 bg-indigo-900/40 border-b border-indigo-800/60 text-[10px] text-indigo-100"
      data-no-drag
    >
      <p className="font-semibold text-[11px] text-indigo-100">{copy.title}</p>
      <p className="leading-relaxed mt-0.5 text-indigo-200/90">{copy.body}</p>
      <div className="flex gap-2 mt-1.5">
        <button
          type="button"
          onClick={handleOpen}
          className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-medium"
        >
          Open
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="px-2 py-1 rounded bg-transparent hover:bg-indigo-800/60 text-indigo-200 text-[10px]"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
