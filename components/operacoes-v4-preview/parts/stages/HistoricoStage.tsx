/** Operações V4 Preview — etapa Histórico (auditoria filtrável, anexos, observações). */
import { C, card, cardTitle, HATCH } from "../../tokens";
import type { V4Vals } from "../../use-v4-preview";

export function HistoricoStage({ v }: { v: V4Vals }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {v.histFilters.map((hf) => (
          <button key={hf.label} type="button" onClick={hf.onClick} style={{ height: 28, padding: "0 12px", border: `1px solid ${hf.bd}`, background: hf.bg, color: hf.fg, borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>{hf.label}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={v.act.exportHist} style={{ height: 28, padding: "0 12px", border: `1px solid ${C.inputBd}`, background: C.surface, color: C.body, borderRadius: 8, fontSize: 11.5, fontWeight: 500, cursor: "pointer" }}>⬇ Exportar auditoria</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, alignItems: "start" }}>
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={cardTitle}>Histórico completo (auditoria)</span>
            <span style={{ fontSize: 10.5, color: C.subtle }}>{v.histCount} eventos</span>
          </div>
          {v.hist.length === 0 ? (
            <div style={{ fontSize: 12.5, color: C.subtle, padding: "6px 2px" }}>
              Nenhum evento registrado para esta OS.
            </div>
          ) : (
            v.hist.map((h, i) => (
              <div key={h.id || i} style={{ display: "flex", gap: 11, paddingBottom: 11 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: h.dot }} />
                  <span style={{ flex: 1, width: 2, background: C.line2, marginTop: 3 }} />
                </div>
                <div><div style={{ fontSize: 12.5, color: C.body }}>{h.text}</div><div style={{ fontSize: 11, color: C.subtle }}>{h.meta}</div></div>
              </div>
            ))
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={cardTitle}>Anexos</span>
              <span style={{ fontSize: 11, color: C.subtle }}>{v.anexos.length} {v.anexos.length === 1 ? "arquivo" : "arquivos"}</span>
            </div>
            {v.anexos.length === 0 ? (
              <div style={{ fontSize: 12, color: C.subtle }}>Nenhum anexo nesta OS.</div>
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
            <div style={{ ...cardTitle, marginBottom: 10 }}>Observações ({v.observacoes.length})</div>
            {v.observacoes.length === 0 ? (
              <div style={{ fontSize: 12, color: C.subtle }}>Nenhuma observação registrada.</div>
            ) : (
              v.observacoes.map((o) => (
                <div key={o.id} style={{ border: `1px solid ${C.line2}`, borderRadius: 8, background: C.surface2, padding: 9, marginBottom: 7 }}>
                  <div style={{ fontSize: 12, color: C.body }}>{o.conteudo}</div>
                  <div style={{ fontSize: 10.5, color: C.subtle, marginTop: 3 }}>{o.autor}{o.interna ? " · interna" : ""}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
