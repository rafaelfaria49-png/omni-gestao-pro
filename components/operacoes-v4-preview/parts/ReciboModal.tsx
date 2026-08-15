/** Operações V4 Preview — modal de recibo de pagamento.
 *
 * GOAL OPS-V4-P0-008: o recibo fabricado (cliente/valor/PIX/data fixos) foi
 * removido — sem recebimento, o modal mostra um empty state honesto.
 *
 * PDV-SERVICO-OS-RECEBIMENTO-REAL-001: quando existe um recebimento real desta
 * sessão (`v.pdvServico.ultimoRecibo`, resultado de `receberOSV3`), mostra o
 * comprovante de verdade — mesma estrutura de dados do `ComprovanteReciboV3` da
 * V3, só a apresentação é V4-nativa. A impressão reusa o motor real
 * `ReciboPreviewV3` (browser print — sem PDF novo). */
"use client";

import { useState } from "react";
import { C, fmt } from "../tokens";
import { fmtDataHora } from "../os-adapter";
import type { V4Vals } from "../use-v4-preview";
import { ReciboPreviewV3 } from "@/components/operacoes-v3/components/print/ReciboPreviewV3";

export function ReciboModal({ v }: { v: V4Vals }) {
  const [printOpen, setPrintOpen] = useState(false);
  if (!v.reciboOpen) return null;
  const recibo = v.pdvServico.ultimoRecibo;
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 70, background: "rgba(17,19,26,.42)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: 380, maxWidth: "100%", background: C.surface, borderRadius: 14, boxShadow: "0 24px 60px rgba(17,19,26,.3)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: `1px solid ${C.line2}` }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>🧾 Recibo de pagamento</div>
          <button type="button" onClick={v.closeRecibo} style={{ width: 26, height: 26, border: "none", background: C.muted50, borderRadius: 7, color: C.muted, fontSize: 15, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ padding: 22 }}>
          {recibo ? (
            <div style={{ fontSize: 12, color: C.body, lineHeight: 1.6 }}>
              <div style={{ textAlign: "center", marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>OS {recibo.numeroOS}</div>
                <div style={{ fontSize: 11, color: C.subtle }}>{recibo.cliente} · {recibo.equipamento}</div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ color: C.subtle }}>{recibo.intencaoLabel}</span>
                <span style={{ fontWeight: 700, color: C.ink }}>{fmt(recibo.valorPago)}</span>
              </div>
              {recibo.formas.map((f) => (
                <div key={f.forma} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.subtle }}>
                  <span>{f.label}</span><span>{fmt(f.valor)}</span>
                </div>
              ))}
              <div style={{ borderTop: `1px solid ${C.line2}`, marginTop: 9, paddingTop: 9, display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: C.subtle }}>Total da OS</span><span>{fmt(recibo.totalOS)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: C.subtle }}>Recebido</span><span style={{ color: C.successFg, fontWeight: 600 }}>{fmt(recibo.recebidoAcumulado)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: C.subtle }}>Saldo</span><span style={{ color: recibo.saldoRestante > 0 ? C.warnFg : C.body, fontWeight: 600 }}>{fmt(recibo.saldoRestante)}</span></div>
              </div>
              {recibo.observacao && <div style={{ fontSize: 10.5, color: C.subtle, marginTop: 9 }}>{recibo.observacao}</div>}
              <div style={{ fontSize: 10, color: C.faint2, marginTop: 11, textAlign: "center" }}>{fmtDataHora(recibo.dataHora)} · {recibo.operador}</div>
            </div>
          ) : (
            <div style={{ textAlign: "center", color: C.subtle, fontSize: 12.5, lineHeight: 1.6, padding: "10px 4px 18px" }}>
              Não existe recibo registrado para esta Ordem de Serviço.
              <div style={{ fontSize: 11, color: C.faint2, marginTop: 8 }}>
                Receba o pagamento na aba <b>Financeiro</b> para gerar o comprovante.
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            {recibo ? (
              <button type="button" onClick={() => setPrintOpen(true)} style={{ flex: 1, height: 34, border: "none", background: C.primary, color: C.white, borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Imprimir comprovante</button>
            ) : null}
            <button type="button" onClick={v.closeRecibo} style={{ flex: 1, height: 34, border: `1px solid ${C.inputBd}`, background: C.surface, color: C.body, borderRadius: 9, fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>Fechar</button>
          </div>
        </div>
      </div>
      {printOpen && recibo ? <ReciboPreviewV3 recibo={recibo} onClose={() => setPrintOpen(false)} /> : null}
    </div>
  );
}
