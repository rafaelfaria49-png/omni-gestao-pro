"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { OperacaoStatusV3 } from "@/lib/operacoes-v3/status-machine";
import type { PrioridadeV3 } from "@/lib/operacoes-v3/producao-model";
import { PRIORIDADE_META_V3 } from "@/lib/operacoes-v3/producao-model";
import {
  FILTROS_FILA_VAZIOS,
  MSG_ERRO_MOVER_FILA_V4,
  PRIORIDADES_FILTRO_FILA_V4,
  SEM_TECNICO_FILA_V4,
  classificarColunaFilaV4,
  filtrarFilaV4,
  filtrosFilaAtivosV4,
  type DestinoFilaKindV4,
  type FilaOsV4,
  type FiltrosFilaV4,
} from "@/lib/operacoes-v4/fila-v4";
import type { V4Vals } from "../use-v4-preview";
import styles from "./fila-v4.module.css";

function prioClass(p: PrioridadeV3): string {
  if (p === "urgente") return styles.prioUrgente;
  if (p === "alta") return styles.prioAlta;
  if (p === "garantia") return styles.prioGarantia;
  return "";
}

function ticketClass(row: FilaOsV4, busy: boolean): string {
  const bits = [styles.ticket];
  if (row.prioridade === "urgente") bits.push(styles.ticketUrgente);
  else if (row.prioridade === "alta") bits.push(styles.ticketAlta);
  else if (row.prioridade === "garantia") bits.push(styles.ticketGarantia);
  if (row.sla.situacao === "atrasada") bits.push(styles.ticketAtrasada);
  else if (row.sla.situacao === "em_risco") bits.push(styles.ticketRisco);
  if (busy) bits.push(styles.ticketBusy);
  return bits.join(" ");
}

function slaClass(situacao: FilaOsV4["sla"]["situacao"]): string {
  if (situacao === "atrasada") return styles.metaSlaHot;
  if (situacao === "em_risco") return styles.metaSlaRisk;
  return styles.metaSlaOk;
}

function stationClass(kind: DestinoFilaKindV4): string {
  const bits = [styles.station];
  if (kind === "aceita") bits.push(styles.aceita);
  else if (kind === "recusada") bits.push(styles.recusada);
  else if (kind === "origem") bits.push(styles.origem);
  return bits.join(" ");
}

