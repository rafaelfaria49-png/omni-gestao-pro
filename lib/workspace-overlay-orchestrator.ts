export const WORKSPACE_OVERLAY_GROUPS = ["workspace-left", "workspace-right"] as const;

export type WorkspaceOverlayGroup = (typeof WORKSPACE_OVERLAY_GROUPS)[number];
export type WorkspaceOverlayId =
  | "global-nav"
  | "v4-nav"
  | "entrada-nav"
  | "os-context"
  | "activity";

export const WORKSPACE_OVERLAY_PRIORITY: Record<WorkspaceOverlayId, number> = {
  "global-nav": 80,
  "v4-nav": 70,
  "os-context": 60,
  activity: 60,
  "entrada-nav": 50,
};

export type WorkspaceOverlayGroupState = {
  activeOverlay: WorkspaceOverlayId | null;
  pinnedOverlay: WorkspaceOverlayId | null;
};

export type WorkspaceOverlayState = {
  groups: Record<WorkspaceOverlayGroup, WorkspaceOverlayGroupState>;
  lastActiveGroup: WorkspaceOverlayGroup | null;
};

export const INITIAL_WORKSPACE_OVERLAY_STATE: WorkspaceOverlayState = {
  groups: {
    "workspace-left": { activeOverlay: null, pinnedOverlay: null },
    "workspace-right": { activeOverlay: null, pinnedOverlay: null },
  },
  lastActiveGroup: null,
};

export type WorkspaceOverlayAction =
  | { type: "open"; id: WorkspaceOverlayId; group: WorkspaceOverlayGroup }
  | { type: "release"; id: WorkspaceOverlayId; group: WorkspaceOverlayGroup }
  | { type: "toggle-pin"; id: WorkspaceOverlayId; group: WorkspaceOverlayGroup }
  | { type: "close"; id: WorkspaceOverlayId; group: WorkspaceOverlayGroup }
  | { type: "close-group"; group: WorkspaceOverlayGroup }
  | { type: "close-last" };

function latestRemainingGroup(
  groups: WorkspaceOverlayState["groups"],
  closedGroup: WorkspaceOverlayGroup,
): WorkspaceOverlayGroup | null {
  const other = closedGroup === "workspace-left" ? "workspace-right" : "workspace-left";
  return groups[other].activeOverlay ? other : null;
}

export function workspaceOverlayReducer(
  state: WorkspaceOverlayState,
  action: WorkspaceOverlayAction,
): WorkspaceOverlayState {
  if (action.type === "close-last") {
    if (!state.lastActiveGroup) return state;
    return workspaceOverlayReducer(state, { type: "close-group", group: state.lastActiveGroup });
  }

  const current = state.groups[action.group];

  if (action.type === "open") {
    const replacingPinnedOverlay = current.pinnedOverlay !== null && current.pinnedOverlay !== action.id;
    return {
      groups: {
        ...state.groups,
        [action.group]: {
          activeOverlay: action.id,
          pinnedOverlay: replacingPinnedOverlay ? null : current.pinnedOverlay,
        },
      },
      lastActiveGroup: action.group,
    };
  }

  if (action.type === "release") {
    if (current.activeOverlay !== action.id || current.pinnedOverlay === action.id) return state;
    const groups = {
      ...state.groups,
      [action.group]: { ...current, activeOverlay: null },
    };
    return {
      groups,
      lastActiveGroup: state.lastActiveGroup === action.group
        ? latestRemainingGroup(groups, action.group)
        : state.lastActiveGroup,
    };
  }

  if (action.type === "toggle-pin") {
    const unpinning = current.pinnedOverlay === action.id;
    return {
      groups: {
        ...state.groups,
        [action.group]: {
          activeOverlay: action.id,
          pinnedOverlay: unpinning ? null : action.id,
        },
      },
      lastActiveGroup: action.group,
    };
  }

  if (action.type === "close" && current.activeOverlay !== action.id && current.pinnedOverlay !== action.id) {
    return state;
  }

  const groups = {
    ...state.groups,
    [action.group]: { activeOverlay: null, pinnedOverlay: null },
  };
  return {
    groups,
    lastActiveGroup: state.lastActiveGroup === action.group
      ? latestRemainingGroup(groups, action.group)
      : state.lastActiveGroup,
  };
}
