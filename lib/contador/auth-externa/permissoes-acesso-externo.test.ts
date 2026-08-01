/**
 * TESTE 26 (obrigatório, ajuste G3 do GOAL 014) — `podeGerenciarAcessoExterno`
 * exige a permissão ESPECÍFICA `contador.manageExternalAccess`, NUNCA
 * `financeiro.edit` (fallback silencioso proibido pelo comando humano).
 *
 * Cobertura: admin (masterConsole) pode · gerente pode via
 * `contador.manageExternalAccess` · caixa/vendedor/tecnico não podem · a nova
 * chave existe na matriz enterprise · o predicado NÃO depende de
 * `financeiro.edit` (assert estático do predicado + matriz por papel).
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Session } from "next-auth"
import { getEnterprisePermissions } from "@/lib/auth/enterprise-permissions"
import { resolverCapacidadesContador } from "@/lib/contador/status/permissoes"

const DIR = dirname(fileURLToPath(import.meta.url))

function sessao(over: Record<string, unknown>): Session {
  return { user: { id: "user-1", ...over }, expires: "2999-01-01" } as unknown as Session
}

describe("TESTE 26 · contador.manageExternalAccess na matriz enterprise", () => {
  it("admin (FULL) e gerente têm a permissão específica; caixa/tecnico/vendedor NÃO", () => {
    expect(getEnterprisePermissions("ADMIN").contador.manageExternalAccess).toBe(true)
    expect(getEnterprisePermissions("GERENTE").contador.manageExternalAccess).toBe(true)
    expect(getEnterprisePermissions("CAIXA").contador.manageExternalAccess).toBe(false)
    expect(getEnterprisePermissions("TECNICO").contador.manageExternalAccess).toBe(false)
    expect(getEnterprisePermissions("VENDEDOR").contador.manageExternalAccess).toBe(false)
    expect(getEnterprisePermissions("OPERADOR").contador.manageExternalAccess).toBe(false)
    expect(getEnterprisePermissions(null).contador.manageExternalAccess).toBe(false)
  })

  it("a seção `contador` existe em TODOS os papéis (merge não herda FULL por acidente)", () => {
    for (const role of ["ADMIN", "GERENTE", "CAIXA", "TECNICO", "VENDEDOR"]) {
      expect(getEnterprisePermissions(role).contador).toBeDefined()
      expect(typeof getEnterprisePermissions(role).contador.manageExternalAccess).toBe("boolean")
    }
  })
})

describe("TESTE 26 · podeGerenciarAcessoExterno — predicado sem financeiro.edit", () => {
  it("admin pode (masterConsole); gerente pode via contador.manageExternalAccess", () => {
    expect(resolverCapacidadesContador(sessao({ role: "ADMIN" })).podeGerenciarAcessoExterno).toBe(true)
    expect(resolverCapacidadesContador(sessao({ role: "GERENTE" })).podeGerenciarAcessoExterno).toBe(true)
  })

  it.each(["CAIXA", "TECNICO", "VENDEDOR", "OPERADOR"])("%s não pode", (role) => {
    expect(resolverCapacidadesContador(sessao({ role })).podeGerenciarAcessoExterno).toBe(false)
  })

  it("sessão ausente → fail-closed", () => {
    expect(resolverCapacidadesContador(null).podeGerenciarAcessoExterno).toBe(false)
  })

  it("campo OBRIGATÓRIO e ENUMERÁVEL (serialização/toEqual o enxergam)", () => {
    const caps = resolverCapacidadesContador(sessao({ role: "GERENTE" }))
    expect(Object.keys(caps).sort()).toEqual(["acessaHub", "podeConferir", "podeGerenciarAcessoExterno"])
    expect(JSON.parse(JSON.stringify(caps))).toEqual({
      acessaHub: true,
      podeConferir: true,
      podeGerenciarAcessoExterno: true,
    })
  })

  it("o predicado NÃO referencia financeiro.edit em NENHUM caminho (assert estático)", () => {
    // Na matriz Fase 1 nenhum papel diverge (financeiro.edit e manageExternalAccess
    // caminham juntos em admin/gerente) — então a prova de que só a nova chave manda
    // é estática: a EXPRESSÃO que computa `podeGerenciarAcessoExterno` não pode nem
    // citar `financeiro` (a linha vizinha do `podeConferir`, do GOAL 011, usa
    // `financeiro.edit` legitimamente — o assert isola a expressão do acesso externo).
    // Convenção de lint-test do projeto (proxy-cookie-mismatch).
    const src = readFileSync(join(DIR, "../status/permissoes.ts"), "utf8")
    const inicio = src.indexOf("const gerenciaExterno")
    expect(inicio).toBeGreaterThan(-1)
    const expressao = src.slice(inicio, src.indexOf(";", inicio))
    expect(expressao).toContain("p.contador.manageExternalAccess === true")
    expect(expressao).toContain("p.admin.masterConsole === true")
    expect(expressao).not.toMatch(/financeiro/)
  })

  it("podeConferir (outra capacidade) continua usando financeiro.edit — escopo separado", () => {
    // Garantia de que o ajuste não apagou o critério original do GOAL 011.
    expect(resolverCapacidadesContador(sessao({ role: "GERENTE" })).podeConferir).toBe(true)
    expect(resolverCapacidadesContador(sessao({ role: "CAIXA" })).podeConferir).toBe(false)
  })
})
