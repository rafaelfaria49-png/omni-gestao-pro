/**
 * Cofre de Segredos Fiscais (BL-FISCAL-005 · ADR-0009) — ponto único de import.
 *
 * Port `FiscalSecretVault` (contrato por referência opaca) + backend `EnvVault` (piloto).
 * Server-only por natureza (lê secrets de plataforma). NUNCA expõe segredo, NUNCA persiste em
 * claro no banco, fail-closed. Produção (KmsStorageVault) implementa o MESMO contrato (futuro).
 */
export {
  FiscalVaultError,
  canonicalEnvRef,
  storeRefSuffix,
  type FiscalSecretMetadata,
  type FiscalSecretVault,
  type FiscalVaultAvailability,
  type FiscalVaultCapabilities,
  type FiscalVaultErrorCode,
  type FiscalCertificadoSegredo,
  type VaultRefKind,
} from "./fiscal-secret-vault"
export { EnvVault, createEnvVault, ENV_VAULT_BACKEND, type EnvVaultOptions, type EnvLike } from "./env-vault"

// GOAL-016C — resolver do Secret Provider (server-only) + serviço de custódia do A1.
export {
  PROVIDER_SUPABASE_VAULT,
  resolveFiscalSecretProvider,
  type FiscalSecretProviderResolution,
} from "./provider-resolver"
export {
  armazenarCertificadoA1,
  descreverCustodiaCertificado,
  revogarSegredosCertificado,
  rotacionarCertificadoA1,
  type ArmazenarResultado,
  type CertificadoRefs,
  type CustodiaFalha,
  type CustodiaFalhaCodigo,
  type DescricaoCustodia,
  type RevogacaoResultado,
  type RotacaoResultado,
} from "./certificado-custodia-service"

// GOAL-008 — leitor PKCS#12, validação do ciclo, alerta de vencimento e varredura de segredos.
export {
  loadPkcs12,
  zeroBuffer,
  Pkcs12ParseError,
  type Pkcs12ParseCode,
  type Pkcs12Material,
  type Pkcs12Meta,
} from "./pkcs12-loader"
export {
  validarCertificadoLoja,
  type CertificadoValidacao,
  type CertificadoValidacaoMotivo,
  type CertificadoStatusValor,
  type ValidarCertificadoParams,
} from "./certificado-validacao"
export {
  calcularAlertaVencimento,
  type VencimentoAlerta,
  type VencimentoNivel,
  type AlertaLimites,
} from "./certificado-alerta"
export {
  scanForSecrets,
  assertNoSecretLeak,
  toSearchable,
  SecretLeakError,
  type SegredosEmJogo,
  type SecretScanResultado,
} from "./secret-scan"
