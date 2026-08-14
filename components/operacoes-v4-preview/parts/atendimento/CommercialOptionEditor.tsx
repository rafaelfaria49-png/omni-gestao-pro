"use client";

import { C, fmt } from "../../tokens";
import { lucroEstimadoV4, margemEstimadaV4 } from "@/lib/operacoes-v4/atendimento-comercial";
import type { OrcamentoRapidoVarianteFormV4 } from "@/lib/operacoes-v4/orcamento-rapido-form";
import { atendInput, atendLabel } from "./field-styles";

export function CommercialOptionEditor({
  index,
  value,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  value: OrcamentoRapidoVarianteFormV4;
  onChange: (next: OrcamentoRapidoVarianteFormV4) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const lucro = lucroEstimadoV4(value.valor, value.custoV3);
  const margem = margemEstimadaV4(value.valor, value.custoV3);
  const recomendada = value.badge.trim().toLowerCase() === "recomendada";

  return (
    <div style={{ border: `1px solid ${C.line2}`, borderRadius: 12, padding: 12, marginBottom: 8, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.subtle }}>Opção {index + 1}</span>
        <button type="button" onClick={onRemove} disabled={!canRemove} style={{ height: 22, width: 22, border: "none", background: "transparent", color: canRemove ? C.dangerFg : C.muted, cursor: canRemove ? "pointer" : "default" }}>
          ×
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,0.7fr) minmax(0,0.7fr)", gap: 8, marginBottom: 8 }}>
        <div>
          <div style={atendLabel}>Rótulo *</div>
          <input value={value.rotulo} onChange={(e) => onChange({ ...value, rotulo: e.target.value })} placeholder="Tela Premium" style={atendInput} maxLength={60} autoComplete="off" />
        </div>
        <div>
          <div style={atendLabel}>Venda *</div>
          <input type="number" min={0} step="0.01" value={value.valor || ""} onChange={(e) => onChange({ ...value, valor: Math.max(0, Number(e.target.value) || 0) })} placeholder="R$" style={atendInput} />
        </div>
        <div>
          <div style={atendLabel}>Garantia (dias)</div>
          <input type="number" min={0} value={value.garantiaDias || ""} onChange={(e) => onChange({ ...value, garantiaDias: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} placeholder="90" style={atendInput} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,0.7fr) minmax(0,0.7fr)", gap: 8, marginBottom: 8 }}>
        <div>
          <div style={atendLabel}>Descrição para o cliente</div>
          <input value={value.descricaoCurta} onChange={(e) => onChange({ ...value, descricaoCurta: e.target.value })} placeholder="Ótima qualidade de imagem" style={atendInput} maxLength={120} autoComplete="off" />
        </div>
        <div>
          <div style={atendLabel}>Prazo</div>
          <input value={value.prazoTexto} onChange={(e) => onChange({ ...value, prazoTexto: e.target.value })} placeholder="2 horas" style={atendInput} maxLength={40} autoComplete="off" />
        </div>
        <div>
          <div style={atendLabel}>Selo</div>
          <input value={value.badge} onChange={(e) => onChange({ ...value, badge: e.target.value })} placeholder="Recomendada" style={atendInput} maxLength={24} autoComplete="off" />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: 8, alignItems: "end" }}>
        <div>
          <div style={atendLabel}>Custo interno</div>
          <input type="number" min={0} step="0.01" value={value.custoV3 || ""} onChange={(e) => onChange({ ...value, custoV3: Math.max(0, Number(e.target.value) || 0) })} placeholder="R$" title="Custo interno — não aparece para o cliente." style={{ ...atendInput, background: C.muted100, color: C.subtle }} />
        </div>
        <div
          style={{
            border: `1px dashed ${C.line2}`,
            background: C.muted100,
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 11,
            color: C.subtle,
            lineHeight: 1.45,
          }}
        >
          Interno — não aparece para o cliente. Lucro {fmt(lucro)}
          {margem != null ? ` · margem ${margem.toFixed(1)}%` : ""}
          {recomendada ? " · recomendada" : ""}
        </div>
      </div>
    </div>
  );
}
