/**
 * Matriz fail-closed de `cStat` da inutilização. Somente códigos extraídos das fontes oficiais
 * do próprio serviço NFeInutilizacao (MOC 7.0 §5.3 + Anexo I). Sem faixa numérica, sem herança
 * do evento 110111, sem retry automático.
 */

export const INUTILIZACAO_CSTAT_MATRIX_VERSION = "019-INUT.1" as const

export type InutilizacaoCStatKind = "SUCCESS" | "REJECTED"

export type InutilizacaoCStatEntry = {
  readonly cStat: string
  readonly kind: InutilizacaoCStatKind
  readonly rotulo: string
}

const ENTRADAS: readonly InutilizacaoCStatEntry[] = Object.freeze([
  Object.freeze({ cStat: "102", kind: "SUCCESS", rotulo: "Inutilização de número homologado" }),
  Object.freeze({ cStat: "201", kind: "REJECTED", rotulo: "Número máximo de numeração a inutilizar ultrapassou o limite" }),
  Object.freeze({ cStat: "203", kind: "REJECTED", rotulo: "Emissor não habilitado para emissão de NF-e" }),
  Object.freeze({ cStat: "224", kind: "REJECTED", rotulo: "A faixa inicial é maior que a faixa final" }),
  Object.freeze({ cStat: "240", kind: "REJECTED", rotulo: "Cancelamento/Inutilização – Irregularidade Fiscal do Emitente" }),
  Object.freeze({ cStat: "241", kind: "REJECTED", rotulo: "Um número da faixa já foi utilizado" }),
  Object.freeze({ cStat: "250", kind: "REJECTED", rotulo: "UF diverge da UF autorizadora" }),
  Object.freeze({ cStat: "252", kind: "REJECTED", rotulo: "Ambiente informado diverge do Ambiente de recebimento" }),
  Object.freeze({ cStat: "256", kind: "REJECTED", rotulo: "Uma NF-e da faixa já está inutilizada na Base de dados da SEFAZ" }),
  Object.freeze({ cStat: "266", kind: "REJECTED", rotulo: "Série utilizada não permitida no Web Service" }),
  Object.freeze({ cStat: "453", kind: "REJECTED", rotulo: "Ano de inutilização não pode ser superior ao Ano atual" }),
  Object.freeze({ cStat: "454", kind: "REJECTED", rotulo: "Ano de inutilização não pode ser inferior a 2006" }),
  Object.freeze({ cStat: "502", kind: "REJECTED", rotulo: "Campo Id não corresponde à concatenação dos campos correspondentes" }),
  Object.freeze({ cStat: "563", kind: "REJECTED", rotulo: "Já existe pedido de Inutilização com a mesma faixa de inutilização" }),
])

const POR_CSTAT: ReadonlyMap<string, InutilizacaoCStatEntry> = new Map(ENTRADAS.map((e) => [e.cStat, e]))

export function lookupInutilizacaoCStat(cStat: string): InutilizacaoCStatEntry | null {
  return POR_CSTAT.get(cStat) ?? null
}

export const INUTILIZACAO_CSTAT_CONHECIDOS: readonly string[] = Object.freeze(ENTRADAS.map((e) => e.cStat))
