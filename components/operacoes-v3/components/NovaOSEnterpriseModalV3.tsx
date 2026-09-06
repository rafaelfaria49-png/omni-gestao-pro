"use client";

// ============================================================================
// Operações V3 — Nova OS Enterprise (modal completo de abertura de OS)
// ----------------------------------------------------------------------------
// Fluxo COMPLETO de abertura no balcão (seções A→J), sem depender de F11.
// Persiste via `criarOSEnterpriseV3` (caminho seguro). NÃO recebe pagamento:
// o recebimento real acontece depois no PDV de Serviço.
// ============================================================================

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileCheck2,
  KeyRound,
  Loader2,
  Package,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Smartphone,
  Trash2,
  User,
  UserPlus,
  Wallet,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listClientes } from "@/api/clientes";
import { criarOSEnterpriseV3 } from "@/lib/operacoes-v3/nova-os-actions";
import {
  GARANTIA_TEMPLATES_V3,
  garantiaTemplateV3,
  preencherGarantiaPorTemplateV3,
} from "@/lib/operacoes-v3/garantia-templates";
import {
  ACESSORIOS_PADRAO_V3,
  computeTotaisNovaOSV3,
  FORMA_PAGAMENTO_V3,
  ITEM_CATEGORIA_V3,
  ITEM_KIND_V3,
  LOCAL_FISICO_V3,
  novaOSDraftVazioV3,
  ORIGEM_V3,
  pagamentoFormaLabelV3,
  PRIORIDADE_V3,
  TIPO_EQUIPAMENTO_V3,
  validarNovaOSDraftV3,
  type NovaOSClienteV3,
  type NovaOSDiagnosticoV3,
  type NovaOSDraftV3,
  type NovaOSEquipamentoV3,
  type NovaOSItemCategoriaV3,
  type NovaOSItemV3,
  type NovaOSPagamentoPrevistoV3,
  type NovaOSProblemaV3,
  type NovaOSRecepcaoV3,
} from "@/lib/operacoes-v3/nova-os-model";
import {
  clearNovaOSDraftV3,
  isNovaOSDraftMeaningfulV3,
  readNovaOSDraftV3,
  writeNovaOSDraftV3,
  type NovaOSDraftSnapshotV3,
} from "@/lib/operacoes-v3/nova-os-draft-storage";
import type { OrcamentoLinhaKindV3 } from "@/lib/operacoes-v3/orcamento-model";
import type { ProdutoCatalogoV3 } from "@/lib/operacoes-v3/produto-link";
import { ButtonV3 } from "./UiV3";
import { PatternPadV3 } from "./PatternPadV3";
import { ProductPickerV3 } from "./ProductPickerV3";
import { formatBRL } from "../lib/format";
import styles from "../operacoes-v3-skin.module.css";

interface ClienteOpcao {
  id: string;
  nome: string;
  telefone?: string;
  documento?: string;
}

