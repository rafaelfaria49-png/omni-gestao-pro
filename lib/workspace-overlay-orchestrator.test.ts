import { describe, expect, it } from "vitest";
import {
  INITIAL_WORKSPACE_OVERLAY_STATE,
  WORKSPACE_DOCK_STORAGE_KEY,
  WORKSPACE_OVERLAY_PRIORITY,
  isRailDocked,
  parseDockedRailsV1,
  serializeDockedRailsV1,
  workspaceOverlayReducer,
} from "./workspace-overlay-orchestrator";

describe("orquestrador de overlays do workspace focado", () => {
  it("mantém somente um overlay temporário no grupo esquerdo", () => {
    const global = workspaceOverlayReducer(INITIAL_WORKSPACE_OVERLAY_STATE, {
      type: "open", id: "global-nav", group: "workspace-left",
    });
    const v4 = workspaceOverlayReducer(global, {
      type: "open", id: "v4-nav", group: "workspace-left",
    });
    expect(v4.groups["workspace-left"].activeOverlay).toBe("v4-nav");
  });

  it("hover não desfaz um dock de outra rail do mesmo grupo", () => {
    const docked = workspaceOverlayReducer(INITIAL_WORKSPACE_OVERLAY_STATE, {
      type: "toggle-pin", id: "global-nav", group: "workspace-left",
    });
    const hover = workspaceOverlayReducer(docked, {
      type: "open", id: "v4-nav", group: "workspace-left",
    });
    expect(isRailDocked(hover, "global-nav")).toBe(true);
    expect(hover.groups["workspace-left"].activeOverlay).toBe("v4-nav");
  });

  it("Global + V4 podem ficar docked simultaneamente", () => {
    const global = workspaceOverlayReducer(INITIAL_WORKSPACE_OVERLAY_STATE, {
      type: "toggle-pin", id: "global-nav", group: "workspace-left",
    });
    const both = workspaceOverlayReducer(global, {
      type: "toggle-pin", id: "v4-nav", group: "workspace-left",
    });
    expect(isRailDocked(both, "global-nav")).toBe(true);
    expect(isRailDocked(both, "v4-nav")).toBe(true);
  });

  it("Escape fecha só o overlay temporário e preserva o dock", () => {
    const docked = workspaceOverlayReducer(INITIAL_WORKSPACE_OVERLAY_STATE, {
      type: "toggle-pin", id: "global-nav", group: "workspace-left",
    });
    const hover = workspaceOverlayReducer(docked, {
      type: "open", id: "os-context", group: "workspace-left",
    });
    const closed = workspaceOverlayReducer(hover, { type: "close-last" });
    expect(closed.groups["workspace-left"].activeOverlay).toBeNull();
    expect(isRailDocked(closed, "global-nav")).toBe(true);
  });

  it("release fecha overlay temporário sem remover dock", () => {
    const docked = workspaceOverlayReducer(INITIAL_WORKSPACE_OVERLAY_STATE, {
      type: "toggle-pin", id: "v4-nav", group: "workspace-left",
    });
    const open = workspaceOverlayReducer(docked, {
      type: "open", id: "v4-nav", group: "workspace-left",
    });
    const released = workspaceOverlayReducer(open, {
      type: "release", id: "v4-nav", group: "workspace-left",
    });
    expect(released.groups["workspace-left"].activeOverlay).toBeNull();
    expect(isRailDocked(released, "v4-nav")).toBe(true);
  });

  it("atividade permanece independente do grupo esquerdo", () => {
    const left = workspaceOverlayReducer(INITIAL_WORKSPACE_OVERLAY_STATE, {
      type: "open", id: "v4-nav", group: "workspace-left",
    });
    const both = workspaceOverlayReducer(left, {
      type: "open", id: "activity", group: "workspace-right",
    });
    expect(both.groups["workspace-left"].activeOverlay).toBe("v4-nav");
    expect(both.groups["workspace-right"].activeOverlay).toBe("activity");
  });

  it("expõe a hierarquia visual Global > V4 > Contexto", () => {
    expect(WORKSPACE_OVERLAY_PRIORITY["global-nav"]).toBeGreaterThan(WORKSPACE_OVERLAY_PRIORITY["v4-nav"]);
    expect(WORKSPACE_OVERLAY_PRIORITY["v4-nav"]).toBeGreaterThan(WORKSPACE_OVERLAY_PRIORITY["os-context"]);
    expect(WORKSPACE_OVERLAY_PRIORITY["os-context"]).toBe(WORKSPACE_OVERLAY_PRIORITY.activity);
  });

  it("serializa só rails dockable e ignora hover", () => {
    const both = workspaceOverlayReducer(
      workspaceOverlayReducer(INITIAL_WORKSPACE_OVERLAY_STATE, {
        type: "toggle-pin", id: "global-nav", group: "workspace-left",
      }),
      { type: "open", id: "os-context", group: "workspace-left" },
    );
    const raw = serializeDockedRailsV1(both);
    expect(WORKSPACE_DOCK_STORAGE_KEY).toContain("docked:v1");
    expect(parseDockedRailsV1(raw)).toEqual(["global-nav"]);
    expect(parseDockedRailsV1("{")).toEqual([]);
    expect(parseDockedRailsV1(JSON.stringify({ v: 2, docked: ["global-nav"] }))).toEqual([]);
  });

  it("hidrata docks persistidos sem reabrir overlay temporário", () => {
    const hydrated = workspaceOverlayReducer(INITIAL_WORKSPACE_OVERLAY_STATE, {
      type: "hydrate-docks",
      ids: ["global-nav", "v4-nav", "os-context"],
    });
    expect(isRailDocked(hydrated, "global-nav")).toBe(true);
    expect(isRailDocked(hydrated, "v4-nav")).toBe(true);
    expect(isRailDocked(hydrated, "os-context")).toBe(false);
    expect(hydrated.groups["workspace-left"].activeOverlay).toBeNull();
  });
});
