"use client"

import { useMemo, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileWarning,
  Loader2,
  Rocket,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { DominioImport, PreviewResult, PreviewSheet } from "./hooks/use-importador-avancado"

/**
 * Visualização do preview retornado por POST /api/import/advanced?modo=preview.
 *
 * - mostra erros globais (ZIP corrompido, formato inválido) em destaque
 * - lista cada planilha detectada com badge de domínio + barra de confiança
 * - amostra dos primeiros registros colapsável (mantém a tela limpa)
 * - botão "Importar tudo" dispara o callback recebido
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

type NivelConfianca = "alto" | "medio" | "baixo" | "nulo"

function nivelConfianca(c: number, dominio: DominioImport): NivelConfianca {
  if (dominio === "desconhecido") return "nulo"
  if (c >= 0.8) return "alto"
  if (c >= 0.5) return "medio"
  return "baixo"
}

/**
 * Classes da barra de confiança por nível.
 * Usamos cores semânticas onde existem (primary/destructive) e fallback
 * controlado com amber para o nível médio — mesmo padrão do projeto
 * (ex.: SLABadge em operacoes/badges.tsx).
 */
const CLASSES_CONFIANCA: Record<NivelConfianca, { barra: string; texto: string; rotulo: string }> = {
  alto: { barra: "bg-primary", texto: "text-primary", rotulo: "Alta" },
  medio: { barra: "bg-amber-500", texto: "text-amber-500", rotulo: "Média" },
  baixo: { barra: "bg-destructive", texto: "text-destructive", rotulo: "Baixa" },
  nulo: { barra: "bg-muted-foreground/30", texto: "text-muted-foreground", rotulo: "—" },
}

function BadgeDominio({ dominio }: { dominio: DominioImport }) {
  if (dominio === "desconhecido") {
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <FileWarning className="h-3 w-3" />
        {ROTULO_DOMINIO[dominio]}
      </Badge>
    )
  }
  return <Badge variant="secondary">{ROTULO_DOMINIO[dominio]}</Badge>
}

function BarraConfianca({ valor, dominio }: { valor: number; dominio: DominioImport }) {
  const pct = Math.round(Math.max(0, Math.min(1, valor)) * 100)
  const nivel = nivelConfianca(valor, dominio)
  const conf = CLASSES_CONFIANCA[nivel]
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", conf.barra)}
          style={{ width: `${pct}%` }}
          aria-hidden
        />
      </div>
      <span
        className={cn("text-xs font-medium tabular-nums", conf.texto)}
        aria-label={`Confiança ${conf.rotulo} — ${pct}%`}
      >
        {pct}%
      </span>
    </div>
  )
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0"
  return n.toLocaleString("pt-BR")
}

