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
 *  - Ausência da marca `IN_MEMORY_ONLY_FISCAL_PROVIDER` ⇒ o coordenador o classifica como
 *    EXTERNO e exige capability de execução, que no 016D-A nasce negada ⇒ bloqueio com
 *    `EXTERNAL_EXECUTION_NOT_AUTHORIZED` **antes** de `transmit`. `simulado = false` é
 *    declaração honesta e puramente de trilha: não bloqueia nem autoriza nada (F-1).
 *  - Zero import de cliente HTTP (`fetch`/`undici`/`axios`/`node:http`/`https`/`net`/`tls`).
 *  - Zero leitura de material do cofre: o certificado entra apenas como REFERÊNCIA opaca,
 *    via resolver 016D-A0.
 *  - O adapter **traduz e transporta**: não gera/altera XML, não assina, não calcula tributo,
 *    não aloca numeração, não calcula chave, não lê `Produto`/`Venda` e não escreve no banco.
 *  - **Não inventa resposta da SEFAZ.** Sem parser de `cStat` (016D-B), qualquer bloqueio ou
 *    recusa de transporte lança `SefazAdapterBlockedError` — jamais um `AUTHORIZED`,
 *    `REJECTED` ou `UNCERTAIN` fabricado, que a máquina de estado tomaria por resposta real.
 */
