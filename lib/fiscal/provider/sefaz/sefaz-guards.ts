/**
 * Guards pré-transporte do adapter SEFAZ (GOAL-016D-A · plano 016D **D4**).
 *
 * Os DEZ bloqueios obrigatórios, avaliados SEMPRE na ordem canônica e SEMPRE antes de
 * qualquer efeito ou contato com transporte. Todos são testáveis offline — é justamente o
 * que torna este slice demonstrável sem SEFAZ.
 *
 * | # | Bloqueio | Código |
 * |---|---|---|
 * | 1 | `ambiente ≠ HOMOLOGACAO` | `ambiente_nao_permitido` |
 * | 2 | `tpAmb ≠ 2` (lido do **XML persistido**, não da config) | `tpamb_nao_permitido` |
 * | 3 | `modelo ≠ NFC-e/65` | `modelo_nao_permitido` |
 * | 4 | `uf ≠ SP` | `uf_nao_permitida` |
 * | 4b | `correlationId` ausente (precondição de contrato — ADR-0020 §2.6) | `correlacao_ausente` |
 * | 5 | loja ≠ loja-piloto **resolvida** (nunca literal) | `loja_fora_do_piloto` |
 * | 6 | `ConfiguracaoFiscalLoja.provider ≠ SEFAZ_DIRETO` | `provider_divergente` |
 * | 7 | XML ausente / sem hash / hash divergente | `bytes_nao_verificados` |
 * | 8 | sem prova de validação XSD | `xsd_nao_validado` |
 * | 9 | endpoint fora da allow-list | `endpoint_nao_permitido` |
 * | 10 | certificado A1 indisponível pelo resolver 016D-A0 | `certificado_indisponivel` |
 *
 * Módulo PURO: sem Prisma, sem rede, sem cofre. Tudo que depende de I/O entra por PORTA
 * injetada, e toda porta ausente/indisponível **falha fechada** — nunca presume aprovação.
 * Em especial, a validação XSD **nunca é presumida**: sem atestado vinculado ao mesmo
 * `bytesSha256`, o guard 8 bloqueia.
 */
import { createHash } from "node:crypto"
import type { FiscalDocumentIdentity } from "@/lib/fiscal/emission/uncertain-state.types"
import type { ResolveActiveCertificateResult } from "@/lib/fiscal/certificate/resolve-active-certificate"
import {
  selectSefazEndpoint,
  SEFAZ_LAYOUT_VERSAO,
  type SefazEndpoint,
  type SefazServico,
} from "./sefaz-endpoint-catalog"

export type SefazGuardCode =
  | "ambiente_nao_permitido"
  | "tpamb_nao_permitido"
  | "modelo_nao_permitido"
  | "uf_nao_permitida"
  | "correlacao_ausente"
  | "loja_fora_do_piloto"
  | "provider_divergente"
  | "bytes_nao_verificados"
  | "xsd_nao_validado"
  | "endpoint_nao_permitido"
  | "certificado_indisponivel"

/** Ordem canônica de avaliação — congelada e verificada por teste. */
export const SEFAZ_GUARD_ORDER: readonly SefazGuardCode[] = Object.freeze([
  "ambiente_nao_permitido",
  "tpamb_nao_permitido",
  "modelo_nao_permitido",
  "uf_nao_permitida",
  "correlacao_ausente",
  "loja_fora_do_piloto",
  "provider_divergente",
  "bytes_nao_verificados",
  "xsd_nao_validado",
  "endpoint_nao_permitido",
  "certificado_indisponivel",
])

/**
 * Atestado de validação XSD (seam tipado — GOAL-016D-A).
 *
 * O contrato P2 atual NÃO carrega prova de validação XSD, e presumi-la seria exatamente o
 * erro que D4 item 8 existe para impedir. Este atestado é fornecido por porta injetada e
 * precisa estar VINCULADO aos mesmos bytes (`xmlSha256 === bytesSha256`) — atestado de
 * outro documento não vale. Nenhum schema/migration é criado por isso.
 */
export type SefazXsdAttestation = {
  readonly outcome: string
  readonly xmlSha256: string
  readonly schemaVersion: string
}

/** Configuração fiscal mínima que o guard 6 precisa — só leitura, sem segredo. */
export type SefazGuardFiscalConfig = {
  readonly provider: string
}

