/**
 * Contador HUB · Identidade externa — implementação Prisma do `AuthExternaRepo` (GOAL 014).
 *
 * SERVER-ONLY em produção (default = singleton `prisma`), mas o cliente é INJETÁVEL —
 * mesmo padrão de `fechamento/repo-prisma.ts`. Os testes passam um fake in-memory com
 * semântica real de `$transaction` (commit/rollback serializados) e exercitam ESTE código.
 *
 * Atomicidades garantidas aqui (§B–§D da proposta):
 *  - criar convite: revoga o convite ABERTO anterior do mesmo (email, storeId) na
 *    mesma transação (o índice parcial único da 0015 veda corrida);
 *  - aceite: update condicional atômico (`usadoEm IS NULL AND revogadoEm IS NULL AND
 *    expiraEm > now()`) — `count == 1` é a ÚNICA vitória possível (R-6); usuário e
 *    vínculo são criados/reativados com e-mail e storeId DA LINHA do convite;
 *  - suspensão da identidade: `tokenVersion++` + revogação em massa das sessões +
 *    evento, na mesma transação (R-5);
 *  - toda escrita administrativa grava seu evento E.1 na mesma transação.
 */
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { AcessoEstadoInvalidoError } from "./acessos"
import { ConviteAceiteFalhaError } from "./convites"
import type {
  AcessoRow,
  ConviteRow,
  EventoContadorRow,
  PapelExterno,
  SessaoRow,
  UsuarioRow,
} from "./tipos"

/* ───────────────────────────── porta mínima do Prisma ───────────────────────────── */

export interface AuthExternaTxClient {
  contadorUsuario: {
    findUnique(args: { where: { id?: string; email?: string } }): Promise<UsuarioRow | null>
    create(args: { data: Record<string, unknown> }): Promise<UsuarioRow>
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<UsuarioRow>
  }
  contadorConvite: {
    findUnique(args: { where: { id?: string; tokenHash?: string } }): Promise<ConviteRow | null>
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<ConviteRow[]>
    create(args: { data: Record<string, unknown> }): Promise<ConviteRow>
    updateMany(args: {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }): Promise<{ count: number }>
  }
  contadorAcesso: {
    findUnique(args: {
      where: { usuarioId_storeId: { usuarioId: string; storeId: string } }
    }): Promise<AcessoRow | null>
    findFirst(args: { where: Record<string, unknown> }): Promise<AcessoRow | null>
    findMany(args: { where: Record<string, unknown>; orderBy?: unknown }): Promise<AcessoRow[]>
    create(args: { data: Record<string, unknown> }): Promise<AcessoRow>
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<AcessoRow>
  }
  contadorSessaoExterna: {
    findUnique(args: { where: { id: string } }): Promise<SessaoRow | null>
    create(args: { data: Record<string, unknown> }): Promise<SessaoRow>
    updateMany(args: {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }): Promise<{ count: number }>
  }
  contadorEvento: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>
    findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null>
  }
}

export interface AuthExternaDbClient extends AuthExternaTxClient {
  $transaction<T>(fn: (tx: AuthExternaTxClient) => Promise<T>): Promise<T>
}

/* ───────────────────────────── tipos de entrada ───────────────────────────── */

export type NovaSessaoData = Readonly<{
  usuarioId: string
  expiraEm: Date
  ipHash: string | null
  userAgentResumo: string | null
}>

export type NovoConviteData = Readonly<{
  email: string
  storeId: string
  papel: PapelExterno
  tokenHash: string
  expiraEm: Date
  criadoPorId: string
}>

export type AcaoVinculo = "suspender" | "reativar" | "revogar"

/* ───────────────────────────── porta de domínio ───────────────────────────── */

export interface AuthExternaRepo {
  // leituras simples
  buscarUsuarioPorEmail(email: string): Promise<UsuarioRow | null>
  buscarUsuarioPorId(id: string): Promise<UsuarioRow | null>
  buscarAcesso(usuarioId: string, storeId: string): Promise<AcessoRow | null>
  listarAcessosAtivosDoUsuario(usuarioId: string): Promise<AcessoRow[]>
  listarAcessosDaLoja(storeId: string): Promise<AcessoRow[]>
  listarConvitesDaLoja(storeId: string): Promise<ConviteRow[]>
  buscarConvitePorTokenHash(tokenHash: string): Promise<ConviteRow | null>
  buscarSessaoPorId(id: string): Promise<SessaoRow | null>

