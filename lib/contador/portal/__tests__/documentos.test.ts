/**
 * GOAL CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 — documentos do portal.
 *
 * Fakes in-memory (repo + storage + eventos). Prova: lookup composto não vaza
 * existência, evento externo com ipHash/UA ANTES da URL, TTL ≤ 300, `storageRef`
 * nunca na resposta, e pseudonimização do remetente interno na listagem.
 */
import { describe, expect, it } from "vitest"
import {
  DocumentoNaoEncontradoError,
  type DocumentoRow,
  type DocumentosRepo,
} from "@/lib/contador/documentos/service"
import type { StorageDocumentosPort } from "@/lib/contador/documentos/storage-types"
import { autorizarDownloadPortal, listarDocumentosPortal } from "../documentos"
import { respostaErroPortal } from "../erros"
import { criarRepoEventosFalso, escopoExternoFake } from "./helpers"

const AGORA = new Date("2026-08-01T12:00:00.000Z")

function linhaDocumento(over: Partial<DocumentoRow> = {}): DocumentoRow {
  return {
    id: "doc-1",
    competenciaId: "comp-1",
    storeId: "loja-1",
    categoria: "FISCAL",
    titulo: "NF-e julho",
    nomeArquivo: "nfe-julho.pdf",
    mime: "application/pdf",
    bytes: 2048,
    sha256: "a".repeat(64),
    storageRef: "contador/loja-1/2026-07/doc-1/nfe-julho.pdf",
    status: "ENVIADO",
    vencimento: null,
    enviadoPorTipo: "interno",
    enviadoPorId: "admin-user-42",
    versaoDeId: null,
    excluidoEm: null,
    excluidoPorId: null,
    excluidoMotivo: null,
    createdAt: AGORA,
    updatedAt: AGORA,
    ...over,
  }
}

function repoFalso(docs: DocumentoRow[]): DocumentosRepo {
  const naoUsado = (): never => {
    throw new Error("método não usado pelo portal")
  }
  return {
    getOrCreateCompetencia: naoUsado,
    acharCompetencia: async (storeId, comp) =>
      comp.ano === 2026 && comp.mes === 7 && storeId === "loja-1"
        ? { id: "comp-1", status: "ABERTA", ano: 2026, mes: 7 }
        : null,
    acharCompetenciaPorId: naoUsado,
    acharDocumentoPorId: naoUsado,
    acharDocumentoDaLoja: async (id, storeId) =>
      docs.find((d) => d.id === id && d.storeId === storeId) ?? null,
    listarDocumentos: async ({ competenciaId, storeId, incluirExcluidos }) =>
      docs.filter(
        (d) =>
          d.competenciaId === competenciaId &&
          d.storeId === storeId &&
          (incluirExcluidos || !d.excluidoEm),
      ),
    criarDocumentoComEvento: naoUsado,
    softDeleteComEvento: naoUsado,
    // O portal NUNCA grava evento pelo repo de documentos (atorTipo seria interno).
    registrarEvento: naoUsado,
  }
}

type StorageFalso = StorageDocumentosPort & { ordem: string[]; tts: (number | undefined)[] }

function storageFalso(objetos: ReadonlySet<string>, ordem: string[]): StorageFalso {
  const tts: (number | undefined)[] = []
  const parcial: Partial<StorageDocumentosPort> = {
    verificarExistencia: async (ref) => objetos.has(ref),
    criarDownloadAssinado: async (ref, _nome, expiresInSec) => {
      ordem.push("url")
      tts.push(expiresInSec)
      return { signedUrl: `https://r2.example/assinada?ref=${encodeURIComponent(ref)}`, expiresInSec: expiresInSec ?? 300 }
    },
  }
  return { ...(parcial as StorageDocumentosPort), ordem, tts }
}

describe("listarDocumentosPortal", () => {
  it("devolve DTO sem storageRef e pseudonimiza enviadoPorId INTERNO (externo permanece)", async () => {
    const docs = [
      linhaDocumento({ id: "doc-int", enviadoPorTipo: "interno", enviadoPorId: "admin-user-42" }),
      linhaDocumento({ id: "doc-ext", enviadoPorTipo: "externo", enviadoPorId: "usr-ext-1" }),
    ]
    const lista = await listarDocumentosPortal(
      escopoExternoFake(),
      "2026-07",
      {},
      { repo: repoFalso(docs) },
      AGORA,
    )
    expect(lista).toHaveLength(2)
    const interno = lista.find((d) => d.id === "doc-int")!
    const externo = lista.find((d) => d.id === "doc-ext")!
    expect(interno.enviadoPorId).toMatch(/^u_[0-9a-f]{16}$/)
    expect(interno.enviadoPorId).not.toBe("admin-user-42")
    expect(externo.enviadoPorId).toBe("usr-ext-1")
    for (const dto of lista) {
      expect(dto).not.toHaveProperty("storageRef")
      expect(JSON.stringify(dto)).not.toContain("contador/loja-1/2026-07")
    }
  })

  it("documento de OUTRA loja nunca aparece na listagem", async () => {
    const docs = [linhaDocumento({ id: "doc-alheio", storeId: "loja-2", competenciaId: "comp-2" })]
    const lista = await listarDocumentosPortal(escopoExternoFake(), "2026-07", {}, { repo: repoFalso(docs) }, AGORA)
    expect(lista).toEqual([])
  })
})

