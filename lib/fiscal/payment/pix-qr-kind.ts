/**
 * Discriminador fiscal de PIX (`pixQrKind`) — semântica oficial de tPag 17/20/23.
 *
 * Autoridade (nesta ordem), conferida em 19/08/2026:
 *  1. XSD `PL_010e_v1.02/leiauteNFe_v4.00.xsd` — `tPag` = `[0-9]{2}` (sem enum);
 *     o mesmo leiaute vale para NF-e modelo 55 e NFC-e modelo 65.
 *  2. Informe Técnico 2024.002 v1.11 — Portal Nacional da NF-e / ENCAT,
 *     publicação 04/03/2026 (PDF `IT2024.002v1.11-Atualiza-Tabela-Meios-de-Pagamento-04032026`).
 *
 * Significados (não inferir por semelhança de nome com a forma interna `pix`):
 *  - 17 = Pagamento Instantâneo (PIX) – Dinâmico.
 *    IT 2024.002 v1.00 (produção 01/07/2024): o item 17 passou a dizer "Dinâmico"
 *    para separar QR-Code dinâmico de QR-Code estático.
 *  - 20 = Pagamento Instantâneo (PIX) – Estático.
 *    IT 2024.002 v1.00 (produção 01/07/2024): inclusão do item 20.
 *    IT 2024.002 v1.11: observação do 20 = PIX com QR Code estático, ou chave Pix,
 *    ou informações de agência e conta.
 *  - 23 = Pagamento Instantâneo (PIX) – Automático.
 *    IT 2024.002 v1.11: inclusão; teste 02/04/2026, produção 04/05/2026.
 *
 * O cliente observa o discriminador. O servidor deriva o tPag. tPag arbitrário
 * enviado pelo cliente é ignorado.
 *
 * PURO. Sem Prisma, Caixa, Financeiro, PaymentModal ou SEFAZ.
 */

export const PIX_QR_KINDS = ["dinamico", "estatico", "automatico"] as const

export type PixQrKind = (typeof PIX_QR_KINDS)[number]

/** Mapeamento comprovado no catálogo IT 2024.002 v1.11 — não é semelhança de nome. */
export const PIX_QR_KIND_TO_TPAG: Readonly<Record<PixQrKind, "17" | "20" | "23">> = {
  dinamico: "17",
  estatico: "20",
  automatico: "23",
}

export const TPAG_PIX_QR_KIND: Readonly<Record<"17" | "20" | "23", PixQrKind>> = {
  "17": "dinamico",
  "20": "estatico",
  "23": "automatico",
}

const PIX_QR_KIND_SET: ReadonlySet<string> = new Set(PIX_QR_KINDS)

export function isPixQrKind(value: unknown): value is PixQrKind {
  return typeof value === "string" && PIX_QR_KIND_SET.has(value)
}

export function tPagFromPixQrKind(kind: PixQrKind): "17" | "20" | "23" {
  return PIX_QR_KIND_TO_TPAG[kind]
}

/**
 * Rótulos para o operador. A escolha interna é `pixQrKind`; a UI NÃO oferece
 * "17 / 20 / 23" como opção nua.
 *
 * Distinção operacional comprovada no PDV atual: o OmniGestão não gera QR, não
 * integra PSP e o PIX é confirmado manualmente. O operador observa se usou
 * QR/chave/conta fixos da loja ou QR gerado para esta venda.
 * PIX Automático (tPag 23) existe no contrato/servidor, mas NÃO é opção do
 * caixa: o PDV não opera débito recorrente BACEN — oferecê-lo seria enganoso.
 */
export const PIX_QR_KIND_OPCOES_OPERADOR: readonly {
  readonly kind: PixQrKind
  readonly titulo: string
  readonly descricao: string
}[] = [
  {
    kind: "estatico",
    titulo: "QR fixo, chave PIX ou dados da conta da loja",
    descricao:
      "O cliente pagou com o QR da loja, a chave PIX ou agência e conta. O mesmo código serve para várias vendas.",
  },
  {
    kind: "dinamico",
    titulo: "QR gerado agora só para esta venda",
    descricao:
      "Foi gerado um QR ou link com o valor desta venda. Não é o QR fixo nem a chave PIX da loja.",
  },
]
