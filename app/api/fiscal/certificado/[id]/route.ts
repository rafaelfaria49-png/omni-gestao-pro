/**
 * Certificado digital por loja — ciclo seguro do A1 (GOAL_002 · GOAL-008).
 *
 * - Apenas ADMIN, multi-loja (header `x-assistec-loja-id`).
 * - Ciclo (GOAL-008 · item 5): `PENDENTE_VALIDACAO → ATIVO` SOMENTE por ato administrativo explícito
 *   (`ativo:true`) e SOMENTE se a validação do `.pfx` resolvido do cofre passar (fail-closed).
 * - `validar:true` roda a validação sem ativar (reflete o status real: INVALIDO/EXPIRADO/pendente).
 * - "1 ativo por loja": ativar desativa os demais e aponta `ConfiguracaoFiscalLoja.certificadoAtivoId`.
 * - NUNCA recebe/retorna senha ou `.pfx`; só metadados + referências (`blobRef`/`senhaRef`).
 * - NÃO liga `fiscalEnabled` nem ativa a loja fiscalmente — apenas o certificado. Não deleta.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { requireFiscalAdmin } from "@/lib/fiscal/guard-fiscal-admin"
import { recordFiscalAdminLog, type FiscalLogAcao } from "@/lib/fiscal/fiscal-log"
import { createEnvVault, validarCertificadoLoja, type CertificadoValidacao } from "@/lib/fiscal/vault"
import { resolveFiscalSecretProvider, revogarSegredosCertificado } from "@/lib/fiscal/vault"
import { CertificadoStatus, type Prisma } from "@/generated/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

function jsonError(msg: string, status: number) {
  return NextResponse.json({ ok: false, error: msg }, { status })
}

const patchSchema = z.object({
  ativo: z.boolean().optional(),
  /** Roda a validação do certificado sem ativar (atualiza status para refletir a realidade). */
  validar: z.boolean().optional(),
  /**
   * Revoga o certificado (GOAL-016C · ADR-0009 D8): status REVOGADO + inativo + destruição do
   * material no cofre (best-effort — no piloto, a remoção manual da env é reportada como
   * pendente). Documentos já autorizados permanecem; a revogação só afeta emissões futuras.
   */
  revogar: z.boolean().optional(),
  apelido: z.string().trim().max(120).optional(),
  blobRef: z.string().trim().max(300).nullable().optional(),
  senhaRef: z.string().trim().max(200).nullable().optional(),
})

