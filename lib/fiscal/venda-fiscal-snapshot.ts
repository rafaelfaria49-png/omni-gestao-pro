/**
 * Snapshot Fiscal da Venda (GOAL_005 — Venda Fiscal Snapshot).
 *
 * Camada PURA que CONGELA, no instante da venda, todos os dados fiscais necessários
 * à futura NFC-e: emitente (loja), destinatário (cliente/consumidor final), contexto
 * da venda (pagamento/desconto/operador/terminal) e itens (com a identidade fiscal lida
 * por `getProdutoFiscal` — GOAL_004). É a PONTE Venda → NotaFiscal futura.
 *
 * Princípios:
 *  - DORMENTE: não emite, não gera XML, não chama provider, não toca PDV/Caixa/Financeiro.
 *  - IMUTÁVEL: o objeto retornado é congelado (deep freeze). A persistência (serviço)
 *    grava uma única vez em NotaFiscal/NotaFiscalItem e nunca reescreve o snapshot.
 *  - NÃO INVENTA dado: produto sem fiscal vira PENDÊNCIA clara no diagnóstico (item 5).
 *  - Loja sem identidade fiscal mínima → erro controlado, sem snapshot inválido (item 6).
 *  - Sem dado vivo pós-venda: tudo que importa é copiado para dentro do snapshot aqui.
 */
import { AmbienteFiscal, ModeloFiscal, RegimeTributario } from "@/generated/prisma"
import { isValidCnpj, isValidUf, onlyDigits } from "./fiscal-validators"
import {
  getProdutoFiscal,
  isProdutoFiscalVazio,
  PRODUTO_FISCAL_VAZIO,
  type ProdutoFiscal,
} from "@/lib/produto-fiscal"
import { calculateTax } from "./tax-engine"
import type { TaxEngineInput, TaxRegime } from "./tax-engine"
import {
  derivePagamentoFiscal,
  type PagamentoFiscalCanonico,
  type PagamentoFiscalErro,
} from "./payment"

export const VENDA_FISCAL_SNAPSHOT_VERSAO = 1

/**
 * Versão das REGRAS tributárias congeladas no snapshot. O cálculo usa o motor puro
 * `lib/fiscal/tax-engine` (Fase F2). Incrementar quando a matriz tributária mudar de forma
 * que altere valores já congelados (auditoria/reprocessamento).
 */
export const VENDA_FISCAL_TAX_RULES_VERSION = 1

// ── Tipos de ENTRADA (o serviço carrega do banco e entrega isto ao builder) ────────

/** Subconjunto da `ConfiguracaoFiscalLoja` relevante ao snapshot do emitente. */
export type SnapshotLojaInput = {
  cnpj: string
  razaoSocial: string
  nomeFantasia: string
  inscricaoEstadual: string
  inscricaoMunicipal: string
  regimeTributario: RegimeTributario | string
  crt: number
  ambiente: AmbienteFiscal | string
  modeloFiscal: ModeloFiscal | string
  fiscalEnabled: boolean
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  codigoMunicipioIbge: string
  municipio: string
  uf: string
  cep: string
  codigoPais: string
  fone: string
  email: string
} | null

/** Subconjunto do `Cliente`. Null = consumidor final (sem identificação). */
export type SnapshotClienteInput = {
  nome: string
  documento: string
  kind: string
  telefone: string
  email: string
  municipio: string
} | null

/** Item já com a identidade fiscal resolvida (via getProdutoFiscal no serviço). */
export type SnapshotItemInput = {
  itemVendaId: string | null
  produtoId: string | null
  codigoProduto: string
  descricao: string
  gtin: string
  quantidade: number
  valorUnitario: number
  valorDesconto: number
  valorTotal: number
  fiscal: ProdutoFiscal
}

