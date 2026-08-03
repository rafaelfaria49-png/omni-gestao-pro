/**
 * GOAL CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 — pacotes oficiais do portal.
 *
 * Fakes in-memory (FechamentoRepo completo, storage de pacote, eventos). Prova:
 * download com evento externo ANTES da URL e TTL ≤ 300, confirmação de
 * recebimento IDEMPOTENTE (2ª chamada = mesmo estado, 1 só evento) e
 * pseudonimização do gerador interno na listagem.
 */
import { describe, expect, it } from "vitest"
import {
  CompetenciaNaoEncontradaError,
  PacoteNaoEncontradoError,
  type CompetenciaFechamentoRow,
  type FechamentoRepo,
  type PacoteRow,
  type StoragePacotePort,
} from "@/lib/contador/fechamento/service"
import {
  autorizarDownloadPacotePortal,
  confirmarRecebimentoPacotePortal,
  listarPacotesPortal,
} from "../pacotes"
import { CRIADO_EM_FAKE, criarRepoEventosFalso, escopoExternoFake } from "./helpers"

const AGORA = new Date("2026-08-01T12:00:00.000Z")
const COMP = Object.freeze({ ano: 2026, mes: 7 })

function linhaCompetencia(over: Partial<CompetenciaFechamentoRow> = {}): CompetenciaFechamentoRow {
  return {
    id: "comp-1",
    storeId: "loja-1",
    ano: 2026,
    mes: 7,
    status: "FECHADA",
    versao: 1,
    snapshot: null,
    snapshotHash: "f".repeat(64),
    fechadaEm: AGORA,
    fechadaPorId: "admin-user-7",
    reabertaEm: null,
    updatedAt: AGORA,
    ...over,
  }
}

function linhaPacote(over: Partial<PacoteRow> = {}): PacoteRow {
  return {
    id: "pct-1",
    competenciaId: "comp-1",
    versao: 1,
    manifestoHash: "b".repeat(64),
    storageRef: "contador/loja-1/2026-07/pacotes/v1/hash.zip",
    bytes: 4096,
    geradoPorTipo: "interno",
    geradoPorId: "admin-user-7",
    geradoEm: AGORA,
    ...over,
  }
}

function repoFalso(comps: CompetenciaFechamentoRow[], pacotes: PacoteRow[]): FechamentoRepo {
  const naoUsado = (): never => {
    throw new Error("método não usado pelo portal")
  }
  return {
    getOrCreateCompetencia: naoUsado,
    acharCompetencia: async (storeId, comp) =>
      comps.find((c) => c.storeId === storeId && c.ano === comp.ano && c.mes === comp.mes) ?? null,
    listarDocumentosParaSnapshot: naoUsado,
    aplicarFechamento: naoUsado,
    aplicarReabertura: naoUsado,
    listarPacotes: async (competenciaId) => pacotes.filter((p) => p.competenciaId === competenciaId),
    acharPacote: async (competenciaId, versao) =>
      pacotes.find((p) => p.competenciaId === competenciaId && p.versao === versao) ?? null,
    listarItensPacote: naoUsado,
    registrarEventoUnico: naoUsado,
    // O portal NUNCA grava evento pelo repo de fechamento (atorTipo seria interno).
    registrarEvento: naoUsado,
  }
}

function storageFalso(objetos: ReadonlySet<string>, ordem: string[]): StoragePacotePort {
  return {
    enviarPacote: async () => {
      throw new Error("portal nunca envia pacote")
    },
    verificarExistencia: async (ref) => objetos.has(ref),
    criarDownloadAssinado: async (_ref, _nome, expiresInSec) => {
      ordem.push("url")
      return { signedUrl: "https://r2.example/pacote.zip?assinatura=x", expiresInSec: expiresInSec ?? 300 }
    },
  }
}

describe("listarPacotesPortal", () => {
  it("lista versões e pseudonimiza geradoPorId INTERNO", async () => {
    const repo = repoFalso([linhaCompetencia()], [linhaPacote()])
    const lista = await listarPacotesPortal(escopoExternoFake(), COMP, { repo })
    expect(lista).toHaveLength(1)
    expect(lista[0]).toMatchObject({ versao: 1, geradoPorTipo: "interno", bytes: 4096 })
    expect(lista[0]!.geradoPorId).toMatch(/^u_[0-9a-f]{16}$/)
    expect(lista[0]!.geradoPorId).not.toBe("admin-user-7")
    expect(JSON.stringify(lista)).not.toContain("hash.zip")
  })

  it("competência sem linha → lista vazia (estado honesto, sem criar nada)", async () => {
    const lista = await listarPacotesPortal(escopoExternoFake(), COMP, { repo: repoFalso([], []) })
    expect(lista).toEqual([])
  })
})

