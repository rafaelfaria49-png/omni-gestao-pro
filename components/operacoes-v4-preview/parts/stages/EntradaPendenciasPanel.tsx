/**
 * Operações V4 — painel "Completar entrada" (GOAL OPS-V4-ORC-COMPLETAR-ENTRADA-027).
 *
 * UI fina de orquestração: deriva a lista de pendências 100% do lado do
 * servidor via `derivarPendenciasEntradaV4(v.realOS)` (pura, `lib/operacoes-v4`)
 * e só oferece um botão "Ir para" que rola/foca o card JÁ EXISTENTE em
 * `EntradaStage.tsx` — não grava nada, não duplica os saves já cablados
 * (`salvarDadosBasicos`/`salvarIdentificacao`/`salvarProvaEntrada`/
 * `salvarChecklist`/`salvarAcessorios`/`adicionarFotoEntrada`). Fotos de entrada
 * já têm contrato real; o botão "Ir para" só foca o card existente.
 *
 * Some sozinho quando não há OS real ou quando todos os itens com contrato já
 * estão preenchidos — nunca marca "completo" sem dado real do servidor.
 */
"use client";

import { C, card, cardTitle } from "../../tokens";
import type { V4Vals } from "../../use-v4-preview";
import { derivarPendenciasEntradaV4, progressoPendenciasEntradaV4 } from "@/lib/operacoes-v4/entrada-pendencias";

function irPara(chave: string) {
  const el = document.getElementById(`entrada-card-${chave}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  const foco = el.querySelector<HTMLElement>("input, select, textarea, button");
  foco?.focus({ preventScroll: true });
}

export function EntradaPendenciasPanel({ v }: { v: V4Vals }) {
  const pendencias = derivarPendenciasEntradaV4(v.realOS);
  const { preenchidos, total } = progressoPendenciasEntradaV4(pendencias);
  const acionaveisPendentes = pendencias.filter((p) => p.temContrato && !p.preenchido);
  const informativas = pendencias.filter((p) => !p.temContrato);

  // Colapsa quando não há OS real ou quando tudo que tem contrato já foi preenchido.
  if (!v.realOS || acionaveisPendentes.length === 0) return null;

  return (
    <div style={{ ...card, gridColumn: "1 / -1", borderColor: C.warnBd, background: C.warnBg }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <div style={{ ...cardTitle, color: C.warnFg }}>Completar entrada</div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: C.warnFg, flex: "none" }}>{preenchidos} de {total} preenchidos</div>
      </div>
      <div style={{ fontSize: 11.5, color: C.body, marginBottom: 10, lineHeight: 1.5 }}>
        Esta OS foi aberta rapidamente. Complete os dados abaixo quando o aparelho chegar fisicamente.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {acionaveisPendentes.map((p) => (
          <div key={p.chave} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: C.surface, border: `1px solid ${C.inputBd}`, borderRadius: 8, padding: "7px 10px" }}>
            <span style={{ fontSize: 12, color: C.body, fontWeight: 500 }}>{p.rotulo}</span>
            <button
              type="button"
              onClick={() => irPara(p.chave)}
              style={{ height: 26, padding: "0 11px", border: "none", background: C.primary, color: C.white, borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer", flex: "none" }}
            >
              Ir para
            </button>
          </div>
        ))}
        {informativas.map((p) => (
          <div key={p.chave} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "5px 10px", opacity: 0.7 }}>
            <span style={{ fontSize: 11.5, color: C.subtle }}>{p.rotulo}</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: C.subtle }}>em breve</span>
          </div>
        ))}
      </div>
    </div>
  );
}
