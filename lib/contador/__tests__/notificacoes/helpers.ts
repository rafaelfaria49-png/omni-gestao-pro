/**
 * Fake transacional do repo de avisos (GOAL 017).
 * Serializa `$transaction` como o fake do GOAL 012A.
 */
import type { Competencia } from "@/lib/contador/competencia"
import type { DedupeAlerta, NotificacoesRepo } from "@/lib/contador/notificacoes/repo"
import type {
  CompetenciaAlerta,
  DocumentoAlerta,
  EventoAlertaRow,
  GuiaAlerta,
  NovoEventoAlerta,
  PacoteAlerta,
} from "@/lib/contador/notificacoes/tipos"

export type EstadoFake = {
  competencias: CompetenciaAlerta[]
  documentos: Array<DocumentoAlerta & { competenciaId: string; storeId: string; excluidoEm?: Date | null }>
  guias: Array<GuiaAlerta & { competenciaId: string; storeId: string }>
  pacotes: Array<PacoteAlerta & { competenciaId: string }>
  eventos: Array<EventoAlertaRow & { competenciaId: string; storeId: string; metadata: Record<string, unknown> | null }>
}

export type FakeNotificacoesDb = NotificacoesRepo & {
  estado: EstadoFake
  locks: string[]
  writes: number
  falharCreate: boolean
}

function clonar(e: EstadoFake): EstadoFake {
  return {
    competencias: e.competencias.map((c) => ({ ...c })),
    documentos: e.documentos.map((d) => ({ ...d })),
    guias: e.guias.map((g) => ({ ...g })),
    pacotes: e.pacotes.map((p) => ({ ...p })),
    eventos: e.eventos.map((v) => ({ ...v, metadata: v.metadata ? { ...v.metadata } : null })),
  }
}

function casaDedupe(
  ev: EstadoFake["eventos"][number],
  where: Record<string, unknown>,
): boolean {
  if (ev.competenciaId !== where.competenciaId) return false
  if (where.storeId && ev.storeId !== where.storeId) return false
  if (ev.tipo !== where.tipo) return false
  const meta = ev.metadata ?? {}
  const ands = (where.AND ?? []) as { metadata: { path: string[]; equals: unknown } }[]
  return ands.every((cond) => meta[cond.metadata.path[0]] === cond.metadata.equals)
}

export function fakeRepoNotificacoes(inicial: Partial<EstadoFake> = {}): FakeNotificacoesDb {
  const db = {
    estado: {
      competencias: inicial.competencias ?? [],
      documentos: inicial.documentos ?? [],
      guias: inicial.guias ?? [],
      pacotes: inicial.pacotes ?? [],
      eventos: inicial.eventos ?? [],
    } as EstadoFake,
    locks: [] as string[],
    writes: 0,
    falharCreate: false,
  }

  const leitura = {
    async acharCompetencia(storeId: string, comp: Competencia) {
      return (
        db.estado.competencias.find(
          (c) => c.storeId === storeId && c.ano === comp.ano && c.mes === comp.mes,
        ) ?? null
      )
    },
    async listarDocumentos(competenciaId: string, storeId: string) {
      return db.estado.documentos
        .filter((d) => d.competenciaId === competenciaId && d.storeId === storeId && !d.excluidoEm)
        .map(({ id, status, titulo, vencimento }) => ({ id, status, titulo, vencimento }))
    },
    async listarGuias(competenciaId: string, storeId: string) {
      return db.estado.guias
        .filter((g) => g.competenciaId === competenciaId && g.storeId === storeId)
        .map(({ id, titulo, vencimento, pagaEm }) => ({ id, titulo, vencimento, pagaEm }))
    },
    async listarPacotes(competenciaId: string) {
      return db.estado.pacotes.filter((p) => p.competenciaId === competenciaId).map(({ versao }) => ({ versao }))
    },
    async listarEventos(competenciaId: string, storeId: string, tipos: readonly string[]) {
      return db.estado.eventos.filter(
        (e) => e.competenciaId === competenciaId && e.storeId === storeId && tipos.includes(e.tipo),
      )
    },
  }

  let fila: Promise<unknown> = Promise.resolve()

  const registrarEventoUnico = async (evento: NovoEventoAlerta, dedupe: DedupeAlerta) => {
    const executar = async () => {
      const snapshot = clonar(db.estado)
      try {
        db.locks.push(`${dedupe.competenciaId}|${evento.storeId}`)
        const existente = db.estado.eventos.find((e) =>
          casaDedupe(e, {
            competenciaId: dedupe.competenciaId,
            storeId: evento.storeId,
            tipo: dedupe.tipo,
            AND: [
              { metadata: { path: ["regra"], equals: dedupe.regra } },
              { metadata: { path: ["alvo"], equals: dedupe.alvo } },
              { metadata: { path: ["janela"], equals: dedupe.janela } },
            ],
          }),
        )
        if (existente) return { criado: false }
        if (db.falharCreate) throw new Error("falha simulada ao criar evento")
        db.writes += 1
        db.estado.eventos.push({
          id: `ev-${db.estado.eventos.length + 1}`,
          tipo: evento.tipo,
          entidadeId: evento.entidadeId,
          metadata: { ...evento.metadata },
          createdAt: new Date("2026-08-19T12:00:00.000Z"),
          competenciaId: evento.competenciaId,
          storeId: evento.storeId,
        })
        return { criado: true }
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
    return resultado as Promise<{ criado: boolean }>
  }

  return Object.assign(db, leitura, { registrarEventoUnico }) as FakeNotificacoesDb
}

export const COMP = { ano: 2026, mes: 8 } as const
export const ESCOPO_A = { storeId: "loja-1", userId: "u-1" } as const
export const ESCOPO_B = { storeId: "loja-2", userId: "u-2" } as const

export function competenciaRow(
  over: Partial<CompetenciaAlerta> = {},
): CompetenciaAlerta {
  return {
    id: "comp-1",
    storeId: "loja-1",
    ano: 2026,
    mes: 8,
    status: "ABERTA",
    versao: 1,
    snapshot: null,
    ...over,
  }
}
