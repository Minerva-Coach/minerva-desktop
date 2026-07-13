import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  VISIBLE_COMPANION_BEHAVIORS,
  findBehavior,
  WARNING_ICONS,
} from "../../constants/behaviors";
import type { CoachingMessage, CompanionDataUpdate } from "../../types/coaching";

type BehaviorData = CompanionDataUpdate["data"]["behaviors"][number];

type FlashState =
  | { kind: "behavior"; color: "green" | "red"; behaviorCode: string }
  | { kind: "warning"; warning: { emoji: string; label: string } };

/** How long a flash (border color + icon swap/highlight) stays up before
 * reverting to the normal achieved/target display. */
const FLASH_MS = 2000;

/**
 * Classify a coaching message the same way the old floating-icon HUD
 * did, but into a flash state for this box instead of a spawned icon.
 *
 *   warning   (metadata.warning_type)                  → yellow, swaps content
 *   praise    (positive_reinforcement + behavior)       → green, highlights icon
 *   suggestion (coaching_tip + behavior)                → red, highlights icon
 */
function classify(message: CoachingMessage): FlashState | null {
  const md = message.metadata ?? {};
  const warningType = typeof md.warning_type === "string" ? md.warning_type : null;
  if (warningType && WARNING_ICONS[warningType]) {
    return { kind: "warning", warning: WARNING_ICONS[warningType] };
  }

  const behaviorHint =
    typeof md.behavior === "string"
      ? md.behavior
      : typeof md.behavior_name === "string"
        ? md.behavior_name
        : null;
  const found = behaviorHint ? findBehavior(behaviorHint) : null;
  // Hidden behaviors (e.g. IA, disabled pending better data) have no icon
  // to highlight, so don't flash for them.
  const behavior = found && !found.hidden ? found : null;

  if (message.message_type === "positive_reinforcement" && behavior) {
    return { kind: "behavior", color: "green", behaviorCode: behavior.code };
  }
  if (message.message_type === "coaching_tip" && behavior) {
    return { kind: "behavior", color: "red", behaviorCode: behavior.code };
  }
  return null;
}

interface CoreMeetingSkillsProps {
  behaviors: BehaviorData[];
  coachingMessage: CoachingMessage | null;
}

/**
 * Panel section showing achieved/target counts for the 4 core coaching
 * skills. The box border flashes green (skill just used), red (good moment
 * to use a skill), or yellow (warning — content swaps to the warning icon
 * for a couple seconds) in response to real-time coaching messages.
 */
export function CoreMeetingSkills({ behaviors, coachingMessage }: CoreMeetingSkillsProps) {
  const [flash, setFlash] = useState<FlashState | null>(null);
  // Baseline is the message present at mount, not null — otherwise a
  // leftover message from a previous meeting would fire a flash the
  // instant this section mounts for the next one.
  const seenRef = useRef(coachingMessage);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!coachingMessage || coachingMessage === seenRef.current) return;
    seenRef.current = coachingMessage;
    const next = classify(coachingMessage);
    if (!next) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setFlash(next);
    timeoutRef.current = setTimeout(() => setFlash(null), FLASH_MS);
  }, [coachingMessage]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const openIconKey = () => invoke("open_icon_key").catch(console.warn);

  const byCode = new Map<string, BehaviorData>();
  for (const b of behaviors) {
    const meta = findBehavior(b.name);
    if (meta) byCode.set(meta.code, b);
  }

  const borderClass =
    flash?.kind === "warning"
      ? "border-yellow-500"
      : flash?.color === "green"
        ? "border-green-500"
        : flash?.color === "red"
          ? "border-red-500"
          : "border-gray-700";

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-[10px] uppercase tracking-wider text-gray-500">
          Core Meeting Skills
        </h3>
        <button
          onClick={openIconKey}
          className="text-[10px] text-blue-400 hover:text-blue-300 underline transition-colors shrink-0"
        >
          What is this?
        </button>
      </div>
      <p className="text-[10px] text-gray-500 leading-tight mb-1.5">
        Achieved / Expected So Far
      </p>

      <div
        className={`rounded-lg border-2 px-2 py-2 bg-gray-800/50 transition-colors duration-300 min-h-[76px] flex items-center justify-center ${borderClass}`}
      >
        {flash?.kind === "warning" ? (
          <div className="flex items-center justify-center gap-2">
            <span className="text-2xl leading-none">{flash.warning.emoji}</span>
            <span className="text-[11px] font-medium text-gray-200">
              {flash.warning.label}
            </span>
          </div>
        ) : (
          <div className="flex flex-row items-start justify-around gap-2 w-full">
            {VISIBLE_COMPANION_BEHAVIORS.map((meta) => {
              const data = byCode.get(meta.code);
              const count = data?.count ?? 0;
              const target = data?.target ?? 0;
              // scaled_target is the absolute, time-scaled goal and is
              // independent of count (issue #292); fall back to
              // count + remaining for older backends.
              const fullTarget = data?.scaled_target ?? count + target;
              const metTarget = count >= fullTarget && count > 0;
              const highlighted =
                flash?.kind === "behavior" && flash.behaviorCode === meta.code;
              const ringClass = highlighted
                ? flash?.color === "green"
                  ? "ring-2 ring-green-400 scale-110"
                  : "ring-2 ring-red-400 scale-110"
                : "";

              return (
                <div
                  key={meta.code}
                  className={`flex flex-col items-center text-center flex-1 min-w-0 rounded-md py-1 transition-transform duration-300 ${ringClass}`}
                >
                  <span className="text-xl leading-none">{meta.emoji}</span>
                  <span
                    className={`text-[11px] font-mono font-semibold leading-tight mt-0.5 ${
                      metTarget ? "text-green-400" : "text-gray-200"
                    }`}
                  >
                    {count}/{fullTarget || "–"}
                  </span>
                  <span className="text-[9px] font-semibold tracking-wider text-gray-500 leading-tight">
                    {meta.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
