/**
 * Contador HUB · Portal externo read-only — trilha de auditoria (GOAL 015).
 *
 * Montador e repo PRÓPRIOS do portal — NÃO reusa `montarEventoContador` do GOAL 014
 * por dois motivos estruturais:
 *  - o montador da auth-externa fixa `competenciaId: null` e fecha a união de tipos
 *    em eventos de identidade; os eventos do portal são de DOMÍNIO e precisam de
 *    `competenciaId` preenchido quando aplicável;
 *  - a allowlist de metadata do 014 é restrita à identidade — a do portal é própria.
 *
 * Invariantes (mesma disciplina do 014):
 *  - `atorTipo` SEMPRE "externo"; `atorId` = id técnico do usuário externo (nunca
 *    e-mail/nome) — ele identifica o próprio contador, então não é pseudonimizado;
 *  - `ip` recebe SOMENTE `hashIpExterno` (sha256 salgado truncado, 16 hex) e
 *    `userAgent` SOMENTE `resumirUserAgent` (≤200 chars) — IP bruto NUNCA;
 *  - metadata saneada por ALLOWLIST + primitivos — nunca texto de comentário,
 *    `storageRef`, URL assinada, token ou segredo;
 *  - `ContadorEvento` é append-only: este módulo só cria linhas.
 */
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import type { ContadorScopeExterno } from "@/lib/contador/auth-externa/escopo-externo"
import { hashIpExterno, resumirUserAgent } from "@/lib/contador/auth-externa/sessao"

export const ORIGEM_PORTAL = "contador.portal" as const
export const ATOR_TIPO_EXTERNO = "externo" as const

/** Eventos que o portal grava — união fechada, nada fora desta lista. */
export const EVENTOS_PORTAL = [
  "documento_download_autorizado",
  "pacote_baixado",
  "pacote_recebimento_confirmado",
  "comentario_criado",
  "status_alterado",
] as const

export type TipoEventoPortal = (typeof EVENTOS_PORTAL)[number]

export const EVENTO_PORTAL_DOCUMENTO_DOWNLOAD = "documento_download_autorizado" as const
export const EVENTO_PORTAL_PACOTE_BAIXADO = "pacote_baixado" as const
export const EVENTO_PORTAL_PACOTE_RECEBIDO = "pacote_recebimento_confirmado" as const
export const EVENTO_PORTAL_COMENTARIO = "comentario_criado" as const
export const EVENTO_PORTAL_STATUS = "status_alterado" as const

/**
 * Allowlist de chaves de metadata dos eventos do portal. Tudo fora da lista é
 * DESCARTADO — é assim que texto livre, `storageRef`, URL assinada ou qualquer
 * campo inventado no futuro morrem aqui. IDs técnicos trafegam em
 * `entidade`/`entidadeId`, não na metadata.
 */
const CHAVES_METADATA_PORTAL: ReadonlySet<string> = new Set([
  "acao",
  "bytes",
  "categoria",
  "competencia",
  "expiresInSec",
  "manifestoHash",
  "statusAnterior",
  "statusNovo",
  "textoLen",
  "versao",
  "visibilidade",
])

const MAX_STRING_METADATA = 120

/**
 * Saneia metadata por allowlist + tipos primitivos. Strings são truncadas;
 * objetos/arrays são descartados (metadata é plana e mínima).
 */
