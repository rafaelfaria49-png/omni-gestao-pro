import type { InventoryItem, ProdutoAtributoDef } from "@/lib/operations-store"

export type PdvCatalogProduct = {
  id: string
  name: string
  /** Código de barras (EAN/GTIN). */
  barcode?: string
  price: number
  stock: number
  category: string
  vendaPorPeso?: boolean
  precoPorKg?: number
  atributos?: ProdutoAtributoDef[]
  complementos?: { id: string; name: string; price: number }[]
}

export const PDV_PRODUCTS_BASE: PdvCatalogProduct[] = [
  {
    id: "1",
    name: "Tela iPhone 13",
    price: 350.0,
    stock: 5,
    category: "Telas",
    complementos: [
      { id: "c1", name: "Pelicula de Vidro", price: 25.0 },
      { id: "c2", name: "Capinha de Silicone", price: 35.0 },
    ],
  },
  {
    id: "2",
    name: "Bateria Samsung S21",
    price: 180.0,
    stock: 8,
    category: "Baterias",
    complementos: [{ id: "c3", name: "Carregador Turbo", price: 45.0 }],
  },
  {
    id: "3",
    name: "Conector de Carga Motorola",
    price: 45.0,
    stock: 12,
    category: "Conectores",
    complementos: [{ id: "c4", name: "Cabo USB-C", price: 20.0 }],
  },
  {
    id: "4",
    name: "Pelicula de Vidro 3D",
    price: 25.0,
    stock: 30,
    category: "Acessorios",
  },
  {
    id: "5",
    name: "Capinha Anti-Impacto",
    price: 40.0,
    stock: 25,
    category: "Acessorios",
  },
  {
    id: "6",
    name: "Queijo minas",
    price: 42.9,
    stock: 25,
    category: "Mercearia",
    vendaPorPeso: true,
    precoPorKg: 42.9,
  },
  {
    id: "7",
    name: "Camiseta básica",
    price: 59.9,
    stock: 120,
    category: "Roupas",
    atributos: [
      { id: "tam", nome: "Tamanho", opcoes: ["P", "M", "G", "GG"] },
      { id: "cor", nome: "Cor", opcoes: ["Branco", "Preto", "Azul marinho"] },
    ],
  },
]

export function mergePdvCatalogWithInventory(
  base: PdvCatalogProduct[],
  inventory: InventoryItem[]
): PdvCatalogProduct[] {
  return base.map((p) => {
    const inv = inventory.find((i) => i.id === p.id)
    if (!inv) return p
    const unit = inv.vendaPorPeso ? (inv.precoPorKg ?? inv.price) : inv.price
    return {
      ...p,
      stock: inv.stock,
      price: unit,
      barcode: inv.barcode || p.barcode,
      precoPorKg: inv.precoPorKg ?? inv.price,
      vendaPorPeso: inv.vendaPorPeso,
      atributos: inv.atributos?.length ? inv.atributos : p.atributos,
    }
  })
}

export function newPdvLineId(inventoryId: string) {
  return `${inventoryId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
