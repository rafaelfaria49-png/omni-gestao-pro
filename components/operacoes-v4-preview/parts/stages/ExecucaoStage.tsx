/** Operações V4 Preview — etapa Execução.
 *
 * GOAL OPS-V4-P0-011: o técnico/timer/apontamentos/checklist/bancada/consumo
 * fabricados ("Bancada 02", timer "02:14", TECH_DEF, APONTAMENTOS, "baixado /
 * reservar", serviços/peças "R$ 890") foram removidos. O stage lê só o que a OS
 * persiste — técnico responsável, checklist técnico (pós-reparo), apontamentos
 * reais (eventos de execução da timeline), peças consumidas (estoqueMovimentos)
 * e anexos de bancada — ou exibe empty state honesto. Nada de valor inventado.
 *
 * GOAL OPS-V4-TECNICO-BANCADA-FILA-016: técnico, bancada, prioridade, checklist
 * técnico e observação interna passam a gravar via actions V3 payload-only
 * (`atribuirTecnicoV3` / `definirLocalFisicoV3` / `salvarChecklistTecnicoV3` /
 * `adicionarObservacaoInternaV3`). Transições de status continuam na máquina V3.
 *
 * GOAL OPS-V4-BLOCKERS-FINAL-CLOSEOUT-018: consumo de estoque deixa de ser
 * somente leitura — `v.baixarEstoqueOS` chama o adapter oficial (idempotente). */
import { useEffect, useRef, useState } from "react";
import { CHECKLIST_TECNICO_PADRAO } from "@/types/os";
import {
  createChecklistBurstSaver,
  toggleChecklistTecnicoItem,
} from "@/lib/operacoes-v4/checklist-tecnico-burst";
import { C, card, cardTitle, upLabel, HATCH } from "../../tokens";
import type { V4Vals } from "../../use-v4-preview";
import { PrioridadePickerV4, TecnicoPickerV4 } from "../ProducaoControlesV4";
import pickerStyles from "../bancada-v4.module.css";

const col3 = "minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)";
const col2 = "minmax(0,1fr) minmax(0,1fr)";
const emptyText = { fontSize: 12, color: C.subtle, padding: "8px 2px", lineHeight: 1.5 } as const;
const fieldBox = {
  display: "flex",
  alignItems: "center",
  height: 30,
  padding: "0 10px",
  border: `1px solid ${C.inputBd}`,
  borderRadius: 8,
  fontSize: 12.5,
  color: C.body,
} as const;

const btnPrimary: React.CSSProperties = {
  height: 34,
  padding: "0 16px",
  border: "none",
  borderRadius: 8,
  fontSize: 12.5,
  fontWeight: 600,
  color: C.white,
};
const btnGhost: React.CSSProperties = {
  height: 34,
  padding: "0 16px",
  borderRadius: 8,
  fontSize: 12.5,
  fontWeight: 600,
  background: C.surface,
  color: C.body,
  border: `1px solid ${C.inputBd2}`,
};

/**
 * Ações reais de transição de status da Execução (slice OPS-V4-EXECUCAO-REAL-007).
 * Cada botão só aparece quando `v.execAcoes` (máquina única `podeTransicionarV3`
 * a partir do status real da OS) permite a transição — nunca todas ao mesmo tempo
 * por acidente. Busy-lock local evita duplo clique; o toast e o reload pós-sucesso
 * vêm do próprio handler (`runWrite`, em `use-v4-preview`), não daqui.
 */
function ExecAcoesCard({ v }: { v: V4Vals }) {
  const [busy, setBusy] = useState(false);
  const ex = v.execAcoes;
  if (!ex.podeIniciar && !ex.podeAguardarPeca && !ex.podePronta) return null;

  const run = async (fn: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={card}>
      <div style={{ ...cardTitle, marginBottom: 10 }}>Ações de execução</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {ex.podeIniciar && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(v.iniciarServico)}
            style={{ ...btnPrimary, background: C.primary, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}
          >
            {busy ? "Processando…" : ex.iniciarLabel}
          </button>
        )}
        {ex.podeAguardarPeca && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(v.marcarAguardandoPeca)}
            style={{ ...btnGhost, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}
          >
            {busy ? "Processando…" : "Marcar aguardando peça"}
          </button>
        )}
        {ex.podePronta && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(v.marcarPronta)}
            style={{ ...btnPrimary, background: C.success, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}
          >
            {busy ? "Processando…" : "Marcar como pronta"}
          </button>
        )}
      </div>
    </div>
  );
}

