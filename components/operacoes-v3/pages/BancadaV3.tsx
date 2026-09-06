"use client";

// ============================================================================
// Operações V3 — Fase 3B · Bancada por Técnico (produção interna)
// ----------------------------------------------------------------------------
// Produção do dia + Fila de produção (reusa a máquina de status) + OS por técnico
// (com prioridade/SLA/valor/próxima ação). Ações rápidas via máquina única
// (`mudarStatus`). Grupo "Sem técnico" sempre visível.
// ============================================================================

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Hammer, Loader, Loader2, User, UserX, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrdemServico } from "@/types/os";
import { statusV3FromOS, type OperacaoStatusV3 } from "@/lib/operacoes-v3/status-machine";
import {
  FILA_COLUNAS_V3,
  bancadaPorTecnicoV3,
  filaProducaoV3,
  lerSlaV3,
  producaoDoDiaV3,
  proximaAcaoV3,
} from "@/lib/operacoes-v3/producao-model";
import { SectionShellV3 } from "../components/SectionShellV3";
import { MetricCardV3 } from "../components/MetricCardV3";
import { EmptyStateV3 } from "../components/EmptyStateV3";
import { StatusBadgeV3 } from "../components/StatusBadgeV3";
import { PrioridadeBadgeV3, SlaBadgeV3 } from "../components/PrioridadeBadgeV3";
import { ButtonV3 } from "../components/UiV3";
import { LoadingBlockV3, NoStoreBlockV3 } from "../components/ScreenStateV3";
import { useOperacoesV3 } from "../context/OperacoesV3Context";
import { SCREEN_COPY } from "../data/screen-copy";
import { formatBRL, formatRelativo } from "../lib/format";
import { orcamentoTotal } from "../lib/os-derive";

function equipamentoLabel(os: OrdemServico): string {
  return [os.equipamento?.marca, os.equipamento?.modelo].filter(Boolean).join(" ").trim() || os.equipamento?.tipo || "Equipamento";
}

function BancadaRow({
  os,
  onOpen,
  mudarStatus,
}: {
  os: OrdemServico;
  onOpen: (id: string) => void;
  mudarStatus: (osId: string, to: OperacaoStatusV3) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const proxima = proximaAcaoV3(os);
  const sla = lerSlaV3(os);
  const total = orcamentoTotal(os);

  const onAvancar = async () => {
    if (!proxima) return;
    setBusy(true);
    try {
      await mudarStatus(os.id, proxima.to);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="v3-lift rounded-[10px] border border-border bg-background p-2.5 transition-transform">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-bold tabular-nums text-foreground">{os.codigo}</span>
          <PrioridadeBadgeV3 os={os} />
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <StatusBadgeV3 status={statusV3FromOS(os)} />
          <SlaBadgeV3 os={os} />
        </span>
      </div>

      <div className="mt-1 grid gap-0.5 sm:grid-cols-2">
        <p className="truncate text-[13px] font-medium text-foreground">{os.cliente?.nome ?? "Cliente"}</p>
        <p className="truncate text-xs text-muted-foreground sm:text-right">{equipamentoLabel(os)}</p>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-1.5">
        <span className="text-xs text-muted-foreground">
          {total > 0 ? <strong className="text-foreground">{formatBRL(total)}</strong> : "—"}
          {" · "}
          <span className={cn(sla.situacao === "atrasada" && "font-medium text-destructive")}>
            {sla.prazo ? formatRelativo(sla.prazo) : "sem prazo"}
          </span>
        </span>
        <div className="flex items-center gap-1.5">
          <ButtonV3 variant="ghost" onClick={() => onOpen(os.id)}>
            Abrir
          </ButtonV3>
          {proxima ? (
            <ButtonV3 variant="outline" disabled={busy} onClick={onAvancar}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {proxima.label}
            </ButtonV3>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function BancadaV3() {
  const { ordens, loading, primeiraCarga, storeId, openOS, mudarStatus, navigate } = useOperacoesV3();

  const { dia, fila, grupos } = useMemo(
    () => ({ dia: producaoDoDiaV3(ordens), fila: filaProducaoV3(ordens), grupos: bancadaPorTecnicoV3(ordens) }),
    [ordens],
  );

  if (!storeId) {
    return (
      <SectionShellV3 kicker="Produção interna · por técnico" titulo={SCREEN_COPY.bancada.titulo} subtitulo={SCREEN_COPY.bancada.subtitulo}>
        <NoStoreBlockV3 />
      </SectionShellV3>
    );
  }

  return (
    <SectionShellV3 kicker="Produção interna · por técnico" titulo={SCREEN_COPY.bancada.titulo} subtitulo={SCREEN_COPY.bancada.subtitulo}>
      {primeiraCarga && loading ? (
        <LoadingBlockV3 />
      ) : (
        <div className="space-y-4 sm:space-y-5">
          {/* Produção do dia */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Produção do dia</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
              <MetricCardV3 label="Em diagnóstico" value={dia.emDiagnostico} tone="info" icon={<Wrench className="h-4 w-4" />} />
              <MetricCardV3 label="Em execução" value={dia.emExecucao} tone="primary" icon={<Loader className="h-4 w-4" />} />
              <MetricCardV3 label="Prontas" value={dia.prontas} tone="success" icon={<CheckCircle2 className="h-4 w-4" />} />
              <MetricCardV3 label="Atrasadas" value={dia.atrasadas} tone="danger" icon={<AlertTriangle className="h-4 w-4" />} />
              <MetricCardV3 label="Sem técnico" value={dia.semTecnico} tone="warning" icon={<UserX className="h-4 w-4" />} />
              <MetricCardV3 label="Entregues hoje" value={dia.entreguesHoje} tone="neutral" icon={<CheckCircle2 className="h-4 w-4" />} />
            </div>
          </div>

          {/* Fila de produção (reusa a máquina de status) */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Fila de produção</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2 lg:grid-cols-5">
              {FILA_COLUNAS_V3.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => navigate("fila")}
                  className="v3-mtap v3-press rounded-[10px] border border-border bg-card p-2.5 text-left shadow-sm transition-colors hover:border-border-hover hover:bg-muted/30"
                >
                  <p className="text-[11px] font-medium text-muted-foreground">{c.label}</p>
                  <p className="mt-0.5 text-xl font-bold tabular-nums text-foreground">{fila[c.id].length}</p>
                </button>
              ))}
            </div>
          </div>

          {/* OS por técnico */}
          {grupos.length === 0 ? (
            <EmptyStateV3
              icon={<Hammer className="h-8 w-8" />}
              titulo="Nenhuma OS ativa na bancada"
              descricao="OS entregues ou canceladas não aparecem aqui. Assim que houver trabalho em andamento, ele se agrupa por técnico."
            />
          ) : (
            <div className="space-y-5">
              {grupos.map((g) => (
                <section key={g.tecnicoId}>
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                        g.semTecnico ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary",
                      )}
                    >
                      {g.semTecnico ? <UserX className="h-4 w-4" aria-hidden /> : <User className="h-4 w-4" aria-hidden />}
                    </span>
                    <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">{g.tecnicoNome}</h3>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{g.ordens.length} OS</span>
                  </div>
                  <div className="grid gap-2 lg:grid-cols-2">
                    {g.ordens.map((os) => (
                      <BancadaRow key={os.id} os={os} onOpen={openOS} mudarStatus={mudarStatus} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </SectionShellV3>
  );
}
