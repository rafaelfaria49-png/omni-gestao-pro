/**
 * `SefazDiretoProvider` — adapter SEFAZ-SP de homologação, **estritamente offline**
 * (GOAL-016D-A · ADR-0020 · plano 016D D1–D6, D11).
 *
 * Fronteiras da ADR-0020:
 *  - **P2** (`UncertainStateFiscalProvider`) é a única superfície de transmissão. Recebe
 *    bytes exatos + hash já persistidos e conferidos pelo coordenador (ADR-0017); roda os
 *    dez guards D4; monta o envelope SOAP 1.2; entrega ao transporte INJETADO.
 *  - **P1** (`FiscalProvider`) serve apenas configuração/status por **instanciação direta**.
 *    `SEFAZ_DIRETO` **nunca** entra no `REGISTRY` (D11 regra 1) — o pipeline P1 continua
 *    incapaz de alcançar este adapter, por construção.
 *
 * Garantias mecânicas deste slice:
 *  - `simulado = false` — declaração **honesta**. Consequência desejada: o coordenador
 *    (`transmitWithUncertainStateSafety`) bloqueia este provider com `REAL_PROVIDER_BLOCKED`
 *    **antes** de chamar `transmit`. `simulado` é rótulo de trilha, nunca controle (F-1).
 *  - Zero import de cliente HTTP (`fetch`/`undici`/`axios`/`node:http`/`https`/`net`/`tls`).
 *  - Zero leitura de material do cofre: o certificado entra apenas como REFERÊNCIA opaca,
 *    via resolver 016D-A0.
 *  - O adapter **traduz e transporta**: não gera/altera XML, não assina, não calcula tributo,
 *    não aloca numeração, não calcula chave, não lê `Produto`/`Venda` e não escreve no banco.
 *  - **Não inventa resposta da SEFAZ.** Sem parser de `cStat` (016D-B), qualquer bloqueio ou
 *    recusa de transporte lança `SefazAdapterBlockedError` — jamais um `AUTHORIZED`,
 *    `REJECTED` ou `UNCERTAIN` fabricado, que a máquina de estado tomaria por resposta real.
 */
import { AmbienteFiscal, FiscalProviderTipo } from "@/generated/prisma"
import type {
  FiscalConsultationResult,
  FiscalTransmissionResult,
  UncertainStateFiscalProvider,
} from "@/lib/fiscal/emission/uncertain-state.types"
import type { VendaFiscalSnapshot } from "@/lib/fiscal/venda-fiscal-snapshot"
import type {
  FiscalProvider,
  FiscalProviderCancelamentoParams,
  FiscalProviderConfigInput,
  FiscalProviderConsultaParams,
  FiscalProviderError,
  FiscalProviderInutilizacaoParams,
  FiscalProviderOperacao,
  FiscalProviderRequest,
  FiscalProviderResponse,
  FiscalProviderStatus,
  FiscalProviderStatusParams,
} from "../types"
import { buildSefazSoap12Envelope } from "./sefaz-envelope"
import {
  runSefazPreTransportGuards,
  type SefazGuardCode,
  type SefazGuardMode,
  type SefazGuardPorts,
} from "./sefaz-guards"
import {
  sefazOfflineRefusingTransport,
  type SefazTransport,
  type SefazTransportErrorCode,
} from "./sefaz-transport.types"
import type { SefazServico } from "./sefaz-endpoint-catalog"

const PROVIDER = FiscalProviderTipo.SEFAZ_DIRETO

/** Timeout de conexão do piloto (D5). Sem efeito enquanto o transporte for offline. */
export const SEFAZ_DEFAULT_TIMEOUT_MS = 15_000

export type SefazAdapterBlockCode = SefazGuardCode | SefazTransportErrorCode

/**
 * Erro de domínio estável do adapter. Existe para que um bloqueio NUNCA possa ser confundido
 * com resposta da SEFAZ: não carrega `cStat`, protocolo, XML nem qualquer referência de cofre.
 */
