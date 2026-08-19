/**
 * Testes do Pipeline Oficial de Emissão Fiscal (GOAL_007).
 *
 * Duas camadas:
 *  1. Pipeline PURO (`runEmissionPipeline`) com PORTAS FALSAS + providers (stub real e mocks):
 *     provider ausente, snapshot inexistente/inválido, loja inválida, stub autorizado,
 *     rejeitado, pendente, contingência, idempotência e trilha (FiscalLog).
 *  2. Serviço (`emitirNotaFiscalVenda`) com Prisma MOCKADO: venda inexistente, snapshot
 *     inexistente, caminho feliz (autoriza + grava fiscalStatus + FiscalLog), idempotência.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { FiscalProviderTipo, FiscalStatusVenda } from "@/generated/prisma"

import { PRODUTO_FISCAL_VAZIO, type ProdutoFiscal } from "@/lib/produto-fiscal"
import {
  buildVendaFiscalSnapshot,
  type BuildSnapshotInput,
  type VendaFiscalSnapshot,
} from "../venda-fiscal-snapshot"
import { stubHomologacaoProvider } from "../provider/stub-homologacao"
import type {
  FiscalProvider,
  FiscalProviderConfigInput,
  FiscalProviderContexto,
  FiscalProviderRequest,
  FiscalProviderResponse,
} from "../provider/types"

// ── Mock do Prisma (só o serviço usa) ──────────────────────────────────────────────────
const db = vi.hoisted(() => ({
  vendaFindFirst: vi.fn(),
  vendaUpdate: vi.fn(),
  notaFindFirst: vi.fn(),
  notaUpdate: vi.fn(),
  configFindUnique: vi.fn(),
  fiscalLogCreate: vi.fn(),
  serieFindFirst: vi.fn(),
  serieUpdate: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    venda: { findFirst: db.vendaFindFirst, update: db.vendaUpdate },
    notaFiscal: { findFirst: db.notaFindFirst, update: db.notaUpdate },
    configuracaoFiscalLoja: { findUnique: db.configFindUnique },
    fiscalLog: { create: db.fiscalLogCreate },
    serieFiscal: { findFirst: db.serieFindFirst, update: db.serieUpdate },
  },
}))

import { runEmissionPipeline } from "./emission-pipeline"
import { reconstructSnapshotFromNota, type NotaFiscalRow } from "./snapshot-reader"
import { emitirNotaFiscalVenda } from "./emission-service"
import type { EmissionPipelineInput, EmissionPorts, FiscalEmissionLogEntry } from "./emission.types"

// ── Fixtures ────────────────────────────────────────────────────────────────────────────

const LOJA_OK: NonNullable<BuildSnapshotInput["loja"]> = {
  cnpj: "11.222.333/0001-81",
  razaoSocial: "Loja Teste LTDA",
  nomeFantasia: "Loja Teste",
  inscricaoEstadual: "123456789",
  inscricaoMunicipal: "",
  regimeTributario: "SIMPLES_NACIONAL",
  crt: 1,
  ambiente: "HOMOLOGACAO",
  modeloFiscal: "NFCE",
  fiscalEnabled: false,
  logradouro: "Rua A",
  numero: "100",
  complemento: "",
  bairro: "Centro",
  codigoMunicipioIbge: "3550308",
  municipio: "São Paulo",
  uf: "SP",
  cep: "01001000",
  codigoPais: "1058",
  fone: "",
  email: "",
}

const FISCAL_COMPLETO: ProdutoFiscal = {
  ...PRODUTO_FISCAL_VAZIO,
  ncm: "22021000",
  cfop: "5102",
  csosn: "102",
  origemMercadoria: "0",
  unidadeComercial: "UN",
  unidadeTributavel: "UN",
}

function snapshotComFiscal(fiscal: ProdutoFiscal): VendaFiscalSnapshot {
  const built = buildVendaFiscalSnapshot({
    storeId: "loja-1",
    vendaId: "venda-1",
    loja: LOJA_OK,
    cliente: null,
    venda: { pedidoId: "PED-1", data: new Date("2026-06-19T12:00:00Z"), total: 10, desconto: 0, operador: "Maria", terminal: "PDV1", paymentBreakdown: { dinheiro: 10 } },
    itens: [
      {
        itemVendaId: "iv-1",
        produtoId: "prod-1",
        codigoProduto: "SKU1",
        descricao: "Refrigerante",
        gtin: "7890000000017",
        quantidade: 1,
        valorUnitario: 10,
        valorDesconto: 0,
        valorTotal: 10,
        fiscal,
      },
    ],
  })
  if (!built.ok) throw new Error("fixture inválida")
  return built.snapshot
}

const SNAPSHOT_OK = snapshotComFiscal(FISCAL_COMPLETO)

const CONFIG_OK: FiscalProviderConfigInput = {
  provider: "STUB_HOMOLOGACAO",
  ambiente: "HOMOLOGACAO",
  modeloFiscal: "NFCE",
  fiscalEnabled: false,
  cnpj: "11.222.333/0001-81",
  razaoSocial: "Loja Teste LTDA",
  uf: "SP",
}

/** Resposta canônica "ok" base do provider. */
function resp(operacao: FiscalProviderResponse["operacao"], over: Partial<FiscalProviderResponse> = {}): FiscalProviderResponse {
  return {
    ok: true,
    operacao,
    resultado: "ok",
    simulado: true,
    provider: FiscalProviderTipo.STUB_HOMOLOGACAO,
    ambiente: "HOMOLOGACAO",
    statusNota: null,
    dados: null,
    mensagem: "ok",
    pendencias: [],
    erros: [],
    eventos: [],
    ...over,
  }
}

