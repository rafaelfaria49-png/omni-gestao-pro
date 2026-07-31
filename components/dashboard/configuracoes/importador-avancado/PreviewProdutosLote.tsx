"use client"

import { Fragment, useMemo, useState } from "react"
import { AlertTriangle, ChevronDown, ChevronRight, ShieldAlert } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { PreviewLinhaProduto, PreviewProdutos } from "./hooks/use-importador-avancado"

/**
 * Preview honesto do lote de produtos (Parte 8 do contrato).
 *
 * Mostra, por linha: identificação, valores, fiscal, resultado previsto, motivo do
 * match, campos que serão alterados/preservados e todos os alertas. Conflito é a
 * única severidade que trava a importação — o restante é informação para a
 * conferência pós-importação decidir.
 */

const ROTULO_RESULTADO: Record<PreviewLinhaProduto["resultado"], string> = {
  criar: "Criar",
  atualizar: "Atualizar",
  ignorar: "Ignorar",
  conflito: "Conflito",
}

const ROTULO_MATCH: Record<string, string> = {
  barcode: "código de barras",
  sku: "SKU",
  codigo_fornecedor: "código do fornecedor",
  nome_exato: "nome exato",
}

function BadgeResultado({ resultado }: { resultado: PreviewLinhaProduto["resultado"] }) {
  if (resultado === "conflito") {
    return (
      <Badge variant="destructive" className="gap-1">
        <ShieldAlert className="h-3 w-3" />
        {ROTULO_RESULTADO.conflito}
      </Badge>
    )
  }
  if (resultado === "criar") return <Badge variant="secondary">{ROTULO_RESULTADO.criar}</Badge>
  if (resultado === "atualizar") return <Badge variant="outline">{ROTULO_RESULTADO.atualizar}</Badge>
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {ROTULO_RESULTADO.ignorar}
    </Badge>
  )
}

function moeda(v: number): string {
  return v > 0 ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"
}

