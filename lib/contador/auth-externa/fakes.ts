/**
 * Contador HUB · Identidade externa — fakes in-memory para TESTES (GOAL 014).
 *
 * USO EXCLUSIVO DOS TESTES colocalizados (`*.test.ts`). Implementa
 * `AuthExternaDbClient` com semântica real de `$transaction` (mesmo padrão do fake
 * de `__tests__/fechamento-service.test.ts`):
 *  - transações SERIALIZADAS: no Postgres real, dois aceites do mesmo convite
 *    disputam o row lock do `updateMany` e nunca escrevem entrelaçados;
 *  - ROLLBACK de verdade: falha dentro da transação restaura o snapshot anterior;
 *  - uniques do schema (e-mail, tokenHash, convite aberto por (email, storeId),
 *    vínculo por (usuarioId, storeId)) enforced como o banco faria.
 *
 * NUNCA `vi.mock("@/lib/prisma")`, nunca banco real (convenção `vitest.config.ts`).
 */
import type { AuthExternaDbClient, AuthExternaTxClient } from "./repo-prisma"
import type { AcessoRow, ConviteRow, SessaoRow, UsuarioRow } from "./tipos"

type Mut<T> = { -readonly [K in keyof T]: T[K] }

export type EstadoFalsoAuthExterna = {
  usuarios: Mut<UsuarioRow>[]
  convites: Mut<ConviteRow>[]
  acessos: Mut<AcessoRow>[]
  sessoes: Mut<SessaoRow>[]
  eventos: Record<string, unknown>[]
}

export type DbFalsoAuthExterna = AuthExternaDbClient & {
  estado: EstadoFalsoAuthExterna
  transacoes: number
}

function clonar(e: EstadoFalsoAuthExterna): EstadoFalsoAuthExterna {
  return {
    usuarios: e.usuarios.map((r) => ({ ...r })),
    convites: e.convites.map((r) => ({ ...r })),
    acessos: e.acessos.map((r) => ({ ...r })),
    sessoes: e.sessoes.map((r) => ({ ...r })),
    eventos: e.eventos.map((r) => ({ ...r })),
  }
}

/** Aplica `data` do Prisma na linha, entendendo `{ increment: n }` e null. */
function aplicarData(row: Record<string, unknown>, data: Record<string, unknown>, agora: Date): void {
  for (const [chave, valor] of Object.entries(data)) {
    if (valor && typeof valor === "object" && "increment" in (valor as Record<string, unknown>)) {
      row[chave] = (row[chave] as number) + ((valor as { increment: number }).increment)
    } else {
      row[chave] = valor
    }
  }
  row.updatedAt = agora
}

function casaNulo(valor: unknown, filtro: unknown): boolean {
  // Filtro `X: null` do Prisma significa "IS NULL".
  if (filtro === null) return valor === null || valor === undefined
  return valor === filtro
}

