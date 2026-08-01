/**
 * GOAL CONTADOR-HUB-IDENTIDADE-CONVITE-014 — helpers HTTP: mapeamento seguro de
 * falhas, chaves proibidas (§9) e mensagens anti-enumeração (R-2).
 */
import { describe, expect, it } from "vitest"
import { AcessoEstadoInvalidoError, AcessoNaoEncontradoError } from "./acessos"
import { ConviteAceiteFalhaError, ConviteNaoEncontradoError } from "./convites"
import {
  CHAVES_PROIBIDAS_EXTERNO,
  lerCorpoJsonExterno,
  respostaChaveProibidaExterna,
  respostaErroAuthExterna,
  respostaFalhaEscopoExterno,
  respostaLoginInvalido,
  respostaRateLimitExterno,
  temChaveProibidaExterna,
} from "./http"
import { SessaoExternaIndisponivelError } from "./sessao"
import { ValidacaoExternaError } from "./tipos"
import { UsuarioNaoEncontradoError } from "./usuarios"

describe("respostaFalhaEscopoExterno", () => {
  it("mapeia motivos para status seguros", () => {
    expect(respostaFalhaEscopoExterno({ ok: false, motivo: "nao_autenticado" }).status).toBe(401)
    expect(respostaFalhaEscopoExterno({ ok: false, motivo: "sessao_invalida" }).status).toBe(401)
    expect(respostaFalhaEscopoExterno({ ok: false, motivo: "acesso_negado" }).status).toBe(403)
    expect(respostaFalhaEscopoExterno({ ok: false, motivo: "indisponivel" }).status).toBe(503)
  })
})

describe("anti-enumeração (R-2)", () => {
  it("falha de login: 401 com mensagem única e genérica", () => {
    const r = respostaLoginInvalido()
    expect(r.status).toBe(401)
    expect(r.body.mensagem).toBe("E-mail ou senha incorretos.")
  })

  it("falha de aceite: 400 com texto único — a resposta é IDÊNTICA para qualquer motivo", () => {
    const respostas = (["inexistente", "utilizado", "revogado", "expirado", "indisponivel"] as const).map(
      (motivo) => respostaErroAuthExterna(new ConviteAceiteFalhaError(motivo)),
    )
    for (const r of respostas) {
      expect(r.status).toBe(400)
      // O motivo técnico não vaza como campo próprio.
      expect(r.body).not.toHaveProperty("motivo")
      expect(JSON.stringify(r.body)).toBe(JSON.stringify(respostas[0]!.body))
    }
  })
})

describe("respostaErroAuthExterna", () => {
  it("segredo ausente → 503 (R-9, fail-closed)", () => {
    expect(respostaErroAuthExterna(new SessaoExternaIndisponivelError()).status).toBe(503)
  })

  it("validação → 422 com campo; não encontrados → 404; transição → 409; desconhecido → 500 genérico", () => {
    const v = respostaErroAuthExterna(new ValidacaoExternaError("senha", "A senha deve ter pelo menos 8 caracteres."))
    expect(v.status).toBe(422)
    expect(v.body.campo).toBe("senha")

    expect(respostaErroAuthExterna(new ConviteNaoEncontradoError()).status).toBe(404)
    expect(respostaErroAuthExterna(new AcessoNaoEncontradoError()).status).toBe(404)
    expect(respostaErroAuthExterna(new UsuarioNaoEncontradoError()).status).toBe(404)
    expect(respostaErroAuthExterna(new AcessoEstadoInvalidoError("suspender", "REVOGADO")).status).toBe(409)

    const g = respostaErroAuthExterna(new Error("falha interna com detalhes sensíveis"))
    expect(g.status).toBe(500)
    expect(JSON.stringify(g.body)).not.toContain("sensíveis")
  })

  it("rate limit → 429 com retryAfterSeconds", () => {
    const r = respostaRateLimitExterno(900)
    expect(r.status).toBe(429)
    expect(r.body.retryAfterSeconds).toBe(900)
  })
})

describe("chaves proibidas (§9 — a loja NUNCA vem do cliente)", () => {
  it("a lista cobre loja, papel e usuário", () => {
    expect(CHAVES_PROIBIDAS_EXTERNO).toEqual(
      expect.arrayContaining(["storeId", "lojaId", "papel", "role", "userId", "atorId", "autorId", "usuarioId"]),
    )
  })

  it("detecta chave proibida em body e em query", () => {
    expect(temChaveProibidaExterna({ email: "a@b.com", storeId: "loja-x" })).toBe(true)
    expect(temChaveProibidaExterna({ email: "a@b.com", papel: "conferencia" })).toBe(true)
    expect(temChaveProibidaExterna({ email: "a@b.com", nome: "Ana" })).toBe(false)
    expect(temChaveProibidaExterna(new URLSearchParams("usuarioId=usr-1"))).toBe(true)
    expect(temChaveProibidaExterna(new URLSearchParams("pagina=2"))).toBe(false)
  })

  it("resposta de recusa é 400 genérico", () => {
    expect(respostaChaveProibidaExterna().status).toBe(400)
  })
})

describe("lerCorpoJsonExterno", () => {
  it("body inválido vira objeto vazio (a validação é do serviço)", async () => {
    const req = new Request("http://localhost/api", { method: "POST", body: "nao-e-json" })
    expect(await lerCorpoJsonExterno(req)).toEqual({})
  })

  it("body válido é devolvido", async () => {
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.com" }),
    })
    expect(await lerCorpoJsonExterno(req)).toEqual({ email: "a@b.com" })
  })
})
