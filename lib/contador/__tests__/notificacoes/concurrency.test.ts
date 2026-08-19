import { describe, expect, it } from "vitest"
import { avaliarEPersistir, listarAlertas, tratarAlerta } from "@/lib/contador/notificacoes/service"
import { EVENTO_ALERTA_EMITIDO, EVENTO_ALERTA_TRATADO } from "@/lib/contador/notificacoes/tipos"
import { COMP, ESCOPO_A, competenciaRow, fakeRepoNotificacoes } from "./helpers"

const HOJE = new Date("2026-08-31T15:00:00.000Z")

describe("notificacoes · concorrência", () => {
  it("duas avaliações concorrentes geram um único alerta_emitido por chave", async () => {
    const repo = fakeRepoNotificacoes({
      competencias: [competenciaRow()],
      documentos: [
        {
          id: "doc-1",
          status: "PENDENTE",
          titulo: "Extrato",
          vencimento: null,
          competenciaId: "comp-1",
          storeId: "loja-1",
        },
      ],
    })

    const [r1, r2] = await Promise.all([
      avaliarEPersistir(ESCOPO_A, COMP, repo, HOJE),
      avaliarEPersistir(ESCOPO_A, COMP, repo, HOJE),
    ])

    const docs = repo.estado.eventos.filter(
      (e) => e.tipo === EVENTO_ALERTA_EMITIDO && e.metadata?.regra === "documento_pendente",
    )
    expect(docs).toHaveLength(1)
    expect(r1.emitidos + r2.emitidos).toBeGreaterThanOrEqual(1)
    expect(repo.locks.length).toBeGreaterThanOrEqual(2)
    expect(repo.locks.every((l) => l === "comp-1|loja-1")).toBe(true)
  })

  it("cinco avaliações simultâneas continuam em um evento por chave", async () => {
    const repo = fakeRepoNotificacoes({
      competencias: [competenciaRow()],
      documentos: [
        {
          id: "doc-1",
          status: "PENDENTE",
          titulo: "Extrato",
          vencimento: null,
          competenciaId: "comp-1",
          storeId: "loja-1",
        },
      ],
    })
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => avaliarEPersistir(ESCOPO_A, COMP, repo, HOJE)),
    )
    expect(rs.reduce((n, r) => n + r.emitidos, 0)).toBeGreaterThanOrEqual(1)
    expect(
      repo.estado.eventos.filter(
        (e) => e.tipo === EVENTO_ALERTA_EMITIDO && e.metadata?.regra === "documento_pendente",
      ),
    ).toHaveLength(1)
  })

  it("duas tratativas concorrentes geram 1 emitido + 1 tratado", async () => {
    const repo = fakeRepoNotificacoes({
      competencias: [competenciaRow()],
      documentos: [
        {
          id: "doc-1",
          status: "PENDENTE",
          titulo: "Extrato",
          vencimento: null,
          competenciaId: "comp-1",
          storeId: "loja-1",
        },
      ],
    })
    const list = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    const id = list.avisos.find((a) => a.regra === "documento_pendente")!.id
    await Promise.all([
      tratarAlerta(ESCOPO_A, COMP, id, repo, HOJE),
      tratarAlerta(ESCOPO_A, COMP, id, repo, HOJE),
    ])
    expect(
      repo.estado.eventos.filter(
        (e) => e.tipo === EVENTO_ALERTA_EMITIDO && e.metadata?.regra === "documento_pendente",
      ),
    ).toHaveLength(1)
    expect(
      repo.estado.eventos.filter(
        (e) => e.tipo === EVENTO_ALERTA_TRATADO && e.metadata?.regra === "documento_pendente",
      ),
    ).toHaveLength(1)
  })

  it("avaliar e tratar concorrentes não duplicam emitido", async () => {
    const repo = fakeRepoNotificacoes({
      competencias: [competenciaRow()],
      documentos: [
        {
          id: "doc-1",
          status: "PENDENTE",
          titulo: "Extrato",
          vencimento: null,
          competenciaId: "comp-1",
          storeId: "loja-1",
        },
      ],
    })
    const list = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    const id = list.avisos.find((a) => a.regra === "documento_pendente")!.id
    await Promise.all([
      avaliarEPersistir(ESCOPO_A, COMP, repo, HOJE),
      tratarAlerta(ESCOPO_A, COMP, id, repo, HOJE),
    ])
    expect(
      repo.estado.eventos.filter(
        (e) => e.tipo === EVENTO_ALERTA_EMITIDO && e.metadata?.regra === "documento_pendente",
      ),
    ).toHaveLength(1)
    expect(
      repo.estado.eventos.filter(
        (e) => e.tipo === EVENTO_ALERTA_TRATADO && e.metadata?.regra === "documento_pendente",
      ),
    ).toHaveLength(1)
  })
})