function servicoAprovadoLabel(v: V4Vals): string {
  const orc = v.orcamento;
  if (orc.statusLabel !== "Aprovado") return "";
  const primeiro = orc.servicos[0];
  if (!primeiro) return orc.total && orc.total !== "—" ? `Orçamento aprovado · ${orc.total}` : "";
  return `${primeiro.descricao}${primeiro.valor ? `  ${primeiro.valor}` : ""}`;
}

function ProducaoResumoExecucao({ v }: { v: V4Vals }) {
  const p = v.producaoAtual;
  const servico = servicoAprovadoLabel(v);
  const osId = v.selectedOsId;
  const [open, setOpen] = useState<null | "tec" | "prio">(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<boolean>) => {
    if (busy || !osId) return false;
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={card}>
      <div style={{ ...cardTitle, marginBottom: 10 }}>Execução</div>
      <div style={{ display: "grid", gridTemplateColumns: col3, gap: 10 }}>
        <div className={pickerStyles.wrap}>
          <div style={upLabel}>Responsável</div>
          <button
            type="button"
            disabled={!osId || busy}
            onClick={() => setOpen(open === "tec" ? null : "tec")}
            style={{ ...fieldBox, cursor: osId ? "pointer" : "default", width: "100%", textAlign: "left", background: "transparent" }}
          >
            {p?.tecnicoNome ?? "Sem técnico"}
          </button>
          {open === "tec" && osId ? (
            <>
              <button type="button" onClick={() => setOpen(null)} style={{ position: "fixed", inset: 0, border: 0, background: "transparent", zIndex: 30 }} aria-label="Fechar" />
              <TecnicoPickerV4
                conhecidos={v.producaoBancada.tecnicosConhecidos}
                atualNome={p?.tecnicoNome ?? null}
                pending={busy}
                onAtribuir={(nome, id) => run(() => v.atribuirTecnico(osId, nome, id))}
                onRemover={p?.semTecnico ? undefined : () => run(() => v.removerTecnico(osId))}
                onClose={() => setOpen(null)}
              />
            </>
          ) : null}
        </div>
        <div className={pickerStyles.wrap}>
          <div style={upLabel}>Prioridade</div>
          <button
            type="button"
            disabled={!osId || busy}
            onClick={() => setOpen(open === "prio" ? null : "prio")}
            style={{ ...fieldBox, cursor: osId ? "pointer" : "default", width: "100%", textAlign: "left", background: "transparent" }}
          >
            {p?.prioridadeLabel ?? v.prio.label}
          </button>
          {open === "prio" && osId && p ? (
            <>
              <button type="button" onClick={() => setOpen(null)} style={{ position: "fixed", inset: 0, border: 0, background: "transparent", zIndex: 30 }} aria-label="Fechar" />
              <PrioridadePickerV4
                atual={p.prioridade}
                pending={busy}
                onEscolher={(prio) => run(() => v.definirPrioridade(osId, prio))}
                onClose={() => setOpen(null)}
              />
            </>
          ) : null}
        </div>
        <div>
          <div style={upLabel}>Status</div>
          <div style={{ fontSize: 13, fontWeight: 650, color: C.body }}>{p?.statusLabel ?? v.statusLabel}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: col3, gap: 10, marginTop: 10 }}>
        <div>
          <div style={upLabel}>SLA</div>
          <div style={{ fontSize: 13, fontWeight: 650, color: C.body }}>{p?.sla.texto ?? v.os.sla}</div>
        </div>
        <div>
          <div style={upLabel}>Local</div>
          <div style={{ fontSize: 13, fontWeight: 650, color: C.body }}>{p?.localFisico || "Não informado"}</div>
        </div>
        <div>
          {osId ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => (p?.naBancada ? v.sairBancada(osId) : v.entrarBancada(osId)))}
              style={{ ...btnGhost, marginTop: 16, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}
            >
              {busy ? "Salvando…" : p?.naBancada ? "Sair da bancada" : "Entrar na bancada"}
            </button>
          ) : null}
        </div>
      </div>
      {servico ? (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line3}` }}>
          <div style={upLabel}>Serviço aprovado</div>
          <div style={{ fontSize: 13, color: C.body }}>{servico}</div>
        </div>
      ) : null}
    </div>
  );
}

function ObservacaoInternaCard({ v }: { v: V4Vals }) {
  const osId = v.selectedOsId;
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);
  const internas = v.os.observacoesInternas;
  return (
    <div style={card}>
      <div style={{ ...cardTitle, marginBottom: 10 }}>Observações internas</div>
      {internas ? <p style={{ margin: "0 0 10px", fontSize: 12.5, color: C.body, whiteSpace: "pre-wrap" }}>{internas}</p> : <div style={{ ...emptyText, marginBottom: 8 }}>Nenhuma observação interna registrada.</div>}
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Nota visível só para a equipe…"
        rows={3}
        disabled={!osId || busy}
        style={{ width: "100%", minHeight: 72, resize: "vertical", border: `1px solid ${C.inputBd}`, borderRadius: 8, background: C.surface, color: C.body, padding: 8, fontSize: 12.5 }}
      />
      <button
        type="button"
        disabled={!osId || busy || !texto.trim()}
        onClick={async () => {
          if (!osId || busy) return;
          setBusy(true);
          try {
            const ok = await v.adicionarObservacaoInterna(osId, texto);
            if (ok) setTexto("");
          } finally {
            setBusy(false);
          }
        }}
        style={{ ...btnPrimary, marginTop: 8, background: C.primary, cursor: !osId || busy || !texto.trim() ? "default" : "pointer", opacity: !osId || busy || !texto.trim() ? 0.7 : 1 }}
      >
        {busy ? "Salvando…" : "Registrar observação"}
      </button>
    </div>
  );
}

function ConsumoEstoqueCard({ v }: { v: V4Vals }) {
  const e = v.execucao;
  const osId = v.selectedOsId;
  const [busy, setBusy] = useState(false);
  const pecas = e.estoque.length > 0
    ? e.estoque.map((m) => ({ id: m.id, label: m.nome, qty: m.quantidade, extra: m.saldo, ok: true }))
    : e.pecasPendentes.map((p) => ({
        id: p.id,
        label: p.nome,
        qty: `${p.quantidade}×`,
        extra: p.vinculada ? "" : "sem vínculo no catálogo",
        ok: p.vinculada,
      }));

  const run = async () => {
    if (!osId || busy || !e.podeBaixarEstoque) return;
    setBusy(true);
    try {
      await v.baixarEstoqueOS();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={card}>
      <div style={{ ...cardTitle, marginBottom: 11 }}>Consumo de estoque</div>
      {pecas.length === 0 ? (
        <div style={emptyText}>Nenhuma peça ou produto lançado nesta OS para baixar do estoque.</div>
      ) : (
        pecas.map((m) => (
          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12, padding: "6px 0", borderBottom: `1px solid ${C.line4}` }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: m.ok ? C.success : C.warn, flex: "none" }} />
            <span style={{ flex: 1, color: C.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {m.label}{m.qty ? <span style={{ color: C.subtle }}> {m.qty}</span> : null}
            </span>
            {m.extra ? <span style={{ color: C.subtle, fontVariantNumeric: "tabular-nums" }}>{m.extra}</span> : null}
          </div>
        ))
      )}
      {e.estoqueConsumido ? (
        <div style={{ fontSize: 10, color: C.subtle, marginTop: 9, lineHeight: 1.4 }}>
          Baixa de estoque confirmada{e.estoqueConsumidoEm ? ` · ${e.estoqueConsumidoEm}` : ""}. Replay não baixa de novo.
        </div>
      ) : e.podeBaixarEstoque ? (
        <button
          type="button"
          disabled={!osId || busy}
          onClick={() => void run()}
          style={{ ...btnPrimary, marginTop: 10, background: C.primary, cursor: !osId || busy ? "default" : "pointer", opacity: !osId || busy ? 0.7 : 1 }}
        >
          {busy ? "Baixando…" : "Baixar peças do estoque"}
        </button>
      ) : pecas.length > 0 ? (
        <div style={{ fontSize: 10, color: C.subtle, marginTop: 9, lineHeight: 1.4 }}>
          Vincule a peça ao catálogo no orçamento para baixar o estoque real.
        </div>
      ) : null}
    </div>
  );
}

function padraoChecklistTecnico() {
  return CHECKLIST_TECNICO_PADRAO.map((d) => ({ id: d.id, label: d.label, ok: false }));
}

function ChecklistTecnicoCard({ v }: { v: V4Vals }) {
  const osId = v.selectedOsId;
  const e = v.execucao;
  const persistidos = e.checklist.length > 0;
  const serverKey = persistidos
    ? e.checklist.map((it) => `${it.id}:${it.ok ? 1 : 0}`).join("|")
    : "padrao";
  const [itens, setItens] = useState(() => (persistidos ? e.checklist : padraoChecklistTecnico()));
  const [saving, setSaving] = useState(false);
  const touchedRef = useRef(false);
  const itensRef = useRef(itens);
  itensRef.current = itens;
  const persistRef = useRef(v.salvarChecklistTecnico);
  persistRef.current = v.salvarChecklistTecnico;
  const osIdRef = useRef(osId);
  osIdRef.current = osId;
  const osIdSeen = useRef(osId);
  const saverRef = useRef(
    createChecklistBurstSaver<{ id: string; label: string; ok: boolean }[]>(async (snapshot) => {
      const id = (osIdRef.current ?? "").trim();
      if (!id) return;
      await persistRef.current(id, snapshot);
    }),
  );

  useEffect(() => {
    if (osIdSeen.current !== osId) {
      osIdSeen.current = osId;
      touchedRef.current = false;
    }
    if (touchedRef.current) return;
    const next = persistidos ? e.checklist : padraoChecklistTecnico();
    itensRef.current = next;
    setItens(next);
  }, [osId, persistidos, serverKey, e.checklist]);

  const marcar = (id: string) => {
    if (!osId) return;
    touchedRef.current = true;
    const next = toggleChecklistTecnicoItem(itensRef.current, id);
    itensRef.current = next;
    setItens(next);
    setSaving(true);
    void saverRef.current.submit(next).finally(() => {
      if (!saverRef.current.pending) setSaving(false);
    });
  };

  const okCount = itens.filter((it) => it.ok).length;

  return (
    <div style={card}>
      <div style={{ ...cardTitle, marginBottom: 11 }}>
        Checklist técnico (pós-reparo){persistidos || touchedRef.current ? ` · ${okCount}/${itens.length}` : ""}
      </div>
      {!persistidos && !touchedRef.current ? (
        <div style={{ ...emptyText, marginBottom: 8 }}>Nenhum checklist de execução registrado. Inicie o padrão da bancada para marcar as etapas.</div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {itens.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={!osId}
            onClick={() => marcar(t.id)}
            style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: t.ok ? C.body : C.subtle, background: "transparent", border: 0, padding: 0, textAlign: "left", cursor: osId ? "pointer" : "default" }}
          >
            {t.ok
              ? <span style={{ width: 18, height: 18, borderRadius: 5, background: C.success, color: C.white, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flex: "none" }}>✓</span>
              : <span style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${C.dashed}`, flex: "none" }} />}
            {t.label}
          </button>
        ))}
      </div>
      {saving ? (
        <div style={{ fontSize: 10, color: C.subtle, marginTop: 9, lineHeight: 1.4 }}>Salvando checklist…</div>
      ) : null}
    </div>
  );
}

