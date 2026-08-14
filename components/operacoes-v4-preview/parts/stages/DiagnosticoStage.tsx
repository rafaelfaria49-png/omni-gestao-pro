/** Operações V4 — etapa Diagnóstico (REAL · slice OPS-V4-ORCAMENTO-REAL-002).
 *
 * Deixou de ser somente leitura: além de mostrar defeito relatado, anexos e
 * eventos reais (read-only), agora EDITA o parecer técnico estruturado e salva
 * via `salvarDiagnosticoV3` (reuso da action da V3) — grava `payload.diagnosticoV3`
 * + evento `diagnostico_registrado`. NÃO muda status, NÃO toca valor/estoque/
 * financeiro. O editor é V4-native (sem shadcn/V3). */
import { useState } from "react";
import { C, card, cardTitle, upLabel, HATCH } from "../../tokens";
import type { V4Vals } from "../../use-v4-preview";

const fieldBox = {
  border: `1px solid ${C.line2}`,
  borderRadius: 8,
  background: C.surface2,
  padding: 9,
  fontSize: 12,
  lineHeight: 1.5,
  color: C.body,
} as const;

const emptyText = { fontSize: 12, color: C.subtle, padding: "8px 2px", lineHeight: 1.5 } as const;

const textarea: React.CSSProperties = {
  width: "100%",
  minHeight: 52,
  padding: "8px 11px",
  border: `1px solid ${C.inputBd}`,
  borderRadius: 8,
  fontSize: 12.5,
  color: C.body,
  resize: "vertical",
  fontFamily: "inherit",
  background: C.surface,
};

export function DiagnosticoStage({ v }: { v: V4Vals }) {
  // Re-monta o editor ao trocar de OS → re-semeia os campos com o parecer real.
  return <DiagnosticoStageInner key={v.selectedOsId ?? "none"} v={v} />;
}

function DiagnosticoStageInner({ v }: { v: V4Vals }) {
  const d = v.diag;
  const [inicial, setInicial] = useState(d.parecerInicial);
  const [causa, setCausa] = useState(d.causa);
  const [solucao, setSolucao] = useState(d.solucao);
  const [saving, setSaving] = useState(false);
  const comercial = v.comercialHeader;

  const podeSalvar = v.osSelected && !saving;

  const onSalvar = async () => {
    if (!podeSalvar) return;
    setSaving(true);
    try {
      await v.salvarDiagnostico({ inicial, final: d.parecerFinal, causa, solucao });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={card}>
          <div style={{ ...cardTitle, marginBottom: 11 }}>Diagnóstico técnico</div>
          <div style={{ ...upLabel, marginBottom: 4 }}>Cliente relatou</div>
          <div style={{ ...fieldBox, minHeight: 40, color: d.temDefeito ? C.body : C.subtle }}>{d.temDefeito ? d.defeito : "Sem relato do cliente."}</div>
          {d.parecerFinal ? (
            <p style={{ ...emptyText, marginTop: 8 }}>Conclusão já registrada (consulta): {d.parecerFinal}</p>
          ) : null}

          {!v.osSelected ? (
            <div style={{ ...emptyText, marginTop: 12 }}>Selecione uma Ordem de Serviço para registrar o diagnóstico.</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10, marginTop: 13 }}>
                <div>
                  <div style={{ ...upLabel, marginBottom: 4 }}>Avaliação inicial</div>
                  <textarea value={inicial} onChange={(e) => setInicial(e.target.value)} maxLength={2000} placeholder="Avaliação inicial do técnico…" style={textarea} />
                </div>
                <div>
                  <div style={{ ...upLabel, marginBottom: 4 }}>Causa provável</div>
                  <textarea value={causa} onChange={(e) => setCausa(e.target.value)} maxLength={2000} placeholder="Causa identificada…" style={textarea} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ ...upLabel, marginBottom: 4 }}>Solução recomendada</div>
                  <textarea value={solucao} onChange={(e) => setSolucao(e.target.value)} maxLength={2000} placeholder="Solução e observações técnicas…" style={textarea} />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <button
                  type="button"
                  onClick={onSalvar}
                  disabled={!podeSalvar}
                  style={{ height: 34, padding: "0 16px", border: "none", background: C.primary, color: C.white, borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: podeSalvar ? "pointer" : "default", opacity: podeSalvar ? 1 : 0.6 }}
                >
                  {saving ? "Salvando…" : "Salvar diagnóstico"}
                </button>
              </div>
            </>
          )}
        </div>

        {v.osSelected ? (
          <div style={card}>
            <div style={{ ...cardTitle, marginBottom: 8 }}>Orçamento</div>
            {comercial.hasBudget ? (
              <button type="button" onClick={() => v.goOrcamento()} style={{ ...fieldBox, width: "100%", cursor: "pointer", justifyContent: "space-between" }}>
                <span>{comercial.label}</span>
                <span style={{ color: C.primary, fontWeight: 700 }}>Abrir</span>
              </button>
            ) : (
              <button type="button" onClick={() => v.goOrcamento()} style={{ height: 34, padding: "0 16px", border: "none", background: C.primary, color: C.white, borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                Criar orçamento
              </button>
            )}
          </div>
        ) : null}

        <div style={card}>
          <div style={{ ...cardTitle, marginBottom: 9 }}>
            Anexos de diagnóstico{d.anexos.length > 0 ? ` · ${d.anexos.length}` : ""}
          </div>
          {d.anexos.length === 0 ? (
            <div style={emptyText}>Nenhum anexo de diagnóstico disponível.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8 }}>
              {d.anexos.map((ax) => (
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

      <div style={card}>
        <div style={{ ...cardTitle, marginBottom: 11 }}>Registros de diagnóstico</div>
        {d.eventos.length === 0 ? (
          <div style={emptyText}>Ainda não existe diagnóstico registrado para esta Ordem de Serviço.</div>
        ) : (
          d.eventos.map((ev) => (
            <div key={ev.id} style={{ display: "flex", gap: 10, paddingBottom: 11 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: ev.dot, flex: "none", marginTop: 3 }} />
                <span style={{ flex: 1, width: 2, background: C.line2, marginTop: 3 }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: C.body }}>{ev.text}</div>
                <div style={{ fontSize: 10.5, color: C.subtle }}>{ev.meta}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
