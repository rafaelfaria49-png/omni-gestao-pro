import { describe, expect, it } from "vitest"
import {
  avaliarEPersistir,
  listarAlertas,
  rascunhoAlerta,
  tratarAlerta,
  AlertaNaoEncontradoError,
} from "@/lib/contador/notificacoes/service"
import { EVENTO_ALERTA_EMITIDO, EVENTO_ALERTA_TRATADO, EVENTO_ALTERACAO_POS_FECHAMENTO } from "@/lib/contador/notificacoes/tipos"
import { alertIdDe, montarChave, janelaDiaCivil } from "@/lib/contador/notificacoes/chave"
import { diaLocal } from "@/lib/contador/status/vencido"
import {
  COMP,
  ESCOPO_A,
  ESCOPO_B,
  competenciaRow,
  fakeRepoNotificacoes,
} from "./helpers"

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

describe("notificacoes · GET somente leitura", () => {
  it("lista avisos atuais sem INSERT/UPDATE", async () => {
    const repo = massaPendente()
    const r = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    expect(r.avisos.some((a) => a.regra === "documento_pendente")).toBe(true)
    expect(repo.writes).toBe(0)
    expect(repo.estado.eventos).toHaveLength(0)
  })

  it("GET não materializa alerta_emitido", async () => {
    const repo = massaPendente()
    await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    expect(repo.estado.eventos.filter((e) => e.tipo === EVENTO_ALERTA_EMITIDO)).toHaveLength(0)
  })
})

describe("notificacoes · POST avaliar dedupe", () => {
  it("primeira avaliação persiste alerta_emitido; a segunda na mesma janela não duplica", async () => {
    const repo = massaPendente()
    const a1 = await avaliarEPersistir(ESCOPO_A, COMP, repo, HOJE)
    const a2 = await avaliarEPersistir(ESCOPO_A, COMP, repo, HOJE)
    expect(a1.emitidos).toBeGreaterThan(0)
    expect(a2.emitidos).toBe(0)
    const emitidos = repo.estado.eventos.filter((e) => e.tipo === EVENTO_ALERTA_EMITIDO)
    const docs = emitidos.filter((e) => e.metadata?.regra === "documento_pendente")
    expect(docs).toHaveLength(1)
  })
})

describe("notificacoes · tratado e nova janela", () => {
  it("tratado suprime a mesma janela e a nova janela reemite", async () => {
    const repo = massaPendente()
    const list = await avaliarEPersistir(ESCOPO_A, COMP, repo, HOJE)
    const aviso = list.avisos.find((a) => a.regra === "documento_pendente")
    expect(aviso).toBeTruthy()
    await tratarAlerta(ESCOPO_A, COMP, aviso!.id, repo, HOJE)

    const mesma = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    expect(mesma.avisos.some((a) => a.regra === "documento_pendente")).toBe(false)

    const nova = await avaliarEPersistir(ESCOPO_A, COMP, repo, AMANHA)
    expect(nova.avisos.some((a) => a.regra === "documento_pendente")).toBe(true)
    const docs = repo.estado.eventos.filter(
      (e) => e.tipo === EVENTO_ALERTA_EMITIDO && e.metadata?.regra === "documento_pendente",
    )
    expect(docs.length).toBeGreaterThanOrEqual(2)
    expect(docs[0]!.metadata?.janela).not.toBe(docs[1]!.metadata?.janela)
  })

  it("tratar é idempotente (um único alerta_tratado por chave)", async () => {
    const repo = massaPendente()
    const list = await avaliarEPersistir(ESCOPO_A, COMP, repo, HOJE)
    const id = list.avisos.find((a) => a.regra === "documento_pendente")!.id
    await tratarAlerta(ESCOPO_A, COMP, id, repo, HOJE)
    await tratarAlerta(ESCOPO_A, COMP, id, repo, HOJE)
    expect(repo.estado.eventos.filter((e) => e.tipo === EVENTO_ALERTA_TRATADO)).toHaveLength(1)
  })
})

