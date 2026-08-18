/**
 * Renderer ESC/POS do DANFC-e sobre o stack térmico já existente (`lib/escpos`).
 *
 * Não cria segunda infraestrutura de impressão. QR via comando nativo GS ( k
 * com o `qrCodeData` persistido — sem recalcular payload.
 */

import {
  GS,
  concatBytes,
  escposAlign,
  escposBold,
  escposCutFull,
  escposFeed,
  escposInit,
  line,
} from "@/lib/escpos"
import {
  DANFCE_MSG_HOMOLOGACAO,
  DANFCE_SUBTITULO,
  DANFCE_TITULO_AUTORIZADO,
  DANFCE_TITULO_CONTINGENCIA,
  type DanfceModel,
} from "./types"
import {
  formatChaveAcesso,
  formatCnpj,
  formatCpf,
  formatDhEmi,
  formatMoedaXml,
  formatQuantidade,
} from "./format"

export type DanfceEscPosOptions = {
  readonly maxChars?: number
  readonly qrModuleSize?: number
}

function sepLine(maxChars: number): string {
  return "-".repeat(Math.max(16, Math.min(48, maxChars)))
}

function wrap(text: string, maxChars: number): string[] {
  const raw = text.trim()
  if (raw.length <= maxChars) return [raw]
  const out: string[] = []
  let rest = raw
  while (rest.length > maxChars) {
    out.push(rest.slice(0, maxChars))
    rest = rest.slice(maxChars)
  }
  if (rest) out.push(rest)
  return out
}

function utf8(data: string): Uint8Array {
  return new TextEncoder().encode(data)
}

/** QR Code ESC/POS (Epson GS ( k), conteúdo = bytes persistidos. */
export function escposQrFromPersisted(qrCodeData: string, moduleSize = 4): Uint8Array {
  const payload = utf8(qrCodeData)
  const storeLen = payload.length + 3
  const size = Math.min(16, Math.max(2, moduleSize))
  return concatBytes(
    new Uint8Array([GS, 0x28, 0x6b, 4, 0, 49, 65, 50, 0]),
    new Uint8Array([GS, 0x28, 0x6b, 3, 0, 49, 67, size]),
    new Uint8Array([GS, 0x28, 0x6b, 3, 0, 49, 69, 49]),
    new Uint8Array([GS, 0x28, 0x6b, storeLen & 0xff, (storeLen >> 8) & 0xff, 49, 80, 48]),
    payload,
    new Uint8Array([GS, 0x28, 0x6b, 3, 0, 49, 81, 48]),
  )
}

export function renderDanfceEscPos(model: DanfceModel, opts?: DanfceEscPosOptions): Uint8Array {
  const maxChars = opts?.maxChars ?? 48
  const sep = sepLine(maxChars)
  const parts: Uint8Array[] = []
  const titulo = model.contingencia && !model.protocolo ? DANFCE_TITULO_CONTINGENCIA : DANFCE_TITULO_AUTORIZADO

  parts.push(escposInit())
  parts.push(escposAlign(1))
  parts.push(escposBold(true))
  parts.push(line(titulo))
  parts.push(escposBold(false))
  for (const chunk of wrap(DANFCE_SUBTITULO, maxChars)) parts.push(line(chunk))
  parts.push(line(model.emitente.nomeFantasia || model.emitente.razaoSocial))
  parts.push(line(model.emitente.razaoSocial))
  parts.push(line(`CNPJ: ${formatCnpj(model.emitente.cnpj)}`))
  if (model.emitente.ie) parts.push(line(`IE: ${model.emitente.ie}`))
  for (const chunk of wrap(model.emitente.endereco, maxChars)) parts.push(line(chunk))

  if (model.homologacaoSemValorFiscal) {
    parts.push(line(sep))
    parts.push(escposBold(true))
    for (const chunk of wrap(DANFCE_MSG_HOMOLOGACAO, maxChars)) parts.push(line(chunk))
    parts.push(escposBold(false))
  }
  if (model.contingencia) {
    parts.push(escposBold(true))
    for (const msg of model.mensagensFiscais.filter((m) => m.includes("CONTINGÊNCIA") || m.includes("protocolo"))) {
      for (const chunk of wrap(msg, maxChars)) parts.push(line(chunk))
    }
    parts.push(escposBold(false))
  }

  parts.push(line(sep))
  parts.push(escposAlign(0))
  parts.push(line(`NFC-e ${model.numero}  Serie ${model.serie}`))
  parts.push(line(`Emissao: ${formatDhEmi(model.dhEmi)}`))
  parts.push(line(sep))

  if (model.consumidor.kind === "ausente") {
    parts.push(line("CONSUMIDOR NAO IDENTIFICADO"))
  } else if (model.consumidor.kind === "cpf") {
    if (model.consumidor.nome) parts.push(line(model.consumidor.nome.slice(0, maxChars)))
    parts.push(line(`CPF: ${formatCpf(model.consumidor.cpf)}`))
  } else {
    if (model.consumidor.nome) parts.push(line(model.consumidor.nome.slice(0, maxChars)))
    parts.push(line(`CNPJ: ${formatCnpj(model.consumidor.cnpj)}`))
  }

  parts.push(line(sep))
  for (const item of model.itens) {
    parts.push(line(`${item.codigo} ${item.descricao}`.slice(0, maxChars)))
    parts.push(
      line(
        `${formatQuantidade(item.quantidade)} ${item.unidade} x ${formatMoedaXml(item.valorUnitario)} = ${formatMoedaXml(item.valorTotal)}`.slice(
          0,
          maxChars,
        ),
      ),
    )
  }
  parts.push(line(`Qtd total itens: ${model.quantidadeTotalItens}`))
  parts.push(line(sep))
  if (model.vDesc) parts.push(line(`Desconto: ${formatMoedaXml(model.vDesc)}`))
  parts.push(escposBold(true))
  parts.push(line(`TOTAL: ${formatMoedaXml(model.valorTotal)}`))
  parts.push(escposBold(false))
  parts.push(line("Pagamento:"))
  for (const pg of model.pagamentos) {
    parts.push(line(`  ${pg.descricao}: ${formatMoedaXml(pg.valor)}`.slice(0, maxChars)))
  }
  if (model.troco) parts.push(line(`Troco: ${formatMoedaXml(model.troco)}`))
  if (model.tributosResumo) parts.push(line(`Trib. aprox.: ${formatMoedaXml(model.tributosResumo)}`))
  parts.push(line(sep))
  if (model.protocolo) parts.push(line(`Protocolo: ${model.protocolo}`))
  else parts.push(line("Protocolo: nao autorizado"))
  parts.push(escposAlign(1))
  parts.push(line("Chave de acesso"))
  const chave = formatChaveAcesso(model.chaveAcesso)
  for (const chunk of wrap(chave, maxChars)) parts.push(line(chunk))
  parts.push(escposQrFromPersisted(model.qrCodeData, opts?.qrModuleSize ?? (maxChars <= 32 ? 3 : 4)))
  parts.push(line("Consulte pela Chave de Acesso em"))
  for (const chunk of wrap(model.urlConsulta, maxChars)) parts.push(line(chunk))
  parts.push(line(sep))
  for (const msg of model.mensagensFiscais) {
    for (const chunk of wrap(msg, maxChars)) parts.push(line(chunk))
  }
  parts.push(escposFeed(3))
  parts.push(escposCutFull())
  return concatBytes(...parts)
}
