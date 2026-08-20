/**
 * GOAL 019 — job de retenção: dry-run sem escrita, gate de apply, idempotência,
 * blob ausente e preservação de registro/evento.
 *
 * O fake de leitura devolve massa sintética; o fake de escrita REGISTRA cada chamada
 * para que "dry-run não escreve" seja verificado por ausência de chamada, e não por
 * inspeção do resultado.
 */
import { beforeEach, describe, expect, it } from "vitest"
import {
  ENV_RETENCAO_APPLY,
  EVENTO_DOCUMENTO_BLOB_DESCARTADO,
  EVENTO_PACOTE_ARTEFATO_DESCARTADO,
  RetencaoApplyBloqueadoError,
  RetencaoEscritaAusenteError,
  applyHabilitado,
  executarJobRetencao,
} from "./job"
import type {
  CandidatoRetencao,
  EventoDescarte,
  RetencaoEscritaPort,
  RetencaoLeituraPort,
} from "./tipos"
import type { CategoriaDocumentoRetencao } from "./politica"
import { metricasSilenciosas } from "@/lib/contador/observabilidade"

const LOJA = "loja-1"
const AGORA = new Date("2026-08-20T12:00:00.000Z")
const ENV_APPLY_ON = { [ENV_RETENCAO_APPLY]: "on" }

function candidato(id: string, over: Partial<CandidatoRetencao> = {}): CandidatoRetencao {
  return {
    id,
    storeId: LOJA,
    competenciaId: `comp-${id}`,
    storageRef: `contador/${LOJA}/2019-01/${id}`,
    bytes: 1_000,
    ...over,
  }
}

/** Porta de leitura configurável. Só devolve o que for explicitamente plantado. */
function leituraFake(
  plano: {
    documentos?: Partial<Record<CategoriaDocumentoRetencao, readonly CandidatoRetencao[]>>
    blobs?: readonly CandidatoRetencao[]
    pacotes?: readonly CandidatoRetencao[]
    protegidos?: number
  } = {},
): RetencaoLeituraPort & { chamadasCandidatos: string[] } {
  const chamadasCandidatos: string[] = []
  return {
    chamadasCandidatos,
    async documentosAlemDaRetencao({ categoria }) {
      chamadasCandidatos.push(`documentos:${categoria}`)
      return plano.documentos?.[categoria] ?? []
    },
    async contarDocumentosProtegidos() {
      return plano.protegidos ?? 0
    },
    async blobsSoftDeletadosAlemDaRetencao() {
      chamadasCandidatos.push("blobs")
      return plano.blobs ?? []
    },
    async contarBlobsSoftDeletadosProtegidos() {
      return plano.protegidos ?? 0
    },
    async pacotesAlemDaRetencao() {
      chamadasCandidatos.push("pacotes")
      return plano.pacotes ?? []
    },
    async contarPacotesProtegidos() {
      return plano.protegidos ?? 0
    },
  }
}

type EscritaFake = RetencaoEscritaPort & {
  removidos: string[]
  eventos: EventoDescarte[]
  existentes: Set<string>
}

function escritaFake(existentes: readonly string[] = []): EscritaFake {
  const estado: EscritaFake = {
    removidos: [],
    eventos: [],
    existentes: new Set(existentes),
    async blobExiste(ref) {
      return estado.existentes.has(ref)
    },
    async removerBlob(ref) {
      estado.removidos.push(ref)
      estado.existentes.delete(ref)
    },
    async registrarEventoDescarte(evento) {
      estado.eventos.push(evento)
    },
  }
  return estado
}

/** Porta de escrita que EXPLODE em qualquer uso — a sentinela do dry-run. */
const escritaProibida: RetencaoEscritaPort = {
  async blobExiste() {
    throw new Error("dry-run consultou o storage")
  },
  async removerBlob() {
    throw new Error("dry-run removeu blob")
  },
  async registrarEventoDescarte() {
    throw new Error("dry-run escreveu evento")
  },
}

const base = { metricas: metricasSilenciosas }

beforeEach(() => {
  delete process.env[ENV_RETENCAO_APPLY]
})