export class SefazAdapterBlockedError extends Error {
  readonly codigo: SefazAdapterBlockCode
  /** Sempre `false` neste slice: nenhum contato externo é iniciado. */
  readonly externalTransmissionAttempted: false

  constructor(codigo: SefazAdapterBlockCode, mensagem: string) {
    super(mensagem)
    this.name = "SefazAdapterBlockedError"
    this.codigo = codigo
    this.externalTransmissionAttempted = false
  }
}

export type SefazDiretoProviderOptions = {
  ports: SefazGuardPorts
  /** Transporte injetável. Default: o que RECUSA tudo, sem abrir socket. */
  transport?: SefazTransport
  timeoutMs?: number
}

function erro(code: FiscalProviderError["code"], mensagem: string): FiscalProviderError {
  return { code, mensagem, campo: null, origem: null }
}

function respostaInerte(
  operacao: FiscalProviderOperacao,
  mensagem: string,
): FiscalProviderResponse {
  return {
    ok: false,
    operacao,
    resultado: "erro",
    simulado: false,
    provider: PROVIDER,
    ambiente: AmbienteFiscal.HOMOLOGACAO,
    statusNota: null,
    dados: null,
    mensagem,
    pendencias: [],
    erros: [erro("operacao_nao_suportada", mensagem)],
    eventos: [],
  }
}

const MENSAGEM_P1_INERTE =
  "SEFAZ_DIRETO não executa esta operação pela superfície P1 (ADR-0020 §2.1–2.3): a " +
  "transmissão real ocorre exclusivamente por UncertainStateFiscalProvider.transmit."

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

export class SefazDiretoProvider implements UncertainStateFiscalProvider, FiscalProvider {
  readonly tipo = PROVIDER
  /**
   * Declaração honesta: este provider NÃO é simulado. É o que faz o coordenador bloqueá-lo
   * antes de `transmit` — e é por isso que `simulado` nunca pode ser tratado como barreira.
   */
  readonly simulado = false

  private readonly ports: SefazGuardPorts
  private readonly transport: SefazTransport
  private readonly timeoutMs: number
  /**
   * Proveniência de rede desta INSTÂNCIA: "algum transporte já iniciou contato externo?".
   *
   * Deliberadamente **monotônica** (só sobe de `false` para `true`, nunca volta). Se uma
   * instância for reaproveitada entre jobs concorrentes — plausível num worker pool de fila —
   * uma flag reatribuída a cada chamada permitiria que a execução A lesse o `false` recém
   * escrito pela execução B e registrasse "nenhum contato externo" para uma transmissão que
   * de fato ocorreu. Sub-reportar transmissão é o erro caro numa trilha fiscal (leva a
   * retransmitir documento já enviado); sobre-reportar apenas provoca uma consulta a mais.
   * A monotonicidade escolhe conscientemente o lado seguro dessa assimetria.
   */
  private externalAttempted = false

  constructor(options: SefazDiretoProviderOptions) {
    this.ports = options.ports
    this.transport = options.transport ?? sefazOfflineRefusingTransport
    this.timeoutMs = options.timeoutMs ?? SEFAZ_DEFAULT_TIMEOUT_MS
  }

  /** Proveniência tipada consumida pela trilha de auditoria da fila (F-2). */
  readonly reportExternalTransmissionAttempted = (): boolean => this.externalAttempted

  // ── P2 — superfície de transmissão (ADR-0017/0020) ────────────────────────────────────

