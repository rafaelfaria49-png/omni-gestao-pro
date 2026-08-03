/**
 * FiscalLog — trilha append-only de alterações administrativas da identidade fiscal
 * (GOAL_002). Grava em `fiscal_logs`. Best-effort: nunca bloqueia o save (auditoria
 * não pode derrubar a operação). Escopado por loja; registra operador e diff resumido.
 *
 * Esta fase NÃO emite nada — os logs aqui são apenas de CONFIGURAÇÃO (config/certificado).
 */
import type { Session } from "next-auth"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma"

export type FiscalLogAcao =
  | "config.update"
  | "certificado.criar"
  | "certificado.ativar"
  | "certificado.desativar"
  | "certificado.update"
  // GOAL-016B — onboarding orientado por certificado (leitura do A1 e confirmação do cadastro).
  | "certificado.onboarding.inspecionar"
  | "certificado.onboarding.confirmar"
  /**
   * Identidade importada do A1 SEM custódia do arquivo: nenhum certificado foi armazenado nem
   * ativado. Ação própria para que a trilha não sugira instalação de certificado.
   */
  | "identidade_importada_certificado_custodia_pendente"
  // GOAL-016C — ciclo de vida do segredo no cofre (ADR-0009 D7). Detalhe NUNCA contém segredo.
  | "secret.set"
  | "secret.rotate"
  | "secret.revoke"
  | "secret.access"
  | "certificado.custodia.armazenar"
  | "certificado.custodia.rotacionar"
  | "certificado.custodia.indisponivel"
  | "certificado.revogar"

function operadorFromSession(session: Session | null): string {
  const u = session?.user
  if (!u) return "sistema"
  return (u.name || u.email || u.id || "admin").toString().slice(0, 200)
}

export async function recordFiscalAdminLog(params: {
  session: Session | null
  storeId: string
  acao: FiscalLogAcao
  mensagem: string
  detalhe?: Record<string, unknown>
}): Promise<void> {
  try {
    const storeId = String(params.storeId ?? "").trim()
    if (!storeId) return
    await prisma.fiscalLog.create({
      data: {
        storeId,
        nivel: "INFO",
        acao: params.acao,
        mensagem: params.mensagem.slice(0, 1000),
        operador: operadorFromSession(params.session),
        detalhe: params.detalhe ? (params.detalhe as Prisma.InputJsonValue) : undefined,
      },
    })
  } catch {
    /* auditoria não deve bloquear a operação administrativa */
  }
}
