/**
 * Provider STUB_HOMOLOGACAO (GOAL_006).
 *
 * Emissor de homologação CONTROLADO: não envia NADA externo (sem SEFAZ, sem gateway,
 * sem XML real, sem DANFE). Simula validações básicas e devolve respostas determinísticas
 * para exercitar o pipeline fiscal futuro.
 *
 * Garantias estruturais de isolamento:
 *  - Não importa `prisma` — não lê/escreve banco.
 *  - Não importa `getProdutoFiscal`/`Produto` — opera SOMENTE sobre o snapshot congelado.
 *  - Não toca Venda/Caixa/Financeiro/Estoque — é uma função pura sobre as entradas.
 *  - `simulado = true` e todo identificador devolvido é placeholder (`SIM-...`).
 */
import {
  AmbienteFiscal,
  FiscalProviderTipo,
  StatusNotaFiscal,
} from "@/generated/prisma"
import { isValidCnpj, isValidUf } from "../fiscal-validators"
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

const PROVIDER = FiscalProviderTipo.STUB_HOMOLOGACAO

function nowIso(): string {
  return new Date().toISOString()
}

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim()
}

function evento(
  tipo: FiscalProviderEventoTipo,
  mensagem: string,
  detalhe?: Record<string, unknown> | null,
): FiscalProviderEvento {
  return { tipo, em: nowIso(), mensagem, detalhe: detalhe ?? null }
}

type ResponseInit = {
  operacao: FiscalProviderOperacao
  resultado: FiscalProviderResultado
  ambiente: AmbienteFiscal | string
  mensagem: string
  statusNota?: StatusNotaFiscal | string | null
  dados?: FiscalProviderDados | null
  pendencias?: string[]
  erros?: FiscalProviderError[]
  eventos?: FiscalProviderEvento[]
}

/** Monta a resposta canônica. `ok` = resultado "ok" sem erros e sem pendências. */
function makeResponse(init: ResponseInit): FiscalProviderResponse {
  const pendencias = init.pendencias ?? []
  const erros = init.erros ?? []
  const ok = init.resultado === "ok" && erros.length === 0 && pendencias.length === 0
  return {
    ok,
    operacao: init.operacao,
    resultado: init.resultado,
    simulado: true,
    provider: PROVIDER,
    ambiente: init.ambiente,
    statusNota: init.statusNota ?? null,
    dados: init.dados ?? null,
    mensagem: init.mensagem,
    pendencias,
    erros,
    eventos: init.eventos ?? [],
  }
}

/** Identificador SIMULADO determinístico (nunca uma chave/protocolo real). */
function placeholderId(prefixo: string, seed: string): string {
  const base = s(seed).replace(/[^0-9a-zA-Z]/g, "").toUpperCase().slice(0, 24)
  return `SIM-${prefixo}-${base || "NA"}`
}

export class StubHomologacaoProvider implements FiscalProvider {
  readonly tipo = PROVIDER
  readonly simulado = true

  validarConfiguracao(config: FiscalProviderConfigInput): FiscalProviderResponse {
    const ambiente = config?.ambiente ?? AmbienteFiscal.HOMOLOGACAO
    if (!config) {
      return makeResponse({
        operacao: "validarConfiguracao",
        resultado: "erro",
        ambiente,
        mensagem: "Configuração fiscal da loja ausente.",
        erros: [{ code: "config_ausente", mensagem: "Nenhuma ConfiguracaoFiscalLoja informada." }],
        eventos: [evento("erro", "Configuração ausente.")],
      })
    }

    const pendencias: string[] = []
    if (!isValidCnpj(config.cnpj)) pendencias.push("CNPJ válido")
    if (s(config.razaoSocial).length === 0) pendencias.push("Razão social")
    if (!isValidUf(config.uf)) pendencias.push("UF válida")

    if (pendencias.length > 0) {
      return makeResponse({
        operacao: "validarConfiguracao",
        resultado: "pendente",
        ambiente,
        mensagem: "Identidade fiscal mínima incompleta para o provider de homologação.",
        pendencias,
        erros: [{ code: "config_incompleta", mensagem: "Campos obrigatórios faltando." }],
        eventos: [evento("validacao", "Configuração incompleta.", { pendencias })],
      })
    }

    return makeResponse({
      operacao: "validarConfiguracao",
      resultado: "ok",
      ambiente,
      mensagem:
        "Configuração aceita pelo provider de homologação (simulado — nenhum certificado/SEFAZ é exigido nesta fase).",
      eventos: [evento("validacao", "Configuração válida (stub).")],
    })
  }

