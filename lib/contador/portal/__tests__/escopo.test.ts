/**
 * GOAL CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 — adaptadores de escopo do portal.
 *
 * Prova de INTEGRAÇÃO com o GOAL 014: o `ContadorScopeExterno` REAL, produzido
 * por `resolverEscopoExterno` (sessão HMAC + vínculo ATIVO conferido), é aceito
 * pela factory nominal `fabricarEscopoPortalExterno` — e o escopo resultante é
 * estruturalmente um `ContadorScopeInterno` (os readers read-only o aceitam sem
 * mudança de assinatura, auditoria 013 §7.1).
 */
import { describe, expect, it } from "vitest"
import { resolverEscopoExterno } from "@/lib/contador/auth-externa/escopo-externo"
import { criarDbFalsoAuthExterna, linhaAcesso, linhaUsuario } from "@/lib/contador/auth-externa/fakes"
import { criarRepoAuthExterna } from "@/lib/contador/auth-externa/repo-prisma"
import { ENV_SEGREDO_SESSAO_EXTERNA, autenticarECriarSessao } from "@/lib/contador/auth-externa/sessao"
import { hashSenhaExterna } from "@/lib/contador/auth-externa/usuarios"
import type { ContadorScopeInterno } from "@/lib/contador/scope-core"
import {
  CAPACIDADES_PORTAL_READONLY,
  escopoEstruturalPortal,
  escopoNominalPortal,
  exigirPapelConferencia,
} from "../escopo"
import { PortalPapelInsuficienteError } from "../erros"
import { escopoExternoFake } from "./helpers"

const T0 = new Date("2026-08-01T12:00:00.000Z")
const ENV = { [ENV_SEGREDO_SESSAO_EXTERNA]: "segredo-teste-015-portal" }
const SENHA = "senha-super-secreta-1"

async function montarEscopoReal(papel: "LEITURA" | "CONFERENCIA" = "CONFERENCIA") {
  const db = criarDbFalsoAuthExterna({
    usuarios: [
      linhaUsuario({ id: "usr-1", email: "contador@escritorio.com", senhaHash: await hashSenhaExterna(SENHA) }),
    ],
    acessos: [linhaAcesso({ id: "acs-1", usuarioId: "usr-1", storeId: "loja-1", papel })],
  })
  const repo = criarRepoAuthExterna(db)
  const login = await autenticarECriarSessao(repo, {
    email: "contador@escritorio.com",
    senha: SENHA,
    env: ENV,
    agora: T0,
  })
  if (!login.ok) throw new Error("login deveria ter sucesso")
  const escopo = await resolverEscopoExterno(repo, { token: login.cookie.value, storeId: "loja-1", env: ENV, agora: T0 })
  if (!escopo.ok) throw new Error("escopo deveria resolver")
  return escopo
}

describe("escopoNominalPortal (factory nominal — integração GOAL 014)", () => {
  it("aceita o ContadorScopeExterno REAL do gate e produz escopo compatível com os readers", async () => {
    const escopo = await montarEscopoReal()
    const nominal = escopoNominalPortal(escopo)

    // Prova de tipo + runtime: os readers read-only consomem `ContadorScopeInterno`.
    const leituraReader = (scope: ContadorScopeInterno): string => scope.storeId
    expect(leituraReader(nominal)).toBe("loja-1")
    expect(nominal.ok).toBe(true)
    expect(nominal.userId).toBe("usr-1")
    expect(nominal.papel).toBe("CONFERENCIA")
  })

  it("a loja vem SEMPRE do escopo validado — a factory não tem parâmetro de loja", async () => {
    const escopo = await montarEscopoReal()
    expect(escopoNominalPortal(escopo).storeId).toBe(escopo.storeId)
    expect(Object.isFrozen(escopoNominalPortal(escopo))).toBe(true)
  })
})

describe("escopoEstruturalPortal", () => {
  it("mapeia storeId do vínculo e userId do usuário EXTERNO", () => {
    const estrutural = escopoEstruturalPortal(escopoExternoFake({ storeId: "loja-9", usuarioId: "usr-ext-9" }))
    expect(estrutural).toEqual({ storeId: "loja-9", userId: "usr-ext-9" })
  })
})

describe("CAPACIDADES_PORTAL_READONLY", () => {
  it("é tudo falso — nunca derivada de NextAuth", () => {
    expect(CAPACIDADES_PORTAL_READONLY).toEqual({
      acessaHub: false,
      podeConferir: false,
      podeGerenciarAcessoExterno: false,
    })
  })
})

describe("exigirPapelConferencia", () => {
  it("LEITURA → 403 de domínio; CONFERENCIA passa", () => {
    expect(() => exigirPapelConferencia(escopoExternoFake({ papel: "LEITURA" }))).toThrow(
      PortalPapelInsuficienteError,
    )
    expect(() => exigirPapelConferencia(escopoExternoFake({ papel: "CONFERENCIA" }))).not.toThrow()
  })
})