/** Provider mock: validações passam; `emitir` devolve o que o teste mandar. */
function makeMockProvider(emitirImpl: () => Promise<FiscalProviderResponse>): FiscalProvider & { emitir: ReturnType<typeof vi.fn> } {
  const emitir = vi.fn(emitirImpl)
  return {
    tipo: FiscalProviderTipo.STUB_HOMOLOGACAO,
    simulado: true,
    validarConfiguracao: () => resp("validarConfiguracao"),
    validarSnapshot: () => resp("validarSnapshot", { statusNota: "VALIDANDO" }),
    prepararEmissao: () => resp("prepararEmissao", { statusNota: "VALIDANDO" }),
    emitir,
    consultar: async () => resp("consultar"),
    cancelar: async () => resp("cancelar"),
    inutilizar: async () => resp("inutilizar"),
    statusServico: async () => ({ provider: FiscalProviderTipo.STUB_HOMOLOGACAO, online: true, ambiente: "HOMOLOGACAO", simulado: true, mensagem: "", cStat: "107", verificadoEm: "" }),
  }
}

function fakePorts() {
  const statusWrites: FiscalStatusVenda[] = []
  const logs: FiscalEmissionLogEntry[] = []
  const ports: EmissionPorts = {
    setFiscalStatus: async (s) => {
      statusWrites.push(s)
    },
    log: async (e) => {
      logs.push(e)
    },
    now: () => 1000,
  }
  return { ports, statusWrites, logs }
}

function pipelineInput(over: Partial<EmissionPipelineInput> = {}): EmissionPipelineInput {
  return {
    provider: stubHomologacaoProvider,
    providerTipo: "STUB_HOMOLOGACAO",
    config: CONFIG_OK,
    snapshot: SNAPSHOT_OK,
    currentFiscalStatus: FiscalStatusVenda.PENDENTE,
    notaFiscalId: "nf-1",
    resolveError: null,
    operador: null,
    ...over,
  }
}

/** Série fiscal ativa padrão (numeração GOAL_008). */
const SERIE_ATIVA = { id: "serie-1", serie: 1, modelo: "NFCE", ambiente: "HOMOLOGACAO", ativo: true }

