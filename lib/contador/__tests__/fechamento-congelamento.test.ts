/**
 * GOAL CONTADOR-HUB-FECHAMENTO-SNAPSHOT-012 — congelamento da competência FECHADA.
 *
 * Categoria 3 dos testes obrigatórios. Fechar congela a ESCRITA do domínio contábil:
 * upload, substituição, exclusão lógica, mudança de status e comentário passam a
 * recusar com `CompetenciaFechadaError` (409). Leitura e download continuam liberados
 * conforme a ACL — congelar não é esconder.
 *
 * A regra do comentário substitui a hipótese antiga (GOAL 011 permitia comentar em
 * competência fechada); a revisão do 011 apontou a inconsistência e ela é fechada aqui.
 */
import { describe, expect, it } from "vitest"
import {
  CompetenciaFechadaError,
  criarUploadIntent,
  excluirDocumento,
  listarDocumentos,
  autorizarDownload,
  type CompetenciaRef,
  type Deps,
  type DocumentoRow,
  type DocumentosRepo,
} from "@/lib/contador/documentos/service"
import type { StorageDocumentosPort } from "@/lib/contador/documentos/storage-types"
import { criarComentario, listarComentarios, type ComentariosRepo } from "@/lib/contador/comentarios/service"
import { alterarStatusDocumento, type StatusRepo } from "@/lib/contador/status/service"
import { CompetenciaFechadaError as StatusCompetenciaFechada } from "@/lib/contador/documentos/service"

// `criarUploadIntent` assina a autorização de upload (GOAL 012E · P1) e falha
// cerrado sem segredo no ambiente.
process.env.AUTH_SECRET ??= "segredo-de-teste-012e"

const COMP = { ano: 2026, mes: 7 }
const CODIGO = "2026-07"
const ESCOPO = { storeId: "loja-1", userId: "user-1" }
const ELEVADO = { acessaHub: true, podeConferir: true, podeGerenciarAcessoExterno: true } as const

/* ─────────────────────────── documentos ─────────────────────────── */

function docRow(over: Partial<DocumentoRow> = {}): DocumentoRow {
  return {
    id: "doc-1",
    competenciaId: "comp-1",
    storeId: "loja-1",
    categoria: "FISCAL",
    titulo: "DAS",
    nomeArquivo: "das.pdf",
    mime: "application/pdf",
    bytes: 100,
    sha256: "a".repeat(64),
    storageRef: "contador/loja-1/2026-07/doc-1",
    status: "ENVIADO",
    vencimento: null,
    enviadoPorTipo: "interno",
    enviadoPorId: "user-1",
    versaoDeId: null,
    excluidoEm: null,
    excluidoPorId: null,
    excluidoMotivo: null,
    createdAt: new Date("2026-07-10T10:00:00.000Z"),
    updatedAt: new Date("2026-07-10T10:00:00.000Z"),
    ...over,
  }
}

function depsDocumentos(statusCompetencia: string): Deps & { eventos: string[] } {
  const competencia: CompetenciaRef = { id: "comp-1", status: statusCompetencia, ...COMP }
  const doc = docRow()
  const eventos: string[] = []

  const repo: DocumentosRepo = {
    async getOrCreateCompetencia() {
      return competencia
    },
    async acharCompetencia() {
      return competencia
    },
    async acharCompetenciaPorId() {
      return competencia
    },
    async acharDocumentoPorId() {
      return doc
    },
    async acharDocumentoDaLoja() {
      return doc
    },
    async listarDocumentos() {
      return [doc]
    },
    async criarDocumentoComEvento() {
      return doc
    },
    async softDeleteComEvento({ evento }) {
      eventos.push(evento.tipo)
      return { ...doc, excluidoEm: new Date() }
    },
    async registrarEvento(evento) {
      eventos.push(evento.tipo)
    },
  }

  const storage: StorageDocumentosPort = {
    async verificarBucket() {
      return { existe: true, publico: false }
    },
    async criarUploadAssinado(storageRef) {
      return {
        storageRef,
        signedUrl: "fake://up",
        token: "t",
        expiresInSec: 120,
        headersObrigatorios: { "If-None-Match": "*" },
      }
    },
    async enviarConteudoPrivado() {},
    async obterMetadata() {
      return { bytes: 100, mime: "application/pdf" }
    },
    async abrirConteudoPrivado() {
      return Buffer.from("x")
    },
    async criarDownloadAssinado() {
      return { signedUrl: "fake://down", expiresInSec: 300 }
    },
    async removerObjeto() {},
    async verificarExistencia() {
      return true
    },
  }

  return Object.assign({ storage, repo }, { eventos })
}

