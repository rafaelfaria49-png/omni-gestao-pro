/**
 * Contador HUB · Identidade externa — convites de vínculo (GOAL 014, §C da proposta).
 *
 * - Token = 32 bytes criptográficos (Web Crypto), base64url, retornado UMA única vez
 *   na criação. O banco guarda SOMENTE o sha256 hex (`tokenHash`); o token bruto
 *   NUNCA é persistido nem logado (§15).
 * - Criar convite revoga o convite aberto anterior do mesmo (email, storeId) na
 *   mesma transação (o índice parcial único da 0015 veda a corrida).
 * - Aceite transacional: update condicional atômico — `count == 1` é a única
 *   vitória (R-6). E-mail e storeId saem DA LINHA do convite, nunca do cliente (§9).
 * - Convite expirado que alguém tenta usar grava `convite_expirado` DEDUPLICADO.
 */
import { ATOR_EXTERNO_ANONIMO, logEventoExterno, montarEventoContador } from "./eventos"
import type { AuthExternaRepo } from "./repo-prisma"
import type { ConviteRow, EventoContadorRow, PapelExterno } from "./tipos"
import { hashSenhaExterna, normalizarEmail, validarEmailExterno, validarNomeExterno, validarSenhaExterna } from "./usuarios"

/** Validade do convite (G-2): 72h. */
export const CONVITE_EXPIRACAO_MS = 72 * 60 * 60 * 1000

const encoder = new TextEncoder()

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Token bruto: 32 bytes de entropia criptográfica, base64url. */
function gerarTokenConvite(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

/** sha256 hex do token — é isto, e SOMENTE isto, que vai para o banco. */
export async function hashTokenConvite(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token))
  const bytes = new Uint8Array(digest)
  let hex = ""
  for (const b of bytes) hex += b.toString(16).padStart(2, "0")
  return hex
}

/** E-mail mascarado para a consulta PÚBLICA do convite (único lugar com e-mail). */
export function mascararEmail(email: string): string {
  const [local = "", dominio = ""] = email.split("@")
  const inicial = local.slice(0, 1) || "*"
  return `${inicial}***@${dominio}`
}

/* ───────────────────────────── erros de domínio ───────────────────────────── */

export type MotivoFalhaAceite = "inexistente" | "utilizado" | "revogado" | "expirado" | "indisponivel"

/**
 * Falha de aceite. O `motivo` é rótulo para LOG/telemetria — a mensagem ao cliente
 * é SEMPRE a mesma (anti-enumeração, R-2); o mapeamento HTTP fica em `http.ts`.
 */
export class ConviteAceiteFalhaError extends Error {
  readonly code = "CONVITE_ACEITE_FALHA" as const
  readonly motivo: MotivoFalhaAceite
  constructor(motivo: MotivoFalhaAceite) {
    super("Não foi possível concluir o aceite. O convite pode ter expirado, sido revogado ou já utilizado.")
    this.name = "ConviteAceiteFalhaError"
    this.motivo = motivo
  }
}

/** Convite inexistente, de outra loja, ou já encerrado (usado/revogado). */
export class ConviteNaoEncontradoError extends Error {
  readonly code = "CONVITE_NAO_ENCONTRADO" as const
  constructor() {
    super("Convite não encontrado ou já encerrado.")
    this.name = "ConviteNaoEncontradoError"
  }
}

/* ───────────────────────────── visão pública/admin ───────────────────────────── */

/** Convite sem `tokenHash` — única forma que sai do módulo para listagens admin. */
export type ConviteSemHash = Readonly<Omit<ConviteRow, "tokenHash">>

function omitirTokenHash(convite: ConviteRow): ConviteSemHash {
  const { tokenHash: _descartado, ...resto } = convite
  return Object.freeze(resto)
}

export type EstadoConvitePublico = "valido" | "expirado" | "revogado" | "utilizado" | "invalido"

export type ConsultaConvitePublico = Readonly<{
  estado: EstadoConvitePublico
  /** Presente quando o convite existe — sempre mascarado, nunca o e-mail real. */
  emailMascarado?: string
  papel?: PapelExterno
  expiraEm?: Date
}>

/* ───────────────────────────── casos de uso ───────────────────────────── */

