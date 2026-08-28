/**
 * Preparer canônico da NFC-e finalizada (GOAL 021 · persistência QR pré-transmissão).
 *
 * Única composição sancionada para o documento que entra em
 * `persistBeforeTransmission`: snapshot congelado → `buildNfceXmlAssinavelResult`
 * (QR v3 online ou offline) → `signNfceXmlDetailed` → `FinalizedFiscalDocument`
 * com identidade, `xmlAssinado`, `digestValue`, `qrCodeData` e `urlConsulta`.
 *
 * `qrCodeData`/`urlConsulta` vêm de `infNFeSupl` estrutural — não de regex no XML.
 * URLs entram só por configuração injetada do catálogo `lib/fiscal/danfce/urls-sp`. Sem QR no caminho
 * SEFAZ-ready: fail closed, nada é persistido nem transmitido.
 * Offline (`tpEmis=9`): a assinatura RSA-SHA-1 do payload QR reusa o mesmo
 * material PEM do XMLDSig; as duas assinaturas permanecem distintas.
 *
 * Não transmite, não abre rede, não provisiona A1 real, não cria pipeline paralelo.
 */

import { createQrV3OfflinePemSigner } from "@/lib/fiscal/danfce/qr-v3"
import {
  signNfceXmlDetailed,
  NfceSignError,
  type FiscalCertificateMaterial,
  type SignNfceOptions,
} from "@/lib/fiscal/signing"
import {
  buildNfceXmlAssinavelResult,
  NfceXmlError,
  type NfceQrOfflineV3Config,
  type NfceQrOnlineV3Config,
} from "@/lib/fiscal/xml"
import type { VendaFiscalSnapshot } from "@/lib/fiscal/venda-fiscal-snapshot"

import type {
  FinalizedDocumentPrepareOptions,
  FinalizedDocumentPreparer,
  FinalizedFiscalDocument,
  FiscalDocumentLocator,
} from "./uncertain-state.types"

/** URLs injetadas do QR v3. Origem canônica: `selectNfceSpPublicUrls` (P-URL-SP). */
export type NfceQrUrlConfig = {
  qrCodeBaseUrl: string
  urlChave: string
}

export type NfceFinalizationSource = {
  storeId: string
  vendaId: string
  notaFiscalId: string
  modelo: "NFCE"
  ambiente: "HOMOLOGACAO"
  serie: number
  numero: number
  snapshot: VendaFiscalSnapshot
  tpEmis?: number
  dataEmissao?: string | Date
  dhCont?: string | Date
  xJust?: string
  uf?: string
  correlationId?: string
}

export type FinalizedNfceCertificateResolver = () => Promise<FiscalCertificateMaterial>

export type FinalizedNfcePreparerDependencies = {
  resolveSource: (
    locator: FiscalDocumentLocator,
    options?: FinalizedDocumentPrepareOptions,
  ) => Promise<NfceFinalizationSource>
  /**
   * Material A1 já em memória. Contrato atual: testes isolados e dry-run
   * passam fixture. Quando presente, o resolver lazy não é chamado.
   */
  certificado?: FiscalCertificateMaterial
  /**
   * Resolver lazy do material A1. Chamado somente dentro de `prepare()`,
   * depois de validar QR e fonte. Ausência de `certificado` e de resolver
   * falha fechado — nada é assinado, persistido ou transmitido.
   */
  resolveCertificate?: FinalizedNfceCertificateResolver
  senha?: string
  /**
   * Obrigatório no caminho SEFAZ-ready. Ausência falha fechado **antes** de
   * produzir XML, persistir ou transmitir.
   */
  qrUrls?: NfceQrUrlConfig | null
  signOptions?: SignNfceOptions
}

export type NfceQrConfigMissingCode = "qr_config_ausente"

export class NfceQrConfigMissingError extends Error {
  readonly code: NfceQrConfigMissingCode = "qr_config_ausente"
  constructor(message: string) {
    super(message)
    this.name = "NfceQrConfigMissingError"
  }
}