describe("modo padrão e dry-run", () => {
  it("o modo padrão é dry-run — sem passar `modo`", async () => {
    const rel = await executarJobRetencao(
      { ...base, leitura: leituraFake() },
      { storeIds: [LOJA], agora: AGORA },
    )
    expect(rel.modo).toBe("dry-run")
  })

  it("dry-run NÃO toca a porta de escrita, nem para consultar existência", async () => {
    const leitura = leituraFake({
      documentos: { FINANCEIRO: [candidato("d1")] },
      blobs: [candidato("b1")],
      pacotes: [candidato("p1", { versao: 1 })],
    })
    const rel = await executarJobRetencao(
      { ...base, leitura, escrita: escritaProibida },
      { storeIds: [LOJA], modo: "dry-run", agora: AGORA },
    )
    expect(rel.documentos.candidatos).toBe(1)
    expect(rel.blobsSoftDeletados.candidatos).toBe(1)
    expect(rel.pacotes.candidatos).toBe(1)
    expect(rel.erros).toEqual([])
  })

  it("dry-run contabiliza candidatos, bytes, protegidos e liberação estimada", async () => {
    const leitura = leituraFake({
      documentos: { FINANCEIRO: [candidato("d1", { bytes: 2_048 })], OUTRO: [candidato("d2", { bytes: 1_024 })] },
      blobs: [candidato("b1", { bytes: 512, categoria: "FISCAL" })],
      pacotes: [candidato("p1", { bytes: 4_096, versao: 3 })],
      protegidos: 2,
    })
    const rel = await executarJobRetencao({ ...base, leitura }, { storeIds: [LOJA], agora: AGORA })

    expect(rel.documentos.candidatos).toBe(2)
    expect(rel.documentos.bytesCandidatos).toBe(3_072)
    expect(rel.documentos.porCategoria).toEqual({ FINANCEIRO: 1, OUTRO: 1 })
    expect(rel.blobsSoftDeletados.bytesCandidatos).toBe(512)
    expect(rel.pacotes.bytesCandidatos).toBe(4_096)
    expect(rel.bytesEstimadosLiberados).toBe(3_072 + 512 + 4_096)
    // 5 categorias × 2 + blobs 2 + pacotes 2
    expect(rel.protegidosPorPolitica).toBe(14)
    // Nada foi descartado em dry-run.
    expect(rel.documentos.descartados).toBe(0)
    expect(rel.pacotes.descartados).toBe(0)
  })

  it("NUNCA consulta candidatos das categorias PURGE_DISABLED", async () => {
    const leitura = leituraFake()
    await executarJobRetencao({ ...base, leitura }, { storeIds: [LOJA], agora: AGORA })
    expect(leitura.chamadasCandidatos).toContain("documentos:FINANCEIRO")
    expect(leitura.chamadasCandidatos).toContain("documentos:OUTRO")
    expect(leitura.chamadasCandidatos).not.toContain("documentos:FISCAL")
    expect(leitura.chamadasCandidatos).not.toContain("documentos:JURIDICO")
    expect(leitura.chamadasCandidatos).not.toContain("documentos:FOLHA")
  })

  it("o relatório expõe corte `null` para as categorias sem purga", async () => {
    const rel = await executarJobRetencao(
      { ...base, leitura: leituraFake() },
      { storeIds: [LOJA], agora: AGORA },
    )
    expect(rel.cortesDocumentos.FISCAL).toBeNull()
    expect(rel.cortesDocumentos.JURIDICO).toBeNull()
    expect(rel.cortesDocumentos.FOLHA).toBeNull()
    expect(rel.cortesDocumentos.FINANCEIRO).toBe("2021-08-20T12:00:00.000Z")
    expect(rel.cortesDocumentos.OUTRO).toBe("2021-08-20T12:00:00.000Z")
  })
})

