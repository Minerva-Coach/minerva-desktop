import { useState } from "react";

export interface InviteResult {
  ok: boolean;
  error?: string;
}

interface PasteLinkModalProps {
  initialError?: string;
  onClose: () => void;
  onSubmit: (url: string) => Promise<InviteResult>;
  onSent: () => void;
}

export function PasteLinkModal({ initialError, onClose, onSubmit, onSent }: PasteLinkModalProps) {
  const [pastedUrl, setPastedUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async () => {
    const url = pastedUrl.trim();
    if (!url) return;

    setStatus("sending");
    setErrorMsg("");

    const result = await onSubmit(url);
    if (result.ok) {
      onSent();
      onClose();
    } else {
      setStatus("error");
      setErrorMsg(result.error ?? "Failed");
    }
  };

  return (
    <div
      className="absolute inset-0 z-10 bg-gray-900 text-white flex flex-col rounded-xl overflow-hidden"
      data-no-drag
    >
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
        <span className="text-xs font-semibold tracking-wide text-gray-300">
          Paste meeting link
        </span>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded flex items-center justify-center text-gray-300 hover:bg-red-600 hover:text-white transition-colors text-base leading-none"
          title="Close"
          aria-label="Close paste-link panel"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-xs">
        {initialError && status === "idle" && (
          <div className="px-2 py-1.5 rounded bg-red-900/30 border border-red-800/50">
            <p className="text-[10px] text-red-300">
              We couldn't add Minerva automatically: {initialError}
            </p>
          </div>
        )}

        <div className="space-y-1">
          <p className="text-[11px] text-gray-300 font-medium">
            Copy the link from Zoom:
          </p>
          <ol className="text-[10px] text-gray-400 leading-relaxed list-decimal list-inside space-y-0.5">
            <li>Open the Participants panel in Zoom</li>
            <li>Click <span className="text-gray-200">Invite</span></li>
            <li>Click <span className="text-gray-200">Copy Invite Link</span></li>
            <li>Paste it below</li>
          </ol>
        </div>

        <div className="space-y-1.5">
          <input
            type="text"
            value={pastedUrl}
            onChange={(e) => setPastedUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="https://zoom.us/j/..."
            autoFocus
            className="w-full px-2 py-1.5 rounded bg-gray-800 border border-gray-700 text-xs text-gray-200 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none"
            disabled={status === "sending"}
          />
          {status === "error" && errorMsg && (
            <p className="text-[10px] text-red-400">{errorMsg}</p>
          )}
          <button
            onClick={handleSubmit}
            disabled={!pastedUrl.trim() || status === "sending"}
            className="w-full px-2 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-[11px] font-medium transition-colors"
          >
            {status === "sending" ? "Adding…" : "Add Minerva"}
          </button>
          <button
            onClick={onClose}
            className="w-full px-2 py-1.5 rounded text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
