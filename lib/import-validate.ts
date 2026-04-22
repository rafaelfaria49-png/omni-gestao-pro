/**
 * Validação pré-importação (sem gravar no banco). Usada pelos endpoints
 * `/api/import/validate/*` e pode ser reutilizada no cliente.
 */
import { cellToTrimmedString } from "@/lib/import-normalize"
import { parseDataBrFlex } from "@/lib/backup-import-datas"

export type ImportValidateError = { line: number; message: string }

export type MappingRecord = Record<string, string>

const MAX_ERRORS = 400

function pushError(errors: ImportValidateError[], line: number, message: string) {
  if (errors.length >= MAX_ERRORS) return
  errors.push({ line, message })
}

export function parseNumberPtBr(raw: unknown): number {
  const s0 = String(raw ?? "").trim()
  if (!s0) return 0
  let s = s0
    .replace(/\s+/g, "")
    .replace(/^r\$\s*/i, "")
    .replace(/[^0-9,.\-]/g, "")
  if (!s) return 0
  const hasComma = s.includes(",")
  const hasDot = s.includes(".")
  if (hasComma && hasDot) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".")
    } else {
      s = s.replace(/,/g, "")
    }
  } else if (hasComma) {
    s = s.replace(",", ".")
  }
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "")
}

/** Aceita vazio; se preenchido, exige 11 (CPF) ou 14 (CNPJ) dígitos após limpeza. */
export function docBrasilOk(raw: unknown): boolean {
  const d = digitsOnly(String(raw ?? "").trim())
  if (d.length === 0) return true
  return d.length === 11 || d.length === 14
}

export function validateClientesImport(params: {
  rows: Record<string, unknown>[]
  mapping: MappingRecord
}): ImportValidateError[] {
  const { rows, mapping } = params
  const errors: ImportValidateError[] = []
  const colNome = (mapping["clientes.nome"] ?? "").trim()
  if (!colNome) {
    pushError(errors, 0, 'Defina o vínculo da coluna "Nome" (campo obrigatório).')
    return errors
  }
  const colDoc = (mapping["clientes.doc"] ?? "").trim()

  rows.forEach((r, idx) => {
    const line = idx + 2
    const nome = colNome ? cellToTrimmedString(r[colNome] as unknown) : ""
    if (!nome) return
    if (colDoc) {
      const raw = r[colDoc]
      const s = String(raw ?? "").trim()
      if (s && !docBrasilOk(raw)) {
        pushError(errors, line, `CPF/CNPJ inválido (use 11 ou 14 dígitos). Valor: ${s.slice(0, 32)}`)
      }
    }
  })
  return errors
}

export function validateProdutosImport(params: {
  rows: Record<string, unknown>[]
  mapping: MappingRecord
}): ImportValidateError[] {
  const { rows, mapping } = params
  const errors: ImportValidateError[] = []
  const colNome = (mapping["produtos.nome"] ?? "").trim()
  if (!colNome) {
    pushError(errors, 0, 'Defina o vínculo da coluna "Nome do Produto" (obrigatório).')
    return errors
  }
  const colSku = (mapping["produtos.sku"] ?? "").trim()
  const colCusto = (mapping["produtos.preco_custo"] ?? "").trim()
  const colVenda = (mapping["produtos.preco_venda"] ?? "").trim()
  const colEst = (mapping["produtos.estoque"] ?? "").trim()

  rows.forEach((r, idx) => {
    const line = idx + 2
    const nome = cellToTrimmedString(r[colNome] as unknown)
    if (!nome) return
    if (colCusto) {
      const raw = r[colCusto]
      const s = String(raw ?? "").trim()
      if (s && parseNumberPtBr(raw) < 0) {
        pushError(errors, line, "Preço de custo inválido (não use valores negativos).")
      }
    }
    if (colVenda) {
      const raw = r[colVenda]
      const s = String(raw ?? "").trim()
      if (s && parseNumberPtBr(raw) < 0) {
        pushError(errors, line, "Preço de venda inválido (não use valores negativos).")
      }
    }
    if (colEst) {
      const raw = r[colEst]
      const s = String(raw ?? "").trim()
      if (s && !Number.isFinite(parseNumberPtBr(raw))) {
        pushError(errors, line, "Estoque inválido (esperado número).")
      }
    }
    void colSku
  })
  return errors
}

export function validateOrdensImport(params: {
  rows: Record<string, unknown>[]
  mapping: MappingRecord
}): ImportValidateError[] {
  const { rows, mapping } = params
  const errors: ImportValidateError[] = []
  const colNum = (mapping["ordens.numero"] ?? "").trim()
  const colNome = (mapping["ordens.cliente_nome"] ?? "").trim()
  const colDoc = (mapping["ordens.doc_cliente"] ?? "").trim()
  if (!colNum && !colNome && !colDoc) {
    pushError(errors, 0, "Mapeie ao menos um identificador: número da O.S., nome do cliente ou CPF/CNPJ.")
    return errors
  }
  rows.forEach((r, idx) => {
    const line = idx + 2
    const num = colNum ? String(r[colNum] ?? "").trim() : ""
    const nome = colNome ? String(r[colNome] ?? "").trim() : ""
    const doc = colDoc ? String(r[colDoc] ?? "").trim() : ""
    if (!num && !nome && !doc) return
    if (colDoc && doc && !docBrasilOk(doc)) {
      pushError(errors, line, `CPF/CNPJ do cliente inválido: ${doc.slice(0, 32)}`)
    }
  })
  return errors
}

