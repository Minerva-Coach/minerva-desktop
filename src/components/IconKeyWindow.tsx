import { VISIBLE_COMPANION_BEHAVIORS, WARNING_ICONS } from "../constants/behaviors";

/**
 * Standalone reference window explaining the Core Meeting Skills box in
 * the panel. Opened from the About modal or the box's own "What is this?"
 * link; user is expected to leave it open on the side while they learn the
 * coaching icons and flash colors. Stays open until closed.
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
            Core Meeting Skills
          </h2>
          <p className="text-[11px] text-gray-400 mb-2">
            The Core Meeting Skills box tracks how many times you've used
            each skill ("Achieved") against a duration-adjusted target
            ("Expected So Far") — the target rises as the meeting goes on,
            so a 10-minute mark and a 50-minute mark expect different
            counts. Its border also flashes to call out what's happening in
            real time:
          </p>
          <div className="space-y-1.5 mb-3">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-green-500 shrink-0" />
              <span className="text-[11px] text-gray-300">
                Green border + icon highlight — you just used that skill.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500 shrink-0" />
              <span className="text-[11px] text-gray-300">
                Red border + icon highlight — good moment to use that skill
                now.
              </span>
            </div>
          </div>
          <div>
            {VISIBLE_COMPANION_BEHAVIORS.map((b) => (
              <Row
                key={b.code}
                emoji={b.emoji}
                title={`${b.label} — ${b.displayName}`}
                description={b.definition}
              />
            ))}
          </div>
        </section>

        <section className="mt-5">
          <h2 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
            Warnings
          </h2>
          <p className="text-[11px] text-gray-400 mb-2">
            When something's trending off track, the Core Meeting Skills box
            flashes yellow and swaps to the icon below for about 2 seconds
            before returning to normal.
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