describe("gate do modo apply", () => {
  it("apply SEM a flag é bloqueado — e nada é lido ou escrito", async () => {
    const escrita = escritaFake([])
    await expect(
      executarJobRetencao(
        { ...base, leitura: leituraFake({ documentos: { OUTRO: [candidato("d1")] } }), escrita, env: {} },
        { storeIds: [LOJA], modo: "apply", agora: AGORA },
      ),
    ).rejects.toBeInstanceOf(RetencaoApplyBloqueadoError)
    expect(escrita.removidos).toEqual([])
    expect(escrita.eventos).toEqual([])
  })

  it("valor ambíguo não destrava o apply (fail closed)", async () => {
    for (const valor of ["true", "1", "yes", "", "onn", "OFF"]) {
      await expect(
        executarJobRetencao(
          { ...base, leitura: leituraFake(), escrita: escritaFake(), env: { [ENV_RETENCAO_APPLY]: valor } },
          { storeIds: [LOJA], modo: "apply", agora: AGORA },
        ),
        `valor="${valor}"`,
      ).rejects.toBeInstanceOf(RetencaoApplyBloqueadoError)
    }
  })

  it("`on` destrava, com trim e case-insensitive (padrão das flags do HUB)", () => {
    expect(applyHabilitado({ [ENV_RETENCAO_APPLY]: "on" })).toBe(true)
    expect(applyHabilitado({ [ENV_RETENCAO_APPLY]: "  ON  " })).toBe(true)
    expect(applyHabilitado({})).toBe(false)
  })

  it("apply com a flag mas SEM porta de escrita é erro explícito, não silêncio", async () => {
    await expect(
      executarJobRetencao(
        { ...base, leitura: leituraFake(), env: ENV_APPLY_ON },
        { storeIds: [LOJA], modo: "apply", agora: AGORA },
      ),
    ).rejects.toBeInstanceOf(RetencaoEscritaAusenteError)
  })
})