export type SnapshotVendaInput = {
  pedidoId: string
  data: string | Date
  total: number
  desconto: number
  operador: string
  terminal: string
  /** Quebra por forma de pagamento (congelada como veio — evidência bruta). */
  paymentBreakdown: Record<string, unknown> | null
  /**
   * Handoff versionado persistido na Venda (GOAL 075). Ausente em vendas históricas.
   * Quando presente, o snapshot NÃO cai para o breakdown.
   */
  fiscalPaymentHandoff?: unknown
}

export type BuildSnapshotInput = {
  storeId: string
  vendaId: string
  loja: SnapshotLojaInput
  cliente: SnapshotClienteInput
  venda: SnapshotVendaInput
  itens: SnapshotItemInput[]
}

// ── Tipos de SAÍDA (o snapshot congelado) ──────────────────────────────────────────

export type SnapshotEmitente = {
  cnpj: string
  razaoSocial: string
  nomeFantasia: string
  inscricaoEstadual: string
  inscricaoMunicipal: string
  regimeTributario: string
  crt: number
  ambiente: string
  modelo: string
  endereco: {
    logradouro: string
    numero: string
    complemento: string
    bairro: string
    municipio: string
    codigoMunicipioIbge: string
    uf: string
    cep: string
    codigoPais: string
  }
  fone: string
  email: string
}

export type SnapshotDestinatarioTipo = "consumidor_final" | "cpf" | "cnpj" | "identificado"

export type SnapshotDestinatario = {
  tipo: SnapshotDestinatarioTipo
  nome: string | null
  documento: string | null
  documentoTipo: "CPF" | "CNPJ" | ""
  telefone: string | null
  email: string | null
  municipio: string | null
}

export type SnapshotItem = {
  numeroItem: number
  itemVendaId: string | null
  produtoId: string | null
  codigoProduto: string
  descricao: string
  gtin: string
  quantidade: number
  valorUnitario: number
  valorDesconto: number
  valorTotal: number
  ncm: string
  cest: string
  cfop: string
  cst: string
  csosn: string
  origemMercadoria: string
  unidadeComercial: string
  unidadeTributavel: string
  /** True quando há o mínimo fiscal para emitir o item (NCM presente). */
  fiscalCompleto: boolean
  /** Campos fiscais faltantes (nunca inventados). */
  pendencias: string[]
}

export type SnapshotVenda = {
  pedidoId: string
  data: string
  total: number
  desconto: number
  operador: string
  terminal: string
  /** Evidência bruta persistida. O XML NÃO interpreta este campo. */
  paymentBreakdown: Record<string, unknown> | null
  /**
   * Contrato de pagamento fiscal v1 (GOAL 030). Aditivo: snapshots legados não
   * têm este campo — emissão futura falha fechado, sem reconstruir de dado vivo.
   */
  pagamentoFiscal?: PagamentoFiscalCanonico | null
  pagamentoFiscalErro?: PagamentoFiscalErro | null
}

/** Componente de um imposto (ICMS/PIS/COFINS) congelado no snapshot. */
export type SnapshotTributoComponente = {
  /** "tributado" | "nao_destacado" | "isento" | "com_credito_simples" (ver tax-engine). */
  situacao: string
  /** Código aplicado (CSOSN para ICMS no Simples; CST para PIS/COFINS). */
  codigo: string
  baseCalculo: number
  aliquota: number
  valor: number
}

/** Tributação CONGELADA por item (resultado do motor tax-engine no ato da venda). */
export type SnapshotItemTributos = {
  numeroItem: number
  cfop: string
  csosn: string
  /** Base potencial do item: bruto − desconto + frete + seguro + outras. */
  valorTributavel: number
  /** Lei da Transparência (IBPT) aproximado — 0 quando não informado. */
  valorAproximadoTributos: number
  /** Soma dos impostos DESTACADOS do item (icms+pis+cofins). Simples 102 = 0. */
  tributosDestacados: number
  icms: SnapshotTributoComponente & { pCredSN: number; valorCreditoSimples: number }
  pis: SnapshotTributoComponente
  cofins: SnapshotTributoComponente
}

