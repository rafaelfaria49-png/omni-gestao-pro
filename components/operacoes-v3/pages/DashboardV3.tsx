"use client";

import { useMemo, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Inbox,
  Loader,
  PiggyBank,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  TrendingUp,
  UserX,
  Wallet,
  Wrench,
  XCircle,
} from "lucide-react";
import { contarOrcamentosPorStatusV3 } from "@/lib/operacoes-v3/orcamento-model";
import { kpisPosVendaV3 } from "@/lib/operacoes-v3/pos-venda-model";
import { producaoDoDiaV3 } from "@/lib/operacoes-v3/producao-model";
import { cn } from "@/lib/utils";
import type { ScreenId } from "../data/types";
import { SectionShellV3 } from "../components/SectionShellV3";
import { MetricCardV3 } from "../components/MetricCardV3";
import { OSCardV3 } from "../components/OSCardV3";
import { EmptyStateV3 } from "../components/EmptyStateV3";
import { ButtonV3 } from "../components/UiV3";
import { LoadingBlockV3, NoStoreBlockV3 } from "../components/ScreenStateV3";
import { useOperacoesV3 } from "../context/OperacoesV3Context";
import { SCREEN_COPY } from "../data/screen-copy";
import { formatBRL } from "../lib/format";
import { countByStatus, garantiasAtivas, isAtrasada, receitaEstimada } from "../lib/os-derive";

