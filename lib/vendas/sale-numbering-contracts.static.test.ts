import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { CANONICAL_VERCEL_PROJECT_ID } from "@/lib/deploy/canonical-deployment"
import { normalizeSaleNumberingCode } from "@/lib/vendas/server-sale-numbering"

import { normalizeStoreSaleNumberingCode } from "./store-sale-numbering-code"

/**
 * Contratos estáticos de identidade/numeração (002C-0 + Writer V2 do GOAL 003).
 *
 * Prova, por leitura dos arquivos-fonte, que:
 * - os módulos puros continuam puros;
 * - `clientSaleId` nunca deriva de `pedidoId`;
 * - o allocator só é chamado no Writer V2 (inversão em ops-upsert-venda);
 * - o gate não está acoplado ao writer V1.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8")
}

const PURE_MODULES = [
  "lib/vendas/sale-identity-contracts.ts",
  "lib/vendas/store-sale-numbering-code.ts",
] as const

const GATE_MODULES = [
  "lib/deploy/canonical-deployment.ts",
  "lib/vendas/sale-numbering-runtime-gate.ts",
] as const

const CLIENT_SURFACES = [
  "lib/operations-store.tsx",
  "components/dashboard/vendas/pdv-classic.tsx",
  "components/dashboard/vendas/pdv-supermercado.tsx",
  "components/dashboard/vendas/pdv-assistencia-enterprise.tsx",
  "components/dashboard/vendas/pdv-venda-completa-enterprise.tsx",
  "components/dashboard/vendas/venda-completa-enterprise.tsx",
  "components/dashboard/vendas/trocas-devolucao.tsx",
] as const

describe("contratos 002C-0 — pureza", () => {
  it("os módulos puros não importam Prisma, server-only nem banco", () => {
    for (const path of PURE_MODULES) {
      const source = read(path)
      expect(source, path).not.toContain('import "server-only"')
      expect(source, path).not.toContain("@/generated/prisma")
      expect(source, path).not.toContain("@/lib/prisma")
      expect(source, path).not.toContain("PrismaClient")
      expect(source, path).not.toMatch(/\bimport\s+[^\n]*\bfrom\s+["']node:/)
      expect(source, path).not.toMatch(/\bprocess\.env\b/)
    }
  })

  it("os módulos puros não têm relógio, aleatoriedade nem geração de identidade", () => {
    for (const path of PURE_MODULES) {
      const source = read(path)
      expect(source, path).not.toMatch(/\bMath\.random\s*\(/)
      expect(source, path).not.toMatch(/\bnew Date\s*\(/)
      expect(source, path).not.toMatch(/\bDate\.now\s*\(/)
      expect(source, path).not.toMatch(/\brandomUUID\b/)
      expect(source, path).not.toMatch(/\bcrypto\b/)
    }
  })

  it("nenhum fallback de pedidoId para clientSaleId", () => {
    const source = read("lib/vendas/sale-identity-contracts.ts")
    expect(source).not.toMatch(/clientSaleId\s*[:=]\s*[^\n]*\bpedidoId\b/)
    expect(source).not.toMatch(/\?\?\s*[^\n]*\bpedidoId\b/)
    expect(source).not.toMatch(/\|\|\s*[^\n]*\bpedidoId\b/)
  })

  it("o normalizador puro do código da loja é equivalente ao do allocator", () => {
    const corpus: unknown[] = [
      "RC01",
      " rc01 ",
      "rc01",
      "AB",
      "12345678",
      "A",
      "A".repeat(9),
      "RC-1",
      "RC_1",
      "RÇ01",
      "RC 01",
      "",
      "   ",
      null,
      undefined,
      42,
      {},
    ]
    for (const value of corpus) {
      expect(normalizeStoreSaleNumberingCode(value), String(value)).toBe(
        normalizeSaleNumberingCode(value),
      )
    }
  })
})

describe("contratos 002C-0 — gate de runtime", () => {
  it("o gate é server-only e não duplica o ID canônico", () => {
    for (const path of GATE_MODULES) {
      const source = read(path)
      expect(source, path).toContain('import "server-only"')
      expect(source, path).not.toContain(CANONICAL_VERCEL_PROJECT_ID)
      expect(source, path).not.toMatch(/["']prj_/)
    }
  })

  it("o ID canônico vem do guard de migrations, sem cópia e sem alteração do guard", () => {
    const shared = read("lib/deploy/canonical-deployment.ts")
    expect(shared).toContain("@/scripts/migration-authority-guard.mjs")
    expect(shared).toContain("CANONICAL_VERCEL_PROJECT_ID")

    const guard = read("scripts/migration-authority-guard.mjs")
    expect(guard).toContain(`export const CANONICAL_VERCEL_PROJECT_ID = '${CANONICAL_VERCEL_PROJECT_ID}';`)
    // O guard não conhece o writer: a dependência é unidirecional (app → guard).
    expect(guard).not.toContain("SALE_SERVER_NUMBERING_ENABLED")
    expect(guard).not.toContain("sale-numbering")
  })

  it("o gate não emite log algum", () => {
    for (const path of GATE_MODULES) {
      const source = read(path)
      expect(source, path).not.toMatch(/\bconsole\s*\./)
      expect(source, path).not.toMatch(/\bprocess\.stdout\b/)
      expect(source, path).not.toMatch(/\bprocess\.stderr\b/)
    }
  })

  it("o gate não lança e não acessa banco", () => {
    const source = read("lib/vendas/sale-numbering-runtime-gate.ts")
    expect(source).not.toMatch(/\bthrow\b/)
    expect(source).not.toContain("@/lib/prisma")
    expect(source).not.toContain("@/generated/prisma")
  })

  it("o gate não é acoplado à flag de autoridade de migrations", () => {
    const source = read("lib/vendas/sale-numbering-runtime-gate.ts")
    // A citação em comentário é permitida; o acoplamento em código, não.
    expect(source).not.toMatch(/process\.env\.MIGRATION_AUTHORITY_ENABLED/)
    expect(source).not.toContain("evaluateMigrationAuthority")
    expect(source).not.toContain("MIGRATION_GUARD_ACTION")
  })
})

describe("contratos 002C-0 / 003 — call sites produtivos", () => {
  it("o writer V1, a rota legado e o store não chamam o allocator", () => {
    for (const path of [
      "app/api/ops/venda-persist/route.ts",
      "app/api/ops/sync-legacy-vendas/route.ts",
      "lib/ops-upsert-venda.ts",
      "lib/operations-store.tsx",
    ]) {
      expect(read(path), path).not.toContain("server-sale-numbering")
      expect(read(path), path).not.toContain("allocateSaleNumber")
    }
  })

  it("o único call site produtivo de allocateSaleNumber é o Writer V2", () => {
    const writer = read("lib/vendas/sale-writer-v2.ts")
    expect(writer).toContain("allocateSaleNumber")
    expect(writer).toContain("from \"@/lib/vendas/server-sale-numbering\"")
    expect(read("app/actions/operacoes.ts")).not.toContain("allocateSaleNumber(")
    expect(read("app/actions/operacoes.ts")).toContain("allocateSaleNumberForWriter")
    expect(read("lib/ops-upsert-venda.ts")).not.toContain("allocateSaleNumber")
  })

  it("o gate tem consumidores explícitos no Writer V2 e na OS, sem acoplar o writer V1", () => {
    const source = read("lib/vendas/sale-numbering-runtime-gate.ts")
    expect(source).toContain("SALE_SERVER_NUMBERING_ENABLED")
    expect(read("lib/ops-upsert-venda.ts")).not.toContain("resolveSaleNumberingWriter")
    expect(read("app/api/ops/venda-persist/route.ts")).not.toContain("resolveSaleNumberingWriter")
    expect(read("app/api/ops/venda-persist/v2/route.ts")).toContain("resolveSaleNumberingWriter")
    expect(read("app/actions/operacoes.ts")).toContain("resolveSaleNumberingWriter")
  })

  it("o store não importa o allocator nem liga a flag de Production", () => {
    const store = read("lib/operations-store.tsx")
    expect(store).not.toContain("allocateSaleNumber")
    expect(store).not.toContain("SALE_SERVER_NUMBERING_ENABLED")
    expect(store).toContain("shouldFallbackV2ToV1")
    expect(store).toContain("buildProvisionalSaleRef")
  })

  it("PDVs e o store cliente não importam o gate server-only nem o allocator", () => {
    for (const path of CLIENT_SURFACES) {
      const source = read(path)
      expect(source, path).not.toContain("sale-numbering-runtime-gate")
      expect(source, path).not.toContain("allocateSaleNumber")
      expect(source, path).not.toContain("SALE_SERVER_NUMBERING_ENABLED")
      expect(source, path).not.toContain("canonical-deployment")
    }
  })

  it("o Histórico não renderiza menu vazio e separa remote vs quarentena", () => {
    const source = read("components/dashboard/vendas/vendas-arquivo-geral.tsx")
    expect(source).toContain("menuAcoes.length > 0")
    expect(source).toContain("Ver conflito")
    expect(source).toContain("Recuperar venda")
    expect(source).toContain("Venda precisa de recuperação")
    expect(source).toContain("O número desta venda já estava em uso")
    expect(source).toContain("openRecoverDialog")
    expect(source).not.toContain("predictedNovaVendaId")
  })
})