export function ExecucaoStage({ v }: { v: V4Vals }) {
  const e = v.execucao;

  if (!e.temExecucao) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <ProducaoResumoExecucao v={v} />
        <ExecAcoesCard v={v} />
        <ChecklistTecnicoCard v={v} />
        <ObservacaoInternaCard v={v} />
        <ConsumoEstoqueCard v={v} />
        <div style={card}>
          <div style={{ ...cardTitle, marginBottom: 6 }}>Apontamentos</div>
          <div style={emptyText}>Ainda não existe execução registrada para esta Ordem de Serviço.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ProducaoResumoExecucao v={v} />
      <ExecAcoesCard v={v} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, alignItems: "start" }}>
        <ChecklistTecnicoCard v={v} />

        {/* Apontamentos de produção — eventos reais de execução da timeline */}
        <div style={card}>
          <div style={{ ...cardTitle, marginBottom: 11 }}>Apontamentos de produção</div>
          {e.apontamentos.length === 0 ? (
            <div style={emptyText}>Nenhum apontamento técnico registrado.</div>
          ) : (
            e.apontamentos.map((ap) => (
              <div key={ap.id} style={{ display: "flex", gap: 10, paddingBottom: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: ap.dot, flex: "none", marginTop: 3 }} />
                  <span style={{ flex: 1, width: 2, background: C.line2, marginTop: 3 }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: C.body }}>{ap.text}</div>
                  <div style={{ fontSize: 10.5, color: C.subtle }}>{ap.meta}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: col2, gap: 12, alignItems: "start" }}>
        <ConsumoEstoqueCard v={v} />

        {/* Anexos de execução / bancada — reais da OS */}
        <div style={card}>
          <div style={{ ...cardTitle, marginBottom: 9 }}>
            Anexos de execução{e.anexos.length > 0 ? ` · ${e.anexos.length}` : ""}
          </div>
          {e.anexos.length === 0 ? (
            <div style={emptyText}>Nenhum anexo de execução disponível.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: col2, gap: 8 }}>
              {e.anexos.map((ax) => (
                <div key={ax.id} style={{ border: `1px solid ${C.line2}`, borderRadius: 9, overflow: "hidden" }}>
                  <div style={{ height: 62, background: HATCH, position: "relative" }}>
                    <span style={{ position: "absolute", left: 5, top: 5, fontSize: 8, background: "rgba(0,0,0,.55)", color: C.white, padding: "1px 5px", borderRadius: 3 }}>{ax.kind}</span>
                  </div>
                  <div style={{ padding: "6px 8px", fontSize: 11, color: C.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ax.name}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ObservacaoInternaCard v={v} />

    </div>
  );
}
