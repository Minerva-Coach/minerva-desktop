import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { COMPANION_BEHAVIORS } from "../../constants/behaviors";

const STORAGE_KEY = "minerva_skills_intro_acked";

type Stage = "button" | "description" | "acknowledged";

function loadStage(): Stage {
  return localStorage.getItem(STORAGE_KEY) === "true" ? "acknowledged" : "button";
}

export function CoreBehaviorSkillsPanel() {
  const [stage, setStage] = useState<Stage>(loadStage);

  const handleAcknowledge = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setStage("acknowledged");
  };

  const handleMoreInfo = () => {
    invoke("open_icon_key").catch(console.warn);
  };

  const skillsEnabled = stage === "acknowledged";

  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
        Core Behavior Skills
      </h3>

      <div className="relative">
        {/* Skills list — always rendered to provide container height */}
        <div
          className={`space-y-1 transition-opacity duration-300 ${
            skillsEnabled ? "opacity-100" : "opacity-30 pointer-events-none select-none"
          }`}
        >
          {COMPANION_BEHAVIORS.map((b) => (
            <div
              key={b.code}
              className="flex items-center gap-2 py-1.5 px-2 rounded bg-gray-800/50"
            >
              <span className="text-base leading-none">{b.emoji}</span>
              <span className="flex-1 text-[11px] font-medium text-gray-200 min-w-0">
                {b.displayName}
              </span>
              <span className="text-[10px] text-gray-500 font-mono shrink-0">
                {b.label}
              </span>
            </div>
          ))}
        </div>

        {/* Intro overlay */}
        {stage === "button" && (
          <div className="absolute inset-0 flex items-center justify-center" data-no-drag>
            <button
              onClick={() => setStage("description")}
              className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 border border-gray-600 text-[11px] text-gray-200 font-medium transition-colors shadow-lg"
            >
              What is this window?
            </button>
          </div>
        )}

        {stage === "description" && (
          <div
            className="absolute inset-0 flex items-center justify-center px-1"
            data-no-drag
          >
            <div className="w-full p-2.5 rounded-lg bg-gray-800 border border-gray-600 shadow-lg space-y-2">
              <p className="text-[11px] text-gray-200 leading-relaxed">
                This window shows real-time coaching in the form of floating
                icons when you use one of our core skills: Summarizing
                Statement, Open-Ended Question, Exploring Emotions or Values,
                and Intent Alignment.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleAcknowledge}
                  className="flex-1 px-2 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-[11px] text-white font-medium transition-colors"
                >
                  Got it
                </button>
                <button
                  onClick={handleMoreInfo}
                  className="px-2 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-[11px] text-gray-200 font-medium transition-colors whitespace-nowrap"
                >
                  More info
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
