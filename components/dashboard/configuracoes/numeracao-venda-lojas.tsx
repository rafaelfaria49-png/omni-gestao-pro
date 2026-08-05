"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Hash, Lock, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

/**
 * Provisionamento do código de numeração de venda por unidade (GOAL 002C-0b).
 *
 * Embutido na superfície canônica de lojas (`GestaoUnidadesSaas`) — não é uma segunda
 * área de gestão de unidades. Nada aqui ativa a numeração server-side: o writer v2
 * continua desligado e o código só passa a valer quando os slices seguintes forem
 * publicados.
 */

const CODIGO_MAX = 8
const CODIGO_MIN = 2

type NumeracaoRow = {
  storeId: string
  name: string
  codigo: string | null
  configurado: boolean
  imutavel: boolean
  uso: { series: number; vendas: number; consumido: boolean }
}

type Feedback = {
  storeId: string
  tone: "success" | "error"
  message: string
}

/** Remove tudo que a constraint física não aceita e normaliza para maiúsculas. */
function normalizeInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODIGO_MAX)
}

export function NumeracaoVendaLojas() {
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState(false)
  const [rows, setRows] = useState<NumeracaoRow[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [savingId, setSavingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setReadError(false)
    try {
      const r = await fetch("/api/stores/numeracao-venda", {
        credentials: "include",
        cache: "no-store",
        signal,
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = (await r.json()) as { stores?: NumeracaoRow[] }
      setRows(Array.isArray(j.stores) ? j.stores : [])
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return
      setReadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [load])

  const startEditing = (row: NumeracaoRow) => {
    setEditingId(row.storeId)
    // O campo nasce vazio: nenhum código é sugerido automaticamente.
    setDraft("")
    setFeedback(null)
  }

  const cancelEditing = () => {
    setEditingId(null)
    setDraft("")
  }

  const save = async (row: NumeracaoRow) => {
    const codigo = normalizeInput(draft)
    if (codigo.length < CODIGO_MIN) return

    setSavingId(row.storeId)
    setFeedback(null)
    try {
      const r = await fetch("/api/stores/numeracao-venda", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: row.storeId, codigo }),
      })
      const j = (await r.json()) as {
        ok?: boolean
        unchanged?: boolean
        error?: string
        code?: string
      }

      if (!r.ok || j.ok !== true) {
        setFeedback({
          storeId: row.storeId,
          tone: "error",
          message: j.error || "Não foi possível salvar o código.",
        })
        return
      }

      setEditingId(null)
      setDraft("")
      setFeedback({
        storeId: row.storeId,
        tone: "success",
        message: j.unchanged
          ? "Nenhuma alteração: a unidade já usava este código."
          : "Código salvo.",
      })
      toast({
        title: j.unchanged ? "Código mantido" : "Código salvo",
        description: `${row.name || row.storeId} · ${codigo}`,
      })
      await load()
    } catch {
      setFeedback({
        storeId: row.storeId,
        tone: "error",
        message: "Falha de rede ao salvar o código.",
      })
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="mt-8 space-y-5 pt-2">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold leading-snug tracking-tight text-foreground">
          Numeração de venda por unidade
        </h3>
        <p className="text-sm text-muted-foreground">
          Código estável de 2 a 8 caracteres (A–Z e números) que identifica a unidade no número
          comercial da venda. Configurar o código <strong>não ativa</strong> a numeração
          server-side — ela depende das etapas seguintes.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Carregando numeração…</p>
          </div>
        ) : readError ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-destructive/20 bg-destructive/5 px-6 py-8 text-center">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <div className="space-y-1">
              <p className="font-semibold text-foreground">
                Não foi possível carregar a numeração
              </p>
              <p className="text-sm text-muted-foreground">
                Nenhum código foi alterado. Tente novamente.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2 cursor-pointer"
              onClick={() => void load()}
            >
              <RefreshCw className="h-4 w-4" />
              Tentar novamente
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-10 text-center">
            <Hash className="h-6 w-6 text-muted-foreground/70" />
            <p className="text-sm text-muted-foreground">
              Nenhuma unidade acessível para configurar.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const editing = editingId === row.storeId
              const saving = savingId === row.storeId
              const normalized = normalizeInput(draft)
              const podeSalvar = normalized.length >= CODIGO_MIN && !saving
              const rowFeedback = feedback?.storeId === row.storeId ? feedback : null

              return (
                <div
                  key={row.storeId}
                  className="rounded-xl border border-border bg-panel/40 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="truncate font-semibold text-foreground">
                        {(row.name || "Unidade").trim()}
                      </p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground/75">
                        {row.storeId}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {row.configurado ? (
                        <Badge
                          variant="secondary"
                          className="gap-1 font-normal border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Configurado
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="font-normal text-muted-foreground">
                          Não configurado
                        </Badge>
                      )}
                      <span className="font-mono text-sm text-foreground">
                        {row.codigo ?? "—"}
                      </span>
                    </div>
                  </div>

                  {row.imutavel && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Lock className="h-3.5 w-3.5 shrink-0" />
                      Série já iniciada nesta unidade — o código não pode mais ser trocado.
                    </p>
                  )}

                  {!row.imutavel &&
                    (editing ? (
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <Label htmlFor={`codigo-${row.storeId}`}>Código da unidade</Label>
                          <Input
                            id={`codigo-${row.storeId}`}
                            value={draft}
                            onChange={(e) => setDraft(normalizeInput(e.target.value))}
                            maxLength={CODIGO_MAX}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="Ex.: RC01"
                            className="font-mono uppercase"
                            disabled={saving}
                          />
                          <p className="text-xs text-muted-foreground">
                            {CODIGO_MIN} a {CODIGO_MAX} caracteres, apenas letras A–Z e números.
                          </p>
                        </div>

                        {normalized.length >= CODIGO_MIN && (
                          <div className="rounded-lg border border-border bg-card px-3 py-2">
                            <p className="font-mono text-sm text-foreground">
                              VDA-{normalized}-{"{ANO}"}-{"{SEQUÊNCIA}"}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Prefixo comercial. Ano e sequência são definidos pelo servidor no
                              momento da venda — nenhum número é reservado agora.
                            </p>
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            className="cursor-pointer"
                            disabled={!podeSalvar}
                            onClick={() => void save(row)}
                          >
                            {saving ? (
                              <>
                                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                Salvando…
                              </>
                            ) : (
                              "Salvar código"
                            )}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="cursor-pointer"
                            disabled={saving}
                            onClick={cancelEditing}
                          >
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="cursor-pointer"
                        onClick={() => startEditing(row)}
                      >
                        {row.configurado ? "Substituir código" : "Configurar código"}
                      </Button>
                    ))}

                  {rowFeedback && (
                    <p
                      className={cn(
                        "text-xs",
                        rowFeedback.tone === "success" ? "text-emerald-600 dark:text-emerald-300" : "text-destructive",
                      )}
                    >
                      {rowFeedback.message}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
