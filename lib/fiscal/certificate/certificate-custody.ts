/**
 * Custódia do certificado A1 — fonte ÚNICA da verdade sobre "instalado" (GOAL-016B · corretivo).
 *
 * Enquanto não existir provider real de custódia segura, o onboarding pode ler o `.pfx` em memória
 * e preencher a identidade fiscal — mas **não pode** produzir nenhum estado que pareça um
 * certificado utilizável. Um `CertificadoDigital` sem `blobRef`/`senhaRef` não é instalável: a
 * ativação (`validate-then-activate`) falharia em `blobRef_ausente`. Registrar essa linha criaria
 * um fantasma na lista da loja — com botão "Ativar" que nunca funcionaria.
 *
 * Por isso: sem custódia ⇒ grava-se SOMENTE a identidade fiscal confirmada. Nada de certificado.
 *
 * Módulo PURO (sem I/O, sem Prisma, sem node-forge): serve tanto ao servidor (refs cruas) quanto
 * ao cliente (flags `blobConfigured`/`senhaConfigured` devolvidas pela API).
 */

/** Mensagem exibida ao usuário quando a identidade foi importada mas o A1 não foi armazenado. */
export const MENSAGEM_CUSTODIA_PENDENTE =
  "Dados fiscais importados do certificado. O arquivo A1 não foi armazenado porque o cofre seguro " +
  "ainda não está configurado. Será necessário reenviar o certificado para concluir a instalação."

/**
 * Estado de um certificado sob a ótica da custódia. Aceita a forma do servidor (`blobRef`/
 * `senhaRef`) e a forma sanitizada da API (`blobConfigured`/`senhaConfigured`).
 */
export type CertificadoCustodiaEstado = {
  blobRef?: string | null
  senhaRef?: string | null
  blobConfigured?: boolean
  senhaConfigured?: boolean
  status?: string | null
  ativo?: boolean | null
}

function refPresente(ref: string | null | undefined, flag: boolean | undefined): boolean {
  if (typeof flag === "boolean") return flag
  return String(ref ?? "").trim() !== ""
}

/** `true` quando o material do certificado está de fato referenciado no cofre (blob + senha). */
export function certificadoTemCustodia(c: CertificadoCustodiaEstado | null | undefined): boolean {
  if (!c) return false
  return refPresente(c.blobRef, c.blobConfigured) && refPresente(c.senhaRef, c.senhaConfigured)
}

/**
 * `true` somente quando TUDO está presente ao mesmo tempo: blobRef válido, senhaRef válida,
 * certificado validado (`status = ATIVO`) e `ativo = true`. Qualquer outra combinação é
 * "ainda não configurado" — sem meio-termo e sem estado otimista.
 */
export function certificadoInstalado(c: CertificadoCustodiaEstado | null | undefined): boolean {
  if (!certificadoTemCustodia(c)) return false
  return c!.ativo === true && String(c!.status ?? "").toUpperCase() === "ATIVO"
}

/** `true` quando ao menos um certificado da loja está realmente instalado. */
export function algumCertificadoInstalado(
  certificados: readonly (CertificadoCustodiaEstado | null | undefined)[] | null | undefined,
): boolean {
  return Array.isArray(certificados) ? certificados.some((c) => certificadoInstalado(c)) : false
}

/** O que a confirmação do onboarding pode fazer com o `CertificadoDigital`. */
export type DecisaoRegistroCertificado =
  /** Já existe linha COM custódia para esta impressão — só os metadados são atualizados. */
  | { acao: "atualizar_metadados"; certificadoId: string }
  /** Sem custódia: grava apenas a identidade fiscal. Nenhuma linha de certificado é criada. */
  | { acao: "somente_identidade"; motivo: "custodia_ausente" }

/**
 * Decide o registro do certificado na confirmação. Regra única e fail-closed: só se toca em
 * `CertificadoDigital` quando a linha existente JÁ tem custódia (blobRef + senhaRef). Nunca se
 * cria linha nova sem custódia, e nunca se ativa nada aqui.
 */
export function decidirRegistroCertificado(
  existente: ({ id: string } & CertificadoCustodiaEstado) | null | undefined,
): DecisaoRegistroCertificado {
  if (existente && certificadoTemCustodia(existente)) {
    return { acao: "atualizar_metadados", certificadoId: existente.id }
  }
  return { acao: "somente_identidade", motivo: "custodia_ausente" }
}
