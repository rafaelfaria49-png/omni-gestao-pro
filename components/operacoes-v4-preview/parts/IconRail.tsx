/** Operações V4 Preview — rail de ícones (62px) com navegação por módulo. */
import { Pin } from "lucide-react";
import { CollapsibleHoverRail } from "@/components/ui/collapsible-hover-rail";
import { WORKSPACE_OVERLAY_PRIORITY } from "@/lib/workspace-overlay-orchestrator";
import { C } from "../tokens";
import type { V4Vals } from "../use-v4-preview";
import { GearIcon, RailIcon } from "./icons";

export function IconRail({ v }: { v: V4Vals }) {
  if (v.focusActive) {
    return (
      <CollapsibleHoverRail
        ariaLabel="Módulos de Operações V4"
        compactWidth={54}
        expandedWidth={196}
        overlayId="v4-nav"
        overlayGroup="workspace-left"
        priority={WORKSPACE_OVERLAY_PRIORITY["v4-nav"]}
        panelClassName="!bg-card"
      >
        {({ expanded, pinned, togglePinned, collapse }) => (
          <div style={{ width: 196, height: "100%", display: "flex", flexDirection: "column", padding: "8px 7px" }}>
            <div style={{ height: 30, display: "flex", alignItems: "center", padding: "0 7px", marginBottom: 5 }}>
              <button type="button" onClick={togglePinned} aria-label={expanded ? (pinned ? "Desafixar módulos" : "Fixar módulos abertos") : "Expandir módulos"} aria-pressed={pinned} style={{ width: 25, height: 28, flex: "none", display: "grid", placeItems: "center", padding: 0, border: 0, background: "transparent", color: C.primary, fontSize: 10, fontWeight: 800, letterSpacing: ".08em", cursor: "pointer" }}>V4</button>
              <span style={{ opacity: expanded ? 1 : 0, transition: "opacity 160ms", whiteSpace: "nowrap", fontSize: 11, fontWeight: 700, color: C.subtle }}>OPERAÇÕES</span>
              {expanded ? (
                <button
                  type="button"
                  onClick={togglePinned}
                  aria-label={pinned ? "Desafixar módulos" : "Fixar módulos abertos"}
                  aria-pressed={pinned}
                  title={pinned ? "Desafixar" : "Fixar aberto"}
                  style={{ marginLeft: "auto", width: 28, height: 28, display: "grid", placeItems: "center", border: 0, borderRadius: 7, background: pinned ? C.primaryBg : "transparent", color: pinned ? C.primary : C.subtle, cursor: "pointer" }}
                >
                  <Pin size={13} fill={pinned ? "currentColor" : "none"} />
                </button>
              ) : null}
            </div>
            {v.rail.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  r.onClick();
                  collapse();
                }}
                title={!expanded ? r.label : undefined}
                aria-current={r.bg !== "transparent" ? "page" : undefined}
                style={{
                  height: 40,
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "0 8px",
                  border: "none",
                  borderRadius: 9,
                  background: r.bg,
                  color: r.fg,
                  cursor: "pointer",
                  overflow: "hidden",
                  flex: "none",
                }}
              >
                <span style={{ width: 23, flex: "none", display: "grid", placeItems: "center" }}><RailIcon id={r.id} /></span>
                <span style={{ opacity: expanded ? 1 : 0, transition: "opacity 160ms", whiteSpace: "nowrap", fontSize: 12, fontWeight: 650 }}>{r.label}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                v.railSettings();
                collapse();
              }}
              title={!expanded ? "Configurações" : undefined}
              style={{ marginTop: "auto", height: 40, display: "flex", alignItems: "center", gap: 11, padding: "0 8px", border: 0, borderRadius: 9, background: "transparent", color: C.subtle, cursor: "pointer" }}
            >
              <span style={{ width: 23, flex: "none", display: "grid", placeItems: "center" }}><GearIcon /></span>
              <span style={{ opacity: expanded ? 1 : 0, transition: "opacity 160ms", whiteSpace: "nowrap", fontSize: 12, fontWeight: 650 }}>Configurações</span>
            </button>
          </div>
        )}
      </CollapsibleHoverRail>
    );
  }

  return (
    <nav
      style={{
        flex: "none",
        width: 62,
        background: C.surface3,
        borderRight: `1px solid ${C.line}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        padding: "7px 0",
        gap: 1,
      }}
    >
      {v.rail.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={r.onClick}
          title={r.label}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 3,
            margin: "0 7px",
            padding: "7px 0 6px",
            border: "none",
            background: r.bg,
            color: r.fg,
            borderRadius: 10,
            cursor: "pointer",
          }}
        >
          <span style={{ display: "inline-flex" }}>
            <RailIcon id={r.id} />
          </span>
          <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: ".01em", lineHeight: 1 }}>
            {r.label}
          </span>
        </button>
      ))}
      <button
        type="button"
        onClick={v.railSettings}
        title="Configurações"
        style={{
          margin: "auto 7px 2px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 3,
          padding: "7px 0 6px",
          border: "none",
          background: "transparent",
          color: C.subtle,
          borderRadius: 10,
          cursor: "pointer",
        }}
      >
        <GearIcon />
        <span style={{ fontSize: 9, fontWeight: 600, lineHeight: 1 }}>Config</span>
      </button>
    </nav>
  );
}
