"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, MoreHorizontal, Wand2, XCircle } from "lucide-react";
import type { OrdemServico } from "@/types/os";
import {
  acaoPrimariaV3,
  LABEL_TRANSICAO_V3,
  proximasTransicoesV3,
  statusMetaV3,
  statusV3FromOS,
  type OperacaoStatusV3,
} from "@/lib/operacoes-v3/status-machine";
import { ButtonV3 } from "./UiV3";

/** Mínimo de caracteres do motivo de cancelamento — mesma regra do servidor (`aplicarTransicaoStatusV3`). */
const MOTIVO_CANCELAMENTO_MIN_LEN = 5;

/**
 * Barra de comando da OS — dirige a MÁQUINA ÚNICA de status (write real).
 * Mostra a ação primária recomendada + transições válidas + cancelar, todas
 * derivadas de `proximasTransicoesV3`/`acaoPrimariaV3`. Caminhos inválidos não
 * são oferecidos (a engine é a única fonte). "Mais ações" segue placeholder.
 *
 * GOAL OPS-V3-CANCELAR-OS-CONTRATO-SEGURO-019: "Cancelar OS" não dispara mais a
 * transição em um clique — primeiro pede o motivo obrigatório (prompt nativo,
 * sem inventar modal novo) e só chama `onCancelar` se o motivo tiver conteúdo
 * mínimo. A validação real (autoritativa) continua no servidor.
 */
export function OSCommandBarV3({
  os,
  onMudarStatus,
  onCancelar,
  onAcao,
}: {
  os: OrdemServico;
  onMudarStatus: (to: OperacaoStatusV3) => Promise<boolean>;
  /** Cancelamento com motivo obrigatório — write dedicado (não passa por `onMudarStatus`). */
  onCancelar: (motivo: string) => Promise<boolean>;
  onAcao: (label: string) => void;
}) {
  const [pendingTo, setPendingTo] = useState<OperacaoStatusV3 | null>(null);

  const from = statusV3FromOS(os);
  const meta = statusMetaV3(from);
  const primaria = acaoPrimariaV3(from);
  const destinos = proximasTransicoesV3(from);
  const secundarias = destinos.filter((t) => t !== primaria?.to && t !== "cancelada");
  const podeCancelar = destinos.includes("cancelada");

  const handle = async (to: OperacaoStatusV3) => {
    if (pendingTo) return;
    setPendingTo(to);
    try {
      await onMudarStatus(to);
    } finally {
      setPendingTo(null);
    }
  };

  const handleCancelar = async () => {
    if (pendingTo) return;
    // `window.prompt` é bloqueante — impossível clicar duas vezes enquanto está aberto.
    const digitado = window.prompt("Motivo do cancelamento (obrigatório):");
    if (digitado === null) return; // operador desistiu do prompt
    const motivo = digitado.trim();
    if (motivo.length < MOTIVO_CANCELAMENTO_MIN_LEN) {
      window.alert(`Informe um motivo com pelo menos ${MOTIVO_CANCELAMENTO_MIN_LEN} caracteres. Cancelamento não realizado.`);
      return;
    }
    setPendingTo("cancelada");
    try {
      await onCancelar(motivo);
    } finally {
      setPendingTo(null);
    }
  };

  const busy = pendingTo !== null;

  return (
    <div className="sticky bottom-0 z-10 rounded-[10px] border border-[var(--ops-v3-line)] bg-[var(--ops-v3-surface)]/95 p-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-[var(--ops-v3-surface)]/85 sm:p-2.5">
      {/* Ação primária evidente — única por estado, sempre na cor do sistema. */}
      {primaria ? (
        <ButtonV3 variant="primary" disabled={busy} onClick={() => handle(primaria.to)} className="v3-mtap w-full sm:w-auto">
          {pendingTo === primaria.to ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {primaria.label}
        </ButtonV3>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ops-v3-line)] bg-[var(--ops-v3-success-bg-soft)] px-3 py-1.5 text-sm font-medium text-[var(--ops-v3-success-fg)]">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {meta.label} — fluxo de status concluído
        </span>
      )}

      {/* Transições válidas + destrutiva: rolagem horizontal no mobile para não
          empilhar CTAs concorrentes; "Mais ações" preserva o restante. */}
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 sm:mt-2 sm:flex-wrap sm:overflow-visible">
        {secundarias.map((to) => (
          <ButtonV3 key={to} variant="outline" disabled={busy} onClick={() => handle(to)} className="v3-mtap shrink-0">
            {pendingTo === to ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {LABEL_TRANSICAO_V3[to]}
          </ButtonV3>
        ))}

        {podeCancelar ? (
          <ButtonV3 variant="danger" disabled={busy} onClick={handleCancelar} className="v3-mtap shrink-0">
            {pendingTo === "cancelada" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
            Cancelar OS
          </ButtonV3>
        ) : null}

        <ButtonV3 variant="ghost" disabled={busy} onClick={() => onAcao("Mais ações")} className="v3-mtap shrink-0">
          <MoreHorizontal className="h-4 w-4" />
          Mais ações
        </ButtonV3>
      </div>

      <span className="mt-1.5 hidden text-[11px] text-[var(--ops-v3-subtle)] sm:block">
        Transições validadas pela máquina única da V3.
      </span>
    </div>
  );
}