beforeEach(() => {
  db.vendaFindFirst.mockReset()
  db.vendaUpdate.mockReset().mockResolvedValue({})
  db.notaFindFirst.mockReset()
  db.notaUpdate.mockReset().mockResolvedValue({})
  db.configFindUnique.mockReset()
  db.fiscalLogCreate.mockReset().mockResolvedValue({})
  // Defaults de numeração: série ativa + reserva do número 1 (proximoNumero 1 → 2).
  db.serieFindFirst.mockReset().mockResolvedValue(SERIE_ATIVA)
  db.serieUpdate.mockReset().mockResolvedValue({ proximoNumero: 2, serie: 1 })
})

// ── 1. Pipeline puro ────────────────────────────────────────────────────────────────────

describe("runEmissionPipeline — caminho feliz (stub)", () => {
  it("snapshot completo + stub → AUTORIZADA, transita por EMITINDO", async () => {
    const { ports, statusWrites, logs } = fakePorts()
    const out = await runEmissionPipeline(pipelineInput(), ports)

    expect(out.ok).toBe(true)
    expect(out.resultado).toBe("autorizada")
    expect(out.simulado).toBe(true)
    expect(out.fiscalStatusNovo).toBe(FiscalStatusVenda.AUTORIZADA)
    expect(statusWrites).toEqual([FiscalStatusVenda.EMITINDO, FiscalStatusVenda.AUTORIZADA])
    expect(out.etapas.map((e) => e.etapa)).toEqual(["validarConfiguracao", "validarSnapshot", "prepararEmissao", "emitir"])
    // FiscalLog: emitindo + resultado
    expect(logs.map((l) => l.acao)).toContain("emissao.emitindo")
    expect(logs.map((l) => l.acao)).toContain("emissao.resultado")
  })
})

describe("runEmissionPipeline — pré-condições (sem mutação de status)", () => {
  it("provider ausente (desconhecido) → erro provider_ausente, sem escrever status", async () => {
    const { ports, statusWrites } = fakePorts()
    const out = await runEmissionPipeline(
      pipelineInput({ provider: null, resolveError: { code: "provider_desconhecido", mensagem: "x" } }),
      ports,
    )
    expect(out.ok).toBe(false)
    expect(out.errorCode).toBe("provider_ausente")
    expect(statusWrites).toEqual([])
  })

  it("config ausente → erro config_ausente", async () => {
    const { ports } = fakePorts()
    const out = await runEmissionPipeline(
      pipelineInput({ provider: null, resolveError: { code: "config_ausente", mensagem: "x" } }),
      ports,
    )
    expect(out.errorCode).toBe("config_ausente")
  })

  it("snapshot inexistente → erro snapshot_inexistente, sem status", async () => {
    const { ports, statusWrites } = fakePorts()
    const out = await runEmissionPipeline(pipelineInput({ snapshot: null }), ports)
    expect(out.errorCode).toBe("snapshot_inexistente")
    expect(statusWrites).toEqual([])
  })

  it("snapshot inválido (sem itens) → erro snapshot_invalido, sem status", async () => {
    const { ports, statusWrites } = fakePorts()
    const invalido = { ...SNAPSHOT_OK, itens: [] } as unknown as VendaFiscalSnapshot
    const out = await runEmissionPipeline(pipelineInput({ snapshot: invalido }), ports)
    expect(out.errorCode).toBe("snapshot_invalido")
    expect(statusWrites).toEqual([])
  })

  it("loja inválida (CNPJ vazio) → erro loja_invalida, sem status", async () => {
    const { ports, statusWrites } = fakePorts()
    const out = await runEmissionPipeline(pipelineInput({ config: { ...CONFIG_OK!, cnpj: "" } }), ports)
    expect(out.errorCode).toBe("loja_invalida")
    expect(statusWrites).toEqual([])
  })
})

