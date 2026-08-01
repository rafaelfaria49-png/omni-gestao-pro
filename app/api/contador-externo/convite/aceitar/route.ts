/**
 * POST /api/contador-externo/convite/aceitar — aceite transacional do convite
 * (GOAL 014, §13; ajuste G3: token SOMENTE no body, nunca em path/query).
 *
 * O corpo traz SOMENTE `token`, `nome` e `senha`: e-mail, loja e papel saem DA
 * LINHA do convite no servidor (§9) — chaves de escopo no corpo/query → 400.
 * Rate limit por e-mail(da linha do convite)+IP (R-3). No sucesso, cria a sessão
 * externa e seta o cookie; quando a conta já existia (senha do aceite ≠ senha
 * atual), o aceite vale mas o login fica para a tela de login.
 * Sem `CONTADOR_EXTERNO_SESSION_SECRET` → 503 fail-closed ANTES de aceitar (R-9).
 * Toda resposta sai com `Referrer-Policy: no-referrer` (R-1).
 */
import { aceitarConvite, ConviteAceiteFalhaError, hashTokenConvite } from "@/lib/contador/auth-externa/convites"
import { logEventoExterno } from "@/lib/contador/auth-externa/eventos"
import {
  lerCorpoJsonExterno,
  respostaChaveProibidaExterna,
  respostaErroAuthExterna,
  respostaRateLimitExterno,
} from "@/lib/contador/auth-externa/http"
import {
  checkRateLimitExterno,
  montarChaveRateLimitExterno,
  registerFalhaExterna,
  registerSucessoExterno,
} from "@/lib/contador/auth-externa/rate-limit"
import { autenticarECriarSessao, validarSessaoExterna } from "@/lib/contador/auth-externa/sessao"
import { ValidacaoExternaError } from "@/lib/contador/auth-externa/tipos"
import {
  aplicarCookieExterno,
  ipDoRequest,
  ipHashDoRequest,
  jsonExterno,
  jsonOkExterno,
  resolverRepoAuthExterna,
  temChaveProibida,
  userAgentDoRequest,
} from "../../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

/** O token nunca aparece em URL — a resposta também não contribui para vazá-lo. */
const SEM_REFERRER = { "Referrer-Policy": "no-referrer" } as const

export async function POST(req: Request) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) {
    return jsonExterno(respostaChaveProibidaExterna(), SEM_REFERRER)
  }

  const body = await lerCorpoJsonExterno(req)
  if (temChaveProibida(body)) {
    return jsonExterno(respostaChaveProibidaExterna(), SEM_REFERRER)
  }

  const repo = resolverRepoAuthExterna()
  const ip = ipDoRequest(req)
  const ipHash = await ipHashDoRequest(req)

  // Fail-closed ANTES de gravar qualquer coisa: sem o segredo de sessão, o
  // portal está inerte (R-9). A sonda usa a própria cadeia de validação — sem
  // segredo ela responde "indisponivel" antes de tocar no banco.
  const sonda = await validarSessaoExterna(repo, undefined)
  if (!sonda.ok && sonda.motivo === "indisponivel") {
    return jsonExterno(
      {
        status: 503,
        body: { ok: false, mensagem: "Portal do contador indisponível no momento. Tente novamente em instantes." },
      },
      SEM_REFERRER,
    )
  }

  // Rate limit por e-mail+IP (R-3): o e-mail NÃO vem do corpo — é resolvido do
  // convite no servidor (token desconhecido compartilha a chave "desconhecido").
  const tokenBruto = typeof body.token === "string" ? body.token.trim() : ""
  let emailChave = "desconhecido"
  if (tokenBruto) {
    const convite = await repo.buscarConvitePorTokenHash(await hashTokenConvite(tokenBruto))
    if (convite) emailChave = convite.email
  }
  const chave = montarChaveRateLimitExterno(emailChave, ip)
  const limite = checkRateLimitExterno(chave)
  if (limite.limited) {
    logEventoExterno("rate_limit_externo", { ipHash })
    return jsonExterno(respostaRateLimitExterno(limite.retryAfterSeconds), {
      "Retry-After": String(limite.retryAfterSeconds),
      ...SEM_REFERRER,
    })
  }

  const nome = typeof body.nome === "string" ? body.nome : ""
  const senha = typeof body.senha === "string" ? body.senha : ""

  try {
    const aceite = await aceitarConvite(repo, {
      token: tokenBruto,
      nome,
      senha,
      ipHash,
      userAgentResumo: userAgentDoRequest(req),
    })
    registerSucessoExterno(chave)

    // Abre a sessão no ato (conta recém-criada: a senha é a do aceite). Conta
    // reutilizada com senha diferente → aceite vale, login fica para a tela.
    const login = await autenticarECriarSessao(repo, {
      email: aceite.usuario.email,
      senha,
      ip,
      userAgent: req.headers.get("user-agent"),
    })

    const res = jsonOkExterno(
      {
        ok: true,
        usuario: { id: aceite.usuario.id, nome: aceite.usuario.nome },
        acesso: { papel: aceite.acesso.papel },
        sessaoCriada: login.ok,
      },
      201,
      SEM_REFERRER,
    )
    if (login.ok) aplicarCookieExterno(res, login.cookie)
    return res
  } catch (e) {
    // Toda tentativa malsucedida (token inválido/usado/expirado ou dado ruim)
    // conta para o rate limit — adivinhação de token é o vetor de abuso (R-1/R-3).
    if (e instanceof ValidacaoExternaError || e instanceof ConviteAceiteFalhaError) {
      registerFalhaExterna(chave)
    }
    return jsonExterno(respostaErroAuthExterna(e), SEM_REFERRER)
  }
}
