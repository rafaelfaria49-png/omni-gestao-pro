"use client";

import { useMemo, useState } from "react";
import { CalendarRange, KanbanSquare, Plus, Search, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrdemServico } from "@/types/os";
import {
  KANBAN_PIPELINE_V3,
  podeTransicionarV3,
  statusMetaV3,
  statusV3FromOS,
  STATUS_V3_LIST,
  type OperacaoStatusV3,
} from "@/lib/operacoes-v3/status-machine";
import { SectionShellV3 } from "../components/SectionShellV3";
import { OSCardV3 } from "../components/OSCardV3";
import { StatusBadgeV3 } from "../components/StatusBadgeV3";
import { PaymentBadgeV3 } from "../components/PaymentBadgeV3";
import { EmptyStateV3 } from "../components/EmptyStateV3";
import { ButtonV3 } from "../components/UiV3";
import { ConstructionBadgeV3 } from "../components/ConstructionBadgeV3";
import { LoadingBlockV3, NoStoreBlockV3 } from "../components/ScreenStateV3";
import { useOperacoesV3 } from "../context/OperacoesV3Context";
import { SCREEN_COPY } from "../data/screen-copy";
import { formatBRL, formatRelativo } from "../lib/format";
import { matchOrdem, orcamentoTotal, type PagamentoEstado } from "../lib/os-derive";
import { lerPagamentoV3 } from "@/lib/operacoes-v3/payment-model";

type Tab = "kanban" | "lista" | "calendario";

const TABS: { id: Tab; label: string; icon: typeof KanbanSquare }[] = [
  { id: "kanban", label: "Kanban", icon: KanbanSquare },
  { id: "lista", label: "Lista", icon: Table2 },
  { id: "calendario", label: "Calendário", icon: CalendarRange },
];

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export function FilaOSV3() {
  const { ordens, loading, primeiraCarga, storeId, openOS, mudarStatus, notificar, abrirNovaOS } = useOperacoesV3();
  const [tab, setTab] = useState<Tab>("kanban");
  const [q, setQ] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<OperacaoStatusV3 | "todas">("todas");

  const filtradas = useMemo(() => ordens.filter((o) => matchOrdem(o, q)), [ordens, q]);
  const listadas = useMemo(
    () => filtradas.filter((o) => statusFiltro === "todas" || statusV3FromOS(o) === statusFiltro),
    [filtradas, statusFiltro],
  );

  if (!storeId) {
    return (
      <SectionShellV3 kicker="Operação · fila de ordens" titulo={SCREEN_COPY.fila.titulo} subtitulo={SCREEN_COPY.fila.subtitulo}>
        <NoStoreBlockV3 />
      </SectionShellV3>
    );
  }

  const tabs = (
    <>
      <div className="flex items-center gap-0.5 rounded-[10px] border border-[var(--ops-v3-line)] bg-[var(--ops-v3-muted-bg)] p-[3px]" role="tablist" aria-label="Visão da fila">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "v3-mtap inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5 py-1.5 text-xs font-bold transition-colors",
                tab === t.id
                  ? "bg-[var(--ops-v3-surface)] text-[var(--ops-v3-ink)] shadow-sm"
                  : "text-[var(--ops-v3-muted)] hover:text-[var(--ops-v3-ink)]",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>
      <ButtonV3 variant="primary" onClick={abrirNovaOS}>
        <Plus className="h-4 w-4" aria-hidden />
        Nova OS
      </ButtonV3>
    </>
  );

  return (
    <SectionShellV3 kicker="Operação · fila de ordens" titulo={SCREEN_COPY.fila.titulo} subtitulo={SCREEN_COPY.fila.subtitulo} actions={tabs}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            className={cn(inputCls, "v3-mtap min-h-[var(--ops-v3-btn-h)] pl-9")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por OS, cliente, aparelho, técnico…"
            aria-label="Buscar ordens"
          />
        </div>
        {tab === "lista" ? (
          <select
            className={cn(inputCls, "v3-mtap w-auto min-h-[var(--ops-v3-btn-h)]")}
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value as OperacaoStatusV3 | "todas")}
            aria-label="Filtrar por status"
          >
            <option value="todas">Todos os status</option>
            {STATUS_V3_LIST.map((s) => (
              <option key={s} value={s}>
                {statusMetaV3(s).label}
              </option>
            ))}
          </select>
        ) : null}
        <span className="text-xs tabular-nums text-muted-foreground">{filtradas.length} OS</span>
      </div>

      {primeiraCarga && loading ? (
        <LoadingBlockV3 />
      ) : tab === "kanban" ? (
        <KanbanView ordens={filtradas} onOpen={openOS} mudarStatus={mudarStatus} notificar={notificar} />
      ) : tab === "lista" ? (
        <ListaView ordens={listadas} onOpen={openOS} />
      ) : (
        <EmptyStateV3
          icon={<CalendarRange className="h-8 w-8" />}
          titulo="Calendário em construção"
          descricao="A visão de agenda por dia/técnico chega numa fase futura — sem datas fictícias aqui."
          acao={<ConstructionBadgeV3 />}
        />
      )}
    </SectionShellV3>
  );
}

