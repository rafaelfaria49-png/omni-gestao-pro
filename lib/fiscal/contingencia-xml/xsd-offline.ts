/**
 * Validação XSD OFFLINE da NFC-e contra o pacote oficial PL_010e_v1.02.
 *
 * Zero resolução remota: xmllint local com --nonet --nocatalogs sobre os XSD do repositório.
 * Nenhuma URL externa, nenhum worker HTTP, nenhum catálogo de rede.
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { XSD_SCHEMA_PACKAGE } from "../xsd/types"
import type { ContingenciaXsdOfflineResult } from "./types"

const XMLLINT_TIMEOUT_MS = 15_000

export function officialNfceSchemaPath(): string {
  return join(process.cwd(), "lib/fiscal/xsd/schemas", XSD_SCHEMA_PACKAGE)
}

function sanitizeIssue(message: string): string {
  return String(message)
    .replace(/[A-Za-z]:[\\/][^\s:]+/g, "[caminho-local]")
    .replace(/\/(?:[^\s/:]+\/){2,}[^\s:]+/g, "[caminho-local]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 500)
}

/**
 * Confronta o XML assinado com o schema NFC-e canônico do projeto, sem rede.
 */
export function validateNfceXmlXsdOffline(xml: string): ContingenciaXsdOfflineResult {
  const schemaPath = officialNfceSchemaPath()
  if (!existsSync(schemaPath)) {
    return {
      ok: false,
      code: "xsd_engine_ausente",
      issues: ["Pacote XSD oficial PL_010e_v1.02 ausente no repositório."],
    }
  }

  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.http_proxy
  delete env.https_proxy
  delete env.HTTP_PROXY
  delete env.HTTPS_PROXY
  delete env.ALL_PROXY
  delete env.all_proxy
  env.XML_CATALOG_FILES = ""
  env.XML_DEBUG_CATALOG = ""

  const result = spawnSync(
    "xmllint",
    ["--noout", "--nonet", "--nocatalogs", "--schema", schemaPath, "-"],
    {
      input: xml,
      encoding: "utf8",
      timeout: XMLLINT_TIMEOUT_MS,
      env,
      windowsHide: true,
    },
  )

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === "ENOENT") {
      return {
        ok: false,
        code: "xsd_engine_ausente",
        issues: ["xmllint ausente — validação XSD offline indisponível."],
      }
    }
    return {
      ok: false,
      code: "xsd_engine_ausente",
      issues: [sanitizeIssue(result.error.message)],
    }
  }

  if (result.status === 0) return { ok: true }

  const raw = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim()
  const issues = raw
    .split("\n")
    .map((line) => sanitizeIssue(line))
    .filter(Boolean)
  return {
    ok: false,
    code: "xsd_invalido",
    issues: issues.length > 0 ? issues : ["XML rejeitado pelo XSD oficial PL_010e_v1.02."],
  }
}
