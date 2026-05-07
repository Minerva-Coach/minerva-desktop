import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openShell } from "@tauri-apps/plugin-shell";
import type { DiagnosticContext } from "../../types/coaching";

const SUPPORT_EMAIL = "matt@minervacoach.com";

interface ConnectionIssueModalProps {
  /** Headline shown at the top — varies by what triggered the modal. */
  title: string;
  /** Plain-English explanation, two or three lines. */
  description: string;
  /** Most recent socket connection error (full source chain), if any. */
  socketError: string | null;
  /** Most recent auth flow error, if any. */
  authError: string | null;
  /** Most recent /oauth/connected-accounts fetch error, if any. */
  accountsError?: string | null;
  /** Most recent presence heartbeat error, if any. */
  presenceError?: string | null;
  /** Called when the user clicks Try again. */
  onRetry?: () => void;
  /** Whether to render the Try again button. */
  showRetry?: boolean;
  onClose: () => void;
}

/**
 * User-shareable error popup. Non-technical users can't read terminal
 * logs; this collects everything support would need (app version, OS, the
 * actual error chain) into one block they can copy and email.
 */
export function ConnectionIssueModal({
  title,
  description,
  socketError,
  authError,
  accountsError = null,
  presenceError = null,
  onRetry,
  showRetry = false,
  onClose,
}: ConnectionIssueModalProps) {
  const [ctx, setCtx] = useState<DiagnosticContext | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    invoke<DiagnosticContext>("get_diagnostic_context")
      .then(setCtx)
      .catch(() => setCtx(null));
  }, []);

  const diagnosticText = buildDiagnosticText(
    ctx,
    socketError,
    authError,
    accountsError,
    presenceError
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(diagnosticText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can fail in unusual contexts (no user gesture, etc.).
      // Leave the textarea visible so the user can still select-all manually.
    }
  };

  const handleEmailSupport = () => {
    const subject = encodeURIComponent("Minerva Coach — connection issue");
    const body = encodeURIComponent(
      `I'm having trouble connecting Minerva Coach. ` +
        `Diagnostic info below.\n\n${diagnosticText}`
    );
    openShell(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`).catch(
      () => {
        /* User can still copy + paste into their own email client. */
      }
    );
  };

  return (
    <div className="absolute inset-0 z-20 bg-gray-900 text-white flex flex-col rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
        <span className="text-xs font-semibold tracking-wide text-gray-300">
          {title}
        </span>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded flex items-center justify-center text-gray-300 hover:bg-red-600 hover:text-white transition-colors text-base leading-none"
          title="Close"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-xs [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        <p className="text-[11px] text-gray-300 leading-relaxed">
          {description}
        </p>

        <textarea
          readOnly
          value={diagnosticText}
          className="w-full h-40 px-2 py-1.5 rounded bg-gray-950 border border-gray-700 text-[10px] text-gray-300 font-mono resize-none focus:outline-none"
          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
        />

        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={handleCopy}
            className="px-2 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-[11px] font-medium transition-colors"
          >
            {copied ? "Copied!" : "Copy details"}
          </button>
          <button
            onClick={handleEmailSupport}
            className="px-2 py-1.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700 text-[11px] text-gray-200 transition-colors"
          >
            Email support
          </button>
        </div>

        {showRetry && onRetry && (
          <button
            onClick={() => {
              onRetry();
              onClose();
            }}
            className="w-full px-2 py-1.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700 text-[11px] text-gray-200 transition-colors"
          >
            Try again
          </button>
        )}

        <p className="text-[10px] text-gray-500 leading-relaxed pt-1">
          If the problem persists, click "Email support" to send this info to{" "}
          {SUPPORT_EMAIL}. Reply to that email with anything else you noticed
          and we'll help you get connected.
        </p>
      </div>
    </div>
  );
}

function buildDiagnosticText(
  ctx: DiagnosticContext | null,
  socketError: string | null,
  authError: string | null,
  accountsError: string | null,
  presenceError: string | null
): string {
  const lines: string[] = [];
  lines.push("--- Minerva Coach diagnostic ---");
  lines.push(`When: ${new Date().toISOString()}`);
  if (ctx) {
    lines.push(`App version: ${ctx.app_version}`);
    lines.push(`OS: ${ctx.os} ${ctx.arch}`);
    if (ctx.os_version) lines.push(`OS version: ${ctx.os_version}`);
    lines.push(`Backend: ${ctx.api_url}`);
    lines.push(`Signed in: ${ctx.has_token ? "yes" : "no"}`);
  } else {
    lines.push("(diagnostic context unavailable)");
  }
  lines.push("");
  let any = false;
  if (authError) {
    lines.push("Last sign-in error:");
    lines.push(`  ${authError}`);
    lines.push("");
    any = true;
  }
  if (socketError) {
    lines.push("Last server-connect error:");
    lines.push(`  ${socketError}`);
    lines.push("");
    any = true;
  }
  if (accountsError) {
    lines.push("Last connected-accounts error:");
    lines.push(`  ${accountsError}`);
    lines.push("");
    any = true;
  }
  if (presenceError) {
    lines.push("Last meeting-presence error:");
    lines.push(`  ${presenceError}`);
    lines.push("");
    any = true;
  }
  if (!any) {
    lines.push("(no specific error captured — connection just hasn't come up)");
  }
  return lines.join("\n");
}
