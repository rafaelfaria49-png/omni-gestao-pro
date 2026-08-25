/**
 * Validação pura do pedido de inutilização NFC-e contra o schema oficial + regras I03/I04/I02b/I02c
 * do MOC 7.0 (NFeInutilizacao). Sem rede, sem relógio implícito, sem retry.
 */

import { montarIdInutilizacao } from "./id"
import {
  INUTILIZACAO_ANO_MINIMO,
  INUTILIZACAO_JUSTIFICATIVA_MAX,
  INUTILIZACAO_JUSTIFICATIVA_MIN,
  INUTILIZACAO_MAX_FAIXA,
  INUTILIZACAO_MODELO_NFCE,
  TAMB_VALUES,
  TANO_PATTERN,
  TCNPJ_PATTERN,
  TCOD_UF_IBGE,
  TNF_PATTERN,
  TSERIE_PATTERN,
  TSTRING_PATTERN,
  type InutilizacaoAmbiente,
  type InutilizacaoIssue,
  type InutilizacaoPedidoInput,
  type InutilizacaoPedidoNormalizado,
  type InutilizacaoValidationResult,
} from "./types"

function issue(code: InutilizacaoIssue["code"], campo: string, mensagem: string): InutilizacaoIssue {
  return { code, campo, mensagem }
}

function asText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  return String(value).trim()
}

function isAmbiente(value: string): value is InutilizacaoAmbiente {
  return (TAMB_VALUES as readonly string[]).includes(value)
}

function isUf(value: string): value is InutilizacaoPedidoNormalizado["cUF"] {
  return (TCOD_UF_IBGE as readonly string[]).includes(value)
}

export function normalizarJustificativa(raw: string): string {
  return String(raw ?? "").trim()
}

export function validateInutilizacaoPedido(input: InutilizacaoPedidoInput): InutilizacaoValidationResult {
  const issues: InutilizacaoIssue[] = []
  const tpAmb = asText(input.tpAmb)
  const cUF = asText(input.cUF)
  const ano = asText(input.ano)
  const cnpj = asText(input.cnpj).toUpperCase()
  const modelo = asText(input.modelo)
  const serie = asText(input.serie)
  const nNFIni = asText(input.nNFIni)
  const nNFFin = asText(input.nNFFin)
  const xJust = normalizarJustificativa(input.xJust)

  if (!tpAmb) issues.push(issue("campo_obrigatorio", "tpAmb", "tpAmb é obrigatório."))
  else if (!isAmbiente(tpAmb)) issues.push(issue("ambiente_invalido", "tpAmb", "tpAmb deve ser 1 (produção) ou 2 (homologação)."))

  if (!cUF) issues.push(issue("campo_obrigatorio", "cUF", "cUF é obrigatório."))
  else if (!isUf(cUF)) issues.push(issue("uf_invalida", "cUF", "cUF não pertence a TCodUfIBGE."))

  if (!ano) issues.push(issue("campo_obrigatorio", "ano", "ano é obrigatório."))
  else if (!TANO_PATTERN.test(ano)) issues.push(issue("ano_invalido", "ano", "ano deve ter 2 dígitos (Tano)."))
  else {
    const anoCheio = 2000 + Number(ano)
    if (anoCheio < INUTILIZACAO_ANO_MINIMO) {
      issues.push(issue("ano_inferior_minimo", "ano", "Ano de inutilização não pode ser inferior a 2006."))
    }
    if (typeof input.anoCalendario === "number" && Number.isFinite(input.anoCalendario) && anoCheio > input.anoCalendario) {
      issues.push(issue("ano_superior_atual", "ano", "Ano de inutilização não pode ser superior ao ano atual."))
    }
  }

  if (!cnpj) issues.push(issue("campo_obrigatorio", "cnpj", "CNPJ é obrigatório."))
  else if (!TCNPJ_PATTERN.test(cnpj)) {
    issues.push(issue("cnpj_invalido", "cnpj", "CNPJ deve satisfazer TCnpj vigente ([0-9A-Z]{12}[0-9]{2})."))
  }

  if (!modelo) issues.push(issue("campo_obrigatorio", "modelo", "modelo é obrigatório."))
  else if (modelo !== INUTILIZACAO_MODELO_NFCE) {
    issues.push(issue("modelo_incompativel", "modelo", "Esta fundação aceita somente NFC-e modelo 65."))
  }

  if (!serie) issues.push(issue("campo_obrigatorio", "serie", "série é obrigatória."))
  else if (!TSERIE_PATTERN.test(serie)) issues.push(issue("serie_invalida", "serie", "série não satisfaz TSerie."))

  if (!nNFIni) issues.push(issue("campo_obrigatorio", "nNFIni", "nNFIni é obrigatório."))
  else if (!TNF_PATTERN.test(nNFIni)) issues.push(issue("numero_invalido", "nNFIni", "nNFIni não satisfaz TNF."))

  if (!nNFFin) issues.push(issue("campo_obrigatorio", "nNFFin", "nNFFin é obrigatório."))
  else if (!TNF_PATTERN.test(nNFFin)) issues.push(issue("numero_invalido", "nNFFin", "nNFFin não satisfaz TNF."))

  const nIni = TNF_PATTERN.test(nNFIni) ? Number(nNFIni) : NaN
  const nFin = TNF_PATTERN.test(nNFFin) ? Number(nNFFin) : NaN
  if (Number.isFinite(nIni) && Number.isFinite(nFin)) {
    if (nIni > nFin) {
      issues.push(issue("intervalo_invalido", "nNFIni", "A faixa inicial é maior que a faixa final."))
    } else if (nFin - nIni + 1 > INUTILIZACAO_MAX_FAIXA) {
      issues.push(
        issue(
          "intervalo_excede_limite",
          "nNFFin",
          `Quantidade máxima a inutilizar é ${INUTILIZACAO_MAX_FAIXA} números.`,
        ),
      )
    }
  }

  if (!xJust) issues.push(issue("campo_obrigatorio", "xJust", "justificativa é obrigatória."))
  else if (xJust.length < INUTILIZACAO_JUSTIFICATIVA_MIN || xJust.length > INUTILIZACAO_JUSTIFICATIVA_MAX) {
    issues.push(
      issue(
        "justificativa_invalida",
        "xJust",
        `justificativa deve ter entre ${INUTILIZACAO_JUSTIFICATIVA_MIN} e ${INUTILIZACAO_JUSTIFICATIVA_MAX} caracteres.`,
      ),
    )
  } else if (!TSTRING_PATTERN.test(xJust)) {
    issues.push(issue("justificativa_invalida", "xJust", "justificativa não satisfaz TJust/TString."))
  }

  if (issues.length > 0) return { ok: false, pedido: null, issues }

  const pedido: InutilizacaoPedidoNormalizado = {
    tpAmb: tpAmb as InutilizacaoAmbiente,
    cUF: cUF as InutilizacaoPedidoNormalizado["cUF"],
    ano,
    cnpj,
    modelo: INUTILIZACAO_MODELO_NFCE,
    serie,
    nNFIni,
    nNFFin,
    nIni,
    nFin,
    xJust,
    id: montarIdInutilizacao({
      cUF,
      ano,
      cnpj,
      modelo: INUTILIZACAO_MODELO_NFCE,
      serie,
      nNFIni,
      nNFFin,
    }),
  }
  return { ok: true, pedido, issues: [] }
}
