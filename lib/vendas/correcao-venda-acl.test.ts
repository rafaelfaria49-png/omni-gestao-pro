/**
 * GOAL_SEGURANCA_CORRECAO_VENDA_MULTILOJA — testes da camada de autorização das
 * rotas de correção de venda (`/api/vendas/[id]/corrigir*`).
 *
 * Duas camadas:
 *  1. **Comportamental** — exercita `requireCorrecaoVendaAuth` de verdade, mockando
 *     APENAS `@/auth` (sessão) e `@/lib/ops-api-gate` (gate de assinatura). A decisão
 *     real (canAccessStore + permissão de papel) roda sobre o código de produção.
 *  2. **Wiring estático** ("lint test", padrão de multi-loja-route-acl-baseline) —
 *     garante que cada uma das 5 rotas corrigir* realmente chama o guard, mantém o PIN
 *     e escopa por loja. Anti-regressão: ninguém adiciona uma rota corrigir* sem ACL.
 *
 * Escopo de loja do PIN (decisão do GOAL): o PIN vive em `User` (global, sem storeId).
 * O limite de loja é garantido pela SESSÃO do operador — um operador restrito a outra
 * loja é bloqueado por `canAccessStore` ANTES de o PIN importar.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  authMock: vi.fn(),
  subMock: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: h.authMock }))
vi.mock("@/lib/ops-api-gate", () => ({ requireOpsSubscription: h.subMock }))

import { requireCorrecaoVendaAuth } from "@/lib/vendas/guard-correcao-venda"

type SessLike = {
  user: { id: string; role: string; storeAccess: "all" | "restricted"; allowedStoreIds?: string[] }
}

function sess(
  role: string,
  storeAccess: "all" | "restricted",
  allowedStoreIds?: string[],
): SessLike {
  return { user: { id: "op-1", role, storeAccess, ...(allowedStoreIds ? { allowedStoreIds } : {}) } }
}

beforeEach(() => {
  h.authMock.mockReset()
  h.subMock.mockReset()
})

// ---------------------------------------------------------------------------
// 1. Comportamental — requireCorrecaoVendaAuth
// ---------------------------------------------------------------------------

describe("requireCorrecaoVendaAuth — sessão escopa a loja + permissão", () => {
  it("ADMIN com acesso total → libera (não altera comportamento quando tudo correto)", async () => {
    h.authMock.mockResolvedValue(sess("ADMIN", "all"))
    const r = await requireCorrecaoVendaAuth("loja-A")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.session?.user?.id).toBe("op-1")
  })

  it("GERENTE com acesso total → libera (mantém pdv.cancelarVenda)", async () => {
    h.authMock.mockResolvedValue(sess("GERENTE", "all"))
    const r = await requireCorrecaoVendaAuth("loja-A")
    expect(r.ok).toBe(true)
  })

  it("operador restrito À MESMA loja → libera (PIN da mesma loja passa)", async () => {
    h.authMock.mockResolvedValue(sess("ADMIN", "restricted", ["loja-A"]))
    const r = await requireCorrecaoVendaAuth("loja-A")
    expect(r.ok).toBe(true)
  })

  it("operador restrito a OUTRA loja → bloqueia (PIN de outra loja não autoriza)", async () => {
    h.authMock.mockResolvedValue(sess("ADMIN", "restricted", ["loja-A"]))
    const r = await requireCorrecaoVendaAuth("loja-B")
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(403)
      expect(r.error).toMatch(/unidade/i)
    }
  })

  it("operador sem nenhuma loja permitida → bloqueia", async () => {
    h.authMock.mockResolvedValue(sess("ADMIN", "restricted", []))
    const r = await requireCorrecaoVendaAuth("loja-A")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(403)
  })

  it("CAIXA (sem permissão de cancelar/corrigir) → bloqueia mesmo com acesso à loja", async () => {
    h.authMock.mockResolvedValue(sess("CAIXA", "all"))
    const r = await requireCorrecaoVendaAuth("loja-A")
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(403)
      expect(r.error).toMatch(/permiss/i)
    }
  })

  it("VENDEDOR (sem permissão) → bloqueia", async () => {
    h.authMock.mockResolvedValue(sess("VENDEDOR", "all"))
    const r = await requireCorrecaoVendaAuth("loja-A")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(403)
  })
})

describe("requireCorrecaoVendaAuth — fallback de assinatura (PDV legado sem sessão)", () => {
  it("sem sessão + assinatura válida → libera com session null", async () => {
    h.authMock.mockResolvedValue(null)
    h.subMock.mockResolvedValue({ ok: true })
    const r = await requireCorrecaoVendaAuth("loja-A")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.session).toBeNull()
  })

  it("sem sessão + sem assinatura (401) → bloqueia", async () => {
    h.authMock.mockResolvedValue(null)
    h.subMock.mockResolvedValue({ ok: false, res: { status: 401 } })
    const r = await requireCorrecaoVendaAuth("loja-A")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(401)
  })

  it("sem sessão + assinatura inválida (403) → bloqueia", async () => {
    h.authMock.mockResolvedValue(null)
    h.subMock.mockResolvedValue({ ok: false, res: { status: 403 } })
    const r = await requireCorrecaoVendaAuth("loja-A")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// 2. Wiring estático — todas as rotas corrigir* enforçam o guard
// ---------------------------------------------------------------------------

const ROOT = resolve(__dirname, "..", "..")
function read(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), "utf8")
}

const ROTAS_CORRIGIR = [
  "app/api/vendas/[id]/corrigir/route.ts",
  "app/api/vendas/[id]/corrigir-itens/route.ts",
  "app/api/vendas/[id]/corrigir-item-meta/route.ts",
  "app/api/vendas/[id]/corrigir-parcelas/route.ts",
  "app/api/vendas/[id]/corrigir-titulo/route.ts",
]

describe("Wiring — cada rota corrigir* reforça sessão/loja/permissão (anti-regressão)", () => {
  for (const f of ROTAS_CORRIGIR) {
    it(`[${f}] importa e chama requireCorrecaoVendaAuth`, () => {
      const src = read(f)
      expect(src).toContain('from "@/lib/vendas/guard-correcao-venda"')
      expect(src).toContain("requireCorrecaoVendaAuth(storeId)")
    })

    it(`[${f}] escopa por loja (opsLojaIdFromRequest) e mantém o PIN de supervisor`, () => {
      const src = read(f)
      expect(src).toContain("opsLojaIdFromRequest(")
      expect(src).toContain("supervisorPin")
      expect(src).toContain("authenticateSupervisorPin")
      expect(src).not.toMatch(/where:\s*\{\s*pin:/)
    })

    it(`[${f}] registra auditoria com storeId + rota`, () => {
      const src = read(f)
      expect(src).toContain("storeId,")
      expect(src).toMatch(/rota: "vendas\/corrig/)
    })

    it(`[${f}] não chama auth() diretamente (delega ao guard)`, () => {
      const src = read(f)
      expect(src).not.toMatch(/from ["']@\/auth["']/)
    })
  }
})
