/**
 * Anti-regressão: nenhum código ativo autentica supervisor com `where: { pin }`.
 * Writers de créditos/IA não criam ADMIN com PIN previsível.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = resolve(__dirname, "..", "..")
function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8")
}

const AUTH_AND_CORRIGIR = [
  "app/api/auth/admin/route.ts",
  "app/api/admin/supervisor-pin/route.ts",
  "app/api/vendas/[id]/corrigir/route.ts",
  "app/api/vendas/[id]/corrigir-itens/route.ts",
  "app/api/vendas/[id]/corrigir-item-meta/route.ts",
  "app/api/vendas/[id]/corrigir-parcelas/route.ts",
  "app/api/vendas/[id]/corrigir-titulo/route.ts",
  "scripts/seed-supervisor-pin.ts",
]

const WRITERS = [
  "app/api/user/credits/route.ts",
  "app/api/credits/purchase/route.ts",
  "lib/ia-mestre/debit-turn-credits.ts",
]

describe("nenhuma autenticação por where: { pin }", () => {
  for (const f of AUTH_AND_CORRIGIR) {
    it(`[${f}] não usa where: { pin } e as rotas de correção usam o verificador central`, () => {
      const src = read(f)
      expect(src).not.toMatch(/where:\s*\{\s*pin\s*:/)
      expect(src).not.toMatch(/where:\s*\{\s*pin\s*,/)
    })
  }

  it("rotas corrigir* importam authenticateSupervisorPin", () => {
    for (const f of AUTH_AND_CORRIGIR.filter((p) => p.includes("corrigir"))) {
      const src = read(f)
      expect(src).toContain("authenticateSupervisorPin")
      expect(src).toContain("@/lib/auth/verify-supervisor-pin")
    }
  })
})

describe("writers de créditos/IA sem PIN previsível", () => {
  for (const f of WRITERS) {
    it(`[${f}] não cria mock-\${userId} nem role ADMIN no create`, () => {
      const src = read(f)
      expect(src).not.toContain("mock-${userId}")
      expect(src).toContain("creditsLedgerUserCreateData")
    })
  }
})

describe("GET supervisor-pin nunca devolve PIN", () => {
  it("resposta do GET só expõe exists/isDefault/name", () => {
    const src = read("app/api/admin/supervisor-pin/route.ts")
    expect(src).toMatch(/exists:\s*true,\s*\n\s*isDefault:/)
    expect(src).toContain("name: supervisor.name || null")
    expect(src).not.toMatch(/NextResponse\.json\(\{[\s\S]{0,200}pin:\s*supervisor/)
  })
})
