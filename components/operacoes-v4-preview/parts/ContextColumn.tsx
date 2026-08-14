/** Operações V4 Preview — coluna de contexto (cliente + aparelho), recolhível. */
import { useState } from "react";
import { ArrowLeft, History, Mail, MessageCircle, Phone, Pin, Smartphone, UserRound } from "lucide-react";
import { CollapsibleHoverRail } from "@/components/ui/collapsible-hover-rail";
import { C, MONO } from "../tokens";
import type { V4Vals } from "../use-v4-preview";
import { maskSenhaV4, NI } from "../os-adapter";

/**
 * Senha do aparelho MASCARADA por padrão (GOAL 006 — anti shoulder-surfing no
 * balcão). Revelar é estado local puramente visual: nada é persistido e o
 * mascaramento de impressão da V3 (`print-model`) segue intocado.
 */
function SenhaRow({ senha, senhaTipo }: { senha: string; senhaTipo: string }) {
  const [revelada, setRevelada] = useState(false);
  const temSenha = !!senha && senha !== NI;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12 }}>
      <span style={{ color: C.subtle, flex: "none" }}>Senha</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0 }}>
        <span title={temSenha && !revelada ? "Senha oculta — use o botão para revelar" : undefined} style={{ color: C.body, fontWeight: 600, fontFamily: MONO, background: C.muted50, padding: "1px 7px", borderRadius: 5, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {temSenha ? (revelada ? senha : maskSenhaV4(senha, senhaTipo)) : NI}
        </span>
        {temSenha && (
          <button
            type="button"
            onClick={() => setRevelada((r) => !r)}
            title={revelada ? "Ocultar senha" : "Revelar senha"}
            aria-label={revelada ? "Ocultar senha" : "Revelar senha"}
            style={{ flex: "none", width: 24, height: 22, border: `1px solid ${C.inputBd}`, background: C.surface, borderRadius: 6, fontSize: 11, color: C.muted, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            {revelada ? "🙈" : "👁"}
          </button>
        )}
      </span>
    </div>
  );
}

export function ContextColumn({ v }: { v: V4Vals }) {
  if (v.focusActive) {
    const os = v.os;
    return (
      <CollapsibleHoverRail ariaLabel="Contexto da OS" compactWidth={40} expandedWidth={320} panelClassName="!bg-[var(--card)]">
        {({ expanded, pinned, togglePinned }) => (
          <div style={{ width: 320, height: "100%", display: "flex", flexDirection: "column" }}>
            <div style={{ height: 42, flex: "none", display: "flex", alignItems: "center", borderBottom: `1px solid ${C.line3}` }}>
              <button type="button" onClick={togglePinned} aria-label={expanded ? (pinned ? "Desafixar contexto" : "Fixar contexto aberto") : "Expandir contexto da OS"} aria-pressed={pinned} style={{ width: 39, height: 41, flex: "none", display: "grid", placeItems: "center", padding: 0, border: 0, background: "transparent", color: C.subtle, cursor: "pointer" }}><UserRound size={15} /></button>
              <span style={{ opacity: expanded ? 1 : 0, transition: "opacity 160ms", flex: 1, fontSize: 10.5, fontWeight: 750, letterSpacing: ".08em", color: C.subtle }}>CONTEXTO DA OS</span>
              {expanded ? <button type="button" onClick={togglePinned} aria-label={pinned ? "Desafixar contexto" : "Fixar contexto aberto"} aria-pressed={pinned} title={pinned ? "Desafixar" : "Fixar aberto"} style={{ width: 30, height: 30, display: "grid", placeItems: "center", marginRight: 6, border: 0, borderRadius: 7, background: pinned ? C.primaryBg : "transparent", color: pinned ? C.primary : C.subtle, cursor: "pointer" }}><Pin size={13} fill={pinned ? "currentColor" : "none"} /></button> : null}
            </div>
            <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
              <div style={{ width: 40, flex: "none", paddingTop: 12, display: "flex", justifyContent: "center" }}>
                <span style={{ writingMode: "vertical-rl", fontSize: 9.5, fontWeight: 750, letterSpacing: ".09em", color: C.subtle }}>CLIENTE · APARELHO</span>
              </div>
              <div style={{ width: 280, minHeight: 0, overflowY: "auto", padding: "14px 14px 18px", opacity: expanded ? 1 : 0, transition: "opacity 160ms" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 14, borderBottom: `1px solid ${C.line3}` }}>
                  <div style={{ width: 38, height: 38, flex: "none", display: "grid", placeItems: "center", borderRadius: 10, background: C.primaryBg, color: C.primaryHover, fontSize: 12, fontWeight: 800 }}>{os.avatarInitials}</div>
                  <div style={{ minWidth: 0 }}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.ink, fontSize: 13.5, fontWeight: 700 }}>{os.cliente}</div><div style={{ color: C.subtle, fontSize: 11 }}>{os.documento}</div></div>
                </div>
                <div style={{ display: "flex", gap: 6, padding: "11px 0 14px" }}>
                  <button type="button" onClick={v.act.whatsapp} title="WhatsApp" aria-label="Abrir WhatsApp" style={{ flex: 1, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, border: `1px solid ${C.inputBd}`, borderRadius: 8, background: C.surface, color: C.body, cursor: "pointer", fontSize: 11.5, fontWeight: 650 }}><MessageCircle size={13} /> WhatsApp</button>
                  <button type="button" onClick={v.act.ligar} title="Ligar" aria-label="Ligar para cliente" style={{ width: 34, height: 32, display: "grid", placeItems: "center", border: `1px solid ${C.inputBd}`, borderRadius: 8, background: C.surface, color: C.body, cursor: "pointer" }}><Phone size={13} /></button>
                  <button type="button" onClick={v.toHistCliente} title="Histórico" aria-label="Abrir histórico do cliente" style={{ width: 34, height: 32, display: "grid", placeItems: "center", border: `1px solid ${C.inputBd}`, borderRadius: 8, background: C.surface, color: C.body, cursor: "pointer" }}><History size={13} /></button>
                </div>
                <div style={{ display: "grid", gap: 7, marginBottom: 17, color: C.body, fontSize: 11.5 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 7 }}><Phone size={12} color={C.subtle} />{os.telefone}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Mail size={12} color={C.subtle} />{os.email}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, color: C.subtle, fontSize: 10, fontWeight: 750, letterSpacing: ".08em" }}><Smartphone size={13} /> APARELHO</div>
                <div style={{ color: C.ink, fontSize: 14, fontWeight: 700 }}>{os.aparelho}</div>
                <div style={{ marginBottom: 13, color: C.muted, fontSize: 11.5 }}>{os.cor} · {os.tipo}</div>
                <div style={{ display: "grid", gap: 8, paddingBottom: 16, borderBottom: `1px solid ${C.line3}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5 }}><span style={{ color: C.subtle }}>IMEI / Série</span><span style={{ color: C.body, fontFamily: MONO, fontWeight: 650 }}>{os.serieCurta}</span></div>
                  <SenhaRow senha={os.senha} senhaTipo={os.senhaTipo} />
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5 }}><span style={{ color: C.subtle }}>Recebido por</span><span style={{ color: C.body, fontWeight: 650 }}>{os.recebidoPor}</span></div>
                </div>
                <div style={{ marginTop: 15, color: C.warnFg, fontSize: 9.5, fontWeight: 800, letterSpacing: ".09em" }}>DEFEITO RELATADO</div>
                <p style={{ margin: "6px 0 15px", color: C.bodySoft, fontSize: 12, lineHeight: 1.5 }}>{os.defeito}</p>
                <div style={{ display: "grid", gap: 7, padding: 11, borderTop: `1px solid ${C.line2}`, borderBottom: `1px solid ${C.line2}`, fontSize: 11.5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: C.subtle }}>Prioridade</span><span style={{ color: v.prio.fg, fontWeight: 700 }}>{v.prio.label}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: C.subtle }}>Localização</span><span style={{ color: C.body, fontWeight: 650 }}>{os.localizacao}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: C.subtle }}>Previsão / SLA</span><span style={{ color: C.successFg, fontWeight: 650 }}>{os.previsao}</span></div>
                </div>
                <div style={{ display: "flex", gap: 7, marginTop: 15 }}>
                  <button type="button" onClick={v.railFila} style={{ flex: 1, height: 34, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, border: `1px solid ${C.inputBd}`, borderRadius: 8, background: C.surface, color: C.body, cursor: "pointer", fontSize: 11.5, fontWeight: 650 }}><ArrowLeft size={13} /> Voltar à fila</button>
                  <button type="button" onClick={v.onTrocar} style={{ flex: 1, height: 34, border: `1px solid ${C.inputBd}`, borderRadius: 8, background: C.surface, color: C.body, cursor: "pointer", fontSize: 11.5, fontWeight: 650 }}>Trocar OS</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </CollapsibleHoverRail>
    );
  }

  if (!v.leftOpen) {
    return (
      <button
        type="button"
        onClick={v.toggleLeft}
        title="Abrir contexto do cliente"
        style={{
          flex: "none",
          width: 32,
          background: C.surface,
          border: "none",
          borderRight: `1px solid ${C.line}`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 9,
          paddingTop: 9,
          cursor: "pointer",
        }}
      >
        <span
          style={{
            width: 23,
            height: 23,
            borderRadius: 6,
            background: C.muted50,
            color: C.subtle,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
          }}
        >
          ›
        </span>
        <span
          style={{
            writingMode: "vertical-rl",
            fontSize: 10.5,
            fontWeight: 600,
            color: C.subtle,
            letterSpacing: ".04em",
            marginTop: 4,
          }}
        >
          CLIENTE · APARELHO
        </span>
      </button>
    );
  }

  const os = v.os;
  return (
    <aside
      style={{
        flex: "none",
        width: 272,
        background: C.surface,
        borderRight: `1px solid ${C.line}`,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 36,
          padding: "0 9px 0 12px",
          borderBottom: `1px solid ${C.line3}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <button
            type="button"
            onClick={v.railFila}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 23, padding: "0 7px", border: "none", background: "transparent", color: C.muted, fontSize: 12, cursor: "pointer", borderRadius: 6 }}
          >
            ← Fila
          </button>
          <button
            type="button"
            onClick={v.onTrocar}
            style={{ height: 23, padding: "0 7px", border: "none", background: "transparent", color: C.muted, fontSize: 12, cursor: "pointer", borderRadius: 6 }}
          >
            Trocar OS
          </button>
        </div>
        <button
          type="button"
          onClick={v.toggleLeft}
          title="Recolher contexto"
          style={{ width: 23, height: 23, border: "none", background: C.muted50, borderRadius: 6, color: C.subtle, cursor: "pointer", fontSize: 13 }}
        >
          ‹
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.primaryBg, color: C.primaryHover, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flex: "none" }}>
            {os.avatarInitials}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{os.cliente}</div>
            <div style={{ fontSize: 11.5, color: C.muted }}>{os.documento}</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: C.body }}>
            <span style={{ color: C.subtle }}>📞</span>{os.telefone}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: C.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <span style={{ color: C.subtle }}>✉</span>{os.email}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 13 }}>
          <button type="button" onClick={v.act.whatsapp} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, height: 29, border: `1px solid ${C.inputBd}`, background: C.surface, borderRadius: 8, fontSize: 12, fontWeight: 500, color: C.body, cursor: "pointer" }}>
            💬 WhatsApp
          </button>
          <button type="button" onClick={v.act.ligar} title="Ligar" style={{ flex: "none", width: 34, height: 29, border: `1px solid ${C.inputBd}`, background: C.surface, borderRadius: 8, fontSize: 13, color: C.body, cursor: "pointer" }}>📞</button>
          <button type="button" onClick={v.toHistCliente} title="Histórico do cliente" style={{ flex: "none", width: 34, height: 29, border: `1px solid ${C.inputBd}`, background: C.surface, borderRadius: 8, fontSize: 13, color: C.body, cursor: "pointer" }}>🕑</button>
        </div>

        <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: C.subtle, fontWeight: 700, marginBottom: 6 }}>Aparelho</div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>{os.aparelho}</div>
        <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 9 }}>{os.cor} · {os.tipo}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, paddingBottom: 12, borderBottom: `1px solid ${C.line3}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span style={{ color: C.subtle }}>IMEI / Série</span><span style={{ color: C.body, fontWeight: 500 }}>{os.serieCurta}</span></div>
          <SenhaRow senha={os.senha} senhaTipo={os.senhaTipo} />
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}><span style={{ color: C.subtle, flex: "none" }}>Acessórios</span><span title={os.acessorios} style={{ color: C.body, fontWeight: 500, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "right" }}>{os.acessorios}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}><span style={{ color: C.subtle, flex: "none" }}>Recebido por</span><span title={os.recebidoPor} style={{ color: C.body, fontWeight: 500, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "right" }}>{os.recebidoPor}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}><span style={{ color: C.subtle, flex: "none" }}>Origem</span><span title={os.origem} style={{ color: C.body, fontWeight: 500, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "right" }}>{os.origem}</span></div>
        </div>

        <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: C.warnFg, fontWeight: 700, margin: "12px 0 6px" }}>Defeito relatado</div>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, lineHeight: 1.5, color: C.bodySoft }}>{os.defeito}</p>

        {os.observacoesInternas ? (
          <>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: C.subtle, fontWeight: 700, margin: "0 0 6px" }}>Observações internas</div>
            <p style={{ margin: "0 0 12px", fontSize: 12.5, lineHeight: 1.5, color: C.bodySoft }}>{os.observacoesInternas}</p>
          </>
        ) : null}

        <div style={{ border: `1px solid ${C.line2}`, borderRadius: 10, padding: 10, background: C.surface2 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, marginBottom: 7 }}>
            <span style={{ color: C.muted }}>Prioridade</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: v.prio.fg, fontWeight: 600 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: v.prio.dot }} />{v.prio.label}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, marginBottom: 7 }}><span style={{ color: C.muted }}>Localização</span><span style={{ color: C.body, fontWeight: 600 }}>{os.localizacao}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}><span style={{ color: C.muted }}>Garantia</span><span style={{ color: C.body, fontWeight: 600 }}>{os.garantiaPrazo}</span></div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: C.subtle, marginTop: 12 }}><span>Entrada</span><span style={{ color: C.muted, fontWeight: 500 }}>{os.entrada}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: C.subtle, marginTop: 5 }}><span>Previsão / SLA</span><span style={{ color: C.successFg, fontWeight: 600 }}>{os.previsao}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: C.subtle, marginTop: 5 }}><span>Técnico</span><span style={{ color: C.muted, fontWeight: 500 }}>{os.tecnico}</span></div>
      </div>
    </aside>
  );
}
