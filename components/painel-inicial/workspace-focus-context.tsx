"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from "react";
import {
  INITIAL_WORKSPACE_OVERLAY_STATE,
  workspaceOverlayReducer,
  type WorkspaceOverlayGroup,
  type WorkspaceOverlayId,
  type WorkspaceOverlayState,
} from "@/lib/workspace-overlay-orchestrator";

type WorkspaceFocusValue = {
  focusMode: boolean;
  setFocusMode: (focusMode: boolean) => void;
  overlayState: WorkspaceOverlayState;
  openOverlay: (id: WorkspaceOverlayId, group: WorkspaceOverlayGroup) => void;
  releaseOverlay: (id: WorkspaceOverlayId, group: WorkspaceOverlayGroup) => void;
  toggleOverlayPinned: (id: WorkspaceOverlayId, group: WorkspaceOverlayGroup) => void;
  closeOverlay: (id: WorkspaceOverlayId, group: WorkspaceOverlayGroup) => void;
  closeOverlayGroup: (group: WorkspaceOverlayGroup) => void;
};

const WorkspaceFocusContext = createContext<WorkspaceFocusValue>({
  focusMode: false,
  setFocusMode: () => undefined,
  overlayState: INITIAL_WORKSPACE_OVERLAY_STATE,
  openOverlay: () => undefined,
  releaseOverlay: () => undefined,
  toggleOverlayPinned: () => undefined,
  closeOverlay: () => undefined,
  closeOverlayGroup: () => undefined,
});

export function WorkspaceFocusProvider({ children }: { children: ReactNode }) {
  const [focusMode, setFocusMode] = useState(false);
  const [overlayState, dispatchOverlay] = useReducer(workspaceOverlayReducer, INITIAL_WORKSPACE_OVERLAY_STATE);
  const openOverlay = useCallback((id: WorkspaceOverlayId, group: WorkspaceOverlayGroup) => {
    dispatchOverlay({ type: "open", id, group });
  }, []);
  const releaseOverlay = useCallback((id: WorkspaceOverlayId, group: WorkspaceOverlayGroup) => {
    dispatchOverlay({ type: "release", id, group });
  }, []);
  const toggleOverlayPinned = useCallback((id: WorkspaceOverlayId, group: WorkspaceOverlayGroup) => {
    dispatchOverlay({ type: "toggle-pin", id, group });
  }, []);
  const closeOverlay = useCallback((id: WorkspaceOverlayId, group: WorkspaceOverlayGroup) => {
    dispatchOverlay({ type: "close", id, group });
  }, []);
  const closeOverlayGroup = useCallback((group: WorkspaceOverlayGroup) => {
    dispatchOverlay({ type: "close-group", group });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      dispatchOverlay({ type: "close-last" });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (focusMode) return;
    dispatchOverlay({ type: "close-group", group: "workspace-left" });
    dispatchOverlay({ type: "close-group", group: "workspace-right" });
  }, [focusMode]);

  const value = useMemo(() => ({
    focusMode,
    setFocusMode,
    overlayState,
    openOverlay,
    releaseOverlay,
    toggleOverlayPinned,
    closeOverlay,
    closeOverlayGroup,
  }), [closeOverlay, closeOverlayGroup, focusMode, openOverlay, overlayState, releaseOverlay, toggleOverlayPinned]);

  return <WorkspaceFocusContext.Provider value={value}>{children}</WorkspaceFocusContext.Provider>;
}

export function useWorkspaceFocus() {
  return useContext(WorkspaceFocusContext);
}
