import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  FiscalProviderTipo,
  FiscalStatusVenda,
  StatusEventoFiscal,
  StatusNotaFiscal,
} from "@/generated/prisma"
import type { FiscalProvider, FiscalProviderResponse } from "@/lib/fiscal/provider/types"
import { stubHomologacaoProvider } from "@/lib/fiscal/provider/stub-homologacao"
import { cancelarNfceAutorizadaPersistido } from "./cancelamento-prisma"

vi.mock("@/lib/fiscal/emission/emission-log", () => ({
  recordFiscalEmissionLog: vi.fn(async () => undefined),
}))

const JUSTIFICATIVA = "Cancelamento de NFC-e de teste em homologação"
const XML_AUTORIZADO = "<nfeProc>XML-AUTORIZADO-IMUTAVEL</nfeProc>"

function resposta135(overrides: Partial<FiscalProviderResponse> = {}): FiscalProviderResponse {
  return {
    ok: true,
    operacao: "cancelar",
    resultado: "ok",
    simulado: false,
    provider: FiscalProviderTipo.SEFAZ_DIRETO,
    ambiente: "HOMOLOGACAO",
    statusNota: StatusNotaFiscal.CANCELADA,
    dados: {
      cStat: "135",
      protocolo: "135250000000099",
      xMotivo: "Evento registrado e vinculado a NF-e",
    },
    mensagem: "Evento registrado",
    pendencias: [],
    erros: [],
    eventos: [],
    ...overrides,
  }
}

function providerReal(cancelar: FiscalProvider["cancelar"]): FiscalProvider {
  const inerte = async () => resposta135({ ok: false, resultado: "erro" })
  return {
    tipo: FiscalProviderTipo.SEFAZ_DIRETO,
    simulado: false,
    validarConfiguracao: () => resposta135({ operacao: "validarConfiguracao" }),
    validarSnapshot: () => resposta135({ operacao: "validarSnapshot" }),
    prepararEmissao: () => resposta135({ operacao: "prepararEmissao" }),
    emitir: inerte,
    consultar: inerte,
    cancelar,
    inutilizar: inerte,
    statusServico: async () => ({
      provider: FiscalProviderTipo.SEFAZ_DIRETO,
      online: true,
      ambiente: "HOMOLOGACAO",
      simulado: false,
      mensagem: "ok",
      cStat: "107",
      verificadoEm: "2026-08-25T12:00:00.000Z",
    }),
  }
}

function fakeClient(opts: {
  provider?: string | null
  notaStatus?: string
  vendaStatus?: string
} = {}) {
  const nota = {
    id: "nota-1",
    storeId: "loja-1",
    vendaId: "venda-1",
    status: opts.notaStatus ?? StatusNotaFiscal.AUTORIZADA,
    chaveAcesso: "35250811222333000165550010000000011000000010",
    protocolo: "135250000000001",
    // Dentro da janela de 30 min do prazo de cancelamento, independente do relógio da execução.
    dataAutorizacao: new Date(Date.now() - 5 * 60 * 1000),
    xmlAutorizado: XML_AUTORIZADO,
    xmlAssinado: "<NFe/>",
    snapshotEmitente: { cnpj: "11222333000165", uf: "SP" },
    ambiente: "HOMOLOGACAO",
    modelo: "NFCE",
    cStat: "100",
    xMotivo: "Autorizado",
  }
  const vendaRow = {
    id: "venda-1",
    storeId: "loja-1",
    fiscalStatus: opts.vendaStatus ?? FiscalStatusVenda.AUTORIZADA,
  }
  const eventos: Array<Record<string, unknown>> = []
  return {
    nota,
    vendaRow,
    eventos,
    notaFiscal: {
      findFirst: async () => nota,
      update: async () => {
        nota.status = StatusNotaFiscal.CANCELADA
        return { xmlAutorizado: nota.xmlAutorizado, xmlAssinado: nota.xmlAssinado, status: nota.status }
      },
    },
    venda: {
      findFirst: async () => vendaRow,
      update: async ({ data }: { data: { fiscalStatus?: string } }) => {
        if (data.fiscalStatus) vendaRow.fiscalStatus = data.fiscalStatus
        return vendaRow
      },
    },
    eventoFiscal: {
      findUnique: async () => eventos[0] ?? null,
      upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const found = eventos[0]
        if (found) {
          Object.assign(found, update)
          return found
        }
        const row = { id: "evt-1", ...create }
        eventos.push(row)
        return row
      },
    },
    fiscalEmissaoJob: {
      updateMany: async () => ({ count: 0 }),
    },
    configuracaoFiscalLoja: {
      findUnique: async () =>
        opts.provider === null
          ? null
          : {
              provider: opts.provider ?? FiscalProviderTipo.STUB_HOMOLOGACAO,
              ambiente: "HOMOLOGACAO",
              modeloFiscal: "NFCE",
              fiscalEnabled: true,
              cnpj: "11222333000165",
              razaoSocial: "Loja",
              uf: "SP",
              providerConfig: null,
              providerTokenRef: null,
              cscId: "1",
              cscTokenRef: null,
              storeId: "loja-1",
            },
    },
  }
}

