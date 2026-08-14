import { describe, expect, it } from "vitest";
import {
  INITIAL_WORKSPACE_OVERLAY_STATE,
  WORKSPACE_OVERLAY_PRIORITY,
  workspaceOverlayReducer,
} from "./workspace-overlay-orchestrator";

describe("orquestrador de overlays do workspace focado", () => {
  it("mantém somente um overlay ativo no grupo esquerdo", () => {
    const global = workspaceOverlayReducer(INITIAL_WORKSPACE_OVERLAY_STATE, {
      type: "open", id: "global-nav", group: "workspace-left",
    });
    const v4 = workspaceOverlayReducer(global, {
      type: "open", id: "v4-nav", group: "workspace-left",
    });
    expect(v4.groups["workspace-left"]).toEqual({ activeOverlay: "v4-nav", pinnedOverlay: null });
  });

  it("abrir um novo overlay remove o pin anterior do mesmo grupo", () => {
    const pinned = workspaceOverlayReducer(INITIAL_WORKSPACE_OVERLAY_STATE, {
      type: "toggle-pin", id: "global-nav", group: "workspace-left",
    });
    const entrada = workspaceOverlayReducer(pinned, {
      type: "open", id: "entrada-nav", group: "workspace-left",
    });
    expect(entrada.groups["workspace-left"]).toEqual({ activeOverlay: "entrada-nav", pinnedOverlay: null });
  });

  it("pin é exclusivo e não altera a largura reservada do layout", () => {
    const v4 = workspaceOverlayReducer(INITIAL_WORKSPACE_OVERLAY_STATE, {
      type: "toggle-pin", id: "v4-nav", group: "workspace-left",
    });
    const global = workspaceOverlayReducer(v4, {
      type: "toggle-pin", id: "global-nav", group: "workspace-left",
    });
    expect(global.groups["workspace-left"]).toEqual({ activeOverlay: "global-nav", pinnedOverlay: "global-nav" });
    expect(global).not.toHaveProperty("width");
  });

  it("release fecha overlay não fixado e preserva o fixado", () => {
    const open = workspaceOverlayReducer(INITIAL_WORKSPACE_OVERLAY_STATE, {
      type: "open", id: "entrada-nav", group: "workspace-left",
    });
    expect(workspaceOverlayReducer(open, {
      type: "release", id: "entrada-nav", group: "workspace-left",
    }).groups["workspace-left"].activeOverlay).toBeNull();

    const pinned = workspaceOverlayReducer(INITIAL_WORKSPACE_OVERLAY_STATE, {
      type: "toggle-pin", id: "entrada-nav", group: "workspace-left",
    });
    expect(workspaceOverlayReducer(pinned, {
      type: "release", id: "entrada-nav", group: "workspace-left",
    })).toBe(pinned);
  });

  it("Escape lógico fecha apenas o grupo ativo mais recente", () => {
    const left = workspaceOverlayReducer(INITIAL_WORKSPACE_OVERLAY_STATE, {
      type: "open", id: "os-context", group: "workspace-left",
    });
    const right = workspaceOverlayReducer(left, {
      type: "open", id: "activity", group: "workspace-right",
    });
    const closed = workspaceOverlayReducer(right, { type: "close-last" });
    expect(closed.groups["workspace-right"].activeOverlay).toBeNull();
    expect(closed.groups["workspace-left"].activeOverlay).toBe("os-context");
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

  it("expõe a hierarquia visual explícita exigida", () => {
    expect(WORKSPACE_OVERLAY_PRIORITY["global-nav"]).toBeGreaterThan(WORKSPACE_OVERLAY_PRIORITY["v4-nav"]);
    expect(WORKSPACE_OVERLAY_PRIORITY["v4-nav"]).toBeGreaterThan(WORKSPACE_OVERLAY_PRIORITY["os-context"]);
    expect(WORKSPACE_OVERLAY_PRIORITY["os-context"]).toBeGreaterThan(WORKSPACE_OVERLAY_PRIORITY["entrada-nav"]);
  });
});
