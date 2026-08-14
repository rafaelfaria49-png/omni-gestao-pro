"use client";

import type { ReactNode } from "react";
import { C } from "../../tokens";

export function AtendimentoAccordionSection({
  titulo,
  aberto,
  onToggle,
  children,
  resumo,
}: {
  titulo: string;
  aberto: boolean;
  onToggle: () => void;
  children: ReactNode;
  resumo?: string;
}) {
  return (
    <section
      style={{
        border: `1px solid ${C.line2}`,
        borderRadius: 12,
        background: C.surface,
        marginBottom: 10,
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={aberto}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          minWidth: 0,
          padding: "11px 13px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "-0.01em", color: C.ink }}>{titulo}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {!aberto && resumo ? (
            <span style={{ fontSize: 11.5, color: C.subtle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>
              {resumo}
            </span>
          ) : null}
          <span aria-hidden style={{ color: C.muted, fontSize: 12 }}>
            {aberto ? "▾" : "▸"}
          </span>
        </span>
      </button>
      {aberto ? <div style={{ padding: "0 13px 13px", minWidth: 0 }}>{children}</div> : null}
    </section>
  );
}