  /**
   * Roda os guards D4, monta o envelope e entrega ao transporte. Com o transporte offline
   * (default) SEMPRE termina em `SefazAdapterBlockedError` — nunca em desfecho fabricado.
   */
  async transmit(
    input: Parameters<UncertainStateFiscalProvider["transmit"]>[0],
  ): Promise<FiscalTransmissionResult> {
    await this.executarAteOTransporte({
      document: input.document,
      exactBytes: input.exactBytes,
      bytesSha256: input.bytesSha256,
      servico: "NFeAutorizacao4",
    })
    // Código morto INTENCIONAL: `executarAteOTransporte` devolve `Promise<never>` e sempre
    // lança. Este `throw` existe apenas para satisfazer a assinatura `FiscalTransmissionResult`
    // sem fabricar um desfecho — quando 016D-B/016D-C trouxerem parser e rede, é AQUI que o
    // desfecho real passa a ser construído.
    throw new SefazAdapterBlockedError(
      "transporte_offline_bloqueado",
      "Transmissão SEFAZ indisponível no slice offline 016D-A.",
    )
  }

  /**
   * Consulta por chave. Mesma disciplina: guards aplicáveis → transporte offline ⇒ erro
   * estável. Nenhum `cStat` é interpretado aqui (a matriz pertence ao 016D-B).
   */
  async consult(
    input: Parameters<UncertainStateFiscalProvider["consult"]>[0],
  ): Promise<FiscalConsultationResult> {
    await this.executarAteOTransporte({
      document: input.document,
      servico: "NFeConsultaProtocolo4",
      modo: "consulta",
    })
    // Código morto INTENCIONAL — mesma razão de `transmit` acima.
    throw new SefazAdapterBlockedError(
      "transporte_offline_bloqueado",
      "Consulta SEFAZ indisponível no slice offline 016D-A.",
    )
  }

  /**
   * Caminho comum: guards D4 → envelope SOAP → transporte. Lança no primeiro bloqueio.
   * Nenhum efeito colateral: não persiste, não consome numeração, não toca venda.
   */
  private async executarAteOTransporte(input: {
    document: Parameters<UncertainStateFiscalProvider["transmit"]>[0]["document"]
    exactBytes?: Uint8Array
    bytesSha256?: string
    servico: SefazServico
    modo?: SefazGuardMode
  }): Promise<never> {
    const guards = await runSefazPreTransportGuards({
      document: input.document,
      exactBytes: input.exactBytes,
      bytesSha256: input.bytesSha256,
      servico: input.servico,
      ports: this.ports,
      modo: input.modo,
    })
    if (!guards.ok) {
      throw new SefazAdapterBlockedError(guards.codigo, guards.mensagem)
    }

    const envelope = buildSefazSoap12Envelope({
      servico: input.servico,
      exactBytes: input.exactBytes ?? new Uint8Array(),
    })
    const outcome = await this.transport.send({
      endpoint: guards.endpoint,
      contentType: envelope.contentType,
      bodyBytes: envelope.bytes,
      correlationId: guards.correlationId,
      timeoutMs: this.timeoutMs,
    })
    // Proveniência derivada do que o transporte REALMENTE fez (nunca literal), e acumulada
    // de forma monotônica — uma tentativa externa registrada jamais é apagada por uma
    // execução posterior que não tenha alcançado a rede.
    this.externalAttempted = this.externalAttempted || outcome.externalTransmissionAttempted
    throw new SefazAdapterBlockedError(outcome.codigo, outcome.mensagem)
  }

  // ── P1 — configuração e status por instanciação direta (ADR-0020 §2.4) ────────────────

