/**
 * GOAL CONTADOR-HUB-DOCUMENTOS-REAL-010B · Etapa 12.
 *
 * Testes do serviço de documentos com adapters FAKE in-memory (sem Supabase nem
 * Prisma reais). Cobre validação, idempotência, versionamento, soft delete, eventos,
 * limpeza de blob órfão, download assinado curto e não-exposição de `storageRef`.
 */
import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  autorizarDownload,
  completarUpload,
  criarUploadIntent,
  excluirDocumento,
  listarDocumentos,
  toDto,
  CompetenciaFechadaError,
  DocumentoConflitoError,
  DocumentoNaoEncontradoError,
  type CompetenciaRef,
  type DocumentoRow,
  type DocumentosRepo,
} from "@/lib/contador/documentos/service"
import { DocumentoValidacaoError } from "@/lib/contador/documentos/validacao"
import { StorageError, type StorageDocumentosPort } from "@/lib/contador/documentos/storage-types"

const ESCOPO = { storeId: "loja-1", userId: "user-1" }

function sha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}
/** PDF mínimo com magic bytes válidos. */
function pdf(tag = "a"): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF`, "utf8")
}

/* ─────────────────────────── fake storage ─────────────────────────── */

type FakeStorage = StorageDocumentosPort & {
  _put(ref: string, buf: Buffer): void
  _removed: string[]
  _uploads: string[]
}

function fakeStorage(): FakeStorage {
  const objetos = new Map<string, Buffer>()
  const removed: string[] = []
  const uploads: string[] = []
  return {
    _put: (ref, buf) => objetos.set(ref, buf),
    _removed: removed,
    _uploads: uploads,
    async verificarBucket() {
      return { existe: true, publico: false }
    },
    // GOAL 012 ampliou a porta com upload server-side (usado só pelo pacote oficial).
    async enviarConteudoPrivado(storageRef, conteudo) {
      objetos.set(storageRef, Buffer.from(conteudo))
      uploads.push(storageRef)
    },
    async criarUploadAssinado(storageRef, expiresInSec = 120) {
      uploads.push(storageRef)
      return { storageRef, signedUrl: `fake://upload/${storageRef}`, token: "tok", expiresInSec }
    },
    async obterMetadata(storageRef) {
      const b = objetos.get(storageRef)
      return b ? { bytes: b.length, mime: null } : null
    },
    async abrirConteudoPrivado(storageRef) {
      const b = objetos.get(storageRef)
      if (!b) throw new StorageError("abrirConteudoPrivado", "objeto ausente")
      return b
    },
    async criarDownloadAssinado(storageRef, _nome, expiresInSec = 300) {
      const expira = Math.min(Math.max(1, expiresInSec), 300)
      return { signedUrl: `fake://download/${storageRef}`, expiresInSec: expira }
    },
    async removerObjeto(storageRef) {
      removed.push(storageRef)
      objetos.delete(storageRef)
    },
    async verificarExistencia(storageRef) {
      return objetos.has(storageRef)
    },
  }
}

/* ─────────────────────────── fake repo ─────────────────────────── */

type FakeRepo = DocumentosRepo & {
  _docs: Map<string, DocumentoRow>
  _eventos: { tipo: string; entidadeId: string | null }[]
  _fecharCompetencia(codigo: string): void
}