function ListaCurta({
  titulo,
  vazio,
  ordens,
  onOpen,
}: {
  titulo: string;
  vazio: string;
  ordens: ReturnType<typeof useOperacoesV3>["ordens"];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="rounded-[10px] border border-[var(--ops-v3-line)] bg-[var(--ops-v3-surface)] p-3 shadow-sm">
      <h3 className="mb-2 text-[13px] font-bold text-[var(--ops-v3-body)]">{titulo}</h3>
      {ordens.length > 0 ? (
        <div className="space-y-2">
          {ordens.slice(0, 6).map((os) => (
            <OSCardV3 key={os.id} os={os} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-[var(--ops-v3-dashed)] bg-[var(--ops-v3-soft)] px-3 py-6 text-center text-sm text-[var(--ops-v3-muted)]">
          {vazio}
        </p>
      )}
    </div>
  );
}

/** Tom semântico da borda lateral (vermelho só para atraso/crítico). */
const ATT_BAR: Record<"crit" | "warn" | "ok", string> = {
  crit: "border-l-[var(--ops-v3-danger)]",
  warn: "border-l-[var(--ops-v3-warning)]",
  ok: "border-l-[var(--ops-v3-success)]",
};

/**
 * "Precisa de atenção" — central única de trabalho pendente.
 * Somente contagens reais derivadas das OS carregadas; cada linha navega
 * para o destino real correspondente. Nada é inventado.
 */
function PrecisaDeAtencao({
  itens,
  onIr,
}: {
  itens: { titulo: string; detalhe: string; total: number; tom: "crit" | "warn" | "ok"; destino: ScreenId }[];
  onIr: (destino: ScreenId) => void;
}) {
  return (
    <div className="rounded-[10px] border border-[var(--ops-v3-line)] bg-[var(--ops-v3-surface)] p-3 shadow-sm">
      <h2 className="text-[14px] font-bold tracking-tight text-[var(--ops-v3-body)]">Precisa de atenção</h2>
      <p className="mt-0.5 text-xs leading-relaxed text-[var(--ops-v3-muted)]">
        Central única — cada item leva ao destino real.
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        {itens.map((item) => (
          <button
            key={item.titulo}
            type="button"
            onClick={() => onIr(item.destino)}
            aria-label={`${item.titulo}: ${item.detalhe}`}
            className={cn(
              "v3-mtap flex w-full items-center gap-2.5 rounded-[10px] border border-[var(--ops-v3-line)] border-l-[3px] bg-[var(--ops-v3-surface)] px-3 py-2 text-left shadow-sm transition-colors hover:bg-[var(--ops-v3-muted-bg)] active:scale-[0.99]",
              ATT_BAR[item.tom],
            )}
          >
            <span className="inline-flex h-[22px] min-w-[26px] shrink-0 items-center justify-center rounded-full bg-[var(--ops-v3-ink)] px-2 text-[11px] font-extrabold tabular-nums text-white">
              {item.total}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold text-[var(--ops-v3-body)]">{item.titulo}</span>
              <span className="block truncate text-[11.5px] text-[var(--ops-v3-muted)]">{item.detalhe}</span>
            </span>
            <span aria-hidden className="shrink-0 text-[var(--ops-v3-subtle)]">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function DashboardV3() {
  const { ordens, loading, primeiraCarga, storeId, navigate, openOS, abrirNovaOS } = useOperacoesV3();

  const dados = useMemo(() => {
    const counts = countByStatus(ordens);
    const atrasadas = ordens.filter(isAtrasada);
    const aguardando = ordens.filter((o) => o.status === "aguardando_aprovacao");
    return {
      counts,
      atrasadas,
      aguardando,
      orcamentos: contarOrcamentosPorStatusV3(ordens),
      garantias: garantiasAtivas(ordens).length,
      posVenda: kpisPosVendaV3(ordens),
      producao: producaoDoDiaV3(ordens),
      receita: receitaEstimada(ordens),
      total: ordens.length,
    };
  }, [ordens]);

  const actions = (
    <>
      <ButtonV3 variant="outline" onClick={() => navigate("fila")}>
        Abrir fila de OS
      </ButtonV3>
      <ButtonV3 variant="primary" onClick={abrirNovaOS}>
        <Plus className="h-4 w-4" aria-hidden />
        Nova OS
      </ButtonV3>
    </>
  );

  let body: ReactNode;
  if (!storeId) {
    body = <NoStoreBlockV3 />;
  } else if (primeiraCarga && loading) {
    body = <LoadingBlockV3 />;
  } else {
    const atencao = [
      {
        titulo: "Atrasadas — tratar primeiro",
        detalhe: `${dados.atrasadas.length} OS com SLA estourado`,
        total: dados.atrasadas.length,
        tom: "crit" as const,
        destino: "fila" as ScreenId,
      },
      {
        titulo: "Sem técnico",
        detalhe: `${dados.producao.semTecnico} OS paradas sem responsável`,
        total: dados.producao.semTecnico,
        tom: "warn" as const,
        destino: "bancada" as ScreenId,
      },
      {
        titulo: "Aguardando aprovação",
        detalhe: `${dados.aguardando.length} orçamento(s) parado(s)`,
        total: dados.aguardando.length,
        tom: "warn" as const,
        destino: "orcamentos" as ScreenId,
      },
      {
        titulo: "Aguardando peça",
        detalhe: `${dados.counts.aguardando_peca} OS bloqueada(s) por componente`,
        total: dados.counts.aguardando_peca,
        tom: "warn" as const,
        destino: "fila" as ScreenId,
      },
      {
        titulo: "Prontas para entrega",
        detalhe: `${dados.counts.pronta} OS pronta(s) para retirar`,
        total: dados.counts.pronta,
        tom: "ok" as const,
        destino: "fila" as ScreenId,
      },
      {
        titulo: "Retornos em aberto",
        detalhe: `${dados.posVenda.retornosAbertos} retorno(s) em aberto`,
        total: dados.posVenda.retornosAbertos,
        tom: "crit" as const,
        destino: "retornos" as ScreenId,
      },
    ];
    body = (
      <div className="space-y-3 sm:space-y-4">
        <PrecisaDeAtencao itens={atencao} onIr={navigate} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-3 xl:grid-cols-5">
          <MetricCardV3 label="OS abertas" value={dados.counts.aberta} tone="info" icon={<Inbox className="h-4 w-4" />} />
          <MetricCardV3 label="Aguardando aprovação" value={dados.counts.aguardando_aprovacao} tone="warning" icon={<Clock className="h-4 w-4" />} />
          <MetricCardV3 label="Em execução" value={dados.counts.em_execucao} tone="primary" icon={<Loader className="h-4 w-4" />} />
          <MetricCardV3 label="Prontas" value={dados.counts.pronta} tone="success" icon={<CheckCircle2 className="h-4 w-4" />} />
          <MetricCardV3 label="Atrasadas" value={dados.atrasadas.length} tone="danger" icon={<AlertTriangle className="h-4 w-4" />} />
          <MetricCardV3 label="Receita estimada" value={formatBRL(dados.receita)} hint="Pipeline de orçamentos (não-canceladas)" icon={<TrendingUp className="h-4 w-4" />} />
          <MetricCardV3 label="Recebido hoje" estado="a-conectar" hint="Vem do Financeiro" icon={<Wallet className="h-4 w-4" />} />
          <MetricCardV3 label="Saldo em aberto" estado="a-conectar" hint="Vem do Financeiro" icon={<PiggyBank className="h-4 w-4" />} />
          <MetricCardV3 label="Garantias ativas" value={dados.garantias} tone="neutral" icon={<ShieldCheck className="h-4 w-4" />} />
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ops-v3-muted)]">Orçamentos</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <MetricCardV3 label="Em rascunho" value={dados.orcamentos.rascunho} tone="neutral" icon={<FileText className="h-4 w-4" />} />
            <MetricCardV3 label="Enviados" value={dados.orcamentos.enviado} tone="info" icon={<Send className="h-4 w-4" />} />
            <MetricCardV3 label="Aprovados" value={dados.orcamentos.aprovado} tone="success" icon={<CheckCircle2 className="h-4 w-4" />} />
            <MetricCardV3 label="Recusados" value={dados.orcamentos.recusado} tone="danger" icon={<XCircle className="h-4 w-4" />} />
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ops-v3-muted)]">Produção</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
            <MetricCardV3 label="Em diagnóstico" value={dados.producao.emDiagnostico} tone="info" icon={<Wrench className="h-4 w-4" />} />
            <MetricCardV3 label="Em execução" value={dados.producao.emExecucao} tone="primary" icon={<Loader className="h-4 w-4" />} />
            <MetricCardV3 label="Prontas" value={dados.producao.prontas} tone="success" icon={<CheckCircle2 className="h-4 w-4" />} />
            <MetricCardV3 label="Atrasadas" value={dados.producao.atrasadas} tone="danger" icon={<AlertTriangle className="h-4 w-4" />} />
            <MetricCardV3 label="Sem técnico" value={dados.producao.semTecnico} tone="warning" icon={<UserX className="h-4 w-4" />} />
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ops-v3-muted)]">Pós-venda</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <MetricCardV3 label="Garantias ativas" value={dados.posVenda.garantiasAtivas} tone="success" icon={<ShieldCheck className="h-4 w-4" />} />
            <MetricCardV3 label="Garantias vencendo" value={dados.posVenda.garantiasVencendo} tone="warning" hint="Próximos 15 dias" icon={<Clock className="h-4 w-4" />} />
            <MetricCardV3 label="Retornos em aberto" value={dados.posVenda.retornosAbertos} tone="danger" icon={<RotateCcw className="h-4 w-4" />} />
            <MetricCardV3 label="Taxa de retorno" value={`${dados.posVenda.taxaRetorno}%`} hint="OS com retorno ÷ entregues" tone="neutral" icon={<TrendingUp className="h-4 w-4" />} />
          </div>
        </div>

        {dados.total === 0 ? (
          <EmptyStateV3
            icon={<Inbox className="h-8 w-8" />}
            titulo="Nenhuma ordem de serviço nesta unidade"
            descricao="Quando houver OS cadastradas, os indicadores e listas aparecem aqui automaticamente."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <ListaCurta
              titulo="Aguardando aprovação"
              vazio="Nenhuma OS aguardando aprovação."
              ordens={dados.aguardando}
              onOpen={openOS}
            />
            <ListaCurta
              titulo="Atrasadas (SLA estourado)"
              vazio="Nenhuma OS atrasada. 👏"
              ordens={dados.atrasadas}
              onOpen={openOS}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <SectionShellV3
      kicker="Operação da loja · hoje"
      titulo={SCREEN_COPY.dashboard.titulo}
      subtitulo={SCREEN_COPY.dashboard.subtitulo}
      actions={storeId ? actions : undefined}
    >
      {body}
    </SectionShellV3>
  );
}
