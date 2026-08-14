/**
 * Operações V4 Preview — seletor de OS REAL (empty state do workspace).
 *
 * Lista as Ordens de Serviço reais da loja ativa (via `v.ordens`, carregadas
 * pela Server Action `listOrdens`). Busca por Nº da OS, cliente, aparelho e IMEI.
 * Ao escolher uma OS, `v.selectOS(os)` carrega seus dados reais no workspace.
 * Sem dados mock — quando não há OS, mostra estado vazio honesto.
 */
"use client";

import { useMemo, useState } from "react";
import { C } from "../tokens";
import type { V4Vals } from "../use-v4-preview";
import { STATUS_LABEL, TONE } from "../mock-data";
import { aparelhoLabel, osMatchesQuery, resolverStatusV4 } from "../os-adapter";
import { isOrcamentoPreOsAtivoV4, lerComercialV4, STATUS_COMERCIAL_LABEL_V4 } from "@/lib/operacoes-v4/orcamento-pre-os";

export function OSPicker({ v }: { v: V4Vals }) {
  const [q, setQ] = useState("");

  const filtradas = useMemo(() => v.ordens.filter((o) => osMatchesQuery(o, q)), [v.ordens, q]);

  const carregandoInicial = v.ordensPrimeiraCarga && v.ordensLoading;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        background: "var(--background)",
        padding: 24,
        overflowY: "auto",
      }}
    >
      <div style={{ width: "100%", maxWidth: 560, marginTop: 8 }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 15,
              background: C.primaryBg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 25,
              margin: "0 auto 14px",
            }}
          >
            📋
          </div>
          <h2 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700, color: C.ink, letterSpacing: "-.01em" }}>
            Selecione uma Ordem de Serviço
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
            Busque por Nº da OS, cliente, aparelho ou IMEI — ou abra um novo atendimento.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por Nº da OS, cliente, aparelho ou IMEI…"
            style={{
              flex: 1,
              minWidth: 0,
              height: 38,
              padding: "0 12px",
              border: `1px solid ${C.inputBd}`,
              background: C.surface,
              color: C.body,
              borderRadius: 9,
              fontSize: 13,
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={v.openNovoAtendimento}
            style={{ height: 38, padding: "0 16px", border: "none", background: C.primary, color: C.white, borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flex: "none" }}
          >
            + Novo
          </button>
        </div>

        {/* Estados */}
        {carregandoInicial ? (
          <Mensagem texto="Carregando ordens de serviço…" />
        ) : v.ordensError ? (
          <div style={{ textAlign: "center", padding: "28px 12px" }}>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: C.dangerFg }}>{v.ordensError}</p>
            <button
              type="button"
              onClick={v.reloadOrdens}
              style={{ height: 34, padding: "0 16px", border: `1px solid ${C.inputBd}`, background: C.surface, color: C.body, borderRadius: 9, fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}
            >
              Tentar novamente
            </button>
          </div>
        ) : v.ordens.length === 0 ? (
          <Mensagem texto="Nenhuma ordem de serviço cadastrada nesta loja." />
        ) : filtradas.length === 0 ? (
          <Mensagem texto="Nenhuma OS corresponde à busca." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 11, color: C.subtle, fontWeight: 600, padding: "0 2px 2px" }}>
              {filtradas.length} {filtradas.length === 1 ? "ordem" : "ordens"}
            </div>
            {filtradas.slice(0, 100).map((o) => {
              const status = resolverStatusV4(o);
              const tone = TONE[status] || TONE.em_execucao;
              const aparelho = aparelhoLabel(o);
              const imei = (o.equipamento?.numeroSerie ?? "").trim();
              const comercial = lerComercialV4(o);
              const preOs = isOrcamentoPreOsAtivoV4(o);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => v.selectOS(o)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    textAlign: "left",
                    border: `1px solid ${C.line}`,
                    background: C.surface,
                    borderRadius: 10,
                    padding: "10px 12px",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: "nowrap" }}>
                        {(o.codigo ?? "").trim() || "OS"}
                      </span>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          height: 18,
                          padding: "0 7px",
                          background: tone.bg,
                          color: tone.fg,
                          borderRadius: 999,
                          fontSize: 10.5,
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: tone.dot }} />
                        {preOs ? STATUS_COMERCIAL_LABEL_V4[comercial!.statusComercial] : STATUS_LABEL[status] || status}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: C.body, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {(o.cliente?.nome ?? "").trim() || "Cliente não informado"}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {aparelho}
                      {imei ? ` · IMEI ${imei}` : ""}
                    </div>
                  </div>
                  <span style={{ color: C.subtle, fontSize: 16, flex: "none" }}>›</span>
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
          <button
            type="button"
            onClick={v.railFila}
            style={{ height: 34, padding: "0 16px", border: `1px solid ${C.inputBd}`, background: "transparent", color: C.muted, borderRadius: 9, fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}
          >
            Ver fila completa
          </button>
        </div>
      </div>
    </div>
  );
}

function Mensagem({ texto }: { texto: string }) {
  return (
    <div style={{ textAlign: "center", padding: "28px 12px" }}>
      <p style={{ margin: 0, fontSize: 13, color: C.muted }}>{texto}</p>
    </div>
  );
}
