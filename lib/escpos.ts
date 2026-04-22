/**
 * Montagem de buffers ESC/POS (Epson/compatíveis).
 * Texto em Windows-1252 via `ESC t 16` (comum em TM-T20/TM-T88).
 */

export const ESC = 0x1b
export const GS = 0x1d
export const LF = 0x0a

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let len = 0
  for (const p of parts) len += p.length
  const out = new Uint8Array(len)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** Bytes Latin-1 / CP1252 subset (acentos PT). */
export function textWin1252(s: string): Uint8Array {
  const b: number[] = []
  for (const ch of s) {
    const u = ch.codePointAt(0)!
    if (u === 0x20ac) {
      b.push(0x80)
      continue
    }
    if (u < 256) b.push(u)
    else b.push(0x3f)
  }
  return new Uint8Array(b)
}

export function line(s: string): Uint8Array {
  return concatBytes(textWin1252(s), new Uint8Array([LF]))
}

/** ESC @ init, ESC t 16 = WPC1252 (Epson). */
export function escposInit(): Uint8Array {
  return new Uint8Array([ESC, 0x40, ESC, 0x74, 16])
}

export function escposAlign(n: 0 | 1 | 2): Uint8Array {
  return new Uint8Array([ESC, 0x61, n])
}

export function escposBold(on: boolean): Uint8Array {
  return new Uint8Array([ESC, 0x45, on ? 1 : 0])
}

export function escposFeed(n: number): Uint8Array {
  return new Uint8Array([ESC, 0x64, Math.min(255, Math.max(0, n))])
}

/** Corte completo (GS V 0). */
export function escposCutFull(): Uint8Array {
  return new Uint8Array([GS, 0x56, 0x00])
}

const SEP = "--------------------------------"

export type PdvReceiptInput = {
  nomeFantasia: string
  cnpj: string
  enderecoLinha?: string
  /** Rodapé por unidade (ex.: StoreSettings.receiptFooter). */
  receiptFooter?: string
  itens: Array<{ name: string; quantity: number; unitPrice: number; lineTotal: number }>
  subtotal: number
  taxes: number
  discount: number
  total: number
  dataHora: string
}

export function buildPdvReceiptEscPos(input: PdvReceiptInput): Uint8Array {
  const br = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
  const parts: Uint8Array[] = []

  parts.push(escposInit())
  parts.push(escposAlign(1))
  parts.push(escposBold(true))
  parts.push(line(input.nomeFantasia))
  parts.push(escposBold(false))
  parts.push(line(`CNPJ: ${input.cnpj}`))
  if (input.enderecoLinha?.trim()) {
    parts.push(line(input.enderecoLinha.trim()))
  }
  parts.push(line(input.dataHora))
  parts.push(line(SEP))
  parts.push(escposAlign(0))

  for (const it of input.itens) {
    const titulo = `${it.quantity}x ${it.name}`.slice(0, 40)
    parts.push(line(titulo))
    parts.push(line(`   ${br.format(it.lineTotal)}`))
  }

  parts.push(line(SEP))
  parts.push(line(`Subtotal: ${br.format(input.subtotal)}`))
  if (input.taxes > 0) parts.push(line(`Impostos (estimado): ${br.format(input.taxes)}`))
  if (input.discount > 0) parts.push(line(`Desconto: ${br.format(input.discount)}`))
  parts.push(escposBold(true))
  parts.push(line(`Valor final pago: ${br.format(input.total)}`))
  parts.push(escposBold(false))
  parts.push(line(""))
  const footer = (input.receiptFooter || "").trim()
  if (footer) {
    for (const ln of footer.split(/\r?\n/)) {
      const t = ln.trim()
      if (t) parts.push(line(t.slice(0, 48)))
    }
    parts.push(line(""))
  }
  parts.push(line("Obrigado!"))
  parts.push(escposFeed(3))
  parts.push(escposCutFull())

  return concatBytes(...parts)
}

