import { createContext, useContext, type ReactNode } from "react";
import { useUpdater, type UpdaterStatus } from "../hooks/use-updater";

interface UpdaterContextValue {
  status: UpdaterStatus;
  checkNow: () => Promise<void>;
  /** True after >= 3 consecutive failed checks — surface a banner (P2-G). */
  isStuck: boolean;
  failureCount: number;
}

const UpdaterContext = createContext<UpdaterContextValue | null>(null);

export function UpdaterProvider({ children }: { children: ReactNode }) {
  const { status, checkNow, isStuck, failureCount } = useUpdater({
    checkOnMount: true,
    autoInstall: true,
  });
  return (
    <UpdaterContext.Provider value={{ status, checkNow, isStuck, failureCount }}>
      {children}
    </UpdaterContext.Provider>
  );
}

export function useUpdaterContext() {
  const ctx = useContext(UpdaterContext);
  if (!ctx) throw new Error("useUpdaterContext must be used inside UpdaterProvider");
  return ctx;
}