describe("apply — descarte de blob, preservando registro e trilha", () => {
  it("descarta o blob e anexa UM evento por item", async () => {
    const docCand = candidato("d1", { bytes: 2_048 })
    const pacCand = candidato("p1", { bytes: 4_096, versao: 2 })
    const escrita = escritaFake([docCand.storageRef, pacCand.storageRef])
    const rel = await executarJobRetencao(
      {
        ...base,
        leitura: leituraFake({ documentos: { FINANCEIRO: [docCand] }, pacotes: [pacCand] }),
        escrita,
        env: ENV_APPLY_ON,
      },
      { storeIds: [LOJA], modo: "apply", agora: AGORA },
    )

    expect(rel.modo).toBe("apply")
    expect(escrita.removidos).toEqual([docCand.storageRef, pacCand.storageRef])
    expect(rel.documentos.descartados).toBe(1)
    expect(rel.pacotes.descartados).toBe(1)
    expect(escrita.eventos.map((e) => e.tipo)).toEqual([
      EVENTO_DOCUMENTO_BLOB_DESCARTADO,
      EVENTO_PACOTE_ARTEFATO_DESCARTADO,
    ])
  })

  it("a metadata do evento NÃO carrega storageRef nem texto do usuário", async () => {
    const cand = candidato("d1", { bytes: 2_048 })
    const escrita = escritaFake([cand.storageRef])
    await executarJobRetencao(
      { ...base, leitura: leituraFake({ documentos: { OUTRO: [cand] } }), escrita, env: ENV_APPLY_ON },
      { storeIds: [LOJA], modo: "apply", agora: AGORA },
    )
    const evento = escrita.eventos[0]!
    expect(Object.keys(evento.metadata).sort()).toEqual(["bytes", "categoria", "politica"])
    expect(JSON.stringify(evento.metadata)).not.toContain(cand.storageRef)
    expect(JSON.stringify(evento.metadata)).not.toContain("contador/")
    // O registro segue identificável para auditoria pelo id, competência e loja.
    expect(evento.entidadeId).toBe(cand.id)
    expect(evento.competenciaId).toBe(cand.competenciaId)
    expect(evento.storeId).toBe(LOJA)
  })

  it("é IDEMPOTENTE: a segunda execução não remove nem duplica evento", async () => {
    const cand = candidato("d1")
    const escrita = escritaFake([cand.storageRef])
    const deps = {
      ...base,
      leitura: leituraFake({ documentos: { FINANCEIRO: [cand] } }),
      escrita,
      env: ENV_APPLY_ON,
    }
    const opcoes = { storeIds: [LOJA], modo: "apply" as const, agora: AGORA }

    const primeira = await executarJobRetencao(deps, opcoes)
    const segunda = await executarJobRetencao(deps, opcoes)

    expect(primeira.documentos.descartados).toBe(1)
    expect(segunda.documentos.descartados).toBe(0)
    expect(segunda.documentos.jaAusentes).toBe(1)
    expect(escrita.removidos).toHaveLength(1)
    expect(escrita.eventos).toHaveLength(1)
    expect(segunda.erros).toEqual([])
  })

  it("blob AUSENTE é idempotência, não erro fatal", async () => {
    const cand = candidato("d1")
    const escrita = escritaFake([]) // storage vazio: o blob nunca existiu
    const rel = await executarJobRetencao(
      { ...base, leitura: leituraFake({ documentos: { OUTRO: [cand] } }), escrita, env: ENV_APPLY_ON },
      { storeIds: [LOJA], modo: "apply", agora: AGORA },
    )
    expect(rel.documentos.jaAusentes).toBe(1)
    expect(rel.documentos.falhas).toBe(0)
    expect(rel.erros).toEqual([])
    expect(escrita.eventos).toEqual([])
  })

  it("falha isolada de storage não interrompe o job e não vaza mensagem crua", async () => {
    const bom = candidato("ok")
    const ruim = candidato("ruim")
    const escrita = escritaFake([bom.storageRef, ruim.storageRef])
    const original = escrita.removerBlob.bind(escrita)
    escrita.removerBlob = async (ref: string) => {
      if (ref === ruim.storageRef) {
        const e = new Error(`https://bucket.example/${ruim.storageRef}?X-Amz-Signature=deadbeef`)
        e.name = "StorageError"
        throw e
      }
      return original(ref)
    }

    const rel = await executarJobRetencao(
      { ...base, leitura: leituraFake({ documentos: { OUTRO: [ruim, bom] } }), escrita, env: ENV_APPLY_ON },
      { storeIds: [LOJA], modo: "apply", agora: AGORA },
    )

    expect(rel.documentos.descartados).toBe(1)
    expect(rel.documentos.falhas).toBe(1)
    expect(rel.erros).toHaveLength(1)
    expect(rel.erros[0]!.motivo).toBe("StorageError")
    // O rótulo é técnico e curto: nada de URL assinada no relatório.
    expect(JSON.stringify(rel.erros)).not.toContain("X-Amz-Signature")
    expect(JSON.stringify(rel.erros)).not.toContain("https://")
  })

  it("mesmo em apply, categorias PURGE_DISABLED não produzem descarte por idade", async () => {
    const escrita = escritaFake(["contador/loja-1/2015-01/fiscal-1"])
    const rel = await executarJobRetencao(
      {
        ...base,
        leitura: leituraFake({ documentos: { FISCAL: [candidato("fiscal-1")] } }),
        escrita,
        env: ENV_APPLY_ON,
      },
      { storeIds: [LOJA], modo: "apply", agora: AGORA },
    )
    // O plano até "ofereceu" um FISCAL, mas o job nem pergunta por essa categoria.
    expect(rel.documentos.candidatos).toBe(0)
    expect(escrita.removidos).toEqual([])
    expect(escrita.eventos).toEqual([])
  })
})

describe("escopo multi-loja", () => {
  it("varre cada loja declarada e nenhuma outra", async () => {
    const vistas: string[] = []
    const leitura: RetencaoLeituraPort = {
      ...leituraFake(),
      async documentosAlemDaRetencao({ storeId }) {
        vistas.push(storeId)
        return []
      },
    }
    await executarJobRetencao({ ...base, leitura }, { storeIds: ["loja-1", "loja-2"], agora: AGORA })
    expect(new Set(vistas)).toEqual(new Set(["loja-1", "loja-2"]))
  })

  it("lista vazia de lojas é execução vazia, não varredura global", async () => {
    const leitura = leituraFake({ documentos: { OUTRO: [candidato("d1")] } })
    const rel = await executarJobRetencao({ ...base, leitura }, { storeIds: [], agora: AGORA })
    expect(rel.documentos.candidatos).toBe(0)
    expect(leitura.chamadasCandidatos).toEqual([])
  })
})
