interface WelcomeCompleteProps {
  onAcknowledge: () => void;
}

const BULLETS = [
  "Runs silently in your system tray — click the icon to open Minerva.",
  "Opens automatically when you start a meeting.",
  "One click to add Minerva to the meeting.",
  "Coaching tips appear as floating icons during the meeting.",
];

/**
 * Final step of the onboarding flow. Stays on screen until the user clicks
 * [Got it] — closing the panel without acknowledging will re-show this on
 * the next launch.
 */
export function WelcomeComplete({ onAcknowledge }: WelcomeCompleteProps) {
  return (
    <div className="flex flex-col h-full gap-3 px-1">
      <div className="space-y-1">
        <p className="text-xs text-gray-200 font-semibold">You're all set</p>
        <p className="text-[10px] text-gray-400 leading-relaxed">
          Here's what to expect from Minerva:
        </p>
      </div>

      <ul className="space-y-2 flex-1">
        {BULLETS.map((text, i) => (
          <li key={i} className="flex gap-2 items-start">
            <span className="text-blue-400 text-[10px] mt-0.5">●</span>
            <span className="text-[10px] text-gray-300 leading-relaxed">
              {text}
            </span>
          </li>
        ))}
      </ul>

      <button
        onClick={onAcknowledge}
        className="w-full px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 text-xs font-medium transition-colors"
      >
        Got it
      </button>
    </div>
  );
}
