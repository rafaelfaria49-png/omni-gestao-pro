import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const { requireStoreAccess } = vi.hoisted(() => ({ requireStoreAccess: vi.fn() }))

vi.mock("@/lib/auth/guard-enterprise", () => ({ requireStoreAccess }))

import { requireCadastrosStoreAccess } from "@/lib/cadastros/cadastros-action-access"

describe("autorização multi-loja das actions de Cadastros", () => {
  beforeEach(() => {
    requireStoreAccess.mockReset()
  })

  it("valida a unidade informada contra a sessão antes de continuar", async () => {
    requireStoreAccess.mockResolvedValue({ ok: true, session: {}, permissions: {} })
    await expect(requireCadastrosStoreAccess(" loja-2 ")).resolves.toBe("loja-2")
    expect(requireStoreAccess).toHaveBeenCalledWith("loja-2")
  })

  it("bloqueia acesso a outra unidade", async () => {
    requireStoreAccess.mockResolvedValue({ ok: false, error: "Sem permissão para esta unidade", status: 403 })
    await expect(requireCadastrosStoreAccess("loja-2")).rejects.toThrow("Sem permissão")
  })

  it("não aceita storeId vazio como autorização", async () => {
    await expect(requireCadastrosStoreAccess("   ")).rejects.toThrow("Loja não selecionada")
    expect(requireStoreAccess).not.toHaveBeenCalled()
  })

  it("protege list/upsert de categorias e serviços antes do acesso ao Prisma", () => {
    const source = readFileSync(resolve(process.cwd(), "app/actions/cadastros.ts"), "utf8")
    for (const action of ["listCategorias", "upsertCategoria", "listServicos", "upsertServico"]) {
      const start = source.indexOf(`export async function ${action}`)
      expect(start, action).toBeGreaterThanOrEqual(0)
      const bodyStart = source.indexOf("{", start)
      const prismaCall = source.indexOf("prisma.", bodyStart)
      const guardCall = source.indexOf("requireCadastrosStoreAccess(storeId)", bodyStart)
      expect(guardCall, `${action} deve autorizar storeId`).toBeGreaterThan(bodyStart)
      expect(guardCall, `${action} deve autorizar antes do Prisma`).toBeLessThan(prismaCall)
    }
  })
})
