"use client";

import type { ReactNode } from "react";
import { C } from "../../tokens";

export function AtendimentoModalShell({
  titulo,
  subtitulo,
  onClose,
  busy,
  width = 960,
  erro,
  footer,
  children,
}: {
  titulo: string;
  subtitulo: string;
  onClose: () => void;
  busy?: boolean;
  width?: number;
  erro?: string | null;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role="presentation"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 70,
        background: "rgba(17,19,26,.42)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="atend-shell-titulo"
        style={{
          width,
          maxWidth: "100%",
          maxHeight: "90vh",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          background: C.surface,
          border: `1px solid ${C.line2}`,
          borderRadius: 16,
          boxShadow: "0 28px 64px rgba(17,19,26,.28)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: "16px 18px 14px",
            borderBottom: `1px solid ${C.line2}`,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div id="atend-shell-titulo" style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em", color: C.ink }}>
              {titulo}
            </div>
            <div style={{ marginTop: 4, fontSize: 12.5, color: C.subtle, lineHeight: 1.45 }}>{subtitulo}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Fechar"
            style={{
              width: 28,
              height: 28,
              flex: "none",
              border: "none",
              background: C.muted50,
              borderRadius: 8,
              color: C.muted,
              fontSize: 16,
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16 }}>
          {erro ? (
            <div
              style={{
                background: C.dangerBg,
                border: `1px solid ${C.dangerBd}`,
                borderRadius: 9,
                padding: "9px 11px",
                marginBottom: 12,
                fontSize: 11.5,
                color: C.dangerFg,
                lineHeight: 1.45,
              }}
            >
              {erro}
            </div>
          ) : null}
          {children}
        </div>

        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "12px 16px",
            borderTop: `1px solid ${C.line2}`,
            background: C.surface2,
          }}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}
