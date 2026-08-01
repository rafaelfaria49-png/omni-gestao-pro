/**
 * Contador HUB · Identidade externa — ciclo de vida da identidade (GOAL 014, §A).
 *
 * E-mail normalizado (trim + lowercase) em TODA leitura/escrita. Senha com bcrypt
 * custo 12 via `bcryptjs` (mesmo algoritmo/custo do admin interno — `auth.ts`).
 * Suspensão faz `tokenVersion++` E revoga todas as sessões na mesma transação
 * (R-5): a identidade suspensa perde acesso na próxima request.
 */
import bcrypt from "bcryptjs"
import { montarEventoContador } from "./eventos"
import type { AuthExternaRepo } from "./repo-prisma"
import { ValidacaoExternaError, type UsuarioRow } from "./tipos"

/** Custo bcrypt exigido pela proposta (§A). */
export const BCRYPT_CUSTO_EXTERNO = 12

/** Normalização canônica: trim + lowercase. Usada antes de QUALQUER leitura/escrita. */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase()
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Normaliza e valida formato mínimo. Lança `ValidacaoExternaError` no formato ruim. */
export function validarEmailExterno(email: unknown): string {
  const bruto = typeof email === "string" ? email : ""
  const normalizado = normalizarEmail(bruto)
  if (!normalizado || normalizado.length > 254 || !EMAIL_RE.test(normalizado)) {
    throw new ValidacaoExternaError("email", "Informe um e-mail válido.")
  }
  return normalizado
}

/** Política mínima de senha do portal externo (MVP): 8+ caracteres. */
export function validarSenhaExterna(senha: unknown): string {
  const valor = typeof senha === "string" ? senha : ""
  if (valor.length < 8) {
    throw new ValidacaoExternaError("senha", "A senha deve ter pelo menos 8 caracteres.")
  }
  if (valor.length > 128) {
    throw new ValidacaoExternaError("senha", "A senha deve ter no máximo 128 caracteres.")
  }
  return valor
}

/** Nome de exibição informado no aceite do convite. */
export function validarNomeExterno(nome: unknown): string {
  const valor = (typeof nome === "string" ? nome : "").trim()
  if (valor.length < 2) {
    throw new ValidacaoExternaError("nome", "Informe seu nome completo.")
  }
  if (valor.length > 120) {
    throw new ValidacaoExternaError("nome", "O nome deve ter no máximo 120 caracteres.")
  }
  return valor
}

/** Hash bcrypt custo 12. A senha em claro NUNCA é persistida nem logada. */
export async function hashSenhaExterna(senha: string): Promise<string> {
  return bcrypt.hash(senha, BCRYPT_CUSTO_EXTERNO)
}

/** Comparação de senha — usada SEMPRE no login (anti-enumeração, R-2). */
export async function compararSenhaExterna(senha: string, senhaHash: string): Promise<boolean> {
  return bcrypt.compare(senha, senhaHash)
}

/** Identidade inexistente para operação administrativa. Mensagem segura. */
export class UsuarioNaoEncontradoError extends Error {
  readonly code = "USUARIO_EXTERNO_NAO_ENCONTRADO" as const
  constructor() {
    super("Identidade externa não encontrada.")
    this.name = "UsuarioNaoEncontradoError"
  }
}

export type AcaoAdminIdentidade = Readonly<{
  usuarioId: string
  /** `AdminUser.id` técnico de quem executa a ação elevada. */
  adminId: string
  /** Loja de ORIGEM da ação (vai para o evento — R-7), nunca do cliente externo. */
  storeIdOrigem: string
  ipHash?: string | null
  agora?: Date
}>

/**
 * Suspensão da identidade (ação elevada): `status → SUSPENSO` + `tokenVersion++` +
 * revogação em massa das sessões + evento `usuario_suspenso`, tudo na MESMA
 * transação (a revogação nunca fica para trás — R-5).
 */
export async function suspenderIdentidade(
  repo: AuthExternaRepo,
  args: AcaoAdminIdentidade,
): Promise<UsuarioRow> {
  const agora = args.agora ?? new Date()
  const atualizado = await repo.suspenderUsuarioComEvento({
    usuarioId: args.usuarioId,
    agora,
    montarEvento: (antes) =>
      montarEventoContador({
        storeId: args.storeIdOrigem,
        tipo: "usuario_suspenso",
        atorTipo: "interno",
        atorId: args.adminId,
        entidade: "contador_usuario",
        entidadeId: args.usuarioId,
        metadata: { statusAnterior: antes.status, statusNovo: "SUSPENSO" },
        ipHash: args.ipHash ?? null,
      }),
  })
  if (!atualizado) throw new UsuarioNaoEncontradoError()
  return atualizado
}

/**
 * Reativação da identidade (igualmente auditada — R-7): `status → ATIVO` + evento
 * `usuario_reativado`. NÃO mexe em `tokenVersion` (sessões novas exigem login).
 */
export async function reativarIdentidade(
  repo: AuthExternaRepo,
  args: AcaoAdminIdentidade,
): Promise<UsuarioRow> {
  const agora = args.agora ?? new Date()
  const atualizado = await repo.reativarUsuarioComEvento({
    usuarioId: args.usuarioId,
    agora,
    montarEvento: (antes) =>
      montarEventoContador({
        storeId: args.storeIdOrigem,
        tipo: "usuario_reativado",
        atorTipo: "interno",
        atorId: args.adminId,
        entidade: "contador_usuario",
        entidadeId: args.usuarioId,
        metadata: { statusAnterior: antes.status, statusNovo: "ATIVO" },
        ipHash: args.ipHash ?? null,
      }),
  })
  if (!atualizado) throw new UsuarioNaoEncontradoError()
  return atualizado
}