  // escritas simples (sessão)
  registrarUltimoLogin(usuarioId: string, quando: Date): Promise<void>
  criarSessao(data: NovaSessaoData): Promise<SessaoRow>
  tocarUltimoUsoSessao(id: string, quando: Date): Promise<void>
  estenderSessao(id: string, novaExpiraEm: Date, ultimoUsoEm: Date): Promise<void>
  revogarSessao(id: string, agora: Date): Promise<void>

  // composições transacionais (escrita + evento E.1 na mesma transação)
  criarConviteComEvento(args: {
    dados: NovoConviteData
    revogarAnterior: { revogadoPorId: string; agora: Date }
    montarEventos: (convite: ConviteRow, revogadosAnteriores: number) => EventoContadorRow[]
  }): Promise<ConviteRow>
  revogarConviteComEvento(args: {
    conviteId: string
    storeId: string
    revogadoPorId: string
    agora: Date
    montarEvento: () => EventoContadorRow
  }): Promise<boolean>
  aceitarConviteComVinculo(args: {
    tokenHash: string
    agora: Date
    novoUsuario: { nome: string; senhaHash: string }
    montarEventos: (ctx: {
      convite: ConviteRow
      usuario: UsuarioRow
      acesso: AcessoRow
    }) => EventoContadorRow[]
  }): Promise<{ convite: ConviteRow; usuario: UsuarioRow; acesso: AcessoRow }>
  alterarAcessoComEvento(args: {
    acessoId: string
    storeId: string
    acao: AcaoVinculo
    adminId: string
    agora: Date
    montarEvento: (antes: AcessoRow) => EventoContadorRow
  }): Promise<AcessoRow | null>
  suspenderUsuarioComEvento(args: {
    usuarioId: string
    agora: Date
    montarEvento: (antes: UsuarioRow) => EventoContadorRow
  }): Promise<UsuarioRow | null>
  reativarUsuarioComEvento(args: {
    usuarioId: string
    agora: Date
    montarEvento: (antes: UsuarioRow) => EventoContadorRow
  }): Promise<UsuarioRow | null>
  revogarSessaoComEvento(args: {
    sessaoId: string
    agora: Date
    montarEvento: (sessao: SessaoRow) => EventoContadorRow
  }): Promise<boolean>
  /** `convite_expirado` é DEDUPLICADO por convite (§E.1): no máximo 1 linha. */
  registrarEventoExpiradoUnico(evento: EventoContadorRow): Promise<void>
  registrarEvento(evento: EventoContadorRow): Promise<void>
}

/* ───────────────────────────── helpers ───────────────────────────── */