describe("runEmissionPipeline — interpretação do retorno do provider", () => {
  it("provider autorizado (mock) → AUTORIZADA", async () => {
    const { ports, statusWrites } = fakePorts()
    const provider = makeMockProvider(async () => resp("emitir", { statusNota: "AUTORIZADA", dados: { placeholder: true, chaveAcesso: "SIM-CHAVE-1", cStat: "100" } }))
    const out = await runEmissionPipeline(pipelineInput({ provider }), ports)
    expect(out.resultado).toBe("autorizada")
    expect(statusWrites).toEqual([FiscalStatusVenda.EMITINDO, FiscalStatusVenda.AUTORIZADA])
  })

  it("provider rejeitado → REJEITADA", async () => {
    const { ports, statusWrites } = fakePorts()
    const provider = makeMockProvider(async () => resp("emitir", { ok: false, resultado: "rejeitado", statusNota: "REJEITADA", mensagem: "rejeitado", erros: [{ code: "erro_interno", mensagem: "x" }] }))
    const out = await runEmissionPipeline(pipelineInput({ provider }), ports)
    expect(out.ok).toBe(false)
    expect(out.resultado).toBe("rejeitada")
    expect(statusWrites).toEqual([FiscalStatusVenda.EMITINDO, FiscalStatusVenda.REJEITADA])
  })

  it("provider pendente → PENDENTE", async () => {
    const { ports, statusWrites } = fakePorts()
    const provider = makeMockProvider(async () => resp("emitir", { ok: false, resultado: "pendente", statusNota: "RASCUNHO", pendencias: ["NCM"] }))
    const out = await runEmissionPipeline(pipelineInput({ provider }), ports)
    expect(out.resultado).toBe("pendente")
    expect(statusWrites).toEqual([FiscalStatusVenda.EMITINDO, FiscalStatusVenda.PENDENTE])
  })

  it("provider erro de transmissão → EM_CONTINGENCIA", async () => {
    const { ports, statusWrites } = fakePorts()
    const provider = makeMockProvider(async () => resp("emitir", { ok: false, resultado: "erro", statusNota: "ERRO", mensagem: "falha rede" }))
    const out = await runEmissionPipeline(pipelineInput({ provider }), ports)
    expect(out.resultado).toBe("contingencia")
    expect(statusWrites).toEqual([FiscalStatusVenda.EMITINDO, FiscalStatusVenda.EM_CONTINGENCIA])
  })
})

describe("runEmissionPipeline — idempotência e bloqueio", () => {
  it("já AUTORIZADA → ja_autorizada, sem status, sem emitir", async () => {
    const { ports, statusWrites } = fakePorts()
    const provider = makeMockProvider(async () => resp("emitir", { statusNota: "AUTORIZADA" }))
    const out = await runEmissionPipeline(pipelineInput({ provider, currentFiscalStatus: FiscalStatusVenda.AUTORIZADA }), ports)
    expect(out.resultado).toBe("ja_autorizada")
    expect(out.idempotente).toBe(true)
    expect(statusWrites).toEqual([])
    expect(provider.emitir).not.toHaveBeenCalled()
  })

  it("já EMITINDO → em_andamento, sem status", async () => {
    const { ports, statusWrites } = fakePorts()
    const out = await runEmissionPipeline(pipelineInput({ currentFiscalStatus: FiscalStatusVenda.EMITINDO }), ports)
    expect(out.resultado).toBe("em_andamento")
    expect(statusWrites).toEqual([])
  })

  it("CANCELADA_FISCAL → bloqueada", async () => {
    const { ports } = fakePorts()
    const out = await runEmissionPipeline(pipelineInput({ currentFiscalStatus: FiscalStatusVenda.CANCELADA_FISCAL }), ports)
    expect(out.resultado).toBe("bloqueada")
    expect(out.errorCode).toBe("estado_bloqueado")
  })
})

describe("runEmissionPipeline — FiscalLog", () => {
  it("registra trilha com etapas e response resumida", async () => {
    const { ports, logs } = fakePorts()
    await runEmissionPipeline(pipelineInput(), ports)
    const resultadoLog = logs.find((l) => l.acao === "emissao.resultado")
    expect(resultadoLog).toBeTruthy()
    expect(resultadoLog!.detalhe).toHaveProperty("etapas")
    expect(resultadoLog!.detalhe).toHaveProperty("response")
    expect(resultadoLog!.detalhe).toHaveProperty("durationMs")
  })
})

