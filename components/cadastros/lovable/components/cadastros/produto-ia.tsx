import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Sparkles, Link2, Barcode, ImagePlus, Type, Check, Loader2,
  Wand2, Layers, Tag as TagIcon, Store,
  AlertCircle, Image as ImageIcon,
  Send, Plus, ChevronDown,
} from "lucide-react";
import { Badge, Card, Field, Input, Modal, SectionTitle, Select, Textarea } from "./ui-kit";
import {
  listCategorias,
  listCategoriasMarcasUsadasEmProduto,
  listMarcas,
  lookupProdutoPorBarcodeLocal,
  resolverCodigoBarras,
  upsertCategoria,
  upsertMarca,
  upsertProduto,
  type ResolverCodigoBarrasResult,
} from "@/app/actions/cadastros";
// CATALOGO-APARELHOS-UI-CADASTROSV2-002 — reaproveita a seção do Catálogo de Aparelhos
// (mesma UI/guardrails do /dashboard/estoque) e o contrato de metadata já publicado.
import {
  ProdutoCompatibilidadeAparelhos,
  emptyCompatibilidade,
  type CompatibilidadeValue,
} from "@/components/dashboard/estoque/produto-compatibilidade-aparelhos";
import {
  sanitizeCatalogoAparelhos,
  type CatalogoAparelhosMetadata,
} from "@/lib/catalogo-aparelhos/produto-metadata";
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers";
import { normalizeProdutoTags } from "@/lib/cadastros/produto-upsert-metadata";
import { validarGtin, type GtinFormato } from "@/lib/cadastros/gtin";
import { toast } from "sonner";

function metadataRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

type BarcodeFeedback =
  | { tone: "error"; message: string }
  | { tone: "found"; message: string }
  | { tone: "not-found"; message: string };

type ExternalBarcodeLookup = {
  gtin: string;
  formato: GtinFormato;
  consultadoEm: string;
  result: Extract<ResolverCodigoBarrasResult, { ok: true }>;
};

type BarcodeSuggestionApplication = {
  aplicadoEm: string;
  camposAplicados: string[];
};

function nomeProvedor(provedor: "cosmos" | "upcitemdb" | "openfoodfacts"): string {
  return provedor === "cosmos" ? "Cosmos" : provedor === "upcitemdb" ? "UPCitemdb" : "Open Food Facts";
}

/** União fechada vinda do servidor — nunca exibir texto livre do provedor. */
const TIPOS_ERRO_SEGUROS = new Set(["timeout", "rede", "auth", "parse", "config"]);

function resumoTentativas(tentativas: Array<{ provedor: string; status: string; tipo?: string }>): string {
  if (tentativas.length === 0) return "Sem tentativas externas registradas.";
  return tentativas
    .map((tentativa) => {
      const nome = nomeProvedor(tentativa.provedor as "cosmos" | "upcitemdb" | "openfoodfacts");
      const rotulo =
        tentativa.status === "erro" && tentativa.tipo && TIPOS_ERRO_SEGUROS.has(tentativa.tipo)
          ? `erro(${tentativa.tipo})`
          : tentativa.status;
      return `${nome}: ${rotulo}`;
    })
    .join(" · ");
}

function statusLookupAuditavel(result: ExternalBarcodeLookup["result"]): "encontrado" | "nao_encontrado" | "erro" {
  return result.status === "encontrado" || result.status === "nao_encontrado" ? result.status : "erro";
}

/* ── Combobox com autocomplete + "criar novo" (Categoria/Marca) ── */
/**
 * Compatível com o legado: trabalha em cima de string (nome).
 * Não força vínculo por id — apenas grava o nome canônico em Produto.category/brand.
 */