export function PreviewProdutosLote({ preview }: { preview: PreviewProdutos }) {
  const [expandida, setExpandida] = useState<number | null>(null)

  const totalAlertas = useMemo(
    () => preview.linhas.reduce((acc, l) => acc + l.alertas.length, 0),
    [preview.linhas],
  )

  if (preview.linhas.length === 0) return null

  return (
    <div className="space-y-3">
      {/* Totais previstos */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CardTotal label="Criar" valor={preview.totalCriar} />
        <CardTotal label="Atualizar" valor={preview.totalAtualizar} />
        <CardTotal label="Ignorar" valor={preview.totalIgnorar} />
        <CardTotal label="Conflitos" valor={preview.totalConflito} tom={preview.totalConflito > 0 ? "erro" : "neutro"} />
      </div>

      {/* Bloqueio por conflito */}
      {preview.bloqueado && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-destructive">
              Importação bloqueada por conflito de duplicidade
            </p>
            <p className="mt-1 text-xs text-destructive/90">
              Há linhas que casam com mais de um produto desta loja. Resolva no cadastro (unifique ou
              diferencie os produtos) e pré-visualize de novo — nada será persistido até então.
            </p>
          </div>
        </div>
      )}

      {/* Aviso de match por nome */}
      {preview.linhas.some((l) => l.matchPor === "nome_exato") && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Correspondência por nome exato</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {preview.linhas.filter((l) => l.matchPor === "nome_exato").length} linha(s) serão
              vinculadas a produtos existentes pelo nome, porque esses produtos não têm código de
              barras ou têm SKU gerado por importador. Confira antes de importar.
            </p>
          </div>
        </div>
      )}

      {/* Tabela linha a linha */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full min-w-[72rem] text-sm">
            <thead className="sticky top-0 z-10 bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-3 py-2 text-left font-medium">#</th>
                <th className="px-3 py-2 text-left font-medium">Produto</th>
                <th className="px-3 py-2 text-left font-medium">Barcode</th>
                <th className="px-3 py-2 text-left font-medium">SKU</th>
                <th className="px-3 py-2 text-left font-medium">Categoria</th>
                <th className="px-3 py-2 text-left font-medium">Marca</th>
                <th className="px-3 py-2 text-left font-medium">Fornecedor</th>
                <th className="px-3 py-2 text-right font-medium">Custo</th>
                <th className="px-3 py-2 text-right font-medium">Preço</th>
                <th className="px-3 py-2 text-right font-medium">Estoque</th>
                <th className="px-3 py-2 text-left font-medium">NCM</th>
                <th className="px-3 py-2 text-left font-medium">CEST</th>
                <th className="px-3 py-2 text-left font-medium">Resultado</th>
                <th className="px-3 py-2 text-left font-medium">Alertas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {preview.linhas.map((l) => {
                const aberta = expandida === l.linhaOrigem
                const temErro = l.alertas.some((a) => a.severidade === "erro")
                return (
                  <Fragment key={`linha-${l.linhaOrigem}`}>
                    <tr
                      className={cn(
                        "cursor-pointer align-top transition hover:bg-accent/40",
                        temErro && "bg-destructive/5",
                      )}
                      onClick={() => setExpandida(aberta ? null : l.linhaOrigem)}
                    >
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        <span className="flex items-center gap-1">
                          {aberta ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                          {l.linhaOrigem}
                        </span>
                      </td>
                      <td className="max-w-[18rem] px-3 py-2">
                        <span className="block truncate font-medium text-foreground" title={l.produto}>
                          {l.produto || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-foreground">{l.barcode || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{l.sku || "—"}</td>
                      <td className="px-3 py-2 text-foreground">{l.categoria || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.marca || "—"}</td>
                      <td className="max-w-[12rem] px-3 py-2">
                        <span className="block truncate text-muted-foreground" title={l.fornecedor}>
                          {l.fornecedor || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">{moeda(l.custo)}</td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right tabular-nums",
                          l.preco > 0 ? "text-foreground" : "text-amber-600 dark:text-amber-400",
                        )}
                      >
                        {moeda(l.preco)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {l.estoque == null ? "—" : l.estoque}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{l.ncm || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{l.cest || "—"}</td>
                      <td className="px-3 py-2">
                        <BadgeResultado resultado={l.resultado} />
                        {l.matchPor && (
                          <span className="mt-1 block text-[10px] text-muted-foreground">
                            por {ROTULO_MATCH[l.matchPor] ?? l.matchPor}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {l.alertas.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={cn(
                              "text-xs font-medium",
                              temErro ? "text-destructive" : "text-amber-600 dark:text-amber-400",
                            )}
                          >
                            {l.alertas.length}
                          </span>
                        )}
                      </td>
                    </tr>
                    {aberta && (
                      <tr className="bg-muted/30">
                        <td colSpan={14} className="px-6 py-3">
                          <div className="grid min-w-0 gap-3 md:grid-cols-3">
                            <div className="min-w-0">
                              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                Motivo
                              </p>
                              <p className="mt-1 text-xs text-foreground">{l.motivo}</p>
                            </div>
                            <div className="min-w-0">
                              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                Campos que serão alterados
                              </p>
                              <p className="mt-1 text-xs text-foreground">
                                {l.camposAlterados.length > 0 ? l.camposAlterados.join(" · ") : "—"}
                              </p>
                            </div>
                            <div className="min-w-0">
                              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                Campos preservados
                              </p>
                              <p className="mt-1 text-xs text-foreground">
                                {l.camposPreservados.length > 0 ? l.camposPreservados.join(" · ") : "—"}
                              </p>
                            </div>
                          </div>
                          {l.alertas.length > 0 && (
                            <ul className="mt-3 space-y-1">
                              {l.alertas.map((a, i) => (
                                <li
                                  key={`${a.codigo}-${i}`}
                                  className={cn(
                                    "flex items-start gap-1.5 text-xs",
                                    a.severidade === "erro"
                                      ? "text-destructive"
                                      : "text-amber-600 dark:text-amber-400",
                                  )}
                                >
                                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                  {a.mensagem}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {totalAlertas} alerta(s) no lote. Alertas de preço, código de barras, categoria e fiscal não
        impedem a importação — os produtos entram pendentes de revisão.
      </p>
    </div>
  )
}

function CardTotal({
  label,
  valor,
  tom = "neutro",
}: {
  label: string
  valor: number
  tom?: "neutro" | "erro"
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums",
          tom === "erro" ? "text-destructive" : "text-foreground",
        )}
      >
        {valor}
      </p>
    </div>
  )
}