describe("notificacoes · alertId determinístico e cross-store", () => {
  it("o id é derivado da chave e não de metadata do cliente", async () => {
    const repo = massaPendente()
    const list = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    const aviso = list.avisos.find((a) => a.regra === "documento_pendente")
    const janela = janelaDiaCivil(diaLocal(HOJE))
    const esperado = alertIdDe(
      montarChave({
        regra: "documento_pendente",
        alvo: "doc-1",
        storeId: "loja-1",
        competenciaId: "comp-1",
        janela,
      }),
    )
    expect(esperado).toMatch(/^[0-9a-f]{64}$/)
    expect(aviso?.id).toBe(esperado)
  })

  it("loja B não vê nem trata alerta da loja A (fail-closed)", async () => {
    const repoA = massaPendente("loja-1")
    const listA = await avaliarEPersistir(ESCOPO_A, COMP, repoA, HOJE)
    const idA = listA.avisos.find((a) => a.regra === "documento_pendente")!.id

    const repoB = fakeRepoNotificacoes({
      competencias: [competenciaRow({ id: "comp-2", storeId: "loja-2" })],
      documentos: [
        {
          id: "doc-1",
          status: "PENDENTE",
          titulo: "Extrato",
          vencimento: null,
          competenciaId: "comp-2",
          storeId: "loja-2",
        },
      ],
      eventos: repoA.estado.eventos,
    })

    const listB = await listarAlertas(ESCOPO_B, COMP, repoB, HOJE)
    expect(listB.avisos.every((a) => a.id !== idA)).toBe(true)
    await expect(tratarAlerta(ESCOPO_B, COMP, idA, repoB, HOJE)).rejects.toBeInstanceOf(
      AlertaNaoEncontradoError,
    )
  })
})

describe("notificacoes · rascunho", () => {
  it("rascunho é pt-BR, RASCUNHO, copiar, envio proibido, sem dados proibidos", async () => {
    const repo = massaPendente()
    const list = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    const id = list.avisos.find((a) => a.regra === "documento_pendente")!.id
    const r = await rascunhoAlerta(ESCOPO_A, COMP, id, repo, HOJE)
    expect(r.estado).toBe("rascunho")
    expect(r.idioma).toBe("pt-BR")
    expect(r.acao).toBe("copiar")
    expect(r.envio).toBe("proibido")
    expect(r.texto.startsWith("RASCUNHO")).toBe(true)
    expect(r.texto).not.toMatch(/storageRef|signedUrl|token|cpf|imei|valorCentavos|@/i)
    expect(r.texto).not.toContain("http")
  })

  it("rascunho de guia inclui microcopy da agenda e omite valor", async () => {
    const repo = fakeRepoNotificacoes({
      competencias: [competenciaRow()],
      guias: [
        {
          id: "g1",
          titulo: "DAS",
          vencimento: new Date("2026-08-31T00:00:00.000Z"),
          pagaEm: null,
          competenciaId: "comp-1",
          storeId: "loja-1",
        },
      ],
    })
    const list = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    const guia = list.avisos.find((a) => a.regra === "guia_vencendo" || a.regra === "guia_vencida")
    expect(guia).toBeTruthy()
    const r = await rascunhoAlerta(ESCOPO_A, COMP, guia!.id, repo, HOJE)
    expect(r.texto).toContain("informado pelo responsável")
    expect(r.texto).not.toMatch(/R\$|centavos|valor/i)
  })
})

describe("notificacoes · alteracao só de evento persistido", () => {
  it("sem evento persistido não há alerta, mesmo com competência fechada", async () => {
    const repo = fakeRepoNotificacoes({
      competencias: [competenciaRow({ status: "FECHADA" })],
    })
    const r = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    expect(r.avisos.some((a) => a.regra === "alteracao_pos_fechamento")).toBe(false)
  })

  it("evento persistido gera alerta", async () => {
    const repo = fakeRepoNotificacoes({
      competencias: [competenciaRow({ status: "FECHADA" })],
      eventos: [
        {
          id: "ev-div",
          tipo: EVENTO_ALTERACAO_POS_FECHAMENTO,
          entidadeId: "comp-1",
          metadata: { diffHash: "deadbeef", versao: 1 },
          createdAt: HOJE,
          competenciaId: "comp-1",
          storeId: "loja-1",
        },
      ],
    })
    const r = await listarAlertas(ESCOPO_A, COMP, repo, HOJE)
    expect(r.avisos.some((a) => a.regra === "alteracao_pos_fechamento" && a.alvo === "deadbeef")).toBe(
      true,
    )
  })
})

describe("notificacoes · falha da transação", () => {
  it("create que falha não deixa evento órfão", async () => {
    const repo = massaPendente()
    repo.falharCreate = true
    await expect(avaliarEPersistir(ESCOPO_A, COMP, repo, HOJE)).rejects.toThrow(/falha simulada/)
    expect(repo.estado.eventos).toHaveLength(0)
    repo.falharCreate = false
    const r = await avaliarEPersistir(ESCOPO_A, COMP, repo, HOJE)
    expect(r.emitidos).toBeGreaterThan(0)
  })
})
