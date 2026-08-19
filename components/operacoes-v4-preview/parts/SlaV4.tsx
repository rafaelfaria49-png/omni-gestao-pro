"use client";

import { useMemo, useState } from "react";
import type { PrioridadeV3 } from "@/lib/operacoes-v3/producao-model";
import { PRIORIDADE_META_V3, PRIORIDADES_V3 } from "@/lib/operacoes-v3/producao-model";
import {
  FILTROS_SLA_VAZIOS,
  SEM_TECNICO_SLA_V4,
  filtrarSlaV4,
  filtrosSlaAtivosV4,
  formatAtrasoSlaV4,
  type FiltrosSlaV4,
  type SlaOsV4,
} from "@/lib/operacoes-v4/sla-v4";
import type { V4Vals } from "../use-v4-preview";
import styles from "./bancada-v4.module.css";

function slaPill(situacao: SlaOsV4["sla"]["situacao"]): string {
  if (situacao === "atrasada") return styles.pillDanger;
  if (situacao === "em_risco") return styles.pillWarn;
  if (situacao === "no_prazo") return styles.pillOk;
  return styles.pillNeutral;
}

function prioPill(p: PrioridadeV3): string {
  if (p === "urgente") return styles.pillDanger;
  if (p === "alta") return styles.pillWarn;
  if (p === "garantia") return styles.pillInfo;
  return styles.pillNeutral;
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "warn" | "danger" | "ok" }) {
  const cls = tone === "warn" ? styles.kpiWarn : tone === "danger" ? styles.kpiDanger : tone === "ok" ? styles.kpiOk : "";
  return (
    <div className={`${styles.kpi} ${cls}`}>
      <span className={styles.kpiValue}>{value}</span>
      <span className={styles.kpiLabel}>{label}</span>
    </div>
  );
}

function SlaRow({ row, onOpen }: { row: SlaOsV4; onOpen: () => void }) {
  const rowTone = row.sla.situacao === "atrasada" ? styles.rowHot : row.sla.situacao === "em_risco" ? styles.rowRisk : "";
  const atraso = formatAtrasoSlaV4(row.atrasoMinutos);
  return (
    <article className={`${styles.row} ${rowTone}`} data-os={row.osId}>
      <div className={styles.rowId} style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, width: "100%" }}>
          <span className={styles.osNum}>{row.numero}</span>
          <span className={styles.osWho}>{row.cliente}</span>
        </div>
        <div className={styles.osSub}>
          {[row.aparelho, row.defeito, row.tecnicoNome ?? "Sem técnico"].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className={styles.pills}>
        <span className={`${styles.pill} ${styles.pillPri}`}>{row.statusLabel}</span>
        <span className={`${styles.pill} ${prioPill(row.prioridade)}`}>{row.prioridadeLabel}</span>
        <span className={`${styles.pill} ${slaPill(row.sla.situacao)}`}>{row.sla.texto}</span>
        {atraso ? <span className={`${styles.pill} ${styles.pillDanger}`}>atraso {atraso}</span> : null}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.btnPri} onClick={onOpen}>
          Abrir execução
        </button>
      </div>
    </article>
  );
}

function Secao({
  titulo,
  hint,
  count,
  itens,
  onOpen,
}: {
  titulo: string;
  hint: string;
  count: number;
  itens: SlaOsV4[];
  onOpen: (id: string) => void;
}) {
  return (
    <section className={styles.inbox} aria-label={titulo}>
      <div className={styles.inboxHead}>
        <div>
          <h2 className={styles.inboxTitle}>{titulo}</h2>
          <p className={styles.inboxHint}>{hint}</p>
        </div>
        <span className={styles.count}>{count} OS</span>
      </div>
      {itens.length === 0 ? (
        <p className={styles.inboxHint}>Nenhuma OS neste bucket.</p>
      ) : (
        <div className={styles.rows}>
          {itens.map((row) => (
            <SlaRow key={row.osId} row={row} onOpen={() => onOpen(row.osId)} />
          ))}
        </div>
      )}
    </section>
  );
}

