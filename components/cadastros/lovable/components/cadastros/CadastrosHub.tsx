import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search, Plus, Upload, Users, Package, Wrench, Truck, HardHat, Smartphone,
  AlertTriangle, RefreshCw, LayoutDashboard, Tag, FileSpreadsheet, History,
  Sparkles, MessageCircle, ShoppingCart, Edit3, Eye, Trash2, ChevronRight,
  CheckCircle2, ArrowUpRight, Database, Filter, Download, Workflow, Barcode,
  ArrowRight,
} from "lucide-react";
import { Badge, Card, Field, Input, Modal, SectionTitle, Select, Textarea, useToggle } from "./ui-kit";
import { RoadmapPreviewDialog } from "@/components/ui/roadmap-preview-dialog";
import { ProductAIModal, QualityScore, InteligenciaCadastros } from "./produto-ia";
import { MovimentacaoEstoqueModal, HistoricoEstoqueGeralModal } from "./MovimentacaoEstoqueModal";
import { getEstoqueResumo, type EstoqueResumo } from "@/app/actions/estoque";
import { ImportacaoHub } from "./ImportacaoHub";
import { useLojaAtiva } from "@/lib/loja-ativa";
import {
  createCliente,
  getCadastrosDashboardStats,
  listCategorias,
  listEquipamentosModelos,
  listClientes,
  listFornecedores,
  listMarcas,
  listProdutosPaginado,
  listServicos,
  listTecnicos,
  listLogsAuditoriaCadastros,
  type AuditoriaItemDTO,
  type CategoriaCadastroDTO,
  type ClienteDTO,
  type EquipamentoModeloDTO,
  type FornecedorDTO,
  type MarcaCadastroDTO,
  type ProdutoDTO,
  type ServicoDTO,
  type TecnicoDTO,
  upsertCategoria,
  upsertEquipamentoModelo,
  upsertFornecedor,
  upsertMarca,
  upsertTecnico,
  updateCliente,
  upsertServico,
  upsertProduto,
  deleteProduto,
  getUltimoBatchProdutos,
  type DeleteProdutoResult,
} from "@/app/actions/cadastros";
import {
  catalogQualityScore,
  qualityScoreInputFromProduto,
} from "@/lib/cadastros/produto-quality-score";
import { getProdutoFiscal } from "@/lib/produto-fiscal";

const ICONS: Record<string, any> = {
  Users, Package, Wrench, Truck, HardHat, Smartphone, AlertTriangle, RefreshCw,
};

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "clientes", label: "Clientes", icon: Users },
  { id: "produtos", label: "Produtos", icon: Package },
  { id: "servicos", label: "Serviços", icon: Wrench },
  { id: "fornecedores", label: "Fornecedores", icon: Truck },
  { id: "tecnicos", label: "Técnicos", icon: HardHat },
  { id: "equipamentos", label: "Equipamentos", icon: Smartphone },
  { id: "categorias", label: "Categorias / Marcas", icon: Tag },
  { id: "importacao", label: "Importação", icon: FileSpreadsheet },
  { id: "auditoria", label: "Auditoria", icon: History },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function CadastrosHub() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [autoOpenNew, setAutoOpenNew] = useState<string | null>(null);
  const novo = useToggle();
  const { lojaAtivaId } = useLojaAtiva();
  const storeId = (lojaAtivaId ?? "").trim();  return (
    <div className="w-full min-w-0 max-w-full bg-background text-foreground transition-smooth">
      {/* HEADER INTEGRADO */}
      <header className="border-b border-border/60 bg-background pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-foreground">Cadastros HUB</h1>
              <Badge tone="primary">Premium</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Clientes, produtos, serviços, fornecedores e base operacional centralizada
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setTab("importacao");
                setAutoOpenNew(null);
              }}
              className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted/40 transition-smooth"
              title="Abrir HUB de Importação"
            >
              <Upload className="h-4 w-4" /> <span className="hidden md:inline">Importar</span>
            </button>
            <button
              onClick={novo.openIt}
              className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-smooth shadow-soft"
            >
              <Plus className="h-4 w-4" /> Novo cadastro
            </button>
          </div>
        </div>

        {/* TABS HORIZONTAIS DISCRETAS */}
        <nav className="mt-4 flex items-center gap-1 overflow-x-auto pb-1 scroll-elegant">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  setAutoOpenNew(null);
                }}
                className={[
                  "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-smooth border",
                  active
                    ? "bg-primary/8 border-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground border-transparent",
                ].join(" ")}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* CONTENT */}
      <main className="w-full min-w-0 pt-5">
        {tab === "dashboard" && (
          <DashboardPanel
            onAction={(targetTab, openNew) => {
              setTab(targetTab);
              if (openNew) {
                setAutoOpenNew(targetTab);
              } else {
                setAutoOpenNew(null);
              }
            }}
          />
        )}
        {tab === "clientes" && (
          <ClientesPanel
            storeId={storeId}
            autoOpen={autoOpenNew === "clientes"}
            onAutoOpenConsumed={() => setAutoOpenNew(null)}
          />
        )}
        {tab === "produtos" && (
          <ProdutosPanel
            storeId={storeId}
            autoOpen={autoOpenNew === "produtos"}
            onAutoOpenConsumed={() => setAutoOpenNew(null)}
          />
        )}
        {tab === "servicos" && (
          <ServicosPanel
            storeId={storeId}
            autoOpen={autoOpenNew === "servicos"}
            onAutoOpenConsumed={() => setAutoOpenNew(null)}
          />
        )}
        {tab === "fornecedores" && (
          <FornecedoresPanel
            storeId={storeId}
            autoOpen={autoOpenNew === "fornecedores"}
            onAutoOpenConsumed={() => setAutoOpenNew(null)}
          />
        )}
        {tab === "tecnicos" && (
          <TecnicosPanel
            storeId={storeId}
            autoOpen={autoOpenNew === "tecnicos"}
            onAutoOpenConsumed={() => setAutoOpenNew(null)}
          />
        )}
        {tab === "equipamentos" && (
          <EquipamentosPanel
            storeId={storeId}
            autoOpen={autoOpenNew === "equipamentos"}
            onAutoOpenConsumed={() => setAutoOpenNew(null)}
          />
        )}
        {tab === "categorias" && <CategoriasPanel storeId={storeId} />}
        {tab === "importacao" && <ImportacaoPanel />}
        {tab === "auditoria" && <AuditoriaPanel />}
      </main>

      <Modal open={novo.open} onClose={novo.close} title="Novo cadastro" subtitle="Selecione o tipo de registro que deseja criar.">
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
          {[
            { l: "Cliente", i: Users, tab: "clientes" as TabId, desc: "PF ou PJ" },
            { l: "Produto", i: Package, tab: "produtos" as TabId, desc: "Peças e mercadorias" },
            { l: "Serviço", i: Wrench, tab: "servicos" as TabId, desc: "Mão de obra" },
            { l: "Fornecedor", i: Truck, tab: "fornecedores" as TabId, desc: "Empresa ou autônomo" },
            { l: "Técnico", i: HardHat, tab: "tecnicos" as TabId, desc: "Membro da equipe" },
            { l: "Equipamento", i: Smartphone, tab: "equipamentos" as TabId, desc: "Modelo para OS" },
          ].map((x) => (
            <button
              key={x.l}
              onClick={() => {
                setTab(x.tab);
                setAutoOpenNew(x.tab);
                novo.close();
              }}
              className="group flex items-center gap-3 rounded-xl border border-border bg-background p-3.5 text-left transition-all hover:border-primary/60 hover:bg-primary/5 hover:shadow-sm active:scale-[0.98]"
            >
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
                <x.i className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground">{x.l}</div>
                <div className="truncate text-[11px] text-muted-foreground">{x.desc}</div>
              </div>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-primary/60" />
            </button>
          ))}
        </div>
      </Modal>

    </div>
  );
}