export type SefazGuardPorts = {
  /**
   * Resolve o `Store.id` REAL da loja-piloto (ADR-0016). Nunca literal, nunca `loja-1`.
   * `null` ⇒ piloto não definido ⇒ guard 5 bloqueia (fail-closed).
   */
  resolvePilotStoreId: () => Promise<string | null>
  /** Configuração fiscal da loja. `null` ⇒ guard 6 bloqueia. */
  loadFiscalConfig: (storeId: string) => Promise<SefazGuardFiscalConfig | null>
  /** Atestado XSD vinculado aos bytes. `null` ⇒ guard 8 bloqueia. */
  readXsdAttestation: (input: {
    storeId: string
    chaveAcesso: string
    bytesSha256: string
  }) => Promise<SefazXsdAttestation | null>
  /**
   * Resolver do certificado ativo (016D-A0). Tipado pelo contrato real; recebe apenas
   * `storeId` e devolve REFERÊNCIAS OPACAS. O guard NUNCA lê PFX/senha — só confere que a
   * resolução foi bem-sucedida.
   */
  resolveActiveCertificate: (params: { storeId: string }) => Promise<ResolveActiveCertificateResult>
}

export type SefazGuardFailure = {
  readonly ok: false
  readonly codigo: SefazGuardCode
  readonly mensagem: string
}

export type SefazGuardSuccess = {
  readonly ok: true
  readonly endpoint: SefazEndpoint
  /** Referências opacas do certificado — nunca material. */
  readonly certificado: {
    readonly certificadoId: string
    readonly blobRef: string
    readonly senhaRef: string
  }
  readonly correlationId: string
}

export type SefazGuardOutcome = SefazGuardSuccess | SefazGuardFailure

/**
 * Modo de avaliação.
 *  - `transmissao`: documento com payload — os **dez** guards rodam.
 *  - `consulta`: não há documento sendo transmitido, só a chave. Os guards 2, 7 e 8
 *    (tpAmb do XML, hash dos bytes, atestado XSD) não têm objeto sobre o qual incidir e
 *    são **inaplicáveis** — jamais "pulados por conveniência". Todos os demais rodam.
 */
export type SefazGuardMode = "transmissao" | "consulta"

const AMBIENTE_PERMITIDO = "HOMOLOGACAO"
const MODELO_PERMITIDO = "NFCE"
const UF_PERMITIDA = "SP"
const TPAMB_PERMITIDO = "2"
const PROVIDER_PERMITIDO = "SEFAZ_DIRETO"
const XSD_OUTCOME_APROVADO = "VALIDACAO_APROVADA"