interface Props {
  open: boolean;
  storeId: string | null;
  onClose: () => void;
  onCreated: (osId: string) => void;
}

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function Campo({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

const STEPS: { id: string; label: string; icon: typeof User }[] = [
  { id: "cliente", label: "Cliente", icon: User },
  { id: "equipamento", label: "Equipamento", icon: Smartphone },
  { id: "recepcao", label: "Recepção", icon: ClipboardList },
  { id: "problema", label: "Problema", icon: AlertCircle },
  { id: "itens", label: "Itens", icon: Package },
  { id: "pagamento", label: "Pagamento", icon: Wallet },
  { id: "garantia", label: "Garantia", icon: ShieldCheck },
  { id: "resumo", label: "Resumo", icon: FileCheck2 },
];

// ---------------------------------------------------------------------------

export function NovaOSEnterpriseModalV3({ open, storeId, onClose, onCreated }: Props) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<NovaOSDraftV3>(() => novaOSDraftVazioV3());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Cliente
  const [clienteBusca, setClienteBusca] = useState("");
  const [clientes, setClientes] = useState<ClienteOpcao[]>([]);
  const [clientesLoading, setClientesLoading] = useState(false);

  // Form de item
  const [itCategoria, setItCategoria] = useState<NovaOSItemCategoriaV3>("servico");
  const [itDescricao, setItDescricao] = useState("");
  const [itQtd, setItQtd] = useState(1);
  const [itCusto, setItCusto] = useState(0);
  const [itValor, setItValor] = useState(0);
  const [itKind, setItKind] = useState<OrcamentoLinhaKindV3>("cobrado");
  const [itBaixa, setItBaixa] = useState(false);
  const [itGarantia, setItGarantia] = useState(90);
  // Vínculo com o catálogo (SPRINT_3D.1B) — habilita baixa real de estoque.
  const [itProdutoId, setItProdutoId] = useState("");
  const [itSku, setItSku] = useState("");
  const [itBarcode, setItBarcode] = useState("");
  const [itPickerOpen, setItPickerOpen] = useState(false);

  // Proteção de rascunho (anti-perda de dados)
  const [restoreState, setRestoreState] = useState<NovaOSDraftSnapshotV3 | null>(null);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [pendingDiscard, setPendingDiscard] = useState<null | "reset" | "close">(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // Garantia: marca quando o operador editou o termo à mão (não sobrescrever ao trocar de modelo).
  const [garantiaTermoEditado, setGarantiaTermoEditado] = useState(false);

  // Ao abrir: zera o sub-form transitório e oferece restaurar rascunho salvo.
  useEffect(() => {
    if (!open) return;
    setSalvando(false);
    setErro(null);
    setClienteBusca("");
    setItCategoria("servico");
    setItDescricao("");
    setItQtd(1);
    setItCusto(0);
    setItValor(0);
    setItKind("cobrado");
    setItBaixa(false);
    setItGarantia(90);
    setItProdutoId("");
    setItSku("");
    setItBarcode("");
    setItPickerOpen(false);
    setGarantiaTermoEditado(false);
    setCloseConfirm(false);
    setPendingDiscard(null);

    setStep(0);
    setDraft(novaOSDraftVazioV3());

    const sid = (storeId ?? "").trim();
    const saved = sid ? readNovaOSDraftV3(sid) : null;
    if (saved && isNovaOSDraftMeaningfulV3(saved.draft)) {
      setRestoreState(saved);
      setSavedAt(saved.savedAt);
    } else {
      setRestoreState(null);
      setSavedAt(null);
    }
  }, [open, storeId]);

  // Auto-save (debounce) enquanto o operador preenche. Não roda enquanto o prompt
  // de restauração está aberto (evita sobrescrever o rascunho com o form vazio).
  useEffect(() => {
    if (!open || restoreState || salvando) return;
    const sid = (storeId ?? "").trim();
    if (!sid || !isNovaOSDraftMeaningfulV3(draft)) return;
    const t = setTimeout(() => {
      const at = writeNovaOSDraftV3(sid, draft, step);
      if (at) setSavedAt(at);
    }, 600);
    return () => clearTimeout(t);
  }, [open, restoreState, salvando, storeId, draft, step]);

  // Fechamento guardado: se houver dados, confirma antes de fechar.
  const requestClose = useCallback(() => {
    if (salvando) return;
    if (restoreState) {
      onClose();
      return;
    }
    if (isNovaOSDraftMeaningfulV3(draft)) {
      setCloseConfirm(true);
      return;
    }
    onClose();
  }, [salvando, restoreState, draft, onClose]);

  // ESC: confirma se houver dados; respeita sub-modais abertos.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (itPickerOpen) return; // o ProductPicker trata o próprio ESC
      e.preventDefault();
      e.stopPropagation();
      if (pendingDiscard) {
        setPendingDiscard(null);
        return;
      }
      if (closeConfirm) {
        setCloseConfirm(false);
        return;
      }
      requestClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, itPickerOpen, pendingDiscard, closeConfirm, requestClose]);

  const continuarRascunho = useCallback(() => {
    if (!restoreState) return;
    setDraft(restoreState.draft);
    // Rascunho com termo de garantia já preenchido = trata como editado à mão
    // (não sobrescrever ao reabrir e trocar de modelo).
    setGarantiaTermoEditado(!!restoreState.draft.garantia?.termo?.trim());
    setStep(Math.min(Math.max(0, restoreState.step), STEPS.length - 1));
    setRestoreState(null);
  }, [restoreState]);

  const confirmarDescarte = useCallback(() => {
    const sid = (storeId ?? "").trim();
    if (sid) clearNovaOSDraftV3(sid);
    setSavedAt(null);
    if (pendingDiscard === "close") {
      onClose();
    } else {
      setDraft(novaOSDraftVazioV3());
      setStep(0);
    }
    setRestoreState(null);
    setCloseConfirm(false);
    setPendingDiscard(null);
  }, [storeId, pendingDiscard, onClose]);

  // Carrega clientes ao abrir
  useEffect(() => {
    if (!open) return;
    const sid = (storeId ?? "").trim();
    if (!sid) {
      setClientes([]);
      return;
    }
    let vivo = true;
    setClientesLoading(true);
    listClientes(sid)
      .then((rows) => {
        if (!vivo) return;
        setClientes(
          rows.map((c) => ({ id: c.id, nome: c.nome, telefone: c.telefone ?? undefined, documento: c.documento ?? undefined })),
        );
      })
      .catch(() => {
        if (vivo) setClientes([]);
      })
      .finally(() => {
        if (vivo) setClientesLoading(false);
      });
    return () => {
      vivo = false;
    };
  }, [open, storeId]);

  const setCliente = useCallback((patch: Partial<NovaOSClienteV3>) => setDraft((d) => ({ ...d, cliente: { ...d.cliente, ...patch } })), []);
  const setEquip = useCallback((patch: Partial<NovaOSEquipamentoV3>) => setDraft((d) => ({ ...d, equipamento: { ...d.equipamento, ...patch } })), []);
  const setRecepcao = useCallback((patch: Partial<NovaOSRecepcaoV3>) => setDraft((d) => ({ ...d, recepcao: { ...d.recepcao, ...patch } })), []);
  const setProblema = useCallback((patch: Partial<NovaOSProblemaV3>) => setDraft((d) => ({ ...d, problema: { ...d.problema, ...patch } })), []);
  const setDiagnostico = useCallback((patch: Partial<NovaOSDiagnosticoV3>) => setDraft((d) => ({ ...d, diagnostico: { ...d.diagnostico, ...patch } })), []);
  const setPagamento = useCallback((patch: Partial<NovaOSPagamentoPrevistoV3>) => setDraft((d) => ({ ...d, pagamento: { ...d.pagamento, ...patch } })), []);

  const clientesFiltrados = useMemo(() => {
    const q = clienteBusca.trim().toLowerCase();
    const base = q
      ? clientes.filter((c) => c.nome.toLowerCase().includes(q) || (c.telefone ?? "").toLowerCase().includes(q) || (c.documento ?? "").toLowerCase().includes(q))
      : clientes;
    return base.slice(0, 30);
  }, [clientes, clienteBusca]);

  const totais = useMemo(() => computeTotaisNovaOSV3(draft.itens, draft.desconto), [draft.itens, draft.desconto]);

  const toggleAcessorio = (a: string) => {
    setEquip({
      acessorios: draft.equipamento.acessorios.includes(a)
        ? draft.equipamento.acessorios.filter((x) => x !== a)
        : [...draft.equipamento.acessorios, a],
    });
  };

  // SPRINT_3D.1B — escolher um produto do catálogo preenche o item e o vincula
  // (categoria = peça, baixa de estoque ligada), guardando produtoId/sku/barcode.
  const onSelecionarProdutoItem = (produto: ProdutoCatalogoV3) => {
    setItCategoria("peca");
    setItKind("cobrado");
    setItDescricao(produto.nome);
    setItCusto(produto.custo);
    setItValor(produto.preco);
    setItBaixa(true);
    setItProdutoId(produto.id);
    setItSku(produto.sku);
    setItBarcode(produto.barcode);
  };

  const addItem = () => {
    const descricao = itDescricao.trim();
    if (!descricao) {
      setErro("Informe a descrição do item.");
      return;
    }
    const vinculado = itCategoria === "peca" && itProdutoId.trim();
    const novo: NovaOSItemV3 = {
      id: `${Date.now()}-${Math.round(Math.random() * 1e4)}`,
      categoria: itCategoria,
      descricao,
      quantidade: Math.max(1, Math.trunc(itQtd) || 1),
      custoUnitario: Math.max(0, itCusto),
      valorUnitario: itKind === "cobrado" ? Math.max(0, itValor) : 0,
      kind: itKind,
      baixaEstoque: itCategoria === "peca" ? itBaixa : false,
      garantiaDias: itCategoria === "servico" ? Math.max(0, Math.trunc(itGarantia)) : undefined,
      ...(vinculado
        ? { produtoId: itProdutoId.trim(), sku: itSku.trim() || undefined, barcode: itBarcode.trim() || undefined }
        : {}),
    };
    setDraft((d) => ({ ...d, itens: [...d.itens, novo] }));
    setErro(null);
    setItDescricao("");
    setItQtd(1);
    setItCusto(0);
    setItValor(0);
    setItKind("cobrado");
    setItBaixa(false);
    setItProdutoId("");
    setItSku("");
    setItBarcode("");
  };

  const removeItem = (id: string) => setDraft((d) => ({ ...d, itens: d.itens.filter((i) => i.id !== id) }));
  const updItem = (id: string, patch: Partial<NovaOSItemV3>) =>
    setDraft((d) => ({ ...d, itens: d.itens.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));

  const escolherCliente = (c: ClienteOpcao) => {
    setCliente({ id: c.id, nome: c.nome, telefone: c.telefone, documento: c.documento });
    setClienteBusca("");
  };
  const limparCliente = () => setCliente({ id: undefined, nome: "", telefone: undefined, documento: undefined });

  // Seleciona um modelo de garantia: preenche prazo + texto automaticamente.
  // O texto NÃO é sobrescrito se o operador já editou o termo à mão.
  const escolherGarantia = (id: string) => {
    setDraft((d) => {
      const p = preencherGarantiaPorTemplateV3(id, {
        termoAtual: d.garantia.termo,
        termoEditadoManual: garantiaTermoEditado,
      });
      if (!p) return d;
      return { ...d, garantia: { modelo: p.modelo, label: p.label, prazoDias: p.prazoDias, termo: p.termo } };
    });
  };

  // Restaura o texto oficial do modelo atualmente selecionado (desfaz a edição manual).
  const restaurarTextoModelo = () => {
    setDraft((d) => {
      const p = preencherGarantiaPorTemplateV3(d.garantia.modelo, { termoEditadoManual: false });
      if (!p) return d;
      return { ...d, garantia: { ...d.garantia, prazoDias: p.prazoDias, termo: p.termo } };
    });
    setGarantiaTermoEditado(false);
  };

  const stepDoErro = (msg: string): number => {
    if (/cliente/i.test(msg)) return 0;
    if (/marca e modelo/i.test(msg)) return 1;
    if (/defeito/i.test(msg)) return 3;
    if (/item|quantidade/i.test(msg)) return 4;
    return step;
  };

  const handleCriar = async () => {
    setErro(null);
    const sid = (storeId ?? "").trim();
    if (!sid) {
      setErro("Selecione uma unidade ativa para abrir a OS.");
      return;
    }
    const invalido = validarNovaOSDraftV3(draft);
    if (invalido) {
      setErro(invalido);
      setStep(stepDoErro(invalido));
      return;
    }
    setSalvando(true);
    try {
      const { os } = await criarOSEnterpriseV3(sid, draft);
      clearNovaOSDraftV3(sid);
      setSavedAt(null);
      onCreated(os.id);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível abrir a OS.");
    } finally {
      setSalvando(false);
    }
  };

  if (!open) return null;

  const stepId = STEPS[step].id;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Nova OS">
      <button type="button" aria-label="Fechar" className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={requestClose} />
      <div className={`${styles.popIn} relative flex max-h-[94vh] w-full min-w-0 flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:max-h-[92vh] sm:max-w-4xl sm:rounded-2xl`}>
        {/* Header */}
        <header className="flex flex-none items-center gap-2.5 border-b border-border px-4 py-3 sm:gap-3 sm:px-5 sm:py-3.5">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileCheck2 className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">Nova OS Enterprise</h2>
            <p className="truncate text-xs text-muted-foreground">Abertura completa da ordem de serviço — pagamento aqui é só previsão.</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {savedAt && !restoreState ? (
              <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:inline-flex" title="Rascunho salvo automaticamente nesta unidade">
                <Save className="h-3 w-3 text-success" aria-hidden /> Rascunho salvo · {horaCurta(savedAt)}
              </span>
            ) : null}
            <button type="button" onClick={requestClose} aria-label="Fechar" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </header>

        {/* Step nav */}
        <nav className="flex flex-none gap-1 overflow-x-auto border-b border-border bg-muted/30 px-3 py-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = i === step;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setStep(i)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px]", active ? "bg-primary-foreground/20" : "bg-muted-foreground/15")}>
                  {i + 1}
                </span>
                <Icon className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
          {stepId === "cliente" && (
            <div className="space-y-4">
              {draft.cliente.id ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-primary/70">Cliente selecionado</p>
                    <p className="truncate text-sm font-semibold text-foreground">{draft.cliente.nome}</p>
                    <p className="truncate text-xs text-muted-foreground">{[draft.cliente.telefone, draft.cliente.documento].filter(Boolean).join(" · ") || "Sem telefone/documento"}</p>
                  </div>
                  <ButtonV3 variant="outline" onClick={limparCliente}>Trocar</ButtonV3>
                </div>
              ) : (
                <>
                  <Campo label="Buscar cliente existente">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                      <input className={cn(inputCls, "pl-9")} value={clienteBusca} onChange={(e) => setClienteBusca(e.target.value)} placeholder="Nome, telefone ou CPF/CNPJ…" />
                    </div>
                  </Campo>
                  {clienteBusca.trim() ? (
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
                      {clientesLoading ? (
                        <p className="p-3 text-xs text-muted-foreground">Carregando clientes…</p>
                      ) : clientesFiltrados.length === 0 ? (
                        <p className="p-3 text-xs text-muted-foreground">Nenhum cliente encontrado. Cadastre um novo abaixo.</p>
                      ) : (
                        clientesFiltrados.map((c) => (
                          <button key={c.id} type="button" onClick={() => escolherCliente(c)} className="flex w-full items-center justify-between gap-2 border-b border-border/50 px-3 py-2 text-left last:border-0 hover:bg-muted/50">
                            <span className="min-w-0 truncate text-sm text-foreground">{c.nome}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">{c.telefone || "—"}</span>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}

                  <div className="space-y-3 border-t border-border pt-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <UserPlus className="h-4 w-4 text-primary" aria-hidden /> Cadastrar novo cliente
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Campo label="Nome / razão social *">
                        <input className={inputCls} value={draft.cliente.nome} onChange={(e) => setCliente({ nome: e.target.value })} placeholder="Nome do cliente" maxLength={120} />
                      </Campo>
                      <Campo label="Tipo">
                        <select className={inputCls} value={draft.cliente.tipo} onChange={(e) => setCliente({ tipo: e.target.value as NovaOSClienteV3["tipo"] })}>
                          <option value="PF">Pessoa Física</option>
                          <option value="PJ">Pessoa Jurídica</option>
                        </select>
                      </Campo>
                      <Campo label="Telefone / WhatsApp">
                        <input className={inputCls} value={draft.cliente.telefone ?? ""} onChange={(e) => setCliente({ telefone: e.target.value })} placeholder="(00) 00000-0000" maxLength={20} />
                      </Campo>
                      <Campo label="CPF / CNPJ">
                        <input className={inputCls} value={draft.cliente.documento ?? ""} onChange={(e) => setCliente({ documento: e.target.value })} placeholder="000.000.000-00" maxLength={20} />
                      </Campo>
                      <Campo label="E-mail">
                        <input className={inputCls} value={draft.cliente.email ?? ""} onChange={(e) => setCliente({ email: e.target.value })} placeholder="cliente@email.com" maxLength={120} />
                      </Campo>
                      <Campo label="CEP">
                        <input className={inputCls} value={draft.cliente.cep ?? ""} onChange={(e) => setCliente({ cep: e.target.value })} placeholder="00000-000" maxLength={12} />
                      </Campo>
                      <Campo label="Endereço">
                        <input className={inputCls} value={draft.cliente.endereco ?? ""} onChange={(e) => setCliente({ endereco: e.target.value })} placeholder="Rua, número, bairro" maxLength={160} />
                      </Campo>
                      <div className="grid grid-cols-[1fr_88px] gap-2">
                        <Campo label="Cidade">
                          <input className={inputCls} value={draft.cliente.cidade ?? ""} onChange={(e) => setCliente({ cidade: e.target.value })} placeholder="Cidade" maxLength={80} />
                        </Campo>
                        <Campo label="UF">
                          <input className={inputCls} value={draft.cliente.uf ?? ""} onChange={(e) => setCliente({ uf: e.target.value.toUpperCase().slice(0, 2) })} placeholder="UF" maxLength={2} />
                        </Campo>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">O cliente é cadastrado de verdade ao criar a OS. Demais campos podem ser completados depois em Cadastros.</p>
                  </div>
                </>
              )}
            </div>
          )}

          {stepId === "equipamento" && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Campo label="Tipo">
                  <select className={inputCls} value={draft.equipamento.tipo} onChange={(e) => setEquip({ tipo: e.target.value })}>
                    {TIPO_EQUIPAMENTO_V3.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Campo>
                <Campo label="Marca *">
                  <input className={inputCls} value={draft.equipamento.marca} onChange={(e) => setEquip({ marca: e.target.value })} placeholder="Ex.: Apple, Samsung" maxLength={40} />
                </Campo>
                <Campo label="Modelo *">
                  <input className={inputCls} value={draft.equipamento.modelo} onChange={(e) => setEquip({ modelo: e.target.value })} placeholder="Ex.: iPhone 13 Pro" maxLength={60} />
                </Campo>
                <Campo label="IMEI / Nº de série">
                  <input className={inputCls} value={draft.equipamento.imei ?? ""} onChange={(e) => setEquip({ imei: e.target.value })} placeholder="IMEI ou série" maxLength={40} />
                </Campo>
                <Campo label="Tipo de senha">
                  <select className={inputCls} value={draft.equipamento.senhaTipo} onChange={(e) => setEquip({ senhaTipo: e.target.value as NovaOSEquipamentoV3["senhaTipo"], senha: "" })}>
                    <option value="numerica">Numérica / PIN</option>
                    <option value="texto">Texto (alfanumérica)</option>
                    <option value="padrao">Padrão (desenho 3×3)</option>
                  </select>
                </Campo>
                {draft.equipamento.senhaTipo !== "padrao" ? (
                  <Campo label="Senha do aparelho">
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                      <input
                        className={cn(inputCls, "pl-9")}
                        value={draft.equipamento.senha ?? ""}
                        onChange={(e) => setEquip({ senha: e.target.value })}
                        inputMode={draft.equipamento.senhaTipo === "numerica" ? "numeric" : "text"}
                        placeholder={draft.equipamento.senhaTipo === "numerica" ? "Ex.: 1234" : "Senha"}
                        maxLength={40}
                        autoComplete="off"
                      />
                    </div>
                  </Campo>
                ) : null}
              </div>

              {draft.equipamento.senhaTipo === "padrao" ? (
                <div>
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Senha padrão (desenho 3×3)</span>
                  <PatternPadV3 value={draft.equipamento.senha ?? ""} onChange={(v) => setEquip({ senha: v })} />
                </div>
              ) : null}

              <div>
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Acessórios entregues</span>
                <div className="flex flex-wrap gap-2">
                  {ACESSORIOS_PADRAO_V3.map((a) => {
                    const on = draft.equipamento.acessorios.includes(a);
                    return (
                      <button
                        key={a}
                        type="button"
                        onClick={() => toggleAcessorio(a)}
                        className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors", on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}
                      >
                        {on ? <Check className="h-3 w-3" aria-hidden /> : null}
                        {a}
                      </button>
                    );
                  })}
                </div>
                <Campo label="Outros acessórios">
                  <input
                    className={cn(inputCls, "mt-2")}
                    placeholder="Separe por vírgula (ex.: brinde, manual)"
                    defaultValue={draft.equipamento.acessorios.filter((a) => !ACESSORIOS_PADRAO_V3.includes(a)).join(", ")}
                    onBlur={(e) => {
                      const extras = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
                      const base = draft.equipamento.acessorios.filter((a) => ACESSORIOS_PADRAO_V3.includes(a));
                      setEquip({ acessorios: [...base, ...extras] });
                    }}
                  />
                </Campo>
              </div>
            </div>
          )}

          {stepId === "recepcao" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Data / hora de entrada">
                <input
                  className={inputCls}
                  type="datetime-local"
                  value={toLocalInput(draft.recepcao.dataEntrada)}
                  onChange={(e) => setRecepcao({ dataEntrada: fromLocalInput(e.target.value) ?? draft.recepcao.dataEntrada })}
                />
              </Campo>
              <Campo label="Previsão de entrega">
                <input
                  className={inputCls}
                  type="datetime-local"
                  value={toLocalInput(draft.recepcao.previsaoEntrega)}
                  onChange={(e) => setRecepcao({ previsaoEntrega: fromLocalInput(e.target.value) })}
                />
              </Campo>
              <Campo label="Origem">
                <select className={inputCls} value={draft.recepcao.origem} onChange={(e) => setRecepcao({ origem: e.target.value as NovaOSRecepcaoV3["origem"] })}>
                  {ORIGEM_V3.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Campo>
              <Campo label="Recebido por">
                <input className={inputCls} value={draft.recepcao.recebidoPor ?? ""} onChange={(e) => setRecepcao({ recebidoPor: e.target.value })} placeholder="Operador (padrão: você)" maxLength={80} />
              </Campo>
              <Campo label="Prioridade">
                <select className={inputCls} value={draft.recepcao.prioridade} onChange={(e) => setRecepcao({ prioridade: e.target.value as NovaOSRecepcaoV3["prioridade"] })}>
                  {PRIORIDADE_V3.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </Campo>
              <Campo label="Local físico inicial">
                <select className={inputCls} value={draft.recepcao.localFisico} onChange={(e) => setRecepcao({ localFisico: e.target.value as NovaOSRecepcaoV3["localFisico"] })}>
                  {LOCAL_FISICO_V3.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </Campo>
            </div>
          )}

          {stepId === "problema" && (
            <div className="space-y-3">
              <Campo label="Defeito relatado pelo cliente *">
                <textarea className={inputCls} rows={3} value={draft.problema.defeitoRelatado} onChange={(e) => setProblema({ defeitoRelatado: e.target.value })} placeholder="O que o cliente relatou?" maxLength={1000} />
              </Campo>
              <Campo label="Condição do aparelho">
                <textarea className={inputCls} rows={2} value={draft.problema.condicaoAparelho ?? ""} onChange={(e) => setProblema({ condicaoAparelho: e.target.value })} placeholder="Riscos, trincas, estado geral…" maxLength={600} />
              </Campo>
              <Campo label="Observações internas">
                <textarea className={inputCls} rows={2} value={draft.problema.observacoesInternas ?? ""} onChange={(e) => setProblema({ observacoesInternas: e.target.value })} placeholder="Visível apenas para a equipe técnica" maxLength={600} />
              </Campo>
              <div className="border-t border-border pt-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Diagnóstico inicial / solução prevista (opcional)</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo label="Diagnóstico técnico">
                    <textarea className={inputCls} rows={2} value={draft.diagnostico.diagnosticoTecnico ?? ""} onChange={(e) => setDiagnostico({ diagnosticoTecnico: e.target.value })} placeholder="Hipótese técnica" maxLength={600} />
                  </Campo>
                  <Campo label="Solução prevista">
                    <textarea className={inputCls} rows={2} value={draft.diagnostico.solucaoPrevista ?? ""} onChange={(e) => setDiagnostico({ solucaoPrevista: e.target.value })} placeholder="O que se pretende fazer" maxLength={600} />
                  </Campo>
                </div>
              </div>
            </div>
          )}

          {stepId === "itens" && (
            <div className="space-y-4">
              {/* Form de adição */}
              <div className="rounded-xl border border-border bg-background/40 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">Adicionar item</p>
                  <ButtonV3 variant="outline" className="px-2 py-1 text-xs" onClick={() => setItPickerOpen(true)}>
                    <Package className="h-3.5 w-3.5" aria-hidden /> Buscar no catálogo
                  </ButtonV3>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <Campo label="Categoria">
                    <select className={inputCls} value={itCategoria} onChange={(e) => setItCategoria(e.target.value as NovaOSItemCategoriaV3)}>
                      {ITEM_CATEGORIA_V3.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </Campo>
                  <Campo label="Tipo do item">
                    <select className={inputCls} value={itKind} onChange={(e) => setItKind(e.target.value as OrcamentoLinhaKindV3)}>
                      {ITEM_KIND_V3.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                    </select>
                  </Campo>
                  <Campo label="Quantidade">
                    <input className={inputCls} type="number" min={1} value={itQtd || ""} onChange={(e) => setItQtd(Math.max(1, num(e.target.value)))} />
                  </Campo>
                  {itCategoria === "servico" ? (
                    <Campo label="Garantia (dias)">
                      <input className={inputCls} type="number" min={0} value={itGarantia || ""} onChange={(e) => setItGarantia(num(e.target.value))} placeholder="90" />
                    </Campo>
                  ) : (
                    <Campo label="Baixa estoque">
                      <label className="flex h-[38px] items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-foreground">
                        <input type="checkbox" checked={itBaixa} onChange={(e) => setItBaixa(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
                        {itBaixa ? "Sim" : "Não"}
                      </label>
                    </Campo>
                  )}
                  <Campo label="Descrição">
                    <input className={inputCls} value={itDescricao} onChange={(e) => setItDescricao(e.target.value)} placeholder="Ex.: Troca de tela" maxLength={120} />
                  </Campo>
                  <Campo label="Custo interno (R$)" hint="Oculto do cliente">
                    <input className={inputCls} type="number" min={0} step="0.01" value={itCusto || ""} onChange={(e) => setItCusto(num(e.target.value))} placeholder="0,00" />
                  </Campo>
                  <Campo label="Valor ao cliente (R$)">
                    <input className={inputCls} type="number" min={0} step="0.01" value={itKind === "cobrado" ? itValor || "" : 0} disabled={itKind !== "cobrado"} onChange={(e) => setItValor(num(e.target.value))} placeholder={itKind === "cobrado" ? "0,00" : "R$ 0,00"} />
                  </Campo>
                  <div className="flex items-end">
                    <ButtonV3 variant="primary" className="w-full" onClick={addItem}>
                      <Plus className="h-4 w-4" aria-hidden /> Adicionar
                    </ButtonV3>
                  </div>
                </div>
                {itProdutoId ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                      <Package className="h-3 w-3" aria-hidden /> Vinculado ao estoque{itSku ? ` · SKU ${itSku}` : ""}
                    </span>
                    <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => { setItProdutoId(""); setItSku(""); setItBarcode(""); }}>
                      Tornar manual
                    </button>
                  </div>
                ) : null}
                <p className="mt-2 text-[11px] text-muted-foreground">Brinde e item interno têm valor ao cliente R$ 0,00 (mantêm o custo interno). Peças <strong>vinculadas ao catálogo</strong> baixam estoque na entrega; itens manuais, não.</p>
              </div>

              {/* Lista de itens */}
              {draft.itens.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Item</th>
                        <th className="px-3 py-2 font-medium">Tipo</th>
                        <th className="px-2 py-2 text-center font-medium">Qtd</th>
                        <th className="px-2 py-2 text-right font-medium">Custo</th>
                        <th className="px-2 py-2 text-right font-medium">Cliente</th>
                        <th className="px-2 py-2 text-right font-medium">Subtotal</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {draft.itens.map((it) => {
                        const subtotal = it.kind === "cobrado" ? it.quantidade * it.valorUnitario : 0;
                        return (
                          <tr key={it.id} className="border-b border-border/60 last:border-0">
                            <td className="px-3 py-2">
                              <p className="truncate font-medium text-foreground">{it.descricao}</p>
                              <p className="text-[11px] text-muted-foreground">{it.categoria === "servico" ? "Serviço" : "Peça"}{it.categoria === "peca" && it.baixaEstoque ? " · baixa estoque" : ""}{it.produtoId ? " · vinculado ao estoque" : ""}</p>
                            </td>
                            <td className="px-3 py-2">
                              <select className={cn(inputCls, "h-8 px-2 py-1 text-xs")} value={it.kind} onChange={(e) => { const k = e.target.value as OrcamentoLinhaKindV3; updItem(it.id, { kind: k, valorUnitario: k === "cobrado" ? it.valorUnitario : 0 }); }}>
                                {ITEM_KIND_V3.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                              </select>
                            </td>
                            <td className="px-2 py-2 text-center">
                              <input className={cn(inputCls, "h-8 w-14 px-1 py-1 text-center text-xs")} type="number" min={1} value={it.quantidade} onChange={(e) => updItem(it.id, { quantidade: Math.max(1, num(e.target.value)) })} />
                            </td>
                            <td className="px-2 py-2 text-right">
                              <input className={cn(inputCls, "h-8 w-20 px-1 py-1 text-right text-xs")} type="number" min={0} step="0.01" value={it.custoUnitario || ""} onChange={(e) => updItem(it.id, { custoUnitario: num(e.target.value) })} />
                            </td>
                            <td className="px-2 py-2 text-right">
                              <input className={cn(inputCls, "h-8 w-20 px-1 py-1 text-right text-xs")} type="number" min={0} step="0.01" value={it.kind === "cobrado" ? it.valorUnitario || "" : 0} disabled={it.kind !== "cobrado"} onChange={(e) => updItem(it.id, { valorUnitario: num(e.target.value) })} />
                            </td>
                            <td className="px-2 py-2 text-right font-medium tabular-nums text-foreground">{formatBRL(subtotal)}</td>
                            <td className="px-2 py-2 text-right">
                              <button type="button" onClick={() => removeItem(it.id)} className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">Nenhum item ainda. Adicione serviços, peças ou brindes acima.</p>
              )}

              {/* Orçamento inicial (G) */}
              <div className="grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-3">
                <ResumoValor label="Subtotal" value={formatBRL(totais.subtotal)} />
                <Campo label="Desconto (R$)">
                  <input className={inputCls} type="number" min={0} step="0.01" value={draft.desconto || ""} onChange={(e) => setDraft((d) => ({ ...d, desconto: num(e.target.value) }))} placeholder="0,00" />
                </Campo>
                <ResumoValor label="Total ao cliente" value={formatBRL(totais.total)} destaque />
                <ResumoValor label="Custo interno" value={formatBRL(totais.custo)} hint="Oculto do cliente" />
                <ResumoValor label="Lucro estimado" value={formatBRL(totais.lucro)} tone={totais.lucro >= 0 ? "ok" : "bad"} />
              </div>
            </div>
          )}

          {stepId === "pagamento" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                Pagamento previsto salvo. <strong>Recebimento real será feito no PDV de Serviço.</strong> Nada é lançado no caixa ou no Financeiro nesta etapa.
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo label="Forma de pagamento prevista">
                  <select className={inputCls} value={draft.pagamento.forma} onChange={(e) => setPagamento({ forma: e.target.value as NovaOSPagamentoPrevistoV3["forma"] })}>
                    {FORMA_PAGAMENTO_V3.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </Campo>
                <Campo label="Vencimento previsto">
                  <input className={inputCls} type="date" value={toDateInput(draft.pagamento.vencimentoPrevisto)} onChange={(e) => setPagamento({ vencimentoPrevisto: e.target.value ? new Date(e.target.value).toISOString() : undefined })} />
                </Campo>
                <Campo label="Sinal informado (R$)" hint="Apenas registrado — não recebido">
                  <input className={inputCls} type="number" min={0} step="0.01" value={draft.pagamento.sinal || ""} onChange={(e) => setPagamento({ sinal: num(e.target.value) })} placeholder="0,00" />
                </Campo>
                <Campo label="Observação de pagamento">
                  <input className={inputCls} value={draft.pagamento.observacao ?? ""} onChange={(e) => setPagamento({ observacao: e.target.value })} placeholder="Ex.: 50% na aprovação" maxLength={200} />
                </Campo>
              </div>
            </div>
          )}

          {stepId === "garantia" && (
            <div className="space-y-3">
              <span className="block text-xs font-medium text-muted-foreground">Modelo de garantia — selecione para preencher prazo e termo</span>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {GARANTIA_TEMPLATES_V3.map((g) => {
                  const on = draft.garantia.modelo === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => escolherGarantia(g.id)}
                      className={cn("flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors", on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
                    >
                      <span className="min-w-0 truncate">{g.nome}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{g.dias > 0 ? `${g.dias}d` : "s/ gar."}</span>
                    </button>
                  );
                })}
              </div>
              <Campo label="Prazo de garantia (dias)">
                <input className={inputCls} type="number" min={0} value={draft.garantia.prazoDias ?? ""} onChange={(e) => setDraft((d) => ({ ...d, garantia: { ...d.garantia, prazoDias: num(e.target.value) } }))} placeholder="Ex.: 90" />
              </Campo>
              <Campo label="Termo / condições da garantia">
                <textarea
                  className={inputCls}
                  rows={10}
                  value={draft.garantia.termo ?? ""}
                  onChange={(e) => {
                    setGarantiaTermoEditado(true);
                    setDraft((d) => ({ ...d, garantia: { ...d.garantia, termo: e.target.value } }));
                  }}
                  placeholder="Selecione um modelo acima para preencher automaticamente — ou escreva as condições da garantia."
                  maxLength={2000}
                />
              </Campo>
              {garantiaTermoEditado && garantiaTemplateV3(draft.garantia.modelo) ? (
                <button type="button" onClick={restaurarTextoModelo} className="text-[11px] font-medium text-primary hover:underline">
                  Restaurar texto do modelo
                </button>
              ) : null}
              <p className="text-[11px] text-muted-foreground">O termo é preenchido pelo modelo e pode ser editado livremente. A garantia é apenas <strong>prevista</strong> agora; passa a valer na entrega do aparelho.</p>
            </div>
          )}

          {stepId === "resumo" && (
            <div className="space-y-3">
              <ResumoBloco titulo="Cliente">
                <p className="text-sm font-medium text-foreground">{draft.cliente.nome || (draft.cliente.id ? "Cliente selecionado" : "—")}</p>
                <p className="text-xs text-muted-foreground">{[draft.cliente.telefone, draft.cliente.documento, draft.cliente.email].filter(Boolean).join(" · ") || "Sem contato"}</p>
              </ResumoBloco>
              <ResumoBloco titulo="Equipamento">
                <p className="text-sm text-foreground">{[draft.equipamento.marca, draft.equipamento.modelo].filter(Boolean).join(" ") || "—"} <span className="text-muted-foreground">({draft.equipamento.tipo})</span></p>
                <p className="text-xs text-muted-foreground">{draft.equipamento.imei ? `Série ${draft.equipamento.imei} · ` : ""}{draft.equipamento.acessorios.length ? draft.equipamento.acessorios.join(", ") : "Sem acessórios"}</p>
              </ResumoBloco>
              <ResumoBloco titulo="Defeito relatado">
                <p className="text-sm text-foreground">{draft.problema.defeitoRelatado || "—"}</p>
              </ResumoBloco>
              <ResumoBloco titulo={`Itens (${draft.itens.length})`}>
                {draft.itens.length ? (
                  <ul className="space-y-1">
                    {draft.itens.map((it) => (
                      <li key={it.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate text-foreground">{it.quantidade}× {it.descricao} <span className="text-xs text-muted-foreground">({ITEM_KIND_V3.find((k) => k.value === it.kind)?.label})</span></span>
                        <span className="shrink-0 tabular-nums text-foreground">{formatBRL(it.kind === "cobrado" ? it.quantidade * it.valorUnitario : 0)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhum item (OS sem orçamento inicial).</p>
                )}
                <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm">
                  <span className="text-muted-foreground">Total ao cliente</span>
                  <span className="font-semibold tabular-nums text-foreground">{formatBRL(totais.total)}</span>
                </div>
              </ResumoBloco>
              <div className="grid gap-3 sm:grid-cols-2">
                <ResumoBloco titulo="Pagamento previsto">
                  <p className="text-sm text-foreground">{pagamentoFormaLabelV3(draft.pagamento.forma)}{draft.pagamento.sinal ? ` · sinal ${formatBRL(draft.pagamento.sinal)}` : ""}</p>
                  <p className="text-xs text-muted-foreground">Recebimento real no PDV de Serviço.</p>
                </ResumoBloco>
                <ResumoBloco titulo="Garantia prevista">
                  <p className="text-sm text-foreground">{draft.garantia.label}{draft.garantia.prazoDias ? ` · ${draft.garantia.prazoDias} dias` : ""}</p>
                </ResumoBloco>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="flex flex-none flex-col gap-2 border-t border-border bg-card px-5 py-3 sm:flex-row sm:items-center">
          {erro ? (
            <p className="flex items-center gap-1.5 text-xs text-destructive sm:flex-1 sm:min-w-0">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0">{erro}</span>
            </p>
          ) : (
            <div className="hidden items-center gap-4 text-xs sm:flex sm:flex-1 sm:min-w-0">
              <span className="text-muted-foreground">Total ao cliente <strong className="text-foreground">{formatBRL(totais.total)}</strong></span>
              <span className="text-muted-foreground">Lucro <strong className={totais.lucro >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>{formatBRL(totais.lucro)}</strong></span>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <ButtonV3 variant="ghost" onClick={requestClose} disabled={salvando}>Cancelar</ButtonV3>
            <ButtonV3 variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || salvando}>
              <ChevronLeft className="h-4 w-4" aria-hidden /> Voltar
            </ButtonV3>
            {step < STEPS.length - 1 ? (
              <ButtonV3 variant="outline" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} disabled={salvando}>
                Próximo <ChevronRight className="h-4 w-4" aria-hidden />
              </ButtonV3>
            ) : null}
            <ButtonV3 variant="primary" onClick={handleCriar} disabled={salvando}>
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
              {salvando ? "Criando…" : "Criar Ordem de Serviço"}
            </ButtonV3>
          </div>
        </footer>

        {/* Restaurar rascunho salvo */}
        {restoreState ? (
          <DraftOverlayV3>
            <h3 className="text-sm font-semibold text-foreground">Você tem uma OS em andamento</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Rascunho salvo às {horaCurta(restoreState.savedAt)}. Deseja continuar de onde parou ou começar uma nova?
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">A senha do aparelho não é salva no rascunho — reinforme se necessário.</p>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <ButtonV3 variant="outline" className="text-destructive hover:text-destructive" onClick={() => setPendingDiscard("reset")}>
                Descartar e começar nova
              </ButtonV3>
              <ButtonV3 variant="primary" onClick={continuarRascunho}>Continuar rascunho</ButtonV3>
            </div>
          </DraftOverlayV3>
        ) : null}

        {/* Confirmar fechamento com dados preenchidos */}
        {closeConfirm ? (
          <DraftOverlayV3>
            <h3 className="text-sm font-semibold text-foreground">Existe uma OS em andamento</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Deseja descartar o rascunho ou manter para continuar depois? Os dados ficam salvos automaticamente nesta unidade.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <ButtonV3 variant="primary" onClick={() => setCloseConfirm(false)}>Continuar editando</ButtonV3>
              <ButtonV3 variant="outline" onClick={() => { setCloseConfirm(false); onClose(); }}>Manter rascunho e sair</ButtonV3>
              <ButtonV3 variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setPendingDiscard("close")}>
                Descartar rascunho
              </ButtonV3>
            </div>
          </DraftOverlayV3>
        ) : null}

        {/* Confirmar descarte definitivo do rascunho */}
        {pendingDiscard ? (
          <DraftOverlayV3>
            <h3 className="text-sm font-semibold text-foreground">Descartar o rascunho?</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">Esta ação não pode ser desfeita. Os dados preenchidos serão apagados desta unidade.</p>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <ButtonV3 variant="outline" onClick={() => setPendingDiscard(null)}>Cancelar</ButtonV3>
              <ButtonV3 variant="primary" className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmarDescarte}>
                Sim, descartar
              </ButtonV3>
            </div>
          </DraftOverlayV3>
        ) : null}

        <ProductPickerV3
          open={itPickerOpen}
          storeId={storeId}
          onSelect={onSelecionarProdutoItem}
          onClose={() => setItPickerOpen(false)}
          titulo="Adicionar peça do catálogo"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponentes pequenos
// ---------------------------------------------------------------------------

function ResumoValor({ label, value, destaque, hint, tone }: { label: string; value: string; destaque?: boolean; hint?: string; tone?: "ok" | "bad" }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-2.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={cn("text-base font-semibold tabular-nums", destaque ? "text-primary" : tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : tone === "bad" ? "text-destructive" : "text-foreground")}>{value}</p>
      {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ResumoBloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{titulo}</p>
      {children}
    </div>
  );
}

/** Overlay centralizado para os diálogos de rascunho (restaurar / descartar / fechar). */
function DraftOverlayV3({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-[70] flex items-center justify-center bg-foreground/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-2xl">{children}</div>
    </div>
  );
}

function horaCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Helpers de data (datetime-local / date) ↔ ISO
// ---------------------------------------------------------------------------

function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInput(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function toDateInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}
