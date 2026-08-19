/** Operações V4 — header de comando: identidade, comercial, financeiro, histórico. */
"use client";

import type { FocusEvent, PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { History, UserRound } from "lucide-react";
import { useWorkspaceFocus } from "@/components/painel-inicial/workspace-focus-context";
import { C } from "../tokens";
import type { V4Vals } from "../use-v4-preview";
import { NI } from "../os-adapter";
import styles from "../operacoes-v4-preview.module.css";
import { PrioridadePickerV4, TecnicoPickerV4 } from "./ProducaoControlesV4";
import pickerStyles from "./bancada-v4.module.css";

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

const TONE_FG: Record<string, string> = {
  neutro: C.ink,
  info: C.infoFg,
  warn: C.warnFg,
  success: C.successFg,
  danger: C.dangerFg,
};

export function CommandHeader({ v }: { v: V4Vals }) {
  const comercial = v.comercialHeader;
  const financeiro = v.financeiroHeader;
  const historico = v.historicoHeader;
  const slaAlert = v.os.sla !== NI && /estourado|atenção|atras/i.test(v.os.sla);
  const producao = v.producaoAtual;
  const posVendaLabel = (() => {
    if (v.posVenda.retornoAberto?.osRetornoCodigo) return `Retorno · ${v.posVenda.retornoAberto.osRetornoCodigo}`;
    if (v.posVenda.retornoAberto) return "Retorno aberto";
    if (v.posVenda.vinculoOrigem) return `Retorno de ${v.posVenda.vinculoOrigem.osOrigemCodigo || "OS original"}`;
    const garantia = v.posVenda.garantia;
    if (garantia.situacao === "ativa" && garantia.vencimento) {
      const data = new Date(garantia.vencimento);
      if (!Number.isNaN(data.getTime())) return `Garantia até ${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(data)}`;
    }
    if (garantia.situacao === "vencida") return "Garantia vencida";
    if (garantia.situacao === "prevista" && garantia.prazoDias > 0) return `Garantia ${garantia.prazoDias} dias`;
    return garantia.situacao === "sem_garantia" ? "Sem cobertura" : "Sem garantia";
  })();
  const [prodOpen, setProdOpen] = useState<null | "tec" | "prio">(null);
  const [prodBusy, setProdBusy] = useState(false);

  return (
    <div className={styles.headerBar}>
      <div className={styles.headerIdentity}>
        {v.focusActive ? <ContextOverlayTrigger /> : null}
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: "-.01em", color: C.ink, whiteSpace: "nowrap", flex: "none" }}>{v.os.codigo}</h1>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 22, padding: "0 9px", background: v.tone.bg, color: v.tone.fg, borderRadius: 999, fontSize: 11.5, fontWeight: 600, flex: "none", whiteSpace: "nowrap" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: v.tone.dot, flex: "none" }} />{v.statusLabel}
        </span>
        {v.os.sla !== NI && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 22, padding: "0 9px", background: slaAlert ? C.warnBg : C.successBg, color: slaAlert ? C.warnFg : C.successFg, borderRadius: 999, fontSize: 11.5, fontWeight: 600, flex: "none", whiteSpace: "nowrap" }}>
            ⏱ SLA {v.os.sla}
          </span>
        )}
        {v.osSelected && producao ? (
          <div className={pickerStyles.wrap} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              className={styles.headerTicket}
              style={{ maxWidth: 180, height: 34 }}
              onClick={() => setProdOpen(prodOpen === "tec" ? null : "tec")}
              title="Técnico responsável"
            >
              <span className={styles.headerTicketEyebrow}>Técnico</span>
              <span className={styles.headerTicketLabel}>{producao.tecnicoNome ?? "Sem técnico"}</span>
            </button>
            <button
              type="button"
              className={styles.headerTicket}
              style={{ maxWidth: 140, height: 34 }}
              onClick={() => setProdOpen(prodOpen === "prio" ? null : "prio")}
              title="Prioridade"
            >
              <span className={styles.headerTicketEyebrow}>Prioridade</span>
              <span className={styles.headerTicketLabel}>{producao.prioridadeLabel}</span>
            </button>
            {prodOpen === "tec" && v.selectedOsId ? (
              <>
                <button type="button" onClick={() => setProdOpen(null)} style={{ position: "fixed", inset: 0, border: 0, background: "transparent", zIndex: 30 }} aria-label="Fechar" />
                <TecnicoPickerV4
                  conhecidos={v.producaoBancada.tecnicosConhecidos}
                  atualNome={producao.tecnicoNome}
                  pending={prodBusy}
                  onAtribuir={async (nome, id) => {
                    setProdBusy(true);
                    try {
                      return await v.atribuirTecnico(v.selectedOsId!, nome, id);
                    } finally {
                      setProdBusy(false);
                    }
                  }}
                  onRemover={
                    producao.semTecnico
                      ? undefined
                      : async () => {
                          setProdBusy(true);
                          try {
                            return await v.removerTecnico(v.selectedOsId!);
                          } finally {
                            setProdBusy(false);
                          }
                        }
                  }
                  onClose={() => setProdOpen(null)}
                />
              </>
            ) : null}
            {prodOpen === "prio" && v.selectedOsId ? (
              <>
                <button type="button" onClick={() => setProdOpen(null)} style={{ position: "fixed", inset: 0, border: 0, background: "transparent", zIndex: 30 }} aria-label="Fechar" />
                <PrioridadePickerV4
                  atual={producao.prioridade}
                  pending={prodBusy}
                  onEscolher={async (p) => {
                    setProdBusy(true);
                    try {
                      return await v.definirPrioridade(v.selectedOsId!, p);
                    } finally {
                      setProdBusy(false);
                    }
                  }}
                  onClose={() => setProdOpen(null)}
                />
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={styles.headerOps}>
        {v.osSelected ? <span className={styles.headerDivider} aria-hidden /> : null}

        {v.osSelected && (
          <button
            type="button"
            onClick={() => v.openHeaderDestino(comercial.destino)}
            aria-current={v.isOrc ? "page" : undefined}
            title="Abrir orçamento"
            className={`${styles.headerTicket} ${v.isOrc ? styles.headerTicketCurrent : ""}`}
          >
            <span className={styles.headerTicketEyebrow}>{comercial.eyebrow}</span>
            <span className={styles.headerTicketLabel} style={{ color: TONE_FG[comercial.tone] }}>{comercial.label}</span>
          </button>
        )}

        {v.osSelected && (
          <button
            type="button"
            onClick={() => v.openHeaderDestino(financeiro.destino)}
            aria-current={v.isFin ? "page" : undefined}
            title={financeiro.cta ?? "Abrir financeiro"}
            className={`${styles.headerTicket} ${v.isFin ? styles.headerTicketCurrent : ""}`}
          >
            <span className={styles.headerTicketEyebrow}>{financeiro.eyebrow}</span>
            <span className={styles.headerTicketMeta}>
              <span className={styles.headerTicketLabel} style={{ color: TONE_FG[financeiro.tone] }}>{financeiro.label}</span>
              {financeiro.cta ? <span className={styles.headerTicketCta}>{financeiro.cta}</span> : null}
            </span>
          </button>
        )}

        {v.osSelected && (
          <button
            type="button"
            onClick={() => v.openHeaderDestino("posvenda")}
            aria-current={v.isPos ? "page" : undefined}
            title="Abrir pós-venda"
            className={`${styles.headerTicket} ${v.isPos ? styles.headerTicketCurrent : ""}`}
            style={{ maxWidth: 150 }}
          >
            <span className={styles.headerTicketEyebrow}>Pós-venda</span>
            <span className={styles.headerTicketLabel} style={{ color: v.posVenda.retornoAberto ? C.warnFg : v.posVenda.garantia.tone === "success" ? C.successFg : C.muted }}>{posVendaLabel}</span>
          </button>
        )}

        {v.osSelected ? <span className={styles.headerDivider} aria-hidden /> : null}

        <div style={{ position: "relative", flex: "none" }}>
          <button type="button" onClick={v.togglePrint} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 36, padding: "0 10px", border: `1px solid ${C.inputBd}`, background: C.surface, color: C.body, borderRadius: 9, fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>Docs ▾</button>
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

        {v.osSelected && (
          <button
            type="button"
            onClick={v.goHistorico}
            aria-current={v.isHist ? "page" : undefined}
            title={historico.countLabel ? `Histórico · ${historico.countLabel}` : "Histórico da OS"}
            className={`${styles.headerHistory} ${v.isHist ? styles.headerHistoryCurrent : ""}`}
          >
            <History size={14} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>Histórico</span>
            {historico.countLabel ? <span className={styles.headerHistoryCount}>{historico.countLabel}</span> : null}
          </button>
        )}

        {v.hasPrimary && (
          <button type="button" onClick={v.onPrimary} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 33, padding: "0 14px", border: "none", background: C.primary, color: C.white, borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 1px 2px rgba(79,70,229,.3)", whiteSpace: "nowrap", flex: "none" }}>
            ✦ {v.primaryLabel}
            {v.showKbd && <kbd style={{ fontSize: 10, background: "rgba(255,255,255,.22)", borderRadius: 4, padding: "1px 5px" }}>↵</kbd>}
          </button>
        )}
        {v.noPrimary && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 33, padding: "0 12px", background: C.successBg2, color: C.successFg, borderRadius: 9, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", flex: "none" }}>✓ Fluxo concluído</span>
        )}

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
