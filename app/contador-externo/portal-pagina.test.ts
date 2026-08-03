/**
 * GOAL CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 — guarda das PÁGINAS de dados
 * (critérios 1–5 e 9 do contrato).
 *
 * Prova, sem banco e sem servidor, que a página fecha nos mesmos pontos da rota:
 * flag OFF → 404 ANTES de olhar cookie/sessão; loja fora do vínculo → 404 (nunca
 * 403, para não confirmar que a loja alheia existe); sessão inválida/ausente →
 * redirect; segredo ausente → tela honesta, sem redirect e sem quebrar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const cookiesMock = vi.fn()
const resolverEscopoExternoMock = vi.fn()

vi.mock("next/headers", () => ({ cookies: () => cookiesMock() }))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
  redirect: (destino: string) => {
    throw new Error(`NEXT_REDIRECT:${destino}`)
  },
}))
vi.mock("@/lib/contador/auth-externa/repo-prisma", () => ({ criarRepoAuthExterna: () => ({}) }))
vi.mock("@/lib/contador/auth-externa/escopo-externo", () => ({
  resolverEscopoExterno: (...args: unknown[]) => resolverEscopoExternoMock(...args),
}))

import { ENV_PORTAL_EXTERNO_V2 } from "@/lib/contador/portal/flag"
import { escopoDaPaginaPortal } from "./_portal-pagina"

const COOKIE_VALIDO = { get: () => ({ value: "token-x" }) }

beforeEach(() => {
  process.env[ENV_PORTAL_EXTERNO_V2] = "on"
  cookiesMock.mockResolvedValue(COOKIE_VALIDO)
  resolverEscopoExternoMock.mockReset()
})

afterEach(() => {
  delete process.env[ENV_PORTAL_EXTERNO_V2]
  vi.restoreAllMocks()
})

describe("escopoDaPaginaPortal — guarda da página de dados", () => {
  it("flag OFF → 404 sem sequer ler o cookie (não confirma sessão nem loja)", async () => {
    delete process.env[ENV_PORTAL_EXTERNO_V2]
    await expect(escopoDaPaginaPortal("loja-A")).rejects.toThrow("NEXT_NOT_FOUND")
    expect(cookiesMock).not.toHaveBeenCalled()
    expect(resolverEscopoExternoMock).not.toHaveBeenCalled()
  })

  it("flag com valor diferente de 'on' continua OFF (default seguro)", async () => {
    process.env[ENV_PORTAL_EXTERNO_V2] = "true"
    await expect(escopoDaPaginaPortal("loja-A")).rejects.toThrow("NEXT_NOT_FOUND")
    expect(resolverEscopoExternoMock).not.toHaveBeenCalled()
  })

  it("loja fora do vínculo → 404 (anti-enumeração), nunca 403", async () => {
    resolverEscopoExternoMock.mockResolvedValue({ ok: false, motivo: "acesso_negado" })
    await expect(escopoDaPaginaPortal("loja-B")).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("sem sessão → redirect para o login externo", async () => {
    resolverEscopoExternoMock.mockResolvedValue({ ok: false, motivo: "nao_autenticado" })
    await expect(escopoDaPaginaPortal("loja-A")).rejects.toThrow(
      "NEXT_REDIRECT:/contador-externo/login",
    )
  })

  it("sessão inválida/revogada → redirect para sessão expirada", async () => {
    resolverEscopoExternoMock.mockResolvedValue({ ok: false, motivo: "sessao_invalida" })
    await expect(escopoDaPaginaPortal("loja-A")).rejects.toThrow(
      "NEXT_REDIRECT:/contador-externo/sessao-expirada",
    )
  })

  it("segredo de sessão ausente → null (tela honesta), sem redirect e sem 404", async () => {
    resolverEscopoExternoMock.mockResolvedValue({ ok: false, motivo: "indisponivel" })
    await expect(escopoDaPaginaPortal("loja-A")).resolves.toBeNull()
  })

  it("escopo válido → a loja usada é a do PATH, jamais de query/body", async () => {
    const escopo = { ok: true, storeId: "loja-A", papel: "LEITURA" }
    resolverEscopoExternoMock.mockResolvedValue(escopo)
    await expect(escopoDaPaginaPortal("loja-A")).resolves.toBe(escopo)
    expect(resolverEscopoExternoMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storeId: "loja-A", token: "token-x" }),
    )
  })
})
