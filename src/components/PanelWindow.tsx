import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "../hooks/use-auth";
import { useSocket } from "../hooks/use-socket";
import { useDevChartData } from "../hooks/use-dev-events";
import { useConnectedAccounts } from "../hooks/use-connected-accounts";
import { useMeetingStatus } from "../hooks/use-meeting-status";
import { AccountStatus } from "./panel/AccountStatus";
import { InviteSection } from "./panel/InviteSection";
import { Gauges } from "./panel/Gauges";
import { DevMode } from "./panel/DevMode";

export function PanelWindow() {
  const { token, isAuthenticated, loading, login } = useAuth();
  const { isConnected, activeMeetings, lastChartData } = useSocket(token);
  const hasBotInMeeting = activeMeetings.length > 0;
  const devChartData = useDevChartData();
  const chartData = devChartData ?? lastChartData;
  const { accounts, loading: accountsLoading, refresh: refreshAccounts } =
    useConnectedAccounts(isAuthenticated);
  // Listens for meeting-started/stopped events and manages window visibility
  useMeetingStatus();

  const handleHide = async () => {
    await invoke("hide_windows");
  };

  const handleDrag = async (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    await getCurrentWebviewWindow().startDragging();
  };

  if (loading) {
    return (
      <div className="w-full h-full bg-gray-900 text-white flex items-center justify-center rounded-xl">
        <span className="text-sm text-gray-400">Loading...</span>
      </div>
    );
  }

  return (
    <div
      className="w-full h-full bg-gray-900 text-white flex flex-col rounded-xl overflow-hidden select-none"
      onMouseDown={handleDrag}
    >
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
        <span className="text-xs font-semibold tracking-wide text-gray-300">
          Minerva Coach
        </span>
        <div className="flex gap-1" data-no-drag>
          <button
            onClick={handleHide}
            className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:bg-gray-600 hover:text-white transition-colors text-xs"
            title="Hide Minerva"
          >
            _
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3" data-no-drag>
        {!isAuthenticated ? (
          /* Gate: Must sign in to Minerva first */
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <p className="text-xs text-gray-300 font-medium">
              Connect your Minerva account
            </p>
            <p className="text-[10px] text-gray-500 leading-relaxed px-2">
              Sign in to link your meetings and receive real-time coaching
              feedback.
            </p>
            <button
              onClick={login}
              className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
            >
              Sign in to Minerva
            </button>
          </div>
        ) : (
          <>
            <AccountStatus
              accounts={accounts}
              loading={accountsLoading}
              onRefresh={refreshAccounts}
            />
            {!hasBotInMeeting && <InviteSection />}
            {hasBotInMeeting && (
              <div className="py-1 px-2 rounded bg-green-900/20 border border-green-800/30">
                <p className="text-[10px] text-green-300">
                  Minerva is active in your meeting
                </p>
              </div>
            )}
            <Gauges chartData={chartData} />
            <DevMode />
          </>
        )}
      </div>

      {/* Status bar */}
      <div className="px-3 py-1 bg-gray-800 border-t border-gray-700 flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${
            !isAuthenticated
              ? "bg-gray-600"
              : isConnected
                ? "bg-green-500"
                : "bg-red-500"
          }`}
        />
        <span className="text-[10px] text-gray-500">
          {!isAuthenticated
            ? "Not signed in"
            : isConnected
              ? "Connected"
              : "Disconnected"}
        </span>
      </div>
    </div>
  );
}
