/**
 * Contador HUB · reader fiscal read-only (GOAL 018 · ADR-CONTADOR-007).
 *
 * Opção A: SELECT Prisma side-effect-free sobre `NotaFiscal`.
 * Nunca chama `fiscalXmlReader.readAuthorizedDocument`.
 * Nunca grava FiscalLog, EventoFiscal, NotaFiscal nem qualquer outro model.
 *
 * Flag `CONTADOR_FISCAL_READER` default off (somente o valor exato `"on"` liga).
 * Allowlist de loja env-only (`CONTADOR_FISCAL_READER_STORE_ALLOWLIST`).
 * Ausência / loja fora / config inválida → `nao_disponivel` (nunca “zero notas”).
 *
 * Entregável em 05-XML: predicado ADR-007 (HOMOLOGACAO + dhEmi de xmlAutorizado,
 * sem fallback para dataAutorizacao/createdAt/snapshot/dataEmissao).
 */
import { resolvePeriodoUtc, type Competencia, type PeriodoUtc } from "@/lib/contador/competencia"
import type { ContadorScopeInterno } from "@/lib/contador/scope-core"

export const ENV_CONTADOR_FISCAL_READER = "CONTADOR_FISCAL_READER" as const
export const ENV_CONTADOR_FISCAL_READER_STORE_ALLOWLIST =
  "CONTADOR_FISCAL_READER_STORE_ALLOWLIST" as const
/** Único valor que liga a flag. Qualquer outro (incluindo `"ON"`, `" on "`) permanece off. */
export const CONTADOR_FISCAL_READER_ON = "on" as const

export const STATUS_NOTA_FISCAL = [
  "RASCUNHO",
  "VALIDANDO",
  "ASSINADA",
  "TRANSMITINDO",
  "AUTORIZADA",
  "REJEITADA",
  "DENEGADA",
  "CONTINGENCIA",
  "CANCELADA",
  "INUTILIZADA",
  "ERRO",
] as const
export type StatusNotaFiscalContador = (typeof STATUS_NOTA_FISCAL)[number]

export type MotivoFiscalIndisponivel =
  | "flag_off"
  | "store_nao_allowlisted"
  | "config_invalida"
  | "leitura_falhou"

export type NotaFiscalRow = Readonly<{
  id: string
  storeId: string
  status: string
  ambiente: string
  vigente: boolean
  protocolo: string | null
  chaveAcesso: string | null
  xmlAutorizado: string | null
  cStat: string | null
}>

export type NotaFiscalEntregavel = Readonly<{
  id: string
  storeId: string
  chaveAcesso: string
  xmlAutorizado: string
  dhEmi: string
  protocolo: string
}>

export type NotaFiscalSinal = Readonly<{
  id: string
  storeId: string
  status: string
  cStat: string | null
  motivo: string
}>

export type LeituraFiscalContador = Readonly<{
  disponivel: boolean
  leituraOk: boolean
  motivo: MotivoFiscalIndisponivel | null
  entregaveis: readonly NotaFiscalEntregavel[]
  rejeitadas: readonly NotaFiscalSinal[]
  canceladas: readonly NotaFiscalSinal[]
}>

export type EvidenciaFiscalChecklist = Readonly<{
  leituraOk: boolean
  disponivel: boolean
  motivo: MotivoFiscalIndisponivel | null
  entregaveis: number
  rejeitadas: number
  canceladas: number
}>

export type EvidenciaFiscalPacote = Readonly<{
  disponivel: boolean
  motivo: MotivoFiscalIndisponivel | null
  entregaveis: readonly Pick<NotaFiscalEntregavel, "chaveAcesso" | "xmlAutorizado">[]
}>

type FindManyNotas = (args: Record<string, unknown>) => Promise<NotaFiscalRow[]>

/** Porta mínima injetável — só `findMany`. Sem create/update e sem FiscalLog. */
export type FiscalReaderClient = {
  notaFiscal: { findMany: FindManyNotas }
}

