"use client";

// ============================================================================
// Operações V3 — Fase 3A · Garantias (ativas / vencendo / vencidas / previstas)
// ----------------------------------------------------------------------------
// Usa o modelo de pós-venda (garantia conta a partir da ENTREGA). Mostra
// cliente, equipamento, tipo, início, vencimento e dias restantes.
// ============================================================================

import { useMemo } from "react";
import { ShieldCheck, ShieldX } from "lucide-react";
import { SectionShellV3 } from "../components/SectionShellV3";
import { MetricCardV3 } from "../components/MetricCardV3";
import { EmptyStateV3 } from "../components/EmptyStateV3";
import { LoadingBlockV3, NoStoreBlockV3 } from "../components/ScreenStateV3";
import { useOperacoesV3 } from "../context/OperacoesV3Context";
import { SCREEN_COPY } from "../data/screen-copy";
import { formatData } from "../lib/format";
import { classificarGarantiasV3, type GarantiaLinhaV3 } from "@/lib/operacoes-v3/pos-venda-model";

const DIAS_VENCENDO = 15;

function GarantiaCard({ linha, onOpen }: { linha: GarantiaLinhaV3; onOpen: (id: string) => void }) {
  const { os, garantia } = linha;
  const dias = garantia.diasRestantes;
  return (
    <button
      type="button"
      onClick={() => onOpen(os.id)}
      aria-label={`Abrir ${os.codigo}`}
      className="v3-lift v3-press w-full min-w-0 rounded-[10px] border border-border bg-card p-2.5 text-left shadow-sm transition-all duration-150 hover:border-border-hover hover:bg-muted/30"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-bold tabular-nums text-foreground">{os.codigo}</span>
        {typeof dias === "number" ? (
          <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${dias < 0 ? "text-destructive" : dias <= DIAS_VENCENDO ? "text-warning" : "text-muted-foreground"}`}>
            {dias >= 0 ? `${dias} dias` : `vencida há ${Math.abs(dias)}d`}
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-muted-foreground">na entrega</span>
        )}
      </div>
      <p className="mt-0.5 truncate text-[13px] font-medium text-foreground">{os.cliente?.nome ?? "Cliente não identificado"}</p>
      <p className="truncate text-xs text-muted-foreground">
        {[os.equipamento?.marca, os.equipamento?.modelo].filter(Boolean).join(" ") || os.equipamento?.tipo || "Equipamento"}
      </p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">{garantia.label}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {garantia.inicio ? `Início ${formatData(garantia.inicio)} · ` : ""}
        {garantia.vencimento ? `até ${formatData(garantia.vencimento)}` : "aguardando entrega"}
      </p>
    </button>
  );
}

function Segmento({ titulo, linhas, onOpen, vazio }: { titulo: string; linhas: GarantiaLinhaV3[]; onOpen: (id: string) => void; vazio: string }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-foreground">
        {titulo} <span className="text-muted-foreground">({linhas.length})</span>
      </h3>
      {linhas.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {linhas.map((l) => (
            <GarantiaCard key={l.os.id} linha={l} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-5 text-center text-sm text-muted-foreground">{vazio}</p>
      )}
    </section>
  );
}

export function GarantiasV3() {
  const { ordens, loading, primeiraCarga, storeId, openOS } = useOperacoesV3();

  const seg = useMemo(() => classificarGarantiasV3(ordens, { vencendoDias: DIAS_VENCENDO }), [ordens]);

  if (!storeId) {
    return (
      <SectionShellV3 kicker="Pós-venda · cobertura por OS" titulo={SCREEN_COPY.garantias.titulo} subtitulo={SCREEN_COPY.garantias.subtitulo}>
        <NoStoreBlockV3 />
      </SectionShellV3>
    );
  }

  const total = seg.ativas.length + seg.vencendo.length + seg.vencidas.length + seg.previstas.length;

  return (
    <SectionShellV3 kicker="Pós-venda · cobertura por OS" titulo={SCREEN_COPY.garantias.titulo} subtitulo={SCREEN_COPY.garantias.subtitulo}>
      {primeiraCarga && loading ? (
        <LoadingBlockV3 />
      ) : total === 0 ? (
        <EmptyStateV3
          icon={<ShieldX className="h-8 w-8" />}
          titulo="Nenhuma garantia registrada"
          descricao="Quando uma OS com garantia for entregue, ela aparece aqui segmentada por validade. Garantias previstas aguardam a entrega."
        />
      ) : (
        <div className="space-y-4 sm:space-y-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <MetricCardV3 label="Ativas" value={seg.ativas.length} tone="success" icon={<ShieldCheck className="h-4 w-4" />} />
            <MetricCardV3 label="Vencendo (≤15d)" value={seg.vencendo.length} tone="warning" />
            <MetricCardV3 label="Vencidas" value={seg.vencidas.length} tone="danger" />
            <MetricCardV3 label="Previstas" value={seg.previstas.length} tone="info" />
          </div>
          <Segmento titulo="Ativas" linhas={seg.ativas} onOpen={openOS} vazio="Nenhuma garantia ativa." />
          <Segmento titulo="Vencendo em breve" linhas={seg.vencendo} onOpen={openOS} vazio="Nada vencendo nos próximos 15 dias." />
          <Segmento titulo="Vencidas" linhas={seg.vencidas} onOpen={openOS} vazio="Nenhuma garantia vencida." />
          <Segmento titulo="Previstas (aguardando entrega)" linhas={seg.previstas} onOpen={openOS} vazio="Nenhuma garantia prevista." />
        </div>
      )}
    </SectionShellV3>
  );
}
