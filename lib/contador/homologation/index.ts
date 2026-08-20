export {
  DEFAULT_HOMOLOGATION_DATABASE_URL,
  ENV_HOMOLOGATION_DATABASE_URL,
  HomologationUrlError,
  assertLocalHomologationDatabaseUrl,
  resolveHomologationDatabaseUrl,
} from "./guard-url"
export {
  COMPETENCIA_REF,
  LINHAS_MASSA,
  STORE_A,
  STORE_B,
  STORE_IDS,
  type CasoMassa,
  type LinhaMassa,
} from "./massa"
export { seedFiscalHomologation, type SeedFiscalHomologationResult } from "./seed"
export {
  DHEMI_COMPETENCIA,
  DHEMI_FORA_COMPETENCIA,
  DHEMI_INVALIDO,
  XML_AUTORIZADA_COMPETENCIA,
  XML_AUTORIZADA_DHEMI_INVALIDO,
  XML_AUTORIZADA_FORA,
  XML_SEM_DHEMI,
} from "./xml-fixtures"