export function criarDbFalsoAuthExterna(estadoInicial: Partial<EstadoFalsoAuthExterna> = {}): DbFalsoAuthExterna {
  const db = {
    estado: {
      usuarios: estadoInicial.usuarios ?? [],
      convites: estadoInicial.convites ?? [],
      acessos: estadoInicial.acessos ?? [],
      sessoes: estadoInicial.sessoes ?? [],
      eventos: estadoInicial.eventos ?? [],
    } as EstadoFalsoAuthExterna,
    transacoes: 0,
  } as unknown as DbFalsoAuthExterna

  let seq = 0
  const proxId = (prefixo: string) => `${prefixo}-${++seq}`
  const agoraFake = () => new Date()

  const ops: AuthExternaTxClient = {
    contadorUsuario: {
      async findUnique({ where }) {
        const row = db.estado.usuarios.find((u) =>
          where.id ? u.id === where.id : u.email === where.email,
        )
        return (row ?? null) as UsuarioRow | null
      },
      async create({ data }) {
        const d = data as Record<string, unknown>
        if (db.estado.usuarios.some((u) => u.email === d.email)) {
          throw new Error("unique constraint: contador_usuarios.email")
        }
        const agora = agoraFake()
        const row: Mut<UsuarioRow> = {
          id: proxId("usr"),
          email: d.email as string,
          nome: d.nome as string,
          senhaHash: d.senhaHash as string,
          status: "ATIVO",
          tokenVersion: 1,
          ultimoLoginEm: null,
          createdAt: agora,
          updatedAt: agora,
        }
        db.estado.usuarios.push(row)
        return row as UsuarioRow
      },
      async update({ where, data }) {
        const row = db.estado.usuarios.find((u) => u.id === where.id)
        if (!row) throw new Error("contador_usuarios: registro não encontrado")
        aplicarData(row as unknown as Record<string, unknown>, data as Record<string, unknown>, agoraFake())
        return row as UsuarioRow
      },
    },

    contadorConvite: {
      async findUnique({ where }) {
        const row = db.estado.convites.find((c) =>
          where.id ? c.id === where.id : c.tokenHash === where.tokenHash,
        )
        return (row ?? null) as ConviteRow | null
      },
      async findMany({ where, orderBy }) {
        const w = where as { storeId?: string }
        const rows = db.estado.convites.filter((c) => !w.storeId || c.storeId === w.storeId)
        const desc = (orderBy as { createdAt?: string } | undefined)?.createdAt === "desc"
        rows.sort((a, b) =>
          desc ? b.createdAt.getTime() - a.createdAt.getTime() : a.createdAt.getTime() - b.createdAt.getTime(),
        )
        return rows as ConviteRow[]
      },
      async create({ data }) {
        const d = data as Record<string, unknown>
        if (db.estado.convites.some((c) => c.tokenHash === d.tokenHash)) {
          throw new Error("unique constraint: contador_convites.tokenHash")
        }
        // Índice parcial único da 0015: no máximo 1 convite ABERTO por (email, storeId).
        const aberto = db.estado.convites.find(
          (c) => c.email === d.email && c.storeId === d.storeId && !c.usadoEm && !c.revogadoEm,
        )
        if (aberto) throw new Error("unique constraint: contador_convites_aberto_uk")
        const agora = agoraFake()
        const row: Mut<ConviteRow> = {
          id: proxId("cnv"),
          email: d.email as string,
          storeId: d.storeId as string,
          papel: (d.papel as ConviteRow["papel"]) ?? "LEITURA",
          tokenHash: d.tokenHash as string,
          expiraEm: d.expiraEm as Date,
          usadoEm: null,
          revogadoEm: null,
          revogadoPorId: null,
          criadoPorId: d.criadoPorId as string,
          createdAt: agora,
          updatedAt: agora,
        }
        db.estado.convites.push(row)
        return row as ConviteRow
      },
      async updateMany({ where, data }) {
        const w = where as {
          id?: string
          email?: string
          storeId?: string
          usadoEm?: null
          revogadoEm?: null
          expiraEm?: { gt: Date }
        }
        const alvo = db.estado.convites.filter((c) => {
          if (w.id !== undefined && c.id !== w.id) return false
          if (w.email !== undefined && c.email !== w.email) return false
          if (w.storeId !== undefined && c.storeId !== w.storeId) return false
          if ("usadoEm" in w && !casaNulo(c.usadoEm, w.usadoEm)) return false
          if ("revogadoEm" in w && !casaNulo(c.revogadoEm, w.revogadoEm)) return false
          if (w.expiraEm?.gt && !(c.expiraEm.getTime() > w.expiraEm.gt.getTime())) return false
          return true
        })
        for (const c of alvo) {
          aplicarData(c as unknown as Record<string, unknown>, data as Record<string, unknown>, agoraFake())
        }
        return { count: alvo.length }
      },
    },

    contadorAcesso: {
      async findUnique({ where }) {
        const k = where.usuarioId_storeId
        const row = db.estado.acessos.find((a) => a.usuarioId === k.usuarioId && a.storeId === k.storeId)
        return (row ?? null) as AcessoRow | null
      },
      async findFirst({ where }) {
        const w = where as { id?: string; storeId?: string }
        const row = db.estado.acessos.find(
          (a) => (w.id === undefined || a.id === w.id) && (w.storeId === undefined || a.storeId === w.storeId),
        )
        return (row ?? null) as AcessoRow | null
      },
      async findMany({ where }) {
        const w = where as { storeId?: string; usuarioId?: string; status?: string }
        const rows = db.estado.acessos.filter(
          (a) =>
            (w.storeId === undefined || a.storeId === w.storeId) &&
            (w.usuarioId === undefined || a.usuarioId === w.usuarioId) &&
            (w.status === undefined || a.status === w.status),
        )
        return rows as AcessoRow[]
      },
      async create({ data }) {
        const d = data as Record<string, unknown>
        if (db.estado.acessos.some((a) => a.usuarioId === d.usuarioId && a.storeId === d.storeId)) {
          throw new Error("unique constraint: contador_acessos.(usuarioId, storeId)")
        }
        const agora = agoraFake()
        const row: Mut<AcessoRow> = {
          id: proxId("acs"),
          usuarioId: d.usuarioId as string,
          storeId: d.storeId as string,
          papel: d.papel as AcessoRow["papel"],
          status: (d.status as AcessoRow["status"]) ?? "ATIVO",
          concedidoPorId: d.concedidoPorId as string,
          concedidoEm: (d.concedidoEm as Date) ?? agora,
          suspensoEm: null,
          suspensoPorId: null,
          revogadoEm: null,
          revogadoPorId: null,
          createdAt: agora,
          updatedAt: agora,
        }
        db.estado.acessos.push(row)
        return row as AcessoRow
      },
      async update({ where, data }) {
        const row = db.estado.acessos.find((a) => a.id === where.id)
        if (!row) throw new Error("contador_acessos: registro não encontrado")
        aplicarData(row as unknown as Record<string, unknown>, data as Record<string, unknown>, agoraFake())
        return row as AcessoRow
      },
    },

    contadorSessaoExterna: {
      async findUnique({ where }) {
        const row = db.estado.sessoes.find((s) => s.id === where.id)
        return (row ?? null) as SessaoRow | null
      },
      async create({ data }) {
        const d = data as Record<string, unknown>
        const agora = agoraFake()
        const row: Mut<SessaoRow> = {
          id: proxId("ses"),
          usuarioId: d.usuarioId as string,
          expiraEm: d.expiraEm as Date,
          revogadoEm: null,
          ultimoUsoEm: null,
          ipHash: (d.ipHash as string | null) ?? null,
          userAgentResumo: (d.userAgentResumo as string | null) ?? null,
          createdAt: agora,
          updatedAt: agora,
        }
        db.estado.sessoes.push(row)
        return row as SessaoRow
      },
      async updateMany({ where, data }) {
        const w = where as { id?: string; usuarioId?: string; revogadoEm?: null }
        const alvo = db.estado.sessoes.filter((s) => {
          if (w.id !== undefined && s.id !== w.id) return false
          if (w.usuarioId !== undefined && s.usuarioId !== w.usuarioId) return false
          if ("revogadoEm" in w && !casaNulo(s.revogadoEm, w.revogadoEm)) return false
          return true
        })
        for (const s of alvo) {
          aplicarData(s as unknown as Record<string, unknown>, data as Record<string, unknown>, agoraFake())
        }
        return { count: alvo.length }
      },
    },

    contadorEvento: {
      async create({ data }) {
        const row = { id: proxId("ev"), ...data }
        db.estado.eventos.push(row)
        return { id: row.id }
      },
      async findFirst({ where }) {
        const w = where as { tipo?: string; entidadeId?: string }
        const row = db.estado.eventos.find(
          (e) =>
            (w.tipo === undefined || e.tipo === w.tipo) &&
            (w.entidadeId === undefined || e.entidadeId === w.entidadeId),
        )
        return row ? { id: row.id as string } : null
      },
    },
  }

  Object.assign(db, ops)

  // Transações SERIALIZADAS com rollback real (mesmo padrão do fake do fechamento).
  let fila: Promise<unknown> = Promise.resolve()
  db.$transaction = <T,>(fn: (tx: AuthExternaTxClient) => Promise<T>): Promise<T> => {
    const executar = async (): Promise<T> => {
      db.transacoes += 1
      const snapshot = clonar(db.estado)
      try {
        return await fn(ops)
      } catch (e) {
        db.estado = snapshot
        throw e
      }
    }
    const resultado = fila.then(executar, executar)
    fila = resultado.then(
      () => undefined,
      () => undefined,
    )
    return resultado
  }
  return db
}

