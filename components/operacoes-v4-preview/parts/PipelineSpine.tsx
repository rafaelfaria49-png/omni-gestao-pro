/** Operações V4 — trilha operacional: Entrada → Diagnóstico → Execução → Entrega → Pós-venda. */
import { C } from "../tokens";
import type { V4Vals } from "../use-v4-preview";
import styles from "../operacoes-v4-preview.module.css";

export function PipelineSpine({ v }: { v: V4Vals }) {
  return (
    <div
      role="navigation"
      aria-label="Pipeline operacional da OS"
      className={styles.spineTrack}
      style={{
        flex: "none",
        display: "flex",
        alignItems: "stretch",
        height: 48,
        padding: "0 8px",
        background: C.surface,
        borderBottom: `1px solid ${C.line}`,
      }}
    >
      {v.pipeline.map((n, index) => (
        <button
          key={n.id}
          type="button"
          onClick={n.onClick}
          title={n.alertReason || n.sub ? `${n.label} — ${n.alertReason || n.sub}` : n.label}
          aria-current={n.selected ? "step" : undefined}
          className={styles.spineNode}
          style={{
            background: n.bg,
            borderBottom: `2.5px solid ${n.underline}`,
          }}
        >
          {n.done && !n.alert && (
            <span className={styles.spineMark} style={{ background: C.success, color: C.white }}>✓</span>
          )}
          {n.current && !n.alert && (
            <span className={styles.spineMark} style={{ background: C.primary, color: C.white, boxShadow: `0 0 0 3px ${C.primaryBg}` }}>●</span>
          )}
          {n.pending && !n.alert && (
            <span className={styles.spineMark} style={{ border: `2px solid ${C.inputBd}`, background: C.surface, color: C.subtle, fontSize: 8 }}>{String(index + 1).padStart(2, "0")}</span>
          )}
          {n.alert && (
            <span className={styles.spineMark} style={{ background: C.warnBg, color: C.warnFg, border: `1.5px solid ${C.warnBd}` }}>!</span>
          )}
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 12, fontWeight: 650, color: n.labelColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.label}</span>
            {(n.alertReason || n.sub) ? (
              <span style={{ fontSize: 10, color: n.alert ? C.warnFg : C.subtle, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.alertReason || n.sub}</span>
            ) : null}
          </div>
        </button>
      ))}
    </div>
  );
}
