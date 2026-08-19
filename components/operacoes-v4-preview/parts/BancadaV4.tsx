"use client";

import { useMemo, useState } from "react";
import type { OperacaoStatusV3 } from "@/lib/operacoes-v3/status-machine";
import type { PrioridadeV3 } from "@/lib/operacoes-v3/producao-model";
import {
  FILTROS_BANCADA_V4,
  filtrarBancadaV4,
  type BancadaOsV4,
  type FiltroBancadaV4,
} from "@/lib/operacoes-v4/producao-v4";
import type { V4Vals } from "../use-v4-preview";
import { PrioridadePickerV4, TecnicoPickerV4 } from "./ProducaoControlesV4";
import styles from "./bancada-v4.module.css";

type BusyKind = "tecnico" | "prioridade" | "status" | "local";

function slaPill(situacao: BancadaOsV4["sla"]["situacao"]): string {
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

function OsRow({
  row,
  v,
  busy,
  erro,
  openPicker,
  setOpenPicker,
  onBusy,
}: {
  row: BancadaOsV4;
  v: V4Vals;
  busy: { osId: string; kind: BusyKind } | null;
  erro: string | null;
  openPicker: string | null;
  setOpenPicker: (id: string | null) => void;
  onBusy: (osId: string, kind: BusyKind, fn: () => Promise<boolean>) => Promise<boolean>;
}) {
  const locked = busy?.osId === row.osId;
  const pickerTec = openPicker === `${row.osId}:tec`;
  const pickerPrio = openPicker === `${row.osId}:prio`;
  const rowTone = row.sla.situacao === "atrasada" ? styles.rowHot : row.sla.situacao === "em_risco" ? styles.rowRisk : "";

  return (
    <article className={`${styles.row} ${rowTone}`} data-os={row.osId}>
      <div className={styles.rowId} style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, width: "100%" }}>
          <span className={styles.osNum}>{row.numero}</span>
          <span className={styles.osWho}>{row.cliente}</span>
        </div>
        <div className={styles.osSub}>
          {[row.aparelho, row.defeito, row.localFisico].filter(Boolean).join(" · ") || "Aparelho não informado"}
        </div>
      </div>

      <div className={styles.pills}>
        <span className={`${styles.pill} ${styles.pillPri}`}>{row.statusLabel}</span>
        <span className={`${styles.pill} ${prioPill(row.prioridade)}`}>{row.prioridadeLabel}</span>
        <span className={`${styles.pill} ${slaPill(row.sla.situacao)}`}>{row.sla.texto}</span>
        {row.tecnicoNome ? <span className={`${styles.pill} ${styles.pillNeutral}`}>{row.tecnicoNome}</span> : null}
      </div>

      <div className={styles.actions}>
        <div className={styles.wrap}>
          <button
            type="button"
            className={row.semTecnico ? styles.btnPri : styles.btnGhost}
            disabled={locked}
            onClick={() => setOpenPicker(pickerTec ? null : `${row.osId}:tec`)}
          >
            {locked && busy?.kind === "tecnico" ? "Atribuindo…" : row.semTecnico ? "Atribuir técnico" : "Trocar técnico"}
          </button>
          {pickerTec ? (
            <>
              <button type="button" onClick={() => setOpenPicker(null)} style={{ position: "fixed", inset: 0, border: 0, background: "transparent", zIndex: 30 }} aria-label="Fechar" />
              <TecnicoPickerV4
                conhecidos={v.producaoBancada.tecnicosConhecidos}
                atualNome={row.tecnicoNome}
                pending={locked && busy?.kind === "tecnico"}
                onAtribuir={(nome, id) => onBusy(row.osId, "tecnico", () => v.atribuirTecnico(row.osId, nome, id))}
                onRemover={row.semTecnico ? undefined : () => onBusy(row.osId, "tecnico", () => v.removerTecnico(row.osId))}
                onClose={() => setOpenPicker(null)}
              />
            </>
          ) : null}
        </div>

        <div className={styles.wrap}>
          <button
            type="button"
            className={styles.btnGhost}
            disabled={locked}
            onClick={() => setOpenPicker(pickerPrio ? null : `${row.osId}:prio`)}
          >
            {locked && busy?.kind === "prioridade" ? "Salvando…" : "Prioridade"}
          </button>
          {pickerPrio ? (
            <>
              <button type="button" onClick={() => setOpenPicker(null)} style={{ position: "fixed", inset: 0, border: 0, background: "transparent", zIndex: 30 }} aria-label="Fechar" />
              <PrioridadePickerV4
                atual={row.prioridade}
                pending={locked && busy?.kind === "prioridade"}
                onEscolher={(p) => onBusy(row.osId, "prioridade", () => v.definirPrioridade(row.osId, p))}
                onClose={() => setOpenPicker(null)}
              />
            </>
          ) : null}
        </div>

        {row.acoesRapidas.map((acao) => (
          <button
            key={acao.to}
            type="button"
            className={acao.primaria ? styles.btnPri : styles.btnGhost}
            disabled={locked}
            onClick={() => void onBusy(row.osId, "status", () => v.avancarStatusBancada(row.osId, acao.to as OperacaoStatusV3))}
          >
            {locked && busy?.kind === "status" ? "Processando…" : acao.label}
          </button>
        ))}

        <button
          type="button"
          className={row.naBancada ? styles.btnGhost : styles.btnPri}
          disabled={locked}
          onClick={() =>
            void onBusy(row.osId, "local", () => (row.naBancada ? v.sairBancada(row.osId) : v.entrarBancada(row.osId)))
          }
        >
          {locked && busy?.kind === "local" ? "Salvando…" : row.naBancada ? "Sair da bancada" : "Entrar na bancada"}
        </button>

        {row.ctaComercial ? (
          <button
            type="button"
            className={styles.btnPri}
            data-cta-comercial={row.ctaComercial.kind}
            onClick={() => v.openOSFromRail(row.osId)}
          >
            {row.ctaComercial.label}
          </button>
        ) : null}

        <button type="button" className={styles.btnGhost} onClick={() => v.openOSProducao(row.osId)}>
          Abrir execução
        </button>
      </div>
      {erro ? <p className={styles.err} style={{ gridColumn: "1 / -1" }}>{erro}</p> : null}
    </article>
  );
}