export type CriarConviteArgs = Readonly<{
  email: string
  /** Loja ativa da sessão INTERNA do admin — nunca do corpo da requisição externa. */
  storeId: string
  papel?: PapelExterno
  /** `AdminUser.id` técnico do emissor. */
  criadoPorId: string
  ipHash?: string | null
  agora?: Date
}>

export type ConviteCriado = Readonly<{
  convite: ConviteSemHash
  /** Token bruto — retornado UMA única vez ao admin; NUNCA persistido nem logado. */
  token: string
}>

/**
 * Cria o convite (papel default `leitura` — D-5), revogando na mesma transação o
 * convite aberto anterior do mesmo (email, storeId). Eventos: `convite_criado` e,
 * quando houve substituição, `convite_revogado` do anterior (motivo "substituido").
 */
export async function criarConvite(repo: AuthExternaRepo, args: CriarConviteArgs): Promise<ConviteCriado> {
  const agora = args.agora ?? new Date()
  const email = validarEmailExterno(args.email)
  const papel = args.papel ?? "LEITURA"
  const token = gerarTokenConvite()
  const tokenHash = await hashTokenConvite(token)
  const expiraEm = new Date(agora.getTime() + CONVITE_EXPIRACAO_MS)

  const convite = await repo.criarConviteComEvento({
    dados: { email, storeId: args.storeId, papel, tokenHash, expiraEm, criadoPorId: args.criadoPorId },
    revogarAnterior: { revogadoPorId: args.criadoPorId, agora },
    montarEventos: (criado, revogadosAnteriores) => {
      const eventos: EventoContadorRow[] = []
      if (revogadosAnteriores > 0) {
        eventos.push(
          montarEventoContador({
            storeId: args.storeId,
            tipo: "convite_revogado",
            atorTipo: "interno",
            atorId: args.criadoPorId,
            entidade: "contador_convite",
            entidadeId: null,
            metadata: { motivo: "substituido_por_novo_convite" },
            ipHash: args.ipHash ?? null,
          }),
        )
      }
      eventos.push(
        montarEventoContador({
          storeId: args.storeId,
          tipo: "convite_criado",
          atorTipo: "interno",
          atorId: args.criadoPorId,
          entidade: "contador_convite",
          entidadeId: criado.id,
          metadata: { papel, expiraEm: expiraEm.toISOString() },
          ipHash: args.ipHash ?? null,
        }),
      )
      return eventos
    },
  })

  return Object.freeze({ convite: omitirTokenHash(convite), token })
}

/** Listagem admin da loja: pendentes/expirados/usados/revogados, SEM `tokenHash`. */
export async function listarConvites(repo: AuthExternaRepo, storeId: string): Promise<ConviteSemHash[]> {
  const convites = await repo.listarConvitesDaLoja(storeId)
  return convites.map(omitirTokenHash)
}

/** Revogação administrativa. Escopo duplo (id + loja): outra loja nem é tocada. */
export async function revogarConvite(
  repo: AuthExternaRepo,
  args: Readonly<{ conviteId: string; storeId: string; adminId: string; ipHash?: string | null; agora?: Date }>,
): Promise<void> {
  const ok = await repo.revogarConviteComEvento({
    conviteId: args.conviteId,
    storeId: args.storeId,
    revogadoPorId: args.adminId,
    agora: args.agora ?? new Date(),
    montarEvento: () =>
      montarEventoContador({
        storeId: args.storeId,
        tipo: "convite_revogado",
        atorTipo: "interno",
        atorId: args.adminId,
        entidade: "contador_convite",
        entidadeId: args.conviteId,
        metadata: { motivo: "revogado_pelo_admin" },
        ipHash: args.ipHash ?? null,
      }),
  })
  if (!ok) throw new ConviteNaoEncontradoError()
}

/**
 * Consulta PÚBLICA do estado do convite (página de aceite). Estados honestos —
 * válido/expirado/revogado/utilizado — sem enumeração: token desconhecido vira
 * "invalido" genérico. E-mail SEMPRE mascarado (único e-mail que sai do módulo).
 */
