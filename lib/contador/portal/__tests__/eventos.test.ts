/**
 * GOAL CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 — eventos do portal.
 *
 * Exercita o montador puro e o REPOSITÓRIO REAL (`criarRepoEventosPortal`) contra
 * um cliente in-memory — nenhum banco é tocado.
 */
import { describe, expect, it } from "vitest"
import {
  criarRepoEventosPortal,
  montarEventoPortal,
  resolverAtorPortal,
  sanearMetadataPortal,
  type NovoEventoPortal,
  type PortalEventosDbClient,
} from "../eventos"
import { escopoExternoFake } from "./helpers"

describe("sanearMetadataPortal", () => {
  it("descarta chaves fora da allowlist, objetos e strings longas; preserva primitivos", () => {
    const limpa = sanearMetadataPortal({
      competencia: "2026-07",
      versao: 2,
      bytes: 1024,
      visibilidade: "compartilhada",
      texto: "NUNCA pode vazar", // fora da allowlist
      storageRef: "contador/loja/doc.pdf", // fora da allowlist
      url: "https://assinada", // fora da allowlist
      aninhado: { x: 1 }, // tipo proibido
      lista: [1, 2], // tipo proibido
      nulo: null, // tipo proibido (metadata plana)
      manifestoHash: "x".repeat(500), // permitida, mas truncada em 120
    })
    expect(limpa).toEqual({
      competencia: "2026-07",
      versao: 2,
      bytes: 1024,
      visibilidade: "compartilhada",
      manifestoHash: "x".repeat(120),
    })
  })

  it("sem chave permitida → null (não grava metadata vazia)", () => {
    expect(sanearMetadataPortal({ texto: "livre" })).toBeNull()
    expect(sanearMetadataPortal(null)).toBeNull()
    expect(sanearMetadataPortal(undefined)).toBeNull()
  })
})

describe("resolverAtorPortal + montarEventoPortal", () => {
  it("ip vira hash (16 hex, ≠ bruto), UA é resumido e metadata é saneada", async () => {
    const escopo = escopoExternoFake({ usuarioId: "usr-ext-1" })
    const ator = await resolverAtorPortal({
      escopo,
      ip: "203.0.113.10",
      userAgent: `Agente ${"y".repeat(300)}`,
    })
    expect(ator.atorId).toBe("usr-ext-1")
    expect(ator.ipHash).toMatch(/^[0-9a-f]{16}$/)
    expect(ator.ipHash).not.toContain("203.0.113.10")
    expect(ator.userAgentResumo).toHaveLength(200)

    const evento = montarEventoPortal({
      escopo,
      ator,
      competenciaId: "comp-1",
      tipo: "documento_download_autorizado",
      entidade: "documento",
      entidadeId: "doc-1",
      metadata: { categoria: "FISCAL", expiresInSec: 300, storageRef: "proibido" },
    })
    expect(evento).toMatchObject({
      storeId: "loja-1",
      competenciaId: "comp-1",
      tipo: "documento_download_autorizado",
      atorTipo: "externo",
      atorId: "usr-ext-1",
      origem: "contador.portal",
      metadata: { categoria: "FISCAL", expiresInSec: 300 },
      ip: ator.ipHash,
      userAgent: ator.userAgentResumo,
    })
    expect(JSON.stringify(evento)).not.toContain("203.0.113.10")
    expect(JSON.stringify(evento.metadata)).not.toContain("proibido")
  })

  it("sem IP/UA → null (nunca inventa); competenciaId preenchido quando aplicável", async () => {
    const escopo = escopoExternoFake()
    const ator = await resolverAtorPortal({ escopo })
    expect(ator.ipHash).toBeNull()
    expect(ator.userAgentResumo).toBeNull()
    const evento = montarEventoPortal({ escopo, ator, competenciaId: "comp-9", tipo: "status_alterado" })
    expect(evento.competenciaId).toBe("comp-9")
    expect(evento.ip).toBeNull()
    expect(evento.userAgent).toBeNull()
  })
})

