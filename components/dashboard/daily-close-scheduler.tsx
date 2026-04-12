"use client"

import { useEffect, useRef } from "react"
import { useConfigEmpresa } from "@/lib/config-empresa"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { ensureLedger, type DailyLedger } from "@/lib/operations-store"
import { buildDailyClosingWhatsAppMessage, digitsOnlyPhone } from "@/lib/daily-report"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"

const SENT_PREFIX = "assistec-daily-wa-sent-"

function readLedgerFromStorage(opsKey: string): DailyLedger {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(opsKey) : null
    if (!raw) return ensureLedger(undefined)
    const p = JSON.parse(raw) as { dailyLedger?: DailyLedger }
    return ensureLedger(p.dailyLedger)
  } catch {
    return ensureLedger(undefined)
  }
}

/** Dispara o resumo diário por volta das 23:58 e abre o WhatsApp Web com a mensagem pronta. */
export function DailyCloseScheduler() {
  const { config } = useConfigEmpresa()
  const { opsStorageKey, empresaDocumentos } = useLojaAtiva()
  const fired = useRef(false)

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const y = now.getFullYear()
      const m = String(now.getMonth() + 1).padStart(2, "0")
      const d = String(now.getDate()).padStart(2, "0")
      const dayKey = `${y}-${m}-${d}`
      const sentKey = SENT_PREFIX + dayKey
      if (typeof localStorage !== "undefined" && localStorage.getItem(sentKey)) return
      if (now.getHours() !== 23 || now.getMinutes() < 58) {
        fired.current = false
        return
      }
      if (fired.current) return
      fired.current = true

      const rawPhone =
        (config.empresa.contato.whatsappDono ?? "").trim() ||
        config.empresa.contato.whatsapp?.trim() ||
        config.empresa.contato.telefone?.trim() ||
        ""
      const digits = digitsOnlyPhone(rawPhone)
      if (digits.length < 10) return

      const ledger = readLedgerFromStorage(opsStorageKey)
      const nome = (empresaDocumentos.nomeFantasia || config.empresa.nomeFantasia || APP_DISPLAY_NAME).trim()
      const msg = buildDailyClosingWhatsAppMessage({
        empresaNome: nome,
        dataLabel: now.toLocaleDateString("pt-BR"),
        ledger,
      })

      void fetch("/api/whatsapp/send-daily", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: rawPhone,
          empresaNome: nome,
        }),
      })
        .then((r) => {
          if (r.ok) return
          const n = digits.startsWith("55") ? digits : `55${digits}`
          window.open(
            `https://wa.me/${n}?text=${encodeURIComponent(msg)}`,
            "_blank",
            "noopener,noreferrer"
          )
        })
        .catch(() => {
          const n = digits.startsWith("55") ? digits : `55${digits}`
          window.open(
            `https://wa.me/${n}?text=${encodeURIComponent(msg)}`,
            "_blank",
            "noopener,noreferrer"
          )
        })
      try {
        localStorage.setItem(sentKey, "1")
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new CustomEvent("assistec-daily-report", { detail: msg }))
    }

    const id = setInterval(tick, 30_000)
    tick()
    return () => clearInterval(id)
  }, [
    config.empresa.contato.telefone,
    config.empresa.contato.whatsapp,
    config.empresa.contato.whatsappDono,
    config.empresa.nomeFantasia,
    opsStorageKey,
    empresaDocumentos.nomeFantasia,
  ])

  return null
}
