interface ReleaseNotesModalProps {
  version: string;
  notes: string;
  onClose: () => void;
}

export function ReleaseNotesModal({ version, notes, onClose }: ReleaseNotesModalProps) {
  const body = notes.trim() ||
    `Minerva Coach has been updated to v${version}. Visit github.com/Minerva-Coach/minerva-desktop/releases for the full changelog.`;

  return (
    <div className="absolute inset-0 z-10 bg-gray-900 text-white flex flex-col rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
        <span className="text-xs font-semibold tracking-wide text-gray-300">
          What's New in v{version}
        </span>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded flex items-center justify-center text-gray-300 hover:bg-red-600 hover:text-white transition-colors text-base leading-none"
          title="Close"
          aria-label="Close release notes"
        >
          ×
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto px-3 py-3 [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        <pre className="text-[11px] text-gray-200 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
          {body}
        </pre>
      </div>

      <div className="px-3 py-2 border-t border-gray-700">
        <button
          onClick={onClose}
          className="w-full px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-xs font-medium transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