function MoverMenu({
  row,
  pending,
  onMover,
}: {
  row: FilaOsV4;
  pending: boolean;
  onMover: (to: OperacaoStatusV3) => void;
}) {
  if (row.destinos.length === 0) {
    return (
      <div className={styles.menu} role="menu" aria-label="Mover para">
        <p className={styles.menuTitle}>Mover para</p>
        <p className={styles.hint} style={{ padding: "2px 8px 6px" }}>
          {row.hintCockpit ?? "Nenhuma estação aceita esta OS agora."}
        </p>
      </div>
    );
  }
  return (
    <div className={styles.menu} role="menu" aria-label="Mover para">
      <p className={styles.menuTitle}>Mover para</p>
      {row.destinos.map((d) => (
        <button
          key={d.to}
          type="button"
          role="menuitem"
          className={styles.opt}
          disabled={pending}
          onClick={() => onMover(d.to)}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}

function TicketActions({
  row,
  locked,
  menuAberto,
  setMenu,
  onMover,
  onAbrir,
}: {
  row: FilaOsV4;
  locked: boolean;
  menuAberto: boolean;
  setMenu: (id: string | null) => void;
  onMover: (to: OperacaoStatusV3) => void;
  onAbrir: () => void;
}) {
  return (
    <div
      className={styles.actions}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.wrap}>
        <button
          type="button"
          className={styles.btnGhost}
          disabled={locked}
          aria-haspopup="menu"
          aria-expanded={menuAberto}
          onClick={() => setMenu(menuAberto ? null : row.osId)}
        >
          {locked ? "Salvando…" : "Mover para"}
        </button>
        {menuAberto ? (
          <>
            <button
              type="button"
              onClick={() => setMenu(null)}
              style={{ position: "fixed", inset: 0, border: 0, background: "transparent", zIndex: 30 }}
              aria-label="Fechar menu"
            />
            <MoverMenu
              row={row}
              pending={locked}
              onMover={(to) => {
                onMover(to);
                setMenu(null);
              }}
            />
          </>
        ) : null}
      </div>
      <button type="button" className={styles.btnPri} onClick={onAbrir}>
        Abrir OS
      </button>
    </div>
  );
}

function TicketBody({ row }: { row: FilaOsV4 }) {
  return (
    <>
      <div className={styles.top}>
        <span className={styles.osNum}>{row.numero}</span>
        <span className={`${styles.prio} ${prioClass(row.prioridade)}`}>{row.prioridadeLabel}</span>
      </div>
      <div className={styles.device}>{row.aparelho || "Aparelho não informado"}</div>
      <div className={styles.who}>{row.cliente}</div>
      {row.defeito ? <div className={styles.defect}>{row.defeito}</div> : null}
      <div className={styles.meta}>
        <span className={`${styles.metaTec} ${row.semTecnico ? styles.metaSem : ""}`}>
          {row.tecnicoNome ?? "Sem técnico"}
        </span>
        <span className={slaClass(row.sla.situacao)}>{row.sla.texto}</span>
        {row.localFisico ? <span>{row.localFisico}</span> : null}
        {row.orcamentoLabel ? <span>{row.orcamentoLabel}</span> : null}
      </div>
      {row.hintCockpit && row.destinos.length === 0 ? <p className={styles.hint}>{row.hintCockpit}</p> : null}
    </>
  );
}

export function FilaV4({ v }: { v: V4Vals }) {
  const modo = v.modoFila;
  const [filtros, setFiltros] = useState<FiltrosFilaV4>(FILTROS_FILA_VAZIOS);
  const [busy, setBusy] = useState<Record<string, true>>({});
  const [erros, setErros] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ osId: string; from: OperacaoStatusV3 } | null>(null);
  const skipClick = useRef(false);
  const boardRef = useRef<HTMLDivElement | null>(null);

  const visivel = useMemo(() => filtrarFilaV4(v.filaOperacional, filtros), [v.filaOperacional, filtros]);
  const filtrando = filtrosFilaAtivosV4(filtros);

  const escolherModo = v.setModoFila;

  const mover = useCallback(
    async (osId: string, to: OperacaoStatusV3): Promise<boolean> => {
      if (busy[osId]) return false;
      setBusy((prev) => ({ ...prev, [osId]: true }));
      setErros((prev) => {
        const next = { ...prev };
        delete next[osId];
        return next;
      });
      try {
        const ok = await v.moverStatusFila(osId, to);
        if (!ok) {
          setErros((prev) => ({ ...prev, [osId]: MSG_ERRO_MOVER_FILA_V4 }));
        }
        return ok;
      } finally {
        setBusy((prev) => {
          const next = { ...prev };
          delete next[osId];
          return next;
        });
      }
    },
    [busy, v],
  );

  const soltarEm = (col: OperacaoStatusV3) => {
    const atual = drag;
    setDrag(null);
    if (!atual || atual.from === col) return;
    if (classificarColunaFilaV4(atual.from, col) !== "aceita") return;
    void mover(atual.osId, col);
  };

  const onBoardWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = boardRef.current;
    if (!el) return;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  };

  const r = v.filaOperacional.resumo;

  return (
    <div className={styles.shell}>
      <header className={styles.head}>
        <div className={styles.headCopy}>
          <p className={styles.kicker}>Fila da assistência</p>
          <h1 className={styles.title}>Fila de OS</h1>
        </div>
        <span className={styles.badge}>Operacional</span>
      </header>

      <div className={styles.body}>
        {v.ordensPrimeiraCarga && v.ordensLoading ? (
          <div className={styles.empty}>Carregando fila da loja…</div>
        ) : v.ordensError ? (
          <div className={styles.empty}>
            <p className={styles.emptyStrong}>{v.ordensError}</p>
            <button type="button" className={styles.btnGhost} onClick={v.reloadOrdens}>
              Tentar novamente
            </button>
          </div>
        ) : (
          <>
            <div className={styles.toolbar}>
              <div className={styles.ticker} aria-label="Resumo da fila">
                <span className={styles.tick}>
                  <span className={styles.tickN}>{r.ativas}</span>
                  <span className={styles.tickL}>ativas</span>
                </span>
                <span className={`${styles.tick} ${r.atrasadas > 0 ? styles.tickDanger : ""}`}>
                  <span className={styles.tickN}>{r.atrasadas}</span>
                  <span className={styles.tickL}>atrasadas</span>
                </span>
                <span className={`${styles.tick} ${r.emRisco > 0 ? styles.tickWarn : ""}`}>
                  <span className={styles.tickN}>{r.emRisco}</span>
                  <span className={styles.tickL}>em risco</span>
                </span>
                <span className={`${styles.tick} ${r.semTecnico > 0 ? styles.tickWarn : ""}`}>
                  <span className={styles.tickN}>{r.semTecnico}</span>
                  <span className={styles.tickL}>sem técnico</span>
                </span>
              </div>

              <input
                className={styles.search}
                value={filtros.busca}
                onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
                placeholder="OS, cliente, aparelho"
                aria-label="Buscar OS, cliente, aparelho"
              />

              <select
                className={styles.select}
                value={filtros.tecnicoId ?? ""}
                onChange={(e) => setFiltros((f) => ({ ...f, tecnicoId: e.target.value || null }))}
                aria-label="Filtrar por técnico"
              >
                <option value="">Técnico · Todos</option>
                <option value={SEM_TECNICO_FILA_V4}>Sem técnico</option>
                {v.filaOperacional.tecnicosConhecidos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>

              <select
                className={styles.select}
                value={filtros.prioridade}
                onChange={(e) => setFiltros((f) => ({ ...f, prioridade: e.target.value as FiltrosFilaV4["prioridade"] }))}
                aria-label="Filtrar por prioridade"
              >
                <option value="todas">Prioridade · Todas</option>
                {PRIORIDADES_FILTRO_FILA_V4.map((p) => (
                  <option key={p} value={p}>
                    {PRIORIDADE_META_V3[p].label}
                  </option>
                ))}
              </select>

              <select
                className={styles.select}
                value={filtros.sla}
                onChange={(e) => setFiltros((f) => ({ ...f, sla: e.target.value as FiltrosFilaV4["sla"] }))}
                aria-label="Filtrar por SLA"
              >
                <option value="todas">SLA · Todos</option>
                <option value="em_risco">Em risco</option>
                <option value="atrasada">Atrasadas</option>
              </select>

              <div className={styles.modes} role="tablist" aria-label="Modo da fila">
                <button
                  type="button"
                  role="tab"
                  aria-selected={modo === "kanban"}
                  className={`${styles.mode} ${modo === "kanban" ? styles.modeOn : ""}`}
                  onClick={() => escolherModo("kanban")}
                >
                  Kanban
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={modo === "lista"}
                  className={`${styles.mode} ${modo === "lista" ? styles.modeOn : ""}`}
                  onClick={() => escolherModo("lista")}
                >
                  Lista
                </button>
              </div>
            </div>

            {!v.filaOperacional.temFila ? (
              <div className={styles.empty}>
                <p className={styles.emptyStrong}>Nenhuma OS na fila operacional.</p>
                Novas ordens aparecerão aqui conforme forem abertas.
              </div>
            ) : filtrando && visivel.lista.length === 0 ? (
              <div className={styles.empty}>
                <p className={styles.emptyStrong}>Nenhuma OS corresponde a este filtro.</p>
              </div>
            ) : modo === "lista" ? (
              <div className={styles.listWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>OS</th>
                      <th>Cliente / aparelho</th>
                      <th>Status</th>
                      <th>Técnico</th>
                      <th>Prioridade</th>
                      <th>SLA</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visivel.lista.map((row) => {
                      const locked = !!busy[row.osId];
                      return (
                        <tr key={row.osId} data-os={row.osId}>
                          <td className={styles.osNum}>{row.numero}</td>
                          <td>
                            <div className={styles.who}>{row.cliente}</div>
                            <div className={styles.device}>{row.aparelho || "Aparelho não informado"}</div>
                          </td>
                          <td>{row.statusLabel}</td>
                          <td className={row.semTecnico ? styles.metaSem : ""}>{row.tecnicoNome ?? "Sem técnico"}</td>
                          <td className={`${styles.prio} ${prioClass(row.prioridade)}`}>{row.prioridadeLabel}</td>
                          <td className={slaClass(row.sla.situacao)}>{row.sla.texto}</td>
                          <td>
                            <TicketActions
                              row={row}
                              locked={locked}
                              menuAberto={menu === row.osId}
                              setMenu={setMenu}
                              onMover={(to) => void mover(row.osId, to)}
                              onAbrir={() => v.openOSFromRail(row.osId)}
                            />
                            {erros[row.osId] ? <p className={styles.err}>{erros[row.osId]}</p> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.canvas}>
                <div ref={boardRef} className={styles.boardWrap} data-fila-kanban="1" onWheel={onBoardWheel}>
                  <div className={styles.board}>
                    {visivel.colunas.map((col) => {
                      const kind = classificarColunaFilaV4(drag?.from ?? null, col.status);
                      return (
                        <section
                          key={col.status}
                          className={stationClass(kind)}
                          aria-label={col.label}
                          data-station={col.status}
                          data-kind={kind}
                          onDragOver={(e) => {
                            if (kind !== "aceita") {
                              e.dataTransfer.dropEffect = "none";
                              return;
                            }
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            soltarEm(col.status);
                          }}
                        >
                          <div className={styles.stationHead}>
                            <span className={styles.stationName}>{col.label}</span>
                            <span className={styles.stationCount}>{col.itens.length}</span>
                          </div>
                          <div className={styles.lane}>
                            {col.itens.length === 0 ? (
                              <p className={styles.emptyLane}>Nenhuma OS nesta etapa</p>
                            ) : (
                              col.itens.map((row) => {
                                const locked = !!busy[row.osId];
                                return (
                                  <article
                                    key={row.osId}
                                    className={ticketClass(row, locked)}
                                    data-os={row.osId}
                                    draggable={!locked}
                                    tabIndex={0}
                                    onDragStart={(e) => {
                                      if (locked) {
                                        e.preventDefault();
                                        return;
                                      }
                                      skipClick.current = true;
                                      e.dataTransfer.setData("text/plain", row.osId);
                                      e.dataTransfer.effectAllowed = "move";
                                      setDrag({ osId: row.osId, from: row.status });
                                      setMenu(null);
                                    }}
                                    onDragEnd={() => {
                                      setDrag(null);
                                      window.setTimeout(() => {
                                        skipClick.current = false;
                                      }, 0);
                                    }}
                                    onClick={() => {
                                      if (skipClick.current) {
                                        skipClick.current = false;
                                        return;
                                      }
                                      v.openOSFromRail(row.osId);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        v.openOSFromRail(row.osId);
                                      }
                                      if (e.key === "m" || e.key === "M") {
                                        e.preventDefault();
                                        setMenu((cur) => (cur === row.osId ? null : row.osId));
                                      }
                                      if (e.key === "Escape") setMenu(null);
                                    }}
                                  >
                                    <TicketBody row={row} />
                                    <TicketActions
                                      row={row}
                                      locked={locked}
                                      menuAberto={menu === row.osId}
                                      setMenu={setMenu}
                                      onMover={(to) => void mover(row.osId, to)}
                                      onAbrir={() => v.openOSFromRail(row.osId)}
                                    />
                                    {erros[row.osId] ? <p className={styles.err}>{erros[row.osId]}</p> : null}
                                  </article>
                                );
                              })
                            )}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
