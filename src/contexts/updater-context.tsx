import { createContext, useContext, type ReactNode } from "react";
import { useUpdater, type UpdaterStatus } from "../hooks/use-updater";

interface UpdaterContextValue {
  status: UpdaterStatus;
  checkNow: () => Promise<void>;
}

const UpdaterContext = createContext<UpdaterContextValue | null>(null);

export function UpdaterProvider({ children }: { children: ReactNode }) {
  const { status, checkNow } = useUpdater({ checkOnMount: true, autoInstall: true });
  return (
    <UpdaterContext.Provider value={{ status, checkNow }}>
      {children}
    </UpdaterContext.Provider>
  );
}

export function useUpdaterContext() {
  const ctx = useContext(UpdaterContext);
  if (!ctx) throw new Error("useUpdaterContext must be used inside UpdaterProvider");
  return ctx;
}
