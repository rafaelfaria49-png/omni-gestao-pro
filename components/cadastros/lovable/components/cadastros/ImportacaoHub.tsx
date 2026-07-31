"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileSpreadsheet,
  FileCode,
  History,
  Users,
  Package,
  Truck,
  HardHat,
  Smartphone,
  Wrench,
  ClipboardList,
  Receipt,
  Upload,
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Sparkles,
  Layers,
  ShieldCheck,
  FileWarning,
  ArrowRight,
  Boxes,
} from "lucide-react";

import { Badge, Card, SectionTitle } from "./ui-kit";
import { ConferenciaLoteProdutos } from "./ConferenciaLoteProdutos";
import { RoadmapPreviewDialog } from "@/components/ui/roadmap-preview-dialog";
import { AppOpsProviders } from "@/components/dashboard/app-ops-providers";
import { useLojaAtiva } from "@/lib/loja-ativa";
import { ImportadorAvancado } from "@/components/dashboard/configuracoes/importador-avancado/ImportadorAvancado";
import { ImportadorProdutos } from "@/components/dashboard/configuracoes/importador-produtos/ImportadorProdutos";
import {
  listImportacoesAuditoria,
  type ImportacaoAuditoriaDTO,
} from "@/app/actions/cadastros";

// ============================================================
// ImportacaoHub
//
// Substitui o ImportacaoPanel mock antigo do CadastrosHub.
// Estrutura:
//   - Planilhas:  reaproveita o ImportadorAvancado real (CSV/XLSX/ZIP)
//   - XML NF-e:   wizard preparatório (parser experimental, NÃO persiste)
//   - Histórico:  lê LogsAuditoria filtrado por action LIKE "import.%"
//
// Sem mock enganoso: o XML faz preview real (DOMParser de det/prod) mas
// avisa explicitamente que não grava no banco; o histórico tem empty state
// honesto quando nenhuma importação foi registrada ainda.
// ============================================================

type SubTab = "planilhas" | "produtos" | "xml" | "historico";

const SUBTABS: Array<{ id: SubTab; label: string; icon: typeof FileSpreadsheet; hint: string }> = [
  { id: "planilhas", label: "Planilhas", icon: FileSpreadsheet, hint: "CSV · XLSX · ZIP GestaoClick" },
  { id: "produtos", label: "Produtos (lotes)", icon: Package, hint: "XLS legado · lotes de 500" },
  { id: "xml", label: "XML NF-e", icon: FileCode, hint: "Entrada de mercadoria (preparação)" },
  { id: "historico", label: "Histórico", icon: History, hint: "Lotes e auditoria" },
];