function CardPlanilha({ planilha }: { planilha: PreviewSheet }) {
  const [aberto, setAberto] = useState(false)
  const temAmostra =
    Array.isArray(planilha.amostra) &&
    planilha.amostra.length > 0 &&
    Array.isArray(planilha.headers) &&
    planilha.headers.length > 0
  const totaisVisiveis =
    typeof planilha.totalCriar === "number" ||
    typeof planilha.totalAtualizar === "number" ||
    typeof planilha.totalIgnorar === "number"

  return (
    <div className="rounded-xl border border-border bg-card transition-colors hover:border-border/80">
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground" title={planilha.fileName}>
              {planilha.fileName}
              {planilha.sheetName ? (
                <span className="ml-1 text-muted-foreground">/ {planilha.sheetName}</span>
              ) : null}
            </p>
            <BadgeDominio dominio={planilha.dominio} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="tabular-nums text-foreground">{formatNumber(planilha.totalLinhas)}</span>{" "}
              linha{planilha.totalLinhas === 1 ? "" : "s"}
            </span>
            {totaisVisiveis && (
              <>
                {typeof planilha.totalCriar === "number" && (
                  <span>
                    Criar: <span className="tabular-nums text-foreground">{formatNumber(planilha.totalCriar)}</span>
                  </span>
                )}
                {typeof planilha.totalAtualizar === "number" && (
                  <span>
                    Atualizar:{" "}
                    <span className="tabular-nums text-foreground">{formatNumber(planilha.totalAtualizar)}</span>
                  </span>
                )}
                {typeof planilha.totalIgnorar === "number" && (
                  <span>
                    Ignorar:{" "}
                    <span className="tabular-nums text-foreground">{formatNumber(planilha.totalIgnorar)}</span>
                  </span>
                )}
              </>
            )}
          </div>
          {planilha.observacao ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">{planilha.observacao}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <BarraConfianca valor={planilha.confianca} dominio={planilha.dominio} />
          {temAmostra && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAberto((v) => !v)}
              className="gap-1 text-muted-foreground hover:text-foreground"
              aria-expanded={aberto}
            >
              {aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Amostra
            </Button>
          )}
        </div>
      </div>

      {aberto && temAmostra && planilha.headers && planilha.amostra ? (
        <div className="border-t border-border bg-muted/30">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  {planilha.headers.map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {planilha.amostra.slice(0, 5).map((row, idx) => (
                  <tr key={idx} className="hover:bg-muted/40">
                    {planilha.headers!.map((h) => {
                      const v = row[h]
                      const txt = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)
                      return (
                        <td
                          key={h}
                          className="max-w-[240px] truncate px-3 py-1.5 text-foreground"
                          title={txt}
                        >
                          {txt}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {planilha.amostra.length > 5 ? (
            <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
              Mostrando 5 de {formatNumber(planilha.amostra.length)} linhas de amostra.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export type PreviewCruzamentoProps = {
  preview: PreviewResult
  /** Verdadeiro durante import-loading; desabilita o botão de importar. */
  importando?: boolean
  /** `true` trava o botão Importar (ex.: conflito de duplicidade em produtos). */
  bloqueado?: boolean
  /** Texto mostrado no lugar da confirmação quando `bloqueado`. */
  motivoBloqueio?: string
  onImportar: () => void
}

export function PreviewCruzamento({
  preview,
  importando = false,
  bloqueado = false,
  motivoBloqueio,
  onImportar,
}: PreviewCruzamentoProps) {
  const { planilhas, erros } = preview
  const [clicked, setClicked] = useState(false)

  const resumo = useMemo(() => {
    const arquivos = new Set(planilhas.map((p) => p.fileName)).size
    const total = planilhas.reduce((acc, p) => acc + (Number.isFinite(p.totalLinhas) ? p.totalLinhas : 0), 0)
    const naoIdentificadas = planilhas.filter((p) => p.dominio === "desconhecido").length
    return { arquivos, total, naoIdentificadas }
  }, [planilhas])

  const semConteudo = planilhas.length === 0

  return (
    <div className="space-y-4">
      {/* Resumo do cruzamento */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ResumoCard label="Arquivos" valor={formatNumber(resumo.arquivos)} />
        <ResumoCard label="Planilhas detectadas" valor={formatNumber(planilhas.length)} />
        <ResumoCard label="Linhas no total" valor={formatNumber(resumo.total)} />
        <ResumoCard
          label="Não identificadas"
          valor={formatNumber(resumo.naoIdentificadas)}
          tom={resumo.naoIdentificadas > 0 ? "alerta" : "neutro"}
        />
      </div>

      {/* Erros globais (ZIP corrompido, formato inválido etc.) */}
      {Array.isArray(erros) && erros.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertCircle className="h-4 w-4" />
            {erros.length} aviso{erros.length === 1 ? "" : "s"} de leitura
          </div>
          <ul className="ml-6 list-disc space-y-1 text-xs text-destructive/90">
            {erros.map((e, idx) => (
              <li key={idx}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Lista de planilhas */}
      {semConteudo ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm font-medium text-foreground">Nenhuma planilha identificada</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Verifique se os arquivos enviados são planilhas válidas ou um ZIP de exportação suportado.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {planilhas.map((p, idx) => (
            <CardPlanilha key={`${p.fileName}-${p.sheetName ?? ""}-${idx}`} planilha={p} />
          ))}
        </div>
      )}

      {/* Rodapé com ação */}
      {!semConteudo && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
          {bloqueado ? (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <AlertCircle className="h-4 w-4" />
              {motivoBloqueio ?? "Importação bloqueada — resolva os conflitos acima."}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Revisado o cruzamento — tudo certo para importar?
            </div>
          )}
          <Button
            type="button"
            onClick={() => {
              setClicked(true)
              onImportar()
            }}
            disabled={importando || clicked || bloqueado}
            className="gap-2"
          >
            {importando || clicked ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Importando…
              </>
            ) : (
              <>
                <Rocket className="h-4 w-4" />
                Importar tudo
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}

// -- helpers internos ------------------------------------------------------

function ResumoCard({
  label,
  valor,
  tom = "neutro",
}: {
  label: string
  valor: string
  tom?: "neutro" | "alerta"
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums",
          tom === "alerta" ? "text-amber-500" : "text-foreground",
        )}
      >
        {valor}
      </p>
    </div>
  )
}
