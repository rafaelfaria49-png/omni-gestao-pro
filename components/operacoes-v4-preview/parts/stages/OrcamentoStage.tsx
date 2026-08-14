/** Operações V4 — etapa Orçamento (REAL · slice OPS-V4-ORCAMENTO-REAL-002).
 *
 * Deixou de ser somente leitura. Quando há orçamento materializado em rascunho/
 * enviado, edita itens (serviço manual + peça do catálogo via UI V4-native),
 * desconto, calcula o total ao vivo (`computeTotaisV3`) e persiste/decide via
 * actions reais da V3 — `gerarOrcamentoDaOS` / `salvarOrcamentoV3` /
 * `aprovarOrcamentoV3` / `recusarOrcamentoV3`. NÃO baixa/reserva estoque, NÃO
 * toca caixa/financeiro real. Estados aprovado/recusado/prévia/ausente ficam
 * read-only (com CTA "Gerar orçamento" quando aplicável). */
import { useEffect, useState } from "react";
import { C, card, cardTitle, upLabel, fmt } from "../../tokens";
import type { V4Vals } from "../../use-v4-preview";
import { lerOrcKindV4, ORC_KIND_LABEL, type V4OrcItemView, type V4OrcKind } from "../../os-adapter";
import { ProdutoLookupV4 } from "../ProdutoLookupV4";
import {
  custoInformadoPeca,
  itensSemCustoV4,
  margemPercentualV4,
  novoServicoManualV4,
  pecaFromProdutoV4,
  totaisEditorV4,
  validarEditorParaSalvarV4,
  type OrcamentoEditorV4,
} from "@/lib/operacoes-v4/orcamento-form";
import { converterOrcamentoEmOSV3 } from "@/lib/operacoes-v3/comercial-pre-os-actions";
import { useLojaAtiva } from "@/lib/loja-ativa";
import { OrcamentoEnvioCluster } from "./OrcamentoEnvioCluster";
import { OrcamentoDuplicarButton } from "./OrcamentoDuplicarButton";
import { OrcamentoDecisaoCluster } from "./OrcamentoDecisaoCluster";

const col2 = "repeat(auto-fit, minmax(330px, 1fr))";
const emptyText = { fontSize: 12, color: C.subtle, padding: "8px 2px", lineHeight: 1.5 } as const;

const STATUS_BG: Record<string, { bg: string; fg: string }> = {
  success: { bg: C.successBg, fg: C.successFg },
  info: { bg: C.infoBg, fg: C.infoFg },
  warn: { bg: C.warnBg, fg: C.warnFg },
  danger: { bg: C.dangerBg, fg: C.dangerFg },
  neutro: { bg: C.line3, fg: C.muted },
};

const cellInput: React.CSSProperties = {
  height: 30,
  padding: "0 9px",
  border: `1px solid ${C.inputBd}`,
  borderRadius: 7,
  fontSize: 12,
  color: C.body,
  background: C.surface,
};

