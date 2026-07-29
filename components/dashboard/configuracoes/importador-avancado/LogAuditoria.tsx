"use client"

import { useMemo, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Clock,
  Copy,
  RefreshCw,
  Sparkles,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type {
  DominioImport,
  ErroDetalhado,
  ImportarResult,
  ImportPorDominio,
} from "./hooks/use-importador-avancado"

/**
 * Visualização do resultado pós-import (modo=importar).
 *
 * Layout:
 * 1. Cabeçalho — batchId, duração, totais globais (criados/atualizados/ignorados/erros).
 * 2. Seções expansíveis por domínio com contadores de porDominio.
 * 3. Bloco "Erros detalhados" — lista de errosDetalhados agrupada por domínio.
 */

const ROTULO_DOMINIO: Record<DominioImport, string> = {
  clientes: "Clientes",
  produtos: "Produtos",
  fornecedores: "Fornecedores",
  vendas: "Vendas",
  ordens_servicos: "Ordens de serviço",
  contas_receber: "Contas a receber",
  contas_pagar: "Contas a pagar",
  fluxo_caixa: "Fluxo de caixa",
  estoque_movimentos: "Movimentos de estoque",
  categorias: "Categorias",
  marcas: "Marcas",
  tecnicos: "Técnicos",
  desconhecido: "Não identificado",
}

function rotuloDominio(d: DominioImport | string): string {
  return ROTULO_DOMINIO[d as DominioImport] ?? String(d)
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0"
  return n.toLocaleString("pt-BR")
}

function formatDuracao(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 ms"
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`
  const m = Math.floor(s / 60)
  const rs = Math.round(s - m * 60)
  return `${m} min ${rs}s`
}

// ---------- Cabeçalho com totais ----------

function StatNumero({
  label,
  valor,
  tom = "neutro",
  Icon,
}: {
  label: string
  valor: number
  tom?: "neutro" | "positivo" | "alerta" | "erro" | "muted"
  Icon?: React.ComponentType<{ className?: string }>
}) {
  const corValor =
    tom === "positivo"
      ? "text-primary"
      : tom === "alerta"
        ? "text-amber-500"
        : tom === "erro"
          ? "text-destructive"
          : tom === "muted"
            ? "text-muted-foreground"
            : "text-foreground"
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {Icon ? <Icon className="h-3 w-3" /> : null}
        {label}
      </div>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums leading-none", corValor)}>
        {formatNumber(valor)}
      </p>
    </div>
  )
}

function CabecalhoResultado({ result }: { result: ImportarResult }) {
  const { totais, batchId, duracaoMs, storeId } = result
  const teveErros = totais.erros > 0
  const [copiado, setCopiado] = useState(false)

  const copiarBatch = async () => {
    if (!batchId) return
    try {
      await navigator.clipboard.writeText(batchId)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 1500)
    } catch {
      // silencioso — clipboard pode estar bloqueado
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          {teveErros ? (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-4 w-4" />
            </div>
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-foreground">
              {teveErros ? "Importação concluída com avisos" : "Importação concluída com sucesso"}
            </p>
            <p className="text-xs text-muted-foreground">
              Loja <span className="font-mono">{storeId || "—"}</span>
              {" · "}
              <Clock className="-mt-0.5 inline h-3 w-3" /> {formatDuracao(duracaoMs)}
            </p>
          </div>
        </div>

        {batchId ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copiarBatch}
            className="gap-2 font-mono text-xs"
            title="Copiar identificador da importação"
          >
            {copiado ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
            {batchId}
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatNumero label="Criados" valor={totais.criados} tom="positivo" Icon={Sparkles} />
        <StatNumero label="Atualizados" valor={totais.atualizados} tom="neutro" Icon={RefreshCw} />
        <StatNumero label="Ignorados" valor={totais.ignorados} tom="muted" Icon={CircleSlash} />
        <StatNumero
          label="Erros"
          valor={totais.erros}
          tom={totais.erros > 0 ? "erro" : "muted"}
          Icon={AlertCircle}
        />
      </div>
    </div>
  )
}

// ---------- Seções por domínio ----------

type EntradaPorDominio = {
  dominio: DominioImport
  criados: number
  atualizados: number
  ignorados: number
  erros: number
}

function normalizarPorDominio(pd: ImportPorDominio): EntradaPorDominio[] {
  const entradas: EntradaPorDominio[] = []
  for (const [k, v] of Object.entries(pd)) {
    if (!v) continue
    entradas.push({
      dominio: k as DominioImport,
      criados: typeof v.criados === "number" ? v.criados : 0,
      atualizados: typeof v.atualizados === "number" ? v.atualizados : 0,
      ignorados: typeof v.ignorados === "number" ? v.ignorados : 0,
      erros: typeof v.erros === "number" ? v.erros : 0,
    })
  }
  // Ordena por volume total desc; erros empurram pra cima dentro de empate.
  entradas.sort((a, b) => {
    const tA = a.criados + a.atualizados + a.ignorados + a.erros
    const tB = b.criados + b.atualizados + b.ignorados + b.erros
    if (tA !== tB) return tB - tA
    return b.erros - a.erros
  })
  return entradas
}

function SecaoDominio({
  entrada,
  erros,
}: {
  entrada: EntradaPorDominio
  erros: ErroDetalhado[]
}) {
  const [aberto, setAberto] = useState(entrada.erros > 0)
  const teveErros = entrada.erros > 0
  const total = entrada.criados + entrada.atualizados + entrada.ignorados + entrada.erros

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
        aria-expanded={aberto}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              aberto ? "rotate-0" : "-rotate-90",
            )}
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{rotuloDominio(entrada.dominio)}</p>
            <p className="text-xs text-muted-foreground">
              <span className="tabular-nums text-foreground">{formatNumber(total)}</span> registro
              {total === 1 ? "" : "s"} processado{total === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {entrada.criados > 0 ? (
            <Badge variant="secondary" className="tabular-nums">
              +{formatNumber(entrada.criados)} novos
            </Badge>
          ) : null}
          {entrada.atualizados > 0 ? (
            <Badge variant="outline" className="tabular-nums">
              {formatNumber(entrada.atualizados)} atualizados
            </Badge>
          ) : null}
          {teveErros ? (
            <Badge variant="destructive" className="tabular-nums">
              {formatNumber(entrada.erros)} erro{entrada.erros === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </div>
      </button>

      {aberto && (
        <div className="border-t border-border">
          <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4">
            <MiniStat label="Criados" valor={entrada.criados} tom="positivo" />
            <MiniStat label="Atualizados" valor={entrada.atualizados} tom="neutro" />
            <MiniStat label="Ignorados" valor={entrada.ignorados} tom="muted" />
            <MiniStat label="Erros" valor={entrada.erros} tom={teveErros ? "erro" : "muted"} />
          </div>

          {teveErros && erros.length > 0 ? (
            <div className="border-t border-border bg-muted/20">
              <div className="px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Linhas com erro neste domínio
              </div>
              <ul className="divide-y divide-border">
                {erros.map((erro, idx) => (
                  <li key={`${erro.chave}-${idx}`} className="px-4 py-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs text-foreground" title={erro.chave}>
                          {erro.chave}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{erro.detalhe}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

function MiniStat({
  label,
  valor,
  tom,
}: {
  label: string
  valor: number
  tom: "positivo" | "neutro" | "muted" | "erro"
}) {
  const cor =
    tom === "positivo"
      ? "text-primary"
      : tom === "erro"
        ? "text-destructive"
        : tom === "muted"
          ? "text-muted-foreground"
          : "text-foreground"
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-base font-semibold tabular-nums", cor)}>{formatNumber(valor)}</p>
    </div>
  )
}

// ---------- Componente principal ----------

export type LogAuditoriaProps = {
  result: ImportarResult
  /** Acionado pelo botão "Nova importação" — devolve ao estado idle. */
  onReiniciar?: () => void
  /**
   * Acionado pelo CTA "Revisar produtos desta importação" (Parte 9).
   * Sem callback, o CTA mostra o batchId para consulta manual na aba Histórico.
   */
  onRevisarLoteProdutos?: (batchId: string) => void
}

export function LogAuditoria({ result, onReiniciar, onRevisarLoteProdutos }: LogAuditoriaProps) {
  const entradas = useMemo(() => normalizarPorDominio(result.porDominio), [result.porDominio])

  // Produtos efetivamente gravados neste lote — base do CTA de conferência.
  const produtosDoLote = useMemo(
    () => result.resumoProdutos.filter((r) => r.acao === "criado" || r.acao === "atualizado"),
    [result.resumoProdutos],
  )

  /** Agrupa errosDetalhados por dominio para entregar ao SecaoDominio. */
  const errosPorDominio = useMemo(() => {
    const map = new Map<string, ErroDetalhado[]>()
    for (const e of result.errosDetalhados) {
      const k = String(e.dominio)
      const arr = map.get(k)
      if (arr) arr.push(e)
      else map.set(k, [e])
    }
    return map
  }, [result.errosDetalhados])

  const semDados = entradas.length === 0

  return (
    <div className="space-y-4">
      <CabecalhoResultado result={result} />

      {/* Seções por domínio */}
      {semDados ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm font-medium text-foreground">Nenhum domínio foi processado</p>
          <p className="mt-1 text-xs text-muted-foreground">
            A importação rodou mas não retornou contadores. Verifique se os arquivos enviados tinham planilhas
            reconhecidas pelo detector.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {entradas.map((entrada) => (
            <SecaoDominio
              key={entrada.dominio}
              entrada={entrada}
              erros={errosPorDominio.get(entrada.dominio) ?? []}
            />
          ))}
        </div>
      )}

      {/* CTA principal: conferência do lote de produtos (Parte 9) */}
      {produtosDoLote.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {produtosDoLote.length} produto(s) neste lote aguardam conferência
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Defina preço de venda, confira código de barras e fiscal, marque como revisado e ative
              os produtos aptos. Produtos sem preço ficaram inativos e não aparecem no PDV.
            </p>
          </div>
          {onRevisarLoteProdutos ? (
            <Button
              type="button"
              onClick={() => onRevisarLoteProdutos(result.batchId)}
              className="shrink-0 gap-2"
            >
              <Sparkles className="h-4 w-4" />
              Revisar produtos desta importação
            </Button>
          ) : (
            <p className="shrink-0 text-xs text-muted-foreground">
              Abra <span className="font-medium text-foreground">Importação → Histórico</span> e use o
              lote <span className="font-mono">{result.batchId}</span>.
            </p>
          )}
        </div>
      )}

      {/* Rodapé */}
      {onReiniciar ? (
        <div className="flex items-center justify-end">
          <Button type="button" variant="outline" onClick={onReiniciar} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Nova importação
          </Button>
        </div>
      ) : null}
    </div>
  )
}