export function SlaV4({ v }: { v: V4Vals }) {
  const [filtros, setFiltros] = useState<FiltrosSlaV4>(FILTROS_SLA_VAZIOS);
  const visivel = useMemo(() => filtrarSlaV4(v.slaOperacional, filtros), [v.slaOperacional, filtros]);
  const filtrando = filtrosSlaAtivosV4(filtros);
  const r = v.slaOperacional.resumo;
  const semResultado = visivel.lista.length === 0;

  return (
    <div className={styles.shell}>
      <header className={styles.head}>
        <div className={styles.headCopy}>
          <p className={styles.kicker}>Prazos da assistência</p>
          <h1 className={styles.title}>SLA & atrasos</h1>
        </div>
        <span className={styles.badge}>Operacional</span>
      </header>

      <div className={styles.body}>
        {v.ordensPrimeiraCarga && v.ordensLoading ? (
          <div className={styles.empty}>Carregando prazos da loja…</div>
        ) : v.ordensError ? (
          <div className={styles.empty}>
            <p className={styles.emptyStrong}>{v.ordensError}</p>
            <button type="button" className={styles.btnGhost} onClick={v.reloadOrdens}>
              Tentar novamente
            </button>
          </div>
        ) : (
          <>
            <div className={styles.ticker} aria-label="Resumo de SLA">
              <Kpi label="Atrasadas" value={r.atrasadas} tone={r.atrasadas > 0 ? "danger" : undefined} />
              <Kpi label="Em risco" value={r.emRisco} tone={r.emRisco > 0 ? "warn" : undefined} />
              <Kpi label="No prazo" value={r.noPrazo} tone="ok" />
              <Kpi label="Sem prazo" value={r.semPrazo} />
            </div>

            <div className={styles.filters}>
              <input
                className={styles.search}
                value={filtros.busca}
                onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
                placeholder="OS, cliente, aparelho…"
                aria-label="Buscar no SLA"
              />
              <select
                className={styles.select}
                value={filtros.tecnicoId ?? ""}
                onChange={(e) => setFiltros((f) => ({ ...f, tecnicoId: e.target.value || null }))}
                aria-label="Filtrar por técnico"
              >
                <option value="">Técnico · Todos</option>
                <option value={SEM_TECNICO_SLA_V4}>Sem técnico</option>
                {v.slaOperacional.tecnicosConhecidos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>
              <select
                className={styles.select}
                value={filtros.prioridade}
                onChange={(e) => setFiltros((f) => ({ ...f, prioridade: e.target.value as FiltrosSlaV4["prioridade"] }))}
                aria-label="Filtrar por prioridade"
              >
                <option value="todas">Prioridade · Todas</option>
                {PRIORIDADES_V3.map((p) => (
                  <option key={p} value={p}>
                    {PRIORIDADE_META_V3[p].label}
                  </option>
                ))}
              </select>
              <select
                className={styles.select}
                value={filtros.situacao}
                onChange={(e) => setFiltros((f) => ({ ...f, situacao: e.target.value as FiltrosSlaV4["situacao"] }))}
                aria-label="Filtrar por situação de SLA"
              >
                <option value="todas">Situação · Todas</option>
                <option value="atrasada">Atrasadas</option>
                <option value="em_risco">Em risco</option>
                <option value="no_prazo">No prazo</option>
                <option value="sem_prazo">Sem prazo</option>
              </select>
            </div>

            {!v.slaOperacional.temDados ? (
              <div className={styles.empty}>
                <p className={styles.emptyStrong}>Nenhuma OS ativa para acompanhar prazo.</p>
                Prazos vêm da previsão/SLA real da OS — nada é inventado aqui.
              </div>
            ) : filtrando && semResultado ? (
              <div className={styles.empty}>
                <p className={styles.emptyStrong}>Nenhuma OS corresponde a este filtro.</p>
              </div>
            ) : (
              <>
                <Secao
                  titulo="Atrasadas"
                  hint="Prazo estourado — tratar primeiro."
                  count={visivel.atrasadas.length}
                  itens={visivel.atrasadas}
                  onOpen={v.openOSProducao}
                />
                <Secao
                  titulo="Em risco"
                  hint="Vencem em até 24h ou já estão em alerta."
                  count={visivel.emRisco.length}
                  itens={visivel.emRisco}
                  onOpen={v.openOSProducao}
                />
                {filtros.situacao !== "atrasada" && filtros.situacao !== "em_risco" ? (
                  <Secao
                    titulo="No prazo"
                    hint="Dentro do SLA combinado."
                    count={visivel.noPrazo.length}
                    itens={visivel.noPrazo}
                    onOpen={v.openOSProducao}
                  />
                ) : null}
                {filtros.situacao === "sem_prazo" || visivel.semPrazo.length > 0 ? (
                  <Secao
                    titulo="Sem prazo"
                    hint="OS ativas sem previsão/SLA registrado."
                    count={visivel.semPrazo.length}
                    itens={visivel.semPrazo}
                    onOpen={v.openOSProducao}
                  />
                ) : null}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
