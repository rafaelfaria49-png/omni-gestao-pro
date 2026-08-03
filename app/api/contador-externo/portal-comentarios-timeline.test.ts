/**
 * GOAL CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 — rotas de comentários e
 * timeline do portal: comentar (dois papéis), validações e timeline
 * compartilhada com pseudonimização.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/contador/scope", () => ({ requireContadorScope: vi.fn() }))

import { __setRepoAuthExternaParaTestes } from "./_shared"
import { __setDepsPortalParaTestes } from "@/lib/contador/portal/deps"
import {
  AGORA_TESTE,
  criarDepsFalsasPortal,
  ENV_FLAG_PORTAL,
  ENV_SEGREDO_SESSAO_EXTERNA,
  estadoDominioVazio,
  linhaCompetenciaTeste,
  loginPortal,
  montarAuthPortal,
  reqPortal,
  SEGREDO_PORTAL,
  type AuthPortalTeste,
  type EstadoDominioPortal,
} from "./_testutils"
import { POST as comentariosPOST } from "./lojas/[loja]/comentarios/route"
import { GET as timelineGET } from "./lojas/[loja]/competencias/[c]/timeline/route"

const BASE = "/api/contador-externo/lojas"

let auth: AuthPortalTeste
let estado: EstadoDominioPortal
let token: string

function paramsLoja(loja: string) {
  return { params: Promise.resolve({ loja }) }
}

beforeEach(async () => {
  process.env[ENV_SEGREDO_SESSAO_EXTERNA] = SEGREDO_PORTAL
  process.env[ENV_FLAG_PORTAL] = "on"
  auth = await montarAuthPortal()
  __setRepoAuthExternaParaTestes(auth.repo)
  estado = estadoDominioVazio()
  estado.competencias.push(
    linhaCompetenciaTeste({ id: "comp-A", storeId: "loja-A", status: "ABERTA" }),
    linhaCompetenciaTeste({ id: "comp-AF", storeId: "loja-A", ano: 2026, mes: 6, status: "FECHADA" }),
    linhaCompetenciaTeste({ id: "comp-C", storeId: "loja-C", status: "ABERTA" }),
  )
  __setDepsPortalParaTestes(criarDepsFalsasPortal(estado))
  token = await loginPortal(auth.repo)
})

afterEach(() => {
  __setRepoAuthExternaParaTestes(null)
  __setDepsPortalParaTestes(null)
  delete process.env[ENV_SEGREDO_SESSAO_EXTERNA]
  delete process.env[ENV_FLAG_PORTAL]
  vi.restoreAllMocks()
})

describe("POST comentarios — permitido aos dois papéis (matriz §7.2)", () => {
  it("LEITURA (loja-A) e CONFERENCIA (loja-C) comentam como externo + compartilhada", async () => {
    const r1 = await comentariosPOST(
      reqPortal(`${BASE}/loja-A/comentarios`, { cookie: token, method: "POST", body: { competencia: "2026-07", texto: "Recebido, obrigado." } }),
      paramsLoja("loja-A"),
    )
    expect(r1.status).toBe(201)
    const b1 = await r1.json()
    expect(b1.comentario).toMatchObject({ autorTipo: "externo", autorId: "usr-1", visibilidade: "compartilhada" })

    const r2 = await comentariosPOST(
      reqPortal(`${BASE}/loja-C/comentarios`, { cookie: token, method: "POST", body: { competencia: "2026-07", texto: "Conferido o pacote." } }),
      paramsLoja("loja-C"),
    )
    expect(r2.status).toBe(201)

    expect(estado.comentarios).toHaveLength(2)
    for (const c of estado.comentarios) {
      expect(c.visibilidade).toBe("compartilhada")
      expect(c.autorTipo).toBe("externo")
    }
    // Evento externo na mesma transação, metadata sem texto.
    expect(estado.eventosDominio[0]).toMatchObject({
      tipo: "comentario_criado",
      atorTipo: "externo",
      metadata: { visibilidade: "compartilhada", textoLen: 19, competencia: "2026-07" },
    })
    expect(JSON.stringify(estado.eventosDominio[0])).not.toContain("Recebido")
  })

  it("texto > 4000 → 422; competência inválida → 422; FECHADA → 409", async () => {
    const longo = await comentariosPOST(
      reqPortal(`${BASE}/loja-A/comentarios`, { cookie: token, method: "POST", body: { competencia: "2026-07", texto: "x".repeat(4001) } }),
      paramsLoja("loja-A"),
    )
    expect(longo.status).toBe(422)

    const invalida = await comentariosPOST(
      reqPortal(`${BASE}/loja-A/comentarios`, { cookie: token, method: "POST", body: { competencia: "julho/2026", texto: "oi" } }),
      paramsLoja("loja-A"),
    )
    expect(invalida.status).toBe(422)

    const fechada = await comentariosPOST(
      reqPortal(`${BASE}/loja-A/comentarios`, { cookie: token, method: "POST", body: { competencia: "2026-06", texto: "tarde" } }),
      paramsLoja("loja-A"),
    )
    expect(fechada.status).toBe(409)

    expect(estado.comentarios).toEqual([])
    expect(estado.eventosDominio).toEqual([])
  })
})

describe("GET timeline — contexto compartilhado + pseudonimização", () => {
  it("200: comentário interno fora, ator interno pseudonimizado, externo identificável", async () => {
    estado.timelineEventos.push({
      id: "ev-1",
      tipo: "documento_enviado",
      atorTipo: "interno",
      atorId: "admin-user-42",
      entidade: "documento",
      entidadeId: "doc-1",
      origem: "contador.documentos",
      metadata: { categoria: "FISCAL" },
      createdAt: AGORA_TESTE,
    })
    estado.comentarios.push(
      {
        id: "cmt-1",
        competenciaId: "comp-A",
        documentoId: null,
        autorTipo: "interno",
        autorId: "admin-user-42",
        visibilidade: "interna",
        texto: "NUNCA pode sair no portal",
        createdAt: AGORA_TESTE,
      },
      {
        id: "cmt-2",
        competenciaId: "comp-A",
        documentoId: null,
        autorTipo: "externo",
        autorId: "usr-1",
        visibilidade: "compartilhada",
        texto: "visível",
        createdAt: AGORA_TESTE,
      },
    )
    const res = await timelineGET(
      reqPortal(`${BASE}/loja-A/competencias/2026-07/timeline`, { cookie: token }),
      { params: Promise.resolve({ loja: "loja-A", c: "2026-07" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.timeline.contexto).toBe("compartilhado")
    const ids = body.timeline.itens.map((i: { id: string }) => i.id).sort()
    expect(ids).toEqual(["comentario:cmt-2", "evento:ev-1"])
    expect(JSON.stringify(body)).not.toContain("NUNCA pode sair")
    const eventoInterno = body.timeline.itens.find((i: { id: string }) => i.id === "evento:ev-1")
    expect(eventoInterno.atorId).toMatch(/^u_[0-9a-f]{16}$/)
    const comentarioExterno = body.timeline.itens.find((i: { id: string }) => i.id === "comentario:cmt-2")
    expect(comentarioExterno.atorId).toBe("usr-1")
  })
})