function num(s: string): number {
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Tons do badge de classificação da linha (kindV3 persistido; read-only — GOAL 006).
// Brinde/Interno não somam no total ao cliente, por isso o destaque visual.
const KIND_TONE: Record<V4OrcKind, { bg: string; fg: string; bd: string }> = {
  cobrado: { bg: C.surface2, fg: C.muted, bd: C.line2 },
  brinde: { bg: C.successBg, fg: C.successFg, bd: C.successBd },
  interno: { bg: C.warnBg, fg: C.warnFg, bd: C.warnBd },
};

/** Badge read-only da classificação da linha; nada quando a OS não registra kind. */
function KindBadge({ kind }: { kind: V4OrcKind | null }) {
  if (!kind) return null;
  const t = KIND_TONE[kind];
  return (
    <span title={kind === "cobrado" ? "Linha cobrada do cliente" : "Não soma no total ao cliente"} style={{ flex: "none", border: `1px solid ${t.bd}`, background: t.bg, color: t.fg, borderRadius: 5, padding: "1px 6px", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", whiteSpace: "nowrap" }}>
      {ORC_KIND_LABEL[kind]}
    </span>
  );
}

export function OrcamentoStage({ v }: { v: V4Vals }) {
  // GOAL OPS-V4-ORCAMENTO-READBACK-EDIT-002: reabertura controlada de um orçamento já
  // materializado (mesmo aprovado/entregue) para revisar/corrigir. Estado LOCAL — nada
  // persiste até "Salvar"; fecha ao trocar de OS (não vaza entre seleções).
  const [reaberto, setReaberto] = useState(false);
  useEffect(() => {
    setReaberto(false);
  }, [v.selectedOsId]);

  if (!v.osSelected) {
    return (
      <div style={card}>
        <div style={{ ...cardTitle, marginBottom: 6 }}>🔧 Orçamento</div>
        <div style={emptyText}>Selecione uma Ordem de Serviço para trabalhar o orçamento.</div>
      </div>
    );
  }
  // Editável (materializado + rascunho/enviado) → editor real. Reaberto (materializado
  // em qualquer status) → mesmo editor, em modo revisão. Senão, read-only.
  if (v.orcamentoEditavel || reaberto) {
    const revisao = reaberto && !v.orcamentoEditavel;
    return (
      <>
        <ConverterOrcamentoPanel v={v} />
        <OrcamentoEditor
          key={`${v.selectedOsId ?? "none"}:${revisao ? "revisao" : "auto"}`}
          v={v}
          revisao={revisao}
          onFecharRevisao={() => setReaberto(false)}
        />
      </>
    );
  }
  return (
    <>
      <ConverterOrcamentoPanel v={v} />
      <OrcamentoReadonly v={v} onReabrir={() => setReaberto(true)} />
    </>
  );
}

function ConverterOrcamentoPanel({ v }: { v: V4Vals }) {
  const { lojaAtivaId } = useLojaAtiva();
  const comercial = v.comercialV4;
  const aprovado = comercial?.statusComercial === "aprovado" || /aprovad/i.test(v.orcamento.statusLabel);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recebidoPor, setRecebidoPor] = useState("");
  const [previsao, setPrevisao] = useState("");
  if (!comercial || comercial.tipo !== "orcamento_pre_os" || comercial.statusComercial === "convertido" || !aprovado) return null;
  return (
    <div style={{ ...card, marginBottom: 12, border: `1px solid ${C.primaryBd}` }}>
      <div style={{ ...cardTitle, marginBottom: 6 }}>Converter em Ordem de Serviço</div>
      <div style={{ fontSize: 12, color: C.subtle, lineHeight: 1.45, marginBottom: 10 }}>
        Cliente, aparelho, defeito, opção aprovada e valor já estão neste registro. Só complete a recepção.
      </div>
      {erro ? <div style={{ fontSize: 12, color: C.dangerFg, marginBottom: 8 }}>{erro}</div> : null}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8, marginBottom: 10 }}>
        <input value={recebidoPor} onChange={(e) => setRecebidoPor(e.target.value)} placeholder="Recebido por" style={cellInput} autoComplete="off" />
        <input type="datetime-local" value={previsao} onChange={(e) => setPrevisao(e.target.value)} style={cellInput} autoComplete="off" />
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          const sid = (lojaAtivaId ?? "").trim();
          const osId = (v.selectedOsId ?? "").trim();
          if (!sid || !osId) return;
          setBusy(true);
          setErro(null);
          try {
            await converterOrcamentoEmOSV3(sid, osId, {
              recebidoPor,
              previsaoEntrega: previsao || undefined,
              localFisico: "balcao",
              prioridade: "media",
            });
            v.reloadOrdens();
            v.goOrcamento();
          } catch (e) {
            setErro(e instanceof Error ? e.message : "Não foi possível converter.");
          } finally {
            setBusy(false);
          }
        }}
        style={{ height: 34, padding: "0 16px", border: "none", background: C.primary, color: C.white, borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: busy ? "default" : "pointer" }}
      >
        {busy ? "Convertendo…" : "Criar Ordem de Serviço"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Read-only: prévia / ausente (com CTA "Gerar orçamento") ou já decidido.
// ---------------------------------------------------------------------------
function ItemRow({ it }: { it: V4OrcItemView }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "8px 0", borderBottom: `1px solid ${C.line4}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: C.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.descricao}</div>
        {it.detalhe && <div style={{ fontSize: 10, color: C.subtle }}>{it.detalhe}</div>}
      </div>
      <KindBadge kind={it.kind} />
      {it.custo && <span style={{ width: 92, textAlign: "right", fontSize: 11, color: C.subtle }}>custo {it.custo}</span>}
      <span style={{ width: 78, textAlign: "right", fontWeight: 600, color: C.ink }}>{it.valor}</span>
    </div>
  );
}

function GerarOrcamentoCTA({ v }: { v: V4Vals }) {
  const [busy, setBusy] = useState(false);
  const onGerar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await v.gerarOrcamento();
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={onGerar}
      disabled={busy}
      style={{ height: 34, padding: "0 16px", border: "none", background: C.primary, color: C.white, borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}
    >
      {busy ? "Gerando…" : "Gerar orçamento"}
    </button>
  );
}

function OrcamentoReadonly({ v, onReabrir }: { v: V4Vals; onReabrir: () => void }) {
  const o = v.orcamento;

  if (o.estado === "ausente") {
    return (
      <div style={card}>
        <div style={{ ...cardTitle, marginBottom: 6 }}>🔧 Orçamento</div>
        <div style={{ ...emptyText, marginBottom: 12 }}>Nenhum orçamento registrado para esta Ordem de Serviço.</div>
        <GerarOrcamentoCTA v={v} />
      </div>
    );
  }

  // Materializado vazio: existe orçamento real, mas sem itens/valores. Honesto (não
  // finge que não existe) e com caminho de correção — "Editar orçamento" reabre o
  // editor (nunca "Gerar orçamento", que seria no-op sobre um orçamento real vazio).
  if (o.estado === "vazio") {
    const badgeV = STATUS_BG[o.statusTone] ?? STATUS_BG.neutro;
    return (
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <span style={cardTitle}>🔧 Orçamento</span>
          {o.statusLabel && (
            <span style={{ height: 21, padding: "0 9px", display: "inline-flex", alignItems: "center", background: badgeV.bg, color: badgeV.fg, borderRadius: 999, fontSize: 11, fontWeight: 600 }}>{o.statusLabel}</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: C.warnBg, border: `1px solid ${C.warnBd}`, borderRadius: 9, padding: "10px 12px", marginBottom: 12 }}>
          <span style={{ fontSize: 14, lineHeight: "18px", flex: "none" }}>⚠️</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.warnFg, marginBottom: 3 }}>Orçamento criado, mas sem itens ou valores.</div>
            <div style={{ fontSize: 11.5, color: C.warnFg, lineHeight: 1.5 }}>Adicione serviço, peça ou valor antes de aprovar/avançar.</div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "2px 0 12px" }}>
          <span style={{ color: C.muted }}>Total ao cliente</span>
          <span style={{ fontWeight: 700, color: C.ink }}>{o.total}</span>
        </div>
        <button
          type="button"
          onClick={onReabrir}
          style={{ height: 34, padding: "0 16px", border: "none", background: C.primary, color: C.white, borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
        >
          Editar orçamento
        </button>
      </div>
    );
  }

  const badge = STATUS_BG[o.statusTone] ?? STATUS_BG.neutro;

  return (
    <div style={{ display: "grid", gridTemplateColumns: col2, gap: 12, alignItems: "start" }}>
      <div style={{ ...card, border: `1px solid ${C.primaryBd2}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11, gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={cardTitle}>🔧 Orçamento</span>
            {o.statusLabel && (
              <span style={{ height: 21, padding: "0 9px", display: "inline-flex", alignItems: "center", background: badge.bg, color: badge.fg, borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{o.statusLabel}</span>
            )}
          </div>
          {o.temVersoes && (
            <span style={{ fontSize: 11.5, color: C.muted, whiteSpace: "nowrap" }}>🕑 {o.versoesCount} {o.versoesCount === 1 ? "versão" : "versões"}</span>
          )}
        </div>

        <div style={{ ...upLabel, marginBottom: 4 }}>Serviços / mão de obra</div>
        {o.servicos.length === 0 ? <div style={emptyText}>Nenhum serviço no orçamento.</div> : o.servicos.map((it) => <ItemRow key={it.id} it={it} />)}

        <div style={{ ...upLabel, margin: "13px 0 4px" }}>Peças</div>
        {o.pecas.length === 0 ? <div style={emptyText}>Nenhuma peça no orçamento.</div> : o.pecas.map((it) => <ItemRow key={it.id} it={it} />)}

        {o.isPrevia && (
          <div style={{ marginTop: 13 }}>
            <GerarOrcamentoCTA v={v} />
            <div style={{ fontSize: 10, color: C.subtle, marginTop: 8, lineHeight: 1.5 }}>
              Prévia derivada dos itens da OS. Gere o orçamento para editar e enviar.
            </div>
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ ...cardTitle, marginBottom: 10 }}>Totais</div>
        {o.desconto && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "4px 0" }}><span style={{ color: C.muted }}>Desconto</span><span style={{ color: C.warnFg, fontWeight: 500 }}>– {o.desconto}</span></div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "8px 0 5px", borderTop: `1px solid ${C.line2}`, marginTop: 4 }}><span style={{ fontWeight: 700, color: C.ink }}>Total ao cliente</span><span style={{ fontWeight: 700, color: C.ink }}>{o.total}</span></div>
        {o.custoTotal && o.lucroTotal && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8, borderTop: `1px dashed ${C.inputBd}`, marginTop: 8, paddingTop: 9 }}>
              <div><div style={upLabel}>Custo interno</div><div style={{ fontSize: 13, fontWeight: 600, color: C.body }}>{o.custoTotal}</div></div>
              <div><div style={upLabel}>Lucro</div><div style={{ fontSize: 13, fontWeight: 700, color: C.successFg }}>{o.lucroTotal}</div></div>
            </div>
            <div style={{ fontSize: 10, color: C.subtle, marginTop: 8, lineHeight: 1.5 }}>Custo interno — não aparece para o cliente.</div>
          </>
        )}
        {!o.isPrevia && (
          <div style={{ marginTop: 13, display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              onClick={onReabrir}
              style={{ height: 34, padding: "0 16px", border: `1px solid ${C.inputBd2}`, background: C.surface, color: C.body, borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
            >
              Editar orçamento
            </button>
            <OrcamentoDuplicarButton v={v} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor real (orçamento materializado em rascunho/enviado).
// ---------------------------------------------------------------------------
function OrcamentoEditor({ v, revisao, onFecharRevisao }: { v: V4Vals; revisao?: boolean; onFecharRevisao?: () => void }) {
  const [editor, setEditor] = useState<OrcamentoEditorV4>(() => v.orcamentoEditorSeed);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const totais = totaisEditorV4(editor);
  const margem = margemPercentualV4(totais);
  const semCusto = itensSemCustoV4(editor);

  const run = async (fn: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  // Valida ANTES de persistir e devolve o resultado (para o botão e para o guard de
  // "Salvar e aprovar"). Bloqueia linha com valor/custo mas sem descrição/nome — nunca
  // deixa `editorToSalvarInputV4` descartá-la em silêncio, nem o orçamento salvar vazio.
  const salvarEditor = async (): Promise<boolean> => {
    const veredito = validarEditorParaSalvarV4(editor);
    if (!veredito.ok) {
      setErro(veredito.erro ?? "Complete o orçamento antes de salvar.");
      return false;
    }
    setErro(null);
    // GOAL OPS-V4-ORCAMENTO-REABRIR-MOTOR-003: em modo revisão (OS avançada), usa a
    // action de correção — preserva o status da OS e recalcula o valorTotal (o salvar
    // comum seria rejeitado pelo motor para orçamento aprovado/entregue). Após sucesso,
    // fecha o modo edição para mostrar o read-only com o total atualizado.
    const ok = revisao ? await v.corrigirOrcamento(editor) : await v.salvarOrcamento(editor);
    if (ok && revisao && onFecharRevisao) onFecharRevisao();
    return ok;
  };

  const addServico = () =>
    setEditor((e) => ({ ...e, servicos: [...e.servicos, novoServicoManualV4({ descricao: "", valor: 0 })] }));
  const setServico = (i: number, patch: Partial<{ descricao: string; valor: number; custoV3: number }>) =>
    setEditor((e) => ({ ...e, servicos: e.servicos.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));
  const removeServico = (i: number) => setEditor((e) => ({ ...e, servicos: e.servicos.filter((_, idx) => idx !== i) }));

  const setPeca = (i: number, patch: Partial<{ quantidade: number; valorUnitario: number }>) =>
    setEditor((e) => ({ ...e, pecas: e.pecas.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) }));
  const removePeca = (i: number) => setEditor((e) => ({ ...e, pecas: e.pecas.filter((_, idx) => idx !== i) }));

  const btnPrimary: React.CSSProperties = { height: 34, padding: "0 16px", border: "none", background: C.primary, color: C.white, borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 };
  const btnGhost: React.CSSProperties = { height: 30, padding: "0 12px", border: `1px solid ${C.inputBd2}`, background: C.surface, color: C.body, borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: "pointer" };

  return (
    <div style={{ display: "grid", gridTemplateColumns: col2, gap: 12, alignItems: "start" }}>
      <div style={{ ...card, border: `1px solid ${C.primaryBd2}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
          <span style={cardTitle}>🔧 Orçamento</span>
          <span style={{ height: 21, padding: "0 9px", display: "inline-flex", alignItems: "center", background: C.infoBg, color: C.infoFg, borderRadius: 999, fontSize: 11, fontWeight: 600 }}>{v.orcamento.statusLabel || "Rascunho"}</span>
        </div>

        {revisao && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: C.warnBg, border: `1px solid ${C.warnBd}`, borderRadius: 9, padding: "9px 11px", marginBottom: 12 }}>
            <span style={{ fontSize: 13, lineHeight: "16px", flex: "none" }}>⚠️</span>
            <span style={{ fontSize: 11.5, color: C.warnFg, lineHeight: 1.45 }}>
              <strong>Correção de orçamento em OS avançada{v.orcamento.statusLabel ? ` (${v.orcamento.statusLabel})` : ""}.</strong> O status da OS será preservado — salvar apenas reescreve os itens/valores e recalcula o total, sem criar cobrança ou venda. Nada muda até você salvar.
            </span>
          </div>
        )}

        {/* Serviços */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={upLabel}>Serviços / mão de obra</span>
          <button type="button" onClick={addServico} title="Serviço manual novo entra como Cobrado" style={btnGhost}>+ Serviço</button>
        </div>
        {editor.servicos.length === 0 ? (
          <div style={emptyText}>Nenhum serviço. Adicione um serviço manual.</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, padding: "0 0 3px" }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 9.5, color: C.subtle }}>Descrição</span>
              <span style={{ width: 92, textAlign: "right", fontSize: 9.5, color: C.subtle }}>Valor cliente</span>
              <span style={{ width: 84, textAlign: "right", fontSize: 9.5, color: C.subtle }}>Custo interno</span>
              <span style={{ width: 28, flex: "none" }} />
            </div>
            {editor.servicos.map((s, i) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 0", borderBottom: `1px solid ${C.line4}` }}>
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                  <input value={s.descricao} onChange={(e) => setServico(i, { descricao: e.target.value })} placeholder="Descrição do serviço" maxLength={120} style={{ ...cellInput, flex: 1, minWidth: 0 }} />
                  <KindBadge kind={lerOrcKindV4(s)} />
                </div>
                <input type="number" min={0} value={s.valor || ""} onChange={(e) => setServico(i, { valor: num(e.target.value) })} placeholder="0,00" style={{ ...cellInput, width: 92, textAlign: "right" }} />
                <input type="number" min={0} value={s.custoV3 || ""} onChange={(e) => setServico(i, { custoV3: num(e.target.value) })} placeholder="0,00" aria-label="Custo interno do serviço" style={{ ...cellInput, width: 84, textAlign: "right" }} />
                <button type="button" onClick={() => removeServico(i)} aria-label="Remover serviço" style={{ width: 28, height: 30, border: `1px solid ${C.inputBd}`, background: C.surface, color: C.danger, borderRadius: 7, cursor: "pointer", flex: "none" }}>×</button>
              </div>
            ))}
          </>
        )}
        <div style={{ fontSize: 10, color: C.subtle, marginTop: 6, lineHeight: 1.4 }}>
          Serviço manual novo entra como <b>Cobrado</b>. Linhas <b>Brinde</b>/<b>Interno</b> (classificadas na V3) são preservadas e não somam no total ao cliente — a edição da classificação fica para uma próxima etapa.
        </div>

        {/* Peças */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "14px 0 6px" }}>
          <span style={upLabel}>Peças</span>
          <button type="button" onClick={() => setLookupOpen((o) => !o)} style={btnGhost}>+ Peça do catálogo</button>
        </div>
        {lookupOpen && (
          <ProdutoLookupV4
            onSelect={(p) => {
              setEditor((e) => ({ ...e, pecas: [...e.pecas, pecaFromProdutoV4(p, { quantidade: 1 })] }));
              setLookupOpen(false);
            }}
            onClose={() => setLookupOpen(false)}
          />
        )}
        {editor.pecas.length === 0 ? (
          <div style={emptyText}>Nenhuma peça. Adicione uma peça do catálogo.</div>
        ) : (
          editor.pecas.map((p, i) => {
            const custoOk = custoInformadoPeca(p);
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 0", borderBottom: `1px solid ${C.line4}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: C.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{p.nome}</div>
                    <KindBadge kind={lerOrcKindV4(p)} />
                  </div>
                  <div style={{ fontSize: 10, color: custoOk ? C.subtle : C.warnFg }}>
                    {custoOk ? `Custo ${fmt(p.custoUnitario as number)} / un.` : "Custo não informado"}
                  </div>
                </div>
                <input type="number" min={1} value={p.quantidade || ""} onChange={(e) => setPeca(i, { quantidade: Math.max(1, Math.trunc(num(e.target.value)) || 1) })} aria-label="Quantidade" style={{ ...cellInput, width: 52, textAlign: "center" }} />
                <input type="number" min={0} value={p.valorUnitario || ""} onChange={(e) => setPeca(i, { valorUnitario: num(e.target.value) })} aria-label="Valor unitário" placeholder="0,00" style={{ ...cellInput, width: 88, textAlign: "right" }} />
                <button type="button" onClick={() => removePeca(i)} aria-label="Remover peça" style={{ width: 28, height: 30, border: `1px solid ${C.inputBd}`, background: C.surface, color: C.danger, borderRadius: 7, cursor: "pointer", flex: "none" }}>×</button>
              </div>
            );
          })
        )}
      </div>

      {/* Totais + ações */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={card}>
          <div style={{ ...cardTitle, marginBottom: 10 }}>Totais</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, color: C.muted }}>Desconto (R$)</span>
            <input type="number" min={0} value={editor.desconto || ""} onChange={(e) => setEditor((s) => ({ ...s, desconto: num(e.target.value) }))} placeholder="0,00" style={{ ...cellInput, width: 100, textAlign: "right" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "4px 0" }}><span style={{ color: C.muted }}>Subtotal</span><span style={{ color: C.body }}>{fmt(totais.subtotal)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "8px 0 5px", borderTop: `1px solid ${C.line2}`, marginTop: 4 }}><span style={{ fontWeight: 700, color: C.ink }}>Total ao cliente</span><span style={{ fontWeight: 700, color: C.ink }}>{fmt(totais.total)}</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8, borderTop: `1px dashed ${C.inputBd}`, marginTop: 8, paddingTop: 9 }}>
            <div><div style={upLabel}>Custo interno</div><div style={{ fontSize: 13, fontWeight: 600, color: C.body }}>{fmt(totais.custo)}</div></div>
            <div><div style={upLabel}>Lucro</div><div style={{ fontSize: 13, fontWeight: 700, color: totais.lucro >= 0 ? C.successFg : C.dangerFg }}>{fmt(totais.lucro)}</div></div>
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={upLabel}>Margem estimada</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: margem == null ? C.subtle : margem >= 0 ? C.successFg : C.dangerFg }}>
              {margem == null ? "—" : `${margem.toFixed(0)}%`}
            </div>
          </div>
          {semCusto > 0 && (
            <div style={{ fontSize: 10, color: C.warnFg, marginTop: 8, lineHeight: 1.5 }}>
              {semCusto === 1 ? "1 item sem custo informado" : `${semCusto} itens sem custo informado`} — custo/lucro/margem podem estar incompletos.
            </div>
          )}
          <div style={{ fontSize: 10, color: C.subtle, marginTop: 8, lineHeight: 1.5 }}>Custo interno — não aparece para o cliente.</div>
        </div>

        <div style={card}>
          <div style={{ ...cardTitle, marginBottom: 10 }}>Ações</div>
          <button type="button" onClick={() => run(salvarEditor)} disabled={busy} style={{ ...btnPrimary, width: "100%", marginBottom: 8 }}>{busy ? "Processando…" : "Salvar orçamento"}</button>
          {erro && (
            <div style={{ fontSize: 11, color: C.dangerFg, marginBottom: 8, lineHeight: 1.5 }}>{erro}</div>
          )}
          <div style={{ marginTop: 2 }}>
            <OrcamentoDuplicarButton v={v} />
          </div>
          {revisao && onFecharRevisao && (
            <button type="button" onClick={onFecharRevisao} disabled={busy} style={{ ...btnGhost, width: "100%", marginTop: 8 }}>Cancelar edição</button>
          )}
        </div>

        {v.orcamentoPodeDecidir && (
          <OrcamentoDecisaoCluster v={v} guard={{ total: totais.total, salvarEditor }} />
        )}

        <OrcamentoEnvioCluster v={v} />
      </div>
    </div>
  );
}
