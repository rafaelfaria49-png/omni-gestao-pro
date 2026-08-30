/**
 * Resolução dinâmica da loja-piloto da aquisição WSDL (H-9/H-10) — ADR-0016 · GOAL 020 (132).
 *
 * Substitui o literal `"loja-1"` (constante `WSDL_EXECUTION_PILOT_STORE_ID`) como autoridade
 * de segurança. A piloto é a loja cuja `ConfiguracaoFiscalLoja` REAL satisfaz, simultaneamente:
 *
 *  - `ambiente = HOMOLOGACAO`;
 *  - `modeloFiscal = NFCE`;
 *  - `provider` em {`STUB_HOMOLOGACAO`, `SEFAZ_DIRETO`};
 *  - `fiscalEnabled = false` (OBRIGATÓRIO);
 *  - `certificadoAtivoId` presente e não vazio.
 *
 * **WSDL ≠ emissão.** A aquisição de contrato é metadado read-only via GET mTLS e NÃO exige —
 * na verdade RECUSA — o estado de emissão ligado: `fiscalEnabled=true` (ou provider fora do
 * par permitido) indica uma loja preparada para o pipeline de emissão, que é o domínio do gate
 * posterior do live drill de contingência, não da aquisição. Manter a emissão globalmente
 * desligada durante a aquisição é exatamente o estado preparatório seguro. Esta regra NÃO
 * altera a semântica global de `fiscalEnabled` (snapshot/emissão continuam regidos pelos
 * módulos próprios); vale apenas para o contrato específico desta aquisição.
 *
 * Fail-closed por desenho: zero candidatas bloqueia; mais de uma candidata bloqueia e exige
 * decisão humana — não existe "a primeira", não existe desempate, não existe fallback para
 * nenhum literal. Falha de leitura do banco também bloqueia (`unavailable`).
 *
 * `certificadoAtivoId` presente é só o critério de CANDIDATURA; a posse real do certificado
 * (ATIVO, vigente, refs resolvíveis, cofre disponível) é provada em execução por
 * `resolveActiveCertificate` na rota — nunca presumida aqui.
 *
 * Módulo puro de leitura: nenhuma escrita, nenhuma rede, nenhum segredo.
 */
import "server-only"

import { prisma } from "@/lib/prisma"

/** Critérios de candidatura — contrato específico da aquisição H-9/H-10 (metadado, sem emissão). */
export const WSDL_PILOT_STORE_CRITERIA = Object.freeze({
  ambiente: "HOMOLOGACAO",
  modeloFiscal: "NFCE",
  /** Aquisição de WSDL exige emissão DESLIGADA; habilitação pertence ao gate do live drill. */
  fiscalEnabled: false,
  /** Únicos providers elegíveis: preparatório de homologação ou direto (ainda com emissão off). */
  providersPermitidos: ["STUB_HOMOLOGACAO", "SEFAZ_DIRETO"],
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

/**
 * Predicado CANÔNICO de elegibilidade para a aquisição H-9/H-10 — fonte única usada pelo
 * resolver (candidatura) e pela rota (revalidação da própria leitura), de modo que as duas
 * superfícies nunca divergem. NÃO é a regra de emissão: lojas com `fiscalEnabled=true` ou
 * provider fora do par permitido são exatamente as que esta aquisição recusa.
 */
export function candidataAquisicaoWsdl(row: Record<string, unknown>): boolean {
  const storeId = texto(row.storeId)
  if (!storeId) return false
  if (texto(row.ambiente) !== WSDL_PILOT_STORE_CRITERIA.ambiente) return false
  if (texto(row.modeloFiscal) !== WSDL_PILOT_STORE_CRITERIA.modeloFiscal) return false
  if (!WSDL_PILOT_STORE_CRITERIA.providersPermitidos.includes(
    texto(row.provider) as (typeof WSDL_PILOT_STORE_CRITERIA.providersPermitidos)[number],
  )) {
    return false
  }
  if (row.fiscalEnabled !== WSDL_PILOT_STORE_CRITERIA.fiscalEnabled) return false
  if (!texto(row.certificadoAtivoId)) return false
  return true
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
        fiscalEnabled: true,
        certificadoAtivoId: true,
      },
    })
  } catch {
    return { ok: false, code: "unavailable" }
  }

  const candidatas = new Set<string>()
  for (const row of rows) {
    if (candidataAquisicaoWsdl(row)) candidatas.add(texto(row.storeId))
  }

  if (candidatas.size === 0) return { ok: false, code: "no_candidate" }
  if (candidatas.size > 1) return { ok: false, code: "ambiguous" }
  return { ok: true, storeId: [...candidatas][0]! }
}

export async function resolveWsdlPilotStore(): Promise<WsdlPilotStoreResolution> {
  return resolveWsdlPilotStoreFrom(prisma as unknown as WsdlPilotStoreClient)
}
