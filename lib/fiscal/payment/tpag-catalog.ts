/**
 * Catálogo oficial de `tPag` (meios de pagamento NFC-e 4.00).
 *
 * Autoridade (nesta ordem):
 *  1. Pacote XSD versionado no repositório `PL_010e_v1.02` (`leiauteNFe_v4.00.xsd`):
 *     `tPag` é `[0-9]{2}`; o XSD NÃO enumera os códigos — só o padrão.
 *  2. Informe Técnico 2024.002 v1.11 (Portal Nacional da NF-e / ENCAT, 04/03/2026) —
 *     tabela vigente de meios de pagamento dos DF-e.
 *
 * A tabela de rótulos em `lib/fiscal/danfce/format.ts` NÃO é autoridade: é subset
 * histórico para exibição do DANFC-e.
 *
 * Este módulo NÃO mapeia forma interna de PDV. O mapeamento comprovado vive em
 * `from-venda-breakdown.ts` e só inclui chaves persistidas com evidência suficiente.
 */

export const TPAG_CATALOGO_FONTE = "IT-2024.002-v1.11" as const
export const TPAG_CATALOGO_XSD = "PL_010e_v1.02/leiauteNFe_v4.00.xsd" as const

/** Código `tPag` oficial (dois dígitos). */
export type TPagOficial = string

export type TPagCatalogoEntry = {
  readonly tPag: TPagOficial
  readonly descricao: string
}

/**
 * Tabela IT 2024.002 v1.11. Códigos 23/24/91 existem na tabela vigente e no
 * padrão XSD `[0-9]{2}`; o Fiscal só EMITE os que o contrato de pagamento
 * conseguir derivar da venda persistida.
 */
export const TPAG_CATALOGO_OFICIAL: readonly TPagCatalogoEntry[] = [
  { tPag: "01", descricao: "Dinheiro" },
  { tPag: "02", descricao: "Cheque" },
  { tPag: "03", descricao: "Cartão de Crédito" },
  { tPag: "04", descricao: "Cartão de Débito" },
  { tPag: "05", descricao: "Cartão da Loja (Private Label), Crediário Digital, Outros Crediários" },
  { tPag: "10", descricao: "Vale Alimentação" },
  { tPag: "11", descricao: "Vale Refeição" },
  { tPag: "12", descricao: "Vale Presente" },
  { tPag: "13", descricao: "Vale Combustível" },
  { tPag: "14", descricao: "Duplicata Mercantil" },
  { tPag: "15", descricao: "Boleto Bancário" },
  { tPag: "16", descricao: "Depósito Bancário" },
  { tPag: "17", descricao: "PIX: QR Code Dinâmico" },
  { tPag: "18", descricao: "TED (Transferência Eletrônica Disponível)" },
  { tPag: "19", descricao: "Programa de Fidelidade, Cashback, Crédito Virtual" },
  { tPag: "20", descricao: "PIX: QR Code Estático" },
  { tPag: "21", descricao: "Crédito em Loja" },
  { tPag: "22", descricao: "Pagamento Eletrônico Não Informado" },
  { tPag: "23", descricao: "PIX: Automático" },
  { tPag: "24", descricao: "TEF Book Transfer" },
  { tPag: "90", descricao: "Sem Pagamento" },
  { tPag: "91", descricao: "Pagamento Posterior" },
  { tPag: "99", descricao: "Outros" },
]

const TPAG_SET: ReadonlySet<string> = new Set(TPAG_CATALOGO_OFICIAL.map((e) => e.tPag))

export function isTPagOficial(tPag: string): boolean {
  return TPAG_SET.has(tPag)
}

export function descricaoTPag(tPag: string): string | null {
  return TPAG_CATALOGO_OFICIAL.find((e) => e.tPag === tPag)?.descricao ?? null
}