describe("autorizarDownloadPacotePortal", () => {
  function montar(comps: CompetenciaFechamentoRow[], pacotes: PacoteRow[], objetos: ReadonlySet<string>) {
    const ordem: string[] = []
    const eventos = criarRepoEventosFalso()
    const registrarOriginal = eventos.registrarEvento.bind(eventos)
    eventos.registrarEvento = async (e) => {
      ordem.push("evento")
      return registrarOriginal(e)
    }
    return { ordem, eventos, storage: storageFalso(objetos, ordem), repo: repoFalso(comps, pacotes) }
  }

  it("grava pacote_baixado externo com ipHash/UA ANTES da URL; DTO sem storageRef", async () => {
    const pacote = linhaPacote()
    const { ordem, eventos, storage, repo } = montar([linhaCompetencia()], [pacote], new Set([pacote.storageRef]))
    const escopo = escopoExternoFake({ usuarioId: "usr-ext-1" })
    const dto = await autorizarDownloadPacotePortal(
      escopo,
      COMP,
      1,
      { escopo, ip: "203.0.113.5", userAgent: "curl/8 teste" },
      { repo, storage, eventos },
    )
    expect(ordem).toEqual(["evento", "url"])
    expect(dto).toMatchObject({ versao: 1, nomeArquivo: "pacote-contador-2026-07-v1.zip" })
    expect(dto.expiresInSec).toBeLessThanOrEqual(300)
    expect(JSON.stringify(dto)).not.toContain(pacote.storageRef)

    const evento = eventos.eventos[0]!
    expect(evento).toMatchObject({
      tipo: "pacote_baixado",
      atorTipo: "externo",
      atorId: "usr-ext-1",
      competenciaId: "comp-1",
      metadata: { competencia: "2026-07", versao: 1, manifestoHash: pacote.manifestoHash, bytes: 4096, expiresInSec: 300 },
    })
    expect(evento.ip).toMatch(/^[0-9a-f]{16}$/)
    expect(evento.userAgent).toBe("curl/8 teste")
    expect(JSON.stringify(evento.metadata)).not.toContain(pacote.storageRef)
  })

  it("competência/pacote inexistente ou sem blob → 404 de domínio, sem evento", async () => {
    const pacote = linhaPacote()
    const { eventos, storage, repo } = montar([linhaCompetencia()], [pacote], new Set())
    const escopo = escopoExternoFake()
    await expect(
      autorizarDownloadPacotePortal(escopo, { ano: 2025, mes: 1 }, 1, { escopo }, { repo, storage, eventos }),
    ).rejects.toBeInstanceOf(CompetenciaNaoEncontradaError)
    await expect(
      autorizarDownloadPacotePortal(escopo, COMP, 99, { escopo }, { repo, storage, eventos }),
    ).rejects.toBeInstanceOf(PacoteNaoEncontradoError)
    await expect(
      autorizarDownloadPacotePortal(escopo, COMP, 1, { escopo }, { repo, storage, eventos }),
    ).rejects.toBeInstanceOf(PacoteNaoEncontradoError)
    expect(eventos.eventos).toEqual([])
  })
})

describe("confirmarRecebimentoPacotePortal (idempotente)", () => {
  it("2ª chamada devolve o MESMO estado e grava 1 só evento", async () => {
    const pacote = linhaPacote()
    const repo = repoFalso([linhaCompetencia()], [pacote])
    const eventos = criarRepoEventosFalso()
    const escopo = escopoExternoFake({ usuarioId: "usr-ext-1" })
    const deps = { repo, eventos }

    const primeira = await confirmarRecebimentoPacotePortal(escopo, COMP, 1, { escopo }, deps)
    // O instante já na 1ª resposta é o DA TRILHA (criadoEm do evento gravado).
    expect(primeira).toEqual({ confirmado: true, confirmadoEm: CRIADO_EM_FAKE.toISOString() })
    expect(eventos.eventos).toHaveLength(1)
    expect(eventos.eventos[0]).toMatchObject({
      tipo: "pacote_recebimento_confirmado",
      atorTipo: "externo",
      atorId: "usr-ext-1",
      competenciaId: "comp-1",
      metadata: { competencia: "2026-07", versao: 1, manifestoHash: pacote.manifestoHash },
    })

    const segunda = await confirmarRecebimentoPacotePortal(escopo, COMP, 1, { escopo }, deps)
    // Mesma confirmação: resposta IDÊNTICA à 1ª, trilha intocada.
    expect(segunda).toEqual(primeira)
    expect(eventos.eventos).toHaveLength(1)
  })

  it("outro contador confirma de forma independente (dedupe é por ator)", async () => {
    const repo = repoFalso([linhaCompetencia()], [linhaPacote()])
    const eventos = criarRepoEventosFalso()
    const primeiro = escopoExternoFake({ usuarioId: "usr-ext-1" })
    const segundo = escopoExternoFake({ usuarioId: "usr-ext-2" })
    await confirmarRecebimentoPacotePortal(primeiro, COMP, 1, { escopo: primeiro }, { repo, eventos })
    await confirmarRecebimentoPacotePortal(segundo, COMP, 1, { escopo: segundo }, { repo, eventos })
    expect(eventos.eventos).toHaveLength(2)
    expect(eventos.eventos.map((e) => e.atorId)).toEqual(["usr-ext-1", "usr-ext-2"])
  })

  it("versão inexistente → 404, nunca confirmação vazia", async () => {
    const repo = repoFalso([linhaCompetencia()], [linhaPacote()])
    const eventos = criarRepoEventosFalso()
    const escopo = escopoExternoFake()
    await expect(
      confirmarRecebimentoPacotePortal(escopo, COMP, 77, { escopo }, { repo, eventos }),
    ).rejects.toBeInstanceOf(PacoteNaoEncontradoError)
    expect(eventos.eventos).toEqual([])
  })
})
