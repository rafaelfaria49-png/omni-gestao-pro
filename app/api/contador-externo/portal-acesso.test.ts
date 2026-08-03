/**
 * GOAL CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 — varredura de acesso das rotas
 * de dados do portal: flag OFF → 404, sem cookie → 401, cross-store → 403 em
 * TODAS as rotas, revogação no meio da sessão, chaves proibidas.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/contador/scope", () => ({ requireContadorScope: vi.fn() }))

import { revogarVinculo } from "@/lib/contador/auth-externa/acessos"
import { __setRepoAuthExternaParaTestes } from "./_shared"
import { __setDepsPortalParaTestes } from "@/lib/contador/portal/deps"
import {
  AGORA_TESTE,
  criarDepsFalsasPortal,
  ENV_FLAG_PORTAL,
  ENV_SEGREDO_SESSAO_EXTERNA,
  estadoDominioVazio,
  linhaCompetenciaTeste,
  linhaDocumentoTeste,
  linhaPacoteTeste,
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
import { GET as documentosGET } from "./lojas/[loja]/competencias/[c]/documentos/route"
import { GET as pacotesGET } from "./lojas/[loja]/competencias/[c]/pacotes/route"
import { GET as timelineGET } from "./lojas/[loja]/competencias/[c]/timeline/route"
import { POST as downloadDocPOST } from "./lojas/[loja]/documentos/[id]/download/route"
import { POST as downloadPacotePOST } from "./lojas/[loja]/pacotes/download/route"
import { POST as confirmarPOST } from "./lojas/[loja]/pacotes/confirmar/route"
import { POST as comentariosPOST } from "./lojas/[loja]/comentarios/route"
import { POST as conferirPOST } from "./lojas/[loja]/documentos/[id]/conferir/route"

type Handler = (req: Request) => Promise<Response>

/** As 11 rotas de dados do portal, com os params que cada uma consome. */
function todasAsRotas(loja: string): { nome: string; chamar: Handler }[] {
  const comp = Promise.resolve({ loja, c: "2026-07" })
  const doc = Promise.resolve({ loja, id: "doc-1" })
  const soLoja = Promise.resolve({ loja })
  return [
    { nome: "GET competencias", chamar: (r) => competenciasGET(r, { params: soLoja }) },
    { nome: "GET resumo", chamar: (r) => resumoGET(r, { params: comp }) },
    { nome: "GET checklist", chamar: (r) => checklistGET(r, { params: comp }) },
    { nome: "GET documentos", chamar: (r) => documentosGET(r, { params: comp }) },
    { nome: "GET pacotes", chamar: (r) => pacotesGET(r, { params: comp }) },
    { nome: "GET timeline", chamar: (r) => timelineGET(r, { params: comp }) },
    { nome: "POST documentos/download", chamar: (r) => downloadDocPOST(r, { params: doc }) },
    { nome: "POST pacotes/download", chamar: (r) => downloadPacotePOST(r, { params: soLoja }) },
    { nome: "POST pacotes/confirmar", chamar: (r) => confirmarPOST(r, { params: soLoja }) },
    { nome: "POST comentarios", chamar: (r) => comentariosPOST(r, { params: soLoja }) },
    { nome: "POST documentos/conferir", chamar: (r) => conferirPOST(r, { params: doc }) },
  ]
}

function pathDaRota(nome: string, loja: string): { path: string; method: "GET" | "POST"; body?: unknown } {
  const base = `/api/contador-externo/lojas/${loja}`
  switch (nome) {
    case "GET competencias": return { path: `${base}/competencias`, method: "GET" }
    case "GET resumo": return { path: `${base}/competencias/2026-07/resumo`, method: "GET" }
    case "GET checklist": return { path: `${base}/competencias/2026-07/checklist`, method: "GET" }
    case "GET documentos": return { path: `${base}/competencias/2026-07/documentos`, method: "GET" }
    case "GET pacotes": return { path: `${base}/competencias/2026-07/pacotes`, method: "GET" }
    case "GET timeline": return { path: `${base}/competencias/2026-07/timeline`, method: "GET" }
    case "POST documentos/download": return { path: `${base}/documentos/doc-1/download`, method: "POST", body: {} }
    case "POST pacotes/download": return { path: `${base}/pacotes/download`, method: "POST", body: { competencia: "2026-07", versao: 1 } }
    case "POST pacotes/confirmar": return { path: `${base}/pacotes/confirmar`, method: "POST", body: { competencia: "2026-07", versao: 1 } }
    case "POST comentarios": return { path: `${base}/comentarios`, method: "POST", body: { competencia: "2026-07", texto: "ok" } }
    case "POST documentos/conferir": return { path: `${base}/documentos/doc-1/conferir`, method: "POST", body: {} }
    default: throw new Error(nome)
  }
}

let auth: AuthPortalTeste
let estado: EstadoDominioPortal

