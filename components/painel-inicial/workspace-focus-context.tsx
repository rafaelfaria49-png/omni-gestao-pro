"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";

type WorkspaceFocusValue = {
  focusMode: boolean;
  setFocusMode: (focusMode: boolean) => void;
};

const WorkspaceFocusContext = createContext<WorkspaceFocusValue>({
  focusMode: false,
  setFocusMode: () => undefined,
});

export function WorkspaceFocusProvider({ children }: { children: ReactNode }) {
  const [focusMode, setFocusMode] = useState(false);
  const value = useMemo(() => ({ focusMode, setFocusMode }), [focusMode]);

  return <WorkspaceFocusContext.Provider value={value}>{children}</WorkspaceFocusContext.Provider>;
}

export function useWorkspaceFocus() {
  return useContext(WorkspaceFocusContext);
}