export async function consultarConvitePublico(
  repo: AuthExternaRepo,
  token: string,
  agora: Date = new Date(),
): Promise<ConsultaConvitePublico> {
  const bruto = typeof token === "string" ? token.trim() : ""
  if (!bruto) return Object.freeze({ estado: "invalido" as const })
  const convite = await repo.buscarConvitePorTokenHash(await hashTokenConvite(bruto))
  if (!convite) return Object.freeze({ estado: "invalido" as const })

  const estado: EstadoConvitePublico = convite.usadoEm
    ? "utilizado"
    : convite.revogadoEm
      ? "revogado"
      : convite.expiraEm.getTime() <= agora.getTime()
        ? "expirado"
        : "valido"

  return Object.freeze({
    estado,
    emailMascarado: mascararEmail(convite.email),
    papel: convite.papel,
    expiraEm: convite.expiraEm,
  })
}

export type AceitarConviteArgs = Readonly<{
  token: string
  nome: string
  senha: string
  ipHash?: string | null
  userAgentResumo?: string | null
  agora?: Date
}>

export type AceiteConcluido = Readonly<{
  usuario: Readonly<{ id: string; email: string; nome: string }>
  acesso: Readonly<{ id: string; storeId: string; papel: PapelExterno }>
}>

/**
 * Aceite do convite (TRANSAÇÃO no repo): update condicional atômico — `count == 1`
 * é a única vitória; dois aceites concorrentes → exatamente um sucesso (R-6).
 * A senha é hasheada SEMPRE (mesmo em convite inválido), para não abrir oráculo
 * de timing entre "convite bom" e "convite ruim".
 */
export async function aceitarConvite(repo: AuthExternaRepo, args: AceitarConviteArgs): Promise<AceiteConcluido> {
  const agora = args.agora ?? new Date()
  const nome = validarNomeExterno(args.nome)
  const senha = validarSenhaExterna(args.senha)
  const bruto = typeof args.token === "string" ? args.token.trim() : ""
  if (!bruto) throw new ConviteAceiteFalhaError("inexistente")

  const tokenHash = await hashTokenConvite(bruto)
  const senhaHash = await hashSenhaExterna(senha)

  try {
    const { usuario, acesso } = await repo.aceitarConviteComVinculo({
      tokenHash,
      agora,
      novoUsuario: { nome, senhaHash },
      montarEventos: ({ convite, usuario: u, acesso: a }) => [
        montarEventoContador({
          storeId: convite.storeId,
          tipo: "convite_aceito",
          atorTipo: "externo",
          atorId: u.id,
          entidade: "contador_convite",
          entidadeId: convite.id,
          metadata: { papel: a.papel },
          ipHash: args.ipHash ?? null,
          userAgentResumo: args.userAgentResumo ?? null,
        }),
        montarEventoContador({
          storeId: convite.storeId,
          tipo: "acesso_concedido",
          atorTipo: "interno",
          atorId: convite.criadoPorId,
          entidade: "contador_acesso",
          entidadeId: a.id,
          metadata: { papel: a.papel, concedidoEm: agora.toISOString() },
          ipHash: args.ipHash ?? null,
        }),
      ],
    })
    return Object.freeze({
      usuario: Object.freeze({ id: usuario.id, email: usuario.email, nome: usuario.nome }),
      acesso: Object.freeze({ id: acesso.id, storeId: acesso.storeId, papel: acesso.papel }),
    })
  } catch (e) {
    if (e instanceof ConviteAceiteFalhaError) {
      // Tentativa de uso de convite expirado → evento E.1 deduplicado (§E.1),
      // best-effort: a falha do evento NUNCA mascara a falha honesta do aceite.
      if (e.motivo === "expirado") {
        try {
          const convite = await repo.buscarConvitePorTokenHash(tokenHash)
          if (convite) {
            await repo.registrarEventoExpiradoUnico(
              montarEventoContador({
                storeId: convite.storeId,
                tipo: "convite_expirado",
                atorTipo: "externo",
                atorId: ATOR_EXTERNO_ANONIMO,
                entidade: "contador_convite",
                entidadeId: convite.id,
                metadata: { motivo: "tentativa_de_uso_apos_expiracao", expiraEm: convite.expiraEm.toISOString() },
                ipHash: args.ipHash ?? null,
              }),
            )
          }
        } catch {
          logEventoExterno("login_externo_falha", { motivo: "evento_convite_expirado_nao_gravado" })
        }
      }
    }
    throw e
  }
}

// `normalizarEmail` é reexportado por conveniência para rotas que só lidam com convites.
export { normalizarEmail }
