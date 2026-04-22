/**
 * Cruzamento de planilhas para o Dashboard 360 (Vendas × Produtos por pedido; OS × equipamentos).
 * Persistido no navegador para enriquecer rankings quando o backup vem em arquivos separados.
 *
 * Não importe `@/lib/prisma` aqui: este módulo roda no browser (`localStorage`).
 * O Prisma Client só é válido em rotas API / Node.
 */

import { parseDataBrFlex } from "@/lib/backup-import-datas"
import { cellToTrimmedString } from "@/lib/import-normalize"

export const STORAGE_D360_VENDAS_PRODUTOS = "assistec-d360-vendas-produtos-por-pedido"
export const STORAGE_D360_OS_EQUIP = "assistec-d360-os-equipamentos"

export type VendaProdutoLinha = {
  pedido: string
  produtoNome: string
  /** Nome do cliente (vendas.xlsx) quando disponível */
  clienteNome?: string
  quantidade: number
  /** Valor de venda da linha (receita) */
  valor?: number
  custo?: number
  /** YYYY-MM-DD da venda (vendas.xlsx), para filtro por mês no dashboard */
  dataVenda?: string
}

export type VendasProdutosPorPedidoPayload = {
  atualizadoEm: string
  linhas: VendaProdutoLinha[]
}

export type OsEquipamentoLinha = {
  osNumero: string
  /** Nome do cliente (ordens_servicos.xlsx) quando disponível */
  clienteNome?: string
  equipamento: string
  servicoNome?: string
  /** Valor do serviço (quando a planilha trouxer) */
  valorServico?: number
}

export type OsEquipamentosPayload = {
  atualizadoEm: string
  linhas: OsEquipamentoLinha[]
}

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function loadVendasProdutosPorPedido(): VendasProdutosPorPedidoPayload {
  if (typeof window === "undefined") return { atualizadoEm: "", linhas: [] }
  return safeJsonParse<VendasProdutosPorPedidoPayload>(localStorage.getItem(STORAGE_D360_VENDAS_PRODUTOS), {
    atualizadoEm: "",
    linhas: [],
  })
}

export function saveVendasProdutosPorPedido(payload: VendasProdutosPorPedidoPayload): void {
  if (typeof window === "undefined") return
  localStorage.setItem(STORAGE_D360_VENDAS_PRODUTOS, JSON.stringify(payload))
}

export function loadOsEquipamentos(): OsEquipamentosPayload {
  if (typeof window === "undefined") return { atualizadoEm: "", linhas: [] }
  return safeJsonParse<OsEquipamentosPayload>(localStorage.getItem(STORAGE_D360_OS_EQUIP), {
    atualizadoEm: "",
    linhas: [],
  })
}

export function saveOsEquipamentos(payload: OsEquipamentosPayload): void {
  if (typeof window === "undefined") return
  localStorage.setItem(STORAGE_D360_OS_EQUIP, JSON.stringify(payload))
}

function parseMoneyBr(raw: unknown): number | undefined {
  if (raw == null) return undefined
  const v = Number(String(raw).replace(/\s/g, "").replace(/\./g, "").replace(",", "."))
  return Number.isFinite(v) ? v : undefined
}

/** Une vendas.xlsx com vendas_produtos.xlsx pela chave do pedido. */
export function joinVendasComProdutosPorPedido(
  linhasProdutos: Record<string, unknown>[],
  colPedido: string,
  colNomeProduto: string,
  colQtd?: string,
  colValor?: string,
  colCusto?: string
): VendaProdutoLinha[] {
  const out: VendaProdutoLinha[] = []
  for (const r of linhasProdutos) {
    const pedido = cellToTrimmedString(r[colPedido])
    if (!pedido) continue
    const produtoNome = colNomeProduto ? cellToTrimmedString(r[colNomeProduto]) : ""
    if (!produtoNome) continue
    let quantidade = 1
    if (colQtd && r[colQtd] != null) {
      const q = Number(String(r[colQtd]).replace(",", "."))
      if (Number.isFinite(q) && q > 0) quantidade = Math.round(q)
    }
    const valor = colValor ? parseMoneyBr(r[colValor]) : undefined
    const custo = colCusto ? parseMoneyBr(r[colCusto]) : undefined
    out.push({ pedido, produtoNome, quantidade, valor, custo })
  }
  return out
}

