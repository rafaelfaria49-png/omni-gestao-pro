/**
 * Operações V4 Preview — telas de módulo do rail (Visão geral, Fila, Bancada, SLA, PDV).
 *
 * Cada módulo tem IDENTIDADE PRÓPRIA e lê dados REAIS (somente leitura) da lista de OS
 * já carregada da loja ativa (`v.*` derivados de `listOrdens`). Quando não há base real
 * para aquele módulo, exibe um estado vazio ESPECÍFICO e honesto — nunca cliente, OS,
 * técnico, SLA ou número fabricado. Clicar numa OS abre o Workspace real dela.
 */
import { C, card } from "../tokens";
import type { V4Vals } from "../use-v4-preview";
import type { RailOsRow } from "../rails-adapter";

/** O módulo tem dado real para mostrar? (governa o selo do cabeçalho). */
function moduleTemDados(v: V4Vals): boolean {
  switch (v.moduleId) {
    case "dashboard":
      return v.dashboardResumo.temDados;
    case "fila":
      return v.filaItens.length > 0;
    case "bancada":
      return v.producaoBancada.temProducao;
    case "sla":
      return v.slaView.temDados;
    case "pdv":
      return v.pdvView.temDados;
    default:
      return false;
  }
}

export function ModuleView({ v }: { v: V4Vals }) {
  const temDados = moduleTemDados(v);
  const carregandoInicial = v.ordensPrimeiraCarga && v.ordensLoading;

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--background)" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, height: 46, padding: "0 18px", background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 18 }}>{v.mod.icon}</span>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--foreground)" }}>{v.mod.title}</h1>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 23,
            padding: "0 10px",
            background: temDados ? C.primaryBg : C.warnBg,
            color: temDados ? C.primaryHover : C.warnFg,
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {temDados ? "Somente leitura" : "Protótipo"}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={v.railWorkspace} style={{ height: 30, padding: "0 12px", border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: "pointer" }}>Abrir OS Workspace →</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px" }}>
        {carregandoInicial ? (
          <Mensagem texto="Carregando ordens de serviço…" />
        ) : v.ordensError ? (
          <div style={{ textAlign: "center", padding: "28px 12px" }}>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: C.dangerFg }}>{v.ordensError}</p>
            <button type="button" onClick={v.reloadOrdens} style={{ height: 34, padding: "0 16px", border: `1px solid ${C.inputBd}`, background: C.surface, color: C.body, borderRadius: 9, fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>Tentar novamente</button>
          </div>
        ) : (
          <Body v={v} />
        )}
      </div>
    </div>
  );
}

function Body({ v }: { v: V4Vals }) {
  switch (v.moduleId) {
    case "dashboard":
      return <DashboardBody v={v} />;
    case "fila":
      return <FilaBody v={v} />;
    case "bancada":
      return null;
    case "sla":
      return <SlaBody v={v} />;
    case "pdv":
      return <PdvBody v={v} />;
    default:
      return <EmptyBox titulo="Módulo indisponível" texto="Esta visão não está disponível nesta Preview." />;
  }
}

// ---- Visão geral -----------------------------------------------------------

function DashboardBody({ v }: { v: V4Vals }) {
  const r = v.dashboardResumo;
  if (!r.temDados) {
    return <EmptyBox titulo="Visão geral" texto="Nenhuma base operacional disponível para resumo nesta Preview." />;
  }
  return (
    <div style={{ maxWidth: 880, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 12 }}>
        <Kpi label="Total de OS" valor={r.total} />
        <Kpi label="Ativas (em andamento)" valor={r.ativos} />
        {r.temSla ? (
          <Kpi label="Atrasadas (SLA)" valor={r.atrasadas} tone={r.atrasadas > 0 ? "danger" : "neutro"} />
        ) : (
          <KpiTexto label="Atrasadas (SLA)" texto="SLA não configurado" />
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10 }}>
        {r.buckets.map((b) => (
          <div key={b.key} style={{ ...card, padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: C.ink, lineHeight: 1 }}>{b.count}</span>
            <span style={{ fontSize: 11.5, color: C.muted }}>{b.label}</span>
          </div>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 11.5, color: C.subtle, lineHeight: 1.5 }}>
        Resumo somente leitura da loja ativa. Abra uma OS na Fila ou no Workspace para ver os dados completos.
      </p>
    </div>
  );
}

// ---- Fila ------------------------------------------------------------------

function FilaBody({ v }: { v: V4Vals }) {
  if (v.filaItens.length === 0) {
    return <EmptyBox titulo="Fila de OS" texto="Nenhuma OS aberta ou em andamento na fila desta loja." />;
  }
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11.5, color: C.subtle, fontWeight: 600 }}>
        {v.filaItens.length} {v.filaItens.length === 1 ? "OS na fila" : "OS na fila"} · clique para abrir o Workspace
      </div>
      {v.filaItens.map((row) => (
        <RailRow key={row.id} row={row} onClick={() => v.openOSFromRail(row.id)} />
      ))}
    </div>
  );
}

// ---- SLA -------------------------------------------------------------------