/* ───── DASHBOARD ───── */
function DashboardPanel({ onAction }: { onAction: (tabId: TabId, autoOpen?: boolean) => void }) {
  const quick = [
    { l: "Novo cliente", i: Users, tab: "clientes" as TabId, autoOpen: true },
    { l: "Novo produto", i: Package, tab: "produtos" as TabId, autoOpen: true },
    { l: "Novo serviço", i: Wrench, tab: "servicos" as TabId, autoOpen: true },
    { l: "Novo fornecedor", i: Truck, tab: "fornecedores" as TabId, autoOpen: true },
    { l: "Novo técnico", i: HardHat, tab: "tecnicos" as TabId, autoOpen: true },
    { l: "Importar planilha", i: Upload, tab: "importacao" as TabId, autoOpen: false },
    { l: "Revisar incompletos", i: AlertTriangle, tab: "produtos" as TabId, autoOpen: false },
  ];
  const { lojaAtivaId } = useLojaAtiva();
  const storeId = (lojaAtivaId ?? "").trim();
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getCadastrosDashboardStats>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    void (async () => {
      try {
        const s = await getCadastrosDashboardStats(storeId);
        if (!alive) return;
        setStats(s);
      } catch (e) {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : "Falha ao carregar indicadores");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [storeId]);

  return (
    <div className="w-full min-w-0 space-y-8">
      {loading && <div className="text-sm text-muted-foreground">Carregando indicadores…</div>}
      {err && <div className="text-sm text-destructive">{err}</div>}
      {/* KPIs */}
      <div className="grid min-w-0 grid-cols-2 gap-4 md:grid-cols-4">
        {(stats?.kpis ?? []).map((k) => {
          const Icon = ICONS[k.icon] ?? Package;
          const negative = k.delta.startsWith("-");
          const mapIconToTab = (icon: string): TabId | null => {
            switch (icon) {
              case "Users": return "clientes";
              case "Package": return "produtos";
              case "Wrench": return "servicos";
              case "Truck": return "fornecedores";
              case "HardHat": return "tecnicos";
              case "Smartphone": return "equipamentos";
              case "AlertTriangle": return "produtos";
              case "RefreshCw": return "auditoria";
              default: return null;
            }
          };
          const targetTab = mapIconToTab(k.icon);
          return (
            <Card
              key={k.label}
              className={`p-5 ${targetTab ? "cursor-pointer hover:border-primary hover:shadow-md transition" : ""}`}
              onClick={targetTab ? () => onAction(targetTab) : undefined}
            >
              <div className="flex items-center justify-between">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <Badge tone={negative ? "danger" : "success"}>{k.delta}</Badge>
              </div>
              <div className="mt-4 text-3xl font-bold text-foreground">{k.value.toLocaleString("pt-BR")}</div>
              <div className="text-xs text-muted-foreground">{k.label}</div>
            </Card>
          );
        })}
      </div>

      {/* Quick actions */}
      <div>
        <SectionTitle title="Cards rápidos" subtitle="Operações mais usadas em um clique." />
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7">
          {quick.map((q) => (
            <button
              key={q.l}
              onClick={() => onAction(q.tab, q.autoOpen)}
              className="group flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition hover:border-primary hover:ring-primary-glow w-full"
            >
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
                <q.i className="h-4 w-4" />
              </div>
              <div className="text-sm font-medium text-foreground">{q.l}</div>
              <ArrowUpRight className="ml-auto h-4 w-4 text-muted-foreground group-hover:text-primary" />
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-3">
        {/* Saúde */}
        <Card className="p-6 lg:col-span-2">
          <SectionTitle title="Saúde dos cadastros" subtitle="Indicadores de completude por entidade." />
          <div className="space-y-4">
            {(stats?.saude ?? []).map((s) => (
              <div key={s.label}>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="text-foreground">{s.label}</span>
                  <span className="font-semibold text-foreground">{s.value}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${s.value}%`,
                      background: s.value >= 90
                        ? "var(--success)"
                        : s.value >= 75
                        ? "var(--primary)"
                        : "var(--warning)",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Sugestões reais derivadas do banco (sem dados fake) */}
        <Card className="p-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">Sugestões de melhoria</h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Itens reais da base que precisam de atenção.</p>
          {(() => {
            const a = stats?.produtoAlerts;
            const ia = stats?.ia;
            const insights: string[] = [];
            if (a) {
              if (a.semPreco > 0) insights.push(`${a.semPreco} produto(s) sem preço de venda`);
              if (a.semFornecedor > 0) insights.push(`${a.semFornecedor} produto(s) sem fornecedor`);
              if (a.margemBaixa > 0) insights.push(`${a.margemBaixa} produto(s) com margem abaixo de 20%`);
              if (a.estoqueBaixo > 0) insights.push(`${a.estoqueBaixo} produto(s) com estoque baixo (1–5 un)`);
            }
            if (ia) {
              if (ia.duplicadosEncontrados > 0) insights.push(`${ia.duplicadosEncontrados} possível(is) duplicado(s) por documento/SKU`);
              if (ia.produtosSemImagem > 0) insights.push(`${ia.produtosSemImagem} produto(s) sem imagem`);
            }
            if (loading) {
              return <div className="mt-4 text-sm text-muted-foreground">Analisando base…</div>;
            }
            if (insights.length === 0) {
              return (
                <div className="mt-4 flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--success)]" />
                  <span className="text-foreground">Base de cadastros saudável — nenhum item pendente.</span>
                </div>
              );
            }
            return (
              <ul className="mt-4 space-y-3 text-sm">
                {insights.slice(0, 5).map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--warning)]" />
                    <span className="text-foreground">{t}</span>
                  </li>
                ))}
              </ul>
            );
          })()}
          <button
            onClick={() => onAction("produtos")}
            className="mt-5 w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Revisar produtos
          </button>
        </Card>
      </div>

      <InteligenciaCadastros stats={stats?.ia} />
      <VinculosSistema />
    </div>
  );
}

function VinculosSistema() {
  const flows = [
    { l: "Cliente → OS → Garantia → WhatsApp", c: "info" as const },
    { l: "Produto → Estoque → PDV → Financeiro", c: "primary" as const },
    { l: "Serviço → OS → Garantia → Marketing IA", c: "success" as const },
    { l: "Fornecedor → Produto → Compra → Custo", c: "warning" as const },
    { l: "Modelo → Peça compatível → Diagnóstico IA", c: "info" as const },
  ];
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2">
        <Workflow className="h-5 w-5 text-primary" />
        <SectionTitle title="Vínculos do sistema" subtitle="Como os cadastros se conectam entre os módulos." />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {flows.map((f) => (
          <div key={f.l} className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-background p-4">
            <Badge tone={f.c}>Fluxo</Badge>
            <span className="min-w-0 truncate text-sm text-foreground">{f.l}</span>
            <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ───── TABLE TOOLBAR ───── */
function Toolbar({
  count,
  label,
  onNew,
  filterQuery,
  onFilterQueryChange,
  onFilterClick,
}: {
  count: number;
  label: string;
  onNew?: () => void;
  filterQuery?: string;
  onFilterQueryChange?: (v: string) => void;
  onFilterClick?: () => void;
}) {
  const [activeRoadmap, setActiveRoadmap] = useState<"filtros" | "exportar" | null>(null);

  return (
    <>
      <div className="mb-4 flex min-w-0 flex-wrap items-center gap-2">
        {onFilterQueryChange && (
          <div className="relative min-w-0 max-w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              placeholder={`Buscar em ${label.toLowerCase()}…`}
              value={filterQuery ?? ""}
              onChange={(e) => onFilterQueryChange?.(e.target.value)}
              className="w-64 max-w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}
        <button
          onClick={onFilterClick ? onFilterClick : () => setActiveRoadmap("filtros")}
          title={onFilterClick ? "Filtrar listagem" : "Ver Roadmap de Filtros"}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all duration-200 ${
            onFilterClick
              ? "border-primary/20 bg-primary/5 text-primary hover:bg-primary/10"
              : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Filter className="h-4 w-4" /> Filtros
        </button>
        <button
          onClick={() => setActiveRoadmap("exportar")}
          title="Ver Roadmap de Exportação"
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-200"
        >
          <Download className="h-4 w-4" /> Exportar
        </button>
        <span className="ml-auto text-sm text-muted-foreground">{count} {label}</span>
        {onNew && (
          <button onClick={onNew} className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> Novo
          </button>
        )}
      </div>

      {activeRoadmap === "filtros" && (
        <RoadmapPreviewDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setActiveRoadmap(null);
          }}
          title="Filtros Avançados Inteligentes"
          description="Filtre grandes volumes de cadastros cruzando tags, datas de movimentação, indicadores de compra e status operacionais em tempo real."
          phase="planejado"
          icon={Filter}
          features={[
            "Filtros por múltiplos status e tags simultâneos",
            "Busca por data de cadastro e última interação",
            "Salvamento de visões personalizadas (Smart Views)",
          ]}
          targetRelease="Fase 3 - Relatórios & Smart Views"
        />
      )}

      {activeRoadmap === "exportar" && (
        <RoadmapPreviewDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setActiveRoadmap(null);
          }}
          title="Exportação Multi-Formato"
          description="Exporte relatórios de cadastros completos em formatos Excel (XLSX), CSV e JSON com controle de colunas e permissões de segurança."
          phase="desenvolvimento"
          icon={Download}
          features={[
            "Exportação otimizada para planilhas eletrônicas",
            "Configuração de colunas visíveis no arquivo final",
            "Logs de segurança registrando quem realizou a exportação",
          ]}
          targetRelease="Fase 2 - Segurança & Compliance"
        />
      )}
    </>
  );
}

/* ───── helpers de máscara de documento ───── */
function maskCPF(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}
function maskCNPJ(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 14);
  return d
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}
function applyDocMask(v: string, tipo: "PF" | "PJ"): string {
  return tipo === "PF" ? maskCPF(v) : maskCNPJ(v);
}

/* ───── CLIENTES ───── */
function ClientesPanel({
  storeId,
  autoOpen,
  onAutoOpenConsumed,
}: {
  storeId: string;
  autoOpen?: boolean;
  onAutoOpenConsumed?: () => void;
}) {
  const m = useToggle();
  const [editing, setEditing] = useState<ClienteDTO | null>(null);
  const [rows, setRows] = useState<ClienteDTO[]>([]);
  const [filterQuery, setFilterQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [tipoSelecionado, setTipoSelecionado] = useState<"PF" | "PJ">("PF");
  const [docValue, setDocValue] = useState("");
  const nomeRef = useRef<HTMLInputElement | null>(null);
  const telRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const enderecoRef = useRef<HTMLInputElement | null>(null);
  const cidadeRef = useRef<HTMLInputElement | null>(null);
  const ufRef = useRef<HTMLInputElement | null>(null);
  const tagsRef = useRef<HTMLInputElement | null>(null);
  const observacoesRef = useRef<HTMLTextAreaElement | null>(null);
  const statusRef = useRef<HTMLSelectElement | null>(null);

  // Estados de filtros avançados
  const [showFilters, setShowFilters] = useState(false);
  const [tipoFilter, setTipoFilter] = useState("todos");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [tagFilter, setTagFilter] = useState("todos");

  // Estado de ordenação
  const [sortConfig, setSortConfig] = useState<{ field: string; direction: "asc" | "desc" } | undefined>(undefined);

  // Estados de seleção em lote
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkCheckResults, setBulkCheckResults] = useState<any[]>([]);
  const [bulkChecking, setBulkChecking] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [bulkActionSelected, setBulkActionSelected] = useState<"delete" | "inactivate">("inactivate");
  const [bulkConfirmText, setBulkConfirmText] = useState("");

  useEffect(() => {
    if (autoOpen) {
      m.openIt();
      onAutoOpenConsumed?.();
    }
  }, [autoOpen, onAutoOpenConsumed, m]);

  const refresh = useMemo(
    () => async () => {
      setLoading(true);
      setErr(null);
      try {
        const data = await listClientes(storeId);
        setRows(data);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Falha ao carregar clientes");
      } finally {
        setLoading(false);
      }
    },
    [storeId]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Sincroniza tipo e documento com o cliente editado ao abrir/fechar o modal
  useEffect(() => {
    if (m.open) {
      const tipo = editing?.tipo ?? "PF";
      setTipoSelecionado(tipo);
      const rawDoc = editing?.documento === "—" ? "" : (editing?.documento ?? "");
      setDocValue(applyDocMask(rawDoc, tipo));
    } else {
      setTipoSelecionado("PF");
      setDocValue("");
    }
  }, [m.open, editing]);

  // Reseta seleção em lote ao mudar filtros ou busca
  useEffect(() => {
    setSelectedClientIds(new Set());
  }, [filterQuery, tipoFilter, statusFilter, tagFilter, sortConfig]);

  // Extrai todas as tags únicas dos clientes carregados
  const todasTags = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((c) => {
      if (Array.isArray(c.tags)) {
        c.tags.forEach((t) => set.add(t));
      }
    });
    return Array.from(set);
  }, [rows]);

  // Filtra e ordena localmente os clientes
  const sortedAndFilteredRows = useMemo(() => {
    let result = rows;

    const q = filterQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((c) => {
        const blob = [c.nome, c.telefone, c.documento, c.cidade].join(" ").toLowerCase();
        return blob.includes(q);
      });
    }

    if (tipoFilter !== "todos") {
      result = result.filter((c) => c.tipo === tipoFilter);
    }

    if (statusFilter !== "todos") {
      result = result.filter((c) => c.status === statusFilter);
    }

    if (tagFilter !== "todos") {
      result = result.filter((c) => c.tags.includes(tagFilter));
    }

    if (sortConfig) {
      const { field, direction } = sortConfig;
      result = [...result].sort((a, b) => {
        let valA: any = "";
        let valB: any = "";

        if (field === "nome") {
          valA = a.nome;
          valB = b.nome;
        } else if (field === "tipo") {
          valA = a.tipo;
          valB = b.tipo;
        } else if (field === "telefone") {
          valA = a.telefone;
          valB = b.telefone;
        } else if (field === "documento") {
          valA = a.documento;
          valB = b.documento;
        } else if (field === "cidade") {
          valA = a.cidade;
          valB = b.cidade;
        } else if (field === "totalGasto") {
          valA = a.totalGasto;
          valB = b.totalGasto;
        } else if (field === "ultimaCompra") {
          valA = a.ultimaCompra;
          valB = b.ultimaCompra;
        } else if (field === "status") {
          valA = a.status;
          valB = b.status;
        }

        if (valA < valB) return direction === "asc" ? -1 : 1;
        if (valA > valB) return direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [rows, filterQuery, tipoFilter, statusFilter, tagFilter, sortConfig]);

  const handleSort = (field: string) => {
    setSortConfig((curr) => {
      if (!curr || curr.field !== field) {
        return { field, direction: "asc" };
      }
      if (curr.direction === "asc") {
        return { field, direction: "desc" };
      }
      return undefined;
    });
  };

  const renderSortArrow = (field: string) => {
    if (!sortConfig || sortConfig.field !== field) return <span className="text-muted-foreground/30 text-[10px]">▲▼</span>;
    return sortConfig.direction === "asc" ? <span className="text-primary text-[10px]">▲</span> : <span className="text-primary text-[10px]">▼</span>;
  };

  const handleBulkInactivate = async () => {
    if (selectedClientIds.size === 0) return;
    if (!window.confirm(`Tem certeza que deseja inativar os ${selectedClientIds.size} clientes selecionados?`)) return;

    setBulkActionLoading(true);
    try {
      const res = await fetch("/api/clientes/bulk-action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-assistec-loja-id": storeId,
        },
        body: JSON.stringify({
          ids: Array.from(selectedClientIds),
          action: "inactivate",
          userLabel: "Administrador",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao inativar clientes");

      toast.success(`${data.inactivated} cliente(s) inativados com sucesso.`);
      setSelectedClientIds(new Set());
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedClientIds.size === 0) return;
    setBulkChecking(true);
    setBulkModalOpen(true);
    setBulkConfirmText("");
    setBulkActionSelected("inactivate");
    try {
      const res = await fetch("/api/clientes/bulk-check-dependencies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-assistec-loja-id": storeId,
        },
        body: JSON.stringify({
          ids: Array.from(selectedClientIds),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao verificar dependências");
      setBulkCheckResults(data.results || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao verificar vínculos");
      setBulkModalOpen(false);
    } finally {
      setBulkChecking(false);
    }
  };

  const executeBulkAction = async () => {
    if (bulkConfirmText.toUpperCase() !== "EXCLUIR") {
      toast.error("Por favor, digite EXCLUIR para confirmar");
      return;
    }
    setBulkActionLoading(true);
    try {
      let idsToProcess = Array.from(selectedClientIds);
      if (bulkActionSelected === "inactivate") {
        // Envia todos os ids
      } else {
        const linkedIds = bulkCheckResults.filter((r) => r.isLinked).map((r) => r.id);
        idsToProcess = idsToProcess.filter((id) => !linkedIds.includes(id));
      }

      if (idsToProcess.length === 0) {
        toast.info("Nenhum cliente livre para exclusão");
        setBulkModalOpen(false);
        return;
      }

      const res = await fetch("/api/clientes/bulk-action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-assistec-loja-id": storeId,
        },
        body: JSON.stringify({
          ids: idsToProcess,
          action: "delete",
          userLabel: "Administrador",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao executar ação em lote");

      toast.success(
        `Sucesso: ${data.deleted} cliente(s) excluídos permanentemente e ${data.inactivated} cliente(s) inativados.`
      );
      setSelectedClientIds(new Set());
      setBulkModalOpen(false);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao executar lote");
    } finally {
      setBulkActionLoading(false);
    }
  };

  return (
    <div className="w-full min-w-0">
      <Toolbar
        count={sortedAndFilteredRows.length}
        label="clientes"
        onNew={m.openIt}
        filterQuery={filterQuery}
        onFilterQueryChange={setFilterQuery}
        onFilterClick={() => setShowFilters(!showFilters)}
      />

      {showFilters && (
        <Card className="mb-4 bg-muted/20 border border-border/80 p-4 transition-all animate-fade-in">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Tipo de Pessoa">
              <Select value={tipoFilter} onChange={(e: any) => setTipoFilter(e.target.value)}>
                <option value="todos">Todos</option>
                <option value="PF">PF — Pessoa Física</option>
                <option value="PJ">PJ — Pessoa Jurídica</option>
              </Select>
            </Field>
            <Field label="Status">
              <Select value={statusFilter} onChange={(e: any) => setStatusFilter(e.target.value)}>
                <option value="todos">Todos</option>
                <option value="Ativo">Ativo</option>
                <option value="Inativo">Inativo</option>
              </Select>
            </Field>
            <Field label="Tags">
              <Select value={tagFilter} onChange={(e: any) => setTagFilter(e.target.value)}>
                <option value="todos">Todas</option>
                {todasTags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => {
                setTipoFilter("todos");
                setStatusFilter("todos");
                setTagFilter("todos");
              }}
              className="text-xs text-muted-foreground hover:text-foreground font-medium transition"
            >
              Limpar Filtros
            </button>
          </div>
        </Card>
      )}

      {loading && <div className="mb-3 text-sm text-muted-foreground">Carregando clientes…</div>}
      {err && <div className="mb-3 text-sm text-destructive">{err}</div>}
      
      {!loading && !err && sortedAndFilteredRows.length === 0 && (
        <Card className="mb-4 border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Nenhum cliente corresponde aos filtros e busca ativos.
        </Card>
      )}

      {!loading && !err && sortedAndFilteredRows.length > 0 && (
        <Card className="overflow-hidden relative">
          <div className="w-full min-w-0 max-w-full overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-muted-foreground select-none">
                <tr>
                  <th className="px-4 py-3 text-left w-12">
                    <Checkbox
                      checked={sortedAndFilteredRows.length > 0 && selectedClientIds.size === sortedAndFilteredRows.length}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedClientIds(new Set(sortedAndFilteredRows.map((c) => c.id)));
                        } else {
                          setSelectedClientIds(new Set());
                        }
                      }}
                    />
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground transition"
                    onClick={() => handleSort("nome")}
                  >
                    <div className="flex items-center gap-1">
                      Cliente {renderSortArrow("nome")}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground transition"
                    onClick={() => handleSort("tipo")}
                  >
                    <div className="flex items-center gap-1">
                      Tipo {renderSortArrow("tipo")}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground transition"
                    onClick={() => handleSort("telefone")}
                  >
                    <div className="flex items-center gap-1">
                      Telefone {renderSortArrow("telefone")}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground transition"
                    onClick={() => handleSort("documento")}
                  >
                    <div className="flex items-center gap-1">
                      Documento {renderSortArrow("documento")}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground transition"
                    onClick={() => handleSort("cidade")}
                  >
                    <div className="flex items-center gap-1">
                      Cidade {renderSortArrow("cidade")}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground transition"
                    onClick={() => handleSort("totalGasto")}
                  >
                    <div className="flex items-center gap-1">
                      Total gasto {renderSortArrow("totalGasto")}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground transition"
                    onClick={() => handleSort("ultimaCompra")}
                  >
                    <div className="flex items-center gap-1">
                      Última compra {renderSortArrow("ultimaCompra")}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left font-medium">Tags</th>
                  <th
                    className="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground transition"
                    onClick={() => handleSort("status")}
                  >
                    <div className="flex items-center gap-1">
                      Status {renderSortArrow("status")}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedAndFilteredRows.map((c) => (
                  <tr
                    key={c.id}
                    className={`hover:bg-accent/40 ${
                      selectedClientIds.has(c.id) ? "bg-primary/5" : ""
                    }`}
                  >
                    <td className="px-4 py-3 w-12">
                      <Checkbox
                        checked={selectedClientIds.has(c.id)}
                        onCheckedChange={(checked) => {
                          const next = new Set(selectedClientIds);
                          if (checked) {
                            next.add(c.id);
                          } else {
                            next.delete(c.id);
                          }
                          setSelectedClientIds(next);
                        }}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{c.nome}</div>
                    </td>
                    <td className="px-4 py-3"><Badge tone={c.tipo === "PJ" ? "info" : "default"}>{c.tipo}</Badge></td>
                    <td className="px-4 py-3 text-foreground">{c.telefone}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.documento}</td>
                    <td className="px-4 py-3 text-foreground">{c.cidade}</td>
                    <td className="px-4 py-3 font-medium text-foreground font-mono">R$ {c.totalGasto.toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.ultimaCompra}</td>
                    <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div></td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => {
                          startSaving(async () => {
                            try {
                              await updateCliente(storeId, c.id, { active: c.status !== "Ativo" });
                              await refresh();
                              toast.success("Status do cliente updated.");
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "Não foi possível atualizar status.");
                            }
                          });
                        }}
                        className="inline-flex"
                        title="Ativar/Inativar"
                      >
                        <Badge tone={c.status === "Ativo" ? "success" : "default"}>{c.status}</Badge>
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <button
                          className="rounded p-1.5 hover:bg-accent hover:text-foreground transition-smooth"
                          title="Editar cliente"
                          onClick={() => {
                            setEditing(c);
                            m.openIt();
                          }}
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        {c.telefone && c.telefone !== "—" && (
                          <button
                            className="rounded p-1.5 hover:bg-accent hover:text-foreground transition-smooth"
                            title="Abrir WhatsApp"
                            onClick={() => {
                              const digits = c.telefone.replace(/\D/g, "");
                              const phone = digits.startsWith("55") ? digits : `55${digits}`;
                              window.open(`https://wa.me/${phone}`, "_blank");
                            }}
                          >
                            <MessageCircle className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={m.open}
        onClose={() => {
          setEditing(null);
          m.close();
        }}
        title={editing ? "Editar cliente" : "Novo cliente"}
        subtitle="Cadastro completo com consentimento LGPD."
        size="lg"
      >
        <div className="grid grid-cols-2 gap-4" key={m.open ? "open" : "closed"}>
          <Field label="Nome" span={2}>
            <Input ref={nomeRef} defaultValue={editing?.nome ?? ""} placeholder="Nome completo ou razão social" />
          </Field>
          <Field label="Tipo">
            <Select
              value={tipoSelecionado}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                setTipoSelecionado(e.target.value as "PF" | "PJ");
                setDocValue("");
              }}
            >
              <option value="PF">PF — Pessoa Física</option>
              <option value="PJ">PJ — Pessoa Jurídica</option>
            </Select>
          </Field>
          <Field label={tipoSelecionado === "PF" ? "CPF" : "CNPJ"}>
            <Input
              value={docValue}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setDocValue(applyDocMask(e.target.value, tipoSelecionado))
              }
              placeholder={tipoSelecionado === "PF" ? "000.000.000-00" : "00.000.000/0000-00"}
            />
          </Field>
          <Field label="Telefone / WhatsApp"><Input ref={telRef} defaultValue={editing?.telefone === "—" ? "" : editing?.telefone ?? ""} placeholder="(11) 9 0000-0000" /></Field>
          <Field label="Email"><Input ref={emailRef} defaultValue={editing?.email ?? ""} placeholder="email@exemplo.com" /></Field>
          <Field label="Endereço" span={2}><Input ref={enderecoRef} defaultValue={editing?.endereco ?? ""} placeholder="Rua, número, bairro" /></Field>
          <Field label="Cidade"><Input ref={cidadeRef} defaultValue={editing?.cidade === "—" ? "" : editing?.cidade ?? ""} placeholder="São Paulo/SP" /></Field>
          <Field label="UF"><Input ref={ufRef} defaultValue={editing?.uf ?? ""} placeholder="SP" /></Field>
          <Field label="Tags" span={2}><Input ref={tagsRef} defaultValue={editing?.tags?.join(", ") ?? ""} placeholder="VIP, Recorrente, B2B…" /></Field>
          <Field label="Observações" span={2}><Textarea ref={observacoesRef} rows={3} defaultValue={editing?.observacoes ?? ""} placeholder="Notas internas" /></Field>
          <Field label="Status">
            <Select ref={statusRef} defaultValue={editing?.status ?? "Ativo"}>
              <option>Ativo</option>
              <option>Inativo</option>
            </Select>
          </Field>
          <Field label="Consentimento LGPD" span={2}>
            <label className="flex items-center gap-2.5 rounded-lg border border-border bg-background p-3 text-sm text-foreground cursor-pointer select-none">
              <Checkbox id="lgpd-consent" />
              <span className="text-xs text-muted-foreground">Cliente autoriza uso dos dados conforme política de privacidade.</span>
            </label>
          </Field>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={() => {
              setEditing(null);
              m.close();
            }}
            className="rounded-lg border border-border px-4 py-2 text-sm"
          >
            Cancelar
          </button>
          <button
            disabled={saving}
            onClick={() => {
              startSaving(async () => {
                try {
                  const tagsInput = (tagsRef.current?.value ?? "").trim();
                  const labels = tagsInput ? tagsInput.split(",").map((s) => s.trim()).filter(Boolean) : [];
                  const endereco = (enderecoRef.current?.value ?? "").trim();
                  const uf = (ufRef.current?.value ?? "").trim();
                  const observacoes = (observacoesRef.current?.value ?? "").trim();

                  const basePayload = {
                    nome: (nomeRef.current?.value ?? "").trim(),
                    tipo: tipoSelecionado,
                    documento: docValue.trim(),
                    telefone: (telRef.current?.value ?? "").trim(),
                    email: (emailRef.current?.value ?? "").trim(),
                    cidade: (cidadeRef.current?.value ?? "").trim(),
                    active: (statusRef.current?.value ?? "Ativo") !== "Inativo",
                  };

                  if (editing) {
                    // Preserva chaves não exibidas (rg, financial, importer's gcCodigo etc.)
                    // mesclando sobre o tagsRaw do registro. Salvar sem alterar não pode
                    // apagar dados que o modal nem mostra.
                    const previous: Record<string, unknown> =
                      editing.tagsRaw && typeof editing.tagsRaw === "object" && !Array.isArray(editing.tagsRaw)
                        ? { ...(editing.tagsRaw as Record<string, unknown>) }
                        : {};
                    const prevAddress =
                      previous.address && typeof previous.address === "object" && !Array.isArray(previous.address)
                        ? { ...(previous.address as Record<string, unknown>) }
                        : {};
                    const prevOperational =
                      previous.operational && typeof previous.operational === "object" && !Array.isArray(previous.operational)
                        ? { ...(previous.operational as Record<string, unknown>) }
                        : {};
                    const mergedTags: Record<string, unknown> = {
                      ...previous,
                      labels,
                      address: { ...prevAddress, street: endereco, state: uf },
                      operational: { ...prevOperational, notes: observacoes },
                    };

                    await updateCliente(storeId, editing.id, {
                      ...basePayload,
                      tags: mergedTags,
                    });
                  } else {
                    // Criação manual: schema enxuto. Só persiste endereço/uf/observações
                    // quando o operador realmente preencheu — evita gravar objeto vazio.
                    const tagsForCreate =
                      endereco || uf || observacoes
                        ? {
                            labels,
                            address: { street: endereco, state: uf },
                            operational: { notes: observacoes },
                          }
                        : labels;
                    await createCliente(storeId, {
                      ...basePayload,
                      tags: tagsForCreate,
                    });
                  }
                  await refresh();
                  setEditing(null);
                  m.close();
                  window.alert("Salvo com sucesso");
                } catch (e) {
                  window.alert(e instanceof Error ? e.message : "Não foi possível salvar cliente");
                }
              });
            }}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Salvando…" : "Salvar cliente"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

/* ───── PRODUTOS ───── */

/** Alinhado ao backend: estoque baixo = 1–5 unidades (stock > 0 e < 6). */
const ESTOQUE_BAIXO_LIMITE = 6;

/**
 * Remove prefixos automáticos de importador (gc-, imp-, etc.) para exibição amigável.
 * O SKU bruto no banco é preservado; isto é só camada visual.
 */
const SKU_DISPLAY_PREFIX_RE = /^(?:gc-|imp-|prod-|id-)+/i;
function displaySku(sku: string | undefined | null): string {
  const s = String(sku ?? "").trim();
  if (!s || s === "—") return "";
  return s.replace(SKU_DISPLAY_PREFIX_RE, "") || s;
}

function estoqueBadge(estoque: number): { tone: "danger" | "warning" | "success"; label: string; title: string } {
  if (estoque <= 0) {
    return { tone: "danger", label: "Sem saldo", title: "Produto sem unidades disponíveis" };
  }
  if (estoque < ESTOQUE_BAIXO_LIMITE) {
    return { tone: "warning", label: `${estoque} · baixo`, title: "Saldo entre 1 e 5 unidades — considere repor" };
  }
  return { tone: "success", label: String(estoque), title: "Saldo adequado" };
}

function produtoStatusBadge(status: ProdutoDTO["status"]): { tone: "success" | "warning" | "default"; label: string } {
  if (status === "Ativo") return { tone: "success", label: "Ativo" };
  if (status === "Inativo") return { tone: "default", label: "Inativo" };
  return { tone: "warning", label: "Incompleto" };
}

const ALERTA_PRODUTO_HINTS: Record<string, string> = {
  "Estoque baixo": "Ativos com 1–5 unidades",
  "Sem preço": "Preço de venda zerado ou ausente",
  "Sem fornecedor": "Campo fornecedor vazio",
  "Margem baixa": "Margem abaixo de 20%",
  "Prontos p/ Marketplace": "Ativos, com preço, estoque e categoria",
};

function ProdutosPanel({
  storeId,
  autoOpen,
  onAutoOpenConsumed,
}: {
  storeId: string;
  autoOpen?: boolean;
  onAutoOpenConsumed?: () => void;
}) {
  const m = useToggle();
  const [editing, setEditing] = useState<ProdutoDTO | null>(null);
  const [deleting, setDeleting] = useState<ProdutoDTO | null>(null);
  const [deleteResult, setDeleteResult] = useState<DeleteProdutoResult | null>(null);
  const [estoqueProduto, setEstoqueProduto] = useState<ProdutoDTO | null>(null);
  const [histGeralOpen, setHistGeralOpen] = useState(false);
  const [resumo, setResumo] = useState<EstoqueResumo | null>(null);
  const PAGE_SIZE = 100;
  const [rows, setRows] = useState<ProdutoDTO[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [filterQuery, setFilterQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Estados de filtros avançados
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState("todos");
  const [estoqueFilter, setEstoqueFilter] = useState("todos");
  const [precoFilter, setPrecoFilter] = useState("todos"); // "todos" | "semPreco"
  const [fornecedorFilter, setFornecedorFilter] = useState("todos"); // "todos" | "semFornecedor"
  const [categoriaFilter, setCategoriaFilter] = useState("todos");
  const [marcaFilter, setMarcaFilter] = useState("todos");
  // Filtros de importação (Parte 11) — todos resolvidos no servidor.
  const [importacaoFilter, setImportacaoFilter] = useState("todos");

  const [categorias, setCategorias] = useState<string[]>([]);
  const [marcas, setMarcas] = useState<string[]>([]);
  /** Lote mais recente da loja — base do destaque "Novo da importação". */
  const [ultimoBatchId, setUltimoBatchId] = useState<string | null>(null);

  // Estado de ordenação
  const [sortConfig, setSortConfig] = useState<{ field: string; direction: "asc" | "desc" } | undefined>(undefined);

  // Estados de seleção em lote
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkCheckResults, setBulkCheckResults] = useState<any[]>([]);
  const [bulkChecking, setBulkChecking] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [bulkActionSelected, setBulkActionSelected] = useState<"delete" | "inactivate">("inactivate");
  const [bulkConfirmText, setBulkConfirmText] = useState("");

  useEffect(() => {
    if (autoOpen) {
      m.openIt();
      onAutoOpenConsumed?.();
    }
  }, [autoOpen, onAutoOpenConsumed, m]);

  // Carrega categorias e marcas para os filtros
  useEffect(() => {
    listCategorias(storeId)
      .then((cats) => {
        setCategorias(cats.filter((c) => c.active && c.type === "produto").map((c) => c.name));
      })
      .catch(console.error);

    listMarcas(storeId)
      .then((mrcs) => {
        setMarcas(mrcs.filter((m) => m.active).map((m) => m.name));
      })
      .catch(console.error);

    getUltimoBatchProdutos(storeId)
      .then(setUltimoBatchId)
      .catch(() => setUltimoBatchId(null));
  }, [storeId]);

  // Reseta página quando os filtros ou ordenação mudam
  useEffect(() => {
    setPage(1);
    setSelectedProductIds(new Set());
  }, [statusFilter, estoqueFilter, precoFilter, fornecedorFilter, categoriaFilter, marcaFilter, importacaoFilter, sortConfig]);

  // loadingRows: bloqueia apenas a tabela; loadingAlerts: atualiza os cards silenciosamente
  const [loadingRows, setLoadingRows] = useState(true);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [alerts, setAlerts] = useState<Array<{ l: string; n: number; t: "warning" | "danger" | "success" }>>([
    { l: "Estoque baixo", n: 0, t: "warning" },
    { l: "Sem preço", n: 0, t: "danger" },
    { l: "Sem fornecedor", n: 0, t: "danger" },
    { l: "Margem baixa", n: 0, t: "warning" },
    { l: "Prontos p/ Marketplace", n: 0, t: "success" },
  ]);

  // Carrega a página atual — server-side para suportar 5000+ produtos sem travar
  const refreshRows = useMemo(
    () => async () => {
      setLoadingRows(true);
      setErr(null);
      try {
        const { produtos, total, erroFiltros } = await listProdutosPaginado(storeId, {
          q: debouncedQuery || undefined,
          page,
          pageSize: PAGE_SIZE,
          filters: {
            status: statusFilter,
            estoque: estoqueFilter,
            preco: precoFilter,
            fornecedor: fornecedorFilter,
            categoria: categoriaFilter,
            marca: marcaFilter,
            importacao: importacaoFilter !== "todos" ? importacaoFilter : undefined,
          },
          orderBy: sortConfig,
        });
        // Filtro que não pôde ser aplicado: erro explícito e tabela VAZIA. Mostrar o
        // catálogo inteiro aqui faria o operador concluir que "não há pendência".
        // Os filtros selecionados continuam na tela para permitir nova tentativa.
        if (erroFiltros) {
          setRows([]);
          setTotalRows(0);
          setErr(erroFiltros.mensagem);
          return;
        }
        setRows(produtos);
        setTotalRows(total);
      } catch (e) {
        // Mesma regra da falha de filtro: sem resposta confiável, a tabela esvazia.
        // Deixar a página anterior na tela junto de um erro faz o operador ler os
        // números antigos como se fossem o resultado do filtro que acabou de escolher.
        setRows([]);
        setTotalRows(0);
        setErr(e instanceof Error ? e.message : "Falha ao carregar produtos");
      } finally {
        setLoadingRows(false);
      }
    },
    [
      storeId,
      debouncedQuery,
      page,
      statusFilter,
      estoqueFilter,
      precoFilter,
      fornecedorFilter,
      categoriaFilter,
      marcaFilter,
      importacaoFilter,
      sortConfig,
    ]
  );

  // Carrega stats/alertas — pesado (>15 queries), não bloqueia tabela nem busca
  const refreshAlerts = useMemo(
    () => async () => {
      setLoadingAlerts(true);
      try {
        const [dash, resumoEstoque] = await Promise.all([
          getCadastrosDashboardStats(storeId),
          getEstoqueResumo(storeId),
        ]);
        setAlerts([
          { l: "Estoque baixo", n: dash.produtoAlerts.estoqueBaixo, t: "warning" },
          { l: "Sem preço", n: dash.produtoAlerts.semPreco, t: "danger" },
          { l: "Sem fornecedor", n: dash.produtoAlerts.semFornecedor, t: "danger" },
          { l: "Margem baixa", n: dash.produtoAlerts.margemBaixa, t: "warning" },
          { l: "Prontos p/ Marketplace", n: dash.produtoAlerts.prontosMarketplace, t: "success" },
        ]);
        setResumo(resumoEstoque);
      } catch {
        // alertas são não-críticos: mantém valores anteriores sem propagar erro
      } finally {
        setLoadingAlerts(false);
      }
    },
    [storeId]
  );

  // refresh completo: usado pelo ProductAIModal após salvar um produto
  const refresh = useMemo(
    () => async () => {
      void refreshAlerts();
      await refreshRows();
    },
    [refreshRows, refreshAlerts]
  );

  // Debounce: aguarda 300ms após última tecla para disparar busca no servidor
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(filterQuery.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [filterQuery]);

  // Rows: dispara sempre que storeId, debouncedQuery ou page mudam
  useEffect(() => { void refreshRows(); }, [refreshRows]);
  // Alertas: dispara apenas na montagem e troca de loja (não em cada página)
  useEffect(() => { void refreshAlerts(); }, [refreshAlerts]);

  const handleSort = (field: string) => {
    setSortConfig((curr) => {
      if (!curr || curr.field !== field) {
        return { field, direction: "asc" };
      }
      if (curr.direction === "asc") {
        return { field, direction: "desc" };
      }
      return undefined;
    });
  };

  const renderSortArrow = (field: string) => {
    if (!sortConfig || sortConfig.field !== field) return <span className="text-muted-foreground/30 text-[10px]">▲▼</span>;
    return sortConfig.direction === "asc" ? <span className="text-primary text-[10px]">▲</span> : <span className="text-primary text-[10px]">▼</span>;
  };

  const handleBulkInactivate = async () => {
    if (selectedProductIds.size === 0) return;
    if (!window.confirm(`Tem certeza que deseja inativar os ${selectedProductIds.size} produtos selecionados?`)) return;

    setBulkActionLoading(true);
    try {
      const res = await fetch("/api/produtos/bulk-action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-assistec-loja-id": storeId,
        },
        body: JSON.stringify({
          ids: Array.from(selectedProductIds),
          action: "inactivate",
          userLabel: "Administrador",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao inativar produtos");

      toast.success(`${data.inactivated} produto(s) inativados com sucesso.`);
      setSelectedProductIds(new Set());
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedProductIds.size === 0) return;
    setBulkChecking(true);
    setBulkModalOpen(true);
    setBulkConfirmText("");
    setBulkActionSelected("inactivate");
    try {
      const res = await fetch("/api/produtos/bulk-check-dependencies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-assistec-loja-id": storeId,
        },
        body: JSON.stringify({
          ids: Array.from(selectedProductIds),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao verificar dependências");
      setBulkCheckResults(data.results || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao verificar vínculos");
      setBulkModalOpen(false);
    } finally {
      setBulkChecking(false);
    }
  };

  const executeBulkAction = async () => {
    if (bulkConfirmText.toUpperCase() !== "EXCLUIR") {
      toast.error("Por favor, digite EXCLUIR para confirmar");
      return;
    }
    setBulkActionLoading(true);
    try {
      let idsToProcess = Array.from(selectedProductIds);
      if (bulkActionSelected === "inactivate") {
        // Envia todos os ids. Os vinculados serão inativados e os livres deletados
      } else {
        // Ignora os vinculados (mantém ativos) e deleta os livres
        const linkedIds = bulkCheckResults.filter((r) => r.isLinked).map((r) => r.id);
        idsToProcess = idsToProcess.filter((id) => !linkedIds.includes(id));
      }

      if (idsToProcess.length === 0) {
        toast.info("Nenhum produto livre para exclusão");
        setBulkModalOpen(false);
        return;
      }

      const res = await fetch("/api/produtos/bulk-action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-assistec-loja-id": storeId,
        },
        body: JSON.stringify({
          ids: idsToProcess,
          action: "delete",
          userLabel: "Administrador",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao executar ação em lote");

      toast.success(
        `Sucesso: ${data.deleted} produto(s) excluídos permanentemente e ${data.inactivated} produto(s) inativados.`
      );
      setSelectedProductIds(new Set());
      setBulkModalOpen(false);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao executar lote");
    } finally {
      setBulkActionLoading(false);
    }
  };

  const fmtBRL = (n: number) =>
    n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const resumoLoading = loadingAlerts && !resumo;

  return (
    <div className="w-full min-w-0">
      <SectionTitle
        title="Resumo de estoque"
        subtitle="Indicadores da unidade ativa — atualizados após movimentações e cadastros"
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-stretch">
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Valor em estoque (custo)</div>
            <div className="mt-1 text-2xl font-bold text-foreground">
              {resumoLoading ? (
                <span className="inline-block h-8 w-28 animate-pulse rounded bg-muted" aria-hidden />
              ) : resumo ? (
                fmtBRL(resumo.valorCusto)
              ) : (
                <span className="text-base text-muted-foreground">—</span>
              )}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {resumoLoading
                ? "Calculando…"
                : resumo
                  ? `${resumo.totalUnidades} un · ${resumo.skusComEstoque} SKU com saldo`
                  : "Custo médio × saldo de todos os produtos"}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Venda potencial</div>
            <div className="mt-1 text-2xl font-bold text-foreground">
              {resumoLoading ? (
                <span className="inline-block h-8 w-28 animate-pulse rounded bg-muted" aria-hidden />
              ) : resumo ? (
                fmtBRL(resumo.valorVenda)
              ) : (
                <span className="text-base text-muted-foreground">—</span>
              )}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">Receita se vender todo o saldo atual</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Margem potencial</div>
            <div className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {resumoLoading ? (
                <span className="inline-block h-8 w-28 animate-pulse rounded bg-muted" aria-hidden />
              ) : resumo ? (
                fmtBRL(resumo.margemPotencial)
              ) : (
                <span className="text-base text-muted-foreground">—</span>
              )}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">Diferença entre venda potencial e custo</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">SKUs sem saldo</div>
            <div className="mt-1 text-2xl font-bold text-foreground">
              {resumoLoading ? (
                <span className="inline-block h-8 w-12 animate-pulse rounded bg-muted" aria-hidden />
              ) : resumo ? (
                resumo.skusSemEstoque
              ) : (
                <span className="text-base text-muted-foreground">—</span>
              )}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {resumo ? `de ${resumo.totalSkus} produtos ativos` : "Produtos ativos com estoque zero"}
            </div>
          </Card>
        </div>
        <button
          type="button"
          onClick={() => setHistGeralOpen(true)}
          className="flex min-h-[3rem] items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground hover:bg-accent lg:w-44"
        >
          <History className="h-4 w-4 shrink-0" /> Histórico de estoque
        </button>
      </div>

      <div className="mb-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {alerts.map((a) => (
          <Card key={a.l} className="p-4">
            <div className="text-xs text-muted-foreground">{a.l}</div>
            <div className="mt-0.5 text-[10px] text-muted-foreground/80">{ALERTA_PRODUTO_HINTS[a.l] ?? ""}</div>
            <div className="mt-2 flex items-end justify-between gap-2">
              <div className="text-2xl font-bold text-foreground">
                {loadingAlerts ? (
                  <span className="inline-block h-7 w-8 animate-pulse rounded bg-muted" aria-hidden />
                ) : (
                  a.n
                )}
              </div>
              <Badge tone={a.t}>{a.t === "success" ? "OK" : "Revisar"}</Badge>
            </div>
          </Card>
        ))}
      </div>

      <Toolbar
        count={totalRows}
        label="produtos"
        onNew={m.openIt}
        filterQuery={filterQuery}
        onFilterQueryChange={setFilterQuery}
        onFilterClick={() => setShowFilters(!showFilters)}
      />

      {showFilters && (
        <Card className="mb-4 bg-muted/20 border border-border/80 p-4 transition-all animate-fade-in">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            <Field label="Status">
              <Select value={statusFilter} onChange={(e: any) => setStatusFilter(e.target.value)}>
                <option value="todos">Todos</option>
                <option value="Ativo">Ativo</option>
                <option value="Inativo">Inativo</option>
                <option value="Incompleto">Incompleto</option>
              </Select>
            </Field>
            <Field label="Estoque">
              <Select value={estoqueFilter} onChange={(e: any) => setEstoqueFilter(e.target.value)}>
                <option value="todos">Todos</option>
                <option value="com">Com estoque</option>
                <option value="sem">Sem estoque</option>
                <option value="baixo">Estoque crítico (1-5)</option>
              </Select>
            </Field>
            <Field label="Preço">
              <Select value={precoFilter} onChange={(e: any) => setPrecoFilter(e.target.value)}>
                <option value="todos">Todos</option>
                <option value="semPreco">Sem preço de venda</option>
              </Select>
            </Field>
            <Field label="Fornecedor">
              <Select value={fornecedorFilter} onChange={(e: any) => setFornecedorFilter(e.target.value)}>
                <option value="todos">Todos</option>
                <option value="semFornecedor">Sem fornecedor</option>
              </Select>
            </Field>
            <Field label="Categoria">
              <Select value={categoriaFilter} onChange={(e: any) => setCategoriaFilter(e.target.value)}>
                <option value="todos">Todas</option>
                {categorias.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Marca">
              <Select value={marcaFilter} onChange={(e: any) => setMarcaFilter(e.target.value)}>
                <option value="todos">Todas</option>
                {marcas.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            {/* Filtros de importação (Parte 11) — resolvidos no servidor, sobre
                `metadata.importacao` / `metadata.fiscal`. */}
            <Field label="Importação">
              <Select value={importacaoFilter} onChange={(e: any) => setImportacaoFilter(e.target.value)}>
                <option value="todos">Todos</option>
                <option value="ultimoLote">Última importação</option>
                <option value="hoje">Importados hoje</option>
                <option value="pendenteRevisao">Pendentes de revisão</option>
                <option value="revisado">Revisados</option>
                <option value="semBarcode">Sem código de barras</option>
                <option value="skuSintetico">SKU sintético</option>
                <option value="semNcm">NCM ausente</option>
                <option value="semCest">CEST ausente</option>
              </Select>
            </Field>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => {
                setStatusFilter("todos");
                setEstoqueFilter("todos");
                setPrecoFilter("todos");
                setFornecedorFilter("todos");
                setCategoriaFilter("todos");
                setMarcaFilter("todos");
                setImportacaoFilter("todos");
              }}
              className="text-xs text-muted-foreground hover:text-foreground font-medium transition"
            >
              Limpar Filtros
            </button>
          </div>
        </Card>
      )}

      {loadingRows && (
        <Card className="mb-4 overflow-hidden p-4" aria-busy="true" aria-label="Carregando produtos">
          <div className="space-y-2">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        </Card>
      )}
      {err && (
        <div
          role="alert"
          data-testid="produtos-erro-filtros"
          className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span className="min-w-0">{err}</span>
          <button
            type="button"
            onClick={() => void refreshRows()}
            disabled={loadingRows}
            className="shrink-0 rounded-lg border border-destructive/50 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-destructive/15 disabled:opacity-60"
          >
            Tentar novamente
          </button>
        </div>
      )}
      {!loadingRows && !err && rows.length === 0 && !debouncedQuery && statusFilter === "todos" && estoqueFilter === "todos" && precoFilter === "todos" && fornecedorFilter === "todos" && categoriaFilter === "todos" && marcaFilter === "todos" && (
        <Card className="mb-4 border-dashed border-2 border-border/80 bg-gradient-to-br from-card to-muted/20 p-10 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Package className="h-7 w-7" />
          </div>
          <p className="text-base font-semibold text-foreground">Nenhum produto nesta unidade</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Cadastre o primeiro item ou importe o catálogo. Os dados vêm do banco (Prisma) e alimentam estoque, PDV e OS.
          </p>
          <button
            type="button"
            onClick={m.openIt}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Novo produto
          </button>
        </Card>
      )}
      {!loadingRows && !err && rows.length === 0 && (!!debouncedQuery || statusFilter !== "todos" || estoqueFilter !== "todos" || precoFilter !== "todos" || fornecedorFilter !== "todos" || categoriaFilter !== "todos" || marcaFilter !== "todos") && (
        <Card className="mb-4 border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Nenhum produto corresponde aos filtros e busca ativos. Ajuste os termos.
        </Card>
      )}
      {!loadingRows && !err && rows.length > 0 && (
      <Card className="overflow-hidden relative">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-muted-foreground select-none">
              <tr>
                <th className="px-4 py-3 text-left w-12">
                  <Checkbox
                    checked={rows.length > 0 && selectedProductIds.size === rows.length}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedProductIds(new Set(rows.map((p) => p.id)));
                      } else {
                        setSelectedProductIds(new Set());
                      }
                    }}
                  />
                </th>
                <th
                  className="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground transition"
                  onClick={() => handleSort("nome")}
                >
                  <div className="flex items-center gap-1">
                    Produto {renderSortArrow("nome")}
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground transition"
                  onClick={() => handleSort("sku")}
                >
                  <div className="flex items-center gap-1">
                    SKU {renderSortArrow("sku")}
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground transition"
                  onClick={() => handleSort("categoria")}
                >
                  <div className="flex items-center gap-1">
                    Categoria {renderSortArrow("categoria")}
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground transition"
                  onClick={() => handleSort("estoque")}
                >
                  <div className="flex items-center gap-1">
                    Estoque {renderSortArrow("estoque")}
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground transition"
                  onClick={() => handleSort("preco")}
                >
                  <div className="flex items-center gap-1">
                    Preço {renderSortArrow("preco")}
                  </div>
                </th>
                <th className="px-4 py-3 text-left font-medium">Margem</th>
                <th className="px-4 py-3 text-left font-medium">Qualidade</th>
                <th
                  className="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground transition"
                  onClick={() => handleSort("status")}
                >
                  <div className="flex items-center gap-1">
                    Status {renderSortArrow("status")}
                  </div>
                </th>
                <th className="px-4 py-3 text-left font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((p) => {
                // Score lê NCM e status de revisão do metadata pelo helper canônico —
                // sem isso, produto com fiscal preenchido perdia pontos indevidamente.
                const score = catalogQualityScore(qualityScoreInputFromProduto(p));
                const iaStub = p.metadata && typeof p.metadata.cadastroIa === "object";
                const est = estoqueBadge(p.estoque);
                const st = produtoStatusBadge(p.status);
                const inativo = p.status === "Inativo";
                // Destaque discreto do último lote importado (Parte 11): âmbar suave.
                // Vermelho forte fica reservado para erro/conflito.
                const doUltimoLote =
                  !!ultimoBatchId && p.importacao?.batchId === ultimoBatchId;
                const precoPendente = p.preco <= 0;
                return (
                  <tr
                    key={p.id}
                    className={`hover:bg-accent/40 ${inativo ? "bg-muted/20 opacity-80" : ""} ${
                      doUltimoLote ? "bg-amber-500/5" : ""
                    } ${selectedProductIds.has(p.id) ? "bg-primary/5" : ""}`}
                  >
                    <td className="px-4 py-3 w-12">
                      <Checkbox
                        checked={selectedProductIds.has(p.id)}
                        onCheckedChange={(checked) => {
                          const next = new Set(selectedProductIds);
                          if (checked) {
                            next.add(p.id);
                          } else {
                            next.delete(p.id);
                          }
                          setSelectedProductIds(next);
                        }}
                      />
                    </td>
                    <td className="px-4 py-3 min-w-0">
                      <div className="font-medium text-foreground">{p.nome}</div>
                      <div className="text-xs text-muted-foreground">{p.marca} • {p.fornecedor}</div>
                      {p.importacao && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {doUltimoLote && (
                            <span
                              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                              title={`Lote ${p.importacao.batchId}${p.importacao.fornecedor ? ` · ${p.importacao.fornecedor}` : ""}`}
                            >
                              Novo da importação
                            </span>
                          )}
                          {precoPendente && (
                            <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                              Preço pendente
                            </span>
                          )}
                          {p.importacao.statusRevisao === "revisado" && (
                            <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                              Revisado
                            </span>
                          )}
                          {p.skuSintetico && (
                            <span
                              className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                              title="SKU gerado por importador — sem valor comercial"
                            >
                              SKU sintético
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 min-w-0">
                      {(() => {
                        const skuLimpo = displaySku(p.sku);
                        const tinhaPrefixo = skuLimpo !== "" && skuLimpo !== (p.sku ?? "").trim();
                        return (
                          <div
                            className="font-mono text-xs text-foreground"
                            title={tinhaPrefixo ? `Código no banco: ${p.sku}` : undefined}
                          >
                            {skuLimpo || <span className="text-muted-foreground">—</span>}
                          </div>
                        );
                      })()}
                      {p.barras && p.barras !== "—" && p.barras !== p.sku && (
                        <div
                          className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground"
                          title="Código de barras (EAN/GTIN)"
                        >
                          <Barcode className="h-3 w-3 shrink-0" />
                          <span className="font-mono">{p.barras}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3"><Badge>{p.categoria}</Badge></td>
                    <td className="px-4 py-3">
                      <span title={est.title}>
                        <Badge tone={est.tone}>{est.label}</Badge>
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">{p.preco ? `R$ ${p.preco}` : <span className="text-destructive">—</span>}</td>
                    <td className="px-4 py-3 text-foreground">{p.margem ? `${p.margem.toFixed(1)}%` : "—"}</td>
                    <td className="px-4 py-3"><QualityScore value={score} /></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        {p.status === "Incompleto" && <Badge tone="warning">Cadastro incompleto</Badge>}
                        {iaStub && (
                          <Badge tone="primary">
                            <Sparkles className="mr-1 inline h-3 w-3" /> pipeline
                          </Badge>
                        )}
                        <button
                          disabled={saving}
                          onClick={() => {
                            startSaving(async () => {
                              try {
                                const result = await upsertProduto(storeId, {
                                  id: p.id,
                                  nome: p.nome,
                                  sku: p.sku === "—" ? "" : p.sku,
                                  barras: p.barras,
                                  categoria: p.categoria === "—" ? "" : p.categoria,
                                  marca: p.marca === "—" ? "" : p.marca,
                                  fornecedor: p.fornecedor === "—" ? "" : p.fornecedor,
                                  estoque: p.estoque,
                                  custo: p.custo,
                                  preco: p.preco,
                                  garantia: p.garantia,
                                  active: p.status !== "Ativo",
                                });
                                if (!result.ok) {
                                  toast.error(result.message);
                                  return;
                                }
                                toast.success(p.status === "Ativo" ? "Produto inativado." : "Produto reativado.");
                                await refresh();
                              } catch (e) {
                                toast.error("Não foi possível atualizar o status do produto.");
                              }
                            });
                          }}
                          className="inline-flex"
                          title={inativo ? "Clique para reativar o produto" : "Clique para inativar o produto"}
                        >
                        <Badge tone={st.tone}>{st.label}</Badge>
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-[10.5rem] flex-wrap items-center gap-1">
                        <button
                          className="flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1.5 text-[11px] font-medium text-emerald-600 hover:bg-emerald-500/25 dark:text-emerald-400"
                          title="Entrada ou ajuste de estoque"
                          type="button"
                          onClick={() => setEstoqueProduto(p)}
                        >
                          <Package className="h-3 w-3 shrink-0" /> Estoque
                        </button>
                        <button
                          className="flex items-center gap-1 rounded-md bg-primary/15 px-2 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/25"
                          title="Editar ficha do produto"
                          type="button"
                          onClick={() => {
                            setEditing(p);
                            m.openIt();
                          }}
                        >
                          <Edit3 className="h-3 w-3 shrink-0" /> Editar
                        </button>
                        <button
                          className="flex items-center gap-1 rounded-md bg-destructive/15 px-2 py-1.5 text-[11px] font-medium text-destructive hover:bg-destructive/25"
                          title="Excluir produto permanentemente"
                          type="button"
                          onClick={() => {
                            setDeleting(p);
                            setDeleteResult(null);
                          }}
                        >
                          <Trash2 className="h-3 w-3 shrink-0" /> Excluir
                        </button>
                        <span className="hidden xl:contents">
                          <button className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground cursor-not-allowed" title="Em breve" type="button" disabled>
                            Anúncio
                          </button>
                          <button className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground cursor-not-allowed" title="Em breve" type="button" disabled>
                            Publicar
                          </button>
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Paginação: exibida apenas quando há mais produtos do que o tamanho de página */}
        {totalRows > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <span className="text-xs text-muted-foreground">
              {Math.min((page - 1) * PAGE_SIZE + 1, totalRows).toLocaleString("pt-BR")}
              {" – "}
              {Math.min(page * PAGE_SIZE, totalRows).toLocaleString("pt-BR")}
              {" de "}
              {totalRows.toLocaleString("pt-BR")} produtos
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground transition hover:bg-accent disabled:opacity-40"
              >
                ← Anterior
              </button>
              <span className="min-w-[6rem] text-center text-xs text-muted-foreground">
                Página {page} de {Math.ceil(totalRows / PAGE_SIZE)}
              </span>
              <button
                type="button"
                disabled={page >= Math.ceil(totalRows / PAGE_SIZE)}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground transition hover:bg-accent disabled:opacity-40"
              >
                Próxima →
              </button>
            </div>
          </div>
        )}
      </Card>
      )}

      {/* Barra flutuante de ações em lote */}
      {selectedProductIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-xl border border-primary/20 bg-background/95 px-6 py-4 shadow-xl backdrop-blur-md animate-fade-in-up">
          <div className="text-sm font-medium text-foreground">
            {selectedProductIds.size} {selectedProductIds.size === 1 ? "selecionado" : "selecionados"}
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex gap-2">
            <button
              onClick={handleBulkInactivate}
              disabled={bulkActionLoading}
              className="rounded-lg bg-secondary px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-secondary/80 disabled:opacity-60 transition"
            >
              Inativar selecionados
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkActionLoading}
              className="rounded-lg bg-destructive px-3.5 py-2 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60 transition shadow-md"
            >
              Excluir selecionados
            </button>
          </div>
        </div>
      )}

      {/* Modal de Exclusão Segura em Lote */}
      {bulkModalOpen && (
        <Modal
          open={true}
          onClose={() => !bulkActionLoading && setBulkModalOpen(false)}
          title="Confirmar Exclusão em Lote"
          subtitle="Validação de integridade e dependências"
          size="lg"
        >
          <div className="space-y-4 text-sm">
            {bulkChecking ? (
              <div className="py-8 text-center text-muted-foreground animate-pulse">
                Analisando dependências contábeis e operacionais...
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-xs space-y-2">
                  <div className="font-semibold text-warning flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4" /> Alerta de Integridade Contábil
                  </div>
                  <p className="text-muted-foreground">
                    O sistema analisou os {selectedProductIds.size} itens selecionados e identificou o seguinte status:
                  </p>
                  <ul className="list-disc pl-5 space-y-1 mt-2 text-foreground font-medium">
                    <li>
                      {bulkCheckResults.filter((r) => r.isLinked).length} produto(s) possuem vendas ou OS vinculadas (exclusão física bloqueada).
                    </li>
                    <li>
                      {bulkCheckResults.filter((r) => !r.isLinked).length} produto(s) estão livres e podem ser excluídos permanentemente.
                    </li>
                  </ul>
                </div>

                {bulkCheckResults.filter((r) => r.isLinked).length > 0 && (
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-muted-foreground">
                      Escolha a ação para os itens vinculados/bloqueados:
                    </label>
                    <div className="space-y-2">
                      <label className="flex items-start gap-2.5 rounded-lg border border-border bg-background p-3 text-xs text-foreground cursor-pointer select-none">
                        <input
                          type="radio"
                          name="bulkActionSelect"
                          className="mt-0.5"
                          checked={bulkActionSelected === "inactivate"}
                          onChange={() => setBulkActionSelected("inactivate")}
                        />
                        <div>
                          <span className="font-medium block text-foreground">Inativar os vinculados (Recomendado)</span>
                          <span className="text-[10px] text-muted-foreground">
                            Preserva relatórios de faturamento, histórico de movimentação de caixa e Ordens de Serviço.
                          </span>
                        </div>
                      </label>
                      <label className="flex items-start gap-2.5 rounded-lg border border-border bg-background p-3 text-xs text-foreground cursor-pointer select-none">
                        <input
                          type="radio"
                          name="bulkActionSelect"
                          className="mt-0.5"
                          checked={bulkActionSelected === "delete"}
                          onChange={() => setBulkActionSelected("delete")}
                        />
                        <div>
                          <span className="font-medium block text-foreground">Manter vinculados ativos e ignorá-los</span>
                          <span className="text-[10px] text-muted-foreground">
                            Apenas os produtos sem histórico serão excluídos. Os demais permanecem ativos como estão.
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>
                )}

                <div className="space-y-2 pt-2">
                  <label className="block text-xs font-semibold text-muted-foreground">
                    Para confirmar a exclusão dos produtos livres e a ação desejada para os vinculados, digite a palavra <span className="font-bold text-destructive">EXCLUIR</span> abaixo:
                  </label>
                  <Input
                    value={bulkConfirmText}
                    onChange={(e: any) => setBulkConfirmText(e.target.value)}
                    placeholder="EXCLUIR"
                    className="border-destructive/30 focus:ring-destructive"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <button
                    disabled={bulkActionLoading}
                    onClick={() => setBulkModalOpen(false)}
                    className="rounded-lg border border-border px-4 py-2 text-sm"
                  >
                    Cancelar
                  </button>
                  <button
                    disabled={bulkActionLoading || bulkConfirmText.toUpperCase() !== "EXCLUIR"}
                    onClick={executeBulkAction}
                    className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60 transition"
                  >
                    {bulkActionLoading ? "Processando..." : "Confirmar Lote"}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      <ProductAIModal
        open={m.open}
        onClose={() => {
          setEditing(null);
          m.close();
        }}
        storeId={storeId}
        onSaved={refresh}
        productId={editing?.id}
        initial={
          editing
            ? {
                nome: editing.nome,
                sku: editing.sku === "—" ? "" : editing.sku,
                barras: editing.barras,
                categoria: editing.categoria === "—" ? "" : editing.categoria,
                marca: editing.marca === "—" ? "" : editing.marca,
                fornecedor: editing.fornecedor === "—" ? "" : editing.fornecedor,
                estoque: editing.estoque,
                custo: editing.custo,
                preco: editing.preco,
                garantia: editing.garantia,
                metadata: editing.metadata,
                // Leitura pelo helper canônico: `metadata.fiscal` primeiro, legado
                // `metadata.ncm`/`metadata.cest` como fallback (antes só o legado era lido,
                // então NCM/CEST vindos do importador novo não apareciam na ficha).
                ncm: getProdutoFiscal({ metadata: editing.metadata }).ncm || undefined,
                cest: getProdutoFiscal({ metadata: editing.metadata }).cest || undefined,
              }
            : undefined
        }
      />

      <MovimentacaoEstoqueModal
        open={estoqueProduto !== null}
        onClose={() => setEstoqueProduto(null)}
        storeId={storeId}
        produto={
          estoqueProduto
            ? {
                id: estoqueProduto.id,
                nome: estoqueProduto.nome,
                sku: estoqueProduto.sku,
                estoque: estoqueProduto.estoque,
                custo: estoqueProduto.custo,
              }
            : null
        }
        onSaved={() => {
          void refreshRows();
          void refreshAlerts();
        }}
      />

      <HistoricoEstoqueGeralModal open={histGeralOpen} onClose={() => setHistGeralOpen(false)} storeId={storeId} />

      {deleting && (
        <Modal
          open={true}
          onClose={() => {
            if (saving) return;
            setDeleting(null);
            setDeleteResult(null);
          }}
          title="Excluir produto?"
          subtitle="Ação destrutiva — não pode ser desfeita"
          size="md"
        >
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Produto</div>
              <div className="mt-1 line-clamp-3 font-medium text-foreground">{deleting.nome}</div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="block text-[10px] uppercase text-muted-foreground">SKU</span>
                  <span className="text-foreground">{deleting.sku && deleting.sku !== "—" ? deleting.sku : "—"}</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase text-muted-foreground">Estoque</span>
                  <span className="text-foreground">{deleting.estoque}</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase text-muted-foreground">Preço</span>
                  <span className="text-foreground">{deleting.preco ? `R$ ${deleting.preco}` : "—"}</span>
                </div>
              </div>
            </div>

            {deleting.estoque > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
                Atenção: produto com estoque {deleting.estoque}. A exclusão remove o cadastro e o saldo registrado.
                Considere inativar pelo botão de status, na coluna Status.
              </div>
            )}

            {deleteResult && !deleteResult.ok && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <div className="font-medium">{deleteResult.reason}</div>
                {deleteResult.vinculos && (
                  <div className="mt-1 text-[11px]">
                    Vínculos encontrados: {deleteResult.vinculos.osItens} item(ns) de OS ·{" "}
                    {deleteResult.vinculos.listings} anúncio(s) · {deleteResult.vinculos.links} integração(ões) marketplace.
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-accent"
                onClick={() => {
                  setDeleting(null);
                  setDeleteResult(null);
                }}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
                disabled={saving || (deleteResult !== null && !deleteResult.ok)}
                onClick={() => {
                  if (!deleting) return;
                  startSaving(async () => {
                    try {
                      const res = await deleteProduto(storeId, deleting.id);
                      setDeleteResult(res);
                      if (res.ok) {
                        await refreshRows();
                        void refreshAlerts();
                        setDeleting(null);
                        setDeleteResult(null);
                      }
                    } catch (e) {
                      setDeleteResult({
                        ok: false,
                        reason: e instanceof Error ? e.message : "Falha ao excluir produto",
                      });
                    }
                  });
                }}
              >
                {saving ? "Excluindo…" : "Confirmar exclusão"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ───── SERVIÇOS ───── */
function ServicosPanel({
  storeId,
  autoOpen,
  onAutoOpenConsumed,
}: {
  storeId: string;
  autoOpen?: boolean;
  onAutoOpenConsumed?: () => void;
}) {
  const m = useToggle();
  const [editing, setEditing] = useState<ServicoDTO | null>(null);
  const [rows, setRows] = useState<ServicoDTO[]>([]);
  const [filterQuery, setFilterQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [servCategorias, setServCategorias] = useState<string[]>([]);

  useEffect(() => {
    listCategorias(storeId).then((cats) =>
      setServCategorias(cats.filter((c) => c.active && c.type === "servico").map((c) => c.name))
    ).catch(() => {});
  }, [storeId]);
  const [saving, startSaving] = useTransition();
  const nomeRef = useRef<HTMLInputElement | null>(null);
  const catRef = useRef<HTMLSelectElement | null>(null);
  const tempoRef = useRef<HTMLInputElement | null>(null);
  const custoRef = useRef<HTMLInputElement | null>(null);
  const precoRef = useRef<HTMLInputElement | null>(null);
  const garantiaRef = useRef<HTMLInputElement | null>(null);
  const termoRef = useRef<HTMLTextAreaElement | null>(null);
  const statusRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    if (autoOpen) {
      m.openIt();
      onAutoOpenConsumed?.();
    }
  }, [autoOpen, onAutoOpenConsumed, m]);

  const refresh = useMemo(
    () => async () => {
      setLoading(true);
      setErr(null);
      try {
        const data = await listServicos(storeId);
        setRows(data);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Falha ao carregar serviços");
      } finally {
        setLoading(false);
      }
    },
    [storeId]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleRows = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((s) => [s.nome, s.categoria].join(" ").toLowerCase().includes(q));
  }, [rows, filterQuery]);

  return (
    <div className="w-full min-w-0">
      <Toolbar
        count={visibleRows.length}
        label="serviços"
        onNew={m.openIt}
        filterQuery={filterQuery}
        onFilterQueryChange={setFilterQuery}
      />
      {loading && <div className="mb-3 text-sm text-muted-foreground">Carregando serviços…</div>}
      {err && <div className="mb-3 text-sm text-destructive">{err}</div>}
      <div className="grid min-w-0 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {visibleRows.map((s) => (
          <Card
            key={s.id}
            className="p-5"
            onClick={() => {
              setEditing(s);
              m.openIt();
            }}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-base font-semibold text-foreground">{s.nome}</div>
                <Badge tone="primary">{s.categoria}</Badge>
              </div>
              <button
                disabled={saving}
                onClick={() => {
                  startSaving(async () => {
                    try {
                      await upsertServico(storeId, {
                        id: s.id,
                        nome: s.nome,
                        categoria: s.categoria === "—" ? "" : s.categoria,
                        tempo: s.tempo === "—" ? "" : s.tempo,
                        custo: s.custo,
                        preco: s.preco,
                        garantia: s.garantia,
                        termo: s.termo,
                        active: s.status !== "Ativo",
                      });
                      await refresh();
                    } catch (e) {
                      window.alert(e instanceof Error ? e.message : "Não foi possível atualizar status");
                    }
                  });
                }}
                className="inline-flex"
                title="Ativar/Inativar"
              >
              <Badge tone={s.status === "Ativo" ? "success" : "warning"}>{s.status}</Badge>
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Stat label="Tempo médio" value={s.tempo} />
              <Stat label="Garantia" value={`${s.garantia} dias`} />
              <Stat label="Custo" value={`R$ ${s.custo}`} />
              <Stat label="Preço" value={s.preco ? `R$ ${s.preco}` : "—"} />
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-xs">
              <div className="text-muted-foreground">Margem</div>
              <div className="font-semibold text-primary">{s.margem ? `${s.margem.toFixed(1)}%` : "—"}</div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Badge tone="info">Marketing IA</Badge>
              <Badge>OS</Badge>
              <Badge>PDV</Badge>
            </div>
          </Card>
        ))}
      </div>

      <Modal open={m.open} onClose={m.close} title="Novo serviço" subtitle="Configuração completa para OS e Marketing IA." size="lg">
        <div className="grid grid-cols-2 gap-4" key={m.open ? "open" : "closed"}>
          <Field label="Nome" span={2}><Input ref={nomeRef} defaultValue={editing?.nome ?? ""} placeholder="Troca de tela" /></Field>
          <Field label="Categoria"><Select ref={catRef} defaultValue={editing?.categoria ?? ""}>{servCategorias.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Tempo médio"><Input ref={tempoRef} defaultValue={editing?.tempo === "—" ? "" : editing?.tempo ?? ""} placeholder="45 min" /></Field>
          <Field label="Custo interno"><Input ref={custoRef} defaultValue={editing ? String(editing.custo) : ""} placeholder="60" /></Field>
          <Field label="Preço de venda"><Input ref={precoRef} defaultValue={editing ? String(editing.preco) : ""} placeholder="280" /></Field>
          <Field label="Garantia (dias)"><Input ref={garantiaRef} defaultValue={editing ? String(editing.garantia) : ""} placeholder="90" /></Field>
          <Field label="Peças sugeridas"><Input placeholder="Tela compatível…" /></Field>
          <Field label="Checklist padrão" span={2}><Textarea rows={3} placeholder="• Testar touch&#10;• Testar Face ID" /></Field>
          <Field label="Termo de garantia" span={2}><Textarea ref={termoRef} defaultValue={editing?.termo ?? ""} rows={3} /></Field>
          <Field label="Status"><Select ref={statusRef} defaultValue={editing?.status ?? "Ativo"}><option>Ativo</option><option>Inativo</option></Select></Field>
          <Field label="Marketing IA" span={2}>
            <div className="space-y-2 rounded-lg border border-border bg-background p-3 text-sm text-foreground">
              <label className="flex items-center gap-2"><input type="checkbox" defaultChecked /> Usar em conteúdo automático</label>
              <label className="flex items-center gap-2"><input type="checkbox" defaultChecked /> Pode gerar post antes/depois</label>
              <Input placeholder="Template de legenda" />
              <Input placeholder="Hashtags padrão" />
            </div>
          </Field>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={m.close} className="rounded-lg border border-border px-4 py-2 text-sm">Cancelar</button>
          <button
            disabled={saving}
            onClick={() => {
              startSaving(async () => {
                try {
                  const custo = Number(String(custoRef.current?.value ?? "").replace(",", "."));
                  const preco = Number(String(precoRef.current?.value ?? "").replace(",", "."));
                  const garantia = Number(String(garantiaRef.current?.value ?? "").replace(",", "."));
                  await upsertServico(storeId, {
                    id: editing?.id,
                    nome: (nomeRef.current?.value ?? "").trim(),
                    categoria: (catRef.current?.value ?? "").trim(),
                    tempo: (tempoRef.current?.value ?? "").trim(),
                    custo: Number.isFinite(custo) ? custo : 0,
                    preco: Number.isFinite(preco) ? preco : 0,
                    garantia: Number.isFinite(garantia) ? garantia : 0,
                    termo: (termoRef.current?.value ?? "").trim(),
                    active: (statusRef.current?.value ?? "Ativo") !== "Inativo",
                  });
                  await refresh();
                  setEditing(null);
                  m.close();
                  window.alert("Salvo com sucesso");
                } catch (e) {
                  window.alert(e instanceof Error ? e.message : "Não foi possível salvar serviço");
                }
              });
            }}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Salvando…" : "Salvar serviço"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

/* ───── FORNECEDORES ───── */
function FornecedoresPanel({
  storeId,
  autoOpen,
  onAutoOpenConsumed,
}: {
  storeId: string;
  autoOpen?: boolean;
  onAutoOpenConsumed?: () => void;
}) {
  const m = useToggle();
  const [rows, setRows] = useState<FornecedorDTO[]>([]);
  const [filterQuery, setFilterQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [editing, setEditing] = useState<FornecedorDTO | null>(null);

  const nomeRef = useRef<HTMLInputElement | null>(null);
  const razaoRef = useRef<HTMLInputElement | null>(null);
  const cnpjRef = useRef<HTMLInputElement | null>(null);
  const contatoRef = useRef<HTMLInputElement | null>(null);
  const whatsappRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const enderecoRef = useRef<HTMLInputElement | null>(null);
  const produtosRef = useRef<HTMLInputElement | null>(null);
  const prazoRef = useRef<HTMLInputElement | null>(null);
  const pagamentoRef = useRef<HTMLInputElement | null>(null);
  const obsRef = useRef<HTMLTextAreaElement | null>(null);
  const statusRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    if (autoOpen) {
      m.openIt();
      onAutoOpenConsumed?.();
    }
  }, [autoOpen, onAutoOpenConsumed, m]);

  const refresh = useMemo(
    () => async () => {
      setLoading(true);
      setErr(null);
      try {
        const data = await listFornecedores(storeId);
        setRows(data);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Falha ao carregar fornecedores");
      } finally {
        setLoading(false);
      }
    },
    [storeId]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleRows = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((f) =>
      [f.nome, f.razaoSocial, f.cnpj, f.contato, f.whatsapp, f.email].join(" ").toLowerCase().includes(q)
    );
  }, [rows, filterQuery]);

  return (
    <div className="w-full min-w-0">
      <Toolbar
        count={visibleRows.length}
        label="fornecedores"
        onNew={() => {
          setEditing(null);
          m.openIt();
        }}
        filterQuery={filterQuery}
        onFilterQueryChange={setFilterQuery}
      />
      {loading && <div className="mb-3 text-sm text-muted-foreground">Carregando fornecedores…</div>}
      {err && <div className="mb-3 text-sm text-destructive">{err}</div>}
      <Card className="overflow-hidden">
        <div className="w-full min-w-0 max-w-full overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-muted-foreground">
              <tr>{["Fornecedor", "CNPJ", "Contato", "Categoria", "Prazo", "Pagamento", "Última compra", "Status"].map((h) => <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleRows.map((f) => (
                <tr
                  key={f.id}
                  className="cursor-pointer hover:bg-accent/40"
                  onClick={() => {
                    setEditing(f);
                    m.openIt();
                  }}
                >
                  <td className="px-4 py-3 font-medium text-foreground">{f.nome}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{f.cnpj}</td>
                  <td className="px-4 py-3 text-foreground">
                    <div>{f.whatsapp !== "—" ? f.whatsapp : f.contato}</div>
                    <div className="text-xs text-muted-foreground">{f.email}</div>
                  </td>
                  <td className="px-4 py-3"><Badge>{"—"}</Badge></td>
                  <td className="px-4 py-3 text-foreground">{f.prazo}</td>
                  <td className="px-4 py-3 text-foreground">{f.pagamento}</td>
                  <td className="px-4 py-3 text-muted-foreground">{f.ultima}</td>
                  <td className="px-4 py-3">
                    <button
                      disabled={saving}
                      className="inline-flex"
                      title="Ativar/Inativar"
                      onClick={(e) => {
                        e.stopPropagation();
                        startSaving(async () => {
                          try {
                            await upsertFornecedor(storeId, {
                              id: f.id,
                              nome: f.nome,
                              razaoSocial: f.razaoSocial,
                              cnpj: f.cnpj === "—" ? "" : f.cnpj,
                              contato: f.contato === "—" ? "" : f.contato,
                              whatsapp: f.whatsapp === "—" ? "" : f.whatsapp,
                              email: f.email === "—" ? "" : f.email,
                              endereco: f.endereco,
                              produtos: f.produtos,
                              prazo: f.prazo === "—" ? "" : f.prazo,
                              pagamento: f.pagamento === "—" ? "" : f.pagamento,
                              observacoes: f.observacoes,
                              active: f.status !== "Ativo",
                            });
                            await refresh();
                          } catch (e2) {
                            window.alert(e2 instanceof Error ? e2.message : "Não foi possível atualizar status");
                          }
                        });
                      }}
                    >
                      <Badge tone={f.status === "Ativo" ? "success" : "default"}>{f.status}</Badge>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={m.open}
        onClose={() => {
          setEditing(null);
          m.close();
        }}
        title={editing ? "Editar fornecedor" : "Novo fornecedor"}
        size="lg"
      >
        <div className="grid grid-cols-2 gap-4" key={m.open ? "open" : "closed"}>
          <Field label="Nome fantasia"><Input ref={nomeRef} defaultValue={editing?.nome ?? ""} /></Field>
          <Field label="Razão social"><Input ref={razaoRef} defaultValue={editing?.razaoSocial ?? ""} /></Field>
          <Field label="CNPJ"><Input ref={cnpjRef} defaultValue={editing?.cnpj === "—" ? "" : editing?.cnpj ?? ""} placeholder="00.000.000/0000-00" /></Field>
          <Field label="Contato principal"><Input ref={contatoRef} defaultValue={editing?.contato === "—" ? "" : editing?.contato ?? ""} /></Field>
          <Field label="WhatsApp"><Input ref={whatsappRef} defaultValue={editing?.whatsapp === "—" ? "" : editing?.whatsapp ?? ""} /></Field>
          <Field label="Email"><Input ref={emailRef} defaultValue={editing?.email === "—" ? "" : editing?.email ?? ""} /></Field>
          <Field label="Endereço" span={2}><Input ref={enderecoRef} defaultValue={editing?.endereco ?? ""} /></Field>
          <Field label="Produtos fornecidos" span={2}><Input ref={produtosRef} defaultValue={editing?.produtos ?? ""} placeholder="Telas, baterias…" /></Field>
          <Field label="Prazo médio"><Input ref={prazoRef} defaultValue={editing?.prazo === "—" ? "" : editing?.prazo ?? ""} placeholder="5 dias" /></Field>
          <Field label="Condição de pagamento"><Input ref={pagamentoRef} defaultValue={editing?.pagamento === "—" ? "" : editing?.pagamento ?? ""} placeholder="30/60" /></Field>
          <Field label="Status"><Select ref={statusRef} defaultValue={editing?.status ?? "Ativo"}><option>Ativo</option><option>Inativo</option></Select></Field>
          <Field label="Observações" span={2}><Textarea ref={obsRef} defaultValue={editing?.observacoes ?? ""} rows={3} /></Field>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={() => {
              setEditing(null);
              m.close();
            }}
            className="rounded-lg border border-border px-4 py-2 text-sm"
          >
            Cancelar
          </button>
          <button
            disabled={saving}
            onClick={() => {
              startSaving(async () => {
                try {
                  await upsertFornecedor(storeId, {
                    id: editing?.id,
                    nome: (nomeRef.current?.value ?? "").trim(),
                    razaoSocial: (razaoRef.current?.value ?? "").trim(),
                    cnpj: (cnpjRef.current?.value ?? "").trim(),
                    contato: (contatoRef.current?.value ?? "").trim(),
                    whatsapp: (whatsappRef.current?.value ?? "").trim(),
                    email: (emailRef.current?.value ?? "").trim(),
                    endereco: (enderecoRef.current?.value ?? "").trim(),
                    produtos: (produtosRef.current?.value ?? "").trim(),
                    prazo: (prazoRef.current?.value ?? "").trim(),
                    pagamento: (pagamentoRef.current?.value ?? "").trim(),
                    observacoes: (obsRef.current?.value ?? "").trim(),
                    active: (statusRef.current?.value ?? "Ativo") !== "Inativo",
                  });
                  await refresh();
                  setEditing(null);
                  m.close();
                  window.alert("Salvo com sucesso");
                } catch (e) {
                  window.alert(e instanceof Error ? e.message : "Não foi possível salvar fornecedor");
                }
              });
            }}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Salvando…" : "Salvar fornecedor"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

/* ───── TÉCNICOS ───── */
function TecnicosPanel({
  storeId,
  autoOpen,
  onAutoOpenConsumed,
}: {
  storeId: string;
  autoOpen?: boolean;
  onAutoOpenConsumed?: () => void;
}) {
  const m = useToggle();
  const [rows, setRows] = useState<TecnicoDTO[]>([]);
  const [filterQuery, setFilterQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [editing, setEditing] = useState<TecnicoDTO | null>(null);

  const nomeRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const telRef = useRef<HTMLInputElement | null>(null);
  const cargoRef = useRef<HTMLInputElement | null>(null);
  const especialidadeRef = useRef<HTMLInputElement | null>(null);
  const comissaoRef = useRef<HTMLInputElement | null>(null);
  const permissaoRef = useRef<HTMLSelectElement | null>(null);
  const statusRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    if (autoOpen) {
      m.openIt();
      onAutoOpenConsumed?.();
    }
  }, [autoOpen, onAutoOpenConsumed, m]);

  const refresh = useMemo(
    () => async () => {
      setLoading(true);
      setErr(null);
      try {
        const data = await listTecnicos(storeId);
        setRows(data);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Falha ao carregar técnicos");
      } finally {
        setLoading(false);
      }
    },
    [storeId]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleRows = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((t) =>
      [t.name, t.email, t.phone, t.role, t.specialty].join(" ").toLowerCase().includes(q)
    );
  }, [rows, filterQuery]);

  return (
    <div className="w-full min-w-0">
      <Toolbar
        count={visibleRows.length}
        label="técnicos / funcionários"
        onNew={m.openIt}
        filterQuery={filterQuery}
        onFilterQueryChange={setFilterQuery}
      />
      {loading && <div className="mb-3 text-sm text-muted-foreground">Carregando técnicos…</div>}
      {err && <div className="mb-3 text-sm text-destructive">{err}</div>}
      <div className="grid min-w-0 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {visibleRows.map((t) => (
          <Card
            key={t.id}
            className="p-5"
            onClick={() => {
              setEditing(t);
              m.openIt();
            }}
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/10 text-primary text-base font-semibold">
                {t.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-foreground">{t.name}</div>
                <div className="truncate text-xs text-muted-foreground">{t.role || "—"}</div>
              </div>
              <button
                disabled={saving}
                className="inline-flex"
                title="Ativar/Inativar"
                onClick={(e) => {
                  e.stopPropagation();
                  startSaving(async () => {
                    try {
                      await upsertTecnico(storeId, {
                        id: t.id,
                        name: t.name,
                        email: t.email,
                        phone: t.phone,
                        role: t.role,
                        specialty: t.specialty,
                        commissionPercent: t.commissionPercent,
                        active: !t.active,
                      });
                      await refresh();
                    } catch (e2) {
                      window.alert(e2 instanceof Error ? e2.message : "Não foi possível atualizar status");
                    }
                  });
                }}
              >
                <Badge tone={t.active ? "success" : "default"}>{t.active ? "Ativo" : "Inativo"}</Badge>
              </button>
            </div>
            <div className="mt-4 text-xs text-muted-foreground">Especialidade</div>
            <div className="text-sm text-foreground">{t.specialty || "—"}</div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-surface py-2">
                <div className="text-[10px] uppercase text-muted-foreground">Abertas</div>
                <div className="text-sm font-bold text-foreground">0</div>
              </div>
              <div className="rounded-lg bg-surface py-2">
                <div className="text-[10px] uppercase text-muted-foreground">Concluídas</div>
                <div className="text-sm font-bold text-foreground">0</div>
              </div>
              <div className="rounded-lg bg-surface py-2">
                <div className="text-[10px] uppercase text-muted-foreground">Tempo</div>
                <div className="text-sm font-bold text-foreground">—</div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs">
              <Badge tone="primary">{t.role || "Técnico"}</Badge>
              <span className="text-muted-foreground">Comissão {Number(t.commissionPercent || 0)}%</span>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={m.open}
        onClose={() => {
          setEditing(null);
          m.close();
        }}
        title={editing ? "Editar técnico / funcionário" : "Novo técnico / funcionário"}
        size="lg"
      >
        <div className="grid grid-cols-2 gap-4" key={m.open ? "open" : "closed"}>
          <Field label="Nome" span={2}><Input ref={nomeRef} defaultValue={editing?.name ?? ""} /></Field>
          <Field label="Email"><Input ref={emailRef} defaultValue={editing?.email ?? ""} /></Field>
          <Field label="Telefone"><Input ref={telRef} defaultValue={editing?.phone ?? ""} /></Field>
          <Field label="Cargo"><Input ref={cargoRef} defaultValue={editing?.role ?? ""} placeholder="Técnico Sênior" /></Field>
          <Field label="Especialidades"><Input ref={especialidadeRef} defaultValue={editing?.specialty ?? ""} placeholder="Microsoldagem, Telas…" /></Field>
          <Field label="Comissão (%)"><Input ref={comissaoRef} defaultValue={editing ? String(editing.commissionPercent) : ""} placeholder="10" /></Field>
          <Field label="Permissão">
            <Select ref={permissaoRef} defaultValue={editing?.role || "Técnico"}>
              <option>Técnico</option>
              <option>Atendente</option>
              <option>Caixa</option>
              <option>Gerente</option>
              <option>Administrador</option>
            </Select>
          </Field>
          <Field label="Status" span={2}>
            <Select ref={statusRef} defaultValue={editing?.active === false ? "Inativo" : "Ativo"}>
              <option>Ativo</option>
              <option>Inativo</option>
            </Select>
          </Field>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={() => {
              setEditing(null);
              m.close();
            }}
            className="rounded-lg border border-border px-4 py-2 text-sm"
          >
            Cancelar
          </button>
          <button
            disabled={saving}
            onClick={() => {
              startSaving(async () => {
                try {
                  const commission = Number(String(comissaoRef.current?.value ?? "").replace(",", "."));
                  const role =
                    (cargoRef.current?.value ?? "").trim() ||
                    (permissaoRef.current?.value ?? "").trim();

                  await upsertTecnico(storeId, {
                    id: editing?.id,
                    name: (nomeRef.current?.value ?? "").trim(),
                    email: (emailRef.current?.value ?? "").trim(),
                    phone: (telRef.current?.value ?? "").trim(),
                    role,
                    specialty: (especialidadeRef.current?.value ?? "").trim(),
                    commissionPercent: Number.isFinite(commission) ? commission : 0,
                    active: (statusRef.current?.value ?? "Ativo") !== "Inativo",
                  });
                  await refresh();
                  setEditing(null);
                  m.close();
                  window.alert("Salvo com sucesso");
                } catch (e) {
                  window.alert(e instanceof Error ? e.message : "Não foi possível salvar");
                }
              });
            }}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

/* ───── EQUIPAMENTOS ───── */
function EquipamentosPanel({
  storeId,
  autoOpen,
  onAutoOpenConsumed,
}: {
  storeId: string;
  autoOpen?: boolean;
  onAutoOpenConsumed?: () => void;
}) {
  const m = useToggle();
  const [rows, setRows] = useState<EquipamentoModeloDTO[]>([]);
  const [filterQuery, setFilterQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [editing, setEditing] = useState<EquipamentoModeloDTO | null>(null);

  const nameRef = useRef<HTMLInputElement | null>(null);
  const brandRef = useRef<HTMLInputElement | null>(null);
  const typeRef = useRef<HTMLInputElement | null>(null);
  const yearRef = useRef<HTMLInputElement | null>(null);
  const tempoRef = useRef<HTMLInputElement | null>(null);
  const partsRef = useRef<HTMLTextAreaElement | null>(null);
  const defectsRef = useRef<HTMLTextAreaElement | null>(null);
  const checklistRef = useRef<HTMLTextAreaElement | null>(null);
  const statusRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    if (autoOpen) {
      m.openIt();
      onAutoOpenConsumed?.();
    }
  }, [autoOpen, onAutoOpenConsumed, m]);

  const refresh = useMemo(
    () => async () => {
      setLoading(true);
      setErr(null);
      try {
        const data = await listEquipamentosModelos(storeId);
        setRows(data);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Falha ao carregar equipamentos");
      } finally {
        setLoading(false);
      }
    },
    [storeId]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleRows = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((e) => [e.name, e.brand, e.type].join(" ").toLowerCase().includes(q));
  }, [rows, filterQuery]);

  return (
    <div className="w-full min-w-0">
      <Toolbar
        count={visibleRows.length}
        label="equipamentos / modelos"
        onNew={() => {
          setEditing(null);
          m.openIt();
        }}
        filterQuery={filterQuery}
        onFilterQueryChange={setFilterQuery}
      />
      {loading && <div className="mb-3 text-sm text-muted-foreground">Carregando equipamentos…</div>}
      {err && <div className="mb-3 text-sm text-destructive">{err}</div>}
      <div className="grid min-w-0 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {visibleRows.map((e) => (
          <Card
            key={e.id}
            className="overflow-hidden"
            onClick={() => {
              setEditing(e);
              m.openIt();
            }}
          >
            <div className="flex min-w-0 items-center gap-3 border-b border-border bg-surface p-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Smartphone className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-foreground">{e.name}</div>
                <div className="truncate text-xs text-muted-foreground">{e.brand} • {e.type} • {e.year || "—"}</div>
              </div>
              <button
                disabled={saving}
                className="inline-flex"
                title="Ativar/Inativar"
                onClick={(ev) => {
                  ev.stopPropagation();
                  startSaving(async () => {
                    try {
                      await upsertEquipamentoModelo(storeId, {
                        id: e.id,
                        name: e.name,
                        brand: e.brand,
                        type: e.type,
                        year: e.year,
                        averageRepairTime: e.averageRepairTime,
                        compatibleParts: e.compatibleParts,
                        commonDefects: e.commonDefects,
                        recommendedChecklist: e.recommendedChecklist,
                        active: !e.active,
                      });
                      await refresh();
                    } catch (e2) {
                      window.alert(e2 instanceof Error ? e2.message : "Não foi possível atualizar status");
                    }
                  });
                }}
              >
                <Badge tone={e.active ? "info" : "default"}>{e.active ? (e.averageRepairTime || "—") : "Inativo"}</Badge>
              </button>
            </div>
            <div className="space-y-3 p-4 text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Peças compatíveis</div>
                <div className="mt-1 flex flex-wrap gap-1">{(e.compatibleParts || []).map((p) => <Badge key={p}>{p}</Badge>)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Defeitos comuns</div>
                <div className="mt-1 flex flex-wrap gap-1">{(e.commonDefects || []).map((p) => <Badge key={p} tone="warning">{p}</Badge>)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Checklist recomendado</div>
                <div className="mt-1 flex flex-wrap gap-1">{(e.recommendedChecklist || []).map((p) => <Badge key={p} tone="success">{p}</Badge>)}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Badge tone="primary"><Sparkles className="mr-1 inline h-3 w-3" />Base IA</Badge>
                <Badge tone="info">Diagnóstico</Badge>
                <Badge tone="success">Marketing IA</Badge>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  disabled
                  title="Usar no diagnóstico IA — em breve"
                  className="flex flex-1 cursor-not-allowed items-center justify-center gap-1 rounded-md bg-primary/10 px-2 py-1.5 text-[11px] font-medium text-muted-foreground opacity-50"
                >
                  <Sparkles className="h-3 w-3" /> Usar no diagnóstico IA
                </button>
                <button
                  disabled
                  title="Gerar conteúdo Marketing — em breve"
                  className="flex flex-1 cursor-not-allowed items-center justify-center gap-1 rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-muted-foreground opacity-50"
                >
                  Gerar conteúdo Marketing
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={m.open}
        onClose={() => {
          setEditing(null);
          m.close();
        }}
        title={editing ? "Editar equipamento / modelo" : "Novo equipamento / modelo"}
        subtitle="Cadastro de modelos e base de diagnóstico."
        size="lg"
      >
        <div className="grid grid-cols-2 gap-4" key={m.open ? "open" : "closed"}>
          <Field label="Nome / Modelo" span={2}><Input ref={nameRef} defaultValue={editing?.name ?? ""} placeholder="iPhone 11" /></Field>
          <Field label="Marca"><Input ref={brandRef} defaultValue={editing?.brand ?? ""} placeholder="Apple" /></Field>
          <Field label="Tipo"><Input ref={typeRef} defaultValue={editing?.type ?? ""} placeholder="Smartphone" /></Field>
          <Field label="Ano"><Input ref={yearRef} defaultValue={editing ? String(editing.year || "") : ""} placeholder="2019" /></Field>
          <Field label="Tempo médio"><Input ref={tempoRef} defaultValue={editing?.averageRepairTime ?? ""} placeholder="1h" /></Field>
          <Field label="Status"><Select ref={statusRef} defaultValue={editing?.active === false ? "Inativo" : "Ativo"}><option>Ativo</option><option>Inativo</option></Select></Field>
          <Field label="Peças compatíveis" span={2}><Textarea ref={partsRef} rows={3} defaultValue={(editing?.compatibleParts ?? []).join(", ")} placeholder="Tela, Bateria, Conector..." /></Field>
          <Field label="Defeitos comuns" span={2}><Textarea ref={defectsRef} rows={3} defaultValue={(editing?.commonDefects ?? []).join(", ")} placeholder="Não carrega, Tela quebrada..." /></Field>
          <Field label="Checklist recomendado" span={2}><Textarea ref={checklistRef} rows={3} defaultValue={(editing?.recommendedChecklist ?? []).join(", ")} placeholder="Testar touch, Testar carga..." /></Field>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={() => {
              setEditing(null);
              m.close();
            }}
            className="rounded-lg border border-border px-4 py-2 text-sm"
          >
            Cancelar
          </button>
          <button
            disabled={saving}
            onClick={() => {
              startSaving(async () => {
                try {
                  const year = Number(String(yearRef.current?.value ?? "").replace(/[^\d]/g, ""));
                  const parts = (partsRef.current?.value ?? "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const defects = (defectsRef.current?.value ?? "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const checklist = (checklistRef.current?.value ?? "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);

                  await upsertEquipamentoModelo(storeId, {
                    id: editing?.id,
                    name: (nameRef.current?.value ?? "").trim(),
                    brand: (brandRef.current?.value ?? "").trim(),
                    type: (typeRef.current?.value ?? "").trim(),
                    year: Number.isFinite(year) ? year : 0,
                    averageRepairTime: (tempoRef.current?.value ?? "").trim(),
                    compatibleParts: parts,
                    commonDefects: defects,
                    recommendedChecklist: checklist,
                    active: (statusRef.current?.value ?? "Ativo") !== "Inativo",
                  });
                  await refresh();
                  setEditing(null);
                  m.close();
                  window.alert("Salvo com sucesso");
                } catch (e) {
                  window.alert(e instanceof Error ? e.message : "Não foi possível salvar");
                }
              });
            }}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

/* ───── CATEGORIAS ───── */
function CategoriasPanel({ storeId }: { storeId: string }) {
  const m = useToggle();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [cats, setCats] = useState<CategoriaCadastroDTO[]>([]);
  const [brands, setBrands] = useState<MarcaCadastroDTO[]>([]);
  const [mode, setMode] = useState<"categoria" | "marca">("categoria");
  const [catType, setCatType] = useState<"produto" | "servico" | "equipamento" | "geral">("produto");
  const [editingId, setEditingId] = useState<string | null>(null);

  const nomeRef = useRef<HTMLInputElement | null>(null);
  const typeRef = useRef<HTMLSelectElement | null>(null);
  const statusRef = useRef<HTMLSelectElement | null>(null);

  const editingCategoria = useMemo(
    () => (editingId ? cats.find((c) => c.id === editingId) ?? null : null),
    [cats, editingId]
  );
  const editingMarca = useMemo(
    () => (editingId ? brands.find((b) => b.id === editingId) ?? null : null),
    [brands, editingId]
  );

  const modalNameDefault = mode === "marca" ? (editingMarca?.name ?? "") : (editingCategoria?.name ?? "");
  const modalTypeDefault = editingCategoria?.type ?? catType;
  const modalStatusDefault =
    mode === "marca"
      ? (editingMarca?.active === false ? "Inativo" : "Ativo")
      : (editingCategoria?.active === false ? "Inativo" : "Ativo");

  const refresh = useMemo(
    () => async () => {
      setLoading(true);
      setErr(null);
      try {
        const [c, b] = await Promise.all([listCategorias(storeId), listMarcas(storeId)]);
        setCats(c);
        setBrands(b);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Falha ao carregar categorias/marcas");
      } finally {
        setLoading(false);
      }
    },
    [storeId]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const itemsFor = (kind: "produto" | "servico" | "equipamento" | "geral") =>
    cats.filter((c) => c.active && c.type === kind).map((c) => c.name);

  const groups = [
    { l: "Categorias de produtos", items: itemsFor("produto"), t: "primary" as const, kind: "categoria" as const, catType: "produto" as const },
    { l: "Categorias de serviços", items: itemsFor("servico"), t: "info" as const, kind: "categoria" as const, catType: "servico" as const },
    { l: "Marcas", items: brands.filter((b) => b.active).map((b) => b.name), t: "success" as const, kind: "marca" as const, catType: "geral" as const },
    { l: "Linhas de equipamentos", items: itemsFor("equipamento"), t: "warning" as const, kind: "categoria" as const, catType: "equipamento" as const },
    { l: "Tags globais", items: itemsFor("geral"), t: "default" as const, kind: "categoria" as const, catType: "geral" as const },
  ];
  return (
    <div className="grid w-full min-w-0 gap-6 md:grid-cols-2">
      {loading && <div className="text-sm text-muted-foreground">Carregando categorias…</div>}
      {err && <div className="text-sm text-destructive">{err}</div>}
      {groups.map((g) => (
        <Card key={g.l} className="p-6">
          <SectionTitle
            title={g.l}
            action={
              <button
                className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                onClick={() => {
                  setMode(g.kind);
                  setCatType(g.catType);
                  setEditingId(null);
                  m.openIt();
                }}
              >
                <Plus className="h-3 w-3" /> Novo
              </button>
            }
          />
          <div className="flex flex-wrap gap-2">
            {g.items.map((i) => (
              <span
                key={i}
                className="group flex cursor-pointer items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                onClick={() => {
                  if (g.kind === "marca") {
                    const b = brands.find((x) => x.name === i);
                    if (!b) return;
                    setMode("marca");
                    setEditingId(b.id);
                    setCatType("geral");
                    m.openIt();
                    return;
                  }
                  const c = cats.find((x) => x.name === i && x.type === g.catType);
                  if (!c) return;
                  setMode("categoria");
                  setEditingId(c.id);
                  setCatType(g.catType);
                  m.openIt();
                }}
              >
                <Badge tone={g.t}>•</Badge>
                {i}
                <button
                  className="ml-1 text-muted-foreground opacity-0 group-hover:opacity-100"
                  title="Inativar"
                  onClick={(e) => {
                    e.stopPropagation();
                    startSaving(async () => {
                      try {
                        if (g.kind === "marca") {
                          const b = brands.find((x) => x.name === i);
                          if (!b) return;
                          await upsertMarca(storeId, { id: b.id, name: b.name, type: b.type, active: false });
                        } else {
                          const c = cats.find((x) => x.name === i && x.type === g.catType);
                          if (!c) return;
                          await upsertCategoria(storeId, { id: c.id, name: c.name, type: c.type, active: false });
                        }
                        await refresh();
                      } catch (e2) {
                        window.alert(e2 instanceof Error ? e2.message : "Não foi possível inativar");
                      }
                    });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        </Card>
      ))}

      <Modal
        open={m.open}
        onClose={() => {
          setEditingId(null);
          m.close();
        }}
        title={mode === "marca" ? (editingId ? "Editar marca" : "Nova marca") : (editingId ? "Editar categoria" : "Nova categoria")}
        size="md"
      >
        <div className="grid grid-cols-2 gap-4" key={m.open ? "open" : "closed"}>
          <Field label="Nome" span={2}>
            <Input ref={nomeRef} defaultValue={modalNameDefault} />
          </Field>
          {mode === "categoria" && (
            <Field label="Tipo" span={2}>
              <Select ref={typeRef} defaultValue={modalTypeDefault}>
                <option value="produto">produto</option>
                <option value="servico">servico</option>
                <option value="equipamento">equipamento</option>
                <option value="geral">geral</option>
              </Select>
            </Field>
          )}
          <Field label="Status" span={2}>
            <Select ref={statusRef} defaultValue={modalStatusDefault}>
              <option>Ativo</option>
              <option>Inativo</option>
            </Select>
          </Field>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={() => {
              setEditingId(null);
              m.close();
            }}
            className="rounded-lg border border-border px-4 py-2 text-sm"
          >
            Cancelar
          </button>
          <button
            disabled={saving}
            onClick={() => {
              startSaving(async () => {
                try {
                  const name = (nomeRef.current?.value ?? "").trim();
                  const active = (statusRef.current?.value ?? "Ativo") !== "Inativo";
                  if (mode === "marca") {
                    await upsertMarca(storeId, {
                      id: editingMarca?.id,
                      name,
                      type: editingMarca?.type ?? "",
                      active,
                    });
                  } else {
                    const rawType = (typeRef.current?.value ?? catType).trim();
                    const t =
                      rawType === "produto" || rawType === "servico" || rawType === "equipamento" || rawType === "geral"
                        ? rawType
                        : "geral";
                    await upsertCategoria(storeId, {
                      id: editingCategoria?.id,
                      name,
                      type: t,
                      active,
                    });
                  }
                  await refresh();
                  setEditingId(null);
                  m.close();
                  window.alert("Salvo com sucesso");
                } catch (e) {
                  window.alert(e instanceof Error ? e.message : "Não foi possível salvar");
                }
              });
            }}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

/* ───── IMPORTAÇÃO ───── */
// Hub completo: Planilhas (real) + XML NF-e (preparatório) + Histórico.
// Implementação em ./ImportacaoHub.tsx — substitui o ImportFlow mock antigo.
function ImportacaoPanel() {
  return <ImportacaoHub />;
}

/* ───── AUDITORIA ───── */
function AuditoriaPanel() {
  const [logs, setLogs] = useState<AuditoriaItemDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listLogsAuditoriaCadastros()
      .then(setLogs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="w-full min-w-0">
      <Toolbar count={logs.length} label="eventos" />
      <Card className="p-6">
        {loading && <div className="text-sm text-muted-foreground">Carregando auditoria…</div>}
        {!loading && logs.length === 0 && <div className="text-sm text-muted-foreground">Nenhum evento registrado.</div>}
        <ol className="relative ml-3 space-y-6 border-l border-border pl-6">
          {logs.map((a) => (
            <li key={a.id} className="relative">
              <span className="absolute -left-[31px] top-1 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                <span className="h-2 w-2 rounded-full bg-primary-foreground" />
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="primary">{a.acao}</Badge>
                <span className="font-medium text-foreground">{a.entidade}</span>
                <span className="text-xs text-muted-foreground">por {a.usuario}</span>
                <span className="ml-auto text-xs text-muted-foreground">{a.data}</span>
              </div>
              <div className="mt-2 grid gap-2 rounded-xl border border-border bg-background p-3 text-xs md:grid-cols-2">
                {a.antes && <div><span className="text-muted-foreground">Antes:</span> <span className="text-foreground">{a.antes}</span></div>}
                <div className={a.antes ? "" : "md:col-span-2"}><span className="text-muted-foreground">Detalhe:</span> <span className="text-foreground">{a.depois}</span></div>
                <div className="md:col-span-2 text-muted-foreground">Origem: <span className="font-mono">{a.ip}</span></div>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
