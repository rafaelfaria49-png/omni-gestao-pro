import { join } from "node:path"

export const INUTILIZACAO_SCHEMA_PACKAGE = "PL_010d_v1.03/NFe" as const

export const INUTILIZACAO_SCHEMA_FILES = [
  "inutNFe_v4.00.xsd",
  "retInutNFe_v4.00.xsd",
  "leiauteInutNFe_v4.00.xsd",
  "procInutNFe_v4.00.xsd",
  "tiposBasico_v4.00.xsd",
  "xmldsig-core-schema_v1.01.xsd",
] as const

export function inutilizacaoSchemaRoot(): string {
  return join(process.cwd(), "lib/fiscal/xsd/schemas", INUTILIZACAO_SCHEMA_PACKAGE)
}

export function inutilizacaoSchemaPath(name: (typeof INUTILIZACAO_SCHEMA_FILES)[number]): string {
  return join(inutilizacaoSchemaRoot(), name)
}
