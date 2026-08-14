export const WORKSPACE_OVERLAY_GROUPS = ["workspace-left", "workspace-right"] as const;

export type WorkspaceOverlayGroup = (typeof WORKSPACE_OVERLAY_GROUPS)[number];
export type WorkspaceOverlayId =
  | "global-nav"
  | "v4-nav"
  | "os-context"
  | "activity";

export const WORKSPACE_OVERLAY_PRIORITY: Record<WorkspaceOverlayId, number> = {
  "global-nav": 80,
  "v4-nav": 70,
  "os-context": 60,
  activity: 60,
};

/** Rails que entram no layout (empurram o workspace) e persistem o pin. */
export const DOCKABLE_RAIL_IDS = ["global-nav", "v4-nav"] as const;
export type DockableRailId = (typeof DOCKABLE_RAIL_IDS)[number];

export const WORKSPACE_DOCK_STORAGE_KEY = "omnigestao:workspace-focus:docked:v1";

export type WorkspaceOverlayGroupState = {
  /** Overlay temporário (hover/teclado). Exclusivo por grupo. */
  activeOverlay: WorkspaceOverlayId | null;
  /**
   * Compat: último dock deste grupo. Não é mais exclusivo entre rails
   * dockable — a fonte de verdade é `dockedRails`.
   */
  pinnedOverlay: WorkspaceOverlayId | null;
};

export type WorkspaceOverlayState = {
  groups: Record<WorkspaceOverlayGroup, WorkspaceOverlayGroupState>;
  lastActiveGroup: WorkspaceOverlayGroup | null;
  dockedRails: Partial<Record<WorkspaceOverlayId, true>>;
};

export const INITIAL_WORKSPACE_OVERLAY_STATE: WorkspaceOverlayState = {
  groups: {
    "workspace-left": { activeOverlay: null, pinnedOverlay: null },
    "workspace-right": { activeOverlay: null, pinnedOverlay: null },
  },
  lastActiveGroup: null,
  dockedRails: {},
};

export type WorkspaceOverlayAction =
  | { type: "open"; id: WorkspaceOverlayId; group: WorkspaceOverlayGroup }
  | { type: "release"; id: WorkspaceOverlayId; group: WorkspaceOverlayGroup }
  | { type: "toggle-pin"; id: WorkspaceOverlayId; group: WorkspaceOverlayGroup }
  | { type: "close"; id: WorkspaceOverlayId; group: WorkspaceOverlayGroup }
  | { type: "close-group"; group: WorkspaceOverlayGroup }
  | { type: "close-last" }
  | { type: "hydrate-docks"; ids: WorkspaceOverlayId[] };

export function isDockableRailId(id: string): id is DockableRailId {
  return (DOCKABLE_RAIL_IDS as readonly string[]).includes(id);
}

export function isRailDocked(state: WorkspaceOverlayState, id: WorkspaceOverlayId): boolean {
  return state.dockedRails[id] === true;
}

export function parseDockedRailsV1(raw: string | null | undefined): WorkspaceOverlayId[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { v?: number; docked?: unknown };
    if (parsed?.v !== 1 || !Array.isArray(parsed.docked)) return [];
    return parsed.docked.filter((id): id is DockableRailId => typeof id === "string" && isDockableRailId(id));
  } catch {
    return [];
  }
}

export function serializeDockedRailsV1(state: WorkspaceOverlayState): string {
  const docked = DOCKABLE_RAIL_IDS.filter((id) => state.dockedRails[id]);
  return JSON.stringify({ v: 1, docked });
}

function latestRemainingGroup(
  groups: WorkspaceOverlayState["groups"],
  closedGroup: WorkspaceOverlayGroup,
): WorkspaceOverlayGroup | null {
  const other = closedGroup === "workspace-left" ? "workspace-right" : "workspace-left";
  return groups[other].activeOverlay ? other : null;
}

function syncPinnedAlias(
  group: WorkspaceOverlayGroupState,
  dockedRails: WorkspaceOverlayState["dockedRails"],
  groupIds: WorkspaceOverlayId[],
): WorkspaceOverlayGroupState {
  const dockedInGroup = groupIds.find((id) => dockedRails[id]);
  return { ...group, pinnedOverlay: dockedInGroup ?? null };
}

const LEFT_IDS: WorkspaceOverlayId[] = ["global-nav", "v4-nav", "os-context"];
const RIGHT_IDS: WorkspaceOverlayId[] = ["activity"];

export function workspaceOverlayReducer(
  state: WorkspaceOverlayState,
  action: WorkspaceOverlayAction,
): WorkspaceOverlayState {
  if (action.type === "close-last") {
    if (!state.lastActiveGroup) return state;
    return workspaceOverlayReducer(state, { type: "close-group", group: state.lastActiveGroup });
  }

  if (action.type === "hydrate-docks") {
    const dockedRails: WorkspaceOverlayState["dockedRails"] = {};
    for (const id of action.ids) {
      if (isDockableRailId(id)) dockedRails[id] = true;
    }
    return {
      ...state,
      dockedRails,
      groups: {
        "workspace-left": syncPinnedAlias(state.groups["workspace-left"], dockedRails, LEFT_IDS),
        "workspace-right": syncPinnedAlias(state.groups["workspace-right"], dockedRails, RIGHT_IDS),
      },
    };
  }

  const current = state.groups[action.group];
  const groupIds = action.group === "workspace-left" ? LEFT_IDS : RIGHT_IDS;

  if (action.type === "open") {
    return {
      ...state,
      groups: {
        ...state.groups,
        [action.group]: { ...current, activeOverlay: action.id },
      },
      lastActiveGroup: action.group,
    };
  }

  if (action.type === "release") {
    if (current.activeOverlay !== action.id) return state;
    const groups = {
      ...state.groups,
      [action.group]: { ...current, activeOverlay: null },
    };
    return {
      ...state,
      groups,
      lastActiveGroup: state.lastActiveGroup === action.group
        ? latestRemainingGroup(groups, action.group)
        : state.lastActiveGroup,
    };
  }

  if (action.type === "toggle-pin") {
    const docked = state.dockedRails[action.id] === true;
    const dockedRails = { ...state.dockedRails };
    if (docked) delete dockedRails[action.id];
    else dockedRails[action.id] = true;
    return {
      ...state,
      dockedRails,
      groups: {
        ...state.groups,
        [action.group]: syncPinnedAlias(
          { ...current, activeOverlay: action.id },
          dockedRails,
          groupIds,
        ),
      },
      lastActiveGroup: action.group,
    };
  }

  if (action.type === "close") {
    if (current.activeOverlay !== action.id) return state;
    const groups = {
      ...state.groups,
      [action.group]: { ...current, activeOverlay: null },
    };
    return {
      ...state,
      groups,
      lastActiveGroup: state.lastActiveGroup === action.group
        ? latestRemainingGroup(groups, action.group)
        : state.lastActiveGroup,
    };
  }

  // close-group: só o overlay temporário. Docks permanecem.
  const groups = {
    ...state.groups,
    [action.group]: { ...current, activeOverlay: null },
  };
  return {
    ...state,
    groups,
    lastActiveGroup: state.lastActiveGroup === action.group
      ? latestRemainingGroup(groups, action.group)
      : state.lastActiveGroup,
  };
}
