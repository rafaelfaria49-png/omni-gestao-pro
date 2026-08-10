/**
 * Onboarding fiscal orientado por certificado A1 (GOAL-016B) — ponto único de import.
 *
 * Server-side por natureza (a inspeção abre PKCS#12 via `node-forge`/`node:crypto`). O cliente
 * deve importar SOMENTE os tipos, direto de `./onboarding-types`, para não arrastar essas
 * dependências para o bundle.
 *
 * Este módulo NÃO emite, NÃO transmite à SEFAZ, NÃO liga `fiscalEnabled` e NÃO persiste segredo.
 */
export {
  PFX_TAMANHO_MAXIMO_BYTES,
  PFX_EXTENSOES_ACEITAS,
  PFX_CONTENT_TYPES_ACEITOS,
  avaliarMaterialCertificado,
  bloqueio,
  bloqueiosDoCertificadoDeclarado,
  inspecionarCertificadoPfx,
  nomeEmpresarialDoCn,
  validarArquivoPfx,
  type InspecaoCertificado,
} from "./certificate-inspection"

export {
  MENSAGEM_CUSTODIA_PENDENTE,
  algumCertificadoInstalado,
  certificadoInstalado,
  certificadoTemCustodia,
  decidirRegistroCertificado,
  type CertificadoCustodiaEstado,
  type DecisaoRegistroCertificado,
} from "./certificate-custody"

export {
  ORDEM_CAMPOS,
  ROTULOS_CAMPO,
  montarPayloadIdentidadeConfirmada,
  reconciliarOnboarding,
  type CertificadosContexto,
  type FiscalLojaSnapshot,
  type IdentidadeConfirmadaPayload,
  type ReconciliarParams,
  type StoreSnapshot,
} from "./certificate-reconcile"

export {
  LOOKUP_NAO_CONFIGURADO_MENSAGEM,
  NaoConfiguradoLookupProvider,
  resolveFiscalIdentityLookupProvider,
  type FiscalIdentityLookupEntrada,
  type FiscalIdentityLookupProvider,
  type FiscalIdentityLookupResultado,
  type FiscalLookupCampo,
  type FiscalLookupValor,
} from "./lookup-provider"

export type {
  CampoIdentidadeFiscal,
  CampoOnboarding,
  CertificadoExtraido,
  ConfiancaCampo,
  CustodiaSegredo,
  LookupResumo,
  LookupStatus,
  OnboardingBloqueio,
  OnboardingBloqueioCodigo,
  OnboardingPreview,
  OrigemCampo,
  ReconciliacaoLoja,
} from "./onboarding-types"

// GOAL-016D-A0 — resolver do certificado ativo por loja (storeId → blobRef/senhaRef opacos).
export {
  resolveActiveCertificate,
  type ResolveActiveCertificateErrorCode,
  type ResolveActiveCertificateFailure,
  type ResolveActiveCertificateParams,
  type ResolveActiveCertificateResult,
  type ResolveActiveCertificateSuccess,
} from "./resolve-active-certificate"

// GOAL-016D-C foundation 003 — material A1 efêmero para contexto mTLS server-side.
export {
  A1MtlsMaterialError,
  loadA1MtlsMaterial,
  type A1MtlsMaterial,
  type A1MtlsMaterialErrorCode,
  type A1MtlsSecretRefs,
  type A1MtlsTlsOptions,
  type LoadA1MtlsMaterialParams,
} from "./a1-mtls-material"