describe("runEmissionPipeline — numeração fiscal (GOAL_010)", () => {
  it("aloca número antes de emitir e o provider recebe o contexto numerado", async () => {
    const { ports, statusWrites, logs } = fakePorts()
    let capturado: FiscalProviderContexto | null = null
    const provider = makeMockProvider(async () =>
      resp("emitir", { statusNota: "AUTORIZADA", dados: { placeholder: true, chaveAcesso: "SIM-CHAVE-1", cStat: "100" } }),
    )
    const emitOriginal = provider.emitir
    provider.emitir = vi.fn(async (req: FiscalProviderRequest) => {
      capturado = req.contexto
      return emitOriginal(req)
    })
    ports.allocateNumero = async () => ({
      ok: true,
      reused: false,
      storeId: "store-matriz-fixture",
      notaFiscalId: "nf-1",
      localKey: "nfce:store-matriz-fixture:venda-1",
      serieFiscalId: "serie-1",
      serie: 1,
      numero: 5,
      modelo: "NFCE",
      ambiente: "HOMOLOGACAO",
      lacunas: [],
    })

    const out = await runEmissionPipeline(pipelineInput({ provider }), ports)

    expect(out.ok).toBe(true)
    expect(statusWrites).toEqual([FiscalStatusVenda.EMITINDO, FiscalStatusVenda.AUTORIZADA])
    // provider recebeu o snapshot/contexto NUMERADO
    expect((capturado as FiscalProviderContexto | null)?.serie).toBe(1)
    expect((capturado as FiscalProviderContexto | null)?.numero).toBe(5)
    // FiscalLog de numeração
    const numLog = logs.find((l) => l.acao === "emissao.numeracao")
    expect(numLog).toBeTruthy()
    const det = numLog!.detalhe as { numeracao?: { numeroAlocado?: number; serie?: number } }
    expect(det.numeracao?.numeroAlocado).toBe(5)
    expect(det.numeracao?.serie).toBe(1)
  })

  it("série inativa → numeracao_indisponivel, sem mutar status e sem emitir", async () => {
    const { ports, statusWrites } = fakePorts()
    const provider = makeMockProvider(async () => resp("emitir", { statusNota: "AUTORIZADA" }))
    ports.allocateNumero = async () => ({
      ok: false,
      errorCode: "serie_inativa",
      mensagem: "sem série fiscal ativa",
      lacunas: [],
    })

    const out = await runEmissionPipeline(pipelineInput({ provider }), ports)

    expect(out.ok).toBe(false)
    expect(out.errorCode).toBe("numeracao_indisponivel")
    expect(statusWrites).toEqual([])
    expect(provider.emitir).not.toHaveBeenCalled()
  })
})

// ── 2. snapshot-reader ────────────────────────────────────────────────────────────────────

function notaRowFromSnapshot(s: VendaFiscalSnapshot, id = "nf-1"): NotaFiscalRow {
  return {
    id,
    storeId: s.storeId,
    vendaId: s.vendaId,
    modelo: s.modelo,
    ambiente: s.ambiente,
    snapshotEmitente: s.emitente,
    snapshotDestinatario: s.destinatario,
    snapshotPagamento: { versao: s.versao, geradoEm: s.geradoEm, venda: s.venda, totais: s.totais, diagnostico: s.diagnostico },
    itens: s.itens.map((it) => ({
      itemVendaId: it.itemVendaId,
      produtoId: it.produtoId,
      numeroItem: it.numeroItem,
      codigoProduto: it.codigoProduto,
      descricao: it.descricao,
      gtin: it.gtin,
      ncm: it.ncm,
      cest: it.cest,
      cfop: it.cfop,
      cst: it.cst,
      csosn: it.csosn,
      origemMercadoria: Number(it.origemMercadoria) || 0,
      unidadeComercial: it.unidadeComercial,
      quantidade: it.quantidade,
      valorUnitario: it.valorUnitario,
      valorDesconto: it.valorDesconto,
      valorTotal: it.valorTotal,
    })),
  }
}