describe("congelamento · documentos", () => {
  const intent = {
    competencia: CODIGO,
    categoria: "fiscal",
    titulo: "DAS",
    nomeArquivo: "das.pdf",
    mime: "application/pdf",
    bytes: 100,
    sha256: "a".repeat(64),
  }

  it("competência ABERTA aceita upload", async () => {
    const deps = depsDocumentos("ABERTA")
    await expect(criarUploadIntent(ESCOPO, intent, deps)).resolves.toBeTruthy()
  })

  it("competência FECHADA recusa upload", async () => {
    const deps = depsDocumentos("FECHADA")
    await expect(criarUploadIntent(ESCOPO, intent, deps)).rejects.toBeInstanceOf(
      CompetenciaFechadaError,
    )
  })

  it("competência FECHADA recusa substituição (mesmo caminho do upload, com versaoDeId)", async () => {
    const deps = depsDocumentos("FECHADA")
    await expect(
      criarUploadIntent(ESCOPO, { ...intent, versaoDeId: "doc-1" }, deps),
    ).rejects.toBeInstanceOf(CompetenciaFechadaError)
  })

  it("competência FECHADA recusa exclusão lógica, sem gravar evento", async () => {
    const deps = depsDocumentos("FECHADA")
    await expect(
      excluirDocumento(ESCOPO, "doc-1", "engano", deps),
    ).rejects.toBeInstanceOf(CompetenciaFechadaError)
    expect(deps.eventos).toEqual([])
  })

  it("competência ABERTA continua aceitando exclusão lógica", async () => {
    const deps = depsDocumentos("ABERTA")
    await expect(excluirDocumento(ESCOPO, "doc-1", "engano", deps)).resolves.toBeTruthy()
    expect(deps.eventos).toContain("documento_excluido")
  })

  it("LEITURA e DOWNLOAD continuam permitidos com a competência fechada", async () => {
    const deps = depsDocumentos("FECHADA")
    await expect(listarDocumentos(ESCOPO, CODIGO, {}, deps)).resolves.toHaveLength(1)
    const dl = await autorizarDownload(ESCOPO, "doc-1", deps)
    expect(dl.signedUrl).toBe("fake://down")
  })
})

/* ─────────────────────────── comentários ─────────────────────────── */

function depsComentarios(statusCompetencia: string) {
  const competencia = { id: "comp-1", status: statusCompetencia, ...COMP }
  const criados: unknown[] = []
  const repo: ComentariosRepo = {
    async getOrCreateCompetencia() {
      return competencia
    },
    async acharCompetencia() {
      return competencia
    },
    async documentoPertence() {
      return true
    },
    async criarComentarioComEvento({ comentario }) {
      criados.push(comentario)
      return {
        id: comentario.id,
        competenciaId: comentario.competenciaId,
        documentoId: comentario.documentoId,
        autorTipo: comentario.autorTipo,
        autorId: comentario.autorId,
        visibilidade: comentario.visibilidade,
        texto: comentario.texto,
        createdAt: new Date("2026-08-01T10:00:00.000Z"),
      }
    },
    async listarComentarios() {
      return [
        {
          id: "cmt-1",
          competenciaId: "comp-1",
          documentoId: null,
          autorTipo: "interno",
          autorId: "user-1",
          visibilidade: "interna",
          texto: "nota",
          createdAt: new Date("2026-07-20T10:00:00.000Z"),
        },
      ]
    },
  }
  return { deps: { repo }, criados }
}

describe("congelamento · comentários (pendência do GOAL 011 fechada aqui)", () => {
  const entrada = { competencia: CODIGO, texto: "observação", visibilidade: "interna" }

  it("competência ABERTA aceita comentário", async () => {
    const { deps, criados } = depsComentarios("ABERTA")
    await expect(criarComentario(ESCOPO, entrada, deps)).resolves.toBeTruthy()
    expect(criados).toHaveLength(1)
  })

  it("competência FECHADA recusa comentário, sem gravar nada", async () => {
    const { deps, criados } = depsComentarios("FECHADA")
    await expect(criarComentario(ESCOPO, entrada, deps)).rejects.toBeInstanceOf(
      CompetenciaFechadaError,
    )
    expect(criados).toEqual([])
  })

  it("LEITURA de comentários continua permitida com a competência fechada", async () => {
    const { deps } = depsComentarios("FECHADA")
    await expect(listarComentarios(ESCOPO, { competencia: CODIGO }, deps)).resolves.toHaveLength(1)
  })
})

/* ─────────────────────────── status ─────────────────────────── */

function depsStatus(statusCompetencia: string) {
  const escritas: unknown[] = []
  const repo: StatusRepo = {
    async acharDocumentoParaTransicao() {
      return {
        id: "doc-1",
        competenciaId: "comp-1",
        storeId: "loja-1",
        titulo: "DAS",
        categoria: "FISCAL",
        status: "ENVIADO",
        vencimento: null,
        excluidoEm: null,
        updatedAt: new Date("2026-07-10T10:00:00.000Z"),
        competenciaStatus: statusCompetencia,
        competenciaAno: COMP.ano,
        competenciaMes: COMP.mes,
      }
    },
    async aplicarTransicao(args) {
      escritas.push(args)
      return {
        id: "doc-1",
        competenciaId: "comp-1",
        storeId: "loja-1",
        titulo: "DAS",
        categoria: "FISCAL",
        status: args.para,
        vencimento: null,
        excluidoEm: null,
        updatedAt: new Date("2026-07-11T10:00:00.000Z"),
        competenciaStatus: statusCompetencia,
        competenciaAno: COMP.ano,
        competenciaMes: COMP.mes,
      }
    },
  }
  return { deps: { repo }, escritas }
}

describe("congelamento · status do documento", () => {
  it("competência ABERTA aceita transição", async () => {
    const { deps, escritas } = depsStatus("ABERTA")
    await expect(
      alterarStatusDocumento(ESCOPO, ELEVADO, { documentoId: "doc-1", para: "CONFERIDO" }, deps),
    ).resolves.toBeTruthy()
    expect(escritas).toHaveLength(1)
  })

  it("competência FECHADA recusa transição, sem escrita", async () => {
    const { deps, escritas } = depsStatus("FECHADA")
    await expect(
      alterarStatusDocumento(ESCOPO, ELEVADO, { documentoId: "doc-1", para: "CONFERIDO" }, deps),
    ).rejects.toBeInstanceOf(StatusCompetenciaFechada)
    expect(escritas).toEqual([])
  })
})