/**
 * Bloco fiscal-tributário CONGELADO da nota. No Simples Nacional baseline (CSOSN 102) NENHUM
 * imposto é destacado (valores 0) — isto é correto (imposto no DAS), não ausência de cálculo.
 * `ok=false` quando o caso está fora do baseline do motor (regime normal/ST/interestadual): o
 * snapshot ainda é criado, mas a tributação fica pendente com o(s) motivo(s).
 */
export type SnapshotTributacao = {
  ok: boolean
  engineVersion: string
  regrasVersion: number
  regime: string
  /** True quando nenhum imposto foi destacado (caso típico do Simples Nacional). */
  semDestaque: boolean
  totais: {
    baseCalculoIcms: number
    valorIcms: number
    valorPis: number
    valorCofins: number
    valorTotalTributos: number
    valorAproximadoTributos: number
    valorTotalNota: number
  }
  /** Motivos quando ok=false (caso fora do baseline). */
  pendencias: string[]
  itens: SnapshotItemTributos[]
}

export type VendaFiscalSnapshot = {
  versao: number
  geradoEm: string
  storeId: string
  vendaId: string
  modelo: string
  ambiente: string
  emitente: SnapshotEmitente
  destinatario: SnapshotDestinatario
  venda: SnapshotVenda
  itens: SnapshotItem[]
  totais: {
    valorTotal: number
    valorDesconto: number
    quantidadeItens: number
  }
  diagnostico: {
    /** True quando NADA falta para emitir (sem pendências). Dormente: não emite mesmo assim. */
    prontoParaEmissao: boolean
    pendencias: string[]
    /** Índices (numeroItem) dos itens sem fiscal mínimo. */
    itensSemFiscal: number[]
  }
  /**
   * Tributação CONGELADA (motor lib/fiscal/tax-engine — Fase F2). Opcional para
   * compatibilidade com snapshots antigos; o builder atual sempre a preenche.
   */
  tributacao?: SnapshotTributacao
}

export type SnapshotErrorCode =
  | "loja_sem_identidade_fiscal"
  | "venda_sem_itens"
  | "venda_invalida"

export type BuildSnapshotResult =
  | { ok: true; snapshot: VendaFiscalSnapshot; localKey: string }
  | { ok: false; code: SnapshotErrorCode; error: string; pendencias: string[] }

// ── Utilitários puros ───────────────────────────────────────────────────────────────

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim()
}
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}
function toIso(v: string | Date): string {
  if (v instanceof Date) return v.toISOString()
  const d = new Date(s(v))
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString()
}

/** Congela recursivamente (imutabilidade conceitual do snapshot). */
export function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj)
    for (const k of Object.keys(obj as Record<string, unknown>)) {
      deepFreeze((obj as Record<string, unknown>)[k])
    }
  }
  return obj
}

/** localKey determinística por (loja, venda) — base da idempotência do snapshot. */
export function resolveSnapshotLocalKey(storeId: string, vendaId: string): string {
  return `nfce-snapshot:${s(storeId)}:${s(vendaId)}`
}

/**
 * Identidade fiscal MÍNIMA da loja para um snapshot válido: CNPJ válido, razão social,
 * UF válida. Campos adicionais (IBGE/IE/endereço) viram pendência, não erro.
 */
export function lojaTemIdentidadeFiscalMinima(loja: SnapshotLojaInput): boolean {
  if (!loja) return false
  return isValidCnpj(loja.cnpj) && s(loja.razaoSocial).length > 0 && isValidUf(loja.uf)
}

/** Pendências da identidade fiscal da loja (campos que faltam para emitir, não para snapshot). */
function pendenciasLoja(loja: NonNullable<SnapshotLojaInput>): string[] {
  const p: string[] = []
  if (onlyDigits(loja.codigoMunicipioIbge).length !== 7) p.push("Código IBGE do município da loja")
  if (s(loja.municipio).length === 0) p.push("Município da loja")
  if (s(loja.inscricaoEstadual).length === 0) p.push("Inscrição Estadual da loja")
  if (s(loja.logradouro).length === 0) p.push("Endereço (logradouro) da loja")
  return p
}