const SELECT_NOTA = {
  id: true,
  storeId: true,
  status: true,
  ambiente: true,
  vigente: true,
  protocolo: true,
  chaveAcesso: true,
  xmlAutorizado: true,
  cStat: true,
} as const

/** Tag `dhEmi` com namespace opcional. Sem flag `g` no módulo — `lastIndex` vaza entre chamadas. */
const DH_EMI_TAG_SOURCE = "<(?:[\\w.]+:)?dhEmi\\s*>([^<]*)</(?:[\\w.]+:)?dhEmi\\s*>"
/**
 * Instante fiscal fail-closed: data+hora com timezone explícito `Z` ou `±HH:MM`.
 * Não completa offset, não assume fuso local, não assume UTC.
 */
const DH_EMI_INSTANT_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})$/
const CHAVE_ARQUIVO_RE = /^[0-9A-Za-z]+$/

function envDe(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  return env
}

/** `true` somente com o valor exato `"on"`. Ausente / `"ON"` / `" on "` = off. */
export function fiscalReaderHabilitado(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return envDe(env)[ENV_CONTADOR_FISCAL_READER] === CONTADOR_FISCAL_READER_ON
}

/**
 * Allowlist env-only, CSV de storeId. `null` = ausente/vazia/inválida
 * (não é lista vazia de lojas — é configuração incompleta).
 */
export function parseStoreAllowlist(
  env: Record<string, string | undefined> = process.env,
): readonly string[] | null {
  const raw = envDe(env)[ENV_CONTADOR_FISCAL_READER_STORE_ALLOWLIST]
  if (typeof raw !== "string") return null
  const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0))]
  return ids.length > 0 ? Object.freeze(ids) : null
}

export function storeAllowlisted(
  storeId: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const allow = parseStoreAllowlist(env)
  if (!allow) return false
  return allow.includes(storeId)
}

export function textoPresente(v: string | null | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0
}

/**
 * Extrai `dhEmi` de `xmlAutorizado` por cardinalidade. Sem fallback.
 * 0 ocorrência → null; 1 ocorrência não vazia → valor; 2+ → null.
 */
export function extractDhEmiFromXml(xml: string): string | null {
  if (typeof xml !== "string" || xml.length === 0) return null
  const matches = [...xml.matchAll(new RegExp(DH_EMI_TAG_SOURCE, "gi"))]
  if (matches.length !== 1) return null
  const raw = matches[0]?.[1]?.trim() ?? ""
  return raw.length > 0 ? raw : null
}

/**
 * Instante fiscal. Exige timezone explícito (`Z` ou `±HH:MM`).
 * Datetime sem offset, data nua e texto inválido → `null`.
 */
export function parseDhEmiInstant(raw: string): Date | null {
  if (!textoPresente(raw)) return null
  const trimmed = raw.trim()
  if (!DH_EMI_INSTANT_RE.test(trimmed)) return null
  const d = new Date(trimmed)
  if (Number.isNaN(d.getTime())) return null
  return d
}

export function dhEmiNoPeriodo(dhEmi: Date, periodo: PeriodoUtc): boolean {
  return dhEmi >= periodo.inicio && dhEmi < periodo.fimExclusivo
}

export function chaveAcessoArquivoValida(chave: string): boolean {
  return CHAVE_ARQUIVO_RE.test(chave) && !chave.includes("..")
}

function leituraIndisponivel(motivo: MotivoFiscalIndisponivel): LeituraFiscalContador {
  return Object.freeze({
    disponivel: false,
    leituraOk: motivo !== "leitura_falhou",
    motivo,
    entregaveis: Object.freeze([]),
    rejeitadas: Object.freeze([]),
    canceladas: Object.freeze([]),
  })
}

/**
 * Gate de acesso: flag exata `"on"` + allowlist válida + storeId na lista.
 * Não consulta Prisma quando o gate falha.
 */
