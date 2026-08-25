import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { FiscalStatusVenda, StatusEventoFiscal, StatusNotaFiscal } from "@/generated/prisma"
import { stubHomologacaoProvider } from "@/lib/fiscal/provider/stub-homologacao"
import type { FiscalProvider } from "@/lib/fiscal/provider/types"
import { SEQUENCIA_CANCELAMENTO_NFCE, TIPO_EVENTO_CANCELAMENTO } from "./evento-identidade"
import {
  cancelarNfceAutorizada,
  type CancelamentoFiscalPorts,
  type EventoFiscalCancelamento,
  type FinanceiroWritePorts,
  type FiscalLogCancelamento,
  type NotaFiscalCancelamento,
  type VendaCancelamento,
} from "./cancelamento-service"

const JUSTIFICATIVA = "Cancelamento de NFC-e de teste em homologação"
const XML_AUTORIZADO = "<nfeProc>XML-AUTORIZADO-IMUTAVEL</nfeProc>"
const XML_ASSINADO = "<NFe>XML-ASSINADO-IMUTAVEL</NFe>"

function financeSpy(): FinanceiroWritePorts & { __writeCount: number } {
  const f = {
    __writeCount: 0,
    estornar: async () => {
      f.__writeCount += 1
    },
    baixar: async () => {
      f.__writeCount += 1
    },
    lancar: async () => {
      f.__writeCount += 1
    },
    mutarCaixa: async () => {
      f.__writeCount += 1
    },
  }
  return f
}

function notaAutorizada(overrides: Partial<NotaFiscalCancelamento> = {}): NotaFiscalCancelamento {
  return {
    id: "nota-1",
    storeId: "loja-1",
    vendaId: "venda-1",
    status: StatusNotaFiscal.AUTORIZADA,
    chaveAcesso: "35250811222333000165550010000000011000000010",
    protocolo: "135250000000001",
    dataAutorizacao: new Date("2026-08-25T12:00:00.000Z"),
    xmlAutorizado: XML_AUTORIZADO,
    xmlAssinado: XML_ASSINADO,
    snapshotEmitente: { cnpj: "11222333000165" },
    ambiente: "HOMOLOGACAO",
    modelo: "NFCE",
    ...overrides,
  }
}

function createPorts(opts: {
  nota?: NotaFiscalCancelamento
  venda?: VendaCancelamento
  eventos?: EventoFiscalCancelamento[]
  provider?: FiscalProvider
  now?: Date
  incertoOnNota?: boolean
} = {}): CancelamentoFiscalPorts & {
  logs: FiscalLogCancelamento[]
  finance: ReturnType<typeof financeSpy>
  eventos: EventoFiscalCancelamento[]
  nota: NotaFiscalCancelamento
  venda: VendaCancelamento
} {
  const nota = opts.nota ?? notaAutorizada()
  const venda: VendaCancelamento = opts.venda ?? {
    id: nota.vendaId,
    storeId: nota.storeId,
    fiscalStatus: FiscalStatusVenda.AUTORIZADA,
  }
  const eventos = opts.eventos ?? []
  const logs: FiscalLogCancelamento[] = []
  const finance = financeSpy()
  const ports: CancelamentoFiscalPorts & {
    logs: FiscalLogCancelamento[]
    finance: ReturnType<typeof financeSpy>
    eventos: EventoFiscalCancelamento[]
    nota: NotaFiscalCancelamento
    venda: VendaCancelamento
  } = {
    logs,
    finance,
    eventos,
    nota,
    venda,
    now: () => opts.now ?? new Date("2026-08-25T12:10:00.000Z"),
    provider: opts.provider ?? stubHomologacaoProvider,
    async loadNota() {
      return ports.nota
    },
    async loadVenda() {
      return ports.venda
    },
    async findEvento(id) {
      return (
        ports.eventos.find(
          (e) => e.notaFiscalId === id.notaFiscalId && e.tipo === id.tipo && e.sequencia === id.sequencia,
        ) ?? null
      )
    },
    async upsertEvento(data) {
      const found = ports.eventos.find(
        (e) => e.notaFiscalId === data.notaFiscalId && e.tipo === data.tipo && e.sequencia === data.sequencia,
      )
      if (found) {
        Object.assign(found, data)
        return found
      }
      const created: EventoFiscalCancelamento = {
        id: `evt-${ports.eventos.length + 1}`,
        notaFiscalId: data.notaFiscalId,
        tipo: data.tipo,
        sequencia: data.sequencia,
        status: data.status,
        protocolo: data.protocolo ?? null,
        cStat: data.cStat ?? null,
        xMotivo: data.xMotivo ?? null,
        justificativa: data.justificativa,
        xmlEvento: data.xmlEvento ?? null,
        xmlRetorno: data.xmlRetorno ?? null,
      }
      ports.eventos.push(created)
      return created
    },
    async markNotaCancelada({ cStat, xMotivo }) {
      ports.nota.status = StatusNotaFiscal.CANCELADA
      ports.nota.cnpjEmitente = ports.nota.cnpjEmitente
      void cStat
      void xMotivo
      return {
        xmlAutorizado: ports.nota.xmlAutorizado,
        xmlAssinado: ports.nota.xmlAssinado,
        status: ports.nota.status,
      }
    },
    async setVendaFiscalStatus({ para }) {
      ports.venda.fiscalStatus = para
    },
    async abortarSolicitacao() {
      ports.venda.fiscalStatus = FiscalStatusVenda.NAO_FISCAL
    },
    async log(entry) {
      logs.push(entry)
    },
  }
  return ports
}

