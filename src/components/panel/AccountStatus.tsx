import { open } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import type { ConnectedAccounts } from "../../hooks/use-connected-accounts";

interface AccountStatusProps {
  accounts: ConnectedAccounts;
  loading: boolean;
  onRefresh: () => void;
}

/**
 * Account connection status for Zoom and Teams.
 * Shows real connection status fetched from /oauth/connected-accounts.
 *
 * If Zoom is not connected, shows instructions about using the magic link
 * method (sent via private message when Minerva bot joins a meeting).
 */
export function AccountStatus({ accounts, loading, onRefresh }: AccountStatusProps) {
  const handleConnect = async (connectUrl: string | null | undefined) => {
    if (!connectUrl) return;
    // If it's a relative URL, prepend the API base
    if (connectUrl.startsWith("/")) {
      const apiUrl = await invoke<string>("get_api_url");
      await open(`${apiUrl}${connectUrl}`);
    } else {
      await open(connectUrl);
    }
    // Refresh status after a delay (user may have completed OAuth)
    setTimeout(onRefresh, 5000);
  };

  if (loading) {
    return (
      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
          Accounts
        </h3>
        <p className="text-[10px] text-gray-600 italic">Loading...</p>
      </div>
    );
  }

  const platforms = [
    {
      key: "zoom" as const,
      label: "Zoom",
      status: accounts.zoom,
    },
    {
      key: "teams" as const,
      label: "Teams",
      status: accounts.teams,
    },
  ];

  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
        Accounts
      </h3>
      <div className="space-y-1">
        {platforms.map((p) => (
          <div
            key={p.key}
            className="flex items-center justify-between py-1 px-2 rounded bg-gray-800/50"
          >
            <div className="flex items-center gap-2">
              <div
                className={`w-1.5 h-1.5 rounded-full ${p.status.connected ? "bg-green-500" : "bg-gray-600"}`}
              />
              <span className="text-xs text-gray-300">{p.label}</span>
            </div>
            {p.status.connected ? (
              <span className="text-[10px] text-green-400">
                {p.status.identities[0]?.display_label || "Connected"}
              </span>
            ) : p.status.connect_url ? (
              <button
                onClick={() => handleConnect(p.status.connect_url)}
                className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
              >
                Connect
              </button>
            ) : (
              <span className="text-[10px] text-gray-600">Not available</span>
            )}
          </div>
        ))}
      </div>

      {/* Instructions for Zoom connection if not connected */}
      {!accounts.zoom.connected && (
        <div className="mt-2 p-2 rounded bg-blue-900/20 border border-blue-800/30">
          <p className="text-[10px] text-blue-300 leading-relaxed">
            <strong>Connect Zoom:</strong> When Minerva joins your meeting,
            click the magic link sent via private message in Zoom chat.
            This links your Zoom identity for automatic verification in
            future meetings.
          </p>
        </div>
      )}
    </div>
  );
}
