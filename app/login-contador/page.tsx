"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

function LoginContadorForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get("next") || "/contador"
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const r = await fetch("/api/auth/contador", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      })
      if (!r.ok) {
        const j = (await r.json()) as { error?: string }
        setError(j.error === "invalid_pin" ? "Senha incorreta." : "Não foi possível autenticar.")
        return
      }
      router.push(nextPath.startsWith("/") ? nextPath : "/contador")
      router.refresh()
    } catch {
      setError("Falha de rede. Tente novamente.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border">
        <CardHeader>
          <CardTitle>Área do Contador</CardTitle>
          <CardDescription>
            Acesso restrito. Use a senha definida em{" "}
            <code className="text-xs">ASSISTEC_CONTADOR_PIN</code> (diferente do PIN de administrador).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="contador-pin">Senha</Label>
              <Input
                id="contador-pin"
                type="password"
                autoComplete="current-password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={loading || !pin.trim()}>
              {loading ? "Entrando…" : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default function LoginContadorPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-muted-foreground">Carregando…</div>
      }
    >
      <LoginContadorForm />
    </Suspense>
  )
}