export function BancadaV4({ v }: { v: V4Vals }) {
  const [filtro, setFiltro] = useState<FiltroBancadaV4>("todos");
  const [tecnicoId, setTecnicoId] = useState<string>("");
  const [busca, setBusca] = useState("");
  const [busy, setBusy] = useState<{ osId: string; kind: BusyKind } | null>(null);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [openPicker, setOpenPicker] = useState<string | null>(null);

  const visivel = useMemo(
    () => filtrarBancadaV4(v.producaoBancada, filtro, tecnicoId || null, busca),
    [v.producaoBancada, filtro, tecnicoId, busca],
  );

  const onBusy = async (osId: string, kind: BusyKind, fn: () => Promise<boolean>): Promise<boolean> => {
    if (busy) return false;
    setBusy({ osId, kind });
    setErros((prev) => {
      const next = { ...prev };
      delete next[osId];
      return next;
    });
    try {
      const ok = await fn();
      if (!ok) {
        setErros((prev) => ({
          ...prev,
          [osId]:
            kind === "tecnico"
              ? "Não foi possível atribuir o técnico. Tente novamente."
              : kind === "prioridade"
                ? "Não foi possível alterar a prioridade. Tente novamente."
                : kind === "local"
                  ? "Não foi possível mover a OS na bancada. Tente novamente."
                  : "Não foi possível avançar o status. Tente novamente.",
        }));
      }
      return ok;
    } finally {
      setBusy(null);
    }
  };

  const r = v.producaoBancada.resumo;
  const filtrando = filtro !== "todos" || !!tecnicoId || !!busca.trim();
  const semResultado = visivel.semTecnico.length === 0 && visivel.tecnicos.length === 0;

  return (
    <div className={styles.shell}>
      <header className={styles.head}>
        <div className={styles.headCopy}>
          <p className={styles.kicker}>Produção da assistência hoje</p>
          <h1 className={styles.title}>Bancada</h1>
        </div>
        <span className={styles.badge}>Operacional</span>
      </header>

      <div className={styles.body}>
        {v.ordensPrimeiraCarga && v.ordensLoading ? (
          <div className={styles.empty}>Carregando produção da loja…</div>
        ) : v.ordensError ? (
          <div className={styles.empty}>
            <p className={styles.emptyStrong}>{v.ordensError}</p>
            <button type="button" className={styles.btnGhost} onClick={v.reloadOrdens}>
              Tentar novamente
            </button>
          </div>
        ) : (
          <>
            <div className={styles.ticker} aria-label="Resumo da bancada">
              <Kpi label="Sem técnico" value={r.semTecnico} tone={r.semTecnico > 0 ? "warn" : undefined} />
              <Kpi label="Aguardando início" value={r.aguardandoInicio} />
              <Kpi label="Em execução" value={r.emExecucao} />
              <Kpi label="Aguardando peça" value={r.aguardandoPeca} tone={r.aguardandoPeca > 0 ? "warn" : undefined} />
              <Kpi label="Prontas" value={r.prontas} tone="ok" />
              {r.emRisco > 0 ? <Kpi label="Em risco" value={r.emRisco} tone="warn" /> : null}
              <Kpi label="Atrasadas" value={r.atrasadas} tone={r.atrasadas > 0 ? "danger" : undefined} />
            </div>

            <div className={styles.filters}>
              {FILTROS_BANCADA_V4.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`${styles.chip} ${filtro === f.id ? styles.chipOn : ""}`}
                  onClick={() => setFiltro(f.id)}
                >
                  {f.label}
                </button>
              ))}
              <select
                className={styles.select}
                value={tecnicoId}
                onChange={(e) => setTecnicoId(e.target.value)}
                aria-label="Técnico"
              >
                <option value="">Técnico · Todos</option>
                {v.producaoBancada.tecnicos.map((t) => (
                  <option key={t.tecnicoId} value={t.tecnicoId}>
                    {t.tecnicoNome}
                  </option>
                ))}
              </select>
              <input
                className={styles.search}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="OS, cliente, aparelho…"
                aria-label="Buscar na bancada"
              />
            </div>

            {!v.producaoBancada.temProducao ? (
              <div className={styles.empty}>
                <p className={styles.emptyStrong}>Nenhuma OS na bancada agora.</p>
                OS entregues, canceladas ou orçamentos comerciais não entram na produção.
              </div>
            ) : filtrando && semResultado ? (
              <div className={styles.empty}>
                <p className={styles.emptyStrong}>Nenhuma OS corresponde a este filtro.</p>
              </div>
            ) : (
              <>
                {filtro !== "em_execucao" && filtro !== "aguardando_peca" && filtro !== "pronta" && !tecnicoId ? (
                  <section className={styles.inbox} aria-label="Sem técnico">
                    <div className={styles.inboxHead}>
                      <div>
                        <h2 className={styles.inboxTitle}>Sem técnico</h2>
                        <p className={styles.inboxHint}>OS que ainda precisam entrar em produção.</p>
                      </div>
                      <span className={styles.count}>{visivel.semTecnico.length} OS</span>
                    </div>
                    {visivel.semTecnico.length === 0 ? (
                      <p className={styles.inboxHint}>Todas as OS de produção já possuem técnico.</p>
                    ) : (
                      <div className={styles.rows}>
                        {visivel.semTecnico.map((row) => (
                          <OsRow
                            key={row.osId}
                            row={row}
                            v={v}
                            busy={busy}
                            erro={erros[row.osId] ?? null}
                            openPicker={openPicker}
                            setOpenPicker={setOpenPicker}
                            onBusy={onBusy}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                ) : null}

                {visivel.tecnicos.map((grupo) => (
                  <section key={grupo.tecnicoId} className={styles.crew} aria-label={grupo.tecnicoNome}>
                    <div className={styles.crewHead}>
                      <h2 className={styles.crewName}>{grupo.tecnicoNome}</h2>
                      <span className={styles.count}>{grupo.carga.atribuidas} OS</span>
                    </div>
                    <div className={styles.crewMeta}>
                      <span>{grupo.carga.emExecucao} em execução</span>
                      <span>{grupo.carga.aguardandoPeca} aguardando peça</span>
                      <span>{grupo.carga.prontas} prontas</span>
                      {grupo.carga.emRisco > 0 ? <span>{grupo.carga.emRisco} em risco</span> : null}
                      {grupo.carga.atrasadas > 0 ? <span>{grupo.carga.atrasadas} atrasadas</span> : null}
                    </div>
                    <div className={styles.rows} style={{ marginTop: 10 }}>
                      {grupo.ordens.map((row) => (
                        <OsRow
                          key={row.osId}
                          row={row}
                          v={v}
                          busy={busy}
                          erro={erros[row.osId] ?? null}
                          openPicker={openPicker}
                          setOpenPicker={setOpenPicker}
                          onBusy={onBusy}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