function SlaBody({ v }: { v: V4Vals }) {
  const s = v.slaView;
  if (!s.temDados) {
    return (
      <EmptyBox
        titulo="SLA & atrasos"
        texto="SLA real ainda não está configurado para esta visão."
        sub="Nenhuma OS desta loja tem prazo/SLA registrado. Quando houver, as OS atrasadas e vencendo aparecem aqui — sem inventar prazos."
      />
    );
  }
  const semPendencia = s.atrasadas.length === 0 && s.vencendo.length === 0;
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      {s.atrasadas.length > 0 && (
        <SlaSecao titulo="Atrasadas" cor={C.dangerFg} count={s.atrasadas.length}>
          {s.atrasadas.map((row) => (
            <RailRow key={row.id} row={row} onClick={() => v.openOSFromRail(row.id)} />
          ))}
        </SlaSecao>
      )}
      {s.vencendo.length > 0 && (
        <SlaSecao titulo="Vencendo (atenção)" cor={C.warnFg} count={s.vencendo.length}>
          {s.vencendo.map((row) => (
            <RailRow key={row.id} row={row} onClick={() => v.openOSFromRail(row.id)} />
          ))}
        </SlaSecao>
      )}
      <p style={{ margin: 0, fontSize: 12, color: C.muted }}>
        {semPendencia ? "Nenhuma OS atrasada ou vencendo. " : ""}
        {s.noPrazo} {s.noPrazo === 1 ? "OS no prazo" : "OS no prazo"}.
      </p>
    </div>
  );
}

function SlaSecao({ titulo, cor, count, children }: { titulo: string; cor: string; count: number; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: cor }}>{titulo}</span>
        <span style={{ fontSize: 12, color: C.muted }}>· {count}</span>
      </div>
      {children}
    </div>
  );
}

// ---- PDV de serviço --------------------------------------------------------

function PdvBody({ v }: { v: V4Vals }) {
  const p = v.pdvView;
  if (v.pdvFinancialLoading) return <Mensagem texto="Carregando projeções financeiras…" />;
  if (v.pdvFinancialError) {
    return <EmptyBox titulo="Financeiro indisponível" texto={v.pdvFinancialError} sub="Nenhum valor anterior foi mantido." />;
  }
  if (!p.temDados) {
    return (
      <EmptyBox
        titulo="PDV de serviço"
        texto="Nenhuma projeção financeira disponível para as OS desta loja."
        sub="Esta tela é somente leitura — não vende nem recebe."
      />
    );
  }
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, ...card, padding: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 11.5, color: C.muted }}>Total das OS com valor</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>{p.totalGeral}</span>
        </div>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "right" }}>
          <span style={{ fontSize: 11.5, color: C.muted }}>A receber</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: p.aReceberCount > 0 ? C.warnFg : C.muted }}>{p.aReceberCount}</span>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: C.subtle }}>Somente leitura · OS a receber abrem direto no Financeiro</div>
      {p.itens.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => v.openOSFromRail(it.id, true)}
          style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", border: `1px solid ${C.line}`, background: C.surface, borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{it.codigo}</span>
              <Pill tone={it.statusTone} texto={it.statusFaturamento} />
            </div>
            <div style={{ fontSize: 12.5, color: C.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.cliente}</div>
            {it.saldoLinha && <div style={{ fontSize: 11, color: C.subtle, marginTop: 1 }}>{it.saldoLinha}</div>}
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, flex: "none" }}>{it.total}</span>
        </button>
      ))}
    </div>
  );
}

// ---- compartilhados --------------------------------------------------------

function RailRow({ row, onClick }: { row: RailOsRow; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", border: `1px solid ${C.line}`, background: C.surface, borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: "nowrap" }}>{row.codigo}</span>
          <Pill tone={row.tone} texto={row.statusLabel} />
        </div>
        <div style={{ fontSize: 12.5, color: C.body, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.cliente}</div>
        <div style={{ fontSize: 11.5, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {row.aparelho}
          {row.previsao ? ` · prev. ${row.previsao}` : ""}
        </div>
      </div>
      <span style={{ color: C.subtle, fontSize: 16, flex: "none" }}>›</span>
    </button>
  );
}

function Pill({ tone, texto }: { tone: { bg: string; fg: string; dot: string }; texto: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 18, padding: "0 7px", background: tone.bg, color: tone.fg, borderRadius: 999, fontSize: 10.5, fontWeight: 600, whiteSpace: "nowrap" }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: tone.dot }} />
      {texto}
    </span>
  );
}

function Kpi({ label, valor, tone = "neutro" }: { label: string; valor: number; tone?: "neutro" | "danger" }) {
  return (
    <div style={{ ...card, padding: 14, display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: tone === "danger" ? C.dangerFg : C.ink }}>{valor}</span>
      <span style={{ fontSize: 12, color: C.muted }}>{label}</span>
    </div>
  );
}

function KpiTexto({ label, texto }: { label: string; texto: string }) {
  return (
    <div style={{ ...card, padding: 14, display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: C.subtle }}>{texto}</span>
      <span style={{ fontSize: 12, color: C.muted }}>{label}</span>
    </div>
  );
}

function EmptyBox({ titulo, texto, sub }: { titulo: string; texto: string; sub?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 32 }}>
      <div style={{ ...card, maxWidth: 480, textAlign: "center", padding: 26 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700, color: C.ink }}>{titulo}</h2>
        <p style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.55 }}>{texto}</p>
        {sub && <p style={{ margin: "10px 0 0", fontSize: 12, color: C.subtle, lineHeight: 1.5 }}>{sub}</p>}
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
