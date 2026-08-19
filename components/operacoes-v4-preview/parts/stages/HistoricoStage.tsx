/** Operações V4 — Histórico transversal (timeline, cliente/aparelho, OS relacionadas). */
"use client";

import { useState } from "react";
import { C, card, cardTitle, HATCH } from "../../tokens";
import type { V4Vals } from "../../use-v4-preview";

const empty = { fontSize: 12.5, color: C.subtle, padding: "6px 2px", lineHeight: 1.5 } as const;

function dataCurta(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR").format(d);
}

export function HistoricoStage({ v }: { v: V4Vals }) {
  const h = v.historicoTransversal;
  const [obs, setObs] = useState("");
  const [busy, setBusy] = useState(false);

  if (!v.osSelected) {
    return (
      <div style={card}>
        <div style={cardTitle}>Histórico</div>
        <p style={empty}>Selecione uma OS para ver a timeline, o aparelho e as OS relacionadas.</p>
      </div>
    );
  }

  const papelLabel: Record<string, string> = {
    aparelho: "Mesmo aparelho",
    cliente: "Mesmo cliente",
    retorno: "Retorno",
    origem: "OS original",
    atual: "Atual",
  };

  return (
    <>
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ ...cardTitle, marginBottom: 10 }}>Identidade</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <div><div style={{ fontSize: 10.5, color: C.subtle, fontWeight: 700, textTransform: "uppercase" }}>OS</div><div style={{ fontSize: 13, fontWeight: 700 }}>{h.osAtual}</div></div>
          <div><div style={{ fontSize: 10.5, color: C.subtle, fontWeight: 700, textTransform: "uppercase" }}>Cliente</div><div style={{ fontSize: 13, fontWeight: 650 }}>{h.cliente}</div></div>
          <div><div style={{ fontSize: 10.5, color: C.subtle, fontWeight: 700, textTransform: "uppercase" }}>Aparelho</div><div style={{ fontSize: 13 }}>{h.aparelho}</div></div>
          <div><div style={{ fontSize: 10.5, color: C.subtle, fontWeight: 700, textTransform: "uppercase" }}>IMEI / serial</div><div style={{ fontSize: 12.5, color: C.body }}>{h.imei || h.serial || "Não informado"}</div></div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {h.garantiaLabel ? <span style={{ fontSize: 11, fontWeight: 650, color: C.muted }}>{h.garantiaLabel}</span> : null}
          {h.retornosAbertos > 0 ? <span style={{ fontSize: 11, fontWeight: 700, color: C.warnFg }}>{h.retornosAbertos} retorno(s) aberto(s)</span> : null}
          {h.temAssinatura ? <span style={{ fontSize: 11, fontWeight: 650, color: C.successFg }}>Assinatura registrada</span> : <span style={{ fontSize: 11, color: C.subtle }}>Sem assinatura</span>}
          {h.temAnexos ? <span style={{ fontSize: 11, color: C.body }}>Anexos/fotos nesta OS</span> : <span style={{ fontSize: 11, color: C.subtle }}>Sem anexos</span>}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          <button type="button" onClick={() => v.openDocPrint("os_cliente")} style={btnGhost}>Imprimir OS</button>
          <button type="button" onClick={() => v.openDocPrint("termo_garantia")} style={btnGhost}>Termo de garantia</button>
          <button type="button" onClick={() => v.openDocPrint("termo_entrega")} style={btnGhost}>Termo de entrega</button>
          {h.telefone ? (
            <button type="button" onClick={v.act.ligar} style={btnGhost}>Ligar</button>
          ) : null}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {v.histFilters.map((hf) => (
          <button key={hf.label} type="button" onClick={hf.onClick} style={{ height: 28, padding: "0 12px", border: `1px solid ${hf.bd}`, background: hf.bg, color: hf.fg, borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>{hf.label}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={v.act.exportHist} style={{ height: 28, padding: "0 12px", border: `1px solid ${C.inputBd}`, background: C.surface, color: C.body, borderRadius: 8, fontSize: 11.5, fontWeight: 500, cursor: "pointer" }}>⬇ Exportar auditoria</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, alignItems: "start" }}>
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={cardTitle}>Timeline da OS</span>
            <span style={{ fontSize: 10.5, color: C.subtle }}>{v.histCount} eventos</span>
          </div>
          {v.hist.length === 0 ? (
            <div style={empty}>Nenhum evento registrado para esta OS.</div>
          ) : (
            v.hist.map((ev, i) => (
              <div key={ev.id || i} style={{ display: "flex", gap: 11, paddingBottom: 11 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: ev.dot }} />
                  <span style={{ flex: 1, width: 2, background: C.line2, marginTop: 3 }} />
                </div>
                <div>
                  <div style={{ fontSize: 12.5, color: C.body }}>{ev.text}</div>
                  <div style={{ fontSize: 11, color: C.subtle }}>{ev.meta}</div>
                </div>
              </div>
            ))
          )}
        </div>

        <div style={card}>
          <div style={{ ...cardTitle, marginBottom: 10 }}>OS relacionadas</div>
          {h.relacionadas.length === 0 ? (
            <div style={empty}>
              {h.aparelhoTemHistorico ? "Não há outras OS para listar." : "Nenhuma OS relacionada por aparelho, cliente ou retorno."}
            </div>
          ) : (
            h.relacionadas.map((row) => (
              <button
                key={`${row.papel}-${row.osId}`}
                type="button"
                onClick={() => v.openOSFromRail(row.osId, false, "historico")}
                style={{ display: "block", width: "100%", textAlign: "left", border: `1px solid ${C.line2}`, background: C.surface, borderRadius: 8, padding: "8px 10px", marginBottom: 7, cursor: "pointer" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <strong style={{ fontSize: 12.5, color: C.ink }}>{row.codigo}</strong>
                  <span style={{ fontSize: 10.5, color: C.subtle }}>{papelLabel[row.papel] || row.papel}</span>
                </div>
                <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{row.statusLabel}{row.quando ? ` · ${dataCurta(row.quando)}` : ""}</div>
                {row.extra ? <div style={{ fontSize: 11, color: C.subtle, marginTop: 2 }}>{row.extra}</div> : null}
              </button>
            ))
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginTop: 12, alignItems: "start" }}>
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={cardTitle}>Anexos e fotos</span>
            <span style={{ fontSize: 11, color: C.subtle }}>{v.anexos.length}</span>
          </div>
          {v.anexos.length === 0 ? (
            <div style={empty}>Nenhum anexo nesta OS.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8 }}>
              {v.anexos.map((ax) => (
                <div key={ax.id} style={{ border: `1px solid ${C.line2}`, borderRadius: 9, overflow: "hidden" }}>
                  <div style={{ height: 62, background: ax.dataUrl ? C.surface2 : HATCH, position: "relative" }}>
                    {ax.dataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ax.dataUrl} alt={ax.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    ) : null}
                    <span style={{ position: "absolute", left: 5, top: 5, fontSize: 8, background: "rgba(0,0,0,.55)", color: C.white, padding: "1px 5px", borderRadius: 3 }}>{ax.kind}</span>
                  </div>
                  <div style={{ padding: "6px 8px", fontSize: 11, color: C.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ax.name}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={card}>
          <div style={{ ...cardTitle, marginBottom: 10 }}>Observações internas</div>
          {v.observacoes.length === 0 && !v.os.observacoesInternas ? (
            <div style={{ ...empty, marginBottom: 8 }}>Nenhuma observação registrada.</div>
          ) : (
            <>
              {v.os.observacoesInternas ? <p style={{ margin: "0 0 8px", fontSize: 12.5, color: C.body, whiteSpace: "pre-wrap" }}>{v.os.observacoesInternas}</p> : null}
              {v.observacoes.map((o) => (
                <div key={o.id} style={{ border: `1px solid ${C.line2}`, borderRadius: 8, background: C.surface2, padding: 9, marginBottom: 7 }}>
                  <div style={{ fontSize: 12, color: C.body }}>{o.conteudo}</div>
                  <div style={{ fontSize: 10.5, color: C.subtle, marginTop: 3 }}>{o.autor}{o.interna ? " · interna" : ""}</div>
                </div>
              ))}
            </>
          )}
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            placeholder="Nova observação interna…"
            rows={3}
            disabled={busy || !v.selectedOsId}
            style={{ width: "100%", minHeight: 64, resize: "vertical", border: `1px solid ${C.inputBd}`, borderRadius: 8, background: C.surface, color: C.body, padding: 8, fontSize: 12.5 }}
          />
          <button
            type="button"
            disabled={busy || !obs.trim() || !v.selectedOsId}
            onClick={async () => {
              if (!v.selectedOsId || busy) return;
              setBusy(true);
              try {
                const ok = await v.adicionarObservacaoInterna(v.selectedOsId, obs);
                if (ok) setObs("");
              } finally {
                setBusy(false);
              }
            }}
            style={{ height: 32, marginTop: 8, padding: "0 12px", border: 0, borderRadius: 8, background: C.primary, color: C.white, fontSize: 12, fontWeight: 650, cursor: busy || !obs.trim() ? "default" : "pointer", opacity: busy || !obs.trim() ? 0.7 : 1 }}
          >
            {busy ? "Salvando…" : "Registrar observação"}
          </button>
        </div>
      </div>
    </>
  );
}

const btnGhost: React.CSSProperties = {
  height: 30,
  padding: "0 10px",
  border: `1px solid ${C.inputBd}`,
  background: C.surface,
  color: C.body,
  borderRadius: 8,
  fontSize: 11.5,
  fontWeight: 600,
  cursor: "pointer",
};
