/** Operações V4 Preview — etapa Execução.
 *
 * GOAL OPS-V4-P0-011: o técnico/timer/apontamentos/checklist/bancada/consumo
 * fabricados ("Bancada 02", timer "02:14", TECH_DEF, APONTAMENTOS, "baixado /
 * reservar", serviços/peças "R$ 890") foram removidos. O stage lê só o que a OS
 * persiste — técnico responsável, checklist técnico (pós-reparo), apontamentos
 * reais (eventos de execução da timeline), peças consumidas (estoqueMovimentos)
 * e anexos de bancada — ou exibe empty state honesto. Nada de valor inventado.
 *
 * GOAL OPS-V4-EXECUCAO-REAL-007: as transições de status (iniciar/retomar
 * execução, marcar aguardando peça, marcar pronta) deixam de ser preview —
 * chamam `aplicarTransicaoStatusV3` (reuso da V3, via `use-v4-preview`) e só
 * ficam habilitadas quando a máquina única permite a partir do status real
 * (`v.execAcoes`). Checklist técnico, apontamentos, peças/estoque e observação
 * técnica permanecem read-only: não existe action V3 segura para editá-los
 * ainda (checklist técnico só grava pelo write-path legado da V2, fora do
 * escopo permitido). */
import { useState } from "react";
import { C, card, cardTitle, upLabel, HATCH } from "../../tokens";
import type { V4Vals } from "../../use-v4-preview";

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

export function ExecucaoStage({ v }: { v: V4Vals }) {
  const e = v.execucao;

  if (!e.temExecucao) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <ExecAcoesCard v={v} />
        <div style={card}>
          <div style={{ ...cardTitle, marginBottom: 6 }}>Execução</div>
          <div style={emptyText}>Ainda não existe execução registrada para esta Ordem de Serviço.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ExecAcoesCard v={v} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, alignItems: "start" }}>
        {/* Produção / Técnico (real, somente leitura) */}
        <div style={card}>
          <div style={{ ...cardTitle, marginBottom: 10 }}>⚙ Produção / Técnico</div>
          <div style={{ ...upLabel, marginBottom: 5 }}>Técnico responsável</div>
          {e.temTecnico ? (
            <div style={{ ...fieldBox, marginBottom: 11 }}>{e.tecnico}</div>
          ) : (
            <div style={{ ...emptyText, marginBottom: 6 }}>Nenhum técnico vinculado à execução.</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: col3, gap: 10, borderTop: `1px solid ${C.line3}`, paddingTop: 11 }}>
            <div><div style={upLabel}>Prioridade</div><div style={{ fontSize: 12.5, color: v.prio.fg, fontWeight: 600 }}>{v.prio.label}</div></div>
            <div><div style={upLabel}>Status</div><div style={{ fontSize: 12.5, color: C.body, fontWeight: 500 }}>{v.statusLabel}</div></div>
            <div><div style={upLabel}>SLA</div><div style={{ fontSize: 12.5, color: C.body, fontWeight: 500 }}>{v.os.sla}</div></div>
          </div>
        </div>

        {/* Checklist técnico (pós-reparo) — real da OS */}
        <div style={card}>
          <div style={{ ...cardTitle, marginBottom: 11 }}>
            Checklist técnico (pós-reparo){e.checklist.length > 0 ? ` · ${e.checklistOk}/${e.checklist.length}` : ""}
          </div>
          {e.checklist.length === 0 ? (
            <div style={emptyText}>Nenhum checklist de execução registrado.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {e.checklist.map((t) => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: t.ok ? C.body : C.subtle }}>
                  {t.ok
                    ? <span style={{ width: 18, height: 18, borderRadius: 5, background: C.success, color: C.white, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flex: "none" }}>✓</span>
                    : <span style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${C.dashed}`, flex: "none" }} />}
                  {t.label}
                </div>
              ))}
            </div>
          )}
        </div>

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
        {/* Consumo de estoque — movimentações reais da OS */}
        <div style={card}>
          <div style={{ ...cardTitle, marginBottom: 11 }}>Consumo de estoque</div>
          {e.estoque.length === 0 ? (
            <div style={emptyText}>Nenhuma movimentação de estoque registrada.</div>
          ) : (
            <>
              {e.estoque.map((m) => (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12, padding: "6px 0", borderBottom: `1px solid ${C.line4}` }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.success, flex: "none" }} />
                  <span style={{ flex: 1, color: C.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {m.nome}{m.quantidade ? <span style={{ color: C.subtle }}> {m.quantidade}</span> : null}
                  </span>
                  {m.saldo ? <span style={{ color: C.subtle, fontVariantNumeric: "tabular-nums" }}>{m.saldo}</span> : null}
                </div>
              ))}
              {e.estoqueConsumido && (
                <div style={{ fontSize: 10, color: C.subtle, marginTop: 9, lineHeight: 1.4 }}>
                  Baixa de estoque confirmada{e.estoqueConsumidoEm ? ` · ${e.estoqueConsumidoEm}` : ""}.
                </div>
              )}
            </>
          )}
        </div>

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

    </div>
  );
}