function parseIsoDate(iso: string | null): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Resolve o certificado do cofre (EnvVault sobre `process.env`) e valida contra a loja. */
async function validarPeloCofre(
  storeId: string,
  blobRef: string | null,
  senhaRef: string | null,
): Promise<CertificadoValidacao> {
  const cfg = await prisma.configuracaoFiscalLoja.findUnique({
    where: { storeId },
    select: { cnpj: true },
  })
  const vault = createEnvVault()
  return validarCertificadoLoja({ vault, storeId, blobRef, senhaRef, cnpjLoja: cfg?.cnpj ?? null })
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const storeId = storeIdFromAssistecRequestForWrite(req)
  const acl = await requireFiscalAdmin(storeId)
  if (!acl.ok) return jsonError(acl.error, acl.status)

  const { id } = await ctx.params
  const certId = String(id ?? "").trim()
  if (!certId) return jsonError("Certificado não informado.", 400)

  let body: z.infer<typeof patchSchema>
  try {
    body = patchSchema.parse(await req.json())
  } catch {
    return jsonError("Dados inválidos.", 400)
  }

  try {
    await prismaEnsureConnected()
    // Escopo de loja: o certificado precisa pertencer à loja ativa (defesa multi-loja).
    const cert = await prisma.certificadoDigital.findFirst({
      where: { id: certId, storeId: acl.storeId },
      select: { id: true, apelido: true, ativo: true, status: true, blobRef: true, senhaRef: true },
    })
    if (!cert) return jsonError("Certificado não encontrado nesta unidade.", 404)

    // Alterações de referência/apelido valem para todos os fluxos abaixo.
    const refData: Prisma.CertificadoDigitalUpdateInput = {}
    if (typeof body.apelido === "string") refData.apelido = body.apelido.trim()
    if (body.blobRef !== undefined) refData.blobRef = (body.blobRef || "").trim() || null
    if (body.senhaRef !== undefined) refData.senhaRef = (body.senhaRef || "").trim() || null

    const effBlobRef = body.blobRef !== undefined ? ((body.blobRef || "").trim() || null) : cert.blobRef
    const effSenhaRef = body.senhaRef !== undefined ? ((body.senhaRef || "").trim() || null) : cert.senhaRef

    // ── Fluxo 1: ATIVAÇÃO (ato administrativo explícito) — validate-then-activate, fail-closed ──
    if (body.ativo === true) {
      const validacao = await validarPeloCofre(acl.storeId, effBlobRef, effSenhaRef)

      if (!validacao.ok) {
        // Fail-closed: NÃO ativa. Persiste refs e reflete o status real (INVALIDO/EXPIRADO).
        await prisma.certificadoDigital.update({
          where: { id: certId },
          data: { ...refData, status: CertificadoStatus[validacao.statusSugerido] },
        })
        await recordFiscalAdminLog({
          session: acl.session,
          storeId: acl.storeId,
          acao: "certificado.update",
          mensagem: `Validação reprovou o certificado (${cert.apelido || cert.id}) — ativação bloqueada`,
          detalhe: { certificadoId: certId, motivos: validacao.motivos, statusSugerido: validacao.statusSugerido },
        })
        return NextResponse.json(
          { ok: false, error: "Certificado reprovado na validação — ativação bloqueada (fail-closed).", validacao },
          { status: 422 },
        )
      }

      // Validado: ativa, torna único na loja e sincroniza metadados reais do certificado.
      await prisma.$transaction(async (tx) => {
        await tx.certificadoDigital.updateMany({
          where: { storeId: acl.storeId, NOT: { id: certId } },
          data: { ativo: false },
        })
        await tx.certificadoDigital.update({
          where: { id: certId },
          data: {
            ...refData,
            ativo: true,
            status: CertificadoStatus.ATIVO,
            titularCn: validacao.titularCn || undefined,
            cnpjTitular: validacao.cnpj.certificado || undefined,
            serialNumber: validacao.serialNumber || undefined,
            fingerprint: validacao.fingerprintSha1 || undefined,
            validoDe: parseIsoDate(validacao.validade.de),
            validoAte: parseIsoDate(validacao.validade.ate),
          },
        })
        const cfg = await tx.configuracaoFiscalLoja.findUnique({
          where: { storeId: acl.storeId },
          select: { storeId: true, certificadoAtivoId: true },
        })
        if (cfg) {
          await tx.configuracaoFiscalLoja.update({
            where: { storeId: acl.storeId },
            data: { certificadoAtivoId: certId },
          })
        }
      })

      await recordFiscalAdminLog({
        session: acl.session,
        storeId: acl.storeId,
        acao: "certificado.ativar",
        mensagem: `Certificado validado e ativado (${cert.apelido || cert.id})`,
        detalhe: {
          certificadoId: certId,
          validadeAte: validacao.validade.ate,
          cnpjConfere: validacao.cnpj.confere,
          fingerprint: validacao.fingerprintSha1,
        },
      })

      const updated = await prisma.certificadoDigital.findUnique({
        where: { id: certId },
        select: { id: true, apelido: true, ativo: true, status: true, validoAte: true },
      })
      return NextResponse.json({ ok: true, certificado: updated, validacao })
    }

    // ── Fluxo 2: REVOGAÇÃO (GOAL-016C) — bloqueia imediatamente, depois destrói o material ──────
    if (body.revogar === true) {
      if (cert.status === "REVOGADO") {
        return jsonError("Certificado já está revogado.", 409)
      }
      // Bloqueio imediato: a linha deixa de servir novas emissões ANTES de qualquer limpeza.
      await prisma.$transaction(async (tx) => {
        await tx.certificadoDigital.update({
          where: { id: certId },
          data: { ...refData, status: CertificadoStatus.REVOGADO, ativo: false },
        })
        const cfg = await tx.configuracaoFiscalLoja.findUnique({
          where: { storeId: acl.storeId },
          select: { storeId: true, certificadoAtivoId: true },
        })
        if (cfg && cfg.certificadoAtivoId === certId) {
          await tx.configuracaoFiscalLoja.update({
            where: { storeId: acl.storeId },
            data: { certificadoAtivoId: null },
          })
        }
      })

      // Destruição do material no cofre (best-effort reportado — no piloto, a remoção da env é manual).
      const provider = resolveFiscalSecretProvider()
      const revogacaoSegredos = provider.vault
        ? await revogarSegredosCertificado({
            vault: provider.vault,
            storeId: acl.storeId,
            blobRef: effBlobRef,
            senhaRef: effSenhaRef,
          })
        : { revogadas: [], pendentes: [effBlobRef, effSenhaRef].filter((r): r is string => Boolean(r)) }
      const revogacaoStatus = revogacaoSegredos.pendentes.length > 0 ? "pendente_provisionamento" : "concluida"

      await recordFiscalAdminLog({
        session: acl.session,
        storeId: acl.storeId,
        acao: "certificado.revogar",
        mensagem: `Certificado revogado (${cert.apelido || cert.id}) — emissões futuras bloqueadas`,
        detalhe: { certificadoId: certId, revogacaoSegredos: revogacaoStatus },
      })
      await recordFiscalAdminLog({
        session: acl.session,
        storeId: acl.storeId,
        acao: "secret.revoke",
        mensagem: `Material do certificado revogado no cofre (${cert.apelido || cert.id})`,
        detalhe: {
          certificadoId: certId,
          provider: provider.provider,
          revogacaoSegredos: revogacaoStatus,
          refsPendentes: revogacaoSegredos.pendentes.length,
        },
      })

      const updated = await prisma.certificadoDigital.findUnique({
        where: { id: certId },
        select: { id: true, apelido: true, ativo: true, status: true },
      })
      return NextResponse.json({ ok: true, certificado: updated, revogacaoSegredos: revogacaoStatus })
    }

    // ── Fluxo 3: VALIDAÇÃO sem ativar ──────────────────────────────────────────────────────────
    if (body.validar === true) {
      const validacao = await validarPeloCofre(acl.storeId, effBlobRef, effSenhaRef)
      // Passou ⇒ mantém pendente (aguardando ativação explícita); falhou ⇒ reflete o status real.
      const novoStatus = validacao.ok ? CertificadoStatus.PENDENTE_VALIDACAO : CertificadoStatus[validacao.statusSugerido]
      await prisma.certificadoDigital.update({
        where: { id: certId },
        data: { ...refData, status: novoStatus },
      })
      await recordFiscalAdminLog({
        session: acl.session,
        storeId: acl.storeId,
        acao: "certificado.update",
        mensagem: `Certificado validado (${cert.apelido || cert.id}): ${validacao.ok ? "apto" : validacao.motivos.join(",")}`,
        detalhe: { certificadoId: certId, ok: validacao.ok, motivos: validacao.motivos },
      })
      const updated = await prisma.certificadoDigital.findUnique({
        where: { id: certId },
        select: { id: true, apelido: true, ativo: true, status: true, validoAte: true },
      })
      return NextResponse.json({ ok: true, validado: validacao.ok, validacao, certificado: updated })
    }

    // ── Fluxo 4: DESATIVAÇÃO / atualização de metadados (sem validação) ─────────────────────────
    let acao: FiscalLogAcao = "certificado.update"
    await prisma.$transaction(async (tx) => {
      const data: Prisma.CertificadoDigitalUpdateInput = { ...refData }
      if (body.ativo === false) {
        data.ativo = false
        acao = "certificado.desativar"
      }
      await tx.certificadoDigital.update({ where: { id: certId }, data })

      if (body.ativo === false) {
        const cfg = await tx.configuracaoFiscalLoja.findUnique({
          where: { storeId: acl.storeId },
          select: { storeId: true, certificadoAtivoId: true },
        })
        if (cfg && cfg.certificadoAtivoId === certId) {
          await tx.configuracaoFiscalLoja.update({
            where: { storeId: acl.storeId },
            data: { certificadoAtivoId: null },
          })
        }
      }
    })

    await recordFiscalAdminLog({
      session: acl.session,
      storeId: acl.storeId,
      acao,
      mensagem: `Certificado ${acao.replace("certificado.", "")} (${cert.apelido || cert.id})`,
      detalhe: { certificadoId: certId },
    })

    const updated = await prisma.certificadoDigital.findUnique({
      where: { id: certId },
      select: { id: true, apelido: true, ativo: true, status: true },
    })
    return NextResponse.json({ ok: true, certificado: updated })
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Falha ao atualizar certificado", 500)
  }
}