function pendenciasItem(fiscal: ProdutoFiscal): string[] {
  const p: string[] = []
  if (!fiscal.ncm) p.push("NCM")
  if (!fiscal.cfop) p.push("CFOP")
  if (!fiscal.cst && !fiscal.csosn) p.push("CST/CSOSN")
  if (!fiscal.origemMercadoria) p.push("Origem da mercadoria")
  return p
}

function classificarDestinatario(cliente: SnapshotClienteInput): SnapshotDestinatario {
  if (!cliente) {
    return {
      tipo: "consumidor_final",
      nome: null,
      documento: null,
      documentoTipo: "",
      telefone: null,
      email: null,
      municipio: null,
    }
  }
  const docDigits = onlyDigits(cliente.documento)
  let documentoTipo: "CPF" | "CNPJ" | "" = ""
  let tipo: SnapshotDestinatarioTipo = "identificado"
  if (docDigits.length === 11) {
    documentoTipo = "CPF"
    tipo = "cpf"
  } else if (docDigits.length === 14) {
    documentoTipo = "CNPJ"
    tipo = "cnpj"
  }
  return {
    tipo,
    nome: s(cliente.nome) || null,
    documento: docDigits || null,
    documentoTipo,
    telefone: s(cliente.telefone) || null,
    email: s(cliente.email) || null,
    municipio: s(cliente.municipio) || null,
  }
}

// ── Tributação congelada (integra o motor tax-engine — Fase F2) ───────────────────────

/**
 * Calcula e CONGELA a tributação do snapshot via `calculateTax` (motor puro).
 * Mapeia emitente (regime) + itens (csosn/cfop/origem/valores) para a entrada do motor.
 * Graceful: se o caso estiver fora do baseline (regime normal/ST/interestadual), devolve
 * `ok=false` + pendências — o snapshot NÃO falha por isso (a tributação fica pendente).
 *
 * NFC-e B2C: âmbito `interna`, destino `consumidor_final`. O desconto é o do cabeçalho da
 * venda (rateado pelo motor); itens não têm desconto próprio nesta fase.
 */
export function computeSnapshotTributacao(
  emitente: SnapshotEmitente,
  itens: SnapshotItem[],
  venda: SnapshotVenda,
): SnapshotTributacao {
  const regime = s(emitente.regimeTributario)
  const descontoTotal = round2(num(venda.desconto))
  const taxInput: TaxEngineInput = {
    regime: regime as TaxRegime,
    ambito: "interna",
    destino: "consumidor_final",
    descontoTotal: descontoTotal > 0 ? descontoTotal : undefined,
    itens: itens.map((it) => ({
      id: String(it.numeroItem),
      quantidade: num(it.quantidade),
      valorUnitario: num(it.valorUnitario),
      descontoValor: num(it.valorDesconto) > 0 ? round2(num(it.valorDesconto)) : undefined,
      cfop: it.cfop || undefined,
      csosn: it.csosn || undefined,
      origemMercadoria: it.origemMercadoria || undefined,
    })),
  }

  const tax = calculateTax(taxInput)

  const itensTrib: SnapshotItemTributos[] = tax.ok
    ? tax.itens.map((ti) => ({
        numeroItem: ti.index,
        cfop: s(itens[ti.index - 1]?.cfop),
        csosn: ti.icms.codigo,
        valorTributavel: ti.valorTributavel,
        valorAproximadoTributos: ti.valorAproximadoTributos,
        tributosDestacados: ti.tributosDestacados,
        icms: {
          situacao: ti.icms.situacao,
          codigo: ti.icms.codigo,
          baseCalculo: ti.icms.baseCalculo,
          aliquota: ti.icms.aliquota,
          valor: ti.icms.valor,
          pCredSN: ti.icms.pCredSN,
          valorCreditoSimples: ti.icms.valorCreditoSimples,
        },
        pis: {
          situacao: ti.pis.situacao,
          codigo: ti.pis.codigo,
          baseCalculo: ti.pis.baseCalculo,
          aliquota: ti.pis.aliquota,
          valor: ti.pis.valor,
        },
        cofins: {
          situacao: ti.cofins.situacao,
          codigo: ti.cofins.codigo,
          baseCalculo: ti.cofins.baseCalculo,
          aliquota: ti.cofins.aliquota,
          valor: ti.cofins.valor,
        },
      }))
    : []

  return {
    ok: tax.ok,
    engineVersion: tax.meta.engineVersion,
    regrasVersion: VENDA_FISCAL_TAX_RULES_VERSION,
    regime,
    semDestaque: tax.meta.semDestaque,
    totais: {
      baseCalculoIcms: tax.totais.baseCalculoIcms,
      valorIcms: tax.totais.valorIcms,
      valorPis: tax.totais.valorPis,
      valorCofins: tax.totais.valorCofins,
      valorTotalTributos: tax.totais.valorTotalTributos,
      valorAproximadoTributos: tax.totais.valorAproximadoTributos,
      valorTotalNota: tax.totais.valorTotalNota,
    },
    pendencias: tax.ok ? [] : tax.errors.map((e) => e.mensagem),
    itens: itensTrib,
  }
}

