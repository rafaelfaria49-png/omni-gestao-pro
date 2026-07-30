"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  PackageCheck,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";

import { Badge, Card, SectionTitle } from "./ui-kit";
import {
  aplicarConferenciaLote,
  getConferenciaLote,
  type ConferenciaLoteDTO,
  type ConferenciaProdutoDTO,
} from "@/app/actions/cadastros";
import {
  acrescimoSobreCusto,
  margemBrutaSobreVenda,
  preverPrecoLote,
  type ArredondamentoPreco,
  type EstadoConferencia,
  type RegraPrecoLote,
} from "@/lib/cadastros/importacao-produtos";

// ============================================================
// ConferenciaLoteProdutos — Parte 9 do contrato de importação.
//
// Carrega SOMENTE os produtos do (batchId, storeId) informados, lendo a
// proveniência de `Produto.metadata.importacao`. Permite corrigir preço
// individualmente ou em lote, marcar revisão e ativar os produtos aptos.
//
// Vocabulário deliberado: "acréscimo sobre custo" (markup) e "margem bruta sobre
// venda" aparecem como colunas separadas — nunca o markup chamado de margem.
//
// Estoque NÃO é editável aqui: saldo muda por movimentação auditada.
// ============================================================

const ROTULO_ESTADO: Record<EstadoConferencia, { label: string; tone: "success" | "warning" | "danger" | "info" }> = {
  revisado: { label: "Revisado", tone: "success" },
  pendente: { label: "Pendente", tone: "info" },
  incompleto: { label: "Incompleto", tone: "warning" },
  conflito: { label: "Conflito", tone: "danger" },
  erro: { label: "Erro", tone: "danger" },
};

const ROTULO_MATCH: Record<string, string> = {
  barcode: "código de barras",
  sku: "SKU",
  codigo_fornecedor: "código do fornecedor",
  nome_exato: "nome exato",
};