function requireInjectedQrUrls(urls: NfceQrUrlConfig | null | undefined): NfceQrUrlConfig {
  if (!urls || typeof urls !== "object") {
    throw new NfceQrConfigMissingError(
      "QR NFC-e v3 ausente no caminho SEFAZ-ready; finalização recusada antes da persistência.",
    )
  }
  const qrCodeBaseUrl = typeof urls.qrCodeBaseUrl === "string" ? urls.qrCodeBaseUrl.trim() : ""
  const urlChave = typeof urls.urlChave === "string" ? urls.urlChave.trim() : ""
  if (!qrCodeBaseUrl || !urlChave) {
    throw new NfceQrConfigMissingError(
      "QR NFC-e v3 exige qrCodeBaseUrl e urlChave injetadas; finalização recusada antes da persistência.",
    )
  }
  return { qrCodeBaseUrl, urlChave }
}

function sameLocator(locator: FiscalDocumentLocator, source: NfceFinalizationSource): boolean {
  return (
    source.storeId === locator.storeId &&
    source.vendaId === locator.vendaId &&
    source.notaFiscalId === locator.notaFiscalId
  )
}

function isCertificateMaterial(
  value: FiscalCertificateMaterial | undefined,
): value is FiscalCertificateMaterial {
  return Boolean(
    value &&
      typeof value.privateKeyPem === "string" &&
      value.privateKeyPem.length > 0 &&
      typeof value.certificatePem === "string" &&
      value.certificatePem.length > 0,
  )
}

async function resolveCertificateMaterial(
  deps: FinalizedNfcePreparerDependencies,
): Promise<FiscalCertificateMaterial> {
  if (isCertificateMaterial(deps.certificado)) return deps.certificado
  if (deps.resolveCertificate) return deps.resolveCertificate()
  throw new NfceSignError(
    "material_ausente",
    "Material de certificado A1 ausente; finalização recusada antes da assinatura.",
  )
}

/**
 * Fábrica do preparer canônico da NFC-e. Um único pipeline: o coordenador
 * `transmitWithUncertainStateSafety` já chama `prepare` → `persistBeforeTransmission`
 * → `provider.transmit`. Esta factory não cria uma segunda fronteira.
 */
export function createFinalizedNfcePreparer(
  deps: FinalizedNfcePreparerDependencies,
): FinalizedDocumentPreparer {
  return {
    async prepare(
      locator: FiscalDocumentLocator,
      options?: FinalizedDocumentPrepareOptions,
    ): Promise<FinalizedFiscalDocument> {
      const urls = requireInjectedQrUrls(deps.qrUrls)
      const source = await deps.resolveSource(locator, options)
      if (!sameLocator(locator, source)) {
        throw new NfceXmlError(
          "snapshot_invalido",
          "Fonte de finalização não pertence ao escopo fiscal solicitado.",
        )
      }

      const certificado = await resolveCertificateMaterial(deps)
      const tpEmis = options?.tpEmis ?? source.tpEmis ?? 1
      const qrOnlineV3: NfceQrOnlineV3Config | undefined =
        tpEmis === 9 ? undefined : { qrCodeBaseUrl: urls.qrCodeBaseUrl, urlChave: urls.urlChave }
      const qrOfflineV3: NfceQrOfflineV3Config | undefined =
        tpEmis === 9
          ? {
              qrCodeBaseUrl: urls.qrCodeBaseUrl,
              urlChave: urls.urlChave,
              sign: createQrV3OfflinePemSigner(certificado.privateKeyPem),
            }
          : undefined

      const built = buildNfceXmlAssinavelResult(source.snapshot, {
        serie: source.serie,
        numero: source.numero,
        tpEmis,
        dataEmissao: source.dataEmissao,
        dhCont: options?.dhCont ?? source.dhCont,
        xJust: options?.xJust ?? source.xJust,
        qrOnlineV3,
        qrOfflineV3,
      })
      if (!built.infNFeSupl) {
        throw new NfceQrConfigMissingError(
          "QR NFC-e v3 não materializou infNFeSupl; XML externo sem QR recusado.",
        )
      }

      const signed = signNfceXmlDetailed(
        built.xml,
        certificado,
        deps.senha ?? "",
        deps.signOptions,
      )

      return {
        storeId: locator.storeId,
        vendaId: locator.vendaId,
        notaFiscalId: locator.notaFiscalId,
        modelo: source.modelo,
        ambiente: source.ambiente,
        serie: built.serie,
        numero: built.numero,
        chaveAcesso: built.chaveAcesso,
        uf: source.uf,
        correlationId: source.correlationId,
        xmlAssinado: signed.xml,
        digestValue: signed.digestValue,
        qrCodeData: built.infNFeSupl.qrCode,
        urlConsulta: built.infNFeSupl.urlChave,
      }
    },
  }
}