// ── Builder canônico ─────────────────────────────────────────────────────────────────

/**
 * CONSTRÓI o snapshot fiscal (puro). Não persiste, não emite. Resultado é deep-frozen.
 * - Loja sem identidade mínima → erro `loja_sem_identidade_fiscal` (não cria snapshot).
 * - Venda sem itens → erro `venda_sem_itens`.
 * - Produto sem fiscal → snapshot criado COM pendência (não inventa dado).
 */
export function buildVendaFiscalSnapshot(input: BuildSnapshotInput): BuildSnapshotResult {
  const storeId = s(input.storeId)
  const vendaId = s(input.vendaId)
  if (!storeId || !vendaId) {
    return { ok: false, code: "venda_invalida", error: "Venda/loja inválida para snapshot.", pendencias: [] }
  }

  const loja = input.loja
  if (!lojaTemIdentidadeFiscalMinima(loja)) {
    return {
      ok: false,
      code: "loja_sem_identidade_fiscal",
      error:
        "Loja sem identidade fiscal mínima (CNPJ válido, razão social e UF). Configure a identidade fiscal da loja antes de gerar o snapshot.",
      pendencias: ["CNPJ", "Razão social", "UF"],
    }
  }
  const lojaOk = loja as NonNullable<SnapshotLojaInput>

  const itensInput = Array.isArray(input.itens) ? input.itens : []
  if (itensInput.length === 0) {
    return { ok: false, code: "venda_sem_itens", error: "Venda sem itens — nada a congelar.", pendencias: [] }
  }

  const emitente: SnapshotEmitente = {
    cnpj: onlyDigits(lojaOk.cnpj),
    razaoSocial: s(lojaOk.razaoSocial),
    nomeFantasia: s(lojaOk.nomeFantasia),
    inscricaoEstadual: s(lojaOk.inscricaoEstadual),
    inscricaoMunicipal: s(lojaOk.inscricaoMunicipal),
    regimeTributario: s(lojaOk.regimeTributario),
    crt: num(lojaOk.crt),
    ambiente: s(lojaOk.ambiente),
    modelo: s(lojaOk.modeloFiscal),
    endereco: {
      logradouro: s(lojaOk.logradouro),
      numero: s(lojaOk.numero),
      complemento: s(lojaOk.complemento),
      bairro: s(lojaOk.bairro),
      municipio: s(lojaOk.municipio),
      codigoMunicipioIbge: onlyDigits(lojaOk.codigoMunicipioIbge),
      uf: s(lojaOk.uf).toUpperCase(),
      cep: onlyDigits(lojaOk.cep),
      codigoPais: s(lojaOk.codigoPais) || "1058",
    },
    fone: s(lojaOk.fone),
    email: s(lojaOk.email),
  }

  const destinatario = classificarDestinatario(input.cliente)

  const itens: SnapshotItem[] = itensInput.map((it, idx) => {
    const fiscal = it.fiscal ?? PRODUTO_FISCAL_VAZIO
    const pend = pendenciasItem(fiscal)
    return {
      numeroItem: idx + 1,
      itemVendaId: it.itemVendaId ?? null,
      produtoId: it.produtoId ?? null,
      codigoProduto: s(it.codigoProduto),
      descricao: s(it.descricao),
      gtin: s(it.gtin),
      quantidade: num(it.quantidade),
      valorUnitario: round2(num(it.valorUnitario)),
      valorDesconto: round2(num(it.valorDesconto)),
      valorTotal: round2(num(it.valorTotal)),
      ncm: fiscal.ncm,
      cest: fiscal.cest,
      cfop: fiscal.cfop,
      cst: fiscal.cst,
      csosn: fiscal.csosn,
      origemMercadoria: fiscal.origemMercadoria,
      unidadeComercial: fiscal.unidadeComercial || "UN",
      // uTrib não tem coluna dedicada: deriva da uCom quando ausente (padrão NFC-e).
      unidadeTributavel: fiscal.unidadeTributavel || fiscal.unidadeComercial || "UN",
      fiscalCompleto: !isProdutoFiscalVazio(fiscal) && pend.length === 0,
      pendencias: pend,
    }
  })

  const brutoPagamento = input.venda.paymentBreakdown
  const paymentBreakdown: Record<string, unknown> | null =
    brutoPagamento && typeof brutoPagamento === "object" && !Array.isArray(brutoPagamento)
      ? { ...(brutoPagamento as Record<string, unknown>) }
      : brutoPagamento && typeof brutoPagamento === "object"
        ? (JSON.parse(JSON.stringify(brutoPagamento)) as Record<string, unknown>)
        : null

  const totalVenda = round2(num(input.venda.total))
  const derivedPag = derivePagamentoFiscal(
    brutoPagamento,
    totalVenda,
    input.venda.fiscalPaymentHandoff,
  )

  const venda: SnapshotVenda = {
    pedidoId: s(input.venda.pedidoId),
    data: toIso(input.venda.data),
    total: totalVenda,
    desconto: round2(num(input.venda.desconto)),
    operador: s(input.venda.operador),
    terminal: s(input.venda.terminal),
    paymentBreakdown,
    pagamentoFiscal: derivedPag.ok ? derivedPag.pagamento : null,
    pagamentoFiscalErro: derivedPag.ok ? null : derivedPag.erro,
  }

  const itensSemFiscal = itens.filter((i) => !i.fiscalCompleto).map((i) => i.numeroItem)
  const pendencias = [
    ...pendenciasLoja(lojaOk),
    ...(itensSemFiscal.length > 0
      ? [`${itensSemFiscal.length} item(ns) sem identidade fiscal completa (itens ${itensSemFiscal.join(", ")})`]
      : []),
  ]

  // Tributação congelada via motor puro (tax-engine). Não falha o snapshot fora do baseline.
  const tributacao = computeSnapshotTributacao(emitente, itens, venda)

  const snapshot: VendaFiscalSnapshot = {
    versao: VENDA_FISCAL_SNAPSHOT_VERSAO,
    geradoEm: new Date().toISOString(),
    storeId,
    vendaId,
    modelo: emitente.modelo,
    ambiente: emitente.ambiente,
    emitente,
    destinatario,
    venda,
    itens,
    totais: {
      valorTotal: round2(num(input.venda.total)),
      valorDesconto: round2(num(input.venda.desconto)),
      quantidadeItens: itens.length,
    },
    diagnostico: {
      prontoParaEmissao: pendencias.length === 0,
      pendencias,
      itensSemFiscal,
    },
    tributacao,
  }

  return { ok: true, snapshot: deepFreeze(snapshot), localKey: resolveSnapshotLocalKey(storeId, vendaId) }
}
