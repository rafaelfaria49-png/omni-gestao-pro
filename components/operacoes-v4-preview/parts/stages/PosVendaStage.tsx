"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Clock3, RotateCcw, ShieldCheck, X } from "lucide-react";
import type { RetornoV3 } from "@/lib/operacoes-v3/pos-venda-model";
import { C, card, cardTitle, upLabel } from "../../tokens";
import type { V4Vals } from "../../use-v4-preview";

const sectionGrid = "repeat(auto-fit, minmax(min(100%, 320px), 1fr))";

const toneStyle: Record<string, { background: string; color: string; border: string }> = {
  success: { background: C.successBg, color: C.successFg, border: C.successBd },
  info: { background: C.infoBg, color: C.infoFg, border: C.infoBd },
  warn: { background: C.warnBg, color: C.warnFg, border: C.warnBd },
  danger: { background: C.dangerBg, color: C.dangerFg, border: C.dangerBd },
  neutro: { background: C.muted100, color: C.muted, border: C.line2 },
};

const primaryButton: CSSProperties = {
  minHeight: 36,
  padding: "0 14px",
  border: 0,
  borderRadius: 8,
  background: C.primary,
  color: C.white,
  fontSize: 12.5,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButton: CSSProperties = {
  minHeight: 36,
  padding: "0 14px",
  border: `1px solid ${C.inputBd}`,
  borderRadius: 8,
  background: C.surface,
  color: C.body,
  fontSize: 12.5,
  fontWeight: 650,
  cursor: "pointer",
};

function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR").format(date);
}

function formatDateTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function Badge({ children, tone }: { children: ReactNode; tone: string }) {
  const colors = toneStyle[tone] ?? toneStyle.neutro;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minHeight: 22, padding: "0 8px", border: `1px solid ${colors.border}`, borderRadius: 999, background: colors.background, color: colors.color, fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>
      <span aria-hidden style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />
      {children}
    </span>
  );
}

