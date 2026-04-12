"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getAuditLogs, type AuditEntry } from "@/lib/audit-log"
import { ArrowLeft, Shield } from "lucide-react"

type ServerLog = {
  id: string
  at: string
  action: string
  userLabel: string
  detail: string
  source?: string
}

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Todas as ações" },
  { value: "os_created", label: "Criação de O.S." },
  { value: "sale_finalized", label: "Finalização de Venda" },
  { value: "stock_manual", label: "Alteração de Estoque Manual" },
  { value: "sangria_caixa", label: "Sangria de Caixa" },
  { value: "caixa_aberto", label: "Abertura de Caixa" },
  { value: "desconto_elevado", label: `Desconto acima do limite` },
  { value: "os_status_alterado", label: "Alteração de status (O.S.)" },
  { value: "registro_excluido", label: "Exclusão de registro" },
  { value: "whatsapp_webhook", label: "WhatsApp (webhook)" },
  { value: "whatsapp_comando", label: "WhatsApp (comando)" },
  { value: "whatsapp_webhook_erro", label: "WhatsApp (erro)" },
]

function actionLabel(action: string): string {
  return ACTION_OPTIONS.find((o) => o.value === action)?.label ?? action
}

export default function LogsSistemaPage() {
  const [rows, setRows] = useState<ServerLog[] | null>(null)
  const [localFallback, setLocalFallback] = useState<AuditEntry[]>([])
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [action, setAction] = useState("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (from) params.set("from", from)
    if (to) params.set("to", to)
    if (action && action !== "all") params.set("action", action)
    const res = await fetch(`/api/audit/logs?${params.toString()}`, { credentials: "include" })
    if (res.ok) {
      const j = (await res.json()) as { logs: ServerLog[] }
      setRows(j.logs)
      setLocalFallback([])
    } else {
      setRows(null)
      setError("Não foi possível carregar o banco. Exibindo cópia local do navegador.")
      setLocalFallback(getAuditLogs())
    }
    setLoading(false)
  }, [from, to, action])

  useEffect(() => {
    void load()
  }, [load])

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("pt-BR")
    } catch {
      return iso
    }
  }

  const displayRows: Array<{
    id: string
    at: string
    action: string
    userLabel: string
    detail: string
    source?: string
  }> =
    rows ??
    localFallback.map((r) => ({
      id: r.id,
      at: r.at,
      action: r.action,
      userLabel: r.userLabel,
      detail: r.detail,
      source: "local",
    }))

  return (
    <div className="min-h-screen bg-background p-4 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Logs do Sistema</h1>
              <p className="text-sm text-muted-foreground">
                Trilha de auditoria no servidor (SQLite). Requer sessão de administrador.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Voltar ao sistema
              </Link>
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                await fetch("/api/auth/admin", { method: "DELETE" })
                window.location.href = "/login-admin"
              }}
            >
              Sair
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
            {error}
          </div>
        )}

        <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-end">
          <div className="space-y-1">
            <Label htmlFor="from">De</Label>
            <Input
              id="from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-auto"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to">Até</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
          </div>
          <div className="space-y-1 min-w-[200px]">
            <Label>Tipo de ação</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger>
                <SelectValue placeholder="Ação" />
              </SelectTrigger>
              <SelectContent>
                {ACTION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => void load()} disabled={loading}>
            {loading ? "Carregando…" : "Aplicar filtros"}
          </Button>
        </div>

        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data/Hora</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead className="min-w-[200px]">Detalhe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                    Nenhum evento registrado ainda.
                  </TableCell>
                </TableRow>
              ) : (
                displayRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-sm">{formatDate(r.at)}</TableCell>
                    <TableCell className="text-sm font-medium">{actionLabel(r.action)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.source ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.userLabel}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.detail}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
