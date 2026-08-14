/** Operações V4 Preview — barra superior (40px): marca, busca, modos, ações. */
import { C } from "../tokens";
import type { V4Vals } from "../use-v4-preview";
import { SearchIcon, FocusIcon } from "./icons";

export function TopBar({ v }: { v: V4Vals }) {
  return (
    <header
      style={{
        flex: "none",
        height: 40,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 12px",
        background: "var(--card)",
        borderBottom: "1px solid var(--border)",
        overflowX: "auto",
        overflowY: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 23,
            height: 23,
            borderRadius: 6,
            background: C.black,
            color: C.white,
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          O
        </span>
        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--foreground)" }}>OmniGestão</span>
        <span style={{ fontSize: 11.5, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>
          Operações <span style={{ color: C.primary, fontWeight: 600 }}>V4</span> · Beta operacional
        </span>
      </div>

      <button
        type="button"
        onClick={v.goToOSSearch}
        title="Buscar OS por Nº, cliente, aparelho ou IMEI"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flex: 1,
          minWidth: 0,
          maxWidth: 380,
          height: 28,
          padding: "0 11px",
          background: "var(--muted)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          color: "var(--muted-foreground)",
          fontSize: 12.5,
          cursor: "pointer",
        }}
      >
        <SearchIcon />
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          Ir para OS, cliente, IMEI…
        </span>
        <kbd
          style={{
            marginLeft: "auto",
            fontSize: 10,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "1px 5px",
            color: "var(--muted-foreground)",
            flex: "none",
          }}
        >
          ⌘K
        </kbd>
      </button>

      <button
        type="button"
        onClick={v.onFoco}
        title="Recolhe rail, Cliente e Atividade de uma vez"
        style={{
          flex: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 28,
          padding: "0 12px",
          border: `1px solid ${v.focusActive ? C.primary : C.primaryBd}`,
          background: v.focusActive ? C.primary : "var(--card)",
          color: v.focusActive ? C.white : C.primary,
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <FocusIcon />
        {v.focoLabel}
      </button>

      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
        <span style={{ fontSize: 11.5, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>Loja ativa</span>
        <button
          type="button"
          onClick={v.openNovoAtendimento}
          title="Novo atendimento — ordem de serviço, orçamento ou serviço de balcão"
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 28,
            padding: "0 12px",
            border: "none",
            background: C.primary,
            color: C.white,
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          + Novo
        </button>
      </div>
    </header>
  );
}
