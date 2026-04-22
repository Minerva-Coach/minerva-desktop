import { useEffect, useState } from "react";
import { COACHING_TIPS } from "../../constants/coaching_tips";

const ROTATE_INTERVAL_MS = 20_000;

/**
 * Rotating coaching tip shown when no meeting is active. Picks a random
 * starting index per mount so the same user doesn't see the same first
 * tip every time the panel is opened.
 */
export function CoachingTipCard() {
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * COACHING_TIPS.length)
  );
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setFading(true);
      // Let the fade-out transition play (200ms) before swapping content.
      setTimeout(() => {
        setIndex((i) => (i + 1) % COACHING_TIPS.length);
        setFading(false);
      }, 200);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const tip = COACHING_TIPS[index];

  return (
    <div
      className={`rounded border border-gray-800 bg-gray-900/40 p-2 transition-opacity duration-200 ${
        fading ? "opacity-0" : "opacity-100"
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-base leading-none select-none">{tip.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-gray-200 leading-tight">
            {tip.title}
          </p>
          <p className="text-[10px] text-gray-400 leading-snug mt-0.5">
            {tip.body}
          </p>
        </div>
      </div>
    </div>
  );
}
