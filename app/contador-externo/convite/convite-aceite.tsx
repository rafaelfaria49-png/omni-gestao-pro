"use client"

/**
 * Portal externo — aceite de convite, client component (GOAL 014, ajuste G3).
 *
 * Fluxo do token (NUNCA em path/query/log/estado global/URL nova):
 *   1. lê `window.location.hash` (`#token=...`) UMA vez na montagem;
 *   2. limpa o fragmento IMEDIATAMENTE com `history.replaceState` — o token some
 *      da barra de endereço e do histórico de navegação;
 *   3. consulta o estado via `POST /api/contador-externo/convite/consultar`
 *      (token no BODY) e aceita via `POST /api/contador-externo/convite/aceitar`.
 *
 * Estados honestos sem enumeração: desconhecido/inválido → tela genérica;
 * expirado/revogado/utilizado → telas específicas; e-mail sempre mascarado.
 * A política de referrer (`Referrer-Policy: no-referrer`) é aplicada pelo proxy
 * no segmento e pelas respostas das APIs de convite.
 */
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type EstadoConvite =
  | { fase: "lendo" }
  | { fase: "sem_token" }
  | { fase: "valido"; emailMascarado: string }
  | { fase: "expirado" }
  | { fase: "revogado" }
  | { fase: "utilizado" }
  | { fase: "invalido" }
  | { fase: "indisponivel" }

/** Extrai o token do fragmento e o remove da URL no mesmo instante. */
function capturarELimparTokenDoFragmento(): string {
  if (typeof window === "undefined") return ""
  const hash = window.location.hash ?? ""
  const match = /^#token=([A-Za-z0-9_-]+)$/.exec(hash)
  const token = match?.[1] ?? ""
  // Limpa SEMPRE o fragmento (mesmo malformado): nada de segredo na barra de
  // endereço, no histórico ou num futuro Referer.
  if (hash) window.history.replaceState(null, "", window.location.pathname)
  return token
}

function TelaSimples({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md border-border">
        <CardHeader>
          <CardTitle>{titulo}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">{children}</CardContent>
      </Card>
    </div>
  )
}

export function ConviteAceite() {
  const router = useRouter()
  const [estado, setEstado] = useState<EstadoConvite>({ fase: "lendo" })
  const [nome, setNome] = useState("")
  const [senha, setSenha] = useState("")
  const [confirmacao, setConfirmacao] = useState("")
  const [erro, setErro] = useState("")
  const [enviando, setEnviando] = useState(false)
  // O token vive SOMENTE nesta ref de módulo de componente — nunca em log,
  // nunca de volta na URL, nunca em mensagem de erro.
  const [tokenRef] = useState<{ atual: string }>(() => ({ atual: "" }))

  useEffect(() => {
    const capturado = capturarELimparTokenDoFragmento()
    tokenRef.atual = capturado
    if (!capturado) {
      setEstado({ fase: "sem_token" })
      return
    }
    let vivo = true
    void (async () => {
      try {
        const r = await fetch("/api/contador-externo/convite/consultar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: capturado }),
        })
        if (!vivo) return
        if (r.status === 503) {
          setEstado({ fase: "indisponivel" })
          return
        }
        if (!r.ok) {
          setEstado({ fase: "invalido" })
          return
        }
        const body = (await r.json()) as { estado?: string; emailMascarado?: string }
        switch (body.estado) {
          case "valido":
            setEstado({ fase: "valido", emailMascarado: body.emailMascarado ?? "" })
            return
          case "expirado":
            setEstado({ fase: "expirado" })
            return
          case "revogado":
            setEstado({ fase: "revogado" })
            return
          case "utilizado":
            setEstado({ fase: "utilizado" })
            return
          default:
            setEstado({ fase: "invalido" })
        }
      } catch {
        if (vivo) setEstado({ fase: "indisponivel" })
      }
    })()
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro("")
    if (senha !== confirmacao) {
      setErro("As senhas não conferem.")
      return
    }
    setEnviando(true)
    try {
      const r = await fetch("/api/contador-externo/convite/aceitar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenRef.atual, nome, senha }),
      })
      if (r.ok) {
        const body = (await r.json()) as { sessaoCriada?: boolean }
        router.push(body.sessaoCriada ? "/contador-externo" : "/contador-externo/login")
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
      if (r.status === 422) {
        const body = (await r.json().catch(() => null)) as { mensagem?: string } | null
        setErro(body?.mensagem ?? "Verifique os dados informados.")
        return
      }
      // 400 genérico: expirado/revogado/utilizado/inválido — mesma mensagem (R-2).
      setErro("Não foi possível concluir o cadastro por este link. Solicite um novo convite.")
    } catch {
      setErro("Falha de rede. Verifique sua conexão e tente novamente.")
    } finally {
      setEnviando(false)
    }
  }

  if (estado.fase === "lendo") {
    return (
      <TelaSimples titulo="Convite do contador">
        <p>Verificando o link de convite…</p>
      </TelaSimples>
    )
  }

  if (estado.fase === "sem_token" || estado.fase === "invalido") {
    return (
      <TelaSimples titulo="Link de convite inválido">
        <p>
          Este link de convite não é válido. Solicite à empresa um novo convite e abra o link
          exatamente como recebido.
        </p>
      </TelaSimples>
    )
  }

  if (estado.fase === "expirado") {
    return (
      <TelaSimples titulo="Convite expirado">
        <p>Este convite expirou. Solicite à empresa um novo convite para concluir seu cadastro.</p>
      </TelaSimples>
    )
  }

  if (estado.fase === "revogado") {
    return (
      <TelaSimples titulo="Convite não disponível">
        <p>Este convite não está mais disponível. Se precisar de acesso, solicite um novo convite à empresa.</p>
      </TelaSimples>
    )
  }

  if (estado.fase === "utilizado") {
    return (
      <TelaSimples titulo="Convite já utilizado">
        <p>
          Este convite já foi utilizado. Se você já concluiu o cadastro, entre pela{" "}
          <a className="text-primary underline" href="/contador-externo/login">
            tela de login
          </a>
          .
        </p>
      </TelaSimples>
    )
  }

  if (estado.fase === "indisponivel") {
    return (
      <TelaSimples titulo="Portal indisponível">
        <p>O portal está temporariamente indisponível. Tente novamente em instantes.</p>
      </TelaSimples>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md border-border">
        <CardHeader>
          <CardTitle>Concluir cadastro</CardTitle>
          <CardDescription>
            Você foi convidado como contador(a) de uma empresa parceira. Defina seu nome e uma
            senha para ativar o acesso.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="contador-convite-email">E-mail do convite</Label>
              <Input id="contador-convite-email" value={estado.emailMascarado} readOnly disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contador-convite-nome">Nome completo</Label>
              <Input
                id="contador-convite-nome"
                autoComplete="name"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Seu nome"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contador-convite-senha">Senha</Label>
              <Input
                id="contador-convite-senha"
                type="password"
                autoComplete="new-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="Mínimo de 8 caracteres"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contador-convite-senha2">Confirmar senha</Label>
              <Input
                id="contador-convite-senha2"
                type="password"
                autoComplete="new-password"
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                placeholder="Repita a senha"
                required
              />
            </div>
            {erro ? <p className="text-sm text-destructive">{erro}</p> : null}
            <Button type="submit" className="w-full" disabled={enviando}>
              {enviando ? "Concluindo…" : "Concluir cadastro"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
