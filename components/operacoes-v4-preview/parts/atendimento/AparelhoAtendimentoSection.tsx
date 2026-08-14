"use client";

import { C, MONO } from "../../tokens";
import {
  EQUIP_TIPO_ATENDIMENTO_V4,
  type AparelhoAtendimentoV4,
} from "@/lib/operacoes-v4/atendimento-comercial";
import { atendInput, atendLabel } from "./field-styles";

export function AparelhoAtendimentoSection({
  value,
  onChange,
}: {
  value: AparelhoAtendimentoV4;
  onChange: (next: AparelhoAtendimentoV4) => void;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 11 }}>
        {EQUIP_TIPO_ATENDIMENTO_V4.map((o) => {
          const sel = value.tipo === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => onChange({ ...value, tipo: o.key })}
              style={{
                height: 28,
                padding: "0 12px",
                border: `1px solid ${sel ? C.primaryBd : C.inputBd}`,
                background: sel ? C.primaryBg : C.surface,
                color: sel ? C.primaryHover : C.muted,
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10, marginBottom: 10 }}>
        <div>
          <div style={atendLabel}>Marca *</div>
          <input value={value.marca} onChange={(e) => onChange({ ...value, marca: e.target.value })} maxLength={40} placeholder="Samsung" style={atendInput} autoComplete="off" />
        </div>
        <div>
          <div style={atendLabel}>Modelo *</div>
          <input value={value.modelo} onChange={(e) => onChange({ ...value, modelo: e.target.value })} maxLength={60} placeholder="Galaxy S22" style={atendInput} autoComplete="off" />
        </div>
        <div>
          <div style={atendLabel}>IMEI / serial</div>
          <input value={value.imei} onChange={(e) => onChange({ ...value, imei: e.target.value })} maxLength={40} placeholder="opcional" style={{ ...atendInput, fontFamily: MONO }} autoComplete="off" />
        </div>
        <div>
          <div style={atendLabel}>Cor</div>
          <input value={value.cor} onChange={(e) => onChange({ ...value, cor: e.target.value })} maxLength={30} placeholder="opcional" style={atendInput} autoComplete="off" />
        </div>
      </div>
      <div>
        <div style={atendLabel}>Defeito relatado *</div>
        <textarea
          value={value.defeitoRelatado}
          onChange={(e) => onChange({ ...value, defeitoRelatado: e.target.value })}
          maxLength={1000}
          placeholder="Tela quebrada. Cliente informa que o aparelho ainda liga."
          style={{ width: "100%", minHeight: 58, padding: "8px 11px", border: `1px solid ${C.inputBd}`, borderRadius: 8, fontSize: 12.5, color: C.body, resize: "vertical", fontFamily: "inherit", background: C.surface }}
          autoComplete="off"
        />
      </div>
    </div>
  );
}