function CategoriaMarcaCombobox({
  value,
  onChange,
  options,
  onCreate,
  placeholder,
  loading,
  inputId,
}: {
  value: string;
  onChange: (next: string) => void;
  options: string[];
  onCreate: (name: string) => Promise<string | null>;
  placeholder: string;
  loading?: boolean;
  inputId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const normalized = draft.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalized) return options.slice(0, 50);
    return options
      .filter((o) => o.toLowerCase().includes(normalized))
      .slice(0, 50);
  }, [options, normalized]);

  const hasExact = useMemo(
    () => options.some((o) => o.trim().toLowerCase() === normalized),
    [options, normalized]
  );

  const commit = (next: string) => {
    const trimmed = next.trim();
    onChange(trimmed);
    setDraft(trimmed);
    setOpen(false);
  };

  const handleCreate = async () => {
    const candidate = draft.trim();
    if (!candidate || creating) return;
    setCreating(true);
    try {
      const canonical = await onCreate(candidate);
      if (canonical) commit(canonical);
      else commit(candidate);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          data-omni-ui-kit="control"
          value={draft}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            // Mantém o payload sincronizado enquanto o operador digita. Antes, o valor
            // só chegava ao estado pai no blur/seleção; clicar em Salvar podia ler a
            // categoria anterior (inclusive vazia) no mesmo ciclo de interação.
            onChange(next);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Commit do nome digitado (texto livre permitido p/ manter compat com strings legadas)
            onChange(draft.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              return;
            }
            if (e.key === "Enter") {
              if (!hasExact && draft.trim()) {
                e.preventDefault();
                void handleCreate();
              } else {
                e.preventDefault();
                commit(draft);
              }
            }
            if (e.key === "ArrowDown" && !open) setOpen(true);
          }}
          placeholder={placeholder}
          className="w-full h-10 px-3 pr-9 rounded-lg border border-input bg-background text-foreground outline-none text-sm transition-colors focus:ring-2 focus:ring-ring"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            setOpen((v) => !v);
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Abrir lista"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
          {loading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Carregando…</div>
          ) : (
            <>
              {filtered.length === 0 && !draft.trim() ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum cadastro ainda.</div>
              ) : null}
              {filtered.map((o) => (
                <button
                  key={o}
                  type="button"
                  onMouseDown={(e) => {
                    // mousedown para vencer o onBlur do input
                    e.preventDefault();
                    commit(o);
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground ${
                    o.trim().toLowerCase() === normalized ? "bg-accent/60 text-accent-foreground" : "text-foreground"
                  }`}
                >
                  <span className="truncate">{o}</span>
                  {o.trim().toLowerCase() === normalized && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
              ))}
              {draft.trim() && !hasExact && (
                <button
                  type="button"
                  disabled={creating}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void handleCreate();
                  }}
                  className="flex w-full items-center gap-2 border-t border-border bg-primary/5 px-3 py-2 text-left text-sm text-primary hover:bg-primary/10 disabled:opacity-60"
                >
                  {creating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  <span className="truncate">Criar &quot;{draft.trim()}&quot;</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

type Source = "manual" | "link" | "barcode" | "image";

const STEPS = [
  "Analisando produto…",
  "Buscando imagens…",
  "Detectando categoria…",
  "Gerando ficha técnica…",
  "Sugerindo preço…",
  "Calculando margem…",
  "Preparando anúncio…",
];

/** Model key (`samsung_galaxy_a05`) → rótulo legível (`Samsung Galaxy A05`) para o chip reidratado. */
function humanizeModelKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function ProductAIModal({
  open,
  onClose,
  storeId,
  onSaved,
  initial,
  productId,
}: {
  open: boolean;
  onClose: () => void;
  storeId: string;
  onSaved?: () => void;
  initial?: Partial<{
    nome: string;
    sku: string;
    barras: string;
    categoria: string;
    marca: string;
    fornecedor: string;
    estoque: number;
    custo: number;
    preco: number;
    garantia: number;
    /** `Produto.metadata.ncm` (ex.: importador Gestão Clique) */
    ncm?: string;
    /** `Produto.metadata.cest` */
    cest?: string;
    metadata?: Record<string, unknown> | null;
  }>;
  productId?: string;
}) {
  const [source, setSource] = useState<Source>("manual");
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [filled, setFilled] = useState(false);
  const [saving, startSaving] = useTransition();
  const [lookingUpBarcode, startBarcodeLookup] = useTransition();
  const [lookingUpExternalBarcode, startExternalBarcodeLookup] = useTransition();

  const nomeRef = useRef<HTMLInputElement | null>(null);
  const skuRef = useRef<HTMLInputElement | null>(null);
  const barrasRef = useRef<HTMLInputElement | null>(null);
  const fornecedorRef = useRef<HTMLInputElement | null>(null);
  const estoqueRef = useRef<HTMLInputElement | null>(null);
  const custoRef = useRef<HTMLInputElement | null>(null);
  const precoRef = useRef<HTMLInputElement | null>(null);
  const garantiaRef = useRef<HTMLInputElement | null>(null);
  const barcodeScannerRef = useRef<HTMLInputElement | null>(null);
  const barcodeLookupRequestRef = useRef(0);

  // Categoria/Marca: cadastros controlados (dicionário) + texto livre p/ compat.
  const [categoria, setCategoria] = useState<string>(initial?.categoria ?? "");
  const [marca, setMarca] = useState<string>(initial?.marca ?? "");
  const [categoriaOpts, setCategoriaOpts] = useState<string[]>([]);
  const [marcaOpts, setMarcaOpts] = useState<string[]>([]);
  const [optsLoading, setOptsLoading] = useState(false);

  const [ncmDisplay, setNcmDisplay] = useState(initial?.ncm ?? "");
  const [cestDisplay, setCestDisplay] = useState(initial?.cest ?? "");
  const [modeloCompativel, setModeloCompativel] = useState("");
  const [tributacao, setTributacao] = useState("");
  const [tags, setTags] = useState("");
  const [descricao, setDescricao] = useState("");
  const [barcodeScan, setBarcodeScan] = useState("");
  const [barcodeFeedback, setBarcodeFeedback] = useState<BarcodeFeedback | null>(null);
  const [barcodeLocalNotFound, setBarcodeLocalNotFound] = useState<{ gtin: string; formato: GtinFormato } | null>(null);
  const [externalBarcodeLookup, setExternalBarcodeLookup] = useState<ExternalBarcodeLookup | null>(null);
  const [barcodeSuggestionApplication, setBarcodeSuggestionApplication] = useState<BarcodeSuggestionApplication | null>(null);
  const [cosmosFiscalApplied, setCosmosFiscalApplied] = useState<{ ncm?: string; cest?: string } | null>(null);

  // CATALOGO-APARELHOS-UI-CADASTROSV2-002 — estado da seção "Compatibilidade com aparelhos".
  const [catalogoValue, setCatalogoValue] = useState<CompatibilidadeValue>(() => emptyCompatibilidade());

  // Reseta quando troca de produto em edição (modal reabrindo com outro id).
  useEffect(() => {
    setCategoria(initial?.categoria ?? "");
    setMarca(initial?.marca ?? "");
    setNcmDisplay(initial?.ncm ?? "");
    setCestDisplay(initial?.cest ?? "");
    const metadata = metadataRecord(initial?.metadata);
    const atributos = metadataRecord(metadata?.atributos);
    const fiscal = metadataRecord(metadata?.fiscal);
    setModeloCompativel(typeof atributos?.modeloCompativel === "string" ? atributos.modeloCompativel : "");
    setTributacao(typeof fiscal?.tributacao === "string" ? fiscal.tributacao : "");
    setTags(Array.isArray(atributos?.tags) ? atributos.tags.filter((tag): tag is string => typeof tag === "string").join(", ") : "");
    setDescricao(typeof atributos?.descricao === "string" ? atributos.descricao : "");
    setBarcodeScan("");
    setBarcodeFeedback(null);
    setBarcodeLocalNotFound(null);
    setExternalBarcodeLookup(null);
    setBarcodeSuggestionApplication(null);
    setCosmosFiscalApplied(null);
    barcodeLookupRequestRef.current += 1;
  }, [productId, initial?.categoria, initial?.marca, initial?.ncm, initial?.cest, initial?.metadata]);

  useEffect(() => {
    if (open && source === "barcode") barcodeScannerRef.current?.focus();
  }, [open, source]);

  // CATALOGO-APARELHOS-UI-CADASTROSV2-002 — reidrata a compatibilidade ao abrir/editar.
  // Lê o endpoint read-only já publicado (GET /api/catalogo/aparelhos/produto/[id]). Sempre
  // parte de vazio; se o fetch falhar, mantém vazio e NÃO envia nada no save (a chave é
  // omitida), então o metadata salvo é preservado — nunca apaga por rede instável.
  useEffect(() => {
    if (!open) return;
    setCatalogoValue(emptyCompatibilidade());
    if (!productId) return; // criação: nada a reidratar
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/catalogo/aparelhos/produto/${encodeURIComponent(productId)}`, {
          credentials: "include",
          headers: { [ASSISTEC_LOJA_HEADER]: storeId },
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as {
          catalogoAparelhos?: CatalogoAparelhosMetadata | null;
        } | null;
        if (cancelled) return;
        const c = data?.catalogoAparelhos;
        if (c && Array.isArray(c.deviceModelKeys) && c.deviceModelKeys.length > 0) {
          setCatalogoValue({
            models: c.deviceModelKeys.map((k) => ({ modelKey: k, canonicalName: humanizeModelKey(k), brand: "" })),
            aliases: Array.isArray(c.deviceAliases) ? c.deviceAliases : [],
            status: c.compatibilityStatus,
            types: Array.isArray(c.compatibilityTypes) ? c.compatibilityTypes : [],
            notes: typeof c.notes === "string" ? c.notes : "",
          });
        }
      } catch {
        /* rede falhou: mantém vazio (o save omite a chave e preserva o metadata) */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, productId, storeId]);

  // Carrega dicionário (CategoriaCadastro/MarcaCadastro) + valores legados em uso ao abrir.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setOptsLoading(true);
    Promise.all([
      listCategorias(storeId),
      listMarcas(storeId),
      listCategoriasMarcasUsadasEmProduto(storeId),
    ])
      .then(([cats, brs, usadas]) => {
        if (cancelled) return;
        // União case-insensitive: dicionário tem precedência sobre legado para o nome canônico.
        const mergeUnique = (preferred: string[], fallback: string[]) => {
          const seen = new Map<string, string>();
          for (const n of preferred) {
            const key = n.trim().toLowerCase();
            if (key && !seen.has(key)) seen.set(key, n.trim());
          }
          for (const n of fallback) {
            const key = n.trim().toLowerCase();
            if (key && !seen.has(key)) seen.set(key, n.trim());
          }
          return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, "pt-BR"));
        };
        const catDic = cats
          .filter((c) => c.active && (c.type === "produto" || c.type === "geral"))
          .map((c) => c.name);
        const brandDic = brs.filter((b) => b.active).map((b) => b.name);
        setCategoriaOpts(mergeUnique(catDic, usadas.categorias));
        setMarcaOpts(mergeUnique(brandDic, usadas.marcas));
      })
      .catch(() => {
        if (cancelled) return;
        setCategoriaOpts([]);
        setMarcaOpts([]);
      })
      .finally(() => {
        if (!cancelled) setOptsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, storeId]);

  const createCategoria = async (name: string): Promise<string | null> => {
    try {
      const res = await upsertCategoria(storeId, { name, type: "produto", active: true });
      setCategoriaOpts((prev) => (prev.includes(res.name) ? prev : [...prev, res.name].sort((a, b) => a.localeCompare(b, "pt-BR"))));
      return res.name;
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Não foi possível criar categoria");
      return null;
    }
  };

  const createMarca = async (name: string): Promise<string | null> => {
    try {
      const res = await upsertMarca(storeId, { name, type: "", active: true });
      setMarcaOpts((prev) => (prev.includes(res.name) ? prev : [...prev, res.name].sort((a, b) => a.localeCompare(b, "pt-BR"))));
      return res.name;
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Não foi possível criar marca");
      return null;
    }
  };

  const runAI = () => {
    setRunning(true);
    setStep(0);
    setFilled(false);
    let i = 0;
    const t = setInterval(() => {
      i++;
      if (i >= STEPS.length) {
        clearInterval(t);
        setRunning(false);
        setFilled(true);
      } else setStep(i);
    }, 450);
  };

  const runBarcodeLocalLookup = () => {
    const requestId = ++barcodeLookupRequestRef.current;
    const scannedBarcode = barcodeScan;
    const validation = validarGtin(barcodeScan);
    if (!validation.valid) {
      setBarcodeLocalNotFound(null);
      setExternalBarcodeLookup(null);
      setBarcodeSuggestionApplication(null);
      setCosmosFiscalApplied(null);
      setBarcodeFeedback({ tone: "error", message: validation.message });
      return;
    }

    // UPC-A fica canonicamente representado como EAN-13 no formulário; a busca também cobre
    // cadastros legados que ainda guardam os 12 dígitos originais.
    if (barrasRef.current) barrasRef.current.value = validation.gtin;
    startBarcodeLookup(async () => {
      try {
        const result = await lookupProdutoPorBarcodeLocal(storeId, scannedBarcode);
        if (requestId !== barcodeLookupRequestRef.current) return;
        if (!result.ok) {
          setBarcodeLocalNotFound(null);
          setExternalBarcodeLookup(null);
          setBarcodeSuggestionApplication(null);
          setCosmosFiscalApplied(null);
          setBarcodeFeedback({ tone: "error", message: result.message });
          return;
        }
        if (result.status === "FOUND") {
          setBarcodeLocalNotFound(null);
          setExternalBarcodeLookup(null);
          setBarcodeSuggestionApplication(null);
          setCosmosFiscalApplied(null);
          const sku = result.produto.sku ? ` · SKU ${result.produto.sku}` : "";
          setBarcodeFeedback({
            tone: "found",
            message: `Produto já cadastrado nesta loja: ${result.produto.nome}${sku} · estoque ${result.produto.estoque}. O salvamento bloqueará duplicidade.`,
          });
          return;
        }
        setExternalBarcodeLookup(null);
        setBarcodeSuggestionApplication(null);
        setCosmosFiscalApplied(null);
        setBarcodeLocalNotFound(result.interno ? null : { gtin: result.gtin, formato: result.formato });
        setBarcodeFeedback({
          tone: "not-found",
          message: result.interno
            ? "Código interno consultado somente nesta loja e não encontrado. Nenhuma busca externa será feita."
            : "Código válido, mas não encontrado nesta loja. Você pode preencher manualmente ou buscar sugestões externas.",
        });
      } catch {
        if (requestId !== barcodeLookupRequestRef.current) return;
        setBarcodeLocalNotFound(null);
        setExternalBarcodeLookup(null);
        setBarcodeSuggestionApplication(null);
        setCosmosFiscalApplied(null);
        setBarcodeFeedback({ tone: "error", message: "Não foi possível consultar o cadastro local. Tente novamente." });
      }
    });
  };

  const runExternalBarcodeLookup = () => {
    if (!barcodeLocalNotFound) return;
    const requestId = ++barcodeLookupRequestRef.current;
    const localNotFound = barcodeLocalNotFound;
    startExternalBarcodeLookup(async () => {
      try {
        const result = await resolverCodigoBarras(storeId, localNotFound.gtin);
        if (requestId !== barcodeLookupRequestRef.current) return;
        if (!result.ok) {
          setBarcodeFeedback({ tone: "error", message: result.message });
          return;
        }
        if (result.status === "INTERNO") {
          setBarcodeFeedback({ tone: "not-found", message: result.mensagem });
          return;
        }
        setBarcodeSuggestionApplication(null);
        setCosmosFiscalApplied(null);
        setExternalBarcodeLookup({
          gtin: localNotFound.gtin,
          formato: localNotFound.formato,
          consultadoEm: new Date().toISOString(),
          result,
        });
      } catch {
        if (requestId !== barcodeLookupRequestRef.current) return;
        setExternalBarcodeLookup({
          gtin: localNotFound.gtin,
          formato: localNotFound.formato,
          consultadoEm: new Date().toISOString(),
          result: { ok: true, status: "erro", tentativas: [] },
        });
      }
    });
  };

  const applyExternalBarcodeSuggestions = () => {
    if (!externalBarcodeLookup || externalBarcodeLookup.result.status !== "encontrado") return;

    const { dados, provedor } = externalBarcodeLookup.result;
    const camposAplicados: string[] = [];
    const nomeAtual = nomeRef.current?.value.trim() ?? "";
    if (dados.nome.trim() && !nomeAtual && nomeRef.current) {
      nomeRef.current.value = dados.nome;
      camposAplicados.push("nome");
    }
    if (dados.marca?.trim() && !marca.trim()) {
      setMarca(dados.marca);
      camposAplicados.push("marca");
    }
    if (dados.categoria?.trim() && !categoria.trim()) {
      setCategoria(dados.categoria);
      camposAplicados.push("categoria");
    }
    if (dados.descricao?.trim() && !descricao.trim()) {
      setDescricao(dados.descricao);
      camposAplicados.push("descricao");
    }

    const fiscalAplicado: { ncm?: string; cest?: string } = {};
    if (provedor === "cosmos") {
      if (dados.ncm?.trim() && !ncmDisplay.trim()) {
        setNcmDisplay(dados.ncm);
        fiscalAplicado.ncm = dados.ncm;
        camposAplicados.push("ncm");
      }
      if (dados.cest?.trim() && !cestDisplay.trim()) {
        setCestDisplay(dados.cest);
        fiscalAplicado.cest = dados.cest;
        camposAplicados.push("cest");
      }
    }

    const camposAplicadosAntes = barcodeSuggestionApplication?.camposAplicados ?? [];
    const camposAplicadosTotais = Array.from(new Set([...camposAplicadosAntes, ...camposAplicados]));
    const aplicadoEm = barcodeSuggestionApplication?.aplicadoEm ?? new Date().toISOString();
    if (Object.keys(fiscalAplicado).length > 0) {
      setCosmosFiscalApplied((anterior) => ({ ...(anterior ?? {}), ...fiscalAplicado }));
    }
    setBarcodeSuggestionApplication({ aplicadoEm, camposAplicados: camposAplicadosTotais });
    if (camposAplicados.length > 0) {
      toast.success(`Sugestões aplicadas em ${camposAplicados.length} campo(s). Revise e salve manualmente.`);
    } else {
      toast.message("Os campos sugeridos já estão preenchidos e foram preservados. Nenhum produto foi salvo.");
    }
  };

  const title = productId ? "Editar produto" : "Novo produto";
  return (
    <Modal open={open} onClose={onClose} title={title} subtitle="Fase 1: cadastro real no banco — fluxo IA abaixo ainda é simulado (sem OCR/voz)." size="xl">
      <div className="space-y-6">
        {/* IA SOURCE */}
        <Card className="p-5 border-primary/30 bg-primary/5">
          <div className="mb-3 flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Sparkles className="h-4 w-4" /></div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Cadastro Inteligente IA</h3>
              <p className="text-xs text-muted-foreground">Escolha como quer começar — a IA preenche o resto.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              { id: "manual", l: "Digitar nome", i: Type },
              { id: "link", l: "Link marketplace", i: Link2 },
              { id: "barcode", l: "Código de barras", i: Barcode },
              { id: "image", l: "Upload imagem", i: ImagePlus },
            ].map((o) => {
              const Ic = o.i;
              const active = source === o.id;
              return (
                <button
                  key={o.id}
                  onClick={() => setSource(o.id as Source)}
                  className={`flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition ${
                    active ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  <Ic className="h-4 w-4" /> {o.l}
                </button>
              );
            })}
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
            {source === "manual" && <Input placeholder="Ex.: Tela iPhone 11 Original" />}
            {source === "link" && <Input placeholder="https://produto.mercadolivre.com.br/…" />}
            {source === "barcode" && (
              <Input
                ref={barcodeScannerRef}
                value={barcodeScan}
                onChange={(event) => {
                  barcodeLookupRequestRef.current += 1;
                  setBarcodeScan(event.target.value);
                  setBarcodeFeedback(null);
                  setBarcodeLocalNotFound(null);
                  setExternalBarcodeLookup(null);
                  setBarcodeSuggestionApplication(null);
                  setCosmosFiscalApplied(null);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  runBarcodeLocalLookup();
                }}
                inputMode="numeric"
                autoComplete="off"
                placeholder="Bipe ou digite EAN/GTIN e pressione Enter"
                title="Busca somente no cadastro da loja atual"
              />
            )}
            {source === "image" && (
              <div className="rounded-lg border border-dashed border-border bg-background p-3 text-center text-xs text-muted-foreground">
                Solte a imagem do produto aqui
              </div>
            )}
            {source === "barcode" ? (
              <button
                type="button"
                onClick={runBarcodeLocalLookup}
                disabled={lookingUpBarcode || lookingUpExternalBarcode}
                title="Consulta exclusivamente o cadastro local; provedores externos só são consultados após uma ação explícita"
                className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {lookingUpBarcode ? <Loader2 className="h-4 w-4 animate-spin" /> : <Barcode className="h-4 w-4" />}
                Buscar na loja
              </button>
            ) : (
              <button
                disabled
                title="Preenchimento automático por IA — em breve. Preencha os campos manualmente abaixo."
                className="flex cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground opacity-40"
              >
                <Wand2 className="h-4 w-4" /> Preencher com IA · Em breve
              </button>
            )}
          </div>

          {source === "barcode" && barcodeFeedback && (
            <div
              role="status"
              className={`mt-3 rounded-lg border p-3 text-xs ${
                barcodeFeedback.tone === "error"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : barcodeFeedback.tone === "found"
                    ? "border-amber-500/40 bg-amber-500/10 text-foreground"
                    : "border-primary/30 bg-background text-muted-foreground"
              }`}
            >
              {barcodeFeedback.message}
            </div>
          )}

          {source === "barcode" && barcodeLocalNotFound && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-background p-3">
              <div className="text-xs text-muted-foreground">
                A consulta externa não é automática e só ocorre após sua confirmação.
              </div>
              <button
                type="button"
                onClick={runExternalBarcodeLookup}
                disabled={lookingUpExternalBarcode || lookingUpBarcode}
                className="flex items-center justify-center gap-2 rounded-lg border border-primary/40 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
              >
                {lookingUpExternalBarcode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Buscar dados externos
              </button>
            </div>
          )}

          {source === "barcode" && externalBarcodeLookup && (
            <div role="status" className="mt-3 rounded-lg border border-border bg-background p-3 text-xs text-foreground">
              {externalBarcodeLookup.result.status === "encontrado" ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">Sugestão encontrada em {nomeProvedor(externalBarcodeLookup.result.provedor)}</div>
                    <Badge tone={externalBarcodeLookup.result.provedor === "cosmos" ? "primary" : "warning"}>{nomeProvedor(externalBarcodeLookup.result.provedor)}</Badge>
                  </div>
                  <div className="mt-2 grid gap-1 text-muted-foreground">
                    <span><strong className="text-foreground">Nome:</strong> {externalBarcodeLookup.result.dados.nome}</span>
                    {externalBarcodeLookup.result.dados.marca ? <span><strong className="text-foreground">Marca:</strong> {externalBarcodeLookup.result.dados.marca}</span> : null}
                    {externalBarcodeLookup.result.dados.categoria ? <span><strong className="text-foreground">Categoria:</strong> {externalBarcodeLookup.result.dados.categoria}</span> : null}
                    {externalBarcodeLookup.result.dados.descricao ? <span><strong className="text-foreground">Descrição:</strong> disponível para aplicação</span> : null}
                    {externalBarcodeLookup.result.provedor === "cosmos" && (externalBarcodeLookup.result.dados.ncm || externalBarcodeLookup.result.dados.cest) ? (
                      <span><strong className="text-foreground">Fiscal sugerido:</strong> {[externalBarcodeLookup.result.dados.ncm && `NCM ${externalBarcodeLookup.result.dados.ncm}`, externalBarcodeLookup.result.dados.cest && `CEST ${externalBarcodeLookup.result.dados.cest}`].filter(Boolean).join(" · ")} (revisão do operador)</span>
                    ) : null}
                    {externalBarcodeLookup.result.dados.imagemUrl ? <span>Imagem de referência será mantida no metadata ao salvar; nenhum arquivo será baixado.</span> : null}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-muted-foreground">Preenche apenas campos vazios. Custo, preço de venda e estoque continuam manuais.</span>
                    <button
                      type="button"
                      onClick={applyExternalBarcodeSuggestions}
                      className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
                    >
                      Aplicar sugestões
                    </button>
                  </div>
                </>
              ) : externalBarcodeLookup.result.status === "nao_encontrado" ? (
                <p>Nenhum dado encontrado nas bases externas configuradas.</p>
              ) : externalBarcodeLookup.result.status === "limite_excedido" ? (
                <p>Limite diário do provedor atingido. Você ainda pode cadastrar manualmente.</p>
              ) : externalBarcodeLookup.result.status === "erro_config" ? (
                <p>Lookup externo não configurado corretamente. Cadastre manualmente ou revise as variáveis do servidor.</p>
              ) : (
                <p>Não foi possível consultar as bases externas agora. Você ainda pode cadastrar manualmente.</p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">Tentativas: {resumoTentativas(externalBarcodeLookup.result.tentativas)}</p>
              {barcodeSuggestionApplication ? <p className="mt-1 text-[11px] text-muted-foreground">Sugestões revisadas pelo operador; o produto só será gravado ao clicar em “Salvar produto”.</p> : null}
            </div>
          )}

          {(running || filled) && (
            <div className="mt-4 space-y-2 rounded-lg border border-border bg-background p-3">
              {STEPS.map((s, i) => {
                const done = filled || i < step;
                const active = !filled && i === step;
                return (
                  <div key={s} className="flex items-center gap-2 text-xs">
                    {done ? <Check className="h-3.5 w-3.5 text-[color:var(--success)]" /> : active ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : <span className="h-3.5 w-3.5 rounded-full border border-border" />}
                    <span className={done ? "text-foreground" : active ? "text-foreground" : "text-muted-foreground"}>{s}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* FORM (preenchido pela IA) */}
        <div>
          <SectionTitle title="Ficha do produto" subtitle={filled ? "Campos preenchidos automaticamente — revise se quiser." : "Preenchimento manual ou via IA acima."} />
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <Field label="Nome" span={2}>
              <Input
                ref={nomeRef}
                defaultValue={initial?.nome ?? ""}
                placeholder="Nome do produto"
                className="font-medium"
              />
            </Field>
            <Field label="SKU"><Input ref={skuRef} defaultValue={initial?.sku ?? ""} placeholder="SKU-001" /></Field>
            <Field label="Código de barras"><Input ref={barrasRef} defaultValue={initial?.barras ?? ""} placeholder="7891234500011" /></Field>
            <Field label="Categoria">
              <CategoriaMarcaCombobox
                value={categoria}
                onChange={setCategoria}
                options={categoriaOpts}
                onCreate={createCategoria}
                placeholder="Selecione ou crie (ex.: Telas)"
                loading={optsLoading}
              />
            </Field>
            <Field label="Marca">
              <CategoriaMarcaCombobox
                value={marca}
                onChange={setMarca}
                options={marcaOpts}
                onCreate={createMarca}
                placeholder="Selecione ou crie (ex.: Apple)"
                loading={optsLoading}
              />
            </Field>
            <Field label="Modelo compatível"><Input value={modeloCompativel} onChange={(event) => setModeloCompativel(event.target.value)} placeholder="Ex.: iPhone 11" /></Field>
            <Field label="Fornecedor"><Input ref={fornecedorRef} defaultValue={initial?.fornecedor ?? ""} placeholder="Nome do fornecedor" /></Field>
            <Field label="Estoque atual"><Input ref={estoqueRef} type="number" min={0} step={1} defaultValue={initial?.estoque !== undefined ? String(initial.estoque) : (productId ? "" : "0")} placeholder="0" /></Field>
            <Field label="Garantia (dias)"><Input ref={garantiaRef} defaultValue={initial?.garantia !== undefined ? String(initial.garantia) : ""} placeholder="90" /></Field>
            {/* CATALOGO-APARELHOS-UI-CADASTROSV2-002 — compatibilidade de aparelhos (reuso). */}
            <div className="col-span-2">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Compatibilidade com aparelhos</p>
              <div className="rounded-xl border border-border bg-muted/20 p-4">
                <p className="mb-4 text-xs text-muted-foreground">
                  Use para capinhas, películas e acessórios. Não confirma encaixe físico automaticamente.
                </p>
                <ProdutoCompatibilidadeAparelhos
                  value={catalogoValue}
                  onChange={setCatalogoValue}
                  lojaHeader={storeId}
                />
              </div>
            </div>
            <div className="col-span-2">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Precificação</p>
              <div className="grid grid-cols-3 gap-4 rounded-xl border border-border bg-muted/20 p-4">
                <Field label="Custo (R$)"><Input ref={custoRef} defaultValue={initial?.custo !== undefined ? String(initial.custo) : ""} placeholder="0,00" /></Field>
                <Field label="Preço venda (R$)"><Input ref={precoRef} defaultValue={initial?.preco !== undefined ? String(initial.preco) : ""} placeholder="0,00" /></Field>
                <Field label="Margem"><Input readOnly defaultValue="" placeholder="Auto" className="bg-muted/40 text-muted-foreground cursor-default" /></Field>
              </div>
            </div>
            <Field label="NCM">
              <Input
                readOnly
                value={ncmDisplay}
                placeholder={ncmDisplay ? undefined : "Fase fiscal futura"}
                className={ncmDisplay ? "font-mono text-foreground" : "text-muted-foreground cursor-default"}
                title={ncmDisplay ? "NCM importado ou persistido em metadata" : "Edição fiscal — em breve"}
              />
            </Field>
            <Field label="CEST">
              <Input
                readOnly
                value={cestDisplay}
                placeholder={cestDisplay ? undefined : "—"}
                className={cestDisplay ? "font-mono text-foreground" : "text-muted-foreground cursor-default"}
                title={cestDisplay ? "CEST persistido em metadata" : "Não informado"}
              />
            </Field>
            <Field label="Tributação"><Select value={tributacao} onChange={(event) => setTributacao(event.target.value)}><option value="">—</option><option>Simples</option><option>Lucro Presumido</option><option>Lucro Real</option></Select></Field>
            <Field label="Tags" span={2}><Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Separadas por vírgula — Ex.: apple, tela, original" /></Field>
            <Field label="Descrição" span={2}>
              <Textarea value={descricao} onChange={(event) => setDescricao(event.target.value)} rows={3} placeholder="Descrição comercial (opcional)" />
            </Field>
          </div>
        </div>

        {/* IMAGEM IA */}
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Imagem IA</h3>
            <Badge tone="warning">Em breve</Badge>
          </div>
          <div className="pointer-events-none grid gap-3 opacity-50 md:grid-cols-[1fr_1fr]">
            <div className="rounded-xl border border-dashed border-border bg-background p-6 text-center">
              <ImagePlus className="mx-auto h-7 w-7 text-muted-foreground" />
              <div className="mt-2 text-sm text-foreground">Soltar fotos do produto</div>
              <div className="text-xs text-muted-foreground">PNG/JPG • até 8 imagens</div>
            </div>
            <div className="space-y-2">
              {[
                "Remover fundo automaticamente",
                "Padronizar imagem (1080×1080)",
                "Gerar thumbnail",
                "Gerar capa marketplace",
                "Sugerir imagens complementares",
              ].map((o) => (
                <label key={o} className="flex items-center gap-2 rounded-lg border border-border bg-background p-2.5 text-sm text-foreground">
                  <input type="checkbox" defaultChecked /> {o}
                </label>
              ))}
            </div>
          </div>
          {filled && (
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              {["Original", "Sem fundo", "Thumb", "Capa MKT"].map((l, i) => (
                <div key={l} className="overflow-hidden rounded-lg border border-border">
                  <div className="aspect-square bg-gradient-to-br from-primary/20 to-muted grid place-items-center text-xs text-muted-foreground">
                    Preview {i + 1}
                  </div>
                  <div className="border-t border-border bg-surface px-2 py-1 text-[10px] uppercase text-muted-foreground">{l}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* RELACIONAMENTOS */}
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Relacionamentos inteligentes</h3>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Sugestões de equipamentos, peças relacionadas e checklists serão plugadas na fase de IA — nada aqui altera o banco ainda.
          </p>
        </Card>

        {/* MARKETPLACE — apenas rótulo Fase 1; integrações reais ficam no módulo Marketplace */}
        <Card className="p-5 opacity-80">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Send className="h-4 w-4" />
            <span>Publicação em marketplaces: não disponível nesta fase (cadastro local apenas).</span>
          </div>
        </Card>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">Cancelar</button>
          <button disabled title="Rascunho — em breve" className="flex cursor-not-allowed items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm opacity-40" type="button">
            Salvar rascunho
          </button>
          <button
            disabled={saving}
            onClick={() => {
              startSaving(async () => {
                try {
                  const custo = Number(String(custoRef.current?.value ?? "").replace(/[^\d,.-]/g, "").replace(",", "."));
                  const preco = Number(String(precoRef.current?.value ?? "").replace(/[^\d,.-]/g, "").replace(",", "."));
                  const garantia = Number(String(garantiaRef.current?.value ?? "").replace(/[^\d,.-]/g, "").replace(",", "."));
                  // Estoque: só envia se o usuário digitou algo. Em edição, undefined preserva o valor atual.
                  const estoqueRaw = estoqueRef.current?.value;
                  const estoqueStr = typeof estoqueRaw === "string" ? estoqueRaw.trim() : "";
                  const estoqueNum = estoqueStr ? parseInt(estoqueStr, 10) : NaN;
                  const estoque = Number.isFinite(estoqueNum) && estoqueNum >= 0 ? estoqueNum : undefined;
                  if (estoqueStr && estoque === undefined) {
                    toast.error("Estoque inválido — informe um número inteiro ≥ 0.");
                    return;
                  }
                  // CATALOGO-APARELHOS-UI-CADASTROSV2-002 — vínculo de aparelhos → metadata.catalogoAparelhos.
                  // Só grava quando há modelo vinculado; vazio = OMITE a chave. upsertProduto faz merge
                  // aditivo em dois níveis, então omitir preserva catalogoAparelhos/fiscal já salvos
                  // (nunca apaga por engano). O saneamento reusa o contrato canônico já publicado.
                  const catalogoModelKeys = catalogoValue.models.map((m) => m.modelKey);
                  const catalogoAparelhos =
                    catalogoModelKeys.length > 0
                      ? sanitizeCatalogoAparelhos({
                          deviceModelKeys: catalogoModelKeys,
                          deviceAliases: catalogoValue.aliases,
                          compatibilityStatus: catalogoValue.status,
                          compatibilityTypes: catalogoValue.types,
                          notes: catalogoValue.notes,
                          source: "manual",
                        })
                      : null;
                  const tributacaoNormalizada = tributacao.trim();
                  const fiscalBarcodeSuggestion = cosmosFiscalApplied
                    ? {
                        ...cosmosFiscalApplied,
                        origem: "barcode-lookup:cosmos",
                        status: "revisado_operador",
                        revisadoEm: barcodeSuggestionApplication?.aplicadoEm ?? new Date().toISOString(),
                      }
                    : null;
                  const barcodeLookupMetadata = externalBarcodeLookup
                    ? (() => {
                        const { result } = externalBarcodeLookup;
                        const encontrado = result.status === "encontrado";
                        const aplicacao = barcodeSuggestionApplication;
                        const camposAplicados = aplicacao?.camposAplicados ?? [];
                        const ultimoResultado = {
                          gtin: externalBarcodeLookup.gtin,
                          formato: externalBarcodeLookup.formato,
                          consultadoEm: externalBarcodeLookup.consultadoEm,
                          status: result.status,
                          tentativas: result.tentativas,
                          ...(encontrado ? { provedor: result.provedor, sugestoes: result.dados } : {}),
                        };
                        return {
                          ultimoResultado,
                          gtin: externalBarcodeLookup.gtin,
                          formato: externalBarcodeLookup.formato,
                          consultadoEm: externalBarcodeLookup.consultadoEm,
                          statusLookup: statusLookupAuditavel(result),
                          tentativas: result.tentativas,
                          ...(encontrado ? { provedor: result.provedor, sugestoes: result.dados } : {}),
                          aplicadoPeloOperador: Boolean(aplicacao),
                          ...(aplicacao ? { aplicadoEm: aplicacao.aplicadoEm } : {}),
                          camposAplicados,
                          aplicado: Object.fromEntries(camposAplicados.map((campo) => [campo, "aceito"])),
                        };
                      })()
                    : null;
                  const result = await upsertProduto(storeId, {
                    id: productId,
                    nome: (nomeRef.current?.value ?? "").trim(),
                    sku: (skuRef.current?.value ?? "").trim(),
                    barras: (barrasRef.current?.value ?? "").trim(),
                    categoria: categoria.trim(),
                    marca: marca.trim(),
                    fornecedor: (fornecedorRef.current?.value ?? "").trim(),
                    estoque,
                    custo: Number.isFinite(custo) ? custo : 0,
                    preco: Number.isFinite(preco) ? preco : 0,
                    garantia: Number.isFinite(garantia) ? garantia : 0,
                    active: true,
                    metadata: {
                      cadastroIa: {
                        phase: "fase1-stub",
                        savedAt: new Date().toISOString(),
                        source,
                      },
                      ...(catalogoAparelhos ? { catalogoAparelhos } : {}),
                      atributos: {
                        descricao: descricao.trim(),
                        tags: normalizeProdutoTags(tags),
                        modeloCompativel: modeloCompativel.trim(),
                      },
                      ...(tributacaoNormalizada || fiscalBarcodeSuggestion
                        ? {
                            fiscal: {
                              ...(tributacaoNormalizada
                                ? {
                                    tributacao: tributacaoNormalizada,
                                    tributacaoOrigem: "operador",
                                    tributacaoAtualizadoEm: new Date().toISOString(),
                                  }
                                : {}),
                              ...(fiscalBarcodeSuggestion ?? {}),
                            },
                          }
                        : {}),
                      ...(barcodeLookupMetadata ? { barcodeLookup: barcodeLookupMetadata } : {}),
                    },
                  });
                  if (!result.ok) {
                    toast.error(result.message);
                    return;
                  }
                  onSaved?.();
                  onClose();
                  toast.success("Produto salvo com sucesso.");
                } catch (e) {
                  toast.error("Não foi possível salvar o produto. Tente novamente.");
                }
              });
            }}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            <Send className="h-4 w-4" /> Salvar produto
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Quality score ring for product cards ── */
export function QualityScore({ value }: { value: number }) {
  const tone = value >= 85 ? "success" : value >= 60 ? "warning" : "danger";
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative h-7 w-7">
        <svg viewBox="0 0 36 36" className="h-7 w-7 -rotate-90">
          <circle cx="18" cy="18" r="15" fill="none" stroke="hsl(var(--muted-foreground)/0.2)" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15" fill="none"
            stroke={value >= 85 ? "var(--success)" : value >= 60 ? "var(--warning)" : "var(--destructive)"}
            strokeWidth="3" strokeLinecap="round"
            strokeDasharray={`${(value / 100) * 94.25} 94.25`}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-[9px] font-bold text-foreground">{value}</div>
      </div>
      <Badge tone={tone}>score</Badge>
    </div>
  );
}

/* ── Inteligência de Cadastros block for dashboard ── */
export function InteligenciaCadastros({
  stats,
}: {
  stats?: Partial<{
    produtosProntosMarketplace: number;
    cadastrosGeradosPorIa: number;
    produtosSemImagem: number;
    anunciosPendentes: number;
    duplicadosEncontrados: number;
    camposFiscaisFaltando: number;
  }>;
}) {
  const items = [
    { l: "Produtos prontos para marketplace", v: stats?.produtosProntosMarketplace ?? 0, t: "success" as const, i: Send },
    { l: "Cadastros gerados por IA", v: stats?.cadastrosGeradosPorIa ?? 0, t: "primary" as const, i: Sparkles },
    { l: "Produtos sem imagem", v: stats?.produtosSemImagem ?? 0, t: "warning" as const, i: ImageIcon },
    { l: "Anúncios pendentes", v: stats?.anunciosPendentes ?? 0, t: "info" as const, i: Store },
    { l: "Duplicados encontrados", v: stats?.duplicadosEncontrados ?? 0, t: "danger" as const, i: AlertCircle },
    { l: "Campos fiscais faltando", v: stats?.camposFiscaisFaltando ?? 0, t: "warning" as const, i: TagIcon },
  ];
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <SectionTitle title="Inteligência de Cadastros" subtitle="Status do que a IA já analisou e o que precisa de atenção." />
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {items.map((it) => {
          const Ic = it.i;
          return (
            <div key={it.l} className="rounded-xl border border-border bg-background p-4">
              <div className="flex items-center justify-between">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"><Ic className="h-4 w-4" /></div>
                <Badge tone={it.t}>•</Badge>
              </div>
              <div className="mt-3 text-2xl font-bold text-foreground">{it.v}</div>
              <div className="text-[11px] text-muted-foreground">{it.l}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ── IA Importação extras ── */
export function ImportIAActions() {
  const acts = [
    { l: "IA corrige planilha", i: Wand2 },
    { l: "Detectar duplicados", i: Layers },
    { l: "Sugerir categorias", i: TagIcon },
    { l: "Completar campos ausentes", i: Sparkles },
    { l: "Padronizar nomes", i: Type },
    { l: "Validar SKU/código de barras", i: Barcode },
  ];
  return (
    <Card className="p-5 border-primary/30 bg-primary/5">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Correção Inteligente</h3>
        <Badge tone="primary">IA</Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {acts.map((a) => {
          const Ic = a.i;
          return (
            <button key={a.l} className="flex items-center gap-2 rounded-lg border border-border bg-background p-3 text-left text-sm text-foreground hover:border-primary">
              <Ic className="h-4 w-4 text-primary" /> {a.l}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