describe("cancelarNfceAutorizadaPersistido — fail-closed", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("config ausente não persiste CANCELADA", async () => {
    const client = fakeClient({ provider: null })
    const r = await cancelarNfceAutorizadaPersistido(
      { storeId: "loja-1", notaFiscalId: "nota-1", justificativa: JUSTIFICATIVA },
      client as never,
    )
    expect(r.ok).toBe(false)
    expect(r.code).toBe("config_ausente")
    expect(client.nota.status).toBe(StatusNotaFiscal.AUTORIZADA)
    expect(client.vendaRow.fiscalStatus).toBe(FiscalStatusVenda.AUTORIZADA)
  })

  it("STUB_HOMOLOGACAO não persiste CANCELADA", async () => {
    const client = fakeClient({ provider: FiscalProviderTipo.STUB_HOMOLOGACAO })
    const r = await cancelarNfceAutorizadaPersistido(
      { storeId: "loja-1", notaFiscalId: "nota-1", justificativa: JUSTIFICATIVA },
      client as never,
    )
    expect(r.ok).toBe(false)
    expect(r.code).toBe("provider_incompativel")
    expect(client.nota.status).toBe(StatusNotaFiscal.AUTORIZADA)
  })

  it("provider injetado stub também recusa persistência", async () => {
    const client = fakeClient({ provider: FiscalProviderTipo.SEFAZ_DIRETO })
    const r = await cancelarNfceAutorizadaPersistido(
      {
        storeId: "loja-1",
        notaFiscalId: "nota-1",
        justificativa: JUSTIFICATIVA,
        provider: stubHomologacaoProvider,
      },
      client as never,
    )
    expect(r.ok).toBe(false)
    expect(r.code).toBe("resposta_simulada")
    expect(client.nota.status).toBe(StatusNotaFiscal.AUTORIZADA)
    expect(client.vendaRow.fiscalStatus).toBe(FiscalStatusVenda.AUTORIZADA)
  })

  it("SEFAZ_DIRETO sem A1 não persiste", async () => {
    const client = fakeClient({ provider: FiscalProviderTipo.SEFAZ_DIRETO })
    const r = await cancelarNfceAutorizadaPersistido(
      {
        storeId: "loja-1",
        notaFiscalId: "nota-1",
        justificativa: JUSTIFICATIVA,
        runtime: {
          resolveCertificate: async () => ({
            ok: false,
            codigo: "certificado_ativo_nao_configurado",
            mensagem: "A1 ausente",
          }),
        },
      },
      client as never,
    )
    expect(r.ok).toBe(false)
    expect(r.code).toBe("certificado_indisponivel")
    expect(client.nota.status).toBe(StatusNotaFiscal.AUTORIZADA)
  })

  it("cStat 135 real persiste CANCELADA + CANCELADA_FISCAL e zero finance", async () => {
    const client = fakeClient({ provider: FiscalProviderTipo.SEFAZ_DIRETO })
    const r = await cancelarNfceAutorizadaPersistido(
      {
        storeId: "loja-1",
        notaFiscalId: "nota-1",
        justificativa: JUSTIFICATIVA,
        provider: providerReal(async () => resposta135()),
      },
      client as never,
    )
    expect(r.ok).toBe(true)
    expect(r.cStat).toBe("135")
    expect(r.notaStatus).toBe(StatusNotaFiscal.CANCELADA)
    expect(r.vendaFiscalStatus).toBe(FiscalStatusVenda.CANCELADA_FISCAL)
    expect(r.xmlAutorizadoAlterado).toBe(false)
    expect(r.financeWriteCount).toBe(0)
    expect(client.nota.status).toBe(StatusNotaFiscal.CANCELADA)
    expect(client.vendaRow.fiscalStatus).toBe(FiscalStatusVenda.CANCELADA_FISCAL)
    expect(client.nota.xmlAutorizado).toBe(XML_AUTORIZADO)
  })

  it("idempotência reconverge sem retransmitir", async () => {
    const client = fakeClient({
      provider: FiscalProviderTipo.SEFAZ_DIRETO,
      notaStatus: StatusNotaFiscal.AUTORIZADA,
    })
    client.eventos.push({
      id: "evt-1",
      notaFiscalId: "nota-1",
      tipo: "CANCELAMENTO",
      sequencia: 1,
      status: StatusEventoFiscal.AUTORIZADO,
      protocolo: "135250000000099",
      cStat: "135",
      xMotivo: "Evento registrado e vinculado a NF-e",
      justificativa: JUSTIFICATIVA,
      xmlEvento: null,
      xmlRetorno: null,
    })
    let calls = 0
    const r = await cancelarNfceAutorizadaPersistido(
      {
        storeId: "loja-1",
        notaFiscalId: "nota-1",
        justificativa: JUSTIFICATIVA,
        provider: providerReal(async () => {
          calls += 1
          throw new Error("não deve retransmitir")
        }),
      },
      client as never,
    )
    expect(r.ok).toBe(true)
    expect(r.idempotente).toBe(true)
    expect(calls).toBe(0)
    expect(client.nota.status).toBe(StatusNotaFiscal.CANCELADA)
    expect(client.vendaRow.fiscalStatus).toBe(FiscalStatusVenda.CANCELADA_FISCAL)
    expect(r.financeWriteCount).toBe(0)
  })
})
