"use client";

import { C } from "../../tokens";
import { useServicosV4, type ServicoCatalogoV4 } from "../../use-servicos-v4";
import { atendInput, atendLabel } from "./field-styles";

export function ServicoCatalogLookup({
  storeId,
  onSelect,
}: {
  storeId: string | null;
  onSelect: (s: ServicoCatalogoV4) => void;
}) {
  const cat = useServicosV4(storeId);
  return (
    <div style={{ marginBottom: 10, minWidth: 0 }}>
      <div style={atendLabel}>Serviço</div>
      <input
        value={cat.query}
        onChange={(e) => cat.setQuery(e.target.value)}
        placeholder="Buscar serviço cadastrado..."
        style={{ ...atendInput, height: 34 }}
        autoComplete="off"
      />
      {cat.semLoja ? (
        <div style={{ fontSize: 11.5, color: C.subtle, marginTop: 6 }}>Selecione uma loja para ver o catálogo real.</div>
      ) : cat.error ? (
        <div style={{ fontSize: 11.5, color: C.dangerFg, marginTop: 6 }}>{cat.error}</div>
      ) : cat.loading ? (
        <div style={{ fontSize: 11.5, color: C.subtle, marginTop: 6 }}>Carregando serviços…</div>
      ) : cat.filtrados.length === 0 ? (
        <div style={{ fontSize: 11.5, color: C.subtle, marginTop: 6 }}>Nenhum serviço ativo encontrado.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8, maxHeight: 160, overflowY: "auto" }}>
          {cat.filtrados.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                width: "100%",
                textAlign: "left",
                border: `1px solid ${C.line}`,
                background: C.surface,
                borderRadius: 8,
                padding: "7px 10px",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 600, color: C.ink, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.nome}</span>
              <span style={{ fontSize: 11.5, color: C.subtle, flex: "none" }}>
                R$ {s.preco.toFixed(2)}
                {s.garantia > 0 ? ` · ${s.garantia}d` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