function KanbanView({
  ordens,
  onOpen,
  mudarStatus,
  notificar,
}: {
  ordens: OrdemServico[];
  onOpen: (id: string) => void;
  mudarStatus: (osId: string, to: OperacaoStatusV3) => Promise<boolean>;
  notificar: (msg: string) => void;
}) {
  const [drag, setDrag] = useState<{ osId: string; from: OperacaoStatusV3 } | null>(null);
  const [overCol, setOverCol] = useState<OperacaoStatusV3 | null>(null);

  const limparDrag = () => {
    setDrag(null);
    setOverCol(null);
  };

  const soltarEm = (col: OperacaoStatusV3) => {
    const atual = drag;
    limparDrag();
    if (!atual) return;
    if (atual.from === col) return; // mesma coluna → no-op
    const veredito = podeTransicionarV3(atual.from, col);
    if (!veredito.ok) {
      notificar(veredito.motivo ?? "Transição de status não permitida.");
      return;
    }
    void mudarStatus(atual.osId, col);
  };

  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">
        Arraste um card para outra coluna para mudar o status — validado pela máquina única da V3.
      </p>
      {/* Mobile/tablet estreito: scroll SÓ dentro do quadro (a página nunca rola
          para o lado). Desktop: grade fixa. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-2 md:mx-0 md:overflow-visible md:px-0 md:pb-0">
        <div className="flex min-w-min gap-2 md:grid md:min-w-0 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {KANBAN_PIPELINE_V3.map((col) => {
            const meta = statusMetaV3(col);
            const cards = ordens.filter((o) => statusV3FromOS(o) === col);
            const alvoValido = drag ? podeTransicionarV3(drag.from, col).ok : false;
            const isOver = overCol === col;
            return (
              <div
                key={col}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverCol(col);
                }}
                onDragLeave={() => setOverCol((c) => (c === col ? null : c))}
                onDrop={(e) => {
                  e.preventDefault();
                  soltarEm(col);
                }}
                className={cn(
                  "flex w-[248px] min-w-0 shrink-0 flex-col rounded-[10px] border bg-[var(--ops-v3-muted-bg)]/60 transition-colors md:w-auto",
                  isOver && alvoValido
                    ? "border-primary ring-2 ring-primary/30"
                    : drag && alvoValido
                      ? "border-primary/40"
                      : "border-border",
                )}
              >
                <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-2">
                  <span className="truncate text-xs font-bold text-foreground">{meta.label}</span>
                  <span className="shrink-0 rounded-full bg-card px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">{cards.length}</span>
                </div>
                <div className="max-h-[480px] min-h-[80px] space-y-2 overflow-y-auto p-2">
                  {cards.length > 0 ? (
                    cards.map((os) => (
                      <div
                        key={os.id}
                        draggable
                        onDragStart={() => setDrag({ osId: os.id, from: statusV3FromOS(os) })}
                        onDragEnd={limparDrag}
                        className="cursor-grab active:cursor-grabbing"
                      >
                        <OSCardV3 os={os} onOpen={onOpen} />
                      </div>
                    ))
                  ) : (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">—</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground md:hidden">↔ Deslize o quadro para o lado — a página não rola.</p>
    </div>
  );
}

function ListaView({
  ordens,
  onOpen,
}: {
  ordens: OrdemServico[];
  onOpen: (id: string) => void;
}) {
  if (ordens.length === 0) {
    return (
      <EmptyStateV3
        icon={<Table2 className="h-8 w-8" />}
        titulo="Nenhuma OS para este filtro"
        descricao="Ajuste a busca ou o status para ver resultados."
      />
    );
  }
  return (
    <>
      {/* Desktop/tablet largo: tabela compacta e legível. */}
      <div className="hidden overflow-x-auto rounded-[10px] border border-border bg-[var(--ops-v3-surface)] shadow-sm md:block">
        <table className="w-full min-w-[680px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
              <th className="px-2.5 py-2 font-extrabold">OS</th>
              <th className="px-2.5 py-2 font-extrabold">Cliente</th>
              <th className="px-2.5 py-2 font-extrabold">Equipamento</th>
              <th className="px-2.5 py-2 font-extrabold">Status</th>
              <th className="px-2.5 py-2 font-extrabold">Pagamento</th>
              <th className="px-2.5 py-2 font-extrabold">Técnico</th>
              <th className="px-2.5 py-2 text-right font-extrabold">Prazo</th>
              <th className="px-2.5 py-2 text-right font-extrabold">Valor</th>
            </tr>
          </thead>
          <tbody>
            {ordens.map((os) => {
              const pagV3 = lerPagamentoV3(os);
              const pagEstado: PagamentoEstado = pagV3.status === "sem_cobranca" ? "sem-cobranca" : pagV3.status;
              const equip =
                [os.equipamento?.marca, os.equipamento?.modelo].filter(Boolean).join(" ").trim() ||
                os.equipamento?.tipo ||
                "—";
              return (
                <tr
                  key={os.id}
                  onClick={() => onOpen(os.id)}
                  className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/30"
                >
                  <td className="px-2.5 py-2 font-semibold tabular-nums text-foreground">{os.codigo}</td>
                  <td className="max-w-[160px] truncate px-2.5 py-2 text-foreground">{os.cliente?.nome ?? "—"}</td>
                  <td className="max-w-[160px] truncate px-2.5 py-2 text-muted-foreground">{equip}</td>
                  <td className="px-2.5 py-2"><StatusBadgeV3 status={statusV3FromOS(os)} /></td>
                  <td className="px-2.5 py-2"><PaymentBadgeV3 estado={pagEstado} showValor={false} /></td>
                  <td className="max-w-[120px] truncate px-2.5 py-2 text-muted-foreground">{os.tecnico?.nome ?? "—"}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right text-muted-foreground">
                    {os.sla?.prazo ? formatRelativo(os.sla.prazo) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right font-medium tabular-nums text-foreground">
                    {orcamentoTotal(os) > 0 ? formatBRL(orcamentoTotal(os)) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Mobile: cards próprios (nunca tabela espremida). */}
      <div className="flex flex-col gap-2 md:hidden">
        {ordens.map((os) => (
          <OSCardV3 key={os.id} os={os} onOpen={onOpen} />
        ))}
      </div>
    </>
  );
}
