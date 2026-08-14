/** Operações V4 Preview — header de comando: status, total, ação primária, menus. */
"use client";

import type { FocusEvent, PointerEvent } from "react";
import { useEffect, useRef } from "react";
import { UserRound } from "lucide-react";
import { useWorkspaceFocus } from "@/components/painel-inicial/workspace-focus-context";
import { C, fmt } from "../tokens";
import type { V4Vals } from "../use-v4-preview";
import { NI } from "../os-adapter";
import styles from "../operacoes-v4-preview.module.css";

function ContextOverlayTrigger() {
  const { overlayState, openOverlay, releaseOverlay, toggleOverlayPinned } = useWorkspaceFocus();
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupState = overlayState.groups["workspace-left"];
  const expanded = groupState.activeOverlay === "os-context";
  const pinned = groupState.pinnedOverlay === "os-context";

  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  };

  useEffect(() => () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      const drawerHovered = document.querySelector('[data-overlay-id="os-context"]:hover');
      if (!drawerHovered) releaseOverlay("os-context", "workspace-left");
    }, 210);
  };

  const onPointerEnter = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "touch") return;
    clearTimers();
    openTimer.current = setTimeout(() => openOverlay("os-context", "workspace-left"), 160);
  };

  const onBlur = (event: FocusEvent<HTMLButtonElement>) => {
    const next = event.relatedTarget as Element | null;
    if (next?.closest?.('[data-overlay-id="os-context"]')) return;
    scheduleClose();
  };

  return (
    <button
      type="button"
      data-overlay-trigger="os-context"
      onPointerEnter={onPointerEnter}
      onPointerLeave={scheduleClose}
      onFocus={() => openOverlay("os-context", "workspace-left")}
      onBlur={onBlur}
      onClick={() => toggleOverlayPinned("os-context", "workspace-left")}
      aria-label="Contexto da OS"
      aria-expanded={expanded}
      aria-pressed={pinned}
      title="Contexto da OS"
      className="grid h-[33px] w-[33px] place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <UserRound size={14} />
    </button>
  );
}