  validarSnapshot(snapshot: VendaFiscalSnapshot | null | undefined): FiscalProviderResponse {
    const ambiente = snapshot?.ambiente ?? AmbienteFiscal.HOMOLOGACAO
    // Estrutura mínima: snapshot é objeto com itens (lido do snapshot, NUNCA de Produto vivo).
    if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.itens) || snapshot.itens.length === 0) {
      return makeResponse({
        operacao: "validarSnapshot",
        resultado: "erro",
        ambiente,
        mensagem: "Snapshot fiscal inválido ou sem itens.",
        erros: [{ code: "snapshot_invalido", mensagem: "Snapshot ausente, malformado ou sem itens." }],
        eventos: [evento("erro", "Snapshot inválido.")],
      })
    }

    // Reaproveita o diagnóstico congelado do snapshot (GOAL_005) — não recalcula nem relê produto.
    const pendencias = Array.isArray(snapshot.diagnostico?.pendencias) ? [...snapshot.diagnostico.pendencias] : []
    if (pendencias.length > 0) {
      return makeResponse({
        operacao: "validarSnapshot",
        resultado: "pendente",
        ambiente,
        mensagem: "Snapshot com pendências fiscais — não está pronto para emitir.",
        statusNota: StatusNotaFiscal.RASCUNHO,
        pendencias,
        erros: [{ code: "snapshot_incompleto", mensagem: "Identidade fiscal incompleta no snapshot." }],
        eventos: [evento("validacao", "Snapshot pendente.", { itensSemFiscal: snapshot.diagnostico?.itensSemFiscal ?? [] })],
      })
    }

    return makeResponse({
      operacao: "validarSnapshot",
      resultado: "ok",
      ambiente,
      mensagem: "Snapshot fiscal válido (simulado).",
      statusNota: StatusNotaFiscal.VALIDANDO,
      eventos: [evento("validacao", "Snapshot válido (stub).")],
    })
  }

  prepararEmissao(request: FiscalProviderRequest): FiscalProviderResponse {
    const ambiente = request?.contexto?.ambiente ?? request?.snapshot?.ambiente ?? AmbienteFiscal.HOMOLOGACAO
    const val = this.validarSnapshot(request?.snapshot)
    if (!val.ok) {
      // Propaga a pendência/erro do snapshot mantendo a operação como "prepararEmissao".
      return makeResponse({
        operacao: "prepararEmissao",
        resultado: val.resultado,
        ambiente,
        mensagem: val.mensagem,
        statusNota: StatusNotaFiscal.RASCUNHO,
        pendencias: val.pendencias,
        erros: val.erros,
        eventos: [evento("preparo", "Preparo bloqueado pela validação do snapshot.")],
      })
    }

    return makeResponse({
      operacao: "prepararEmissao",
      resultado: "ok",
      ambiente,
      mensagem:
        "Emissão preparada (simulado) — nenhum XML real foi gerado nem assinado nesta fase.",
      statusNota: StatusNotaFiscal.VALIDANDO,
      dados: { placeholder: true, rascunhoPreparado: true },
      eventos: [evento("preparo", "Rascunho preparado (stub).", { itens: request.snapshot.itens.length })],
    })
  }

  async emitir(request: FiscalProviderRequest): Promise<FiscalProviderResponse> {
    const ambiente = request?.contexto?.ambiente ?? request?.snapshot?.ambiente ?? AmbienteFiscal.HOMOLOGACAO
    const val = this.validarSnapshot(request?.snapshot)
    if (!val.ok) {
      return makeResponse({
        operacao: "emitir",
        resultado: val.resultado,
        ambiente,
        mensagem: `Emissão (simulada) não realizada: ${val.mensagem}`,
        statusNota: StatusNotaFiscal.RASCUNHO,
        pendencias: val.pendencias,
        erros: val.erros,
        eventos: [evento("erro", "Emissão simulada bloqueada pela validação do snapshot.")],
      })
    }

    const seed = s(request.contexto.notaFiscalId) || s(request.snapshot.vendaId)
    const dados: FiscalProviderDados = {
      placeholder: true,
      chaveAcesso: placeholderId("CHAVE", seed),
      protocolo: placeholderId("PROT", seed),
      cStat: "100",
      xMotivo: "Autorizado o uso da NF-e (SIMULADO — homologação stub)",
      autorizadoEm: nowIso(),
    }
    return makeResponse({
      operacao: "emitir",
      resultado: "ok",
      ambiente,
      mensagem:
        "Emissão SIMULADA pelo provider de homologação — nenhum documento foi transmitido à SEFAZ. Identificadores são placeholders.",
      statusNota: StatusNotaFiscal.AUTORIZADA,
      dados,
      eventos: [evento("emissao_simulada", "Emissão simulada concluída (stub).", { chaveAcesso: dados.chaveAcesso })],
    })
  }

  async consultar(params: FiscalProviderConsultaParams): Promise<FiscalProviderResponse> {
    const ambiente = params?.contexto?.ambiente ?? AmbienteFiscal.HOMOLOGACAO
    const chave = s(params?.chaveAcesso)
    const protocolo = s(params?.protocolo)
    if (!chave && !protocolo) {
      return makeResponse({
        operacao: "consultar",
        resultado: "pendente",
        ambiente,
        mensagem: "Consulta requer chave de acesso ou protocolo.",
        pendencias: ["chaveAcesso ou protocolo"],
        eventos: [evento("consulta", "Consulta sem identificador.")],
      })
    }
    return makeResponse({
      operacao: "consultar",
      resultado: "ok",
      ambiente,
      mensagem: "Consulta SIMULADA — documento considerado autorizado (homologação stub).",
      statusNota: StatusNotaFiscal.AUTORIZADA,
      dados: {
        placeholder: true,
        chaveAcesso: chave || null,
        protocolo: protocolo || null,
        cStat: "100",
        xMotivo: "Autorizado o uso da NF-e (SIMULADO)",
      },
      eventos: [evento("consulta", "Consulta simulada (stub).")],
    })
  }

  async cancelar(params: FiscalProviderCancelamentoParams): Promise<FiscalProviderResponse> {
    const ambiente = params?.contexto?.ambiente ?? AmbienteFiscal.HOMOLOGACAO
    const just = s(params?.justificativa)
    // Regra SEFAZ: justificativa de cancelamento entre 15 e 255 caracteres.
    if (just.length < 15 || just.length > 255) {
      return makeResponse({
        operacao: "cancelar",
        resultado: "rejeitado",
        ambiente,
        mensagem: "Justificativa de cancelamento deve ter entre 15 e 255 caracteres.",
        erros: [{ code: "justificativa_invalida", mensagem: "Justificativa fora do tamanho permitido.", campo: "justificativa" }],
        eventos: [evento("erro", "Cancelamento rejeitado: justificativa inválida.")],
      })
    }
    const seed = s(params.contexto.notaFiscalId) || s(params.chaveAcesso)
    return makeResponse({
      operacao: "cancelar",
      resultado: "ok",
      ambiente,
      mensagem: "Cancelamento SIMULADO — nenhum evento foi transmitido à SEFAZ (homologação stub).",
      statusNota: StatusNotaFiscal.CANCELADA,
      dados: {
        placeholder: true,
        chaveAcesso: s(params.chaveAcesso) || null,
        protocolo: placeholderId("CANC", seed),
        cStat: "135",
        xMotivo: "Evento registrado e vinculado a NF-e (SIMULADO)",
      },
      eventos: [evento("cancelamento_simulado", "Cancelamento simulado (stub).")],
    })
  }

  async inutilizar(params: FiscalProviderInutilizacaoParams): Promise<FiscalProviderResponse> {
    const ambiente = params?.contexto?.ambiente ?? AmbienteFiscal.HOMOLOGACAO
    const just = s(params?.justificativa)
    const ini = Number(params?.numeroInicial)
    const fim = Number(params?.numeroFinal)
    const erros: FiscalProviderError[] = []
    if (just.length < 15 || just.length > 255) {
      erros.push({ code: "justificativa_invalida", mensagem: "Justificativa deve ter entre 15 e 255 caracteres.", campo: "justificativa" })
    }
    if (!Number.isFinite(ini) || !Number.isFinite(fim) || ini <= 0 || fim < ini) {
      erros.push({ code: "parametros_invalidos", mensagem: "Faixa de numeração inválida (inicial > 0 e final >= inicial).", campo: "numeroInicial" })
    }
    if (erros.length > 0) {
      return makeResponse({
        operacao: "inutilizar",
        resultado: "rejeitado",
        ambiente,
        mensagem: "Parâmetros de inutilização inválidos.",
        erros,
        eventos: [evento("erro", "Inutilização rejeitada.")],
      })
    }
    return makeResponse({
      operacao: "inutilizar",
      resultado: "ok",
      ambiente,
      mensagem: "Inutilização SIMULADA — nenhuma faixa foi transmitida à SEFAZ (homologação stub).",
      statusNota: StatusNotaFiscal.INUTILIZADA,
      dados: {
        placeholder: true,
        protocolo: placeholderId("INUT", `${params.serie}-${ini}-${fim}`),
        cStat: "102",
        xMotivo: "Inutilização de número homologada (SIMULADO)",
        serie: params.serie,
        numeroInicial: ini,
        numeroFinal: fim,
      },
      eventos: [evento("inutilizacao_simulada", "Inutilização simulada (stub).")],
    })
  }

  async statusServico(params: FiscalProviderStatusParams): Promise<FiscalProviderStatus> {
    return {
      provider: PROVIDER,
      online: true,
      ambiente: params?.ambiente ?? AmbienteFiscal.HOMOLOGACAO,
      simulado: true,
      mensagem: "Serviço em Operação (SIMULADO — homologação stub, sem consulta real à SEFAZ).",
      cStat: "107",
      verificadoEm: nowIso(),
    }
  }
}

/** Instância única do stub (sem estado interno — seguro compartilhar). */
export const stubHomologacaoProvider = new StubHomologacaoProvider()
