/**
 * Contador HUB · Identidade externa — tipos compartilhados do módulo (GOAL 014).
 *
 * Espelham os models da migration 0015 (`contador_usuarios`, `contador_convites`,
 * `contador_acessos`, `contador_sessoes_externas`, `contador_eventos`) SEM importar
 * `@/generated/prisma`: o módulo fica compilável/testável mesmo com o client
 * desatualizado, e os testes rodam contra fakes in-memory.
 */
import type { TipoEventoAcessoExterno } from "./eventos"

/** Papel externo mínimo do vínculo (enum `ContadorPapelExterno`). Nenhum papel "all". */
export type PapelExterno = "LEITURA" | "CONFERENCIA"

export type StatusUsuarioExterno = "ATIVO" | "SUSPENSO"

export type StatusAcessoExterno = "ATIVO" | "SUSPENSO" | "REVOGADO"

/** Linha de `ContadorUsuario` (identidade externa — §A da proposta). */
export type UsuarioRow = Readonly<{
  id: string
  email: string
  nome: string
  senhaHash: string
  status: StatusUsuarioExterno
  tokenVersion: number
  ultimoLoginEm: Date | null
  createdAt: Date
  updatedAt: Date
}>

/** Linha de `ContadorConvite` (§C). `tokenHash` NUNCA sai do servidor. */
export type ConviteRow = Readonly<{
  id: string
  email: string
  storeId: string
  papel: PapelExterno
  tokenHash: string
  expiraEm: Date
  usadoEm: Date | null
  revogadoEm: Date | null
  revogadoPorId: string | null
  criadoPorId: string
  createdAt: Date
  updatedAt: Date
}>

/** Linha de `ContadorAcesso` — vínculo contador↔loja (§B). */
export type AcessoRow = Readonly<{
  id: string
  usuarioId: string
  storeId: string
  papel: PapelExterno
  status: StatusAcessoExterno
  concedidoPorId: string
  concedidoEm: Date
  suspensoEm: Date | null
  suspensoPorId: string | null
  revogadoEm: Date | null
  revogadoPorId: string | null
  createdAt: Date
  updatedAt: Date
}>

/** Linha de `ContadorSessaoExterna` (§D). `id` É o `sid` do cookie. */
export type SessaoRow = Readonly<{
  id: string
  usuarioId: string
  expiraEm: Date
  revogadoEm: Date | null
  ultimoUsoEm: Date | null
  ipHash: string | null
  userAgentResumo: string | null
  createdAt: Date
  updatedAt: Date
}>

/**
 * Linha de `ContadorEvento` já pronta para `create` (E.1 da proposta).
 * `competenciaId` é sempre NULL no caminho externo; `ip`/`userAgent` recebem
 * SOMENTE valores minimizados (ipHash / UA resumido) — correção P1-3.
 */
export type EventoContadorRow = Readonly<{
  storeId: string
  competenciaId: null
  tipo: TipoEventoAcessoExterno
  atorTipo: "interno" | "externo"
  atorId: string
  entidade: string | null
  entidadeId: string | null
  origem: string | null
  metadata: Record<string, unknown> | null
  ip: string | null
  userAgent: string | null
}>

/** Erro tipado de entrada inválida (e-mail, nome, senha). Mensagem segura, com campo. */
export class ValidacaoExternaError extends Error {
  readonly code = "VALIDACAO_EXTERNA" as const
  readonly campo: string
  constructor(campo: string, mensagem: string) {
    super(mensagem)
    this.name = "ValidacaoExternaError"
    this.campo = campo
  }
}
