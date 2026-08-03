/**
 * GOAL CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 — rotas de documentos do portal:
 * listagem, download (evento externo + IP/UA antes da URL) e conferir (papel).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/contador/scope", () => ({ requireContadorScope: vi.fn() }))

import { __setRepoAuthExternaParaTestes } from "./_shared"
import { __setDepsPortalParaTestes } from "@/lib/contador/portal/deps"
import {
  criarDepsFalsasPortal,
  ENV_FLAG_PORTAL,
  ENV_SEGREDO_SESSAO_EXTERNA,
  estadoDominioVazio,
  IP_TESTE,
  linhaCompetenciaTeste,
  linhaDocumentoTeste,
  loginPortal,
  montarAuthPortal,
  reqPortal,
  SEGREDO_PORTAL,
  type AuthPortalTeste,
  type EstadoDominioPortal,
} from "./_testutils"
import { GET as documentosGET } from "./lojas/[loja]/competencias/[c]/documentos/route"
import { POST as downloadPOST } from "./lojas/[loja]/documentos/[id]/download/route"
import { POST as conferirPOST } from "./lojas/[loja]/documentos/[id]/conferir/route"

const BASE = "/api/contador-externo/lojas"

let auth: AuthPortalTeste
let estado: EstadoDominioPortal
let token: string

function setup1(loja: string, papelEmUso: "loja-A" | "loja-C") {
  estado.competencias.push(
    linhaCompetenciaTeste({ id: `comp-${papelEmUso}`, storeId: papelEmUso, status: "ABERTA" }),
  )
  estado.documentos.push(
    linhaDocumentoTeste({ id: "doc-1", competenciaId: `comp-${papelEmUso}`, storeId: papelEmUso }),
  )
  estado.storageRefs.add(`contador/${papelEmUso}/2026-07/doc-1/nfe-julho.pdf`)
  return `${BASE}/${loja}`
}

beforeEach(async () => {
  process.env[ENV_SEGREDO_SESSAO_EXTERNA] = SEGREDO_PORTAL
  process.env[ENV_FLAG_PORTAL] = "on"
  auth = await montarAuthPortal()
  __setRepoAuthExternaParaTestes(auth.repo)
  estado = estadoDominioVazio()
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

describe("GET documentos da competência", () => {
  it("200 sem storageRef e com remetente interno pseudonimizado", async () => {
    setup1("loja-A", "loja-A")
    const res = await documentosGET(
      reqPortal(`${BASE}/loja-A/competencias/2026-07/documentos`, { cookie: token }),
      { params: Promise.resolve({ loja: "loja-A", c: "2026-07" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.documentos).toHaveLength(1)
    expect(body.documentos[0].enviadoPorId).toMatch(/^u_[0-9a-f]{16}$/)
    expect(body.documentos[0]).not.toHaveProperty("storageRef")
    expect(JSON.stringify(body)).not.toContain("contador/loja-A/2026-07/doc-1")
  })
})

describe("POST documentos/[id]/download", () => {
  it("200: evento externo com ipHash/UA gravado, resposta sem storageRef, TTL ≤ 300", async () => {
    setup1("loja-A", "loja-A")
    const res = await downloadPOST(
      reqPortal(`${BASE}/loja-A/documentos/doc-1/download`, { cookie: token, method: "POST", body: {} }),
      { params: Promise.resolve({ loja: "loja-A", id: "doc-1" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.download.signedUrl).toContain("https://")
    expect(body.download.expiresInSec).toBeLessThanOrEqual(300)
    expect(JSON.stringify(body)).not.toContain("contador/loja-A/2026-07/doc-1")

    expect(estado.eventos).toHaveLength(1)
    const evento = estado.eventos[0]!
    expect(evento).toMatchObject({
      tipo: "documento_download_autorizado",
      atorTipo: "externo",
      atorId: "usr-1",
      storeId: "loja-A",
      competenciaId: "comp-loja-A",
      userAgent: "vitest-portal/1.0",
    })
    expect(evento.ip).toMatch(/^[0-9a-f]{16}$/)
    expect(evento.ip).not.toBe(IP_TESTE)
    // TTL repassado ao storage com teto de 300s.
    expect(estado.downloadsAssinados[0]!.ttl).toBeLessThanOrEqual(300)
  })

  it("documento inexistente → 404 sem evento", async () => {
    setup1("loja-A", "loja-A")
    const res = await downloadPOST(
      reqPortal(`${BASE}/loja-A/documentos/doc-404/download`, { cookie: token, method: "POST", body: {} }),
      { params: Promise.resolve({ loja: "loja-A", id: "doc-404" }) },
    )
    expect(res.status).toBe(404)
    expect(estado.eventos).toEqual([])
    expect(estado.downloadsAssinados).toEqual([])
  })
})

describe("POST documentos/[id]/conferir — somente CONFERENCIA", () => {
  it("LEITURA (loja-A) → 403 de domínio, sem escrita nem evento", async () => {
    setup1("loja-A", "loja-A")
    const res = await conferirPOST(
      reqPortal(`${BASE}/loja-A/documentos/doc-1/conferir`, { cookie: token, method: "POST", body: {} }),
      { params: Promise.resolve({ loja: "loja-A", id: "doc-1" }) },
    )
    expect(res.status).toBe(403)
    expect(estado.documentos[0]!.status).toBe("ENVIADO")
    expect(estado.eventosDominio).toEqual([])
  })

  it("CONFERENCIA (loja-C) → 200, status CONFERIDO + evento externo na trilha", async () => {
    setup1("loja-C", "loja-C")
    const res = await conferirPOST(
      reqPortal(`${BASE}/loja-C/documentos/doc-1/conferir`, { cookie: token, method: "POST", body: {} }),
      { params: Promise.resolve({ loja: "loja-C", id: "doc-1" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.conferencia).toMatchObject({ id: "doc-1", status: "CONFERIDO", competencia: "2026-07" })
    expect(estado.documentos[0]!.status).toBe("CONFERIDO")
    expect(estado.eventosDominio[0]).toMatchObject({
      tipo: "status_alterado",
      atorTipo: "externo",
      atorId: "usr-1",
      metadata: { statusAnterior: "ENVIADO", statusNovo: "CONFERIDO", acao: "conferir" },
    })
  })

  it("já CONFERIDO → 409 (transição fora da matriz)", async () => {
    setup1("loja-C", "loja-C")
    estado.documentos[0]!.status = "CONFERIDO"
    const res = await conferirPOST(
      reqPortal(`${BASE}/loja-C/documentos/doc-1/conferir`, { cookie: token, method: "POST", body: {} }),
      { params: Promise.resolve({ loja: "loja-C", id: "doc-1" }) },
    )
    expect(res.status).toBe(409)
    expect(estado.eventosDominio).toEqual([])
  })
})