export function CommandHeader({ v }: { v: V4Vals }) {
  const financial = v.financial;
  const projection = financial.projection;
  const financialWarning = projection?.consistencyStatus === "INCONSISTENT" || projection?.consistencyStatus === "UNKNOWN";
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 8,
        minHeight: 46,
        padding: "7px 14px",
        background: C.surface,
        borderBottom: `1px solid ${C.line}`,
      }}
    >
      {/* Grupo esquerdo: identidade da OS */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, flex: "1 1 auto", minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: "-.01em", color: C.ink, whiteSpace: "nowrap", flex: "none" }}>{v.os.codigo}</h1>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 22, padding: "0 9px", background: v.tone.bg, color: v.tone.fg, borderRadius: 999, fontSize: 11.5, fontWeight: 600, flex: "none", whiteSpace: "nowrap" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: v.tone.dot, flex: "none" }} />{v.statusLabel}
        </span>
        {v.osSelected && (
          <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", background: financialWarning || financial.error ? C.dangerBg : projection?.financialStatus === "PAID" ? C.successBg : C.warnBg, color: financialWarning || financial.error ? C.dangerFg : projection?.financialStatus === "PAID" ? C.successFg : C.warnFg, borderRadius: 999, fontSize: 11.5, fontWeight: 600, flex: "none", whiteSpace: "nowrap" }}>
            {financial.error ? "Financeiro indisponível" : financial.statusLabel}
          </span>
        )}
        {v.os.sla !== NI && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 22, padding: "0 9px", background: C.successBg, color: C.successFg, borderRadius: 999, fontSize: 11.5, fontWeight: 600, flex: "none", whiteSpace: "nowrap" }}>⏱ SLA {v.os.sla}</span>
        )}
      </div>

      {/* Grupo direito: financeiro + ações */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
        {(financial.loading || financial.error || projection) && (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
              {financial.loading ? (
                <span style={{ fontSize: 11.5, color: C.subtle }}>Carregando financeiro…</span>
              ) : financial.error || !projection ? (
                <span style={{ fontSize: 11.5, color: C.dangerFg }}>Valores indisponíveis</span>
              ) : (
                <>
                  <span style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>
                    {projection.expectedTotal == null ? "Total indisponível" : fmt(projection.expectedTotal)}
                  </span>
                  {projection.receivedTotal != null && <span style={{ fontSize: 10.5, color: C.successFg }}>recebido {fmt(projection.receivedTotal)}</span>}
                  {projection.balance != null && <span style={{ fontSize: 10.5, color: projection.balance > 0 ? C.warnFg : C.subtle }}>saldo {fmt(projection.balance)}</span>}
                </>
              )}
            </div>
            <span style={{ width: 1, height: 26, background: C.line2, flex: "none" }} />
          </>
        )}

        {v.focusActive ? <ContextOverlayTrigger /> : null}

        {/* Dropdown Docs — ancorado ao botão via position:relative */}
        <div style={{ position: "relative", flex: "none" }}>
          <button type="button" onClick={v.togglePrint} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 10px", border: `1px solid ${C.inputBd}`, background: C.surface, color: C.body, borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>🖨 Docs ▾</button>
          {v.menuPrint && (
            <>
              <button type="button" onClick={v.closeMenus} style={{ position: "fixed", inset: 0, zIndex: 40, border: "none", background: "transparent", cursor: "default" }} />
              <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, zIndex: 50, width: 248, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 11, boxShadow: "0 12px 32px rgba(17,19,26,.16)", padding: 6 }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em", color: C.subtle, fontWeight: 700, padding: "6px 9px 4px" }}>Imprimir / documentos</div>
                {v.printItems.map((d) => (
                  <button key={d.label} type="button" onClick={d.onClick} className={styles.hoverSurface} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", border: "none", background: "transparent", borderRadius: 7, padding: "8px 9px", fontSize: 12.5, color: C.body, cursor: "pointer" }}>
                    <span style={{ width: 16, textAlign: "center" }}>{d.icon}</span>{d.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {v.hasPrimary && (
          <button type="button" onClick={v.onPrimary} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 33, padding: "0 14px", border: "none", background: C.primary, color: C.white, borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 1px 2px rgba(79,70,229,.3)", whiteSpace: "nowrap", flex: "none" }}>
            ✦ {v.primaryLabel}
            {v.showKbd && <kbd style={{ fontSize: 10, background: "rgba(255,255,255,.22)", borderRadius: 4, padding: "1px 5px" }}>↵</kbd>}
          </button>
        )}
        {v.noPrimary && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 33, padding: "0 12px", background: C.successBg2, color: C.successFg, borderRadius: 9, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", flex: "none" }}>✓ Fluxo concluído</span>
        )}

        {/* Dropdown Mais ações — ancorado ao botão via position:relative */}
        <div style={{ position: "relative", flex: "none" }}>
          <button type="button" onClick={v.toggleMore} title="Mais ações" style={{ width: 33, height: 33, border: `1px solid ${C.inputBd}`, background: C.surface, color: C.muted, borderRadius: 9, fontSize: 16, cursor: "pointer" }}>⋯</button>
          {v.menuMore && (
            <>
              <button type="button" onClick={v.closeMenus} style={{ position: "fixed", inset: 0, zIndex: 40, border: "none", background: "transparent", cursor: "default" }} />
              <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, zIndex: 50, width: 236, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 11, boxShadow: "0 12px 32px rgba(17,19,26,.16)", padding: 6 }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em", color: C.subtle, fontWeight: 700, padding: "6px 9px 4px" }}>Ações da OS</div>
                {v.moreItems.map((m) => (
                  <button key={m.label} type="button" onClick={m.onClick} className={styles.hoverSurface} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", border: "none", background: "transparent", borderRadius: 7, padding: "8px 9px", fontSize: 12.5, color: m.color, cursor: "pointer" }}>
                    <span style={{ width: 16, textAlign: "center" }}>{m.icon}</span>{m.label}
                  </button>
                ))}
                <div style={{ fontSize: 10.5, color: C.faint2, padding: "6px 9px 3px", borderTop: `1px solid ${C.line3}`, marginTop: 4 }}>Ações reais (ex.: cancelar OS) são persistidas no sistema. Itens sem efeito mostram aviso ao clicar.</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
