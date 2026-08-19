import { describe, expect, it } from "vitest"
import {
  avaliarEPersistir,
  listarAlertas,
  rascunhoAlerta,
  tratarAlerta,
  AlertaNaoEncontradoError,
} from "@/lib/contador/notificacoes/service"
import { EVENTO_ALERTA_EMITIDO, EVENTO_ALERTA_TRATADO } from "@/lib/contador/notificacoes/tipos"
import { COMP, ESCOPO_A, competenciaRow, fakeRepoNotificacoes } from "./helpers"

const HOJE = new Date("2026-08-31T15:00:00.000Z")
const AMANHA = new Date("2026-09-01T15:00:00.000Z")

function massaPendente(storeId = "loja-1") {
  return fakeRepoNotificacoes({
    competencias: [competenciaRow({ storeId })],
    documentos: [
      {
        id: "doc-1",
        status: "PENDENTE",
        titulo: "Extrato",
        vencimento: null,
        competenciaId: "comp-1",
        storeId,
      },
    ],
  })
}

function contar(repo: ReturnType<typeof massaPendente>, tipo: string) {
  return repo.estado.eventos.filter(
    (e) => e.tipo === tipo && e.metadata?.regra === "documento_pendente",
  )
}

describe("notificacoes · trilha emitido → tratado", () => {
  it("GET revela alerta não materializado e não escreve", async () => {
    const repo = massaPendente()
    const list = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    const aviso = list.avisos.find((a) => a.regra === "documento_pendente")
    expect(aviso).toBeTruthy()
    expect(aviso?.materializado).toBe(false)
    expect(repo.writes).toBe(0)
    expect(repo.estado.eventos).toHaveLength(0)
  })

  it("tratar direto materializa 1 emitido + 1 tratado na mesma trilha", async () => {
    const repo = massaPendente()
    const list = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    const id = list.avisos.find((a) => a.regra === "documento_pendente")!.id
    await tratarAlerta(ESCOPO_A, COMP, id, repo, HOJE)
    expect(contar(repo, EVENTO_ALERTA_EMITIDO)).toHaveLength(1)
    expect(contar(repo, EVENTO_ALERTA_TRATADO)).toHaveLength(1)
  })

  it("segunda chamada tratar continua 1 emitido + 1 tratado", async () => {
    const repo = massaPendente()
    const list = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    const id = list.avisos.find((a) => a.regra === "documento_pendente")!.id
    await tratarAlerta(ESCOPO_A, COMP, id, repo, HOJE)
    await tratarAlerta(ESCOPO_A, COMP, id, repo, HOJE)
    expect(contar(repo, EVENTO_ALERTA_EMITIDO)).toHaveLength(1)
    expect(contar(repo, EVENTO_ALERTA_TRATADO)).toHaveLength(1)
  })

  it("alerta já emitido: tratar cria só tratado", async () => {
    const repo = massaPendente()
    const avaliado = await avaliarEPersistir(ESCOPO_A, COMP, repo, HOJE)
    const id = avaliado.avisos.find((a) => a.regra === "documento_pendente")!.id
    expect(contar(repo, EVENTO_ALERTA_EMITIDO)).toHaveLength(1)
    await tratarAlerta(ESCOPO_A, COMP, id, repo, HOJE)
    expect(contar(repo, EVENTO_ALERTA_EMITIDO)).toHaveLength(1)
    expect(contar(repo, EVENTO_ALERTA_TRATADO)).toHaveLength(1)
  })

  it("tratado desaparece do GET", async () => {
    const repo = massaPendente()
    const list = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    const id = list.avisos.find((a) => a.regra === "documento_pendente")!.id
    await tratarAlerta(ESCOPO_A, COMP, id, repo, HOJE)
    const depois = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    expect(depois.avisos.some((a) => a.regra === "documento_pendente")).toBe(false)
    expect(repo.writes).toBe(2)
  })

  it("tratado não gera rascunho", async () => {
    const repo = massaPendente()
    const list = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    const id = list.avisos.find((a) => a.regra === "documento_pendente")!.id
    const antes = await rascunhoAlerta(ESCOPO_A, COMP, id, repo, HOJE)
    expect(antes.estado).toBe("rascunho")
    await tratarAlerta(ESCOPO_A, COMP, id, repo, HOJE)
    await expect(rascunhoAlerta(ESCOPO_A, COMP, id, repo, HOJE)).rejects.toBeInstanceOf(
      AlertaNaoEncontradoError,
    )
  })

  it("nova janela válida gera novo alerta normalmente", async () => {
    const repo = massaPendente()
    const list = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    const id = list.avisos.find((a) => a.regra === "documento_pendente")!.id
    await tratarAlerta(ESCOPO_A, COMP, id, repo, HOJE)
    const nova = await listarAlertas(ESCOPO_A, COMP, repo, AMANHA)
    expect(nova.avisos.some((a) => a.regra === "documento_pendente")).toBe(true)
    const idNovo = nova.avisos.find((a) => a.regra === "documento_pendente")!.id
    expect(idNovo).not.toBe(id)
    await tratarAlerta(ESCOPO_A, COMP, idNovo, repo, AMANHA)
    expect(contar(repo, EVENTO_ALERTA_EMITIDO)).toHaveLength(2)
    expect(contar(repo, EVENTO_ALERTA_TRATADO)).toHaveLength(2)
  })

  it("falha no segundo create da trilha não deixa emitido órfão", async () => {
    const repo = massaPendente()
    const list = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    const id = list.avisos.find((a) => a.regra === "documento_pendente")!.id
    repo.falharNoSegundoCreate = true
    await expect(tratarAlerta(ESCOPO_A, COMP, id, repo, HOJE)).rejects.toThrow(/falha simulada/)
    expect(repo.estado.eventos).toHaveLength(0)
  })
})