function falha(codigo: SefazGuardCode, mensagem: string): SefazGuardFailure {
  return { ok: false, codigo, mensagem }
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

/**
 * Lê `tpAmb` do XML PERSISTIDO (nunca da configuração) — fecha a janela em que config e
 * documento divergem. Leitura estritamente READ-ONLY sobre uma CÓPIA decodificada: os
 * `exactBytes` não são alterados, normalizados nem re-serializados.
 *
 * Sem `<tpAmb>` legível ⇒ `null` ⇒ o guard 2 bloqueia (fail-closed, nunca presume "2").
 *
 * ⚠️ **Resistente a chamariz.** Uma busca ingênua pela PRIMEIRA ocorrência deixaria passar
 * um documento cujo `tpAmb` real é `1` (produção) precedido de um `<tpAmb>2</tpAmb>` dentro
 * de comentário ou CDATA — o parser da SEFAZ leria `1`, este guard leria `2`, e o guard
 * perderia exatamente a propriedade que existe para garantir. Por isso:
 *  1. comentários e seções CDATA são removidos da CÓPIA antes da busca;
 *  2. o valor só é aceito quando há **exatamente uma** ocorrência restante — zero ou
 *     múltiplas (ambiguidade) devolvem `null` e bloqueiam.
 */
export function readTpAmbFromSignedXml(exactBytes: Uint8Array): string | null {
  let decoded: string
  try {
    decoded = new TextDecoder("utf-8", { fatal: false }).decode(exactBytes)
  } catch {
    return null
  }
  // Remove comentários e CDATA — nenhum deles é conteúdo fiscal para a SEFAZ.
  const semChamariz = decoded
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")

  const ocorrencias = semChamariz.match(/<tpAmb>\s*([0-9]+)\s*<\/tpAmb>/g)
  // Ambiguidade nunca aprova: só um `tpAmb` inequívoco pode liberar o transporte.
  if (!ocorrencias || ocorrencias.length !== 1) return null

  const match = /<tpAmb>\s*([0-9]+)\s*<\/tpAmb>/.exec(ocorrencias[0])
  return match ? match[1] : null
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

/**
 * Executa os dez guards D4 na ordem canônica. Retorna no PRIMEIRO bloqueio — nenhum guard
 * posterior chega a rodar, e nenhuma porta posterior chega a ser consultada.
 */
export async function runSefazPreTransportGuards(input: {
  document: FiscalDocumentIdentity
  exactBytes?: Uint8Array
  bytesSha256?: string
  servico: SefazServico
  ports: SefazGuardPorts
  modo?: SefazGuardMode
}): Promise<SefazGuardOutcome> {
  const { document, ports } = input
  const modo: SefazGuardMode = input.modo ?? "transmissao"
  const exactBytes = input.exactBytes ?? new Uint8Array()
  const bytesSha256 = input.bytesSha256 ?? ""

  // 1 — ambiente declarado no documento.
  if (document.ambiente !== AMBIENTE_PERMITIDO) {
    return falha("ambiente_nao_permitido", "Somente o ambiente de homologação é permitido.")
  }

  // 2 — tpAmb lido do XML PERSISTIDO (não da config). Só há XML em transmissão.
  if (modo === "transmissao") {
    const tpAmb = readTpAmbFromSignedXml(exactBytes)
    if (tpAmb !== TPAMB_PERMITIDO) {
      return falha(
        "tpamb_nao_permitido",
        "tpAmb do XML persistido não é 2 (homologação) ou não pôde ser lido.",
      )
    }
  }

  // 3 — modelo NFC-e (65).
  if (document.modelo !== MODELO_PERMITIDO) {
    return falha("modelo_nao_permitido", "Somente NFC-e (modelo 65) é permitida.")
  }

  // 4 — UF do piloto. Campo aditivo: ausente ⇒ bloqueia.
  if (texto(document.uf).toUpperCase() !== UF_PERMITIDA) {
    return falha("uf_nao_permitida", "Somente a UF do piloto (SP) é permitida.")
  }

  // 4b — correlationId é precondição de contrato (ADR-0020 §2.6), aditivo e obrigatório aqui.
  const correlationId = texto(document.correlationId)
  if (!correlationId) {
    return falha("correlacao_ausente", "Documento sem correlationId; transporte bloqueado.")
  }

  // 5 — loja-piloto RESOLVIDA do registro real (jamais literal).
  const storeId = texto(document.storeId)
  const pilotStoreId = texto(await ports.resolvePilotStoreId())
  if (!storeId || !pilotStoreId || storeId !== pilotStoreId) {
    return falha("loja_fora_do_piloto", "Loja do documento não é a loja-piloto autorizada.")
  }

  // 6 — provider persistido na configuração da loja.
  const config = await ports.loadFiscalConfig(storeId)
  if (!config || texto(config.provider) !== PROVIDER_PERMITIDO) {
    return falha(
      "provider_divergente",
      "Configuração fiscal da loja não aponta para o provider SEFAZ_DIRETO.",
    )
  }

  const hashDeclarado = texto(bytesSha256).toLowerCase()
  if (modo === "transmissao") {
    // 7 — bytes assinados presentes e hash conferido contra os PRÓPRIOS bytes.
    if (exactBytes.length === 0 || !hashDeclarado || sha256Hex(exactBytes) !== hashDeclarado) {
      return falha(
        "bytes_nao_verificados",
        "XML assinado ausente ou SHA-256 divergente dos bytes recebidos.",
      )
    }

    // 8 — prova de validação XSD vinculada A ESTES bytes. Nunca presumida.
    const atestado = await ports.readXsdAttestation({
      storeId,
      chaveAcesso: document.chaveAcesso,
      bytesSha256: hashDeclarado,
    })
    if (
      !atestado ||
      texto(atestado.outcome) !== XSD_OUTCOME_APROVADO ||
      texto(atestado.xmlSha256).toLowerCase() !== hashDeclarado
    ) {
      return falha(
        "xsd_nao_validado",
        "Sem prova de validação XSD vinculada a estes bytes; transporte bloqueado.",
      )
    }
  }

  // 9 — endpoint estritamente do catálogo fechado.
  const lookup = selectSefazEndpoint({
    uf: UF_PERMITIDA,
    ambiente: AMBIENTE_PERMITIDO,
    servico: input.servico,
    versao: SEFAZ_LAYOUT_VERSAO,
  })
  if (!lookup.ok) {
    return falha("endpoint_nao_permitido", lookup.mensagem)
  }

  // 10 — certificado ativo pelo resolver 016D-A0 (só referências opacas).
  const certificado = await ports.resolveActiveCertificate({ storeId })
  if (!certificado.ok) {
    return falha(
      "certificado_indisponivel",
      "Certificado A1 ativo indisponível para esta loja; transporte bloqueado.",
    )
  }

  return {
    ok: true,
    endpoint: lookup.endpoint,
    certificado: {
      certificadoId: certificado.certificadoId,
      blobRef: certificado.blobRef,
      senhaRef: certificado.senhaRef,
    },
    correlationId,
  }
}
