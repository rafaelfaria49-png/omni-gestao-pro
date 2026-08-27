/**
 * MockProvider — test double CONFIGURÁVEL do contrato `FiscalProvider` (BL-FISCAL-007).
 *
 * Complementa o `StubHomologacaoProvider` (GOAL_006): enquanto o stub simula respostas de
 * homologação "felizes", o Mock permite SCRIPTAR o desfecho de cada operação
 * (ok/pendente/rejeitado/erro) e REGISTRA as chamadas — essencial para testar os caminhos de
 * erro do pipeline (BL-FISCAL-008) de forma determinística.
 *
 * Garantias: implementa a MESMA interface única `FiscalProvider`; `simulado = true`; NÃO usa
 * rede/fetch; NÃO acessa Prisma/banco; NÃO toca Venda/Caixa/Financeiro/Estoque; opera só sobre as
 * entradas. Determinístico quando um `clock` fixo é injetado (sem `Date.now`).
 */
import { AmbienteFiscal, FiscalProviderTipo, StatusNotaFiscal } from "@/generated/prisma"
import type { VendaFiscalSnapshot } from "../venda-fiscal-snapshot"
import type {
  FiscalProvider,
  FiscalProviderCancelamentoParams,
  FiscalProviderConfigInput,
  FiscalProviderConsultaParams,
  FiscalProviderDados,
  FiscalProviderError,
  FiscalProviderEvento,
  FiscalProviderEventoTipo,
  FiscalProviderInutilizacaoParams,
  FiscalProviderOperacao,
  FiscalProviderRequest,
  FiscalProviderResponse,
  FiscalProviderResultado,
  FiscalProviderStatus,
  FiscalProviderStatusParams,
} from "./types"

export type MockOutcome = FiscalProviderResultado // "ok" | "pendente" | "rejeitado" | "erro"

export type MockProviderConfig = {
  ambiente?: AmbienteFiscal | string
  /** Desfecho por operação (default "ok"). */
  outcomes?: Partial<Record<FiscalProviderOperacao, MockOutcome>>
  /** `statusServico.online` (default true). */
  statusOnline?: boolean
  /** Relógio injetável p/ determinismo (default ISO de agora). */
  clock?: () => string
  /** Rótulo nas respostas (`response.provider`). Default "MOCK". */
  label?: string
}

export type MockProviderCall = {
  operacao: FiscalProviderOperacao
  em: string
}

const STATUS_OK_POR_OP: Partial<Record<FiscalProviderOperacao, StatusNotaFiscal>> = {
  validarSnapshot: StatusNotaFiscal.VALIDANDO,
  prepararEmissao: StatusNotaFiscal.VALIDANDO,
  emitir: StatusNotaFiscal.AUTORIZADA,
  consultar: StatusNotaFiscal.AUTORIZADA,
  cancelar: StatusNotaFiscal.CANCELADA,
  inutilizar: StatusNotaFiscal.INUTILIZADA,
}

const EVENTO_OK_POR_OP: Record<FiscalProviderOperacao, FiscalProviderEventoTipo> = {
  validarConfiguracao: "validacao",
  validarSnapshot: "validacao",
  prepararEmissao: "preparo",
  emitir: "emissao_simulada",
  consultar: "consulta",
  cancelar: "cancelamento_simulado",
  inutilizar: "inutilizacao_simulada",
  statusServico: "status_servico",
}

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim()
}

function placeholderId(prefixo: string, seed: string): string {
  const base = s(seed).replace(/[^0-9a-zA-Z]/g, "").toUpperCase().slice(0, 24)
  return `MOCK-${prefixo}-${base || "NA"}`
}

export class MockProvider implements FiscalProvider {
  readonly tipo = FiscalProviderTipo.STUB_HOMOLOGACAO
  readonly simulado = true
  /** Histórico de chamadas (para asserções de teste). */
  readonly calls: MockProviderCall[] = []

  private readonly cfg: Required<Pick<MockProviderConfig, "ambiente" | "statusOnline" | "label">> & {
    outcomes: Partial<Record<FiscalProviderOperacao, MockOutcome>>
    clock: () => string
  }

  constructor(config: MockProviderConfig = {}) {
    this.cfg = {
      ambiente: config.ambiente ?? AmbienteFiscal.HOMOLOGACAO,
      statusOnline: config.statusOnline ?? true,
      label: config.label ?? "MOCK",
      outcomes: config.outcomes ?? {},
      clock: config.clock ?? (() => new Date().toISOString()),
    }
  }

  /** Limpa o histórico de chamadas. */
  reset(): void {
    this.calls.length = 0
  }

  private record(operacao: FiscalProviderOperacao): string {
    const em = this.cfg.clock()
    this.calls.push({ operacao, em })
    return em
  }

  private outcomeOf(op: FiscalProviderOperacao): MockOutcome {
    return this.cfg.outcomes[op] ?? "ok"
  }

