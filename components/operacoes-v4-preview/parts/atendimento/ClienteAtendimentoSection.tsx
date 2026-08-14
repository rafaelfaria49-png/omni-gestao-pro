"use client";

import { C } from "../../tokens";
import { useClienteSearchV4, type ClienteV4 } from "../../use-clientes-v4";
import {
  ORIGEM_ATENDIMENTO_COMERCIAL_V4,
  type ClienteAtendimentoStateV4,
  type OrigemAtendimentoComercialV4,
} from "@/lib/operacoes-v4/atendimento-comercial";
import { atendInput, atendLabel } from "./field-styles";

export function ClienteAtendimentoSection({
  storeId,
  value,
  onChange,
  origem,
  onOrigemChange,
  permitirBalcao = false,
}: {
  storeId: string | null;
  value: ClienteAtendimentoStateV4;
  onChange: (next: ClienteAtendimentoStateV4) => void;
  origem?: OrigemAtendimentoComercialV4;
  onOrigemChange?: (o: OrigemAtendimentoComercialV4) => void;
  permitirBalcao?: boolean;
}) {
  const search = useClienteSearchV4(value.modo === "existente" ? storeId : null);
  const modos = [
    ...(permitirBalcao ? (["balcao"] as const) : []),
    "existente",
    "novo",
  ] as const;

  const tab = (active: boolean) => ({
    height: 28,
    padding: "0 14px",
    border: "none",
    background: active ? C.surface : "transparent",
    color: active ? C.primaryHover : C.muted,
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer" as const,
  });

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", gap: 3, padding: 3, background: C.muted100, borderRadius: 9, marginBottom: 12, width: "fit-content" }}>
        {modos.map((m) => (
          <button key={m} type="button" onClick={() => onChange({ ...value, modo: m })} style={tab(value.modo === m)}>
            {m === "balcao" ? "Cliente balcão" : m === "existente" ? "Existente" : "Novo"}
          </button>
        ))}
      </div>

      {value.modo === "balcao" ? (
        <div style={{ border: `1px dashed ${C.inputBd}`, borderRadius: 9, padding: "10px 12px", fontSize: 12, color: C.subtle, lineHeight: 1.5, marginBottom: 12 }}>
          Atendimento sem identificação — registrado como Cliente Balcão.
        </div>
      ) : null}

      {value.modo === "existente" ? (
        value.existente ? (
          <div style={{ border: `1px solid ${C.primaryBd}`, background: C.primaryBg, borderRadius: 9, padding: "11px 12px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {value.existente.nome || "Cliente"}
              </span>
              <button type="button" onClick={() => onChange({ ...value, existente: null })} style={{ height: 24, padding: "0 10px", border: `1px solid ${C.primaryBd}`, background: C.surface, color: C.primaryHover, borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>
                Trocar
              </button>
            </div>
            <div style={{ fontSize: 11.5, color: C.subtle, marginTop: 4, lineHeight: 1.45 }}>
              {[
                value.existente.telefone ? `WhatsApp ${value.existente.telefone}` : null,
                value.existente.documento ? `CPF/CNPJ ${value.existente.documento}` : null,
                value.existente.email,
              ]
                .filter(Boolean)
                .join(" · ") || "Sem contato cadastrado"}
            </div>
          </div>
        ) : (
          <BuscaCliente search={search} onSelect={(c) => onChange({ ...value, existente: c })} />
        )
      ) : null}

      {value.modo === "novo" ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10, marginBottom: 12 }}>
          <div>
            <div style={atendLabel}>Nome *</div>
            <input value={value.novo.nome} onChange={(e) => onChange({ ...value, novo: { ...value.novo, nome: e.target.value } })} maxLength={120} placeholder="Nome do cliente" style={atendInput} autoComplete="off" />
          </div>
          <div>
            <div style={atendLabel}>WhatsApp / telefone</div>
            <input value={value.novo.telefone} onChange={(e) => onChange({ ...value, novo: { ...value.novo, telefone: e.target.value } })} maxLength={20} placeholder="(11) 90000-0000" style={atendInput} autoComplete="off" />
          </div>
          <div>
            <div style={atendLabel}>CPF/CNPJ</div>
            <input value={value.novo.documento} onChange={(e) => onChange({ ...value, novo: { ...value.novo, documento: e.target.value } })} maxLength={20} placeholder="opcional" style={atendInput} autoComplete="off" />
          </div>
          <div>
            <div style={atendLabel}>E-mail</div>
            <input value={value.novo.email} onChange={(e) => onChange({ ...value, novo: { ...value.novo, email: e.target.value } })} maxLength={120} placeholder="opcional" style={atendInput} autoComplete="off" />
          </div>
        </div>
      ) : null}

      {origem && onOrigemChange ? (
        <div>
          <div style={{ ...atendLabel, marginBottom: 6 }}>Origem do atendimento</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {ORIGEM_ATENDIMENTO_COMERCIAL_V4.map((o) => {
              const sel = origem === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => onOrigemChange(o.key)}
                  style={{
                    height: 28,
                    padding: "0 11px",
                    border: `1px solid ${sel ? C.primaryBd : C.inputBd}`,
                    background: sel ? C.primaryBg : C.surface,
                    color: sel ? C.primaryHover : C.muted,
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BuscaCliente({
  search,
  onSelect,
}: {
  search: ReturnType<typeof useClienteSearchV4>;
  onSelect: (c: ClienteV4) => void;
}) {
  const box = { border: `1px dashed ${C.inputBd}`, borderRadius: 9, padding: "14px 12px", textAlign: "center" as const, fontSize: 11.5, color: C.subtle, lineHeight: 1.5 };
  return (
    <div style={{ marginBottom: 12 }}>
      <input value={search.query} onChange={(e) => search.setQuery(e.target.value)} placeholder="Buscar por nome, telefone ou documento…" style={{ ...atendInput, height: 34, marginBottom: 8 }} autoComplete="off" />
      {search.semLoja ? <div style={box}>Selecione uma loja ativa para buscar clientes da base real.</div>
        : search.error ? <div style={{ ...box, borderStyle: "solid", color: C.dangerFg, borderColor: C.dangerBd }}>{search.error}</div>
        : search.loading ? <div style={box}>Buscando clientes…</div>
        : search.termoCurto || (!search.buscou && search.query.trim() === "") ? <div style={box}>Digite ao menos 2 caracteres para buscar na base real da loja.</div>
        : search.buscou && search.clientes.length === 0 ? <div style={box}>Nenhum cliente encontrado para “{search.query.trim()}”.</div>
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
            {search.clientes.map((c) => (
              <button key={c.id} type="button" onClick={() => onSelect(c)} style={{ display: "flex", flexDirection: "column", gap: 2, width: "100%", textAlign: "left", border: `1px solid ${C.line}`, background: C.surface, borderRadius: 9, padding: "9px 11px", cursor: "pointer" }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>{c.nome || "Cliente sem nome"}</span>
                <span style={{ fontSize: 11, color: C.muted }}>{[c.telefone, c.documento, c.email].filter(Boolean).join(" · ") || "Sem contato cadastrado"}</span>
              </button>
            ))}
          </div>
        )}
    </div>
  );
}
