/**
 * Contador HUB · Identidade externa — auditoria (GOAL 014, §E da proposta).
 *
 * Dois canais:
 *  - E.1 `ContadorEvento` (DB, append-only): eventos COM loja. `competenciaId` NULL,
 *    `atorTipo` "interno"|"externo", ator = ID técnico (nunca e-mail/nome),
 *    `ip`/`userAgent` preenchidos só com valores MINIMIZADOS (ipHash / UA resumido),
 *    metadata saneada por ALLOWLIST — nunca token, e-mail ou segredo.
 *  - E.2 log estruturado JSON de 1 linha (padrão `legacy-session.ts`): eventos de
 *    identidade sem loja natural (login/logout/falha/expiração/rate limit).
 */
import type { EventoContadorRow } from "./tipos"

/* ───────────────────────────── E.1 · ContadorEvento ───────────────────────────── */

/** Eventos E.1 da proposta — união fechada, nada fora desta lista é gravado. */
export const EVENTOS_ACESSO_EXTERNO = [
  "convite_criado",
  "convite_revogado",
  "convite_expirado",
  "convite_aceito",
  "acesso_concedido",
  "acesso_suspenso",
  "acesso_reativado",
  "acesso_revogado",
  "usuario_suspenso",
  "usuario_reativado",
  "sessao_revogada",
] as const

export type TipoEventoAcessoExterno = (typeof EVENTOS_ACESSO_EXTERNO)[number]

/**
 * Ator técnico de tentativas externas ANÔNIMAS (ex.: uso de convite expirado).
 * ID técnico constante — nunca e-mail, nome ou IP.
 */
export const ATOR_EXTERNO_ANONIMO = "externo:anonimo"

/**
 * Allowlist de chaves de metadata. Tudo fora da lista é DESCARTADO — é assim que
 * e-mail, token, senha ou qualquer campo novo inventado no futuro morrem aqui.
 * IDs técnicos trafegam em `entidade`/`entidadeId`, não na metadata.
 */
const CHAVES_METADATA_PERMITIDAS: ReadonlySet<string> = new Set([
  "papel",
  "motivo",
  "statusAnterior",
  "statusNovo",
  "expiraEm",
  "concedidoEm",
])

const MAX_STRING_METADATA = 120

/**
 * Saneia metadata por allowlist + tipos primitivos. Strings permitidas são
 * truncadas; objetos/arrays são descartados (metadata é plana e mínima).
 */
export function sanearMetadataEvento(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null
  const limpa: Record<string, unknown> = {}
  for (const [chave, valor] of Object.entries(metadata)) {
    if (!CHAVES_METADATA_PERMITIDAS.has(chave)) continue
    if (typeof valor === "string") limpa[chave] = valor.slice(0, MAX_STRING_METADATA)
    else if (typeof valor === "number" || typeof valor === "boolean") limpa[chave] = valor
    else if (valor === null) limpa[chave] = null
    // qualquer outro tipo (objeto, array, undefined, Date) é descartado
  }
  return Object.keys(limpa).length > 0 ? limpa : null
}

export type NovoEventoContador = Readonly<{
  storeId: string
  tipo: TipoEventoAcessoExterno
  atorTipo: "interno" | "externo"
  /** ID técnico do ator (AdminUser.id ou ContadorUsuario.id) — NUNCA e-mail/nome. */
  atorId: string
  entidade?: string | null
  entidadeId?: string | null
  origem?: string | null
  metadata?: Record<string, unknown> | null
  /** sha256 salgado truncado (16 hex) — NUNCA o IP bruto. */
  ipHash?: string | null
  /** UA truncado (≤200 chars). */
  userAgentResumo?: string | null
}>

/** Monta a linha E.1 já saneada e com `competenciaId` NULL (evento sem competência). */
export function montarEventoContador(evento: NovoEventoContador): EventoContadorRow {
  return Object.freeze({
    storeId: evento.storeId,
    competenciaId: null,
    tipo: evento.tipo,
    atorTipo: evento.atorTipo,
    atorId: evento.atorId,
    entidade: evento.entidade ?? null,
    entidadeId: evento.entidadeId ?? null,
    origem: evento.origem ?? "auth-externa",
    metadata: sanearMetadataEvento(evento.metadata),
    ip: evento.ipHash ?? null,
    userAgent: evento.userAgentResumo ?? null,
  })
}

/* ───────────────────── E.2 · log JSON de 1 linha (sem loja) ───────────────────── */

export type EventoLogExterno =
  | "login_externo_sucesso"
  | "login_externo_falha"
  | "logout_externo"
  | "sessao_externa_expirada"
  | "rate_limit_externo"

export type CamposLogExterno = Readonly<{
  ipHash?: string | null
  motivo?: string
  path?: string
}>

/**
 * Log estruturado (JSON de uma linha). NUNCA inclui e-mail, token, cookie, senha
 * ou IP bruto — só `ipHash`, `motivo` (rótulo curto) e `path`.
 */
export function logEventoExterno(evento: EventoLogExterno, campos: CamposLogExterno = {}): void {
  try {
    console.log(
      JSON.stringify({
        evento,
        timestamp: new Date().toISOString(),
        ...(campos.ipHash ? { ipHash: campos.ipHash } : {}),
        ...(campos.motivo ? { motivo: campos.motivo } : {}),
        ...(campos.path ? { path: campos.path } : {}),
      }),
    )
  } catch {
    console.log(evento)
  }
}
