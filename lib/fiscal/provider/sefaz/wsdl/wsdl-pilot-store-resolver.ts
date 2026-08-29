/**
 * Resolução dinâmica da loja-piloto da aquisição WSDL (H-9/H-10) — ADR-0016.
 *
 * Substitui o literal `"loja-1"` (constante `WSDL_EXECUTION_PILOT_STORE_ID`) como autoridade
 * de segurança. A piloto é a loja cuja `ConfiguracaoFiscalLoja` REAL satisfaz, simultaneamente:
 *
 *  - `ambiente = HOMOLOGACAO`;
 *  - `modeloFiscal = NFCE`;
 *  - `provider = SEFAZ_DIRETO`;
 *  - `certificadoAtivoId` presente e não vazio.
 *
 * Fail-closed por desenho: zero candidatas bloqueia; mais de uma candidata bloqueia e exige
 * decisão humana — não existe "a primeira", não existe desempate, não existe fallback para
 * nenhum literal. Falha de leitura do banco também bloqueia (`unavailable`). `fiscalEnabled`
 * NÃO é critério de candidatura: a regra resultante dessa flag é aplicada no preflight da rota
 * (que exige `fiscalEnabled = true` da candidata resolvida — ver doc do gate 019).
 *
 * Módulo puro de leitura: nenhuma escrita, nenhuma rede, nenhum segredo.
 */
import "server-only"

import { prisma } from "@/lib/prisma"

/** Critérios de candidatura — exatamente os quatro campos de `ConfiguracaoFiscalLoja`. */
export const WSDL_PILOT_STORE_CRITERIA = Object.freeze({
  ambiente: "HOMOLOGACAO",
  modeloFiscal: "NFCE",
  provider: "SEFAZ_DIRETO",
} as const)

export type WsdlPilotStoreClient = {
  configuracaoFiscalLoja: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>
  }
}

export type WsdlPilotStoreResolution =
  | { readonly ok: true; readonly storeId: string }
  | {
      readonly ok: false
      readonly code: "unavailable" | "no_candidate" | "ambiguous"
    }

function texto(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/** Devolve o `storeId` se a linha satisfaz TODOS os critérios; `null` caso contrário. */
function candidata(row: Record<string, unknown>): string | null {
  const storeId = texto(row.storeId)
  if (!storeId) return null
  if (texto(row.ambiente) !== WSDL_PILOT_STORE_CRITERIA.ambiente) return null
  if (texto(row.modeloFiscal) !== WSDL_PILOT_STORE_CRITERIA.modeloFiscal) return null
  if (texto(row.provider) !== WSDL_PILOT_STORE_CRITERIA.provider) return null
  if (!texto(row.certificadoAtivoId)) return null
  return storeId
}

export async function resolveWsdlPilotStoreFrom(
  client: WsdlPilotStoreClient,
): Promise<WsdlPilotStoreResolution> {
  let rows: Array<Record<string, unknown>>
  try {
    rows = await client.configuracaoFiscalLoja.findMany({
      select: {
        storeId: true,
        ambiente: true,
        modeloFiscal: true,
        provider: true,
        certificadoAtivoId: true,
      },
    })
  } catch {
    return { ok: false, code: "unavailable" }
  }

  const candidatas = new Set<string>()
  for (const row of rows) {
    const storeId = candidata(row)
    if (storeId) candidatas.add(storeId)
  }

  if (candidatas.size === 0) return { ok: false, code: "no_candidate" }
  if (candidatas.size > 1) return { ok: false, code: "ambiguous" }
  return { ok: true, storeId: [...candidatas][0]! }
}

export async function resolveWsdlPilotStore(): Promise<WsdlPilotStoreResolution> {
  return resolveWsdlPilotStoreFrom(prisma as unknown as WsdlPilotStoreClient)
}
