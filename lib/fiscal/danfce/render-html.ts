/**
 * Renderer HTML do DANFC-e para visualização e impressão térmica 58/80 mm no navegador.
 *
 * Consome somente `DanfceModel`. Não lê dados comerciais vivos. Não recalcula QR.
 */

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
import { renderQrSvg } from "./qr-matrix"

function esc(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function consumidorHtml(model: DanfceModel): string {
  if (model.consumidor.kind === "ausente") {
    return `<div class="muted">CONSUMIDOR NÃO IDENTIFICADO</div>`
  }
  if (model.consumidor.kind === "cpf") {
    const nome = model.consumidor.nome ? `<div>${esc(model.consumidor.nome)}</div>` : ""
    return `${nome}<div>CPF: ${esc(formatCpf(model.consumidor.cpf))}</div>`
  }
  const nome = model.consumidor.nome ? `<div>${esc(model.consumidor.nome)}</div>` : ""
  return `${nome}<div>CNPJ: ${esc(formatCnpj(model.consumidor.cnpj))}</div>`
}

export function renderDanfceHtml(model: DanfceModel): string {
  const titulo = model.contingencia && !model.protocolo ? DANFCE_TITULO_CONTINGENCIA : DANFCE_TITULO_AUTORIZADO
  const homologBanner = model.homologacaoSemValorFiscal
    ? `<div class="banner homolog" data-danfce-homologacao="1">${esc(DANFCE_MSG_HOMOLOGACAO)}</div>`
    : ""
  const contingenciaBanner = model.contingencia
    ? `<div class="banner contingencia" data-danfce-contingencia="1">${esc(model.mensagensFiscais.filter((m) => m.includes("CONTINGÊNCIA") || m.includes("protocolo")).join(" · "))}</div>`
    : ""
  const itens = model.itens
    .map(
      (item) => `<tr>
        <td>${esc(item.codigo)}</td>
        <td>${esc(item.descricao)}</td>
        <td class="num">${esc(formatQuantidade(item.quantidade))}</td>
        <td>${esc(item.unidade)}</td>
        <td class="num">${esc(formatMoedaXml(item.valorUnitario))}</td>
        <td class="num">${esc(formatMoedaXml(item.valorTotal))}</td>
      </tr>`,
    )
    .join("")
  const pagamentos = model.pagamentos
    .map((pg) => `<div class="row"><span>${esc(pg.descricao)}</span><span>${esc(formatMoedaXml(pg.valor))}</span></div>`)
    .join("")
  const troco = model.troco
    ? `<div class="row"><span>Troco</span><span>${esc(formatMoedaXml(model.troco))}</span></div>`
    : ""
  const protocolo = model.protocolo
    ? `<div class="row"><span>Protocolo</span><span>${esc(model.protocolo)}</span></div>`
    : `<div class="row" data-danfce-sem-protocolo="1"><span>Protocolo</span><span>não autorizado</span></div>`
  const tributos = model.tributosResumo
    ? `<div class="muted">Trib. aprox. R$ ${esc(formatMoedaXml(model.tributosResumo).replace("R$ ", ""))}</div>`
    : ""
  const infAdic = model.informacoesAdicionais
    ? `<div class="muted">${esc(model.informacoesAdicionais)}</div>`
    : ""

  return `<article class="danfce" data-documento="DANFCE" data-ambiente="${esc(model.ambiente)}" data-tp-emis="${esc(model.tpEmis)}" data-variante="${esc(model.variante)}">
<style>
  .danfce{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:#000;background:#fff}
  .danfce .center{text-align:center}
  .danfce .muted{font-size:10px}
  .danfce .row{display:flex;justify-content:space-between;gap:8px}
  .danfce .sep{border-top:1px dashed #000;margin:6px 0}
  .danfce table{width:100%;border-collapse:collapse;font-size:10px}
  .danfce td.num,.danfce th.num{text-align:right;white-space:nowrap}
  .danfce .banner{border:2px solid #000;font-weight:700;padding:4px;margin:6px 0;text-align:center;letter-spacing:.2px}
  .danfce .banner.homolog{background:#000;color:#fff}
  .danfce .qr{display:flex;justify-content:center;margin:8px 0}
  .danfce .qr svg{width:120px;height:120px}
  .danfce h1{font-size:12px;margin:0 0 4px}
</style>
  <div class="center">
    <h1>${esc(titulo)}</h1>
    <div class="muted">${esc(DANFCE_SUBTITULO)}</div>
    <div style="font-weight:700">${esc(model.emitente.nomeFantasia || model.emitente.razaoSocial)}</div>
    <div>${esc(model.emitente.razaoSocial)}</div>
    <div>CNPJ: ${esc(formatCnpj(model.emitente.cnpj))}${model.emitente.ie ? ` · IE: ${esc(model.emitente.ie)}` : ""}</div>
    <div class="muted">${esc(model.emitente.endereco)}</div>
  </div>
  ${homologBanner}
  ${contingenciaBanner}
  <div class="sep"></div>
  <div class="row"><span>NFC-e nº ${esc(model.numero)}</span><span>Série ${esc(model.serie)}</span></div>
  <div>Emissão: ${esc(formatDhEmi(model.dhEmi))}</div>
  <div class="sep"></div>
  ${consumidorHtml(model)}
  <div class="sep"></div>
  <table>
    <thead><tr><th>Cód</th><th>Item</th><th class="num">Qtd</th><th>Un</th><th class="num">Unit.</th><th class="num">Total</th></tr></thead>
    <tbody>${itens}</tbody>
  </table>
  <div class="muted">Qtd. total de itens: ${esc(model.quantidadeTotalItens)}</div>
  <div class="sep"></div>
  ${model.vDesc ? `<div class="row"><span>Desconto</span><span>${esc(formatMoedaXml(model.vDesc))}</span></div>` : ""}
  <div class="row" style="font-weight:700"><span>VALOR TOTAL</span><span>${esc(formatMoedaXml(model.valorTotal))}</span></div>
  <div class="sep"></div>
  <div style="font-weight:700">Formas de pagamento</div>
  ${pagamentos}
  ${troco}
  ${tributos}
  <div class="sep"></div>
  ${protocolo}
  <div class="center muted">Chave de acesso</div>
  <div class="center" style="font-size:10px;letter-spacing:.4px">${esc(formatChaveAcesso(model.chaveAcesso))}</div>
  <div class="center muted">${esc(model.mensagensFiscais.find((m) => m.startsWith("Consulte pela Chave de Acesso")) ?? `Consulte pela Chave de Acesso em ${model.urlConsulta}`)}</div>
  <div class="qr">${renderQrSvg(model.qrCodeData, 3)}</div>
  <div class="sep"></div>
  ${model.mensagensFiscais.map((m) => `<div class="center" style="font-weight:700">${esc(m)}</div>`).join("")}
  ${infAdic}
</article>`
}