function fakeRepo(): FakeRepo {
  const comps = new Map<string, CompetenciaRef>()
  const docs = new Map<string, DocumentoRow>()
  const eventos: { tipo: string; entidadeId: string | null }[] = []
  const fechadas = new Set<string>()
  const chave = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, "0")}`

  function getOrCreate(ano: number, mes: number): CompetenciaRef {
    const k = chave(ano, mes)
    let c = comps.get(k)
    if (!c) {
      c = { id: `comp-${k}`, status: fechadas.has(k) ? "FECHADA" : "ABERTA", ano, mes }
      comps.set(k, c)
    }
    return c
  }

  return {
    _docs: docs,
    _eventos: eventos,
    _fecharCompetencia: (codigo) => fechadas.add(codigo),
    async getOrCreateCompetencia(_storeId, comp) {
      return getOrCreate(comp.ano, comp.mes)
    },
    async acharCompetencia(_storeId, comp) {
      return comps.get(chave(comp.ano, comp.mes)) ?? null
    },
    // GOAL 012: congelamento da exclusão precisa do status da competência por id.
    async acharCompetenciaPorId(competenciaId) {
      return [...comps.values()].find((c) => c.id === competenciaId) ?? null
    },
    async acharDocumentoPorId(id) {
      return docs.get(id) ?? null
    },
    async acharDocumentoDaLoja(id, storeId) {
      const d = docs.get(id)
      return d && d.storeId === storeId ? d : null
    },
    async listarDocumentos({ competenciaId, storeId, incluirExcluidos, filtros }) {
      return [...docs.values()].filter(
        (d) =>
          d.competenciaId === competenciaId &&
          d.storeId === storeId &&
          (incluirExcluidos || d.excluidoEm === null) &&
          (!filtros.categoria || d.categoria === filtros.categoria.toUpperCase()),
      )
    },
    async criarDocumentoComEvento({ documento, evento }) {
      if (docs.has(documento.id)) throw new Error("duplicate id")
      const now = new Date()
      const row: DocumentoRow = {
        ...documento,
        excluidoEm: null,
        excluidoPorId: null,
        excluidoMotivo: null,
        createdAt: now,
        updatedAt: now,
      }
      docs.set(row.id, row)
      eventos.push({ tipo: evento.tipo, entidadeId: evento.entidadeId })
      return row
    },
    async softDeleteComEvento({ id, storeId, excluidoPorId, excluidoMotivo, evento }) {
      const d = docs.get(id)
      if (!d || d.storeId !== storeId) throw new DocumentoNaoEncontradoError()
      if (d.excluidoEm === null) {
        d.excluidoEm = new Date()
        d.excluidoPorId = excluidoPorId
        d.excluidoMotivo = excluidoMotivo
        eventos.push({ tipo: evento.tipo, entidadeId: evento.entidadeId })
      }
      return d
    },
    async registrarEvento(evento) {
      eventos.push({ tipo: evento.tipo, entidadeId: evento.entidadeId })
    },
  }
}

/** Executa o fluxo completo (intent → upload simulado → complete). */
async function enviar(
  storage: FakeStorage,
  repo: FakeRepo,
  over: Partial<{ competencia: string; nomeArquivo: string; mime: string; titulo: string; buf: Buffer; versaoDeId: string | null }> = {},
) {
  const buf = over.buf ?? pdf()
  const base = {
    competencia: over.competencia ?? "2026-07",
    categoria: "fiscal",
    titulo: over.titulo ?? "DAS Julho",
    nomeArquivo: over.nomeArquivo ?? "das.pdf",
    mime: over.mime ?? "application/pdf",
    bytes: buf.length,
    sha256: sha(buf),
    versaoDeId: over.versaoDeId ?? null,
  }
  const intent = await criarUploadIntent(ESCOPO, base, { storage, repo })
  storage._put(intent.storageRef, buf)
  const res = await completarUpload(
    ESCOPO,
    { ...base, documentoId: intent.documentoId, storageRef: intent.storageRef },
    { storage, repo },
  )
  return { intent, ...res, buf, base }
}

/* ─────────────────────────── testes ─────────────────────────── */

describe("documentos · upload intent", () => {
  let storage: FakeStorage
  let repo: FakeRepo
  beforeEach(() => {
    storage = fakeStorage()
    repo = fakeRepo()
  })

  it("intent devolve URL assinada e NÃO cria documento", async () => {
    const buf = pdf()
    const intent = await criarUploadIntent(
      ESCOPO,
      {
        competencia: "2026-07",
        categoria: "fiscal",
        titulo: "DAS",
        nomeArquivo: "das.pdf",
        mime: "application/pdf",
        bytes: buf.length,
        sha256: sha(buf),
      },
      { storage, repo },
    )
    expect(intent.signedUrl).toContain("fake://upload/")
    expect(intent.storageRef).toMatch(/^contador\/loja-1\/2026-07\/doc-[\w-]+\/das\.pdf$/)
    expect(repo._docs.size).toBe(0)
    expect(storage._uploads).toHaveLength(1)
  })

  it("rejeita extensão proibida", async () => {
    await expect(
      criarUploadIntent(
        ESCOPO,
        { competencia: "2026-07", categoria: "fiscal", titulo: "x", nomeArquivo: "malware.exe", mime: "application/pdf", bytes: 10, sha256: sha(pdf()) },
        { storage, repo },
      ),
    ).rejects.toBeInstanceOf(DocumentoValidacaoError)
  })

  it("rejeita MIME incompatível com a extensão", async () => {
    await expect(
      criarUploadIntent(
        ESCOPO,
        { competencia: "2026-07", categoria: "fiscal", titulo: "x", nomeArquivo: "das.pdf", mime: "image/png", bytes: 10, sha256: sha(pdf()) },
        { storage, repo },
      ),
    ).rejects.toBeInstanceOf(DocumentoValidacaoError)
  })

  it("rejeita tamanho acima de 25 MB", async () => {
    await expect(
      criarUploadIntent(
        ESCOPO,
        { competencia: "2026-07", categoria: "fiscal", titulo: "x", nomeArquivo: "das.pdf", mime: "application/pdf", bytes: 26 * 1024 * 1024, sha256: sha(pdf()) },
        { storage, repo },
      ),
    ).rejects.toBeInstanceOf(DocumentoValidacaoError)
  })

  it("rejeita competência fechada", async () => {
    repo._fecharCompetencia("2026-08")
    await expect(
      criarUploadIntent(
        ESCOPO,
        { competencia: "2026-08", categoria: "fiscal", titulo: "x", nomeArquivo: "das.pdf", mime: "application/pdf", bytes: 10, sha256: sha(pdf()) },
        { storage, repo },
      ),
    ).rejects.toBeInstanceOf(CompetenciaFechadaError)
  })
})

describe("documentos · complete", () => {
  let storage: FakeStorage
  let repo: FakeRepo
  beforeEach(() => {
    storage = fakeStorage()
    repo = fakeRepo()
  })

  it("cria documento e um único evento documento_enviado; hash é o do servidor", async () => {
    const { documento, criado, buf } = await enviar(storage, repo)
    expect(criado).toBe(true)
    expect(documento.sha256).toBe(sha(buf))
    expect(documento.bytes).toBe(buf.length)
    expect(documento.status).toBe("ENVIADO")
    expect(repo._docs.size).toBe(1)
    expect(repo._eventos.filter((e) => e.tipo === "documento_enviado")).toHaveLength(1)
  })

  it("confirmação é idempotente pelo documentoId (sem duplicar doc/evento)", async () => {
    const { intent, base } = await enviar(storage, repo)
    const segunda = await completarUpload(
      ESCOPO,
      { ...base, documentoId: intent.documentoId, storageRef: intent.storageRef },
      { storage, repo },
    )
    expect(segunda.criado).toBe(false)
    expect(repo._docs.size).toBe(1)
    expect(repo._eventos.filter((e) => e.tipo === "documento_enviado")).toHaveLength(1)
  })

  it("rejeita hash divergente e remove o blob órfão", async () => {
    const buf = pdf()
    const base = {
      competencia: "2026-07",
      categoria: "fiscal",
      titulo: "DAS",
      nomeArquivo: "das.pdf",
      mime: "application/pdf",
      bytes: buf.length,
      sha256: sha(Buffer.from("outro conteudo")), // hash errado
    }
    const intent = await criarUploadIntent(ESCOPO, base, { storage, repo })
    storage._put(intent.storageRef, buf)
    await expect(
      completarUpload(ESCOPO, { ...base, documentoId: intent.documentoId, storageRef: intent.storageRef }, { storage, repo }),
    ).rejects.toBeInstanceOf(DocumentoValidacaoError)
    expect(storage._removed).toContain(intent.storageRef)
    expect(repo._docs.size).toBe(0)
  })

  it("rejeita tamanho real divergente do informado", async () => {
    const buf = pdf()
    const base = {
      competencia: "2026-07",
      categoria: "fiscal",
      titulo: "DAS",
      nomeArquivo: "das.pdf",
      mime: "application/pdf",
      bytes: buf.length + 999, // tamanho errado
      sha256: sha(buf),
    }
    const intent = await criarUploadIntent(ESCOPO, base, { storage, repo })
    storage._put(intent.storageRef, buf)
    await expect(
      completarUpload(ESCOPO, { ...base, documentoId: intent.documentoId, storageRef: intent.storageRef }, { storage, repo }),
    ).rejects.toBeInstanceOf(DocumentoValidacaoError)
    expect(storage._removed).toContain(intent.storageRef)
  })

  it("rejeita conteúdo que não corresponde à extensão (magic bytes) e limpa o blob", async () => {
    const conteudo = Buffer.from("isto nao e um pdf")
    const base = {
      competencia: "2026-07",
      categoria: "fiscal",
      titulo: "DAS",
      nomeArquivo: "das.pdf",
      mime: "application/pdf",
      bytes: conteudo.length,
      sha256: sha(conteudo),
    }
    const intent = await criarUploadIntent(ESCOPO, base, { storage, repo })
    storage._put(intent.storageRef, conteudo)
    await expect(
      completarUpload(ESCOPO, { ...base, documentoId: intent.documentoId, storageRef: intent.storageRef }, { storage, repo }),
    ).rejects.toBeInstanceOf(DocumentoValidacaoError)
    expect(storage._removed).toContain(intent.storageRef)
  })

  it("falha de storage (objeto ausente) limpa e propaga", async () => {
    const buf = pdf()
    const base = {
      competencia: "2026-07",
      categoria: "fiscal",
      titulo: "DAS",
      nomeArquivo: "das.pdf",
      mime: "application/pdf",
      bytes: buf.length,
      sha256: sha(buf),
    }
    const intent = await criarUploadIntent(ESCOPO, base, { storage, repo })
    // NÃO faz _put — objeto não existe.
    await expect(
      completarUpload(ESCOPO, { ...base, documentoId: intent.documentoId, storageRef: intent.storageRef }, { storage, repo }),
    ).rejects.toBeInstanceOf(StorageError)
    expect(storage._removed).toContain(intent.storageRef)
    expect(repo._docs.size).toBe(0)
  })

  it("rejeita storageRef que não pertence à loja/documento", async () => {
    const buf = pdf()
    const base = {
      competencia: "2026-07",
      categoria: "fiscal",
      titulo: "DAS",
      nomeArquivo: "das.pdf",
      mime: "application/pdf",
      bytes: buf.length,
      sha256: sha(buf),
    }
    const intent = await criarUploadIntent(ESCOPO, base, { storage, repo })
    await expect(
      completarUpload(
        ESCOPO,
        { ...base, documentoId: intent.documentoId, storageRef: "contador/outra-loja/2026-07/doc-x/das.pdf" },
        { storage, repo },
      ),
    ).rejects.toBeInstanceOf(DocumentoValidacaoError)
  })

  it("dados divergentes em documentoId já confirmado → conflito", async () => {
    const { intent, base } = await enviar(storage, repo)
    await expect(
      completarUpload(
        ESCOPO,
        { ...base, documentoId: intent.documentoId, storageRef: intent.storageRef, sha256: sha(Buffer.from("x")) },
        { storage, repo },
      ),
    ).rejects.toBeInstanceOf(DocumentoConflitoError)
  })
})

describe("documentos · substituição versionada", () => {
  it("nova versão aponta o predecessor, gera novo blob e evento documento_substituido", async () => {
    const storage = fakeStorage()
    const repo = fakeRepo()
    const primeiro = await enviar(storage, repo, { nomeArquivo: "das-v1.pdf", buf: pdf("v1") })
    const segundo = await enviar(storage, repo, {
      nomeArquivo: "das-v2.pdf",
      buf: pdf("v2"),
      versaoDeId: primeiro.documento.id,
    })
    expect(segundo.documento.versaoDeId).toBe(primeiro.documento.id)
    expect(segundo.documento.storageRef).not.toBe(primeiro.documento.storageRef)
    expect(segundo.documento.sha256).not.toBe(primeiro.documento.sha256)
    expect(repo._eventos.filter((e) => e.tipo === "documento_substituido")).toHaveLength(1)
    expect(repo._docs.size).toBe(2) // predecessor preservado
  })

  it("rejeita substituir documento inexistente/de outra competência", async () => {
    const storage = fakeStorage()
    const repo = fakeRepo()
    await expect(
      enviar(storage, repo, { versaoDeId: "doc-inexistente" }),
    ).rejects.toBeInstanceOf(DocumentoValidacaoError)
  })
})

describe("documentos · listagem / soft delete / download", () => {
  it("soft delete marca motivo, emite evento e NÃO remove o blob; some da listagem", async () => {
    const storage = fakeStorage()
    const repo = fakeRepo()
    const { documento } = await enviar(storage, repo)

    const excluido = await excluirDocumento(ESCOPO, documento.id, "enviado por engano", { repo })
    expect(repo._docs.get(documento.id)?.excluidoMotivo).toBe("enviado por engano")
    expect(storage._removed).toHaveLength(0) // blob preservado (GOAL 019)
    expect(repo._eventos.filter((e) => e.tipo === "documento_excluido")).toHaveLength(1)
    expect(excluido.id).toBe(documento.id)

    const lista = await listarDocumentos(ESCOPO, "2026-07", {}, { repo })
    expect(lista.find((d) => d.id === documento.id)).toBeUndefined()
  })

  it("soft delete exige motivo não vazio", async () => {
    const storage = fakeStorage()
    const repo = fakeRepo()
    const { documento } = await enviar(storage, repo)
    await expect(excluirDocumento(ESCOPO, documento.id, "   ", { repo })).rejects.toBeInstanceOf(
      DocumentoValidacaoError,
    )
  })

  it("download gera URL assinada de no máximo 300s e registra autorização (sem afirmar download)", async () => {
    const storage = fakeStorage()
    const repo = fakeRepo()
    const { documento } = await enviar(storage, repo)
    const dl = await autorizarDownload(ESCOPO, documento.id, { storage, repo })
    expect(dl.expiresInSec).toBeLessThanOrEqual(300)
    expect(dl.signedUrl).toContain("fake://download/")
    expect(repo._eventos.filter((e) => e.tipo === "documento_download_autorizado")).toHaveLength(1)
  })

  it("download de documento de outra loja → não encontrado (cross-store)", async () => {
    const storage = fakeStorage()
    const repo = fakeRepo()
    const { documento } = await enviar(storage, repo)
    await expect(
      autorizarDownload({ storeId: "loja-2", userId: "u2" }, documento.id, { storage, repo }),
    ).rejects.toBeInstanceOf(DocumentoNaoEncontradoError)
  })

  it("DTO nunca expõe storageRef", async () => {
    const storage = fakeStorage()
    const repo = fakeRepo()
    const { documento } = await enviar(storage, repo)
    const dto = toDto(documento)
    expect(Object.keys(dto)).not.toContain("storageRef")
    expect(JSON.stringify(dto)).not.toContain("contador/loja-1")
  })

  it("listagem só devolve documentos da loja e competência do escopo", async () => {
    const storage = fakeStorage()
    const repo = fakeRepo()
    await enviar(storage, repo, { competencia: "2026-07" })
    await enviar(storage, repo, { competencia: "2026-06" })
    const jul = await listarDocumentos(ESCOPO, "2026-07", {}, { repo })
    expect(jul).toHaveLength(1)
  })
})

describe("documentos · arquitetura upload direto", () => {
  it("o serviço não recebe binário: intent só autoriza, complete lê do storage", async () => {
    const storage = fakeStorage()
    const repo = fakeRepo()
    const abrirSpy = vi.spyOn(storage, "abrirConteudoPrivado")
    const { intent } = await enviar(storage, repo)
    // O binário entrou no storage pelo _put (equivalente ao PUT do navegador),
    // e o complete o LEU do storage — não veio no corpo da API.
    expect(abrirSpy).toHaveBeenCalledWith(intent.storageRef)
  })
})
