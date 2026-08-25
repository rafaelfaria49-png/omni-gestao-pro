/**
 * Validação XSD OFFLINE do pedido/retorno de inutilização contra o grafo oficial versionado.
 * Usa xmllint local com `--nonet`. Não chama o worker NFe (`PL_010e`) nem a SEFAZ.
 */

import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { INUTILIZACAO_SCHEMA_FILES, inutilizacaoSchemaPath } from "./official-schema"

export type InutilizacaoXsdResult = {
  readonly valid: boolean
  readonly output: string
}

function runXmllint(schemaFile: "inutNFe_v4.00.xsd" | "retInutNFe_v4.00.xsd", xml: string): InutilizacaoXsdResult {
  const schema = inutilizacaoSchemaPath(schemaFile)
  const dir = mkdtempSync(join(tmpdir(), "inut-xsd-"))
  const xmlPath = join(dir, "doc.xml")
  try {
    writeFileSync(xmlPath, xml, "utf8")
    const result = spawnSync(
      "/usr/bin/xmllint",
      ["--noout", "--nonet", "--nocatalogs", "--schema", schema, xmlPath],
      {
        encoding: "utf8",
        timeout: 5000,
        env: { ...process.env, XML_CATALOG_FILES: "", SGML_CATALOG_FILES: "" },
      },
    )
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
    return { valid: result.status === 0, output }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function validarInutilizacaoPedidoXsd(xml: string): InutilizacaoXsdResult {
  void INUTILIZACAO_SCHEMA_FILES
  return runXmllint("inutNFe_v4.00.xsd", xml)
}

export function validarInutilizacaoRetornoXsd(xml: string): InutilizacaoXsdResult {
  return runXmllint("retInutNFe_v4.00.xsd", xml)
}