/* ───────────── repo real contra cliente in-memory ───────────── */

type EstadoEventos = { linhas: Record<string, unknown>[] }

function clienteFalso(): PortalEventosDbClient & { estado: EstadoEventos } {
  const estado: EstadoEventos = { linhas: [] }
  return {
    estado,
    contadorEvento: {
      async create({ data }) {
        const row = { id: `ev-${estado.linhas.length + 1}`, createdAt: new Date("2026-08-01T13:00:00Z"), ...data }
        estado.linhas.push(row)
        return { id: row.id as string, createdAt: row.createdAt as Date }
      },
      async findFirst({ where }) {
        const w = where as {
          tipo?: string
          storeId?: string
          competenciaId?: string
          atorId?: string
          metadata?: { path: string[]; equals: unknown }
        }
        const row = estado.linhas.find((e) => {
          if (w.tipo !== undefined && e.tipo !== w.tipo) return false
          if (w.storeId !== undefined && e.storeId !== w.storeId) return false
          if (w.competenciaId !== undefined && e.competenciaId !== w.competenciaId) return false
          if (w.atorId !== undefined && e.atorId !== w.atorId) return false
          if (w.metadata) {
            const meta = e.metadata as Record<string, unknown> | null
            const chave = w.metadata.path[0]!
            if (!meta || meta[chave] !== w.metadata.equals) return false
          }
          return true
        })
        return row ? { id: row.id as string, createdAt: row.createdAt as Date } : null
      },
    },
  }
}

describe("criarRepoEventosPortal (repo real, cliente fake)", () => {
  const escopo = escopoExternoFake({ usuarioId: "usr-ext-1" })

  async function gravar(repo: ReturnType<typeof criarRepoEventosPortal>): Promise<NovoEventoPortal> {
    const ator = await resolverAtorPortal({ escopo, ip: "198.51.100.7", userAgent: "UA teste" })
    const evento = montarEventoPortal({
      escopo,
      ator,
      competenciaId: "comp-1",
      tipo: "pacote_recebimento_confirmado",
      entidade: "competencia",
      entidadeId: "comp-1",
      metadata: { competencia: "2026-07", versao: 3, manifestoHash: "abc" },
    })
    await repo.registrarEvento(evento)
    return evento
  }

  it("persiste competenciaId, ipHash e UA resumido na linha", async () => {
    const db = clienteFalso()
    const repo = criarRepoEventosPortal(db)
    await gravar(repo)
    const linha = db.estado.linhas[0]!
    expect(linha).toMatchObject({
      competenciaId: "comp-1",
      tipo: "pacote_recebimento_confirmado",
      atorTipo: "externo",
      atorId: "usr-ext-1",
      metadata: { competencia: "2026-07", versao: 3, manifestoHash: "abc" },
    })
    expect(linha.ip).toMatch(/^[0-9a-f]{16}$/)
    expect(JSON.stringify(linha)).not.toContain("198.51.100.7")
    expect(linha.userAgent).toBe("UA teste")
  })

  it("acharRecebimentoPacote faz o dedupe por (loja, competência, ator, versão)", async () => {
    const db = clienteFalso()
    const repo = criarRepoEventosPortal(db)
    await gravar(repo)
    const achou = await repo.acharRecebimentoPacote({
      storeId: "loja-1",
      competenciaId: "comp-1",
      atorId: "usr-ext-1",
      versao: 3,
    })
    expect(achou?.criadoEm).toEqual(new Date("2026-08-01T13:00:00Z"))
    // Versão/ator/loja diferentes NÃO casam — o dedupe é exato.
    for (const tentativa of [
      { versao: 4 },
      { atorId: "usr-ext-2" },
      { storeId: "loja-2" },
      { competenciaId: "comp-2" },
    ]) {
      const naoAchou = await repo.acharRecebimentoPacote({
        storeId: "loja-1",
        competenciaId: "comp-1",
        atorId: "usr-ext-1",
        versao: 3,
        ...tentativa,
      })
      expect(naoAchou).toBeNull()
    }
  })
})
