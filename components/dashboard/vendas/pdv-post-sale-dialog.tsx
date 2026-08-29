"use client"

import { useEffect, useRef, useState } from "react"
import { Receipt, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { printPdvSaleReceipt, type PrintJobResult } from "@/lib/pdv-print-runtime"
import type { PdvReceiptInput } from "@/lib/escpos"
import type { PdvImpressaoConfig } from "@/lib/pdv-impressao-config"

export interface PdvPostSaleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  printInput: PdvReceiptInput | null
  impressaoConfig: PdvImpressaoConfig
  logoUrl?: string
  onAfterClose?: () => void
}

export function PdvPostSaleDialog({
  open,
  onOpenChange,
  printInput,
  impressaoConfig,
  logoUrl,
  onAfterClose,
}: PdvPostSaleDialogProps) {
  const { toast } = useToast()
  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState("")
  const [printed, setPrinted] = useState(false)
  // Refs das duas ações para navegação por teclado (foco/seta) — escopo: só teclado/foco.
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open && printInput) {
      setPrinted(false)
      setPrintError("")
    }
  }, [open, printInput])

  function close() {
    onOpenChange(false)
    onAfterClose?.()
  }

  async function handlePrint() {
    if (!printInput) { close(); return }
    setPrintError("")
    setPrinting(true)
    let result: PrintJobResult
    try {
      result = await printPdvSaleReceipt({
        config: impressaoConfig,
        receiptFooter: printInput.receiptFooter ?? undefined,
        logoUrl: logoUrl ?? null,
        input: printInput,
        // Primeiro tenta somente a térmica. O navegador é uma escolha explícita
        // quando o envio direto não estiver disponível.
        allowBrowserFallback: false,
      })
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      setPrinting(false)
    }

    if (result.ok) {
      setPrinted(true)
      toast({
        title: "Comprovante enviado",
        description: `${impressaoConfig.impressoraHost.trim() || "Impressora configurada"} · ${impressaoConfig.viasCupom} via(s).`,
      })
    } else {
      const target = impressaoConfig.impressoraHost.trim()
      const errMsg = target
        ? `Impressora ${target}:${impressaoConfig.impressoraPorta} inacessível. ${result.error || "Verifique a conexão."}`
        : result.error || "Nenhuma impressora térmica respondeu."
      setPrintError(errMsg)
      toast({ title: "Falha na impressão", description: "A venda continua confirmada. Escolha uma ação para o comprovante.", variant: "destructive" })
    }
  }

  async function handleBrowserPrint() {
    if (!printInput) { close(); return }
    setPrintError("")
    setPrinting(true)
    let result: PrintJobResult
    try {
      result = await printPdvSaleReceipt({
        config: impressaoConfig,
        receiptFooter: printInput.receiptFooter ?? undefined,
        logoUrl: logoUrl ?? null,
        input: printInput,
        forceBrowserFallback: true,
      })
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      setPrinting(false)
    }
    if (result.ok) {
      setPrinted(true)
      toast({ title: "Impressão do navegador aberta", description: "A venda permanece confirmada." })
    } else {
      setPrintError(result.error || "Não foi possível abrir a impressão do navegador.")
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !printing) close()
      }}
    >
      <DialogContent
        className="max-w-sm border-border bg-card"
        onOpenAutoFocus={(e) => {
          // Foco determinístico no botão padrão ("Sim, imprimir") ao abrir.
          // Corrige Enter/Tab que não pegavam por o foco não cair dentro do diálogo.
          e.preventDefault()
          confirmRef.current?.focus()
        }}
        onKeyDown={(e) => {
          // ←/→ alternam entre as duas ações (padrão de diálogo de varejo).
          // Enter/Espaço/Tab seguem o comportamento nativo do botão focado + focus-trap do Radix.
          if (printing) return
          if (e.key === "ArrowRight") {
            e.preventDefault()
            cancelRef.current?.focus()
          } else if (e.key === "ArrowLeft") {
            e.preventDefault()
            confirmRef.current?.focus()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
            {printError ? <AlertTriangle className="h-5 w-5 text-destructive" /> : printed ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Receipt className="h-5 w-5 text-primary" />}
            {printError ? "Impressão não enviada" : printed ? "Comprovante enviado" : "Comprovante não fiscal"}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          {printError
            ? "A venda foi confirmada e não será repetida. Você pode tentar a térmica ou abrir a impressão do navegador."
            : printed
              ? "O comprovante foi enviado. Se necessário, emita uma segunda via do mesmo comprovante."
              : "Venda registrada com sucesso. Envie o comprovante direto para a térmica."
          }
        </p>
        {printError && (
          <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
            {printError}
          </div>
        )}
        <div className="flex gap-3 pt-1">
          <Button
            ref={confirmRef}
            type="button"
            className="flex-1 h-11 gap-2 bg-[hsl(var(--pos-action))] font-semibold text-[hsl(var(--pos-action-foreground))] hover:bg-[hsl(var(--pos-action))]/90 disabled:opacity-60"
            disabled={printing}
            onClick={() => void handlePrint()}
          >
            {printing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Receipt className="h-4 w-4" />
            )}
            {printing ? "Enviando…" : printError ? "Tentar novamente" : printed ? "Imprimir 2ª via" : "Imprimir agora"}
          </Button>
          {printError && (
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1 border-border text-xs"
              disabled={printing}
              onClick={() => void handleBrowserPrint()}
            >
              Abrir impressão do navegador
            </Button>
          )}
          {printed && !printError && (
            <Button type="button" variant="outline" className="h-11 flex-1 border-border" disabled={printing} onClick={close}>
              Fechar
            </Button>
          )}
          {!printed && !printError && (
            <Button
              ref={cancelRef}
              type="button"
              variant="outline"
              className="flex-1 h-11 border-border"
              disabled={printing}
              onClick={close}
            >
              Agora não
            </Button>
          )}
          {printError && (
            <Button type="button" variant="ghost" className="h-11" disabled={printing} onClick={close}>
              Fechar
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
