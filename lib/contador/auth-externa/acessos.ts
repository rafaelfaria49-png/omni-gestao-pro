/**
 * Contador HUB · Identidade externa — vínculo contador↔loja (GOAL 014, §B).
 *
 * Um vínculo por par (usuarioId, storeId). Suspensão é reversível; revogação é
 * terminal (nova concessão REATIVA a mesma linha — trilha nos eventos). Ambas
 * valem na PRÓXIMA request: `escopo-externo.ts` confere o vínculo a cada request,
 * nunca via cookie de loja. Toda alteração grava seu evento E.1 na mesma transação.
 */
import { montarEventoContador, type TipoEventoAcessoExterno } from "./eventos"
import type { AcaoVinculo, AuthExternaRepo } from "./repo-prisma"
import type { AcessoRow, PapelExterno, StatusAcessoExterno } from "./tipos"

/** Vínculo inexistente na loja informada (escopo duplo id+storeId). */
export class AcessoNaoEncontradoError extends Error {
  readonly code = "ACESSO_EXTERNO_NAO_ENCONTRADO" as const
  constructor() {
    super("Vínculo não encontrado para esta loja.")
    this.name = "AcessoNaoEncontradoError"
  }
}

/** Transição inválida (ex.: suspender o que já está revogado/suspenso). */
export class AcessoEstadoInvalidoError extends Error {
  readonly code = "ACESSO_EXTERNO_ESTADO_INVALIDO" as const
  readonly acao: AcaoVinculo
  readonly estadoAtual: StatusAcessoExterno
  constructor(acao: AcaoVinculo, estadoAtual: StatusAcessoExterno) {
    super("O vínculo não está em estado compatível com esta ação.")
    this.name = "AcessoEstadoInvalidoError"
    this.acao = acao
    this.estadoAtual = estadoAtual
  }
}

const EVENTO_POR_ACAO: Record<AcaoVinculo, TipoEventoAcessoExterno> = {
  suspender: "acesso_suspenso",
  reativar: "acesso_reativado",
  revogar: "acesso_revogado",
}

export type AcaoAdminVinculoArgs = Readonly<{
  acessoId: string
  /** Loja ativa da sessão INTERNA do admin — escopo duplo obrigatório. */
  storeId: string
  /** `AdminUser.id` técnico de quem executa a ação. */
  adminId: string
  ipHash?: string | null
  agora?: Date
}>

async function alterarVinculo(repo: AuthExternaRepo, acao: AcaoVinculo, args: AcaoAdminVinculoArgs): Promise<AcessoRow> {
  const atualizado = await repo.alterarAcessoComEvento({
    acessoId: args.acessoId,
    storeId: args.storeId,
    acao,
    adminId: args.adminId,
    agora: args.agora ?? new Date(),
    montarEvento: (antes) =>
      montarEventoContador({
        storeId: args.storeId,
        tipo: EVENTO_POR_ACAO[acao],
        atorTipo: "interno",
        atorId: args.adminId,
        entidade: "contador_acesso",
        entidadeId: args.acessoId,
        metadata: { statusAnterior: antes.status },
        ipHash: args.ipHash ?? null,
      }),
  })
  if (!atualizado) throw new AcessoNaoEncontradoError()
  return atualizado
}

/** Suspensão do vínculo: loja bloqueada na próxima request; demais lojas intactas. */
export function suspenderVinculo(repo: AuthExternaRepo, args: AcaoAdminVinculoArgs): Promise<AcessoRow> {
  return alterarVinculo(repo, "suspender", args)
}

/** Reversão da suspensão (reversível; não desfaz revogação). */
export function reativarVinculo(repo: AuthExternaRepo, args: AcaoAdminVinculoArgs): Promise<AcessoRow> {
  return alterarVinculo(repo, "reativar", args)
}

/** Revogação (terminal). Reconcessão posterior reativa a MESMA linha via convite. */
export function revogarVinculo(repo: AuthExternaRepo, args: AcaoAdminVinculoArgs): Promise<AcessoRow> {
  return alterarVinculo(repo, "revogar", args)
}

/** Listagem admin da loja (todos os estados — a UI mostra o ciclo de vida). */
export function listarVinculosDaLoja(repo: AuthExternaRepo, storeId: string): Promise<AcessoRow[]> {
  return repo.listarAcessosDaLoja(storeId)
}

/**
 * Lojas do escopo do contador (único conteúdo autenticado do portal no 014):
 * somente vínculos ATIVOS — vínculo suspenso/revogado some da lista (teste 18).
 * NENHUM dado contábil aqui.
 */
export async function listarLojasDoEscopo(
  repo: AuthExternaRepo,
  usuarioId: string,
): Promise<ReadonlyArray<Readonly<{ storeId: string; papel: PapelExterno }>>> {
  const acessos = await repo.listarAcessosAtivosDoUsuario(usuarioId)
  return acessos.map((a) => Object.freeze({ storeId: a.storeId, papel: a.papel }))
}
