/**
 * GOAL CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 — marcar documento conferido.
 *
 * Fake in-memory do `StatusRepo` com a trava otimista da porta real. Prova:
 * LEITURA negado (403), CONFERENCIA ok com evento externo, transição inválida
 * negada pela matriz e lookup por loja sem vazamento.
 */
import { describe, expect, it } from "vitest"
import {
  CompetenciaFechadaError,
  DocumentoNaoEncontradoError,
} from "@/lib/contador/documentos/service"
import { TransicaoConcorrenteError, TransicaoInvalidaError } from "@/lib/contador/status/matriz"
import type { DocumentoStatusRow, StatusRepo } from "@/lib/contador/status/service"
import { marcarDocumentoConferidoPortal } from "../conferir"
import { PortalPapelInsuficienteError, respostaErroPortal } from "../erros"
import { escopoExternoFake } from "./helpers"

const AGORA = new Date("2026-08-01T12:00:00.000Z")

function linhaDoc(over: Partial<DocumentoStatusRow> = {}): DocumentoStatusRow {
  return {
    id: "doc-1",
    competenciaId: "comp-1",
    storeId: "loja-1",
    titulo: "NF-e julho",
    categoria: "FISCAL",
    status: "ENVIADO",
    vencimento: null,
    excluidoEm: null,
    updatedAt: AGORA,
    competenciaStatus: "ABERTA",
    competenciaAno: 2026,
    competenciaMes: 7,
    ...over,
  }
}

type Estado = { docs: DocumentoStatusRow[]; eventos: Record<string, unknown>[] }

function repoFalso(estado: Estado): StatusRepo {
  return {
    acharDocumentoParaTransicao: async (id, storeId) =>
      estado.docs.find((d) => d.id === id && d.storeId === storeId) ?? null,
    aplicarTransicao: async (args) => {
      // Trava otimista da porta real: estado divergente → corrida perdida.
      const doc = estado.docs.find((d) => d.id === args.documentoId && d.storeId === args.storeId)
      if (!doc || doc.status !== args.de) throw new TransicaoConcorrenteError()
      doc.status = args.para
      doc.updatedAt = new Date(AGORA.getTime() + 1000)
      estado.eventos.push({ ...args.evento })
      return { ...doc }
    },
  }
}

describe("marcarDocumentoConferidoPortal", () => {
  it("LEITURA → 403 de domínio, ZERO escrita", async () => {
    const estado: Estado = { docs: [linhaDoc()], eventos: [] }
    const escopo = escopoExternoFake({ papel: "LEITURA" })
    const erro = await marcarDocumentoConferidoPortal(escopo, { documentoId: "doc-1" }, { repo: repoFalso(estado) }).catch((e) => e)
    expect(erro).toBeInstanceOf(PortalPapelInsuficienteError)
    expect(respostaErroPortal(erro).status).toBe(403)
    expect(estado.docs[0]!.status).toBe("ENVIADO")
    expect(estado.eventos).toEqual([])
  })

  it("CONFERENCIA: ENVIADO → CONFERIDO com evento externo na mesma transação", async () => {
    const estado: Estado = { docs: [linhaDoc()], eventos: [] }
    const escopo = escopoExternoFake({ papel: "CONFERENCIA", usuarioId: "usr-ext-1" })
    const dto = await marcarDocumentoConferidoPortal(escopo, { documentoId: "doc-1" }, { repo: repoFalso(estado) })
    expect(dto).toMatchObject({ id: "doc-1", competenciaId: "comp-1", competencia: "2026-07", status: "CONFERIDO" })
    expect(estado.docs[0]!.status).toBe("CONFERIDO")
    expect(estado.eventos[0]).toMatchObject({
      tipo: "status_alterado",
      atorTipo: "externo",
      atorId: "usr-ext-1",
      entidade: "documento",
      entidadeId: "doc-1",
      origem: "contador.portal",
      metadata: { statusAnterior: "ENVIADO", statusNovo: "CONFERIDO", acao: "conferir", competencia: "2026-07" },
    })
  })

  it("já CONFERIDO → transição inválida (matriz), sem segunda escrita", async () => {
    const estado: Estado = { docs: [linhaDoc({ status: "CONFERIDO" })], eventos: [] }
    const escopo = escopoExternoFake({ papel: "CONFERENCIA" })
    await expect(
      marcarDocumentoConferidoPortal(escopo, { documentoId: "doc-1" }, { repo: repoFalso(estado) }),
    ).rejects.toBeInstanceOf(TransicaoInvalidaError)
    expect(estado.eventos).toEqual([])
  })

  it("PENDENTE/RESOLVIDO também são fora da matriz para este fluxo", async () => {
    const escopo = escopoExternoFake({ papel: "CONFERENCIA" })
    for (const status of ["PENDENTE", "RESOLVIDO"]) {
      const estado: Estado = { docs: [linhaDoc({ status })], eventos: [] }
      await expect(
        marcarDocumentoConferidoPortal(escopo, { documentoId: "doc-1" }, { repo: repoFalso(estado) }),
      ).rejects.toBeInstanceOf(TransicaoInvalidaError)
      expect(estado.docs[0]!.status).toBe(status)
    }
  })

  it("documento de outra loja → mesmo 404 de inexistente; competência FECHADA → 409", async () => {
    const escopo = escopoExternoFake({ papel: "CONFERENCIA" })
    const estado: Estado = {
      docs: [
        linhaDoc({ id: "doc-alheio", storeId: "loja-2" }),
        linhaDoc({ id: "doc-fechado", competenciaStatus: "FECHADA" }),
      ],
      eventos: [],
    }
    const repo = repoFalso(estado)
    await expect(marcarDocumentoConferidoPortal(escopo, { documentoId: "doc-alheio" }, { repo })).rejects.toBeInstanceOf(DocumentoNaoEncontradoError)
    await expect(marcarDocumentoConferidoPortal(escopo, { documentoId: "doc-fechado" }, { repo })).rejects.toBeInstanceOf(CompetenciaFechadaError)
    expect(estado.eventos).toEqual([])
  })
})