export function sanearMetadataPortal(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, string | number | boolean> | null {
  if (!metadata) return null
  const limpa: Record<string, string | number | boolean> = {}
  for (const [chave, valor] of Object.entries(metadata)) {
    if (!CHAVES_METADATA_PORTAL.has(chave)) continue
    if (typeof valor === "string") limpa[chave] = valor.slice(0, MAX_STRING_METADATA)
    else if (typeof valor === "number" || typeof valor === "boolean") limpa[chave] = valor
    // qualquer outro tipo (objeto, array, null, undefined, Date) é descartado
  }
  return Object.keys(limpa).length > 0 ? limpa : null
}

/** Linha de `ContadorEvento` pronta para `create` (camada portal). */
export type NovoEventoPortal = Readonly<{
  storeId: string
  competenciaId: string | null
  tipo: TipoEventoPortal
  atorTipo: typeof ATOR_TIPO_EXTERNO
  atorId: string
  entidade: string | null
  entidadeId: string | null
  origem: string
  metadata: Record<string, string | number | boolean> | null
  /** sha256 salgado truncado (16 hex) — NUNCA o IP bruto. */
  ip: string | null
  /** UA truncado (≤200 chars). */
  userAgent: string | null
}>

/** Contexto da request externa: escopo já validado + IP/UA crus (minimizados aqui). */
export type ContextoAtorPortal = Readonly<{
  escopo: ContadorScopeExterno
  ip?: string | null
  userAgent?: string | null
}>

/** Ator já minimizado: id técnico externo + ipHash + UA resumido. */
export type AtorPortal = Readonly<{
  atorId: string
  ipHash: string | null
  userAgentResumo: string | null
}>

/** Resolve o ator do evento aplicando a minimização (§15 — IP/UA nunca crus). */
export async function resolverAtorPortal(ctx: ContextoAtorPortal): Promise<AtorPortal> {
  return Object.freeze({
    atorId: ctx.escopo.usuario.id,
    ipHash: ctx.ip ? await hashIpExterno(ctx.ip) : null,
    userAgentResumo: resumirUserAgent(ctx.userAgent),
  })
}

/** Monta a linha do evento já saneada. Puro — a persistência é do repo abaixo. */
export function montarEventoPortal(
  args: Readonly<{
    escopo: ContadorScopeExterno
    ator: AtorPortal
    competenciaId: string | null
    tipo: TipoEventoPortal
    entidade?: string | null
    entidadeId?: string | null
    metadata?: Record<string, unknown> | null
  }>,
): NovoEventoPortal {
  return Object.freeze({
    storeId: args.escopo.storeId,
    competenciaId: args.competenciaId,
    tipo: args.tipo,
    atorTipo: ATOR_TIPO_EXTERNO,
    atorId: args.ator.atorId,
    entidade: args.entidade ?? null,
    entidadeId: args.entidadeId ?? null,
    origem: ORIGEM_PORTAL,
    metadata: sanearMetadataPortal(args.metadata),
    ip: args.ator.ipHash,
    userAgent: args.ator.userAgentResumo,
  })
}

/* ───────────────────────────── persistência ───────────────────────────── */

/** Porta mínima do Prisma (mesmo padrão injetável dos demais repos do HUB). */
export interface PortalEventosDbClient {
  contadorEvento: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string; createdAt: Date }>
    findFirst(args: {
      where: Record<string, unknown>
      orderBy?: unknown
    }): Promise<{ id: string; createdAt: Date } | null>
  }
}

export interface PortalEventosRepo {
  /**
   * Grava o evento (append-only) e devolve o `createdAt` DA TRILHA — o instante
   * oficial é o do banco, não o relógio da rota (é o que torna a confirmação de
   * recebimento literalmente idempotente na resposta).
   */
  registrarEvento(evento: NovoEventoPortal): Promise<{ criadoEm: Date }>
  /**
   * Dedupe da confirmação de recebimento: o evento existente prova a confirmação
   * anterior por (storeId, competenciaId, atorId externo, versao) — sem tabela nova.
   */
  acharRecebimentoPacote(
    args: Readonly<{
      storeId: string
      competenciaId: string
      atorId: string
      versao: number
    }>,
  ): Promise<{ criadoEm: Date } | null>
}

function eventoData(e: NovoEventoPortal): Record<string, unknown> {
  return {
    storeId: e.storeId,
    competenciaId: e.competenciaId,
    tipo: e.tipo,
    atorTipo: e.atorTipo,
    atorId: e.atorId,
    entidade: e.entidade,
    entidadeId: e.entidadeId,
    origem: e.origem,
    metadata: e.metadata,
    ip: e.ip,
    userAgent: e.userAgent,
  }
}

/** Implementação Prisma do `PortalEventosRepo` (cliente injetável nos testes). */
export function criarRepoEventosPortal(client?: PortalEventosDbClient): PortalEventosRepo {
  const obter = async (): Promise<PortalEventosDbClient> => {
    if (client) return client
    await prismaEnsureConnected()
    return prisma as unknown as PortalEventosDbClient
  }

  return {
    async registrarEvento(evento) {
      const db = await obter()
      const row = await db.contadorEvento.create({ data: eventoData(evento) })
      return { criadoEm: row.createdAt }
    },

    async acharRecebimentoPacote({ storeId, competenciaId, atorId, versao }) {
      const db = await obter()
      const row = await db.contadorEvento.findFirst({
        where: {
          tipo: EVENTO_PORTAL_PACOTE_RECEBIDO,
          storeId,
          competenciaId,
          atorId,
          metadata: { path: ["versao"], equals: versao },
        },
        orderBy: { createdAt: "asc" },
      })
      return row ? { criadoEm: row.createdAt } : null
    },
  }
}
