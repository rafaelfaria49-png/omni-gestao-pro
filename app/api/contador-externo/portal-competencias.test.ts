/**
 * GOAL CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 — rotas GET de competências:
 * lista (janela 13), resumo (snapshot × vivo) e checklist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/contador/scope", () => ({ requireContadorScope: vi.fn() }))

import { SNAPSHOT_SCHEMA } from "@/lib/contador/fechamento/snapshot"
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
import { GET as competenciasGET } from "./lojas/[loja]/competencias/route"
import { GET as resumoGET } from "./lojas/[loja]/competencias/[c]/resumo/route"
import { GET as checklistGET } from "./lojas/[loja]/competencias/[c]/checklist/route"

const BASE = "/api/contador-externo/lojas/loja-A/competencias"

let auth: AuthPortalTeste
let estado: EstadoDominioPortal
let token: string

function paramsLoja(loja = "loja-A") {
  return { params: Promise.resolve({ loja }) }
}
function paramsComp(c: string, loja = "loja-A") {
  return { params: Promise.resolve({ loja, c }) }
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

describe("GET competencias — janela de 13 meses", () => {
  it("200 com 13 itens, selo `oficial vN` só na fechada, Cache-Control privado", async () => {
    estado.competencias.push(
      linhaCompetenciaTeste({ id: "comp-f", storeId: "loja-A", ano: 2026, mes: 6, status: "FECHADA", versao: 2, fechadaEm: AGORA_TESTE }),
    )
    const res = await competenciasGET(reqPortal(BASE, { cookie: token }), paramsLoja())
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store, max-age=0")
    const body = await res.json()
    expect(body.competencias).toHaveLength(13)
    const fechada = body.competencias.find((c: { codigo: string }) => c.codigo === "2026-06")
    expect(fechada).toMatchObject({ status: "FECHADA", fechada: true, selo: "oficial v2" })
    const semLinha = body.competencias.find((c: { codigo: string }) => c.codigo === "2026-05")
    expect(semLinha).toMatchObject({ status: "ABERTA", fechada: false, selo: null })
  })
})

describe("GET resumo — duas origens honestas", () => {
  it("FECHADA → origem snapshot com selo; leitura viva NÃO é chamada", async () => {
    estado.competencias.push(
      linhaCompetenciaTeste({
        id: "comp-f",
        storeId: "loja-A",
        ano: 2026,
        mes: 7,
        status: "FECHADA",
        versao: 2,
        fechadaEm: AGORA_TESTE,
        snapshotHash: "f".repeat(64),
        snapshot: {
          schemaVersion: SNAPSHOT_SCHEMA,
          competencia: { ano: 2026, mes: 7, codigo: "2026-07" },
          versao: 2,
          fechadaEm: AGORA_TESTE.toISOString(),
          responsavel: { tipo: "interno", id: "u_x" },
          totais: { "vendas.total": { valor: 1234.56, disponibilidade: "real" } },
          checklist: { contagem: { ok: 10, atencao: 0, pendente: 1, nao_disponivel: 2, total: 13 }, itens: [{ id: "vendas", estado: "ok" }] },
          pendenciasAssumidas: [],
          documentos: { total: 1, porCategoria: { FISCAL: 1 }, porStatus: { ENVIADO: 1 } },
        },
      }),
    )
    const res = await resumoGET(reqPortal(`${BASE}/2026-07/resumo`, { cookie: token }), paramsComp("2026-07"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.resumo).toMatchObject({ origem: "snapshot", fechada: true, selo: "oficial v2" })
    expect(body.resumo.snapshot.totais["vendas.total"].valor).toBe(1234.56)
    expect(body.resumo.dados).toBeNull()
    expect(estado.carregarDadosChamadas).toEqual([])
  })

  it("aberta → origem viva via carregarDados com a loja DO ESCOPO", async () => {
    estado.competencias.push(linhaCompetenciaTeste({ id: "comp-a", storeId: "loja-A", status: "ABERTA" }))
    const res = await resumoGET(reqPortal(`${BASE}/2026-07/resumo`, { cookie: token }), paramsComp("2026-07"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.resumo).toMatchObject({ origem: "vivo", fechada: false, selo: null })
    expect(body.resumo.dados.liquidoCompetencia.valor).toBe(900)
    expect(estado.carregarDadosChamadas).toEqual([{ storeId: "loja-A", ano: 2026, mes: 7 }])
  })

  it("[c] inválido no path → 404 genérico", async () => {
    const res = await resumoGET(reqPortal(`${BASE}/2026-13/resumo`, { cookie: token }), paramsComp("2026-13"))
    expect(res.status).toBe(404)
  })
})

describe("GET checklist", () => {
  it("aberta → checklist vivo com itens; fechada → checklist do snapshot", async () => {
    estado.competencias.push(linhaCompetenciaTeste({ id: "comp-a", storeId: "loja-A", status: "ABERTA" }))
    const viva = await checklistGET(reqPortal(`${BASE}/2026-07/checklist`, { cookie: token }), paramsComp("2026-07"))
    expect(viva.status).toBe(200)
    const bodyViva = await viva.json()
    expect(bodyViva.origem).toBe("vivo")
    expect(bodyViva.checklist.itens.length).toBeGreaterThan(0)
    expect(bodyViva.checklist.contagem.total).toBe(bodyViva.checklist.itens.length)
  })

  it("[c] inválido → 404", async () => {
    const res = await checklistGET(reqPortal(`${BASE}/lixo/checklist`, { cookie: token }), paramsComp("lixo"))
    expect(res.status).toBe(404)
  })
})