describe("reconstructSnapshotFromNota", () => {
  it("reconstrói o snapshot congelado a partir da NotaFiscal", () => {
    const reconstruido = reconstructSnapshotFromNota(notaRowFromSnapshot(SNAPSHOT_OK))
    expect(reconstruido).toBeTruthy()
    expect(Object.isFrozen(reconstruido)).toBe(true)
    expect(reconstruido!.vendaId).toBe("venda-1")
    expect(reconstruido!.itens).toHaveLength(1)
    expect(reconstruido!.itens[0]?.ncm).toBe("22021000")
    expect(reconstruido!.diagnostico.pendencias).toEqual([])
  })

  it("retorna null quando faltam os blocos do snapshot", () => {
    const semBlocos = { ...notaRowFromSnapshot(SNAPSHOT_OK), snapshotEmitente: null, snapshotPagamento: null }
    expect(reconstructSnapshotFromNota(semBlocos)).toBeNull()
  })

  it("não reescreve pagamentoFiscal histórico (PIX 17 inferido permanece no JSONB)", () => {
    const historico: VendaFiscalSnapshot = {
      ...SNAPSHOT_OK,
      venda: {
        ...SNAPSHOT_OK.venda,
        pagamentoFiscal: {
          versao: 1,
          fonte: "venda.payload.paymentBreakdown",
          catalogoTPag: "IT-2024.002-v1.11",
          det: [{ formaInterna: "pix", tPag: "17", vPag: 10 }],
          soma: 10,
          vTroco: null,
        },
        pagamentoFiscalErro: null,
      },
    }
    const reconstruido = reconstructSnapshotFromNota(notaRowFromSnapshot(historico))
    expect(reconstruido?.venda.pagamentoFiscal).toEqual(historico.venda.pagamentoFiscal)
    expect(reconstruido?.venda.pagamentoFiscal?.det[0]?.tPag).toBe("17")
  })
})

// ── 3. Serviço (Prisma mockado) ───────────────────────────────────────────────────────────

const CONFIG_ROW = {
  provider: "STUB_HOMOLOGACAO",
  ambiente: "HOMOLOGACAO",
  modeloFiscal: "NFCE",
  fiscalEnabled: false,
  cnpj: "11.222.333/0001-81",
  razaoSocial: "Loja Teste LTDA",
  uf: "SP",
  providerConfig: null,
  providerTokenRef: null,
  cscId: "",
  cscTokenRef: null,
}