function DataPoint({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={upLabel}>{label}</div>
      <div style={{ marginTop: 3, color: C.body, fontSize: strong ? 18 : 12.5, lineHeight: 1.35, fontWeight: strong ? 750 : 600, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}

function Modal({ title, onClose, children, footer, initialFocus }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode; initialFocus?: RefObject<HTMLInputElement | HTMLTextAreaElement | null> }) {
  useEffect(() => {
    initialFocus?.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [initialFocus, onClose]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "center", padding: 16 }}>
      <button type="button" aria-label="Fechar janela" onClick={onClose} style={{ position: "absolute", inset: 0, border: 0, background: "rgba(17, 19, 26, .46)", cursor: "default" }} />
      <section role="dialog" aria-modal="true" aria-label={title} style={{ position: "relative", width: "min(100%, 480px)", maxHeight: "min(680px, calc(100vh - 32px))", overflow: "auto", border: `1px solid ${C.line}`, borderRadius: 12, background: C.surface, boxShadow: "0 24px 70px rgba(17, 19, 26, .26)" }}>
        <header style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", alignItems: "center", gap: 12, minHeight: 52, padding: "0 16px", borderBottom: `1px solid ${C.line2}`, background: C.surface }}>
          <h2 style={{ flex: 1, margin: 0, color: C.ink, fontSize: 14, fontWeight: 750 }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ width: 32, height: 32, display: "grid", placeItems: "center", border: 0, borderRadius: 8, background: "transparent", color: C.muted, cursor: "pointer" }}><X size={16} /></button>
        </header>
        <div style={{ padding: 16 }}>{children}</div>
        <footer style={{ position: "sticky", bottom: 0, display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 16px", borderTop: `1px solid ${C.line2}`, background: C.surface, flexWrap: "wrap" }}>{footer}</footer>
      </section>
    </div>
  );
}

function RetornoResumo({ retorno, emphasis = false }: { retorno: RetornoV3; emphasis?: boolean }) {
  const tone = retorno.status === "aberto" ? "warn" : "success";
  return (
    <article style={{ border: `1px solid ${emphasis ? C.warnBd : C.line2}`, borderLeft: `3px solid ${emphasis ? C.warn : C.line2}`, borderRadius: 9, background: emphasis ? C.warnBg : C.surface2, padding: "11px 12px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: C.body, fontSize: 12.5, fontWeight: 700, lineHeight: 1.4, overflowWrap: "anywhere" }}>{retorno.motivo || "Motivo não informado"}</div>
          <div style={{ marginTop: 3, color: C.subtle, fontSize: 10.5 }}>Aberto em {formatDateTime(retorno.criadoEm)}{retorno.criadoPor ? ` · ${retorno.criadoPor}` : ""}</div>
        </div>
        <Badge tone={tone}>{retorno.status === "aberto" ? "Em andamento" : "Finalizado"}</Badge>
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap", color: C.muted, fontSize: 11 }}>
        <span>OS original: <strong style={{ color: C.body }}>{retorno.osOriginalCodigo || retorno.osOriginalId}</strong></span>
        {typeof retorno.garantiaAtivaNaAbertura === "boolean" ? <span>Cobertura: <strong style={{ color: C.body }}>{retorno.garantiaAtivaNaAbertura ? "dentro da garantia" : "fora da garantia"}</strong></span> : null}
      </div>
      {retorno.status === "finalizado" ? (
        <div style={{ marginTop: 9, paddingTop: 9, borderTop: `1px solid ${C.line3}` }}>
          {retorno.observacaoFinal ? <div style={{ color: C.body, fontSize: 12, lineHeight: 1.5 }}><strong>Resolução:</strong> {retorno.observacaoFinal}</div> : null}
          {retorno.finalizadoEm ? <div style={{ marginTop: 2, color: C.subtle, fontSize: 10.5 }}>Finalizado em {formatDateTime(retorno.finalizadoEm)}{retorno.finalizadoPor ? ` · ${retorno.finalizadoPor}` : ""}</div> : null}
        </div>
      ) : null}
    </article>
  );
}

export function PosVendaStage({ v }: { v: V4Vals }) {
  const posVenda = v.posVenda;
  const garantia = posVenda.garantia;
  const [abrirOpen, setAbrirOpen] = useState(false);
  const [finalizar, setFinalizar] = useState<RetornoV3 | null>(null);
  const [motivo, setMotivo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [busy, setBusy] = useState<"abrir" | "finalizar" | null>(null);
  const motivoRef = useRef<HTMLTextAreaElement>(null);
  const observacaoRef = useRef<HTMLTextAreaElement>(null);
  const abrirTriggerRef = useRef<HTMLButtonElement>(null);
  const finalizarTriggerRef = useRef<HTMLButtonElement>(null);

  const closeAbrir = useCallback(() => {
    if (busy) return;
    setAbrirOpen(false);
    queueMicrotask(() => abrirTriggerRef.current?.focus());
  }, [busy]);
  const closeFinalizar = useCallback(() => {
    if (busy) return;
    setFinalizar(null);
    queueMicrotask(() => finalizarTriggerRef.current?.focus());
  }, [busy]);

  const abrirRetorno = async () => {
    if (busy || !motivo.trim()) return;
    setBusy("abrir");
    try {
      const ok = await v.abrirRetorno(motivo.trim());
      if (ok) {
        setMotivo("");
        setAbrirOpen(false);
        queueMicrotask(() => abrirTriggerRef.current?.focus());
      }
    } finally {
      setBusy(null);
    }
  };

  const finalizarRetorno = async () => {
    if (busy || !finalizar) return;
    setBusy("finalizar");
    try {
      const ok = await v.finalizarRetorno(finalizar.id, observacao.trim() || undefined);
      if (ok) {
        setObservacao("");
        setFinalizar(null);
        queueMicrotask(() => finalizarTriggerRef.current?.focus());
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: sectionGrid, gap: 12, alignItems: "stretch" }}>
        <section style={{ ...card, borderTop: `3px solid ${garantia.tone === "success" ? C.success : garantia.tone === "warn" ? C.warn : C.line2}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
            <span style={{ ...cardTitle, display: "inline-flex", alignItems: "center", gap: 7 }}><ShieldCheck size={15} aria-hidden /> Garantia</span>
            <Badge tone={garantia.tone}>{garantia.situacaoLabel}</Badge>
          </div>
          {garantia.temGarantia ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "13px 18px" }}>
                <DataPoint label="Prazo" value={garantia.prazoDias > 0 ? `${garantia.prazoDias} dias` : "Sem cobertura"} strong />
                <DataPoint label={garantia.situacao === "vencida" ? "Garantia vencida em" : "Válida até"} value={garantia.vencimento ? formatDate(garantia.vencimento) : garantia.situacao === "prevista" ? "Após a entrega" : "—"} strong />
                <DataPoint label="Tipo" value={garantia.label || "Não informado"} />
                <DataPoint label="Início" value={garantia.inicio ? formatDate(garantia.inicio) : "Na entrega"} />
              </div>
              {garantia.origem ? <div style={{ marginTop: 13, paddingTop: 10, borderTop: `1px solid ${C.line3}`, color: C.subtle, fontSize: 11 }}>{garantia.origem}</div> : null}
            </>
          ) : (
            <div style={{ padding: "18px 0 8px", color: C.muted, fontSize: 13, fontWeight: 650 }}>Sem garantia registrada</div>
          )}
        </section>

        <section style={{ ...card, borderTop: `3px solid ${posVenda.retornoAberto ? C.warn : C.line2}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
            <span style={{ ...cardTitle, display: "inline-flex", alignItems: "center", gap: 7 }}><RotateCcw size={15} aria-hidden /> Retorno</span>
            <Badge tone={posVenda.elegibilidade.tone}>{posVenda.elegibilidade.label}</Badge>
          </div>
          {posVenda.retornoAberto ? (
            <>
              <RetornoResumo retorno={posVenda.retornoAberto} emphasis />
              <button ref={finalizarTriggerRef} type="button" disabled={busy !== null} onClick={() => setFinalizar(posVenda.retornoAberto ?? null)} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ ...primaryButton, width: "100%", marginTop: 11, background: C.ink, opacity: busy ? .65 : 1 }}>
                Finalizar retorno
              </button>
            </>
          ) : (
            <>
              <div style={{ padding: "8px 0 2px", color: C.body, fontSize: 13, fontWeight: 700 }}>Nenhum retorno em andamento.</div>
              <p style={{ margin: "5px 0 13px", color: C.subtle, fontSize: 11.5, lineHeight: 1.5 }}>{posVenda.elegibilidade.descricao}</p>
              <button ref={abrirTriggerRef} type="button" disabled={!posVenda.podeAbrirRetorno || busy !== null} onClick={() => setAbrirOpen(true)} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ ...primaryButton, width: "100%", opacity: !posVenda.podeAbrirRetorno || busy ? .55 : 1 }}>
                {posVenda.elegibilidade.id === "fora_garantia" ? "Registrar retorno fora da garantia" : "Abrir retorno"}
              </button>
            </>
          )}
        </section>
      </div>

      <section style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
          <span style={{ ...cardTitle, display: "inline-flex", alignItems: "center", gap: 7 }}><Clock3 size={15} aria-hidden /> Histórico de pós-venda</span>
          <span style={{ color: C.subtle, fontSize: 11 }}>{posVenda.historico.length} retorno(s)</span>
        </div>
        {posVenda.historico.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: sectionGrid, gap: 9 }}>
            {posVenda.historico.map((retorno) => <RetornoResumo key={retorno.id} retorno={retorno} emphasis={retorno.status === "aberto"} />)}
          </div>
        ) : posVenda.timeline.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {posVenda.timeline.map((evento) => (
              <div key={evento.id} style={{ display: "grid", gridTemplateColumns: "82px 1fr", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.line4}` }}>
                <span style={{ color: C.subtle, fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}>{formatDate(evento.criadoEm)}</span>
                <span style={{ color: C.body, fontSize: 12 }}>{evento.texto}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: "18px 0", color: C.subtle, fontSize: 12.5 }}>Nenhum retorno anterior registrado nesta OS.</div>
        )}
      </section>

      {abrirOpen ? (
        <Modal
          title="Abrir retorno"
          onClose={closeAbrir}
          initialFocus={motivoRef}
          footer={<><button type="button" disabled={!!busy} onClick={closeAbrir} style={secondaryButton}>Cancelar</button><button type="button" disabled={!!busy || !motivo.trim()} onClick={() => void abrirRetorno()} style={{ ...primaryButton, opacity: busy || !motivo.trim() ? .55 : 1 }}>{busy === "abrir" ? "Abrindo…" : "Abrir retorno"}</button></>}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginBottom: 14 }}>
            <DataPoint label="OS original" value={v.os.codigo} />
            <DataPoint label="Garantia" value={garantia.situacao === "ativa" && garantia.vencimento ? `Vigente até ${formatDate(garantia.vencimento)}` : posVenda.elegibilidade.label} />
          </div>
          <label style={{ display: "block" }}>
            <span style={{ display: "block", marginBottom: 6, color: C.body, fontSize: 12, fontWeight: 700 }}>Motivo</span>
            <textarea ref={motivoRef} rows={4} maxLength={1000} value={motivo} onChange={(event) => setMotivo(event.target.value)} placeholder="Descreva o que voltou a falhar" style={{ width: "100%", resize: "vertical", minHeight: 96, padding: 10, border: `1px solid ${C.inputBd}`, borderRadius: 8, background: C.surface, color: C.body, font: "inherit", fontSize: 12.5, lineHeight: 1.5, boxSizing: "border-box" }} />
          </label>
          {posVenda.elegibilidade.id === "fora_garantia" ? <p style={{ margin: "9px 0 0", color: C.warnFg, fontSize: 11.5 }}>Este registro não confirma cobertura nem cria cobrança automática.</p> : null}
        </Modal>
      ) : null}

      {finalizar ? (
        <Modal
          title="Finalizar retorno"
          onClose={closeFinalizar}
          initialFocus={observacaoRef}
          footer={<><button type="button" disabled={!!busy} onClick={closeFinalizar} style={secondaryButton}>Cancelar</button><button type="button" disabled={!!busy} onClick={() => void finalizarRetorno()} style={{ ...primaryButton, background: C.ink, opacity: busy ? .55 : 1 }}>{busy === "finalizar" ? "Finalizando…" : "Finalizar retorno"}</button></>}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginBottom: 14 }}>
            <DataPoint label="Aberto em" value={formatDateTime(finalizar.criadoEm)} />
            <DataPoint label="Motivo" value={finalizar.motivo || "Não informado"} />
          </div>
          <label style={{ display: "block" }}>
            <span style={{ display: "block", marginBottom: 6, color: C.body, fontSize: 12, fontWeight: 700 }}>Resolução <span style={{ color: C.subtle, fontWeight: 500 }}>(opcional)</span></span>
            <textarea ref={observacaoRef} rows={4} maxLength={1000} value={observacao} onChange={(event) => setObservacao(event.target.value)} placeholder="Ex.: conector ressoldado" style={{ width: "100%", resize: "vertical", minHeight: 96, padding: 10, border: `1px solid ${C.inputBd}`, borderRadius: 8, background: C.surface, color: C.body, font: "inherit", fontSize: 12.5, lineHeight: 1.5, boxSizing: "border-box" }} />
          </label>
          <p style={{ margin: "9px 0 0", color: C.subtle, fontSize: 11.5 }}>O encerramento será confirmado pelo servidor e aparecerá no histórico após o reload.</p>
        </Modal>
      ) : null}
    </div>
  );
}
