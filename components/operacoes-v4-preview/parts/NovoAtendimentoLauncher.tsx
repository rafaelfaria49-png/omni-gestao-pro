/**
 * Operações V4 — launcher `+ Novo` (GOAL OPS-V4-NOVO-ATENDIMENTO-COMERCIAL-001).
 *
 * Entrada única das três modalidades. Não persiste nada: só escolhe o motor
 * já existente (Nova OS / Orçamento rápido / Atendimento rápido). Duplicar
 * orçamento continua abrindo o modal de orçamento direto, sem passar daqui.
 */
"use client";

import { useEffect, useRef } from "react";
import { C } from "../tokens";
import type { V4Vals } from "../use-v4-preview";
import {
  NOVO_ATENDIMENTO_COPY_V4,
  NOVO_ATENDIMENTO_OPCOES_V4,
  type NovoAtendimentoModalidadeV4,
} from "@/lib/operacoes-v4/novo-atendimento";
import styles from "../operacoes-v4-preview.module.css";

function NovaOSMark() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function OrcamentoMark() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function NovoAtendimentoLauncher({ v }: { v: V4Vals }) {
  if (!v.novoAtendimentoOpen) return null;
  return <NovoAtendimentoLauncherContent v={v} />;
}

function NovoAtendimentoLauncherContent({ v }: { v: V4Vals }) {
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        v.closeNovoAtendimento();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [v]);

  const escolher = (id: NovoAtendimentoModalidadeV4) => {
    v.escolherNovoAtendimento(id);
  };

  return (
    <div
      role="presentation"
      onClick={v.closeNovoAtendimento}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 70,
        background: "rgba(17,19,26,.42)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "flex-end",
        padding: "52px 16px 24px",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="novo-atendimento-titulo"
        aria-describedby="novo-atendimento-sub"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 400,
          maxWidth: "100%",
          background: C.surface,
          border: `1px solid ${C.line2}`,
          borderRadius: 16,
          boxShadow: "0 28px 64px rgba(17,19,26,.28)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: "16px 16px 12px",
            borderBottom: `1px solid ${C.line2}`,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              id="novo-atendimento-titulo"
              style={{
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                color: C.ink,
                lineHeight: 1.25,
              }}
            >
              {NOVO_ATENDIMENTO_COPY_V4.titulo}
            </div>
            <div
              id="novo-atendimento-sub"
              style={{
                marginTop: 4,
                fontSize: 12.5,
                color: C.subtle,
                lineHeight: 1.45,
              }}
            >
              {NOVO_ATENDIMENTO_COPY_V4.subtitulo}
            </div>
          </div>
          <button
            type="button"
            onClick={v.closeNovoAtendimento}
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
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: 12,
            minWidth: 0,
          }}
        >
          {NOVO_ATENDIMENTO_OPCOES_V4.map((opcao, index) => (
            <button
              key={opcao.id}
              ref={index === 0 ? firstRef : undefined}
              type="button"
              onClick={() => escolher(opcao.id)}
              className={styles.novoTicket}
              style={{
                display: "flex",
                alignItems: "stretch",
                gap: 0,
                width: "100%",
                minWidth: 0,
                textAlign: "left",
                padding: 0,
                border: `1px solid ${C.line2}`,
                background: C.surface,
                borderRadius: 12,
                cursor: "pointer",
                overflow: "hidden",
              }}
            >
              <span
                aria-hidden
                style={{
                  flex: "none",
                  width: 4,
                  background: C.primary,
                  opacity: 0.35,
                }}
              />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  padding: "11px 12px 12px",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignSelf: "flex-start",
                    height: 18,
                    padding: "0 7px",
                    borderRadius: 999,
                    background: C.primaryBg,
                    color: C.primary,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    lineHeight: "18px",
                  }}
                >
                  {opcao.chip}
                </span>
                <span
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 10,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 13.5,
                      fontWeight: 700,
                      letterSpacing: "-0.015em",
                      color: C.ink,
                      minWidth: 0,
                    }}
                  >
                    {opcao.id === "os" ? <NovaOSMark /> : opcao.id === "orcamento" ? <OrcamentoMark /> : null}
                    {opcao.titulo}
                  </span>
                  <span aria-hidden style={{ flex: "none", color: C.faint, fontSize: 16, lineHeight: 1 }}>
                    →
                  </span>
                </span>
                <span style={{ fontSize: 12, color: C.subtle, lineHeight: 1.45 }}>{opcao.descricao}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
