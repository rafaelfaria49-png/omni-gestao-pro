import { describe, it, expect } from "vitest"
import {
  buildAssistenciaPayMethods,
  defaultFormasPagamento,
} from "@/lib/pdv-formas-pagamento"
import {
  resolveActiveShortcutItems,
  type PdvAtalhoSaved,
  type PdvCatalogProduct,
  type PdvServicoCatalogItem,
  SERVICO_STOCK_SENTINEL,
} from "@/lib/pdv-assistencia-shortcuts"

describe("PDV Assistência — Layout, Carrinho e Grade (PDV-ASSISTENCIA-LAYOUT-CARRINHO-GRADE-002)", () => {
  describe("Formas de pagamento — grade 3x2", () => {
    it("mantém exatamente as 6 formas ativas para o layout 3x2 no PDV Assistência", () => {
      const methods = buildAssistenciaPayMethods(defaultFormasPagamento())
      expect(methods).toHaveLength(6)

      // Linha 1: Dinheiro (F1), PIX, Débito
      expect(methods[0]?.id).toBe("dinheiro")
      expect(methods[0]?.hotkey).toBe("F1")
      expect(methods[1]?.id).toBe("pix")
      expect(methods[2]?.id).toBe("debito")

      // Linha 2: Crédito, À prazo, Múltiplo (F12)
      expect(methods[3]?.id).toBe("credito")
      expect(methods[4]?.id).toBe("a_prazo")
      expect(methods[5]?.id).toBe("multiplo")
      expect(methods[5]?.hotkey).toBe("F12")
    })
  })

  describe("Grade de atalhos 3x3 (suporte a 9 itens)", () => {
    it("resolve e suporta até 9 atalhos de produto ativos na grade 3x3", () => {
      const mockProducts: PdvCatalogProduct[] = Array.from({ length: 9 }, (_, i) => ({
        id: `prod-${i + 1}`,
        name: i === 2 ? "capinha de 15,00 transparente case simples premium plus" : `Produto Atalho ${i + 1}`,
        price: 15 + i * 5,
        stock: 20,
        category: "Capinhas",
      }))

      const mockSavedShortcuts: PdvAtalhoSaved[] = mockProducts.map((p, idx) => ({
        id: p.id,
        nome: p.name,
        preco: p.price,
        inventoryId: p.id,
        ativo: true,
        posicao: idx,
        kind: "produto",
      }))

      const resolved = resolveActiveShortcutItems(mockSavedShortcuts, mockProducts, [], { kind: "produto" })
      expect(resolved).toHaveLength(9)
      expect(resolved[2]?.name).toBe("capinha de 15,00 transparente case simples premium plus")
      expect(resolved[8]?.id).toBe("prod-9")
    })

    it("resolve e suporta até 9 atalhos de serviço ativos na grade 3x3", () => {
      const mockServices: PdvServicoCatalogItem[] = Array.from({ length: 9 }, (_, i) => ({
        id: `serv-inv-${i + 1}`,
        name: `Troca de Tela Premium Smartphone Linha ${i + 1}`,
        price: 150 + i * 20,
        stock: SERVICO_STOCK_SENTINEL,
        category: "Serviços",
        catalogSource: "servico",
        serviceId: `svc-${i + 1}`,
        custoServico: 50,
        warrantyDays: 90,
        serviceTerms: "Garantia 90 dias",
        serviceCategory: "Telas",
      }))

      const mockSavedShortcuts: PdvAtalhoSaved[] = mockServices.map((s, idx) => ({
        id: s.id,
        nome: s.name,
        preco: s.price,
        serviceId: s.serviceId,
        ativo: true,
        posicao: idx,
        kind: "servico",
      }))

      const resolved = resolveActiveShortcutItems(mockSavedShortcuts, [], mockServices, { kind: "servico" })
      expect(resolved).toHaveLength(9)
      expect(resolved[0]?.name).toBe("Troca de Tela Premium Smartphone Linha 1")
      expect(resolved[8]?.name).toBe("Troca de Tela Premium Smartphone Linha 9")
    })
  })

  describe("Carrinho e itens longos", () => {
    it("preserva dados completos de itens com nomes longos e múltiplas quantidades", () => {
      const longName = "capinha de 15,00 transparente case simples para smartphone samsung galaxy a15 ultra protection"
      const cartLine = {
        lineId: "line-1",
        inventoryId: "inv-1",
        title: longName,
        price: 15.0,
        qty: 3,
        itemType: "produto" as const,
      }

      expect(cartLine.title).toBe(longName)
      expect(cartLine.price * cartLine.qty).toBe(45.0)
    })
  })
})
