import type { CompanionDataUpdate } from "../../types/coaching";

interface GaugesProps {
  chartData: CompanionDataUpdate | null;
}

/**
 * Filler words and talk time gauges.
 * Data comes from companion_data_update SocketIO events.
 */
export function Gauges({ chartData }: GaugesProps) {
  const fillerPct = chartData
    ? Math.round(chartData.data.filler_words.fraction * 100)
    : 0;
  const talkPct = chartData
    ? Math.round(chartData.data.talk_time.me * 100)
    : 0;
  const othersPct = chartData
    ? Math.round(chartData.data.talk_time.others * 100)
    : 0;
  const silencePct = chartData
    ? Math.round(chartData.data.talk_time.silence * 100)
    : 0;
  const topFillers = chartData?.data.filler_words.top_2 ?? [];

  const hasData = chartData !== null;

  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
        Meeting Stats
      </h3>

      {!hasData ? (
        <p className="text-[10px] text-gray-600 italic">
          Waiting for meeting data...
        </p>
      ) : (
        <div className="space-y-2.5">
          {/* Filler Words */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] text-gray-400">Filler Words</span>
              <span className="text-[10px] text-gray-300 font-mono">
                {fillerPct}%
              </span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  fillerPct > 5
                    ? "bg-orange-500"
                    : fillerPct > 2
                      ? "bg-yellow-500"
                      : "bg-green-500"
                }`}
                style={{ width: `${Math.min(fillerPct * 5, 100)}%` }}
              />
            </div>
            {topFillers.length > 0 && (
              <p className="text-[10px] text-gray-600 mt-0.5">
                Top: {topFillers.join(", ")}
              </p>
            )}
          </div>

          {/* Talk Time Distribution */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] text-gray-400">Talk Time</span>
              <span className="text-[10px] text-gray-300 font-mono">
                {talkPct}%
              </span>
            </div>
            <div className="h-3 bg-gray-800 rounded-full overflow-hidden flex">
              <div
                className="h-full bg-blue-500 transition-all duration-500"
                style={{ width: `${talkPct}%` }}
                title={`You: ${talkPct}%`}
              />
              <div
                className="h-full bg-gray-500 transition-all duration-500"
                style={{ width: `${othersPct}%` }}
                title={`Others: ${othersPct}%`}
              />
              <div
                className="h-full bg-gray-700 transition-all duration-500"
                style={{ width: `${silencePct}%` }}
                title={`Silence: ${silencePct}%`}
              />
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-[9px] text-blue-400">You {talkPct}%</span>
              <span className="text-[9px] text-gray-500">
                Others {othersPct}%
              </span>
              <span className="text-[9px] text-gray-600">
                Silence {silencePct}%
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