describe("emitirNotaFiscalVenda (serviço + Prisma mockado)", () => {
  it("venda inexistente → venda_nao_encontrada, nada é gravado", async () => {
    db.vendaFindFirst.mockResolvedValue(null)
    const out = await emitirNotaFiscalVenda({ storeId: "loja-1", vendaId: "venda-x" })
    expect(out.errorCode).toBe("venda_nao_encontrada")
    expect(db.vendaUpdate).not.toHaveBeenCalled()
    expect(db.notaFindFirst).not.toHaveBeenCalled()
  })

  it("sem NotaFiscal vigente → snapshot_inexistente, sem update de status", async () => {
    db.vendaFindFirst.mockResolvedValue({ id: "venda-1", fiscalStatus: "PENDENTE" })
    db.notaFindFirst.mockResolvedValue(null)
    db.configFindUnique.mockResolvedValue(CONFIG_ROW)
    const out = await emitirNotaFiscalVenda({ storeId: "loja-1", vendaId: "venda-1" })
    expect(out.errorCode).toBe("snapshot_inexistente")
    expect(db.vendaUpdate).not.toHaveBeenCalled()
    expect(db.fiscalLogCreate).toHaveBeenCalled() // logou o erro
  })

  it("caminho feliz → AUTORIZADA, grava fiscalStatus (EMITINDO→AUTORIZADA) e FiscalLog (simulado)", async () => {
    db.vendaFindFirst.mockResolvedValue({ id: "venda-1", fiscalStatus: "PENDENTE" })
    db.notaFindFirst.mockResolvedValue(notaRowFromSnapshot(SNAPSHOT_OK))
    db.configFindUnique.mockResolvedValue(CONFIG_ROW)

    const out = await emitirNotaFiscalVenda({ storeId: "loja-1", vendaId: "venda-1", operador: "Maria" })

    expect(out.ok).toBe(true)
    expect(out.resultado).toBe("autorizada")
    expect(out.simulado).toBe(true)
    expect(db.vendaUpdate).toHaveBeenCalledTimes(2)
    expect(db.vendaUpdate.mock.calls[0]?.[0]?.data?.fiscalStatus).toBe("EMITINDO")
    expect(db.vendaUpdate.mock.calls[1]?.[0]?.data?.fiscalStatus).toBe("AUTORIZADA")
    expect(db.fiscalLogCreate).toHaveBeenCalled()
    const primeiraGravacao = db.fiscalLogCreate.mock.calls[0]?.[0]?.data
    expect(primeiraGravacao?.detalhe?.simulado).toBe(true)
  })

  it("numera a NotaFiscal (série+número) antes de emitir e registra FiscalLog de numeração", async () => {
    db.vendaFindFirst.mockResolvedValue({ id: "venda-1", fiscalStatus: "PENDENTE" })
    db.notaFindFirst.mockResolvedValue(notaRowFromSnapshot(SNAPSHOT_OK))
    db.configFindUnique.mockResolvedValue(CONFIG_ROW)

    const out = await emitirNotaFiscalVenda({ storeId: "loja-1", vendaId: "venda-1" })

    expect(out.resultado).toBe("autorizada")
    // bind gravou série+número na NotaFiscal
    expect(db.notaUpdate).toHaveBeenCalledTimes(1)
    const bindData = db.notaUpdate.mock.calls[0]?.[0]?.data
    expect(bindData?.serie).toBe(1)
    expect(bindData?.numero).toBe(1)
    expect(bindData?.serieFiscalId).toBe("serie-1")
    // reserva = incremento ATÔMICO de proximoNumero
    expect(db.serieUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { proximoNumero: { increment: 1 } } }),
    )
    // FiscalLog de numeração (simulado=true)
    const numLog = db.fiscalLogCreate.mock.calls
      .map((c) => c[0]?.data)
      .find((d) => d?.acao === "emissao.numeracao")
    expect(numLog).toBeTruthy()
    expect(numLog?.detalhe?.simulado).toBe(true)
    expect(numLog?.detalhe?.numeracao?.numeroAlocado).toBe(1)
  })

  it("sem série fiscal ativa → numeracao_indisponivel; não vira AUTORIZADA nem grava EMITINDO", async () => {
    db.vendaFindFirst.mockResolvedValue({ id: "venda-1", fiscalStatus: "PENDENTE" })
    db.notaFindFirst.mockResolvedValue(notaRowFromSnapshot(SNAPSHOT_OK))
    db.configFindUnique.mockResolvedValue(CONFIG_ROW)
    db.serieFindFirst.mockResolvedValue(null) // nenhuma série ativa

    const out = await emitirNotaFiscalVenda({ storeId: "loja-1", vendaId: "venda-1" })

    expect(out.ok).toBe(false)
    expect(out.errorCode).toBe("numeracao_indisponivel")
    expect(db.vendaUpdate).not.toHaveBeenCalled() // nunca foi a EMITINDO/AUTORIZADA
    expect(db.notaUpdate).not.toHaveBeenCalled() // nada numerado
  })

  it("idempotência: venda já AUTORIZADA → não retransmite nem grava status", async () => {
    db.vendaFindFirst.mockResolvedValue({ id: "venda-1", fiscalStatus: "AUTORIZADA" })
    db.notaFindFirst.mockResolvedValue(notaRowFromSnapshot(SNAPSHOT_OK))
    db.configFindUnique.mockResolvedValue(CONFIG_ROW)

    const out = await emitirNotaFiscalVenda({ storeId: "loja-1", vendaId: "venda-1" })

    expect(out.resultado).toBe("ja_autorizada")
    expect(out.idempotente).toBe(true)
    expect(db.vendaUpdate).not.toHaveBeenCalled()
  })
})