describe("cancelarNfceAutorizada — serviço shipped", () => {
  it("cancela NFC-e autorizada: nota CANCELADA, venda CANCELADA_FISCAL, protocolo e FiscalLog", async () => {
    const ports = createPorts()
    const r = await cancelarNfceAutorizada(
      { storeId: "loja-1", notaFiscalId: "nota-1", justificativa: JUSTIFICATIVA },
      ports,
    )
    expect(r.ok).toBe(true)
    expect(r.resultado).toBe("autorizado")
    expect(r.notaStatus).toBe(StatusNotaFiscal.CANCELADA)
    expect(r.vendaFiscalStatus).toBe(FiscalStatusVenda.CANCELADA_FISCAL)
    expect(r.sequencia).toBe(SEQUENCIA_CANCELAMENTO_NFCE)
    expect(r.protocolo).toBeTruthy()
    expect(r.cStat).toBe("101")
    expect(r.xmlAutorizado).toBe(XML_AUTORIZADO)
    expect(r.xmlAssinado).toBe(XML_ASSINADO)
    expect(r.xmlAutorizadoAlterado).toBe(false)
    expect(r.financeWriteCount).toBe(0)
    expect(ports.finance.__writeCount).toBe(0)
    expect(ports.logs.some((l) => l.acao === "evento.cancelamento.autorizado")).toBe(true)
    expect(ports.eventos).toHaveLength(1)
    expect(ports.eventos[0]?.tipo).toBe(TIPO_EVENTO_CANCELAMENTO)
    expect(ports.eventos[0]?.sequencia).toBe(1)
    expect(ports.eventos[0]?.status).toBe(StatusEventoFiscal.AUTORIZADO)
  })

  it("idempotência: segundo envio da mesma identidade não retransmite nem altera XML", async () => {
    const ports = createPorts()
    const first = await cancelarNfceAutorizada(
      { storeId: "loja-1", notaFiscalId: "nota-1", justificativa: JUSTIFICATIVA },
      ports,
    )
    expect(first.ok).toBe(true)
    const xmlDepois = ports.nota.xmlAutorizado
    const calls: string[] = []
    const throwingProvider = {
      tipo: stubHomologacaoProvider.tipo,
      simulado: stubHomologacaoProvider.simulado,
      validarConfiguracao: stubHomologacaoProvider.validarConfiguracao.bind(stubHomologacaoProvider),
      validarSnapshot: stubHomologacaoProvider.validarSnapshot.bind(stubHomologacaoProvider),
      prepararEmissao: stubHomologacaoProvider.prepararEmissao.bind(stubHomologacaoProvider),
      emitir: stubHomologacaoProvider.emitir.bind(stubHomologacaoProvider),
      consultar: stubHomologacaoProvider.consultar.bind(stubHomologacaoProvider),
      inutilizar: stubHomologacaoProvider.inutilizar.bind(stubHomologacaoProvider),
      statusServico: stubHomologacaoProvider.statusServico.bind(stubHomologacaoProvider),
      cancelar: async () => {
        calls.push("cancelar")
        throw new Error("idempotência quebrada: provider.cancelar não deve ser chamado")
      },
    } satisfies FiscalProvider
    const second = await cancelarNfceAutorizada(
      { storeId: "loja-1", notaFiscalId: "nota-1", justificativa: JUSTIFICATIVA },
      { ...ports, provider: throwingProvider },
    )
    expect(second.ok).toBe(true)
    expect(second.idempotente).toBe(true)
    expect(second.resultado).toBe("idempotente")
    expect(second.sequencia).toBe(1)
    expect(calls).toEqual([])
    expect(ports.eventos).toHaveLength(1)
    expect(ports.nota.xmlAutorizado).toBe(xmlDepois)
    expect(ports.finance.__writeCount).toBe(0)
    expect(second.financeWriteCount).toBe(0)
  })

  it("idempotência reconverge Nota/Venda se o evento já está AUTORIZADO e o reflexo faltou", async () => {
    const ports = createPorts({
      nota: notaAutorizada({ status: StatusNotaFiscal.AUTORIZADA }),
      venda: { id: "venda-1", storeId: "loja-1", fiscalStatus: FiscalStatusVenda.AUTORIZADA },
      eventos: [
        {
          id: "evt-1",
          notaFiscalId: "nota-1",
          tipo: TIPO_EVENTO_CANCELAMENTO,
          sequencia: 1,
          status: StatusEventoFiscal.AUTORIZADO,
          protocolo: "135250000000099",
          cStat: "101",
          xMotivo: "Cancelamento de NF-e homologado",
          justificativa: JUSTIFICATIVA,
          xmlEvento: null,
          xmlRetorno: null,
        },
      ],
    })
    const r = await cancelarNfceAutorizada(
      { storeId: "loja-1", notaFiscalId: "nota-1", justificativa: JUSTIFICATIVA },
      ports,
    )
    expect(r.ok).toBe(true)
    expect(r.idempotente).toBe(true)
    expect(r.sequencia).toBe(1)
    expect(ports.nota.status).toBe(StatusNotaFiscal.CANCELADA)
    expect(ports.venda.fiscalStatus).toBe(FiscalStatusVenda.CANCELADA_FISCAL)
    expect(ports.nota.xmlAutorizado).toBe(XML_AUTORIZADO)
    expect(ports.finance.__writeCount).toBe(0)
  })

  it("duplicidade do mesmo evento reusa sequência 1 — não inventa 2", async () => {
    const ports = createPorts()
    await cancelarNfceAutorizada(
      { storeId: "loja-1", notaFiscalId: "nota-1", justificativa: JUSTIFICATIVA },
      ports,
    )
    await cancelarNfceAutorizada(
      { storeId: "loja-1", notaFiscalId: "nota-1", justificativa: JUSTIFICATIVA },
      ports,
    )
    expect(ports.eventos.map((e) => e.sequencia)).toEqual([1])
    expect(ports.eventos[0]?.tipo).toBe("CANCELAMENTO")
  })

  it("prazo válido autoriza; prazo vencido bloqueia com estado coerente", async () => {
    const ok = await cancelarNfceAutorizada(
      { storeId: "loja-1", notaFiscalId: "nota-1", justificativa: JUSTIFICATIVA },
      createPorts({ now: new Date("2026-08-25T12:10:00Z") }),
    )
    expect(ok.ok).toBe(true)

    const ports = createPorts({ now: new Date("2026-08-25T12:31:00Z") })
    const vencido = await cancelarNfceAutorizada(
      { storeId: "loja-1", notaFiscalId: "nota-1", justificativa: JUSTIFICATIVA },
      ports,
    )
    expect(vencido.ok).toBe(false)
    expect(vencido.code).toBe("fiscal_prazo_vencido")
    expect(vencido.notaStatus).toBe(StatusNotaFiscal.AUTORIZADA)
    expect(ports.venda.fiscalStatus).toBe(FiscalStatusVenda.AUTORIZADA)
    expect(ports.nota.xmlAutorizado).toBe(XML_AUTORIZADO)
    expect(ports.finance.__writeCount).toBe(0)
  })

  it("estado incerto bloqueia operação destrutiva", async () => {
    const ports = createPorts({
      nota: notaAutorizada({ status: StatusNotaFiscal.TRANSMITINDO }),
      venda: { id: "venda-1", storeId: "loja-1", fiscalStatus: FiscalStatusVenda.EMITINDO },
    })
    const r = await cancelarNfceAutorizada(
      { storeId: "loja-1", notaFiscalId: "nota-1", justificativa: JUSTIFICATIVA, incerto: true },
      ports,
    )
    expect(r.ok).toBe(false)
    expect(r.code).toBe("fiscal_bloqueio_incerto")
    expect(ports.nota.status).toBe(StatusNotaFiscal.TRANSMITINDO)
    expect(ports.finance.__writeCount).toBe(0)
  })

  it("não chama nenhuma porta Financeiro/Caixa no caminho autorizado", async () => {
    const ports = createPorts()
    const r = await cancelarNfceAutorizada(
      { storeId: "loja-1", notaFiscalId: "nota-1", justificativa: JUSTIFICATIVA },
      ports,
    )
    expect(r.ok).toBe(true)
    expect(r.financeWriteCount).toBe(0)
    expect(ports.finance.__writeCount).toBe(0)
  })
})

describe("cancelarNfceAutorizada — isolamento estrutural", () => {
  it("o serviço shipped não importa Financeiro nem Caixa", () => {
    const src = readFileSync(resolve(__dirname, "cancelamento-service.ts"), "utf8")
    expect(src).not.toMatch(/lib\/financeiro/)
    expect(src).not.toMatch(/lib\/caixa/)
    expect(src).not.toMatch(/estornarMovimentacao/)
    expect(src).not.toMatch(/cancelContaReceber/)
  })

  it("a rota administrativa não importa Financeiro nem Caixa", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../app/api/fiscal/notas/[id]/cancelar/route.ts"),
      "utf8",
    )
    expect(src).not.toMatch(/lib\/financeiro/)
    expect(src).not.toMatch(/lib\/caixa/)
    expect(src).toContain("cancelarNfceAutorizadaPersistido")
    expect(src).toContain("requireFiscalAdmin")
  })
})