export function ImportacaoHub() {
  const [sub, setSub] = useState<SubTab>("planilhas");
  /** Lote aberto na conferência pós-importação (Parte 9). */
  const [loteConferencia, setLoteConferencia] = useState<string | null>(null);

  const abrirConferencia = useCallback((batchId: string) => {
    if (!batchId) return;
    setLoteConferencia(batchId);
    setSub("historico");
  }, []);

  return (
    <div className="w-full min-w-0 space-y-6">
      <HeaderResumo onJump={setSub} active={sub} />

      <div className="w-full min-w-0 overflow-x-auto">
        <div className="flex min-w-0 items-center gap-1 rounded-xl border border-border bg-card p-1">
          {SUBTABS.map((s) => {
            const Icon = s.icon;
            const active = sub === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSub(s.id)}
                aria-pressed={active}
                className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate font-medium">{s.label}</span>
                <span className="hidden truncate text-xs opacity-70 md:inline">· {s.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      {sub === "planilhas" && (
        <PlanilhasSection
          onSwitchToProdutosLotes={() => setSub("produtos")}
          onRevisarLoteProdutos={abrirConferencia}
        />
      )}
      {sub === "produtos" && <ProdutosLotesSection />}
      {sub === "xml" && <XmlNfeSection />}
      {sub === "historico" && (
        <HistoricoSection
          loteConferencia={loteConferencia}
          onAbrirConferencia={setLoteConferencia}
          onFecharConferencia={() => setLoteConferencia(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header de resumo (3 mini KPIs reais via histórico)
// ─────────────────────────────────────────────────────────────────────────────

function HeaderResumo({
  onJump,
  active,
}: {
  onJump: (s: SubTab) => void;
  active: SubTab;
}) {
  const [logs, setLogs] = useState<ImportacaoAuditoriaDTO[] | null>(null);

  useEffect(() => {
    let alive = true;
    listImportacoesAuditoria(50)
      .then((rows) => {
        if (alive) setLogs(rows);
      })
      .catch(() => {
        if (alive) setLogs([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const totais = useMemo(() => {
    const list = logs ?? [];
    const totalLotes = list.length;
    const ultimo = list[0];
    const ultimoQuando = ultimo?.dataIso ? formatRelativo(ultimo.dataIso) : "—";
    const registrosCriados = list.reduce(
      (acc, r) => acc + (r.totais?.criados ?? 0) + (r.totais?.atualizados ?? 0),
      0,
    );
    return { totalLotes, ultimoQuando, ultimoOk: ultimo?.status, registrosCriados };
  }, [logs]);

  const cards: Array<{
    label: string;
    value: string;
    sub: string;
    icon: typeof FileSpreadsheet;
    target: SubTab;
    tone?: "ok" | "alert" | "info";
  }> = [
    {
      label: "Lotes registrados",
      value: logs == null ? "…" : String(totais.totalLotes),
      sub: totais.totalLotes === 0 ? "Nenhuma importação ainda" : "via Importador Avançado",
      icon: Layers,
      target: "historico",
      tone: "info",
    },
    {
      label: "Última importação",
      value: totais.ultimoQuando,
      sub:
        totais.ultimoOk === "erro"
          ? "Com erros — revisar"
          : totais.ultimoOk === "ok"
            ? "Concluída sem erros"
            : "—",
      icon: Clock,
      target: "historico",
      tone: totais.ultimoOk === "erro" ? "alert" : "ok",
    },
    {
      label: "Registros consolidados",
      value:
        logs == null
          ? "…"
          : totais.registrosCriados.toLocaleString("pt-BR"),
      sub: "criados + atualizados",
      icon: Boxes,
      target: "historico",
      tone: "info",
    },
  ];

  return (
    <div className="grid w-full min-w-0 gap-3 md:grid-cols-3">
      {cards.map((c) => {
        const Icon = c.icon;
        const isActive = active === c.target;
        return (
          <button
            key={c.label}
            type="button"
            onClick={() => onJump(c.target)}
            className={`group flex min-w-0 items-start gap-3 rounded-2xl border bg-card p-4 text-left transition hover:border-primary/60 hover:shadow-sm ${
              isActive ? "border-primary/50 ring-1 ring-primary/30" : "border-border"
            }`}
          >
            <div
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                c.tone === "alert"
                  ? "bg-[color-mix(in_oklab,var(--destructive)_15%,transparent)] text-[color:var(--destructive)]"
                  : c.tone === "ok"
                    ? "bg-[color-mix(in_oklab,var(--success)_18%,transparent)] text-[color:var(--success)]"
                    : "bg-primary/10 text-primary"
              }`}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs uppercase tracking-wide text-muted-foreground">{c.label}</div>
              <div className="mt-0.5 truncate text-2xl font-semibold text-foreground">{c.value}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{c.sub}</div>
            </div>
            <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCO 1 — Planilhas
// ─────────────────────────────────────────────────────────────────────────────

const DOMINIOS_PLANILHA = [
  { l: "Produtos", icon: Package },
  { l: "Clientes", icon: Users },
  { l: "Fornecedores", icon: Truck },
  { l: "Serviços", icon: Wrench },
  { l: "Técnicos", icon: HardHat },
  { l: "Equipamentos", icon: Smartphone },
  { l: "Ordens de Serviço", icon: ClipboardList },
  { l: "Financeiro", icon: Receipt },
] as const;

function PlanilhasSection({
  onSwitchToProdutosLotes,
  onRevisarLoteProdutos,
}: {
  onSwitchToProdutosLotes?: () => void;
  onRevisarLoteProdutos?: (batchId: string) => void;
}) {
  return (
    <div className="grid w-full min-w-0 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card className="p-5">
          <SectionTitle
            title="Importação por planilhas"
            subtitle="Detecção automática de domínio, preview de cruzamento e auditoria por lote."
            action={<Badge tone="success">Em produção</Badge>}
          />
          <AppOpsProviders>
            <ImportadorAvancado
              onSwitchToProdutosLotes={onSwitchToProdutosLotes}
              onRevisarLoteProdutos={onRevisarLoteProdutos}
            />
          </AppOpsProviders>
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="p-5">
          <SectionTitle title="O que pode ser importado" subtitle="Domínios reconhecidos pelo detector." />
          <ul className="grid gap-2">
            {DOMINIOS_PLANILHA.map((d) => {
              const Ic = d.icon;
              return (
                <li
                  key={d.l}
                  className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2"
                >
                  <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/10 text-primary">
                    <Ic className="h-4 w-4" />
                  </div>
                  <span className="truncate text-sm text-foreground">{d.l}</span>
                  <CheckCircle2 className="ml-auto h-4 w-4 text-[color:var(--success)]" />
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="p-5">
          <SectionTitle title="Formatos aceitos" />
          <div className="flex flex-wrap gap-2">
            {["CSV", "XLSX", "XLS", "ODS", "TSV", "ZIP"].map((f) => (
              <Badge key={f} tone="primary">
                {f}
              </Badge>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Backups do GestaoClick (ZIP) são detectados automaticamente. Múltiplos arquivos podem ser
            enviados em um único lote.
          </p>
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCO 1.5 — Produtos em lotes (planilhas grandes / XLS legado)
// ─────────────────────────────────────────────────────────────────────────────

function ProdutosLotesSection() {
  return (
    <div className="grid w-full min-w-0 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card className="p-5">
          <SectionTitle
            title="Importação de produtos — lotes manuais"
            subtitle="Para planilhas grandes ou exportações antigas (XLS BIFF). Lote de 500 itens, controlado pelo operador."
            action={<Badge tone="primary">Novo</Badge>}
          />
          <AppOpsProviders>
            <ImportadorProdutos />
          </AppOpsProviders>
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="p-5">
          <SectionTitle
            title="Quando usar este fluxo"
            subtitle="Diferenças em relação a 'Planilhas'."
          />
          <ul className="space-y-2 text-sm text-foreground">
            <li className="rounded-lg border border-border bg-background px-3 py-2">
              Planilha com <strong>milhares de produtos</strong> (4k+).
            </li>
            <li className="rounded-lg border border-border bg-background px-3 py-2">
              Relatórios antigos com <strong>linhas de banner</strong> antes do cabeçalho.
            </li>
            <li className="rounded-lg border border-border bg-background px-3 py-2">
              Quer ver <strong>preview honesto</strong> com válidos, duplicados e linhas ruins
              antes de gravar qualquer coisa.
            </li>
            <li className="rounded-lg border border-border bg-background px-3 py-2">
              Quer <strong>controlar cada lote</strong> — botão por lote, nada automático.
            </li>
          </ul>
        </Card>

        <Card className="p-5">
          <SectionTitle title="O que NUNCA é alterado" />
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            <li>· Estoque de produtos pré-existentes (só ledger auditado muda saldo)</li>
            <li>· Auth / proxy / schema do banco</li>
            <li>· Outras lojas — só a unidade ativa</li>
            <li>· Vendas / OS / financeiro já gravados</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCO 2 — XML NF-e (preparatório, sem persistência)
// ─────────────────────────────────────────────────────────────────────────────

type NFeItemPreview = {
  id: string;
  nome: string;
  codigo: string;
  ncm: string;
  cfop: string;
  quantidade: number;
  valorUnitario: number;
};

type NFeCabecalho = {
  emitente?: string;
  cnpj?: string;
  numero?: string;
  serie?: string;
  dataEmissao?: string;
  chave?: string;
  valorTotal?: number;
};

function safeText(root: Element, selectors: string[]): string {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    const value = el?.textContent?.trim();
    if (value) return value;
  }
  return "";
}

function parseNFeXmlBrowser(xmlText: string): { itens: NFeItemPreview[]; cabecalho: NFeCabecalho; erro: string | null } {
  if (typeof DOMParser === "undefined") {
    return { itens: [], cabecalho: {}, erro: "Leitura XML disponível apenas no navegador." };
  }
  let xml: Document;
  try {
    xml = new DOMParser().parseFromString(xmlText, "application/xml");
  } catch {
    return { itens: [], cabecalho: {}, erro: "Não foi possível interpretar o arquivo como XML." };
  }
  const parseError = xml.getElementsByTagName("parsererror");
  if (parseError.length > 0) {
    return { itens: [], cabecalho: {}, erro: "XML inválido (parser nativo falhou)." };
  }

  const root = xml.documentElement;
  const detNodes = Array.from(root?.querySelectorAll("det") ?? []);
  const itens = detNodes
    .map((det) => {
      const nome = safeText(det, ["prod > xProd", "xProd"]);
      const codigo = safeText(det, ["prod > cProd", "cProd"]) || `XML-${detNodes.indexOf(det)}`;
      const ncm = safeText(det, ["prod > NCM", "NCM"]);
      const cfop = safeText(det, ["prod > CFOP", "CFOP"]) || "";
      const valorUnitario = parseFloat(safeText(det, ["prod > vUnCom", "vUnCom"]).replace(",", ".")) || 0;
      const quantidade = parseFloat(safeText(det, ["prod > qCom", "qCom"]).replace(",", ".")) || 0;
      if (!nome) return null;
      return {
        id: `${codigo}-${nome}`,
        nome,
        codigo,
        ncm,
        cfop,
        quantidade,
        valorUnitario,
      } satisfies NFeItemPreview;
    })
    .filter((p): p is NFeItemPreview => p !== null);

  const cabecalho: NFeCabecalho = {
    emitente: safeText(root, ["emit > xNome", "emit xNome"]) || undefined,
    cnpj: safeText(root, ["emit > CNPJ", "emit CNPJ"]) || undefined,
    numero: safeText(root, ["ide > nNF", "nNF"]) || undefined,
    serie: safeText(root, ["ide > serie", "ide serie"]) || undefined,
    dataEmissao: safeText(root, ["ide > dhEmi", "ide > dEmi"]) || undefined,
    chave: (root?.querySelector("infNFe")?.getAttribute("Id") ?? "").replace(/^NFe/, "") || undefined,
    valorTotal: parseFloat(safeText(root, ["ICMSTot > vNF", "vNF"]).replace(",", ".")) || undefined,
  };

  return { itens, cabecalho, erro: itens.length === 0 ? "Nenhum item (det/prod) encontrado neste XML." : null };
}

function XmlNfeSection() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [itens, setItens] = useState<NFeItemPreview[]>([]);
  const [cabecalho, setCabecalho] = useState<NFeCabecalho>({});
  const [erro, setErro] = useState<string | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [showRoadmap, setShowRoadmap] = useState(false);

  const limpar = useCallback(() => {
    setArquivo(null);
    setItens([]);
    setCabecalho({});
    setErro(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const handleArquivo = useCallback(async (file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xml")) {
      setErro("Formato não suportado. Envie um arquivo .xml da NF-e.");
      setItens([]);
      setCabecalho({});
      setArquivo(null);
      return;
    }
    setAnalisando(true);
    setArquivo(file);
    setErro(null);
    try {
      const text = await file.text();
      const { itens, cabecalho, erro } = parseNFeXmlBrowser(text);
      setItens(itens);
      setCabecalho(cabecalho);
      if (erro) setErro(erro);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao ler o XML.");
    } finally {
      setAnalisando(false);
    }
  }, []);

  const totalValor = itens.reduce((acc, i) => acc + i.quantidade * i.valorUnitario, 0);

  return (
    <div className="grid w-full min-w-0 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {/* Aviso honesto */}
        <div className="border border-border border-l-4 border-l-warning bg-warning/5 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <FileWarning className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                Parser experimental — preview apenas, não persiste no banco
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Esta seção lê o XML da NF-e (tags <code>det/prod</code>) e mostra os itens. Entrada de
                mercadoria, atualização de estoque, vínculo de fornecedor e auditoria fiscal serão
                liberados quando o backend fiscal estiver pronto.
              </p>
            </div>
            <div className="shrink-0">
              <Badge tone="warning">Em desenvolvimento</Badge>
            </div>
          </div>
        </div>

        <Card className="p-5">
          <SectionTitle
            title="Importação XML NF-e (compra)"
            subtitle="Entrada de mercadoria · fornecedor · preço de custo · NCM/GTIN · auditoria."
            action={
              itens.length > 0 ? (
                <button
                  type="button"
                  onClick={limpar}
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                >
                  <RefreshCw className="mr-1 inline h-3 w-3" /> Trocar arquivo
                </button>
              ) : null
            }
          />

          {!arquivo && (
            <div
              className="rounded-2xl border border-border bg-panel/35 hover:bg-panel/50 transition-colors p-8 text-center"
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0] ?? null;
                void handleArquivo(f);
              }}
            >
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
                <Upload className="h-5 w-5" />
              </div>
              <p className="mt-3 text-sm font-medium text-foreground">
                Arraste o XML da NF-e ou clique para selecionar
              </p>
              <p className="text-xs text-muted-foreground">
                Aceitamos apenas .xml de NF-e (modelo 55). Outros formatos virão.
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".xml,application/xml,text/xml"
                className="hidden"
                onChange={(e) => void handleArquivo(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                <FileCode className="h-4 w-4" /> Importar XML
              </button>
            </div>
          )}

          {arquivo && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background p-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <FileCode className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{arquivo.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(arquivo.size / 1024).toFixed(1)} KB ·{" "}
                    {analisando ? "Analisando…" : `${itens.length} item(ns) lido(s)`}
                  </p>
                </div>
                {analisando && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>

              {erro && (
                <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <p className="text-sm text-destructive">{erro}</p>
                </div>
              )}

              {!erro && itens.length > 0 && (
                <>
                  {/* Cabeçalho da NF-e */}
                  <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-background p-3 text-xs md:grid-cols-4">
                    <KeyVal k="Emitente" v={cabecalho.emitente ?? "—"} />
                    <KeyVal k="CNPJ" v={cabecalho.cnpj ?? "—"} />
                    <KeyVal k="Nº NF-e" v={cabecalho.numero ?? "—"} />
                    <KeyVal k="Série" v={cabecalho.serie ?? "—"} />
                    <KeyVal k="Emissão" v={cabecalho.dataEmissao ?? "—"} />
                    <KeyVal
                      k="Valor NF"
                      v={
                        cabecalho.valorTotal != null
                          ? cabecalho.valorTotal.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })
                          : "—"
                      }
                    />
                    <KeyVal k="Chave" v={cabecalho.chave ?? "—"} className="md:col-span-2" mono />
                  </div>

                  {/* Tabela de itens */}
                  <div className="overflow-hidden rounded-xl border border-border bg-card">
                    <div className="max-h-[420px] overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface text-xs uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="px-4 py-3 text-left font-medium">Produto</th>
                            <th className="px-4 py-3 text-left font-medium">Cód.</th>
                            <th className="px-4 py-3 text-left font-medium">NCM</th>
                            <th className="px-4 py-3 text-left font-medium">CFOP</th>
                            <th className="px-4 py-3 text-right font-medium">Qtd</th>
                            <th className="px-4 py-3 text-right font-medium">V. unit</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {itens.map((it) => (
                            <tr key={it.id} className="hover:bg-accent/40">
                              <td className="px-4 py-3 text-foreground">{it.nome}</td>
                              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{it.codigo}</td>
                              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{it.ncm || "—"}</td>
                              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{it.cfop || "—"}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-foreground">
                                {it.quantidade.toLocaleString("pt-BR")}
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums text-foreground">
                                {it.valorUnitario.toLocaleString("pt-BR", {
                                  style: "currency",
                                  currency: "BRL",
                                })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={4} className="px-4 py-3 text-right text-xs text-muted-foreground">
                              Total estimado dos itens:
                            </td>
                            <td className="px-4 py-3 text-right text-xs text-muted-foreground" />
                            <td className="px-4 py-3 text-right font-semibold text-foreground">
                              {totalValor.toLocaleString("pt-BR", {
                                style: "currency",
                                currency: "BRL",
                              })}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-panel p-3 text-xs">
                    <p className="min-w-0 flex-1 text-muted-foreground">
                      Preview lido pelo parser experimental. A gravação e entrada no estoque serão liberadas no backend fiscal definitivo.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowRoadmap(true)}
                      className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-accent transition"
                    >
                      Confirmar entrada
                    </button>
                  </div>

                  {showRoadmap && (
                    <RoadmapPreviewDialog
                      open={showRoadmap}
                      onOpenChange={setShowRoadmap}
                      title="Entrada de Mercadoria & Integração SEFAZ"
                      description="Importe arquivos XML de fornecedores com consulta automática à SEFAZ, correspondência inteligente de itens (De-Para) e atualização automática de custos e estoques."
                      phase="desenvolvimento"
                      icon={FileCode}
                      features={[
                        "Consulta à SEFAZ automática por chave de acesso",
                        "Vínculo inteligente de fornecedores e produtos cadastrados",
                        "Atualização em lote do preço de custo, NCM e estoque",
                        "Lançamento automático de contas a pagar no financeiro",
                      ]}
                      targetRelease="Fase 2 - Módulo Fiscal"
                    />
                  )}
                </>
              )}
            </div>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="p-5">
          <SectionTitle title="Planejado" subtitle="Próximas capacidades do XML NF-e." />
          <ul className="space-y-2 text-sm">
            {[
              { l: "Entrada de mercadoria no estoque", i: Package },
              { l: "Vínculo automático de fornecedor (CNPJ)", i: Truck },
              { l: "Preview de itens com De-Para de produtos", i: Layers },
              { l: "Atualização de preço de custo + NCM/CFOP", i: Receipt },
              { l: "Auditoria fiscal por chave de acesso", i: ShieldCheck },
            ].map((x) => {
              const Ic = x.i;
              return (
                <li
                  key={x.l}
                  className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                >
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                    <Ic className="h-4 w-4" />
                  </div>
                  <span className="truncate">{x.l}</span>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="p-5">
          <SectionTitle title="Fora deste fluxo (por enquanto)" />
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            <li>· Emissão de NF-e de saída</li>
            <li>· Integração SEFAZ / consulta de chave</li>
            <li>· Lançamento financeiro automático da NF-e</li>
            <li>· Importação fiscal em lote (XMLs)</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function KeyVal({
  k,
  v,
  className = "",
  mono = false,
}: {
  k: string;
  v: string;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div>
      <div className={`truncate text-sm text-foreground ${mono ? "font-mono text-xs" : ""}`} title={v}>
        {v}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCO 3 — Histórico / Auditoria de importações
// ─────────────────────────────────────────────────────────────────────────────

function HistoricoSection({
  loteConferencia,
  onAbrirConferencia,
  onFecharConferencia,
}: {
  loteConferencia: string | null;
  onAbrirConferencia: (batchId: string) => void;
  onFecharConferencia: () => void;
}) {
  const { lojaAtivaId } = useLojaAtiva();
  const [logs, setLogs] = useState<ImportacaoAuditoriaDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const carregar = useCallback(() => {
    setLoading(true);
    setErr(null);
    listImportacoesAuditoria(100)
      .then((rows) => {
        setLogs(rows);
        setLoading(false);
      })
      .catch((e) => {
        setErr(e instanceof Error ? e.message : "Falha ao carregar histórico");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Conferência aberta: ocupa a aba inteira até o operador fechar.
  if (loteConferencia) {
    return (
      <ConferenciaLoteProdutos
        storeId={(lojaAtivaId ?? "").trim()}
        batchId={loteConferencia}
        onFechar={onFecharConferencia}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <SectionTitle
          title="Histórico de importações"
          subtitle="Lotes registrados em auditoria pelo Importador Avançado."
          action={
            <button
              type="button"
              onClick={carregar}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
            </button>
          }
        />

        {loading && <p className="text-sm text-muted-foreground">Carregando histórico…</p>}
        {err && <p className="text-sm text-destructive">{err}</p>}

        {!loading && !err && (logs?.length ?? 0) === 0 && (
          <div className="rounded-2xl border border-border bg-panel/30 shadow-soft p-10 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <p className="mt-3 text-base font-semibold text-foreground">Nenhuma importação registrada ainda</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Cada lote concluído na aba <span className="font-medium text-foreground">Planilhas</span> aparecerá
              aqui automaticamente com totais, duração e domínios afetados.
            </p>
          </div>
        )}

        {!loading && !err && logs && logs.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="max-h-[640px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Data</th>
                    <th className="px-4 py-3 text-left font-medium">Tipo</th>
                    <th className="px-4 py-3 text-left font-medium">Usuário</th>
                    <th className="px-4 py-3 text-left font-medium">Resumo</th>
                    <th className="px-4 py-3 text-right font-medium">Registros</th>
                    <th className="px-4 py-3 text-right font-medium">Duração</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Conferência</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {logs.map((l) => {
                    const totaisRegistros = l.totais ? l.totais.criados + l.totais.atualizados : null;
                    return (
                      <tr key={l.id} className="align-top hover:bg-accent/40">
                        <td className="px-4 py-3 text-foreground">
                          <div className="font-medium">{formatData(l.dataIso)}</div>
                          <div className="text-[11px] text-muted-foreground">{formatRelativo(l.dataIso)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={l.tipo === "XML NF-e" ? "warning" : "primary"}>{l.tipo}</Badge>
                        </td>
                        <td className="px-4 py-3 truncate text-foreground">{l.usuario}</td>
                        <td className="px-4 py-3">
                          <div className="text-foreground">{l.resumo || "—"}</div>
                          {l.porDominio && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {Object.entries(l.porDominio)
                                .slice(0, 6)
                                .map(([dom, t]) => (
                                  <span
                                    key={dom}
                                    className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                  >
                                    {dom}: {t.criados + t.atualizados}
                                    {t.erros > 0 ? ` · ${t.erros}↯` : ""}
                                  </span>
                                ))}
                            </div>
                          )}
                          {l.batchId && (
                            <div className="mt-1 font-mono text-[10px] text-muted-foreground" title={l.batchId}>
                              {l.batchId}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-foreground">
                          {totaisRegistros == null ? "—" : totaisRegistros.toLocaleString("pt-BR")}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {l.duracaoMs == null ? "—" : `${(l.duracaoMs / 1000).toFixed(1)}s`}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={l.status === "erro" ? "danger" : "success"}>
                            {l.status === "erro" ? "Com erros" : "OK"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {l.batchId && (l.porDominio?.produtos?.criados || l.porDominio?.produtos?.atualizados) ? (
                            <button
                              type="button"
                              onClick={() => onAbrirConferencia(l.batchId!)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                            >
                              <Boxes className="h-3.5 w-3.5" /> Revisar produtos
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────────────────

function formatData(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatRelativo(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const min = Math.round(diff / 60000);
    if (min < 1) return "agora";
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h} h`;
    const dias = Math.round(h / 24);
    if (dias < 30) return `há ${dias} d`;
    const meses = Math.round(dias / 30);
    if (meses < 12) return `há ${meses} m`;
    return `há ${Math.round(meses / 12)} a`;
  } catch {
    return "—";
  }
}
