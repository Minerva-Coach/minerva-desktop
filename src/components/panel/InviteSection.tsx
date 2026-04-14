import { useState } from "react";
import { apiFetch } from "../../lib/api";

/**
 * Section for inviting the Minerva bot to a meeting.
 *
 * Posts to /api/meetings with the meeting URL to trigger Recall bot join.
 * User pastes URL from Zoom's "Participants > Copy Invite Link".
 */
export function InviteSection() {
  const [meetingUrl, setMeetingUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [errorMsg, setErrorMsg] = useState("");

  const handleInvite = async () => {
    const url = meetingUrl.trim();
    if (!url) return;

    setStatus("sending");
    setErrorMsg("");

    try {
      const resp = await apiFetch("/api/meetings", {
        method: "POST",
        body: JSON.stringify({
          url,
          title: "Desktop App Meeting",
          manual_join: true,
        }),
      });

      if (resp.ok) {
        setStatus("sent");
        setMeetingUrl("");
        setTimeout(() => setStatus("idle"), 5000);
      } else if (resp.status === 402) {
        setStatus("error");
        setErrorMsg("Subscription required. Check your plan.");
      } else {
        const data = await resp.json().catch(() => ({}));
        setStatus("error");
        setErrorMsg(data.error || `Failed (${resp.status})`);
      }
    } catch (e) {
      setStatus("error");
      setErrorMsg("Network error. Is the server running?");
    }
  };

  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
        Invite Minerva to Meeting
      </h3>
      <p className="text-[10px] text-gray-500 mb-1.5">
        In Zoom: Participants &gt; Copy Invite Link, then paste below
      </p>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={meetingUrl}
          onChange={(e) => setMeetingUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleInvite()}
          placeholder="https://zoom.us/j/..."
          className="flex-1 px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-200 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none"
          disabled={status === "sending"}
        />
        <button
          onClick={handleInvite}
          disabled={!meetingUrl.trim() || status === "sending"}
          className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-xs font-medium transition-colors whitespace-nowrap"
        >
          {status === "sending" ? "..." : status === "sent" ? "Sent!" : "Invite"}
        </button>
      </div>
      {status === "sent" && (
        <p className="text-[10px] text-green-400 mt-1">
          Minerva will join your meeting shortly.
        </p>
      )}
      {status === "error" && (
        <p className="text-[10px] text-red-400 mt-1">{errorMsg}</p>
      )}
    </div>
  );
}
