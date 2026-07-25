/**
 * Onboarding fiscal — CONFIRMAÇÃO e gravação (GOAL-016B · item 6).
 *
 * Só aqui algo é persistido, e apenas depois que o usuário confirmou a prévia:
 *  1. Reconcilia de novo NO SERVIDOR (o veredito não vem do cliente) e recusa se houver bloqueio.
 *  2. Grava a identidade fiscal pelo MESMO serviço da rota oficial (`normalizeFiscalConfigForUpsert`),
 *     preservando ambiente, modelo, provider, CSC e `fiscalEnabled` — nada disso é alterado aqui.
 *  3. Registra o certificado no início do fluxo validate-then-activate: `PENDENTE_VALIDACAO`,
 *     `ativo=false`, SEM `blobRef`/`senhaRef` (a custódia do `.pfx`/senha é provisionada no cofre).
 *  4. Audita tudo em `FiscalLog`.
 *
 * NÃO liga `fiscalEnabled`, NÃO troca provider, NÃO cria CSC e NÃO transmite nada à SEFAZ.
 * Os metadados do certificado enviados aqui são DECLARADOS — a fonte autoritativa continua sendo
 * a validação do `.pfx` real pelo cofre, no passo de ativação, que os sobrescreve.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { requireFiscalAdmin } from "@/lib/fiscal/guard-fiscal-admin"
import { recordFiscalAdminLog } from "@/lib/fiscal/fiscal-log"
import {
  normalizeFiscalConfigForUpsert,
  sanitizeFiscalConfigForClient,
  type FiscalConfigRow,
} from "@/lib/fiscal/fiscal-identity-service"
import {
  isValidCep,
  isValidCnae,
  isValidCnpj,
  isValidCodigoMunicipioIbge,
  isValidInscricaoEstadual,
  isValidRegimeTributario,
  isValidUf,
} from "@/lib/fiscal/fiscal-validators"
import {
  bloqueiosDoCertificadoDeclarado,
  montarPayloadIdentidadeConfirmada,
  reconciliarOnboarding,
  resolveFiscalIdentityLookupProvider,
} from "@/lib/fiscal/certificate"
import { carregarContextoOnboarding } from "@/lib/fiscal/certificate/onboarding-context"
import type { CampoIdentidadeFiscal, CertificadoExtraido } from "@/lib/fiscal/certificate/onboarding-types"
import type { Prisma } from "@/generated/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

function jsonError(msg: string, status: number) {
  return NextResponse.json({ ok: false, error: msg }, { status })
}

/**
 * Metadados do certificado lidos na etapa anterior. Note o que NÃO existe aqui: senha, bytes do
 * `.pfx`, PEM ou qualquer referência a segredo. O schema recusa o envio desses campos.
 */
const certificadoSchema = z.object({
  cnpj: z.string().trim().max(20).nullable(),
  titularCn: z.string().trim().max(300).default(""),
  subject: z.string().trim().max(600).default(""),
  nomeEmpresarial: z.string().trim().max(300).default(""),
  email: z.string().trim().max(200).nullable().default(null),
  validoDe: z.string().trim().max(40).nullable().default(null),
  validoAte: z.string().trim().max(40).nullable().default(null),
  autoridadeCertificadora: z.string().trim().max(300).default(""),
  serialNumber: z.string().trim().max(120).default(""),
  fingerprintSha1: z.string().trim().max(200).default(""),
  cadeiaDisponivel: z.boolean().default(false),
  vigente: z.boolean().default(false),
  chavePublicaRsaBits: z.number().int().min(0).max(16384).default(0),
})

const camposSchema = z
  .object({
    razaoSocial: z.string().trim().max(200).optional(),
    nomeFantasia: z.string().trim().max(200).optional(),
    cnpj: z.string().trim().max(20).optional(),
    inscricaoEstadual: z.string().trim().max(20).optional(),
    inscricaoMunicipal: z.string().trim().max(20).optional(),
    cnae: z.string().trim().max(10).optional(),
    regimeTributario: z.string().trim().max(40).optional(),
    logradouro: z.string().trim().max(200).optional(),
    numero: z.string().trim().max(20).optional(),
    complemento: z.string().trim().max(120).optional(),
    bairro: z.string().trim().max(120).optional(),
    codigoMunicipioIbge: z.string().trim().max(10).optional(),
    municipio: z.string().trim().max(120).optional(),
    uf: z.string().trim().max(2).optional(),
    cep: z.string().trim().max(12).optional(),
    fone: z.string().trim().max(20).optional(),
    email: z.string().trim().max(200).optional(),
  })
  .strict()