  /**
   * Validação PURA da configuração da loja para o provider direto. Sem rede, sem banco,
   * sem segredo — e sem efeito colateral algum (não muta `provider` na configuração).
   */
  validarConfiguracao(config: FiscalProviderConfigInput): FiscalProviderResponse {
    const pendencias: string[] = []
    if (!config) {
      return {
        ok: false,
        operacao: "validarConfiguracao",
        resultado: "pendente",
        simulado: false,
        provider: PROVIDER,
        ambiente: AmbienteFiscal.HOMOLOGACAO,
        statusNota: null,
        dados: null,
        mensagem: "Configuração fiscal da loja ausente.",
        pendencias: ["configuracao"],
        erros: [erro("config_ausente", "Configuração fiscal da loja ausente.")],
        eventos: [],
      }
    }
    if (texto(config.provider) !== PROVIDER) pendencias.push("provider")
    if (texto(config.ambiente) !== AmbienteFiscal.HOMOLOGACAO) pendencias.push("ambiente")
    if (texto(config.modeloFiscal) !== "NFCE") pendencias.push("modeloFiscal")
    if (texto(config.uf).toUpperCase() !== "SP") pendencias.push("uf")
    if (!texto(config.cnpj)) pendencias.push("cnpj")
    if (!texto(config.razaoSocial)) pendencias.push("razaoSocial")

    const ok = pendencias.length === 0
    return {
      ok,
      operacao: "validarConfiguracao",
      resultado: ok ? "ok" : "pendente",
      simulado: false,
      provider: PROVIDER,
      ambiente: texto(config.ambiente) || AmbienteFiscal.HOMOLOGACAO,
      statusNota: null,
      dados: null,
      mensagem: ok
        ? "Configuração compatível com o piloto SEFAZ direto (homologação SP, NFC-e)."
        : "Configuração incompatível com o piloto SEFAZ direto.",
      pendencias,
      erros: ok ? [] : [erro("config_incompleta", "Configuração incompatível com o piloto.")],
      eventos: [],
    }
  }

  /**
   * Status do serviço. Preparado para instanciação direta, porém **bloqueado pelo transporte**:
   * o bloqueio é DERIVADO de `transport.permiteRede`, não um literal — assim a barreira é a
   * capacidade real do transporte injetado, e não uma afirmação do adapter sobre si mesmo.
   *
   * Enquanto não houver parser de resposta (016D-B), mesmo um transporte com rede continua
   * sem produzir `cStat`: `online` só poderia virar `true` com uma resposta REAL interpretada.
   * Este slice, portanto, nunca finge "107 Serviço em Operação".
   */
  async statusServico(params: FiscalProviderStatusParams): Promise<FiscalProviderStatus> {
    const bloqueadoPorTransporteOffline = !this.transport.permiteRede
    return {
      provider: PROVIDER,
      online: false,
      ambiente: params?.ambiente ?? AmbienteFiscal.HOMOLOGACAO,
      simulado: false,
      mensagem: bloqueadoPorTransporteOffline
        ? "statusServico indisponível: o transporte SEFAZ é offline no slice 016D-A " +
          "(primeira chamada real depende dos gates G-F5.2 e G-H1..G-H3)."
        : "statusServico indisponível: sem parser de resposta SEFAZ neste slice (016D-B).",
      cStat: null,
      verificadoEm: new Date().toISOString(),
    }
  }

  // ── P1 — operações INERTES (nunca tocam rede, venda, série ou NotaFiscal) ─────────────

  validarSnapshot(_snapshot: VendaFiscalSnapshot | null | undefined): FiscalProviderResponse {
    void _snapshot
    return respostaInerte("validarSnapshot", MENSAGEM_P1_INERTE)
  }

  prepararEmissao(_request: FiscalProviderRequest): FiscalProviderResponse {
    void _request
    return respostaInerte("prepararEmissao", MENSAGEM_P1_INERTE)
  }

  async emitir(_request: FiscalProviderRequest): Promise<FiscalProviderResponse> {
    void _request
    return respostaInerte("emitir", MENSAGEM_P1_INERTE)
  }

  async consultar(_params: FiscalProviderConsultaParams): Promise<FiscalProviderResponse> {
    void _params
    return respostaInerte("consultar", MENSAGEM_P1_INERTE)
  }

  async cancelar(_params: FiscalProviderCancelamentoParams): Promise<FiscalProviderResponse> {
    void _params
    return respostaInerte("cancelar", MENSAGEM_P1_INERTE)
  }

  async inutilizar(_params: FiscalProviderInutilizacaoParams): Promise<FiscalProviderResponse> {
    void _params
    return respostaInerte("inutilizar", MENSAGEM_P1_INERTE)
  }
}
