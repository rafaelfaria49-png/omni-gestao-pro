"use client"

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, Loader2, Printer, X, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { PdvReceiptInput } from "@/lib/escpos"
import type { PdvImpressaoConfig } from "@/lib/pdv-impressao-config"
import { printPdvSaleReceipt, type PrintJobResult } from "@/lib/pdv-print-runtime"

type PrintStatus = "printing" | "sent" | "failed"

export interface PdvAutoPrintFeedbackProps {
  printInput: PdvReceiptInput | null
  impressaoConfig: PdvImpressaoConfig
  logoUrl?: string
  onDismiss: () => void
}

function errorMessage(result: PrintJobResult, config: PdvImpressaoConfig): string {
  const target = config.impressoraHost.trim()
  if (target) return `Não foi possível alcançar ${target}:${config.impressoraPorta}. ${result.error || "Verifique a conexão."}`
  return result.error || "Nenhuma impressora térmica respondeu. Configure a impressora desta estação."
}

/** Feedback não-modal da impressão automática: mantém o caixa livre para a próxima venda. */
export function PdvAutoPrintFeedback({
  printInput,
  impressaoConfig,
  logoUrl,
  onDismiss,
}: PdvAutoPrintFeedbackProps) {
  const [status, setStatus] = useState<PrintStatus | null>(null)
  const [error, setError] = useState("")

  const runPrint = useCallback(
    async (forceBrowserFallback = false): Promise<PrintJobResult | null> => {
      if (!printInput) return null
      setStatus("printing")
      setError("")
      try {
        const result = await printPdvSaleReceipt({
          config: impressaoConfig,
          logoUrl: logoUrl ?? null,
          receiptFooter: printInput.receiptFooter ?? undefined,
          input: printInput,
          // Falha automática nunca abre preview; o operador escolhe o fallback.
          allowBrowserFallback: false,
          forceBrowserFallback,
        })
        if (result.ok) setStatus("sent")
        else {
          setStatus("failed")
          setError(errorMessage(result, impressaoConfig))
        }
        return result
      } catch (e) {
        const result = { ok: false, error: e instanceof Error ? e.message : String(e) } as PrintJobResult
        setStatus("failed")
        setError(errorMessage(result, impressaoConfig))
        return result
      }
    },
    [impressaoConfig, logoUrl, printInput],
  )

  useEffect(() => {
    if (!printInput) {
      setStatus(null)
      setError("")
      return
    }
    void runPrint()
  }, [printInput, runPrint])

  if (!printInput || !status) return null

  const saleLabel = printInput.numeroVenda ? `Venda ${printInput.numeroVenda}` : "Venda confirmada"

  return (
    <div
      className="fixed right-4 top-4 z-[70] w-[min(420px,calc(100vw-2rem))] rounded-xl border border-border bg-card p-4 shadow-xl"
      role={status === "failed" ? "alert" : "status"}
      aria-live="polite"
      data-testid="pdv-auto-print-feedback"
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${
            status === "failed" ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-600"
          }`}
        >
          {status === "printing" ? <Loader2 className="h-4 w-4 animate-spin" /> : status === "sent" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {status === "printing" ? "Enviando comprovante…" : status === "sent" ? "Comprovante enviado" : "Venda confirmada · impressão pendente"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {status === "printing" ? `${saleLabel}. O PDV continua livre para a próxima venda.` : status === "sent" ? `${saleLabel} · impressão térmica concluída.` : error}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="-mr-2 -mt-2 h-8 w-8 shrink-0" onClick={onDismiss} aria-label="Fechar aviso de impressão">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {status === "sent" && (
        <div className="mt-3 flex gap-2">
          <Button type="button" size="sm" className="flex-1 gap-2" onClick={() => void runPrint()}>
            <Printer className="h-3.5 w-3.5" />
            Imprimir 2ª via
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
            Fechar
          </Button>
        </div>
      )}

      {status === "failed" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" className="gap-2" onClick={() => void runPrint()}>
            <Printer className="h-3.5 w-3.5" />
            Tentar novamente
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void runPrint(true)}>
            Abrir impressão do navegador
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
            Fechar
          </Button>
        </div>
      )}
    </div>
  )
}
