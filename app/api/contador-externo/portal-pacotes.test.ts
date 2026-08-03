/**
 * GOAL CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 — rotas de pacotes do portal:
 * listagem de versões, download e confirmação de recebimento idempotente.
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
  linhaCompetenciaTeste,
  linhaPacoteTeste,
  loginPortal,
  montarAuthPortal,
  reqPortal,
  SEGREDO_PORTAL,
  type AuthPortalTeste,
  type EstadoDominioPortal,
} from "./_testutils"
import { GET as pacotesGET } from "./lojas/[loja]/competencias/[c]/pacotes/route"
import { POST as downloadPOST } from "./lojas/[loja]/pacotes/download/route"
import { POST as confirmarPOST } from "./lojas/[loja]/pacotes/confirmar/route"

const BASE = "/api/contador-externo/lojas/loja-A"

let auth: AuthPortalTeste
let estado: EstadoDominioPortal
let token: string

const paramsLoja = { params: Promise.resolve({ loja: "loja-A" }) }

beforeEach(async () => {
  process.env[ENV_SEGREDO_SESSAO_EXTERNA] = SEGREDO_PORTAL
  process.env[ENV_FLAG_PORTAL] = "on"
  auth = await montarAuthPortal()
  __setRepoAuthExternaParaTestes(auth.repo)
  estado = estadoDominioVazio()
  estado.competencias.push(
    linhaCompetenciaTeste({ id: "comp-A", storeId: "loja-A", status: "FECHADA", versao: 1 }),
  )
  estado.pacotes.push(linhaPacoteTeste({ id: "pct-A1", competenciaId: "comp-A", versao: 1 }))
  estado.storageRefs.add("contador/loja-A/2026-07/pacotes/v1/hash.zip")
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

describe("GET pacotes da competência", () => {
  it("200 com a versão materializada, gerador interno pseudonimizado, sem storageRef", async () => {
    const res = await pacotesGET(reqPortal(`${BASE}/competencias/2026-07/pacotes`, { cookie: token }), {
      params: Promise.resolve({ loja: "loja-A", c: "2026-07" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pacotes).toHaveLength(1)
    expect(body.pacotes[0]).toMatchObject({ versao: 1, geradoPorTipo: "interno" })
    expect(body.pacotes[0].geradoPorId).toMatch(/^u_[0-9a-f]{16}$/)
    expect(JSON.stringify(body)).not.toContain("hash.zip")
  })
})

describe("POST pacotes/download", () => {
  it("200: evento pacote_baixado externo com ipHash/UA; body inválido → 422", async () => {
    const res = await downloadPOST(
      reqPortal(`${BASE}/pacotes/download`, { cookie: token, method: "POST", body: { competencia: "2026-07", versao: 1 } }),
      paramsLoja,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.download).toMatchObject({ versao: 1, nomeArquivo: "pacote-contador-2026-07-v1.zip" })
    expect(body.download.expiresInSec).toBeLessThanOrEqual(300)
    expect(JSON.stringify(body)).not.toContain("hash.zip")
    expect(estado.eventos[0]).toMatchObject({
      tipo: "pacote_baixado",
      atorTipo: "externo",
      atorId: "usr-1",
      competenciaId: "comp-A",
    })
    expect(estado.eventos[0]!.ip).toMatch(/^[0-9a-f]{16}$/)

    const competenciaLixo = await downloadPOST(
      reqPortal(`${BASE}/pacotes/download`, { cookie: token, method: "POST", body: { competencia: "07/2026", versao: 1 } }),
      paramsLoja,
    )
    expect(competenciaLixo.status).toBe(422)
    const versaoLixo = await downloadPOST(
      reqPortal(`${BASE}/pacotes/download`, { cookie: token, method: "POST", body: { competencia: "2026-07", versao: 0 } }),
      paramsLoja,
    )
    expect(versaoLixo.status).toBe(422)
    // Só o primeiro download gerou evento.
    expect(estado.eventos).toHaveLength(1)
  })
})

describe("POST pacotes/confirmar — idempotente", () => {
  it("2 POSTs → 1 só evento e o MESMO confirmadoEm; LEITURA pode confirmar", async () => {
    const corpo = { competencia: "2026-07", versao: 1 }
    const r1 = await confirmarPOST(reqPortal(`${BASE}/pacotes/confirmar`, { cookie: token, method: "POST", body: corpo }), paramsLoja)
    expect(r1.status).toBe(200)
    const b1 = await r1.json()
    expect(b1.recebimento.confirmado).toBe(true)

    const r2 = await confirmarPOST(reqPortal(`${BASE}/pacotes/confirmar`, { cookie: token, method: "POST", body: corpo }), paramsLoja)
    expect(r2.status).toBe(200)
    const b2 = await r2.json()

    expect(b2.recebimento).toEqual(b1.recebimento)
    expect(estado.eventos).toHaveLength(1)
    expect(estado.eventos[0]).toMatchObject({
      tipo: "pacote_recebimento_confirmado",
      atorTipo: "externo",
      atorId: "usr-1",
      metadata: { competencia: "2026-07", versao: 1 },
    })
  })

  it("versão inexistente → 404; competência inválida → 422", async () => {
    const naoExiste = await confirmarPOST(
      reqPortal(`${BASE}/pacotes/confirmar`, { cookie: token, method: "POST", body: { competencia: "2026-07", versao: 9 } }),
      paramsLoja,
    )
    expect(naoExiste.status).toBe(404)
    const invalida = await confirmarPOST(
      reqPortal(`${BASE}/pacotes/confirmar`, { cookie: token, method: "POST", body: { competencia: "2026-7", versao: 1 } }),
      paramsLoja,
    )
    expect(invalida.status).toBe(422)
    expect(estado.eventos).toEqual([])
  })
})
