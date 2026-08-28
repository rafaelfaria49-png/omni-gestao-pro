/**
 * GOAL 020 — POST /api/fiscal/contingencia sobre dependências EM MEMÓRIA.
 *
 * Exercita o handler de PRODUÇÃO e prova a superfície fail-closed atual:
 *  - o gate externo (material A1 da homologação) NÃO está liberado: toda entrada
 *    válida termina em 503 `EXTERNAL_HOMOLOGATION_PENDING`;
 *  - nenhuma numeração é reservada e nenhuma contingência é persistida enquanto
 *    o gate estiver fechado (`NUMBER_REUSE`/`EXTERNAL_HOMOLOGATION_PENDING`);
 *  - PRODUCAO, modelo/provider fora do piloto e loja desabilitada são recusados
 *    ANTES de qualquer efeito;
 *  - corpo inválido e JSON inválido não tocam configuração nem numeração.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const STORE = "loja-1"

const h = vi.hoisted(() => {
  return {
    prisma: {
      configuracaoFiscalLoja: {
        findUnique: vi.fn(),
      },
    },
    requireFiscalAdmin: vi.fn(),
    allocateFiscalNumber: vi.fn(),
    createPrismaFiscalNumberingPorts: vi.fn(() => ({ __ports: true })),
    enterManualOfflineContingency: vi.fn(),
    createPrismaOfflineContingencyPersistence: vi.fn(() => ({ __persistence: true })),
    createPersistedNfceFinalizationSourceResolver: vi.fn(() => ({ __resolver: true })),
    createFinalizedNfcePreparer: vi.fn(() => ({ __preparer: true })),
  }
})

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }))
vi.mock("@/lib/store-id-from-request", () => ({
  storeIdFromAssistecRequestForWrite: vi.fn(() => STORE),
}))
vi.mock("@/lib/fiscal/guard-fiscal-admin", () => ({
  requireFiscalAdmin: h.requireFiscalAdmin,
}))
vi.mock("@/lib/fiscal/numbering/allocate-fiscal-number", () => ({
  allocateFiscalNumber: h.allocateFiscalNumber,
}))
vi.mock("@/lib/fiscal/numbering/prisma-numbering-ports", () => ({
  createPrismaFiscalNumberingPorts: h.createPrismaFiscalNumberingPorts,
}))
vi.mock("@/lib/fiscal/contingencia/offline-contingency", () => ({
  enterManualOfflineContingency: h.enterManualOfflineContingency,
}))
vi.mock("@/lib/fiscal/contingencia/prisma-offline-contingency-ports", () => ({
  createPrismaOfflineContingencyPersistence: h.createPrismaOfflineContingencyPersistence,
}))
vi.mock("@/lib/fiscal/emission/nfce-finalization-source-resolver", () => ({
  createPersistedNfceFinalizationSourceResolver: h.createPersistedNfceFinalizationSourceResolver,
}))
vi.mock("@/lib/fiscal/emission/finalized-nfce-preparer", () => ({
  createFinalizedNfcePreparer: h.createFinalizedNfcePreparer,
}))

import { POST } from "./route"

function request(body: unknown) {
  return new Request("http://localhost/api/fiscal/contingencia", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

function config(overrides: Record<string, unknown> = {}) {
  return {
    fiscalEnabled: true,
    ambiente: "HOMOLOGACAO",
    modeloFiscal: "NFCE",
    provider: "SEFAZ_DIRETO",
    ...overrides,
  }
}

const validBody = {
  vendaId: "venda-1",
  notaFiscalId: "nota-1",
  xJust: "Falha de comunicação com a SEFAZ",
  confirmarManual: true,
}

describe("POST /api/fiscal/contingencia — GOAL 020 fail-closed", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(h.prisma.configuracaoFiscalLoja.findUnique).mockResolvedValue(config())
    h.requireFiscalAdmin.mockResolvedValue({
      ok: true,
      session: { user: { id: "u1", email: "admin@teste" } },
      storeId: STORE,
    })
  })

  it("recusa sem admin fiscal antes de qualquer leitura ou efeito", async () => {
    h.requireFiscalAdmin.mockResolvedValue({ ok: false, status: 403, error: "Apenas administradores" })
    const res = await POST(request(validBody))
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json).toMatchObject({ ok: false, code: "fiscal_admin_required" })
    expect(h.prisma.configuracaoFiscalLoja.findUnique).not.toHaveBeenCalled()
    expect(h.allocateFiscalNumber).not.toHaveBeenCalled()
    expect(h.enterManualOfflineContingency).not.toHaveBeenCalled()
  })

  it("recusa loja fiscalmente desabilitada com 423", async () => {
    vi.mocked(h.prisma.configuracaoFiscalLoja.findUnique).mockResolvedValue(
      config({ fiscalEnabled: false }),
    )
    const res = await POST(request(validBody))
    const json = await res.json()
    expect(res.status).toBe(423)
    expect(json).toMatchObject({ ok: false, code: "loja_fiscal_desabilitada" })
    expect(h.allocateFiscalNumber).not.toHaveBeenCalled()
  })

  it("recusa PRODUCAO com 409 — piloto é HOMOLOGACAO only", async () => {
    vi.mocked(h.prisma.configuracaoFiscalLoja.findUnique).mockResolvedValue(
      config({ ambiente: "PRODUCAO" }),
    )
    const res = await POST(request(validBody))
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json).toMatchObject({ ok: false, code: "contexto_piloto_invalido" })
    expect(h.allocateFiscalNumber).not.toHaveBeenCalled()
    expect(h.enterManualOfflineContingency).not.toHaveBeenCalled()
  })

  it("recusa modelo não-NFCE com 409", async () => {
    vi.mocked(h.prisma.configuracaoFiscalLoja.findUnique).mockResolvedValue(
      config({ modeloFiscal: "NFE" }),
    )
    const res = await POST(request(validBody))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("contexto_piloto_invalido")
  })

  it("recusa provider fora do piloto com 409", async () => {
    vi.mocked(h.prisma.configuracaoFiscalLoja.findUnique).mockResolvedValue(
      config({ provider: "STUB_HOMOLOGACAO" }),
    )
    const res = await POST(request(validBody))
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json).toMatchObject({ ok: false, code: "provider_invalido" })
    expect(h.allocateFiscalNumber).not.toHaveBeenCalled()
  })

  it("entrada válida termina em 503 EXTERNAL_HOMOLOGATION_PENDING sem reservar número nem persistir", async () => {
    const res = await POST(request(validBody))
    const json = await res.json()
    expect(res.status).toBe(503)
    expect(json).toMatchObject({
      ok: false,
      code: "EXTERNAL_HOMOLOGATION_PENDING",
      error: "Homologação externa pendente; nenhum número foi reservado.",
    })
    expect(h.prisma.configuracaoFiscalLoja.findUnique).toHaveBeenCalledWith({
      where: { storeId: STORE },
      select: { fiscalEnabled: true, ambiente: true, modeloFiscal: true, provider: true },
    })
    expect(h.allocateFiscalNumber).not.toHaveBeenCalled()
    expect(h.createPrismaFiscalNumberingPorts).not.toHaveBeenCalled()
    expect(h.enterManualOfflineContingency).not.toHaveBeenCalled()
    expect(h.createPrismaOfflineContingencyPersistence).not.toHaveBeenCalled()
    expect(h.createFinalizedNfcePreparer).not.toHaveBeenCalled()
  })

  it("JSON inválido vira 400 sem tocar configuração", async () => {
    const res = await POST(request("{not-json"))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("json_invalido")
    expect(h.prisma.configuracaoFiscalLoja.findUnique).not.toHaveBeenCalled()
  })

  it("corpo fora do schema vira 400 — confirmação manual obrigatória", async () => {
    const res = await POST(request({ ...validBody, confirmarManual: false }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("parametros_invalidos")
    expect(h.prisma.configuracaoFiscalLoja.findUnique).not.toHaveBeenCalled()
  })

  it("xJust abaixo de 15 caracteres vira 400 no schema", async () => {
    const res = await POST(request({ ...validBody, xJust: "curta" }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("parametros_invalidos")
    expect(h.enterManualOfflineContingency).not.toHaveBeenCalled()
  })
})