const bodySchema = z.object({
  certificado: certificadoSchema,
  /** Valores confirmados/digitados pelo usuário na tela de confirmação. */
  campos: camposSchema.default({}),
  /** Apelido interno do certificado na lista da loja. */
  apelido: z.string().trim().max(120).optional(),
})

function parseIsoDate(iso: string | null | undefined): Date | null {
  const v = String(iso ?? "").trim()
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function POST(req: Request) {
  const storeId = storeIdFromAssistecRequestForWrite(req)
  const acl = await requireFiscalAdmin(storeId)
  if (!acl.ok) return jsonError(acl.error, acl.status)

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await req.json())
  } catch {
    return jsonError("Dados inválidos.", 400)
  }

  const extraido: CertificadoExtraido = {
    cnpj: body.certificado.cnpj ? body.certificado.cnpj.replace(/\D+/g, "") : null,
    titularCn: body.certificado.titularCn,
    subject: body.certificado.subject,
    nomeEmpresarial: body.certificado.nomeEmpresarial,
    email: body.certificado.email,
    validoDe: body.certificado.validoDe,
    validoAte: body.certificado.validoAte,
    autoridadeCertificadora: body.certificado.autoridadeCertificadora,
    serialNumber: body.certificado.serialNumber,
    fingerprintSha1: body.certificado.fingerprintSha1.toLowerCase(),
    cadeiaDisponivel: body.certificado.cadeiaDisponivel,
    vigente: body.certificado.vigente,
    chavePublicaRsaBits: body.certificado.chavePublicaRsaBits,
  }

  try {
    await prismaEnsureConnected()
    const contexto = await carregarContextoOnboarding({
      storeId: acl.storeId,
      fingerprint: extraido.fingerprintSha1,
    })

    const lookup = await resolveFiscalIdentityLookupProvider().consultar({
      cnpj: extraido.cnpj ?? "",
      uf: contexto.fiscalLoja?.uf || contexto.store?.endereco.estado || "",
    })

    const manual = body.campos as Partial<Record<CampoIdentidadeFiscal, string>>

    // Reconciliação REFEITA no servidor — o cliente não decide se pode gravar. Os bloqueios do
    // certificado são re-derivados dos metadados: omiti-los no payload não libera a gravação.
    const preview = reconciliarOnboarding({
      storeId: acl.storeId,
      extraido,
      bloqueiosInspecao: bloqueiosDoCertificadoDeclarado(extraido),
      fiscalLoja: contexto.fiscalLoja,
      store: contexto.store,
      lookup,
      certificados: contexto.certificados,
      manual,
    })

    if (!preview.podeConfirmar) {
      await recordFiscalAdminLog({
        session: acl.session,
        storeId: acl.storeId,
        acao: "certificado.onboarding.confirmar",
        mensagem: "Confirmação de onboarding bloqueada",
        detalhe: {
          fingerprint: extraido.fingerprintSha1,
          bloqueios: preview.bloqueios.map((b) => b.codigo),
        },
      })
      return NextResponse.json(
        { ok: false, error: preview.bloqueios[0]?.mensagem ?? "Confirmação bloqueada.", bloqueios: preview.bloqueios },
        { status: 422 },
      )
    }

    const payload = montarPayloadIdentidadeConfirmada(preview.campos, manual)

    // Validações semânticas — mesmas regras da rota oficial de identidade fiscal.
    if (payload.cnpj && !isValidCnpj(payload.cnpj)) return jsonError("CNPJ inválido.", 400)
    if (!isValidInscricaoEstadual(payload.inscricaoEstadual)) return jsonError("Inscrição estadual inválida.", 400)
    if (payload.uf && !isValidUf(payload.uf)) return jsonError("UF inválida.", 400)
    if (!isValidCep(payload.cep)) return jsonError("CEP inválido (use 8 dígitos).", 400)
    if (!isValidCodigoMunicipioIbge(payload.codigoMunicipioIbge)) return jsonError("Código IBGE inválido (7 dígitos).", 400)
    if (!isValidCnae(payload.cnae)) return jsonError("CNAE inválido (7 dígitos).", 400)
    if (payload.regimeTributario && !isValidRegimeTributario(payload.regimeTributario))
      return jsonError("Regime tributário inválido.", 400)

    const prev = contexto.configRow
    // Preserva o que o onboarding NÃO pode mexer: ambiente, modelo, provider e CSC.
    const { data } = normalizeFiscalConfigForUpsert(
      {
        ...payload,
        ambiente: prev?.ambiente,
        modeloFiscal: prev?.modeloFiscal,
        provider: prev?.provider,
        cscId: prev?.cscId,
        cscTokenRef: prev?.cscTokenRef ?? null,
      },
      prev?.providerConfig ?? null,
    )
    const { providerConfig, ...rest } = data
    const writeData = { ...rest, providerConfig: providerConfig as Prisma.InputJsonValue }

    // `fiscalEnabled` NÃO entra no upsert → permanece false no create e intocado no update.
    const saved = (await prisma.configuracaoFiscalLoja.upsert({
      where: { storeId: acl.storeId },
      create: { storeId: acl.storeId, ...writeData },
      update: { ...writeData },
    })) as FiscalConfigRow

    // Certificado: entra no fluxo validate-then-activate (pendente, inativo, sem refs de segredo).
    const certMetadata = {
      apelido: (body.apelido || extraido.nomeEmpresarial || "Certificado A1").slice(0, 120),
      tipo: "A1",
      titularCn: extraido.titularCn,
      cnpjTitular: extraido.cnpj ?? "",
      serialNumber: extraido.serialNumber,
      fingerprint: extraido.fingerprintSha1,
      validoDe: parseIsoDate(extraido.validoDe),
      validoAte: parseIsoDate(extraido.validoAte),
    }

    const existente = extraido.fingerprintSha1
      ? await prisma.certificadoDigital.findFirst({
          where: { storeId: acl.storeId, fingerprint: extraido.fingerprintSha1 },
          select: { id: true, ativo: true },
        })
      : null

    const certificado = existente
      ? await prisma.certificadoDigital.update({
          where: { id: existente.id },
          data: certMetadata,
          select: { id: true, apelido: true, status: true, ativo: true, validoAte: true },
        })
      : await prisma.certificadoDigital.create({
          data: {
            storeId: acl.storeId,
            ...certMetadata,
            status: "PENDENTE_VALIDACAO",
            ativo: false,
            // Custódia do segredo é provisionada no cofre — nada de referência falsa aqui.
            blobRef: null,
            senhaRef: null,
            uploadedBy: acl.session.user?.id ?? null,
          },
          select: { id: true, apelido: true, status: true, ativo: true, validoAte: true },
        })

    await recordFiscalAdminLog({
      session: acl.session,
      storeId: acl.storeId,
      acao: "certificado.onboarding.confirmar",
      mensagem: `Identidade fiscal preenchida pelo certificado A1 (${certificado.apelido || certificado.id})`,
      detalhe: {
        certificadoId: certificado.id,
        fingerprint: extraido.fingerprintSha1,
        cnpjConfere: preview.reconciliacao.confere,
        origens: preview.campos.map((c) => `${c.campo}:${c.origem}`),
        pendencias: preview.pendencias,
        lookup: preview.lookup.status,
        fiscalEnabled: saved.fiscalEnabled,
        certificadoReaproveitado: Boolean(existente),
      },
    })

    return NextResponse.json({
      ok: true,
      config: sanitizeFiscalConfigForClient(saved),
      certificado,
      custodia: preview.custodia,
      pendencias: preview.pendencias,
      fiscalEnabled: saved.fiscalEnabled,
      transmissao: "nenhuma",
    })
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Falha ao confirmar o onboarding fiscal", 500)
  }
}
