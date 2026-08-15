/** Operações V4 — caixa da OS: resumo, ações e histórico. */
import { C, fmt } from "../../tokens";
import type { V4Vals } from "../../use-v4-preview";
import { ReceberPagamentoV4 } from "../ReceberPagamentoV4";
import styles from "../financeiro-stage.module.css";

const emptyText = { fontSize: 12, color: C.subtle, padding: "8px 2px", lineHeight: 1.5 } as const;

function amount(value: number | null): string {
  return value == null ? "Indisponível" : fmt(value);
}

function dateTime(value: string | null): string {
  if (!value) return "Data não registrada";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("pt-BR");
}

export function FinanceiroStage({ v }: { v: V4Vals }) {
  const financial = v.financial;
  const projection = financial.projection;
  const resumo = v.financeiroResumo;

  if (financial.loading) {
    return <div className={styles.tape}><div className={styles.tapeHead}><span className={styles.tapeEyebrow}>Financeiro</span></div><div style={{ ...emptyText, padding: 14 }}>Carregando a projeção financeira desta OS…</div></div>;
  }
  if (financial.error || !projection) {
    return (
      <div className={styles.tape}>
        <div className={styles.tapeHead}><span className={styles.tapeEyebrow}>Financeiro indisponível</span></div>
        <div style={{ ...emptyText, color: C.dangerFg, padding: 14 }}>{financial.error ?? "Não foi possível determinar a situação financeira desta OS."}</div>
        <div style={{ padding: "0 14px 14px" }}>
          <button type="button" onClick={financial.reload} style={{ height: 32, padding: "0 12px", border: `1px solid ${C.inputBd}`, background: C.surface, color: C.body, borderRadius: 8, fontSize: 12, cursor: "pointer" }}>Tentar novamente</button>
        </div>
      </div>
    );
  }

  const inconsistent = projection.consistencyStatus === "INCONSISTENT" || projection.consistencyStatus === "UNKNOWN";
  const statusColors = inconsistent
    ? { bg: C.dangerBg, fg: C.dangerFg }
    : projection.financialStatus === "PAID" || projection.canDeliver
      ? { bg: C.successBg, fg: C.successFg }
      : { bg: C.warnBg, fg: C.warnFg };

  return (
    <div className={styles.panel}>
      <section className={styles.tape}>
        <div className={styles.tapeHead}>
          <div style={{ minWidth: 0 }}>
            <span className={styles.tapeEyebrow}>Financeiro da OS</span>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {v.os.codigo}{v.os.cliente ? `  ${v.os.cliente}` : ""}
            </div>
          </div>
          <span className={styles.stamp} style={{ background: statusColors.bg, color: statusColors.fg }}>{resumo.situacaoLabel}</span>
        </div>

        <div className={styles.strip}>
          <div className={styles.cell}>
            <div className={styles.cellLabel}>Total</div>
            <div className={styles.cellValue}>{amount(resumo.total ?? projection.expectedTotal)}</div>
          </div>
          <div className={styles.cell}>
            <div className={styles.cellLabel}>Recebido</div>
            <div className={styles.cellValue}>{amount(resumo.recebido ?? projection.receivedTotal)}</div>
          </div>
          <div className={styles.cell}>
            <div className={styles.cellLabel}>Saldo</div>
            <div className={styles.cellValue} style={{ color: (resumo.saldo ?? 0) > 0 ? C.warnFg : C.ink }}>{amount(resumo.saldo ?? projection.balance)}</div>
          </div>
        </div>

        {projection.consistencyIssues.length > 0 && (
          <div className={styles.issue} style={{ border: `1px solid ${inconsistent ? C.dangerBd : C.warnBd}`, background: inconsistent ? C.dangerBg : C.warnBg, color: inconsistent ? C.dangerFg : C.warnFg }}>
            {projection.consistencyIssues.join(" ")}
          </div>
        )}

        <div className={styles.meta}>
          <div className={styles.metaRow}><span className={styles.metaLabel}>Conta a Receber</span><span className={styles.metaValue}>{projection.receivableFound ? projection.receivableStatus ?? "Encontrada" : "Não criada"}</span></div>
          <div className={styles.metaRow}><span className={styles.metaLabel}>Forma de pagamento</span><span className={styles.metaValue}>{financial.paymentMethodSummary}</span></div>
          {projection.collectionMode ? <div className={styles.metaRow}><span className={styles.metaLabel}>Cobrança</span><span className={styles.metaValue}>{projection.collectionMode}</span></div> : null}
          {projection.authorizedNoCharge && <div className={styles.metaRow}><span className={styles.metaLabel}>Sem cobrança</span><span className={styles.metaValue}>{projection.noChargeCategory ?? "Autorizada"}</span></div>}
          {projection.installments.length > 0 && (
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Vencimento</span>
              <span className={styles.metaValue}>{projection.installments[0]?.dueAt ?? "sem vencimento"}{projection.installments[0]?.amount != null ? ` · ${amount(projection.installments[0].amount)}` : ""}</span>
            </div>
          )}
        </div>

        {projection.receivedTotal != null && projection.receivedTotal > 0 && (
          <div className={styles.actions}>
            <button type="button" onClick={v.openRecibo} style={{ height: 34, padding: "0 12px", border: `1px solid ${C.inputBd}`, background: C.surface, color: C.body, borderRadius: 8, fontSize: 12, cursor: "pointer" }}>Imprimir comprovante</button>
            <button type="button" onClick={v.openEstornoRecebimento} disabled={!v.estorno.podeEstornar} style={{ height: 34, padding: "0 12px", border: `1px solid ${C.dangerBd}`, background: C.surface, color: C.dangerFg, borderRadius: 8, fontSize: 12, cursor: v.estorno.podeEstornar ? "pointer" : "default", opacity: v.estorno.podeEstornar ? 1 : 0.55 }}>Estornar</button>
          </div>
        )}

        <div style={{ padding: "0 12px 12px" }}>
          <ReceberPagamentoV4 v={v} />
        </div>
      </section>

      <section className={styles.history}>
        <div className={styles.historyTitle}>Histórico de recebimentos</div>
        {projection.financialEvents.length === 0 ? <div className={styles.empty}>Nenhum recebimento registrado nesta OS.</div> : projection.financialEvents.map((event) => (
          <div key={event.eventId} className={styles.historyItem}>
            <span className={styles.dot} style={{ background: event.type.includes("estorno") ? C.danger : C.success }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: C.body }}>
                {event.description}
                {event.amount != null ? ` · ${fmt(event.amount)}` : ""}
                {event.paymentMethod ? ` · ${event.paymentMethod}` : ""}
              </div>
              <div style={{ fontSize: 10.5, color: C.subtle }}>
                {dateTime(event.occurredAt)}
                {event.actor ? ` · ${event.actor}` : ""}
                {event.type.includes("estorno") ? " · Estornado" : ""}
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
