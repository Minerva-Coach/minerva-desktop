import {
  COMPANION_BEHAVIORS,
  SUGGESTION_PREFIX,
  WARNING_ICONS,
} from "../constants/behaviors";

/**
 * Standalone reference window listing every icon the overlay can show.
 * Opened from the About modal; user is expected to leave it open on the
 * side while they learn the coaching icons. Stays open until closed.
 */

function Row({
  emoji,
  title,
  description,
}: {
  emoji: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-gray-800 last:border-b-0">
      <span className="text-2xl leading-none shrink-0 w-14 text-center whitespace-nowrap">
        {emoji}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-gray-100">{title}</p>
        <p className="text-[11px] text-gray-400 leading-snug mt-0.5">
          {description}
        </p>
      </div>
    </div>
  );
}

export function IconKeyWindow() {
  return (
    <div className="w-full h-full bg-gray-900 text-white flex flex-col">
      <div className="px-4 py-3 bg-gray-800 border-b border-gray-700 shrink-0">
        <p className="text-sm font-semibold text-gray-100">Minerva Icon Key</p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          Leave this open while you get familiar with the coaching icons.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <section>
          <h2 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
            Core behaviors
          </h2>
          <p className="text-[11px] text-gray-400 mb-2">
            Each core behavior has two transient forms. The plain emoji is a
            compliment for a behavior you performed. The paired {SUGGESTION_PREFIX}
            version is a reminder to try that behavior now.
          </p>
          <div>
            {COMPANION_BEHAVIORS.map((b) => (
              <div
                key={b.code}
                className="py-2 border-b border-gray-800 last:border-b-0"
              >
                <p className="text-[12px] font-semibold text-gray-100">
                  {b.label} — {b.displayName}
                </p>
                <p className="text-[11px] text-gray-400 leading-snug mt-0.5">
                  {b.definition}
                </p>
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl leading-none w-14 text-center whitespace-nowrap">
                      {b.emoji}
                    </span>
                    <span className="text-[11px] text-gray-300">
                      Good {b.label}! — you did this well
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl leading-none w-14 text-center whitespace-nowrap">
                      {SUGGESTION_PREFIX}
                      {b.emoji}
                    </span>
                    <span className="text-[11px] text-gray-300">
                      Try a {b.label} now — a good moment to use this skill
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-5">
          <h2 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
            Warnings
          </h2>
          <p className="text-[11px] text-gray-400 mb-2">
            Shown when something's trending off-track and Minerva thinks it's
            worth pausing on.
          </p>
          <div>
            {Object.values(WARNING_ICONS).map((w) => (
              <Row
                key={w.label}
                emoji={w.emoji}
                title={w.label}
                description={w.definition}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