export function resolverAcessoFiscal(
  storeId: string,
  env: Record<string, string | undefined> = process.env,
): { ok: true } | { ok: false; motivo: MotivoFiscalIndisponivel } {
  if (!fiscalReaderHabilitado(env)) return { ok: false, motivo: "flag_off" }
  const allow = parseStoreAllowlist(env)
  if (!allow) return { ok: false, motivo: "config_invalida" }
  if (!allow.includes(storeId)) return { ok: false, motivo: "store_nao_allowlisted" }
  return { ok: true }
}

export type AvaliacaoEntregavel = Readonly<{
  entregavel: boolean
  dhEmi: string | null
  dhEmiDate: Date | null
}>

/** Predicado ADR-007. `allowlist` já foi conferida pelo caller. */
export function avaliarEntregavel(
  row: NotaFiscalRow,
  scopeStoreId: string,
  periodo: PeriodoUtc,
): AvaliacaoEntregavel {
  const dhEmi = textoPresente(row.xmlAutorizado) ? extractDhEmiFromXml(row.xmlAutorizado) : null
  const dhEmiDate = dhEmi ? parseDhEmiInstant(dhEmi) : null
  const entregavel =
    row.storeId === scopeStoreId &&
    row.vigente === true &&
    row.status === "AUTORIZADA" &&
    row.ambiente === "HOMOLOGACAO" &&
    textoPresente(row.protocolo) &&
    textoPresente(row.chaveAcesso) &&
    chaveAcessoArquivoValida(row.chaveAcesso.trim()) &&
    textoPresente(row.xmlAutorizado) &&
    dhEmi !== null &&
    dhEmiDate !== null &&
    dhEmiNoPeriodo(dhEmiDate, periodo)
  return Object.freeze({ entregavel, dhEmi, dhEmiDate })
}

/**
 * Sinal de rejeitada/cancelada na competência: somente com exatamente um
 * `dhEmi` válido (offset explícito) dentro do período. Sem data fiscal válida
 * o documento não é atribuído ao mês consultado — não há fallback para
 * `dataAutorizacao`, `createdAt` ou outra coluna.
 */
export function visivelComoSinalNaCompetencia(row: NotaFiscalRow, periodo: PeriodoUtc): boolean {
  if (!textoPresente(row.xmlAutorizado)) return false
  const dh = extractDhEmiFromXml(row.xmlAutorizado)
  const d = dh ? parseDhEmiInstant(dh) : null
  if (!d) return false
  return dhEmiNoPeriodo(d, periodo)
}

export function classificarNotasFiscais(
  rows: readonly NotaFiscalRow[],
  scopeStoreId: string,
  periodo: PeriodoUtc,
): Pick<LeituraFiscalContador, "entregaveis" | "rejeitadas" | "canceladas"> {
  const entregaveis: NotaFiscalEntregavel[] = []
  const rejeitadas: NotaFiscalSinal[] = []
  const canceladas: NotaFiscalSinal[] = []

  for (const row of rows) {
    if (row.storeId !== scopeStoreId) continue
    const av = avaliarEntregavel(row, scopeStoreId, periodo)
    if (av.entregavel && av.dhEmi && textoPresente(row.chaveAcesso) && textoPresente(row.protocolo) && textoPresente(row.xmlAutorizado)) {
      entregaveis.push(
        Object.freeze({
          id: row.id,
          storeId: row.storeId,
          chaveAcesso: row.chaveAcesso.trim(),
          xmlAutorizado: row.xmlAutorizado,
          dhEmi: av.dhEmi,
          protocolo: row.protocolo.trim(),
        }),
      )
      continue
    }
    if (row.status === "REJEITADA" && visivelComoSinalNaCompetencia(row, periodo)) {
      rejeitadas.push(
        Object.freeze({
          id: row.id,
          storeId: row.storeId,
          status: row.status,
          cStat: row.cStat,
          motivo: row.cStat === "110" ? "REJEITADA (cStat 110 persistido; não entra em 05-XML)" : "REJEITADA (não entra em 05-XML)",
        }),
      )
      continue
    }
    if (row.status === "CANCELADA" && visivelComoSinalNaCompetencia(row, periodo)) {
      canceladas.push(
        Object.freeze({
          id: row.id,
          storeId: row.storeId,
          status: row.status,
          cStat: row.cStat,
          motivo: "CANCELADA (fora de 05-XML nesta fase)",
        }),
      )
    }
  }

  entregaveis.sort((a, b) => a.chaveAcesso.localeCompare(b.chaveAcesso))
  rejeitadas.sort((a, b) => a.id.localeCompare(b.id))
  canceladas.sort((a, b) => a.id.localeCompare(b.id))

  return {
    entregaveis: Object.freeze(entregaveis),
    rejeitadas: Object.freeze(rejeitadas),
    canceladas: Object.freeze(canceladas),
  }
}