/* ───────────────────────────── builders de linhas (fixtures) ───────────────────────────── */

const AGORA_FAKE = new Date("2026-08-01T12:00:00.000Z")

export function linhaUsuario(over: Partial<Mut<UsuarioRow>> = {}): Mut<UsuarioRow> {
  return {
    id: "usr-fix",
    email: "contador@escritorio.com",
    nome: "Contador Fixture",
    senhaHash: "$2b$12$fixturefixturefixturefixturefixturefixturefixturefi",
    status: "ATIVO",
    tokenVersion: 1,
    ultimoLoginEm: null,
    createdAt: AGORA_FAKE,
    updatedAt: AGORA_FAKE,
    ...over,
  }
}

export function linhaAcesso(over: Partial<Mut<AcessoRow>> = {}): Mut<AcessoRow> {
  return {
    id: "acs-fix",
    usuarioId: "usr-fix",
    storeId: "loja-1",
    papel: "LEITURA",
    status: "ATIVO",
    concedidoPorId: "admin-1",
    concedidoEm: AGORA_FAKE,
    suspensoEm: null,
    suspensoPorId: null,
    revogadoEm: null,
    revogadoPorId: null,
    createdAt: AGORA_FAKE,
    updatedAt: AGORA_FAKE,
    ...over,
  }
}