import { createHash } from "node:crypto"
import { AmbienteFiscal, FiscalProviderTipo, StatusNotaFiscal } from "@/generated/prisma"
import type {
  FiscalConsultationResult,
  FiscalDocumentIdentity,
  FiscalExecutionProvenanceSink,
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
import { validarJustificativaCancelamento } from "@/lib/fiscal/events/justificativa"
import { buildXmlEventoCancelamento } from "@/lib/fiscal/events/evento-xml"
import { signEventoCancelamentoXml } from "@/lib/fiscal/events/evento-sign"
import { parseRetornoEventoCancelamento } from "@/lib/fiscal/events/parse-retorno-evento"

import type { FiscalCertificateMaterial } from "@/lib/fiscal/signing/signer.types"
import { NfceSignError } from "@/lib/fiscal/signing/signer.types"
import { buildSefazSoap12Envelope, type SefazEnvelopeRejectionCode } from "./sefaz-envelope"
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
import { executarInutilizacaoSefaz } from "@/lib/fiscal/inutilizacao/sefaz-inutilizar"

const PROVIDER = FiscalProviderTipo.SEFAZ_DIRETO

/** Relógios separados do transporte. Sem efeito enquanto o default permanecer offline. */
export const SEFAZ_DEFAULT_CONNECTION_TIMEOUT_MS = 15_000
export const SEFAZ_DEFAULT_TOTAL_DEADLINE_MS = 60_000
/** @deprecated Use `SEFAZ_DEFAULT_CONNECTION_TIMEOUT_MS`. */
export const SEFAZ_DEFAULT_TIMEOUT_MS = SEFAZ_DEFAULT_CONNECTION_TIMEOUT_MS

/**
 * Consulta ainda não possui construtor de payload (`consSitNFe` pertence ao 016D-B). Recusar
 * é a única saída honesta: envelopar bytes vazios produziria uma requisição sem conteúdo
 * fiscal, e fabricar o payload seria implementar o slice seguinte por antecipação.
 */
export type SefazAdapterProviderCode =
  | "consulta_sem_payload_neste_slice"
  | "resposta_sem_parser_neste_slice"

export type SefazAdapterBlockCode =
  | SefazGuardCode
  | SefazTransportErrorCode
  | SefazEnvelopeRejectionCode
  | SefazAdapterProviderCode

/**
 * Erro de domínio estável do adapter. Existe para que um bloqueio NUNCA possa ser confundido
 * com resposta da SEFAZ: não carrega `cStat`, protocolo, XML nem qualquer referência de cofre.
 */
export class SefazAdapterBlockedError extends Error {
  readonly codigo: SefazAdapterBlockCode
  /**
   * Proveniência DESTA falha. `boolean`, não o literal `false`: um bloqueio que ocorra depois
   * de o transporte ter alcançado a rede precisa poder dizê-lo. Todo caminho deste slice
   * produz `false` porque nenhum transporte existente abre socket.
   */
  readonly externalTransmissionAttempted: boolean

  constructor(
    codigo: SefazAdapterBlockCode,
    mensagem: string,
    externalTransmissionAttempted = false,
  ) {
    super(mensagem)
    this.name = "SefazAdapterBlockedError"
    this.codigo = codigo
    this.externalTransmissionAttempted = externalTransmissionAttempted
  }
}

export type SefazDiretoProviderOptions = {
  ports: SefazGuardPorts
  /** Transporte injetável. Default: o que RECUSA tudo, sem abrir socket. */
  transport?: SefazTransport
  connectionTimeoutMs?: number
  totalDeadlineMs?: number
  /** Material A1 em memória para XMLDSig do infEvento (testes / wiring explícito). */
  signingMaterial?: FiscalCertificateMaterial
  signingPassphrase?: string
  /** Override de assinatura. Default: `signEventoCancelamentoXml` com `signingMaterial`. */
  signEvento?: (unsignedXml: string) => string | Promise<string>
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
  private readonly connectionTimeoutMs: number
  private readonly totalDeadlineMs: number
  private readonly signingMaterial: FiscalCertificateMaterial | null
  private readonly signingPassphrase: string
  private readonly signEvento: ((unsignedXml: string) => string | Promise<string>) | null

  constructor(options: SefazDiretoProviderOptions) {
    this.ports = options.ports
    this.transport = options.transport ?? sefazOfflineRefusingTransport
    this.connectionTimeoutMs =
      options.connectionTimeoutMs ?? SEFAZ_DEFAULT_CONNECTION_TIMEOUT_MS
    this.totalDeadlineMs = options.totalDeadlineMs ?? SEFAZ_DEFAULT_TOTAL_DEADLINE_MS
    this.signingMaterial = options.signingMaterial ?? null
    this.signingPassphrase = options.signingPassphrase ?? ""
    this.signEvento = options.signEvento ?? null
  }

  /**
   * ⚠️ Este provider NÃO carrega `IN_MEMORY_ONLY_FISCAL_PROVIDER`. É essa ausência — e não
   * `simulado` — que faz o coordenador exigir capability de execução externa e bloqueá-lo.
   *
   * Também não guarda proveniência de rede em campo de instância (correção 002 · bloqueio 3):
   * o registro vai para o coletor DA EXECUÇÃO, recebido em cada chamada. Uma instância
   * reaproveitada num worker pool não tem, portanto, estado a vazar de um job para outro.
   */

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
      provenance: input.provenance,
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
    // Guards D4 primeiro: a recusa por falta de payload nunca pode mascarar um documento fora
    // do piloto, de ambiente errado ou sem certificado.
    const guards = await runSefazPreTransportGuards({
      document: input.document,
      servico: "NFeConsultaProtocolo4",
      ports: this.ports,
      modo: "consulta",
    })
    if (!guards.ok) {
      throw new SefazAdapterBlockedError(guards.codigo, guards.mensagem)
    }
    /**
     * Sem construtor de `consSitNFe` (016D-B), não existem bytes fiscais a envelopar. Envelopar
     * vazio produziria `<nfeDadosMsg/>` — uma requisição sem conteúdo — e fabricar o payload
     * seria antecipar o slice seguinte. A recusa é o desfecho honesto; nenhum socket é aberto
     * em nenhum dos casos.
     */
    throw new SefazAdapterBlockedError(
      "consulta_sem_payload_neste_slice",
      "Consulta SEFAZ indisponível no slice offline 016D-A: o payload consSitNFe pertence ao 016D-B.",
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
    provenance?: FiscalExecutionProvenanceSink
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

    // Envelope fail-closed: bytes com BOM, não-UTF8 ou com declaração XML são RECUSADOS,
    // nunca "consertados" — consertar mudaria os bytes persistidos (ADR-0017/0018).
    const envelope = buildSefazSoap12Envelope({
      servico: input.servico,
      exactBytes: input.exactBytes ?? new Uint8Array(),
    })
    if (!envelope.ok) {
      throw new SefazAdapterBlockedError(envelope.codigo, envelope.mensagem)
    }

    const outcome = await this.transport.send({
      endpoint: guards.endpoint,
      contentType: envelope.envelope.contentType,
      bodyBytes: envelope.envelope.bytes,
      correlationId: guards.correlationId,
      certificate: {
        storeId: input.document.storeId,
        blobRef: guards.certificado.blobRef,
        senhaRef: guards.certificado.senhaRef,
      },
      connectionTimeoutMs: this.connectionTimeoutMs,
      totalDeadlineMs: this.totalDeadlineMs,
    })
    // Proveniência derivada do que o transporte REALMENTE fez, registrada no coletor DESTA
    // execução. Sem estado de instância: nada sobrevive para contaminar o próximo job.
    if (outcome.externalTransmissionAttempted) {
      input.provenance?.recordExternalTransmissionAttempted()
    }
    if (outcome.ok) {
      // O foundation 003 prova somente o canal. Sem contrato WSDL/parser oficial (H-9/H-10),
      // uma resposta recebida não pode ser transformada em desfecho fiscal.
      throw new SefazAdapterBlockedError(
        "resposta_sem_parser_neste_slice",
        "Resposta HTTPS recebida, mas interpretação fiscal permanece bloqueada por H-9/H-10.",
        true,
      )
    }
    throw new SefazAdapterBlockedError(
      outcome.codigo,
      outcome.mensagem,
      outcome.externalTransmissionAttempted,
    )
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

  async cancelar(params: FiscalProviderCancelamentoParams): Promise<FiscalProviderResponse> {
    const ambiente = texto(params?.contexto?.ambiente) || AmbienteFiscal.HOMOLOGACAO
    const just = validarJustificativaCancelamento(params?.justificativa)
    if (!just.ok) {
      return {
        ok: false,
        operacao: "cancelar",
        resultado: "rejeitado",
        simulado: false,
        provider: PROVIDER,
        ambiente,
        statusNota: null,
        dados: null,
        mensagem: just.mensagem,
        pendencias: [],
        erros: [erro("justificativa_invalida", just.mensagem)],
        eventos: [],
      }
    }

    const chave = texto(params?.chaveAcesso)
    const protocolo = texto(params?.protocolo)
    if (!/^\d{44}$/.test(chave) || !protocolo) {
      return {
        ok: false,
        operacao: "cancelar",
        resultado: "rejeitado",
        simulado: false,
        provider: PROVIDER,
        ambiente,
        statusNota: null,
        dados: null,
        mensagem: "Cancelamento exige chave de acesso (44 dígitos) e protocolo de autorização.",
        pendencias: ["chaveAcesso", "protocolo"].filter((p) =>
          p === "chaveAcesso" ? !/^\d{44}$/.test(chave) : !protocolo,
        ),
        erros: [erro("parametros_invalidos", "chaveAcesso e protocolo são obrigatórios.")],
        eventos: [],
      }
    }

    if (ambiente === AmbienteFiscal.PRODUCAO) {
      return {
        ok: false,
        operacao: "cancelar",
        resultado: "erro",
        simulado: false,
        provider: PROVIDER,
        ambiente,
        statusNota: null,
        dados: null,
        mensagem: "Somente o ambiente de homologação é permitido.",
        pendencias: [],
        erros: [erro("operacao_nao_suportada", "Somente o ambiente de homologação é permitido.")],
        eventos: [],
      }
    }

    const unsignedXml = buildXmlEventoCancelamento({
      chaveAcesso: chave,
      protocolo,
      justificativa: just.texto,
      cnpj: chave.slice(6, 20),
      tpAmb: "2",
      cOrgao: chave.slice(0, 2),
      sequencia: 1,
    })

    let xmlEvento: string
    try {
      xmlEvento = this.signEvento
        ? await this.signEvento(unsignedXml)
        : this.signingMaterial
          ? signEventoCancelamentoXml(unsignedXml, this.signingMaterial, this.signingPassphrase, {
              ignorarValidade: false,
            })
          : ""
    } catch (e) {
      const mensagem = e instanceof NfceSignError ? e.message : "Falha ao assinar o evento de cancelamento."
      return {
        ok: false,
        operacao: "cancelar",
        resultado: "erro",
        simulado: false,
        provider: PROVIDER,
        ambiente,
        statusNota: null,
        dados: null,
        mensagem,
        pendencias: [],
        erros: [erro("erro_interno", mensagem)],
        eventos: [],
      }
    }
    if (!xmlEvento.includes("<Signature")) {
      return {
        ok: false,
        operacao: "cancelar",
        resultado: "erro",
        simulado: false,
        provider: PROVIDER,
        ambiente,
        statusNota: null,
        dados: null,
        mensagem:
          "Assinatura XMLDSig do infEvento indisponível: material A1 não injetado. Evento não assinado não é transmitido.",
        pendencias: [],
        erros: [erro("erro_interno", "Evento de cancelamento sem XMLDSig; transmissão recusada.")],
        eventos: [],
      }
    }

    const exactBytes = new TextEncoder().encode(xmlEvento)
    const bytesSha256 = createHash("sha256").update(exactBytes).digest("hex")
    const document: FiscalDocumentIdentity = {
      storeId: texto(params?.contexto?.storeId),
      vendaId: texto(params?.contexto?.notaFiscalId) || chave,
      notaFiscalId: texto(params?.contexto?.notaFiscalId) || chave,
      modelo: "NFCE",
      ambiente: "HOMOLOGACAO",
      serie: Number(params?.contexto?.serie) > 0 ? Number(params.contexto.serie) : 1,
      numero: Number(params?.contexto?.numero) > 0 ? Number(params.contexto.numero) : 1,
      chaveAcesso: chave,
      uf: texto(params?.contexto?.uf),
      correlationId: texto(params?.contexto?.correlationId),
    }

    const guards = await runSefazPreTransportGuards({
      document,
      exactBytes,
      bytesSha256,
      servico: "NFeRecepcaoEvento4",
      ports: this.ports,
      modo: "evento",
    })
    if (!guards.ok) {
      return {
        ok: false,
        operacao: "cancelar",
        resultado: "erro",
        simulado: false,
        provider: PROVIDER,
        ambiente,
        statusNota: null,
        dados: { chaveAcesso: chave, servico: "NFeRecepcaoEvento4", guard: guards.codigo },
        mensagem: guards.mensagem,
        pendencias: [],
        erros: [erro("erro_interno", guards.mensagem)],
        eventos: [],
      }
    }

    const envelope = buildSefazSoap12Envelope({
      servico: "NFeRecepcaoEvento4",
      exactBytes,
    })
    if (!envelope.ok) {
      return {
        ok: false,
        operacao: "cancelar",
        resultado: "erro",
        simulado: false,
        provider: PROVIDER,
        ambiente,
        statusNota: null,
        dados: null,
        mensagem: envelope.mensagem,
        pendencias: [],
        erros: [erro("erro_interno", envelope.mensagem)],
        eventos: [],
      }
    }

    const outcome = await this.transport.send({
      endpoint: guards.endpoint,
      contentType: envelope.envelope.contentType,
      bodyBytes: envelope.envelope.bytes,
      correlationId: guards.correlationId,
      certificate: {
        storeId: document.storeId,
        blobRef: guards.certificado.blobRef,
        senhaRef: guards.certificado.senhaRef,
      },
      connectionTimeoutMs: this.connectionTimeoutMs,
      totalDeadlineMs: this.totalDeadlineMs,
    })

    if (!outcome.ok) {
      return {
        ok: false,
        operacao: "cancelar",
        resultado: "erro",
        simulado: false,
        provider: PROVIDER,
        ambiente,
        statusNota: null,
        dados: {
          chaveAcesso: chave,
          servico: "NFeRecepcaoEvento4",
          transporte: outcome.codigo,
          xmlEvento,
        },
        mensagem: outcome.mensagem,
        pendencias: [],
        erros: [erro("erro_interno", outcome.mensagem)],
        eventos: [],
      }
    }

    const xmlRetorno = new TextDecoder("utf-8", { fatal: false }).decode(outcome.bodyBytes)
    const parsed = parseRetornoEventoCancelamento({ xml: xmlRetorno, chaveAcessoEsperada: chave })
    const autorizado = parsed.desfecho === "autorizado"
    return {
      ok: autorizado,
      operacao: "cancelar",
      resultado: autorizado ? "ok" : parsed.desfecho === "incerto" ? "erro" : "rejeitado",
      simulado: false,
      provider: PROVIDER,
      ambiente,
      statusNota: autorizado ? StatusNotaFiscal.CANCELADA : null,
      dados: {
        chaveAcesso: chave,
        protocolo: parsed.protocolo,
        cStat: parsed.cStat,
        xMotivo: parsed.xMotivo,
        servico: "NFeRecepcaoEvento4",
        xmlEvento,
        xmlRetorno,
      },
      mensagem: autorizado
        ? "Evento de cancelamento registrado (NFeRecepcaoEvento4, cStat 135)."
        : parsed.xMotivo || "Cancelamento fiscal não registrado.",
      pendencias: [],
      erros: autorizado
        ? []
        : [erro(parsed.desfecho === "incerto" ? "erro_interno" : "parametros_invalidos", parsed.xMotivo || "Evento não autorizado.")],
      eventos: [],
    }
  }

  async inutilizar(params: FiscalProviderInutilizacaoParams): Promise<FiscalProviderResponse> {
    return executarInutilizacaoSefaz({
      params,
      transport: this.transport,
      connectionTimeoutMs: this.connectionTimeoutMs,
      totalDeadlineMs: this.totalDeadlineMs,
    })
  }
}
