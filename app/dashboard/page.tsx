"use client"

import Link from "next/link"
import { PackageX, Users } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { resolveLojaIdParaConsultaClientes } from "@/lib/clientes-loja-resolve"
import { useLojaAtiva } from "@/lib/loja-ativa"

export default function DashboardInicioPage() {
  const { lojaAtivaId } = useLojaAtiva()
  const lojaHeader = useMemo(() => resolveLojaIdParaConsultaClientes(lojaAtivaId), [lojaAtivaId])
  const [totalClientes, setTotalClientes] = useState(0)
  const [produtosEsgotados, setProdutosEsgotados] = useState(0)
  const [resumoError, setResumoError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch(`/api/dashboard/resumo?storeId=${encodeURIComponent(lojaHeader)}`, {
          cache: "no-store",
          credentials: "include",
          headers: { [ASSISTEC_LOJA_HEADER]: lojaHeader },
        })
        const j = (await r.json().catch(() => null)) as {
          ok?: boolean
          totalClientes?: number
          produtosEsgotados?: number
          error?: string
        } | null
        if (cancelled) return
        if (!r.ok || !j?.ok) {
          setResumoError(j?.error || "Falha ao carregar resumo")
          setTotalClientes(0)
          setProdutosEsgotados(0)
          return
        }
        setResumoError(null)
        setTotalClientes(typeof j.totalClientes === "number" ? j.totalClientes : 0)
        setProdutosEsgotados(typeof j.produtosEsgotados === "number" ? j.produtosEsgotados : 0)
      } catch {
        if (!cancelled) {
          setResumoError("Falha ao carregar resumo")
          setTotalClientes(0)
          setProdutosEsgotados(0)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [lojaHeader])

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background p-4 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Painel inicial</h1>
          <p className="mt-1 text-sm text-black/70">Visão rápida por unidade</p>
          {resumoError ? <p className="mt-2 text-sm text-red-600">{resumoError}</p> : null}
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <Link
            href="/dashboard/clientes"
            className="group relative overflow-hidden rounded-2xl border border-red-900/40 bg-gradient-to-br from-zinc-950 via-black to-zinc-950 p-8 shadow-lg shadow-red-950/20 transition hover:border-red-600/50 hover:shadow-red-900/30"
          >
            <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full bg-red-600/10 blur-2xl transition group-hover:bg-red-600/20" />
            <div className="relative flex flex-col gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-red-600/20 text-red-500 ring-1 ring-red-600/40">
                <Users className="h-7 w-7" strokeWidth={2} />
              </div>
              <div>
                <p className="text-sm font-medium uppercase tracking-wider text-red-400/90">Clientes</p>
                <p className="mt-2 text-4xl font-bold tabular-nums text-white">{totalClientes}</p>
                <p className="mt-1 text-sm text-zinc-400">Total de clientes cadastrados nesta unidade</p>
              </div>
              <span className="text-xs font-medium text-red-500/80 group-hover:text-red-400">Abrir gestão →</span>
            </div>
          </Link>

          <Link
            href="/dashboard/estoque"
            className="group relative overflow-hidden rounded-2xl border border-red-900/40 bg-gradient-to-br from-black via-zinc-950 to-black p-8 shadow-lg shadow-red-950/20 transition hover:border-red-600/50 hover:shadow-red-900/30"
          >
            <div className="absolute -left-4 bottom-0 h-28 w-28 rounded-full bg-red-600/10 blur-2xl transition group-hover:bg-red-600/20" />
            <div className="relative flex flex-col gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-red-950/80 text-red-400 ring-1 ring-red-700/50">
                <PackageX className="h-7 w-7" strokeWidth={2} />
              </div>
              <div>
                <p className="text-sm font-medium uppercase tracking-wider text-red-400/90">Estoque</p>
                <p className="mt-2 text-4xl font-bold tabular-nums text-white">{produtosEsgotados}</p>
                <p className="mt-1 text-sm text-zinc-400">Produtos com estoque zerado nesta unidade</p>
              </div>
              <span className="text-xs font-medium text-red-500/80 group-hover:text-red-400">Abrir estoque →</span>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