function moeda(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(v: number): string {
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

export type ConferenciaLoteProdutosProps = {
  storeId: string;
  batchId: string;
  onFechar?: () => void;
};

export function ConferenciaLoteProdutos({ storeId, batchId, onFechar }: ConferenciaLoteProdutosProps) {
  const [lote, setLote] = useState<ConferenciaLoteDTO | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  /** Preços editados individualmente, ainda não salvos. */
  const [precosEditados, setPrecosEditados] = useState<Record<string, string>>({});

  // Regra de preço em lote + prévia (nada é salvo sem confirmação explícita).
  const [regraTipo, setRegraTipo] = useState<RegraPrecoLote["tipo"]>("acrescimo_percentual");
  const [regraValor, setRegraValor] = useState("");
  const [arredondamento, setArredondamento] = useState<ArredondamentoPreco>("90");
  const [previaAberta, setPreviaAberta] = useState(false);

  const carregar = useCallback(() => {
    if (!storeId || !batchId) return;
    setCarregando(true);
    setErro(null);
    getConferenciaLote(storeId, batchId)
      .then((r) => {
        setLote(r);
        setCarregando(false);
        setSelecionados(new Set());
        setPrecosEditados({});
        setPreviaAberta(false);
      })
      .catch((e) => {
        setErro(e instanceof Error ? e.message : "Falha ao carregar o lote");
        setCarregando(false);
      });
  }, [storeId, batchId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const produtos = lote?.produtos ?? [];

  const alvos = useMemo(
    () => (selecionados.size > 0 ? produtos.filter((p) => selecionados.has(p.id)) : produtos),
    [produtos, selecionados],
  );

  const regra = useMemo<RegraPrecoLote>(() => {
    const n = Number(regraValor.replace(",", "."));
    const valor = Number.isFinite(n) ? n : 0;
    if (regraTipo === "definir") return { tipo: "definir", valor };
    if (regraTipo === "acrescimo_fixo") return { tipo: "acrescimo_fixo", valor };
    return { tipo: "acrescimo_percentual", percentual: valor };
  }, [regraTipo, regraValor]);

  const previa = useMemo(
    () =>
      preverPrecoLote(
        alvos.map((p) => ({ produtoId: p.id, custo: p.custo, preco: p.preco })),
        regra,
        arredondamento,
      ),
    [alvos, regra, arredondamento],
  );

  const previaPorId = useMemo(() => new Map(previa.map((p) => [p.produtoId, p])), [previa]);

  const aplicar = useCallback(
    async (
      itens: Array<{ id: string; preco?: number; revisado?: boolean; ativar?: boolean }>,
      mensagemConfirmacao: string,
    ) => {
      if (itens.length === 0) return;
      // Nada em massa sem confirmação explícita.
      if (!window.confirm(mensagemConfirmacao)) return;
      setSalvando(true);
      setErro(null);
      try {
        const r = await aplicarConferenciaLote(storeId, batchId, itens, {
          revisadoPor: "Conferência de importação",
        });
        if (!r.ok) {
          setErro(r.message);
          return;
        }
        // Ativação recusada não pode passar em silêncio: o operador precisa saber que
        // aqueles produtos continuam fora do PDV, e por quê.
        if (r.naoAtivados.length > 0) {
          const motivos = [...new Set(r.naoAtivados.map((n) => n.motivo))];
          setErro(
            `${r.naoAtivados.length} produto(s) não foram ativados. ${motivos.join(" · ")}`,
          );
        }
        carregar();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao aplicar alterações");
      } finally {
        setSalvando(false);
      }
    },
    [storeId, batchId, carregar],
  );

  const salvarPrecoIndividual = useCallback(
    async (p: ConferenciaProdutoDTO) => {
      const bruto = precosEditados[p.id];
      if (bruto === undefined) return;
      const n = Number(bruto.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) {
        setErro("Preço inválido.");
        return;
      }
      setSalvando(true);
      setErro(null);
      try {
        const r = await aplicarConferenciaLote(storeId, batchId, [{ id: p.id, preco: n }]);
        if (!r.ok) setErro(r.message);
        else carregar();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao salvar o preço");
      } finally {
        setSalvando(false);
      }
    },
    [precosEditados, storeId, batchId, carregar],
  );

  // ── Estados de tela ──────────────────────────────────────────────────────
  if (carregando) {
    return (
      <Card className="p-6" aria-busy="true">
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      </Card>
    );
  }

  if (erro && !lote) {
    return (
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-destructive">{erro}</p>
            <button
              type="button"
              onClick={carregar}
              className="mt-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      </Card>
    );
  }

  if (!lote) {
    return (
      <Card className="p-10 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
          <PackageCheck className="h-5 w-5" />
        </div>
        <p className="mt-3 text-base font-semibold text-foreground">Nenhum produto neste lote</p>
        <p className="mt-1 text-sm text-muted-foreground">
          O lote <span className="font-mono">{batchId}</span> não tem produtos com proveniência de
          importação nesta unidade. Lotes importados antes desta versão não gravavam proveniência.
        </p>
        {onFechar && (
          <button
            type="button"
            onClick={onFechar}
            className="mt-4 text-xs text-muted-foreground hover:text-foreground"
          >
            Fechar
          </button>
        )}
      </Card>
    );
  }

  const t = lote.totais;

  return (
    <div className="w-full min-w-0 space-y-4">
      {/* Cabeçalho do lote */}
      <Card className="p-5">
        <SectionTitle
          title="Conferência da importação"
          subtitle={`${lote.arquivo || "planilha"} · lote ${lote.batchId}`}
          action={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={carregar}
                disabled={salvando}
                className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${salvando ? "animate-spin" : ""}`} /> Atualizar
              </button>
              {onFechar && (
                <button
                  type="button"
                  onClick={onFechar}
                  className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-accent"
                >
                  <X className="h-3.5 w-3.5" /> Fechar
                </button>
              )}
            </div>
          }
        />

        <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label="Produtos" valor={t.total} />
          <Kpi label="Pendentes" valor={t.pendentes} tone="info" />
          <Kpi label="Incompletos" valor={t.incompletos} tone="warning" />
          <Kpi label="Revisados" valor={t.revisados} tone="success" />
          <Kpi label="Aptos a ativar" valor={t.aptosAtivacao} tone="success" />
        </div>

        {(lote.fornecedor || lote.documento) && (
          <div className="mt-4 grid min-w-0 gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-4">
            {lote.fornecedor && (
              <>
                <KeyVal k="Fornecedor" v={lote.fornecedor.nome} />
                <KeyVal k="CNPJ/CPF" v={lote.fornecedor.documento || "—"} mono />
              </>
            )}
            {lote.documento && (
              <>
                <KeyVal
                  k={lote.documento.tipo === "nfe" ? "NF-e" : "Documento"}
                  v={[lote.documento.numero, lote.documento.serie && `série ${lote.documento.serie}`]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                />
                <KeyVal k="Emissão" v={lote.documento.dataEmissao || "—"} />
                {lote.documento.chave && (
                  <div className="min-w-0 sm:col-span-2 lg:col-span-4">
                    <KeyVal k="Chave" v={lote.documento.chave} mono />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Card>

      {erro && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-sm text-destructive">{erro}</p>
        </div>
      )}

      {/* Ações em lote */}
      <Card className="p-5">
        <SectionTitle
          title="Precificação em lote"
          subtitle={
            selecionados.size > 0
              ? `${selecionados.size} produto(s) selecionado(s)`
              : `Aplica a todos os ${produtos.length} produtos do lote`
          }
        />

        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="min-w-0 space-y-1.5">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Regra</span>
            <select
              value={regraTipo}
              onChange={(e) => {
                setRegraTipo(e.target.value as RegraPrecoLote["tipo"]);
                setPreviaAberta(false);
              }}
              className="h-9 w-full min-w-0 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            >
              <option value="acrescimo_percentual">Acréscimo % sobre o custo</option>
              <option value="acrescimo_fixo">Valor fixo sobre o custo</option>
              <option value="definir">Definir preço de venda</option>
            </select>
          </label>

          <label className="min-w-0 space-y-1.5">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {regraTipo === "acrescimo_percentual" ? "Percentual (%)" : "Valor (R$)"}
            </span>
            <input
              value={regraValor}
              onChange={(e) => {
                setRegraValor(e.target.value);
                setPreviaAberta(false);
              }}
              placeholder={regraTipo === "acrescimo_percentual" ? "60" : "10,00"}
              className="h-9 w-full min-w-0 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            />
          </label>

          <label className="min-w-0 space-y-1.5">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Arredondamento
            </span>
            <select
              value={arredondamento}
              onChange={(e) => {
                setArredondamento(e.target.value as ArredondamentoPreco);
                setPreviaAberta(false);
              }}
              className="h-9 w-full min-w-0 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            >
              <option value="nenhum">Sem arredondamento</option>
              <option value="90">Final ,90</option>
              <option value="99">Final ,99</option>
            </select>
          </label>

          <div className="flex min-w-0 items-end gap-2">
            <button
              type="button"
              onClick={() => setPreviaAberta((v) => !v)}
              disabled={alvos.length === 0}
              className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-60"
            >
              {previaAberta ? "Ocultar prévia" : "Visualizar prévia"}
            </button>
          </div>
        </div>

        {previaAberta && (
          <div className="mt-4 space-y-3">
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="max-h-64 overflow-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="sticky top-0 bg-surface text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Produto</th>
                      <th className="px-3 py-2 text-right font-medium">Custo</th>
                      <th className="px-3 py-2 text-right font-medium">Preço atual</th>
                      <th className="px-3 py-2 text-right font-medium">Preço novo</th>
                      <th className="px-3 py-2 text-right font-medium">Acréscimo s/ custo</th>
                      <th className="px-3 py-2 text-right font-medium">Margem bruta s/ venda</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {previa.map((linha) => {
                      const p = produtos.find((x) => x.id === linha.produtoId);
                      return (
                        <tr key={linha.produtoId} className={linha.semCusto ? "bg-amber-500/5" : undefined}>
                          <td className="max-w-[16rem] px-3 py-2">
                            <span className="block truncate text-foreground" title={p?.nome}>
                              {p?.nome ?? linha.produtoId}
                            </span>
                            {linha.semCusto && (
                              <span className="text-[10px] text-amber-600 dark:text-amber-400">
                                sem custo — regra não precifica
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {moeda(linha.custo)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {moeda(linha.precoAtual)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums text-foreground">
                            {moeda(linha.precoNovo)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {pct(linha.acrescimoSobreCusto)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {pct(linha.margemBrutaSobreVenda)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={salvando}
                onClick={() =>
                  void aplicar(
                    previa
                      .filter((l) => l.precoNovo > 0)
                      .map((l) => ({ id: l.produtoId, preco: l.precoNovo })),
                    `Aplicar o novo preço em ${previa.filter((l) => l.precoNovo > 0).length} produto(s)?`,
                  )
                }
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Salvar preços
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          <button
            type="button"
            disabled={salvando || alvos.length === 0}
            onClick={() =>
              void aplicar(
                alvos.map((p) => ({ id: p.id, revisado: true })),
                `Marcar ${alvos.length} produto(s) como revisado(s)?`,
              )
            }
            className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-60"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Marcar como revisado
          </button>
          <button
            type="button"
            disabled={salvando || alvos.filter((p) => p.pendencias.length === 0 && !p.ativo).length === 0}
            onClick={() => {
              const aptos = alvos.filter((p) => p.pendencias.length === 0 && !p.ativo);
              void aplicar(
                aptos.map((p) => ({ id: p.id, ativar: true, revisado: true })),
                `Ativar ${aptos.length} produto(s) apto(s)? Eles passam a ficar disponíveis no PDV.`,
              );
            }}
            className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-60"
          >
            <PackageCheck className="h-3.5 w-3.5" /> Ativar produtos aptos
          </button>
          <p className="w-full text-[11px] text-muted-foreground sm:w-auto sm:self-center">
            Ativação exige nome, categoria e preço &gt; 0. Estoque não é alterado por esta tela.
          </p>
        </div>
      </Card>

      {/* Tabela de conferência */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[80rem] text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-3 text-left">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos"
                    checked={produtos.length > 0 && selecionados.size === produtos.length}
                    onChange={(e) =>
                      setSelecionados(e.target.checked ? new Set(produtos.map((p) => p.id)) : new Set())
                    }
                  />
                </th>
                <th className="px-3 py-3 text-left font-medium">Produto</th>
                <th className="px-3 py-3 text-left font-medium">Barcode</th>
                <th className="px-3 py-3 text-left font-medium">SKU</th>
                <th className="px-3 py-3 text-right font-medium">Custo</th>
                <th className="px-3 py-3 text-right font-medium">Preço</th>
                <th className="px-3 py-3 text-right font-medium">Acrésc. s/ custo</th>
                <th className="px-3 py-3 text-right font-medium">Margem s/ venda</th>
                <th className="px-3 py-3 text-left font-medium">Categoria</th>
                <th className="px-3 py-3 text-left font-medium">Marca</th>
                <th className="px-3 py-3 text-left font-medium">Fornecedor</th>
                <th className="px-3 py-3 text-left font-medium">NCM</th>
                <th className="px-3 py-3 text-left font-medium">CEST</th>
                <th className="px-3 py-3 text-right font-medium">Estoque</th>
                <th className="px-3 py-3 text-left font-medium">Importação</th>
                <th className="px-3 py-3 text-left font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {produtos.map((p) => {
                const est = ROTULO_ESTADO[p.estado];
                const editado = precosEditados[p.id];
                const prev = previaPorId.get(p.id);
                const precoExibido = editado !== undefined ? Number(editado.replace(",", ".")) : p.preco;
                const acresc = Number.isFinite(precoExibido)
                  ? acrescimoSobreCusto(p.custo, precoExibido)
                  : p.acrescimoCusto;
                const margem = Number.isFinite(precoExibido)
                  ? margemBrutaSobreVenda(p.custo, precoExibido)
                  : p.margemBruta;
                return (
                  <tr
                    key={p.id}
                    className={
                      p.estado === "conflito" || p.estado === "erro"
                        ? "bg-destructive/5 align-top"
                        : p.estado === "incompleto"
                          ? "bg-amber-500/5 align-top"
                          : "align-top"
                    }
                  >
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${p.nome}`}
                        checked={selecionados.has(p.id)}
                        onChange={(e) =>
                          setSelecionados((prevSel) => {
                            const next = new Set(prevSel);
                            if (e.target.checked) next.add(p.id);
                            else next.delete(p.id);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="max-w-[18rem] px-3 py-3">
                      <span className="block truncate font-medium text-foreground" title={p.nome}>
                        {p.nome}
                      </span>
                      {p.pendencias.length > 0 && (
                        <span className="mt-0.5 block text-[10px] text-amber-600 dark:text-amber-400">
                          {p.pendencias.join(" · ")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-foreground">{p.barras || "—"}</td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                      {p.sku || "—"}
                      {p.skuSintetico && (
                        <span className="ml-1 inline-block align-middle">
                          <Badge tone="warning">sintético</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {moeda(p.custo)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <input
                          value={editado ?? (p.preco > 0 ? String(p.preco).replace(".", ",") : "")}
                          onChange={(e) =>
                            setPrecosEditados((prevMap) => ({ ...prevMap, [p.id]: e.target.value }))
                          }
                          placeholder={prev && prev.precoNovo > 0 ? String(prev.precoNovo) : "0,00"}
                          className="h-8 w-24 rounded-md border border-border bg-background px-2 text-right text-xs tabular-nums text-foreground"
                        />
                        {editado !== undefined && (
                          <button
                            type="button"
                            title="Salvar preço"
                            disabled={salvando}
                            onClick={() => void salvarPrecoIndividual(p)}
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-60"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{pct(acresc)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{pct(margem)}</td>
                    <td className="px-3 py-3 text-foreground">{p.categoria || "—"}</td>
                    <td className="px-3 py-3 text-muted-foreground">{p.marca || "—"}</td>
                    <td className="max-w-[12rem] px-3 py-3">
                      <span className="block truncate text-muted-foreground" title={p.fornecedor}>
                        {p.fornecedor || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{p.ncm || "—"}</td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{p.cest || "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{p.estoque}</td>
                    <td className="px-3 py-3">
                      <span className="block text-xs text-foreground">
                        {p.acaoImportacao === "criado" ? "Criado" : "Atualizado"}
                      </span>
                      {p.matchPor && (
                        <span className="block text-[10px] text-muted-foreground">
                          por {ROTULO_MATCH[p.matchPor] ?? p.matchPor}
                        </span>
                      )}
                      <span className="block text-[10px] text-muted-foreground">linha {p.linhaOrigem}</span>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={est.tone}>{est.label}</Badge>
                      {!p.ativo && (
                        <span className="mt-1 block text-[10px] text-muted-foreground">inativo</span>
                      )}
                      {p.revisadoPor && (
                        <span className="mt-1 block text-[10px] text-muted-foreground">
                          por {p.revisadoPor}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {produtos.some((p) => p.estado === "conflito") && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-xs text-destructive">
            Há produtos em conflito neste lote. Resolva a duplicidade no cadastro antes de ativar.
          </p>
        </div>
      )}
    </div>
  );
}

function Kpi({
  label,
  valor,
  tone = "neutro",
}: {
  label: string;
  valor: number;
  tone?: "neutro" | "success" | "warning" | "info";
}) {
  const cor =
    tone === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "info"
          ? "text-primary"
          : "text-foreground";
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${cor}`}>{valor}</p>
    </div>
  );
}

function KeyVal({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div>
      <div className={`truncate text-sm text-foreground ${mono ? "font-mono text-xs" : ""}`} title={v}>
        {v}
      </div>
    </div>
  );
}
