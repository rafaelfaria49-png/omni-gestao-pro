import { describe, expect, it } from "vitest"
import type { PdvCatalogProduct } from "@/lib/pdv-catalog"
import {
  atalhoEntryFromCatalogItem,
  buildServicoCartLine,
  fromPdvAtalhoEntry,
  normalizeServicoRow,
  resolveActiveShortcutItems,
  resolveSavedShortcut,
  shortcutKindFromSaved,
  toPdvAtalhoEntry,
  type PdvAtalhoSaved,
  type ServicoApiRow,
} from "@/lib/pdv-assistencia-shortcuts"

const product: PdvCatalogProduct = {
  id: "prod-1",
  name: "Cabo USB-C",
  price: 50,
  stock: 4,
  category: "Acessórios",
}

function service(over: Partial<ServicoApiRow> = {}) {
  return normalizeServicoRow({
    id: "svc-1",
    nome: "Transferência de Dados",
    categoria: "Software e Dados",
    custo: 0,
    preco: 80,
    garantia: 0,
    termo: "",
    active: true,
    status: "Ativo",
    ...over,
  })
}

describe("atalhos do PDV Assistência — serviço real", () => {
  it("adiciona serviço preservando kind, serviceId e categoria real", () => {
    const live = service()
    const saved = fromPdvAtalhoEntry(atalhoEntryFromCatalogItem(live))
    expect(saved).toMatchObject({
      kind: "servico",
      serviceId: "svc-1",
      serviceCategory: "Software e Dados",
      inventoryId: "__servico__svc-1",
    })
  })

  it("reidrata pelo serviceId e usa preço/categoria atuais, não o snapshot", () => {
    const saved: PdvAtalhoSaved = {
      id: "__servico__svc-1",
      inventoryId: "__servico__svc-1",
      kind: "servico",
      serviceId: "svc-1",
      nome: "Nome antigo",
      preco: 80,
      categoria: "Categoria antiga",
      serviceCategory: "Categoria antiga",
    }
    const current = service({ nome: "Transferência Premium", preco: 90, categoria: "Dados" })
    const entry = toPdvAtalhoEntry(saved, [product], [current], { serviceCatalogReady: true })
    expect(entry).toMatchObject({
      nome: "Transferência Premium",
      preco: 90,
      categoria: "Dados",
      orphan: false,
      kind: "servico",
    })
  })

  it("não vende silenciosamente serviço removido/inativado: atalho fica órfão e não resolve na grade", () => {
    const saved: PdvAtalhoSaved = {
      id: "__servico__svc-1",
      kind: "servico",
      serviceId: "svc-1",
      nome: "Transferência de Dados",
      preco: 80,
      ativo: true,
    }
    expect(toPdvAtalhoEntry(saved, [], [], { serviceCatalogReady: true }).orphan).toBe(true)
    expect(resolveActiveShortcutItems([saved], [], [])).toEqual([])
  })

  it("lê atalho de serviço do prefixo legado sem migração manual", () => {
    const saved: PdvAtalhoSaved = {
      id: "__avulso__svc-svc-1",
      inventoryId: "__avulso__svc-svc-1",
      nome: "Transferência de Dados",
      preco: 80,
      categoria: "Servicos",
    }
    expect(shortcutKindFromSaved(saved, [], [service()])).toBe("servico")
    expect(resolveSavedShortcut(saved, [], [service()]).live).toMatchObject({ serviceId: "svc-1" })
  })

  it("mantém Produto legado category=Servicos classificado explicitamente como produto", () => {
    const legacyProduct = { ...product, id: "prod-serv", category: "Servicos" }
    const saved: PdvAtalhoSaved = { id: legacyProduct.id, nome: legacyProduct.name, preco: 50, categoria: "Servicos" }
    expect(shortcutKindFromSaved(saved, [legacyProduct], [service()])).toBe("produto")
  })

  it("clique constrói linha de carrinho de serviço com metadata e sem isAvulso", () => {
    const line = buildServicoCartLine(service(), "line-1")
    expect(line).toMatchObject({
      itemType: "servico",
      serviceId: "svc-1",
      serviceCategory: "Software e Dados",
      inventoryId: "__servico__svc-1",
      price: 80,
      qty: 1,
    })
    expect(line).not.toHaveProperty("isAvulso")
  })
})