  private evento(tipo: FiscalProviderEventoTipo, em: string, mensagem: string): FiscalProviderEvento {
    return { tipo, em, mensagem, detalhe: null }
  }

  /** Constrói a resposta canônica conforme o desfecho scriptado. */
  private respond(
    operacao: FiscalProviderOperacao,
    em: string,
    extra: { dados?: FiscalProviderDados | null } = {},
  ): FiscalProviderResponse {
    const resultado = this.outcomeOf(operacao)
    const base = {
      operacao,
      simulado: true,
      provider: this.cfg.label,
      ambiente: this.cfg.ambiente,
    }

    if (resultado === "ok") {
      return {
        ...base,
        ok: true,
        resultado,
        statusNota: STATUS_OK_POR_OP[operacao] ?? null,
        dados: extra.dados ?? { placeholder: true },
        mensagem: `(mock) ${operacao} simulada com sucesso.`,
        pendencias: [],
        erros: [],
        eventos: [this.evento(EVENTO_OK_POR_OP[operacao], em, `(mock) ${operacao} ok.`)],
      }
    }

    if (resultado === "pendente") {
      return {
        ...base,
        ok: false,
        resultado,
        statusNota: StatusNotaFiscal.RASCUNHO,
        dados: null,
        mensagem: `(mock) ${operacao} pendente.`,
        pendencias: [`(mock) pendência simulada em ${operacao}`],
        erros: [],
        eventos: [this.evento("validacao", em, `(mock) ${operacao} pendente.`)],
      }
    }

    const code: FiscalProviderError["code"] = resultado === "rejeitado" ? "operacao_nao_suportada" : "erro_interno"
    return {
      ...base,
      ok: false,
      resultado,
      statusNota: resultado === "rejeitado" ? StatusNotaFiscal.REJEITADA : StatusNotaFiscal.ERRO,
      dados: null,
      mensagem: `(mock) ${operacao} ${resultado}.`,
      pendencias: [],
      erros: [{ code, mensagem: `(mock) ${operacao} ${resultado} simulado.` }],
      eventos: [this.evento("erro", em, `(mock) ${operacao} ${resultado}.`)],
    }
  }

  validarConfiguracao(_config: FiscalProviderConfigInput): FiscalProviderResponse {
    const em = this.record("validarConfiguracao")
    return this.respond("validarConfiguracao", em)
  }

  validarSnapshot(_snapshot: VendaFiscalSnapshot | null | undefined): FiscalProviderResponse {
    const em = this.record("validarSnapshot")
    return this.respond("validarSnapshot", em)
  }

  prepararEmissao(_request: FiscalProviderRequest): FiscalProviderResponse {
    const em = this.record("prepararEmissao")
    return this.respond("prepararEmissao", em, { dados: { placeholder: true, rascunhoPreparado: true } })
  }

  async emitir(request: FiscalProviderRequest): Promise<FiscalProviderResponse> {
    const em = this.record("emitir")
    const seed = s(request?.contexto?.notaFiscalId) || s(request?.snapshot?.vendaId)
    const dados: FiscalProviderDados = {
      placeholder: true,
      chaveAcesso: placeholderId("CHAVE", seed),
      protocolo: placeholderId("PROT", seed),
      cStat: "100",
      xMotivo: "Autorizado o uso da NF-e (MOCK)",
      autorizadoEm: em,
    }
    return this.respond("emitir", em, { dados })
  }

  async consultar(params: FiscalProviderConsultaParams): Promise<FiscalProviderResponse> {
    const em = this.record("consultar")
    return this.respond("consultar", em, {
      dados: { placeholder: true, chaveAcesso: s(params?.chaveAcesso) || null, cStat: "100" },
    })
  }

  async cancelar(params: FiscalProviderCancelamentoParams): Promise<FiscalProviderResponse> {
    const em = this.record("cancelar")
    return this.respond("cancelar", em, {
      dados: { placeholder: true, chaveAcesso: s(params?.chaveAcesso) || null, cStat: "135" },
    })
  }

  async inutilizar(params: FiscalProviderInutilizacaoParams): Promise<FiscalProviderResponse> {
    const em = this.record("inutilizar")
    return this.respond("inutilizar", em, {
      dados: { placeholder: true, serie: params?.serie, cStat: "102" },
    })
  }

  async statusServico(_params: FiscalProviderStatusParams): Promise<FiscalProviderStatus> {
    const em = this.record("statusServico")
    const online = this.cfg.statusOnline
    return {
      provider: this.cfg.label,
      online,
      ambiente: this.cfg.ambiente,
      simulado: true,
      mensagem: online ? "(mock) Serviço em Operação." : "(mock) Serviço fora do ar.",
      cStat: online ? "107" : "108",
      verificadoEm: em,
    }
  }
}

/** Cria um MockProvider configurável (test double). */
export function createMockProvider(config: MockProviderConfig = {}): MockProvider {
  return new MockProvider(config)
}
