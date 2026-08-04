import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { CANONICAL_VERCEL_PROJECT_ID } from "@/lib/deploy/canonical-deployment"
import { normalizeSaleNumberingCode } from "@/lib/vendas/server-sale-numbering"

import { normalizeStoreSaleNumberingCode } from "./store-sale-numbering-code"

/**
 * Contrato estático do GOAL 002C-0.
 *
 * Prova, por leitura dos arquivos-fonte, que os contratos introduzidos aqui:
 * - são puros (sem Prisma, sem `server-only`, sem I/O) onde precisam ser;
 * - não têm NENHUM call site no writer real, nas rotas, nos PDVs ou no store;
 * - não duplicam o ID canônico de projeto nem o expõem em log;
 * - não derivam `clientSaleId` de `pedidoId`.
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

/** Símbolos exportados pelo 002C-0 que não podem aparecer no caminho produtivo. */
const CONTRACT_MODULE_SPECIFIERS = [
  "sale-identity-contracts",
  "store-sale-numbering-code",
  "sale-numbering-runtime-gate",
  "canonical-deployment",
] as const

/**
 * Superfícies que o GOAL declara intocadas. A lista replica os arquivos proibidos
 * do 002C-0 e os seis chamadores de `finalizeSaleTransaction`.
 */
const PRODUCTIVE_SURFACES = [
  "lib/ops-upsert-venda.ts",
  "app/api/ops/venda-persist/route.ts",
  "app/api/ops/sync-legacy-vendas/route.ts",
  "lib/operations-store.tsx",
  "lib/operations-sales-merge.ts",
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

describe("contratos 002C-0 — zero call site produtivo", () => {
  it("nenhum writer, rota, store ou PDV consome os contratos novos", () => {
    for (const path of PRODUCTIVE_SURFACES) {
      const source = read(path)
      for (const specifier of CONTRACT_MODULE_SPECIFIERS) {
        expect(source, `${path} :: ${specifier}`).not.toContain(specifier)
      }
      expect(source, path).not.toContain("SALE_SERVER_NUMBERING_ENABLED")
    }
  })

  it("o allocator do 002B permanece sem call site produtivo", () => {
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

  it("o gate ainda não tem consumidor em lugar algum do repositório", () => {
    // Só o próprio módulo, seus testes e o ADR podem citar a flag.
    const source = read("lib/vendas/sale-numbering-runtime-gate.ts")
    expect(source).toContain("SALE_SERVER_NUMBERING_ENABLED")
    expect(read("lib/ops-upsert-venda.ts")).not.toContain("resolveSaleNumberingWriter")
    expect(read("app/api/ops/venda-persist/route.ts")).not.toContain("resolveSaleNumberingWriter")
  })
})
