"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { StaffAppRole } from "@/lib/staff-session"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"

type StaffCtx = { role: StaffAppRole }

const StaffAccessContext = createContext<StaffCtx | null>(null)

export function useStaffAccess(): StaffAppRole | null {
  return useContext(StaffAccessContext)?.role ?? null
}

type GateMode = StaffAppRole | null

export function AccessGate({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<StaffAppRole | null>(null)
  const [pick, setPick] = useState<GateMode>(null)
  const [pin, setPin] = useState("")
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/auth/staff", { method: "GET", credentials: "include", cache: "no-store" })
      const j = (await r.json().catch(() => null)) as { ok?: boolean; role?: StaffAppRole } | null
      if (j?.ok === true && j.role) setRole(j.role)
      else setRole(null)
    } catch {
      setRole(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pick) return
    setErr("")
    setBusy(true)
    try {
      const r = await fetch("/api/auth/staff", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: pick, pin }),
      })
      const j = (await r.json().catch(() => null)) as { error?: string } | null
      if (!r.ok) {
        setErr(j?.error === "invalid_pin" ? "PIN incorreto." : "Não foi possível entrar. Tente novamente.")
        return
      }
      setPin("")
      setPick(null)
      await refresh()
    } catch {
      setErr("Falha de rede.")
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen min-h-[100dvh] w-full items-center justify-center bg-background text-muted-foreground text-sm">
        Carregando acesso…
      </div>
    )
  }

  if (!role) {
    return (
      <div className="min-h-screen min-h-[100dvh] w-full flex flex-col items-center justify-center bg-gradient-to-b from-background to-muted/30 p-4">
        <div className="w-full max-w-lg space-y-2 text-center mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{APP_DISPLAY_NAME}</h1>
          <p className="text-sm text-muted-foreground">Quem está acessando esta máquina agora?</p>
        </div>

        {!pick ? (
          <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => setPick("ADMIN")}
              className={cn(
                "rounded-2xl border-2 border-border bg-card p-6 text-left shadow-sm transition hover:border-primary hover:shadow-md",
                "min-h-[120px] flex flex-col justify-end gap-1"
              )}
            >
              <span className="text-lg font-semibold text-foreground">Dono</span>
              <span className="text-xs text-muted-foreground">Administrador · visão completa</span>
            </button>
            <button
              type="button"
              onClick={() => setPick("GERENTE")}
              className={cn(
                "rounded-2xl border-2 border-border bg-card p-6 text-left shadow-sm transition hover:border-primary hover:shadow-md",
                "min-h-[120px] flex flex-col justify-end gap-1"
              )}
            >
              <span className="text-lg font-semibold text-foreground">Gerente</span>
              <span className="text-xs text-muted-foreground">Operação · sem sessão de dono</span>
            </button>
            <button
              type="button"
              onClick={() => setPick("VENDEDOR")}
              className={cn(
                "rounded-2xl border-2 border-border bg-card p-6 text-left shadow-sm transition hover:border-primary hover:shadow-md",
                "min-h-[120px] flex flex-col justify-end gap-1"
              )}
            >
              <span className="text-lg font-semibold text-foreground">Vendedor</span>
              <span className="text-xs text-muted-foreground">PDV e rotina · visão reduzida</span>
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {pick === "ADMIN" ? "Dono" : pick === "GERENTE" ? "Gerente" : "Vendedor"}
              </p>
              <p className="text-xs text-muted-foreground">Informe o PIN cadastrado para este perfil.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-pin">PIN</Label>
              <Input
                id="staff-pin"
                type="password"
                autoComplete="current-password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            {err ? <p className="text-sm text-destructive">{err}</p> : null}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => { setPick(null); setErr(""); setPin("") }}>
                Voltar
              </Button>
              <Button type="submit" className="flex-1" disabled={busy || !pin.trim()}>
                {busy ? "Entrando…" : "Entrar"}
              </Button>
            </div>
          </form>
        )}
      </div>
    )
  }

  return <StaffAccessContext.Provider value={{ role }}>{children}</StaffAccessContext.Provider>
}
