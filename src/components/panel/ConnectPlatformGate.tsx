import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import type { ConnectedAccounts } from "../../hooks/use-connected-accounts";

interface ConnectPlatformGateProps {
  accounts: ConnectedAccounts;
  onRefresh: () => void;
}

/**
 * Onboarding gate shown after sign-in when the user has no Zoom or Teams
 * identity linked. Polls /oauth/connected-accounts so the gate dismisses
 * automatically when the user finishes OAuth in their browser.
 */
export function ConnectPlatformGate({
  accounts,
  onRefresh,
}: ConnectPlatformGateProps) {
  useEffect(() => {
    const id = setInterval(onRefresh, 3000);
    return () => clearInterval(id);
  }, [onRefresh]);

  const handleConnect = async (connectUrl: string | null | undefined) => {
    if (!connectUrl) return;
    if (connectUrl.startsWith("/")) {
      const apiUrl = await invoke<string>("get_api_url");
      await open(`${apiUrl}${connectUrl}`);
    } else {
      await open(connectUrl);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-2">
      <div className="space-y-1.5">
        <p className="text-xs text-gray-200 font-semibold">
          Connect a meeting platform
        </p>
        <p className="text-[10px] text-gray-400 leading-relaxed">
          Minerva needs access to your Zoom or Microsoft Teams account so it
          can join your meetings and coach you in real time. Pick one to
          continue.
        </p>
      </div>

      <div className="w-full space-y-1.5">
        <button
          onClick={() => handleConnect(accounts.zoom.connect_url)}
          disabled={!accounts.zoom.connect_url}
          className="w-full px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-xs font-medium transition-colors"
          title={
            accounts.zoom.connect_url
              ? undefined
              : "Zoom OAuth is not configured on the server"
          }
        >
          Connect Zoom
        </button>
        <button
          onClick={() => handleConnect(accounts.teams.connect_url)}
          disabled={!accounts.teams.connect_url}
          className="w-full px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-xs font-medium transition-colors"
          title={
            accounts.teams.connect_url
              ? undefined
              : "Teams OAuth is not configured on the server"
          }
        >
          Connect Microsoft Teams
        </button>
      </div>

      <p className="text-[10px] text-gray-500 leading-relaxed">
        Finish the connection in your browser. We'll detect it and continue
        automatically.
      </p>
    </div>
  );
}