function eventoData(e: EventoContadorRow): Record<string, unknown> {
  return {
    storeId: e.storeId,
    competenciaId: null,
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

/* ───────────────────────────── repositório ───────────────────────────── */

export function criarRepoAuthExterna(client?: AuthExternaDbClient): AuthExternaRepo {
  const obter = async (): Promise<AuthExternaDbClient> => {
    if (client) return client
    await prismaEnsureConnected()
    return prisma as unknown as AuthExternaDbClient
  }

  return {
    async buscarUsuarioPorEmail(email) {
      const db = await obter()
      return db.contadorUsuario.findUnique({ where: { email } })
    },

    async buscarUsuarioPorId(id) {
      const db = await obter()
      return db.contadorUsuario.findUnique({ where: { id } })
    },

    async buscarAcesso(usuarioId, storeId) {
      const db = await obter()
      return db.contadorAcesso.findUnique({ where: { usuarioId_storeId: { usuarioId, storeId } } })
    },

    async listarAcessosAtivosDoUsuario(usuarioId) {
      const db = await obter()
      return db.contadorAcesso.findMany({
        where: { usuarioId, status: "ATIVO" },
        orderBy: { concedidoEm: "asc" },
      })
    },

    async listarAcessosDaLoja(storeId) {
      const db = await obter()
      return db.contadorAcesso.findMany({ where: { storeId }, orderBy: { createdAt: "asc" } })
    },

    async listarConvitesDaLoja(storeId) {
      const db = await obter()
      return db.contadorConvite.findMany({ where: { storeId }, orderBy: { createdAt: "desc" } })
    },

    async buscarConvitePorTokenHash(tokenHash) {
      const db = await obter()
      return db.contadorConvite.findUnique({ where: { tokenHash } })
    },

    async buscarSessaoPorId(id) {
      const db = await obter()
      return db.contadorSessaoExterna.findUnique({ where: { id } })
    },

    async registrarUltimoLogin(usuarioId, quando) {
      const db = await obter()
      await db.contadorUsuario.update({ where: { id: usuarioId }, data: { ultimoLoginEm: quando } })
    },

    async criarSessao(data) {
      const db = await obter()
      return db.contadorSessaoExterna.create({ data: { ...data } })
    },

    async tocarUltimoUsoSessao(id, quando) {
      const db = await obter()
      await db.contadorSessaoExterna.updateMany({ where: { id }, data: { ultimoUsoEm: quando } })
    },

    async estenderSessao(id, novaExpiraEm, ultimoUsoEm) {
      const db = await obter()
      await db.contadorSessaoExterna.updateMany({
        where: { id, revogadoEm: null },
        data: { expiraEm: novaExpiraEm, ultimoUsoEm },
      })
    },

    async revogarSessao(id, agora) {
      const db = await obter()
      await db.contadorSessaoExterna.updateMany({
        where: { id, revogadoEm: null },
        data: { revogadoEm: agora },
      })
    },

    async criarConviteComEvento(args) {
      const db = await obter()
      return db.$transaction(async (tx) => {
        // Revoga o convite ABERTO anterior do mesmo (email, storeId) — no máximo 1
        // aberto por par (índice parcial único da 0015 veda a corrida).
        const revogados = await tx.contadorConvite.updateMany({
          where: {
            email: args.dados.email,
            storeId: args.dados.storeId,
            usadoEm: null,
            revogadoEm: null,
          },
          data: {
            revogadoEm: args.revogarAnterior.agora,
            revogadoPorId: args.revogarAnterior.revogadoPorId,
          },
        })
        const convite = await tx.contadorConvite.create({ data: { ...args.dados } })
        for (const evento of args.montarEventos(convite, revogados.count)) {
          await tx.contadorEvento.create({ data: eventoData(evento) })
        }
        return convite
      })
    },

    async revogarConviteComEvento(args) {
      const db = await obter()
      return db.$transaction(async (tx) => {
        // Escopo duplo (id + storeId): convite de outra loja nem é tocado.
        const res = await tx.contadorConvite.updateMany({
          where: { id: args.conviteId, storeId: args.storeId, usadoEm: null, revogadoEm: null },
          data: { revogadoEm: args.agora, revogadoPorId: args.revogadoPorId },
        })
        if (res.count !== 1) return false
        await tx.contadorEvento.create({ data: eventoData(args.montarEvento()) })
        return true
      })
    },

    async aceitarConviteComVinculo(args) {
      const db = await obter()
      return db.$transaction(async (tx) => {
        const convite = await tx.contadorConvite.findUnique({
          where: { tokenHash: args.tokenHash },
        })
        if (!convite) throw new ConviteAceiteFalhaError("inexistente")

        // ACEITE TRANSACIONAL (§C, R-6): update condicional atômico. Em READ
        // COMMITTED o segundo concorrente bloqueia até o primeiro commitar e então
        // reavalia o `where` — `usadoEm` já não é NULL, count = 0, falha honesta.
        const res = await tx.contadorConvite.updateMany({
          where: {
            id: convite.id,
            usadoEm: null,
            revogadoEm: null,
            expiraEm: { gt: args.agora },
          },
          data: { usadoEm: args.agora },
        })
        if (res.count !== 1) {
          const motivo = convite.usadoEm
            ? ("utilizado" as const)
            : convite.revogadoEm
              ? ("revogado" as const)
              : convite.expiraEm.getTime() <= args.agora.getTime()
                ? ("expirado" as const)
                : ("indisponivel" as const)
          throw new ConviteAceiteFalhaError(motivo)
        }

        // Usuário pelo e-mail DA LINHA do convite (nunca do corpo da requisição).
        let usuario = await tx.contadorUsuario.findUnique({ where: { email: convite.email } })
        if (usuario && usuario.status !== "ATIVO") {
          // Identidade suspensa não ganha vínculo novo; a recusa é genérica (anti-enumeração).
          throw new ConviteAceiteFalhaError("indisponivel")
        }
        if (!usuario) {
          usuario = await tx.contadorUsuario.create({
            data: {
              email: convite.email,
              nome: args.novoUsuario.nome,
              senhaHash: args.novoUsuario.senhaHash,
            },
          })
        }

        // Vínculo com o storeId DA LINHA do convite: convite da loja A nunca cria
        // vínculo com a loja B (§9). Reconcessão REATIVA a mesma linha (§B).
        const existente = await tx.contadorAcesso.findUnique({
          where: { usuarioId_storeId: { usuarioId: usuario.id, storeId: convite.storeId } },
        })
        const acesso = existente
          ? await tx.contadorAcesso.update({
              where: { id: existente.id },
              data: {
                papel: convite.papel,
                status: "ATIVO",
                concedidoPorId: convite.criadoPorId,
                concedidoEm: args.agora,
                suspensoEm: null,
                suspensoPorId: null,
                revogadoEm: null,
                revogadoPorId: null,
              },
            })
          : await tx.contadorAcesso.create({
              data: {
                usuarioId: usuario.id,
                storeId: convite.storeId,
                papel: convite.papel,
                status: "ATIVO",
                concedidoPorId: convite.criadoPorId,
                concedidoEm: args.agora,
              },
            })

        const conviteUsado: ConviteRow = { ...convite, usadoEm: args.agora }
        for (const evento of args.montarEventos({ convite: conviteUsado, usuario, acesso })) {
          await tx.contadorEvento.create({ data: eventoData(evento) })
        }
        return { convite: conviteUsado, usuario, acesso }
      })
    },

    async alterarAcessoComEvento(args) {
      const db = await obter()
      return db.$transaction(async (tx) => {
        // Escopo duplo (id + storeId): vínculo de outra loja nem é lido para escrita.
        const acesso = await tx.contadorAcesso.findFirst({
          where: { id: args.acessoId, storeId: args.storeId },
        })
        if (!acesso) return null

        let data: Record<string, unknown>
        if (args.acao === "suspender") {
          if (acesso.status !== "ATIVO") throw new AcessoEstadoInvalidoError(args.acao, acesso.status)
          data = { status: "SUSPENSO", suspensoEm: args.agora, suspensoPorId: args.adminId }
        } else if (args.acao === "reativar") {
          if (acesso.status !== "SUSPENSO") throw new AcessoEstadoInvalidoError(args.acao, acesso.status)
          data = { status: "ATIVO", suspensoEm: null, suspensoPorId: null }
        } else {
          if (acesso.status === "REVOGADO") throw new AcessoEstadoInvalidoError(args.acao, acesso.status)
          data = { status: "REVOGADO", revogadoEm: args.agora, revogadoPorId: args.adminId }
        }

        const atualizado = await tx.contadorAcesso.update({ where: { id: acesso.id }, data })
        await tx.contadorEvento.create({ data: eventoData(args.montarEvento(acesso)) })
        return atualizado
      })
    },

    async suspenderUsuarioComEvento(args) {
      const db = await obter()
      return db.$transaction(async (tx) => {
        const usuario = await tx.contadorUsuario.findUnique({ where: { id: args.usuarioId } })
        if (!usuario) return null

        // R-5: tokenVersion++ E revogação em massa na MESMA transação — nenhuma
        // sessão sobrevive à suspensão, e cookies antigos morrem pela versão.
        const atualizado = await tx.contadorUsuario.update({
          where: { id: usuario.id },
          data: { status: "SUSPENSO", tokenVersion: { increment: 1 } },
        })
        await tx.contadorSessaoExterna.updateMany({
          where: { usuarioId: usuario.id, revogadoEm: null },
          data: { revogadoEm: args.agora },
        })
        await tx.contadorEvento.create({ data: eventoData(args.montarEvento(usuario)) })
        return atualizado
      })
    },

    async reativarUsuarioComEvento(args) {
      const db = await obter()
      return db.$transaction(async (tx) => {
        const usuario = await tx.contadorUsuario.findUnique({ where: { id: args.usuarioId } })
        if (!usuario) return null
        const atualizado = await tx.contadorUsuario.update({
          where: { id: usuario.id },
          data: { status: "ATIVO" },
        })
        await tx.contadorEvento.create({ data: eventoData(args.montarEvento(usuario)) })
        return atualizado
      })
    },

    async revogarSessaoComEvento(args) {
      const db = await obter()
      return db.$transaction(async (tx) => {
        const sessao = await tx.contadorSessaoExterna.findUnique({ where: { id: args.sessaoId } })
        if (!sessao || sessao.revogadoEm) return false
        await tx.contadorSessaoExterna.updateMany({
          where: { id: sessao.id, revogadoEm: null },
          data: { revogadoEm: args.agora },
        })
        await tx.contadorEvento.create({ data: eventoData(args.montarEvento(sessao)) })
        return true
      })
    },

    async registrarEventoExpiradoUnico(evento) {
      const db = await obter()
      await db.$transaction(async (tx) => {
        // Dedupe por (tipo, entidadeId): tentativas repetidas com o mesmo convite
        // expirado gravam UMA linha só.
        const existente = await tx.contadorEvento.findFirst({
          where: { tipo: evento.tipo, entidadeId: evento.entidadeId },
        })
        if (existente) return
        await tx.contadorEvento.create({ data: eventoData(evento) })
      })
    },

    async registrarEvento(evento) {
      const db = await obter()
      await db.contadorEvento.create({ data: eventoData(evento) })
    },
  }
}