describe("autorizarDownloadPortal", () => {
  function montar(docs: DocumentoRow[], objetos: ReadonlySet<string>) {
    const ordem: string[] = []
    const eventos = criarRepoEventosFalso()
    const storage = storageFalso(objetos, ordem)
    const repo = repoFalso(docs)
    // O evento precisa ser registrado ANTES da URL: o fake de eventos registra na
    // MESMA trilha de ordem que o storage.
    const registrarOriginal = eventos.registrarEvento.bind(eventos)
    eventos.registrarEvento = async (e) => {
      ordem.push("evento")
      return registrarOriginal(e)
    }
    return { ordem, eventos, storage, repo }
  }

  it("grava o evento externo com ipHash/UA ANTES de emitir a URL, com TTL ≤ 300", async () => {
    const doc = linhaDocumento()
    const { ordem, eventos, storage, repo } = montar([doc], new Set([doc.storageRef]))
    const escopo = escopoExternoFake({ usuarioId: "usr-ext-1" })
    const resultado = await autorizarDownloadPortal(
      escopo,
      "doc-1",
      { escopo, ip: "203.0.113.99", userAgent: "Mozilla/5.0 teste" },
      { repo, storage, eventos },
    )
    expect(ordem).toEqual(["evento", "url"])
    expect(resultado.expiresInSec).toBeLessThanOrEqual(300)
    expect(storage.tts[0]).toBeLessThanOrEqual(300)
    expect(resultado.signedUrl).toContain("https://")

    const evento = eventos.eventos[0]!
    expect(evento).toMatchObject({
      tipo: "documento_download_autorizado",
      atorTipo: "externo",
      atorId: "usr-ext-1",
      competenciaId: "comp-1",
      entidade: "documento",
      entidadeId: "doc-1",
    })
    expect(evento.ip).toMatch(/^[0-9a-f]{16}$/)
    expect(evento.userAgent).toBe("Mozilla/5.0 teste")
    // storageRef NUNCA vaza: nem no DTO, nem na metadata do evento.
    expect(JSON.stringify(resultado)).not.toContain(doc.storageRef)
    expect(JSON.stringify(evento.metadata)).not.toContain(doc.storageRef)
  })

  it("documento de outra loja → MESMO erro de um id inexistente (404, sem confirmar existência)", async () => {
    const docAlheio = linhaDocumento({ id: "doc-alheio", storeId: "loja-2" })
    const { ordem, eventos, storage, repo } = montar([docAlheio], new Set([docAlheio.storageRef]))
    const escopo = escopoExternoFake()

    const erroAlheio = await autorizarDownloadPortal(escopo, "doc-alheio", { escopo }, { repo, storage, eventos }).catch((e) => e)
    const erroInexistente = await autorizarDownloadPortal(escopo, "doc-que-nao-existe", { escopo }, { repo, storage, eventos }).catch((e) => e)

    expect(erroAlheio).toBeInstanceOf(DocumentoNaoEncontradoError)
    expect(erroInexistente).toBeInstanceOf(DocumentoNaoEncontradoError)
    expect(erroAlheio.message).toBe(erroInexistente.message)
    // E o mapeamento HTTP é idêntico (404, mesma mensagem).
    expect(respostaErroPortal(erroAlheio)).toEqual(respostaErroPortal(erroInexistente))
    expect(respostaErroPortal(erroAlheio).status).toBe(404)
    // Nenhum evento, nenhuma URL.
    expect(ordem).toEqual([])
    expect(eventos.eventos).toEqual([])
  })

  it("excluído ou ausente do storage → 404 sem evento", async () => {
    const excluido = linhaDocumento({ id: "doc-del", excluidoEm: AGORA })
    const semBlob = linhaDocumento({ id: "doc-sem-blob" })
    const { eventos, storage, repo } = montar([excluido, semBlob], new Set())
    const escopo = escopoExternoFake()
    await expect(autorizarDownloadPortal(escopo, "doc-del", { escopo }, { repo, storage, eventos })).rejects.toBeInstanceOf(DocumentoNaoEncontradoError)
    await expect(autorizarDownloadPortal(escopo, "doc-sem-blob", { escopo }, { repo, storage, eventos })).rejects.toBeInstanceOf(DocumentoNaoEncontradoError)
    expect(eventos.eventos).toEqual([])
  })
})