export function toEvidenciaChecklist(leitura: LeituraFiscalContador): EvidenciaFiscalChecklist {
  return Object.freeze({
    leituraOk: leitura.leituraOk,
    disponivel: leitura.disponivel,
    motivo: leitura.motivo,
    entregaveis: leitura.entregaveis.length,
    rejeitadas: leitura.rejeitadas.length,
    canceladas: leitura.canceladas.length,
  })
}

export function toEvidenciaPacote(leitura: LeituraFiscalContador): EvidenciaFiscalPacote {
  return Object.freeze({
    disponivel: leitura.disponivel,
    motivo: leitura.motivo,
    entregaveis: Object.freeze(
      leitura.entregaveis.map((e) =>
        Object.freeze({ chaveAcesso: e.chaveAcesso, xmlAutorizado: e.xmlAutorizado }),
      ),
    ),
  })
}

export type LerNotasFiscaisOpts = Readonly<{
  env?: Record<string, string | undefined>
  cliente?: FiscalReaderClient
  periodo?: PeriodoUtc
}>

/**
 * SELECT read-only. Falha de leitura → `leitura_falhou`, nunca zero notas.
 * Isolamento: `where: { storeId: scope.storeId }` apenas.
 */
export async function lerNotasFiscais(
  scope: ContadorScopeInterno,
  competencia: Competencia,
  opts: LerNotasFiscaisOpts = {},
): Promise<LeituraFiscalContador> {
  const env = opts.env ?? process.env
  const acesso = resolverAcessoFiscal(scope.storeId, env)
  if (!acesso.ok) return leituraIndisponivel(acesso.motivo)

  const periodo = opts.periodo ?? resolvePeriodoUtc(competencia)
  let cliente = opts.cliente
  if (!cliente) {
    const { prisma, prismaEnsureConnected } = await import("@/lib/prisma")
    await prismaEnsureConnected()
    cliente = prisma as unknown as FiscalReaderClient
  }

  try {
    const rows = await cliente.notaFiscal.findMany({
      where: { storeId: scope.storeId },
      select: SELECT_NOTA,
    })
    const classif = classificarNotasFiscais(rows, scope.storeId, periodo)
    return Object.freeze({
      disponivel: true,
      leituraOk: true,
      motivo: null,
      ...classif,
    })
  } catch {
    return leituraIndisponivel("leitura_falhou")
  }
}

export function mensagemFiscalIndisponivel(motivo: MotivoFiscalIndisponivel | null | undefined): string {
  switch (motivo) {
    case "flag_off":
      return "Leitura fiscal desligada (CONTADOR_FISCAL_READER ≠ on). A fonte não foi consultada — isto não significa zero notas."
    case "store_nao_allowlisted":
      return "A loja ativa não está na allowlist CONTADOR_FISCAL_READER_STORE_ALLOWLIST. A fonte não foi consultada — isto não significa zero notas."
    case "config_invalida":
      return "CONTADOR_FISCAL_READER=on exige allowlist env-only não vazia. Configuração inválida — fonte não consultada (não é zero notas)."
    case "leitura_falhou":
      return "A leitura fiscal falhou. O estado não foi substituído por zero XML."
    default:
      return "Fonte fiscal indisponível (CONTADOR_FISCAL_READER). Não consultada nesta fase."
  }
}
