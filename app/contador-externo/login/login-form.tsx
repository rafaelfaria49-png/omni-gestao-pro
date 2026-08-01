"use client"

/**
 * Portal externo — formulário de login (GOAL 014).
 *
 * Erros SEMPRE genéricos (anti-enumeração, R-2): a mesma mensagem para e-mail
 * inexistente, senha errada e conta suspensa. 429 mostra o tempo de espera do
 * `Retry-After`; 503 significa portal inerte (R-9).
 */
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function LoginForm({ indisponivel = false }: { indisponivel?: boolean }) {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [senha, setSenha] = useState("")
  const [erro, setErro] = useState("")
  const [enviando, setEnviando] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro("")
    setEnviando(true)
    try {
      const r = await fetch("/api/contador-externo/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha }),
      })
      if (r.ok) {
        router.push("/contador-externo")
        router.refresh()
        return
      }
      if (r.status === 429) {
        const espera = Number(r.headers.get("Retry-After") ?? 0)
        setErro(
          espera > 0
            ? `Muitas tentativas. Tente novamente em ${Math.max(1, Math.ceil(espera / 60))} min.`
            : "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
        )
        return
      }
      if (r.status === 503) {
        setErro("Portal indisponível no momento. Tente novamente em instantes.")
        return
      }
      // 401/400/500: mensagem única — nunca revela se o e-mail existe (R-2).
      setErro("E-mail ou senha incorretos.")
    } catch {
      setErro("Falha de rede. Verifique sua conexão e tente novamente.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md border-border">
        <CardHeader>
          <CardTitle>Portal do Contador</CardTitle>
          <CardDescription>
            Acesso restrito a contadores com convite de uma empresa parceira. Se você recebeu
            um convite, conclua o cadastro pelo link recebido antes de entrar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {indisponivel ? (
            <p className="mb-4 text-sm text-muted-foreground">
              O portal está temporariamente indisponível. Tente novamente em instantes.
            </p>
          ) : null}
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="contador-ext-email">E-mail</Label>
              <Input
                id="contador-ext-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@escritorio.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contador-ext-senha">Senha</Label>
              <Input
                id="contador-ext-senha"
                type="password"
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            {erro ? <p className="text-sm text-destructive">{erro}</p> : null}
            <Button type="submit" className="w-full" disabled={enviando || indisponivel}>
              {enviando ? "Entrando…" : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