/** Cruza cabeçalho vendas.xlsx: data por Nº do pedido para filtrar linhas no dashboard. */
export function enrichLinhasComDataCabecalhoVendas(
  linhas: VendaProdutoLinha[],
  vendasCabecalho: Record<string, unknown>[],
  colPedido: string,
  colData: string,
  colCliente?: string
): VendaProdutoLinha[] {
  const dataPorPedido = new Map<string, string>()
  const clientePorPedido = new Map<string, string>()
  for (const r of vendasCabecalho) {
    const p = cellToTrimmedString(r[colPedido])
    if (!p) continue
    const rawD = r[colData]
    if (rawD == null || String(rawD).trim() === "") continue
    dataPorPedido.set(p, parseDataBrFlex(rawD))
    if (colCliente) {
      const nome = cellToTrimmedString(r[colCliente])
      if (nome) clientePorPedido.set(p, nome)
    }
  }
  return linhas.map((l) => ({
    ...l,
    dataVenda: dataPorPedido.get(l.pedido) ?? l.dataVenda,
    clienteNome: clientePorPedido.get(l.pedido) ?? l.clienteNome,
  }))
}

/** Une ordens_servicos_equipamentos com chave Nº da OS + nome do serviço opcional (servicos.xlsx). */
export function joinOsEquipamentos(
  linhas: Record<string, unknown>[],
  colOs: string,
  colEquip: string,
  colServico?: string,
  colCliente?: string
): OsEquipamentoLinha[] {
  const out: OsEquipamentoLinha[] = []
  for (const r of linhas) {
    const osNumero = cellToTrimmedString(r[colOs])
    if (!osNumero) continue
    const equipamento = colEquip ? cellToTrimmedString(r[colEquip]) : ""
    const servicoNome = colServico ? cellToTrimmedString(r[colServico]) : undefined
    const clienteNome = colCliente ? cellToTrimmedString(r[colCliente]) : undefined
    out.push({ osNumero, clienteNome, equipamento, servicoNome })
  }
  return out
}

/**
 * Cruzamento completo: `ordens_servicos_servicos.xlsx` (nome do serviço por OS) +
 * opcional `ordens_servicos_equipamentos.xlsx` (equipamento por OS).
 * Prioriza o nome do serviço para ranking (ex.: Troca de Tela).
 */
export function joinOsServicosEEquipamentos(
  linhasServicos: Record<string, unknown>[],
  colOsServ: string,
  colNomeServico: string,
  colValorServ?: string,
  colClienteServ?: string,
  linhasEquip?: Record<string, unknown>[],
  colOsEquip?: string,
  colEquip?: string
): OsEquipamentoLinha[] {
  const equipPorOs = new Map<string, string>()
  if (linhasEquip?.length && colOsEquip && colEquip) {
    for (const r of linhasEquip) {
      const os = cellToTrimmedString(r[colOsEquip])
      if (!os) continue
      const eq = cellToTrimmedString(r[colEquip])
      if (eq) equipPorOs.set(os, eq)
    }
  }

  const out: OsEquipamentoLinha[] = []
  for (const r of linhasServicos) {
    const osNumero = cellToTrimmedString(r[colOsServ])
    if (!osNumero) continue
    const servicoNome = cellToTrimmedString(r[colNomeServico])
    if (!servicoNome) continue
    const equipamento = equipPorOs.get(osNumero) ?? ""
    const clienteNome = colClienteServ ? cellToTrimmedString(r[colClienteServ]) : undefined
    let valorServico: number | undefined
    if (colValorServ && r[colValorServ] != null) {
      const v = parseMoneyBr(r[colValorServ])
      if (v != null) valorServico = v
    }
    out.push({ osNumero, clienteNome, equipamento, servicoNome, valorServico })
  }
  return out
}
