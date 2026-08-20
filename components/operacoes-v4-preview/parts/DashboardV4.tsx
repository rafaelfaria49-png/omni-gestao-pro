"use client";

import type { DashboardDestinoV4, DashboardOsRefV4 } from "@/lib/operacoes-v4/dashboard-v4";
import type { V4Vals } from "../use-v4-preview";
import styles from "./bancada-v4.module.css";

function Kpi({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  tone?: "warn" | "danger" | "ok";
  onClick?: () => void;
}) {
  const cls = tone === "warn" ? styles.kpiWarn : tone === "danger" ? styles.kpiDanger : tone === "ok" ? styles.kpiOk : "";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      className={`${styles.kpi} ${cls}`}
      onClick={onClick}
      style={onClick ? { cursor: "pointer", textAlign: "left", border: 0 } : undefined}
    >
      <span className={styles.kpiValue}>{value}</span>
      <span className={styles.kpiLabel}>{label}</span>
    </Tag>
  );
}

function Secao({
  titulo,
  hint,
  itens,
  empty,
  onOpen,
}: {
  titulo: string;
  hint: string;
  itens: DashboardOsRefV4[];
  empty: string;
  onOpen: (row: DashboardOsRefV4) => void;
}) {
  return (
    <section className={styles.inbox} aria-label={titulo}>
      <div className={styles.inboxHead}>
        <div>
          <h2 className={styles.inboxTitle}>{titulo}</h2>
          <p className={styles.inboxHint}>{hint}</p>
        </div>
        <span className={styles.count}>{itens.length}</span>
      </div>
      {itens.length === 0 ? (
        <p className={styles.inboxHint}>{empty}</p>
      ) : (
        <div className={styles.rows}>
          {itens.map((row) => (
            <article key={row.osId} className={styles.row} data-os={row.osId}>
              <div className={styles.rowId} style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, width: "100%" }}>
                  <span className={styles.osNum}>{row.codigo}</span>
                  <span className={styles.osWho}>{row.cliente}</span>
                </div>
                <div className={styles.osSub}>{[row.aparelho, row.extra].filter(Boolean).join(" · ")}</div>
              </div>
              <div className={styles.pills}>
                <span className={`${styles.pill} ${styles.pillPri}`}>{row.statusLabel}</span>
              </div>
              <div className={styles.actions}>
                <button type="button" className={styles.btnPri} onClick={() => onOpen(row)}>
                  Abrir
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function DashboardV4({ v }: { v: V4Vals }) {
  const d = v.dashboardOperacional;
  const r = d.resumo;

  const abrir = (row: DashboardOsRefV4) => {
    if (row.destino === "fila") {
      v.railFila();
      v.openOSFromRail(row.osId);
      return;
    }
    if (row.destino === "bancada") {
      v.setModule("bancada");
      v.openOSProducao(row.osId);
      return;
    }
    if (row.destino === "sla") {
      v.setModule("sla");
      v.openOSProducao(row.osId);
      return;
    }
    if (row.destino === "garantias") {
      v.setModule("garantias");
      v.openOSFromRail(row.osId, false, "posvenda");
      return;
    }
    v.openOSFromRail(row.osId, false, row.destino);
  };

  return (
    <div className={styles.shell}>
      <header className={styles.head}>
        <div className={styles.headCopy}>
          <p className={styles.kicker}>Operações da loja</p>
          <h1 className={styles.title}>Visão geral</h1>
        </div>
        <span className={styles.badge}>Operacional</span>
      </header>

      <div className={styles.body}>
        {v.ordensPrimeiraCarga && v.ordensLoading ? (
          <div className={styles.empty}>Carregando operação da loja…</div>
        ) : v.ordensError ? (
          <div className={styles.empty}>
            <p className={styles.emptyStrong}>{v.ordensError}</p>
            <button type="button" className={styles.btnGhost} onClick={v.reloadOrdens}>
              Tentar novamente
            </button>
          </div>
        ) : !d.temDados ? (
          <div className={styles.empty}>
            <p className={styles.emptyStrong}>Nenhuma OS nesta loja ainda.</p>
            Abra um atendimento pelo + Novo. A visão geral usa só dados reais da lista.
          </div>
        ) : (
          <>
            <div className={styles.ticker} aria-label="Indicadores operacionais">
              <Kpi label="Ativas" value={r.ativas} onClick={v.railFila} />
              <Kpi label="Atrasadas" value={r.atrasadas} tone={r.atrasadas ? "danger" : undefined} onClick={() => v.setModule("sla")} />
              <Kpi label="Em risco" value={r.emRisco} tone={r.emRisco ? "warn" : undefined} onClick={() => v.setModule("sla")} />
              <Kpi label="Sem técnico" value={r.semTecnico} tone={r.semTecnico ? "warn" : undefined} onClick={() => v.setModule("bancada")} />
              <Kpi label="Na bancada" value={r.naBancada} onClick={() => v.setModule("bancada")} />
              <Kpi label="Em execução" value={r.emExecucao} onClick={v.railFila} />
              <Kpi label="Aguardando peça" value={r.aguardandoPeca} tone={r.aguardandoPeca ? "warn" : undefined} onClick={v.railFila} />
              <Kpi label="Prontas" value={r.prontas} tone="ok" onClick={v.railFila} />
              <Kpi label="Entregues hoje" value={r.entreguesHoje} />
              <Kpi label="Retornos abertos" value={r.retornosAbertos} tone={r.retornosAbertos ? "danger" : undefined} onClick={() => v.setModule("garantias")} />
              <Kpi label="Garantias vencendo" value={r.garantiasVencendo} tone={r.garantiasVencendo ? "warn" : undefined} onClick={() => v.setModule("garantias")} />
            </div>

            <section className={styles.inbox} aria-label="Fila por status">
              <div className={styles.inboxHead}>
                <div>
                  <h2 className={styles.inboxTitle}>Fila por status</h2>
                  <p className={styles.inboxHint}>Contagens reais das OS ativas. Clique para abrir a Fila.</p>
                </div>
              </div>
              <div className={styles.ticker} style={{ marginBottom: 0 }}>
                {d.fila.map((col) => (
                  <Kpi key={col.status} label={col.label} value={col.count} onClick={v.railFila} />
                ))}
              </div>
            </section>

            <Secao titulo="Atrasadas" hint="SLA estourado — tratar primeiro." itens={d.atrasadas} empty="Nenhuma OS atrasada agora." onOpen={abrir} />
            <Secao titulo="Sem técnico" hint="OS ativas ainda sem responsável." itens={d.semTecnico} empty="Toda a produção já tem técnico." onOpen={abrir} />
            <Secao titulo="Prontas para entrega" hint="Reparo concluído, aguardando retirada." itens={d.prontas} empty="Nenhuma OS pronta." onOpen={abrir} />
            <Secao titulo="Retornos abertos" hint="Garantia acionada, ainda sem encerrar." itens={d.retornos} empty="Nenhum retorno aberto." onOpen={abrir} />
            <Secao titulo="Entregas de hoje" hint="Confirmadas no dia corrente da loja." itens={d.entreguesHoje} empty="Nenhuma entrega registrada hoje." onOpen={abrir} />
          </>
        )}
      </div>
    </div>
  );
}

export type { DashboardDestinoV4 };
