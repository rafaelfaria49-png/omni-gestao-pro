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
   * Revoga o certificado (GOAL-016C · ADR-0009 D8). São DOIS atos distintos, nunca confundidos:
   *  - revogação LÓGICA (sempre aplicada): status REVOGADO + `ativo:false` ⇒ fail-closed imediato
   *    para assinatura/emissão;
   *  - remoção FÍSICA do material no cofre (condicional): só quando o provider revoga E nenhuma
   *    outra linha viva da unidade depende do mesmo material. A resposta diz qual dos dois ocorreu.
   * Documentos já autorizados permanecem; a revogação só afeta emissões futuras.
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
      // Revogação é TERMINAL — mesma regra já aplicada na custódia e na rotação. Sem esta guarda a
      // revogação lógica não seria durável: bastaria um PATCH `{ativo:true}` para ressuscitar a
      // linha e voltar a assinar com material revogado.
      if (cert.status === "REVOGADO") {
        return NextResponse.json(
          {
            ok: false,
            error: "Certificado revogado não pode ser reativado (estado terminal). Registre um novo certificado.",
            codigo: "certificado_revogado",
          },
          { status: 409 },
        )
      }
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

    // ── Fluxo 2: REVOGAÇÃO (GOAL-016C) — bloqueio lógico imediato; remoção física condicional ───
    if (body.revogar === true) {
      if (cert.status === "REVOGADO") {
        return jsonError("Certificado já está revogado.", 409)
      }
      // Revogação ignora overrides de ref do payload: vale SEMPRE a referência da linha (nunca se
      // revoga material que não é deste certificado, nem se reescreve ref numa linha terminal).
      await prisma.$transaction(async (tx) => {
        await tx.certificadoDigital.update({
          where: { id: certId },
          data: { status: CertificadoStatus.REVOGADO, ativo: false },
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

      /**
       * A revogação acima é LÓGICA (banco) e já basta para o fail-closed: `REVOGADO` + `ativo:false`
       * bloqueia assinatura/emissão futuras. A REMOÇÃO FÍSICA do material no cofre é um segundo ato,
       * separado e opcional — e nunca é afirmada sem ter acontecido.
       *
       * A capacidade do provider é consultada para RELATAR com honestidade, JAMAIS para bloquear a
       * revogação: bloquear deixaria o admin sem meio de derrubar um certificado comprometido.
       */
      const refsDaLinha = [cert.blobRef, cert.senhaRef]
        .map((r) => String(r ?? "").trim())
        .filter((r) => r.length > 0)

      /**
       * Outra linha NÃO revogada da unidade ainda aponta para o mesmo material? Em backend de
       * referência estável (slot canônico por loja) isso é o caso NORMAL — destruir o material, ou
       * mandar o operador apagar a env, derrubaria o certificado em uso. Sem essa checagem, nenhuma
       * orientação de remoção pode ser emitida.
       */
      const refCompartilhada =
        refsDaLinha.length > 0 &&
        (await prisma.certificadoDigital.count({
          where: {
            storeId: acl.storeId,
            id: { not: certId },
            status: { not: CertificadoStatus.REVOGADO },
            OR: refsDaLinha.flatMap((ref) => [{ blobRef: ref }, { senhaRef: ref }]),
          },
        })) > 0

      const provider = resolveFiscalSecretProvider()
      const providerRevoga = Boolean(provider.vault) && provider.availability.capacidades.revogacao

      type RemocaoFisica =
        | "nao_aplicavel" // a linha não tinha material referenciado
        | "nao_executada_ref_compartilhada" // outra linha viva usa o mesmo material
        | "nao_executada_provider_sem_revogacao" // piloto: provisionamento manual
        | "pendente" // provider aceitou, mas não removeu tudo
        | "executada"

      let remocaoFisica: RemocaoFisica = "nao_aplicavel"
      if (refsDaLinha.length > 0) {
        if (refCompartilhada) {
          remocaoFisica = "nao_executada_ref_compartilhada"
        } else if (!providerRevoga || !provider.vault) {
          remocaoFisica = "nao_executada_provider_sem_revogacao"
        } else {
          const rev = await revogarSegredosCertificado({
            vault: provider.vault,
            storeId: acl.storeId,
            blobRef: cert.blobRef,
            senhaRef: cert.senhaRef,
          })
          remocaoFisica = rev.pendentes.length > 0 ? "pendente" : "executada"
        }
      }

      /** Orientação sanitizada — NUNCA nomeia a referência nem manda apagar secret às cegas. */
      const ORIENTACAO: Record<RemocaoFisica, string> = {
        nao_aplicavel: "O certificado foi revogado. Não havia material sob custódia vinculado a esta linha.",
        nao_executada_ref_compartilhada:
          "O certificado foi revogado e não emite mais. O material NÃO foi removido do cofre porque outro certificado ativo desta unidade ainda depende dele — não remova o secret manualmente.",
        nao_executada_provider_sem_revogacao:
          "O certificado foi revogado e não emite mais. Este ambiente não remove material do cofre em runtime: a remoção física segue por provisionamento manual, sob conferência de quais certificados da unidade ainda usam o material.",
        pendente:
          "O certificado foi revogado e não emite mais. A remoção do material do cofre ficou parcialmente pendente.",
        executada: "O certificado foi revogado e o material correspondente foi removido do cofre.",
      }

      await recordFiscalAdminLog({
        session: acl.session,
        storeId: acl.storeId,
        acao: "certificado.revogar",
        mensagem: `Certificado revogado (${cert.apelido || cert.id}) — emissões futuras bloqueadas`,
        detalhe: { certificadoId: certId, remocaoFisica },
      })
      await recordFiscalAdminLog({
        session: acl.session,
        storeId: acl.storeId,
        acao: "secret.revoke",
        mensagem:
          remocaoFisica === "executada"
            ? `Material do certificado removido do cofre (${cert.apelido || cert.id})`
            : `Revogação lógica aplicada; remoção física do material NÃO executada (${cert.apelido || cert.id})`,
        detalhe: {
          certificadoId: certId,
          provider: provider.provider,
          providerRevoga,
          remocaoFisica,
          refCompartilhada,
          refsVinculadas: refsDaLinha.length,
        },
      })

      const updated = await prisma.certificadoDigital.findUnique({
        where: { id: certId },
        select: { id: true, apelido: true, ativo: true, status: true },
      })
      return NextResponse.json({
        ok: true,
        certificado: updated,
        revogacao: {
          logica: "aplicada",
          remocaoFisica,
          refCompartilhada,
          orientacao: ORIENTACAO[remocaoFisica],
        },
      })
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
    // Erro interno NUNCA vaza para o cliente: mensagem do Prisma, stack, referência de cofre,
    // senha ou PFX ficam só no log server-side. O cliente recebe texto fixo + código estável.
    console.error(
      "[fiscal:certificado:patch] erro inesperado:",
      e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : "erro desconhecido",
    )
    return NextResponse.json(
      { ok: false, error: "Falha ao atualizar certificado.", codigo: "erro_inesperado" },
      { status: 500 },
    )
  }
}