export function validateFluxoCaixaImport(params: {
  rows: Record<string, unknown>[]
  mapping: MappingRecord
}): ImportValidateError[] {
  const { rows, mapping } = params
  const errors: ImportValidateError[] = []
  const cVal = (mapping["fluxo.valor"] ?? "").trim()
  const cDesc = (mapping["fluxo.descricao"] ?? "").trim()
  const cPag = (mapping["fluxo.data_pagamento"] ?? "").trim()
  const cVen = (mapping["fluxo.data_vencimento"] ?? "").trim()
  if (!cVal) pushError(errors, 0, 'Mapeie o campo "Valor (R$)".')
  if (!cDesc) pushError(errors, 0, 'Mapeie o campo "Descrição/Histórico".')
  if (!cPag && !cVen) pushError(errors, 0, "Mapeie data de pagamento ou data de vencimento.")
  if (errors.length) return errors

  rows.forEach((r, idx) => {
    const line = idx + 2
    const desc = cDesc ? cellToTrimmedString(r[cDesc] as unknown) : ""
    if (!desc) return
    const rawV = r[cVal!]
    const valor = parseNumberPtBr(rawV)
    const rawStr = String(rawV ?? "").trim()
    if (!rawStr && valor <= 0) return
    const dtBase = cPag ? parseDataBrFlex(r[cPag]) : cVen ? parseDataBrFlex(r[cVen]) : ""
    if (!dtBase) {
      pushError(errors, line, "Data de pagamento ou vencimento inválida ou vazia.")
    }
    if (valor < 0) pushError(errors, line, "Valor não pode ser negativo.")
  })
  return errors
}

export function validateVendasMovimentosImport(params: {
  rows: Record<string, unknown>[]
  mapping: MappingRecord
}): ImportValidateError[] {
  const { rows, mapping } = params
  const errors: ImportValidateError[] = []
  const cData = (mapping["vendas.data"] ?? "").trim()
  const cCli = (mapping["vendas.cliente"] ?? "").trim()
  const cVal = (mapping["vendas.valor_total"] ?? "").trim()
  if (!cData || !cCli || !cVal) {
    pushError(errors, 0, "Mapeie Data, Cliente/Descrição e Valor total.")
    return errors
  }
  rows.forEach((r, idx) => {
    const line = idx + 2
    const cli = cCli ? cellToTrimmedString(r[cCli] as unknown) : ""
    if (!cli) return
    const dt = cData ? parseDataBrFlex(r[cData]) : ""
    if (!dt) pushError(errors, line, "Data inválida ou vazia.")
    const valor = parseNumberPtBr(r[cVal])
    const rawStr = String(r[cVal] ?? "").trim()
    if (!rawStr && valor <= 0) pushError(errors, line, "Valor total ausente ou inválido.")
  })
  return errors
}

export function validateContasPagarImport(params: {
  rows: Record<string, unknown>[]
  mapping: MappingRecord
}): ImportValidateError[] {
  const { rows, mapping } = params
  const errors: ImportValidateError[] = []
  const colV = (mapping["contas_pagar.valor"] ?? "").trim()
  const colVen = (mapping["contas_pagar.vencimento"] ?? "").trim()
  if (!colV || !colVen) {
    pushError(errors, 0, "Mapeie Valor e Vencimento (obrigatórios).")
    return errors
  }
  rows.forEach((r, idx) => {
    const line = idx + 2
    const valor = parseNumberPtBr(r[colV])
    const rawStr = String(r[colV] ?? "").trim()
    if (!rawStr && valor <= 0) return
    const venc = parseDataBrFlex(r[colVen])
    if (!venc) pushError(errors, line, "Data de vencimento inválida.")
  })
  return errors
}

export function validateContasReceberImport(params: {
  rows: Record<string, unknown>[]
  mapping: MappingRecord
}): ImportValidateError[] {
  const { rows, mapping } = params
  const errors: ImportValidateError[] = []
  const colV = (mapping["contas_receber.valor"] ?? "").trim()
  const colVen = (mapping["contas_receber.vencimento"] ?? "").trim()
  if (!colV || !colVen) {
    pushError(errors, 0, "Mapeie Valor e Vencimento (obrigatórios).")
    return errors
  }
  rows.forEach((r, idx) => {
    const line = idx + 2
    const rawStr = String(r[colV] ?? "").trim()
    if (!rawStr && parseNumberPtBr(r[colV]) <= 0) return
    const venc = parseDataBrFlex(r[colVen])
    if (!venc) pushError(errors, line, "Data de vencimento inválida.")
  })
  return errors
}