beforeEach(async () => {
  process.env[ENV_SEGREDO_SESSAO_EXTERNA] = SEGREDO_PORTAL
  process.env[ENV_FLAG_PORTAL] = "on"
  auth = await montarAuthPortal()
  __setRepoAuthExternaParaTestes(auth.repo)
  estado = estadoDominioVazio()
  estado.competencias.push(
    linhaCompetenciaTeste({ id: "comp-A", storeId: "loja-A", status: "FECHADA", versao: 1, fechadaEm: AGORA_TESTE, snapshotHash: "f".repeat(64) }),
    linhaCompetenciaTeste({ id: "comp-C", storeId: "loja-C", status: "ABERTA" }),
  )
  estado.pacotes.push(linhaPacoteTeste({ id: "pct-A", competenciaId: "comp-A" }))
  estado.documentos.push(linhaDocumentoTeste({ id: "doc-1", competenciaId: "comp-A", storeId: "loja-A" }))
  estado.storageRefs.add("contador/loja-A/2026-07/pacotes/v1/hash.zip")
  estado.storageRefs.add("contador/loja-A/2026-07/doc-1/nfe-julho.pdf")
  __setDepsPortalParaTestes(criarDepsFalsasPortal(estado))
})

afterEach(() => {
  __setRepoAuthExternaParaTestes(null)
  __setDepsPortalParaTestes(null)
  delete process.env[ENV_SEGREDO_SESSAO_EXTERNA]
  delete process.env[ENV_FLAG_PORTAL]
  vi.restoreAllMocks()
})

describe("flag CONTADOR_PORTAL_V2 OFF → 404 sem confirmar nada", () => {
  it("GET e POST respondem 404 genérico, mesmo com sessão válida", async () => {
    delete process.env[ENV_FLAG_PORTAL]
    const token = await loginPortal(auth.repo)
    const get = await competenciasGET(reqPortal("/api/contador-externo/lojas/loja-A/competencias", { cookie: token }), {
      params: Promise.resolve({ loja: "loja-A" }),
    })
    expect(get.status).toBe(404)
    const post = await comentariosPOST(
      reqPortal("/api/contador-externo/lojas/loja-A/comentarios", { cookie: token, method: "POST", body: { competencia: "2026-07", texto: "oi" } }),
      { params: Promise.resolve({ loja: "loja-A" }) },
    )
    expect(post.status).toBe(404)
    const body = await post.json()
    expect(body.mensagem).not.toMatch(/loja-A|competencia/i)
  })
})

describe("sem cookie → 401 em TODAS as rotas", () => {
  it("varredura das 11 rotas", async () => {
    for (const rota of todasAsRotas("loja-A")) {
      const alvo = pathDaRota(rota.nome, "loja-A")
      const res = await rota.chamar(reqPortal(alvo.path, { method: alvo.method, body: alvo.body }))
      expect(res.status, `${rota.nome} sem cookie deveria ser 401`).toBe(401)
    }
  })
})

describe("cross-store → 403 em TODAS as rotas, sem confirmar existência", () => {
  it("usr-1 (loja-A/loja-C) no path loja-B: 403 na varredura", async () => {
    const token = await loginPortal(auth.repo)
    for (const rota of todasAsRotas("loja-B")) {
      const alvo = pathDaRota(rota.nome, "loja-B")
      const res = await rota.chamar(reqPortal(alvo.path, { cookie: token, method: alvo.method, body: alvo.body }))
      expect(res.status, `${rota.nome} cross-store deveria ser 403`).toBe(403)
    }
    // Nenhum efeito colateral vazou para a loja-B.
    expect(estado.eventos).toEqual([])
    expect(estado.eventosDominio).toEqual([])
    expect(estado.comentarios).toEqual([])
  })
})

describe("vínculo revogado no meio da sessão → request seguinte cai", () => {
  it("antes: 200; revoga; depois: 403 (demais lojas intactas)", async () => {
    const token = await loginPortal(auth.repo)
    const params = Promise.resolve({ loja: "loja-A" })
    const antes = await competenciasGET(reqPortal("/api/contador-externo/lojas/loja-A/competencias", { cookie: token }), { params })
    expect(antes.status).toBe(200)

    await revogarVinculo(auth.repo, { acessoId: "acs-1", storeId: "loja-A", adminId: "admin-1" })

    const depois = await competenciasGET(reqPortal("/api/contador-externo/lojas/loja-A/competencias", { cookie: token }), { params })
    expect(depois.status).toBe(403)
    // loja-C (outro vínculo, ATIVO) segue respondendo.
    const intacta = await competenciasGET(reqPortal("/api/contador-externo/lojas/loja-C/competencias", { cookie: token }), {
      params: Promise.resolve({ loja: "loja-C" }),
    })
    expect(intacta.status).toBe(200)
  })
})

describe("chaves proibidas (§9) — loja/usuário/papel nunca vêm do cliente", () => {
  it("storeId na query (GET) e no body (POST) → 400", async () => {
    const token = await loginPortal(auth.repo)
    const get = await competenciasGET(
      reqPortal("/api/contador-externo/lojas/loja-A/competencias?storeId=loja-B", { cookie: token }),
      { params: Promise.resolve({ loja: "loja-A" }) },
    )
    expect(get.status).toBe(400)

    const post = await comentariosPOST(
      reqPortal("/api/contador-externo/lojas/loja-A/comentarios", {
        cookie: token,
        method: "POST",
        body: { competencia: "2026-07", texto: "oi", storeId: "loja-B" },
      }),
      { params: Promise.resolve({ loja: "loja-A" }) },
    )
    expect(post.status).toBe(400)
    expect(estado.comentarios).toEqual([])
  })
})
