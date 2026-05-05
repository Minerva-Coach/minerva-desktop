import { COMPANION_BEHAVIORS, findBehavior } from "../../constants/behaviors";
import type { CompanionDataUpdate } from "../../types/coaching";

type BehaviorData = CompanionDataUpdate["data"]["behaviors"][number];

interface BehaviorStationsProps {
  behaviors: BehaviorData[];
}

/**
 * Persistent count/target indicator rendered above the floating icons.
 *
 * Overlay window is click-through in normal mode, so no hover tooltips —
 * the compact label + numbers are the whole signal.
 */
export function BehaviorStations({ behaviors }: BehaviorStationsProps) {
  // Build a lookup by canonical code so we can render the fixed list of
  // four stations even if the backend hasn't reported all of them yet.
  const byCode = new Map<string, BehaviorData>();
  for (const b of behaviors) {
    const meta = findBehavior(b.name);
    if (meta) byCode.set(meta.code, b);
  }

  return (
    <div className="flex flex-row items-start justify-around gap-2 px-2">
      {COMPANION_BEHAVIORS.map((meta) => {
        const data = byCode.get(meta.code);
        const count = data?.count ?? 0;
        const target = data?.target ?? 0;
        // Backend sends target as the REMAINING delta, not the absolute goal.
        // Full target = current count + remaining.
        const fullTarget = count + target;
        const metTarget = target === 0 && count > 0;

        return (
          <div
            key={meta.code}
            className="flex flex-col items-center text-center flex-1 min-w-0"
          >
            <span
              className="text-2xl leading-none drop-shadow"
              style={{ textShadow: "0 1px 3px rgba(0,0,0,0.6)" }}
            >
              {meta.emoji}
            </span>
            <span
              className={`text-[11px] font-mono font-semibold leading-tight mt-0.5 ${
                metTarget ? "text-green-400" : "text-white"
              }`}
              style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}
            >
              {count}/{fullTarget || "–"}
            </span>
            <span
              className="text-[9px] font-semibold tracking-wider text-gray-200/80 leading-tight"
              style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}
            >
              {meta.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
