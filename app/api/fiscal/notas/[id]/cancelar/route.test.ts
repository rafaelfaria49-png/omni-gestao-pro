import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const requireFiscalAdmin = vi.fn()
  const cancelar = vi.fn()
  const opsLojaIdFromRequestForWrite = vi.fn(() => "loja-1")
  const getOperatorLabelFromSession = vi.fn(() => "Admin")
  return { requireFiscalAdmin, cancelar, opsLojaIdFromRequestForWrite, getOperatorLabelFromSession }
})

vi.mock("@/lib/ops-api-gate", () => ({
  opsLojaIdFromRequestForWrite: h.opsLojaIdFromRequestForWrite,
}))
vi.mock("@/lib/fiscal/guard-fiscal-admin", () => ({
  requireFiscalAdmin: h.requireFiscalAdmin,
}))
vi.mock("@/lib/auth/session-operator", () => ({
  getOperatorLabelFromSession: h.getOperatorLabelFromSession,
}))
vi.mock("@/lib/fiscal/events/cancelamento-prisma", () => ({
  cancelarNfceAutorizadaPersistido: h.cancelar,
}))

import { POST } from "./route"

describe("POST /api/fiscal/notas/[id]/cancelar", () => {
  beforeEach(() => {
    h.requireFiscalAdmin.mockReset()
    h.cancelar.mockReset()
    h.opsLojaIdFromRequestForWrite.mockReturnValue("loja-1")
    h.requireFiscalAdmin.mockResolvedValue({ ok: true, session: { user: { id: "u1" } }, storeId: "loja-1" })
    h.cancelar.mockResolvedValue({
      ok: true,
      resultado: "autorizado",
      code: "cancelamento_fiscal_autorizado",
      mensagem: "ok",
      statusHttp: 200,
      idempotente: false,
      sequencia: 1,
      notaStatus: "CANCELADA",
      vendaFiscalStatus: "CANCELADA_FISCAL",
      eventoId: "evt-1",
      protocolo: "135",
      cStat: "135",
      xmlAutorizadoAlterado: false,
      financeWriteCount: 0,
    })
  })

  it("exige admin e delega ao serviço persistido", async () => {
    const req = new Request("http://localhost/api/fiscal/notas/nota-1/cancelar", {
      method: "POST",
      headers: { "content-type": "application/json", "x-assistec-loja-id": "loja-1" },
      body: JSON.stringify({ justificativa: "Cancelamento de NFC-e de teste em homologação" }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: "nota-1" }) })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.financeWriteCount).toBe(0)
    expect(json.cStat).toBe("135")
    expect(h.cancelar).toHaveBeenCalledTimes(1)
    expect(h.cancelar.mock.calls[0][0]).toMatchObject({
      storeId: "loja-1",
      notaFiscalId: "nota-1",
    })
  })

  it("401/403 quando o guard admin recusa", async () => {
    h.requireFiscalAdmin.mockResolvedValue({ ok: false, status: 403, error: "Apenas administradores" })
    const req = new Request("http://localhost/api/fiscal/notas/nota-1/cancelar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ justificativa: "Cancelamento de NFC-e de teste em homologação" }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: "nota-1" }) })
    expect(res.status).toBe(403)
    expect(h.cancelar).not.toHaveBeenCalled()
  })
})