export type OsTicketInput = {
  os: {
    numero: string
    cliente: { nome: string; telefone: string }
    aparelho: { marca: string; modelo: string; cor: string }
    defeito: string
    solucao: string
    status: string
    dataEntrada: string
    horaEntrada: string
    valorServico: number
    valorPecas: number
  }
  nomeFantasia: string
  cnpj: string
  enderecoLinha?: string
  labelGarantia?: string
}

export function buildOsTicketEscPos(input: OsTicketInput): Uint8Array {
  const br = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
  const { os } = input
  const total = os.valorServico + os.valorPecas
  const parts: Uint8Array[] = []

  parts.push(escposInit())
  parts.push(escposAlign(1))
  parts.push(escposBold(true))
  parts.push(line("ORDEM DE SERVICO"))
  parts.push(escposBold(false))
  parts.push(line(input.nomeFantasia))
  parts.push(line(`CNPJ: ${input.cnpj}`))
  if (input.enderecoLinha?.trim()) {
    parts.push(line(input.enderecoLinha.trim()))
  }
  parts.push(line(SEP))
  parts.push(escposAlign(0))
  parts.push(escposBold(true))
  parts.push(line(os.numero))
  parts.push(escposBold(false))
  parts.push(line(`Data: ${os.dataEntrada} ${os.horaEntrada}`))
  parts.push(line(`Cliente: ${os.cliente.nome}`))
  if (os.cliente.telefone?.trim()) {
    parts.push(line(`Tel: ${os.cliente.telefone}`))
  }
  parts.push(line(SEP))
  parts.push(line(`Aparelho: ${os.aparelho.marca} ${os.aparelho.modelo}`))
  if (os.aparelho.cor?.trim()) parts.push(line(`Cor: ${os.aparelho.cor}`))
  parts.push(line(`Defeito: ${os.defeito.slice(0, 120)}`))
  if (os.solucao?.trim()) {
    parts.push(line(`Solucao: ${os.solucao.slice(0, 120)}`))
  }
  parts.push(line(SEP))
  parts.push(line(`Servico: ${br.format(os.valorServico)}`))
  parts.push(line(`Pecas: ${br.format(os.valorPecas)}`))
  parts.push(escposBold(true))
  parts.push(line(`TOTAL: ${br.format(total)}`))
  parts.push(escposBold(false))
  if (input.labelGarantia?.trim()) {
    parts.push(line(""))
    parts.push(line(`Garantia: ${input.labelGarantia.slice(0, 200)}`))
  }
  parts.push(line(""))
  parts.push(line(`Status: ${os.status.replace(/_/g, " ")}`))
  parts.push(escposFeed(3))
  parts.push(escposCutFull())

  return concatBytes(...parts)
}

export type ValeTrocaEscPosInput = {
  nomeFantasia?: string
  nomeCliente: string
  cpfCliente: string
  valorCredito: number
  dataLabel: string
  devolucaoId: string
}

/** Comprovante 80mm: crédito em haver / vale-troca. */
export function buildValeTrocaEscPos(input: ValeTrocaEscPosInput): Uint8Array {
  const br = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
  const parts: Uint8Array[] = []
  parts.push(escposInit())
  parts.push(escposAlign(1))
  parts.push(escposBold(true))
  parts.push(line("COMPROVANTE VALE-TROCA"))
  parts.push(escposBold(false))
  if (input.nomeFantasia?.trim()) {
    parts.push(line(input.nomeFantasia.trim().slice(0, 40)))
  }
  parts.push(line(SEP))
  parts.push(escposAlign(0))
  parts.push(line(`Cliente: ${input.nomeCliente.slice(0, 36)}`))
  parts.push(line(`CPF/CNPJ: ${input.cpfCliente.slice(0, 20)}`))
  parts.push(escposBold(true))
  parts.push(line(`Credito: ${br.format(input.valorCredito)}`))
  parts.push(escposBold(false))
  parts.push(line(`Data: ${input.dataLabel}`))
  parts.push(line(`ID devolucao:`))
  parts.push(line(input.devolucaoId.slice(0, 42)))
  parts.push(line(""))
  parts.push(line("Use em compras futuras no PDV"))
  parts.push(line("(pagamento Crédito/Vale)."))
  parts.push(escposFeed(3))
  parts.push(escposCutFull())
  return concatBytes(...parts)
}
