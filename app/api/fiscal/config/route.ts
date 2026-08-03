/**
 * Identidade fiscal por loja — GET/PUT da `ConfiguracaoFiscalLoja` (GOAL_002).
 *
 * - Apenas ADMIN (`requireFiscalAdmin`), multi-loja via header `x-assistec-loja-id`.
 * - DORMENTE: `fiscalEnabled` NUNCA é ligado aqui (default/atual = false).
 * - Segredo só por referência: a rota não aceita nem retorna o CSC token em claro.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { storeIdFromAssistecRequestForRead, storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { requireFiscalAdmin } from "@/lib/fiscal/guard-fiscal-admin"
import {
  normalizeFiscalConfigForUpsert,
  sanitizeFiscalConfigForClient,
  type FiscalConfigRow,
} from "@/lib/fiscal/fiscal-identity-service"
import {
  isValidAmbiente,
  isValidCep,
  isValidCnae,
  isValidCnpj,
  isValidCodigoMunicipioIbge,
  isValidInscricaoEstadual,
  isValidModeloFiscal,
  isValidRegimeTributario,
  isValidUf,
} from "@/lib/fiscal/fiscal-validators"
import { recordFiscalAdminLog } from "@/lib/fiscal/fiscal-log"
import { resolveFiscalSecretProvider } from "@/lib/fiscal/vault"
import { AmbienteFiscal, ModeloFiscal, type Prisma } from "@/generated/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

function jsonError(msg: string, status: number) {
  return NextResponse.json({ ok: false, error: msg }, { status })
}

const putSchema = z.object({
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
  cscId: z.string().trim().max(120).optional(),
  cscTokenRef: z.string().trim().max(200).nullable().optional(),
  ambiente: z.string().trim().max(20).optional(),
  modeloFiscal: z.string().trim().max(10).optional(),
  provider: z.string().trim().max(40).optional(),
  serieFiscalPadrao: z.number().int().min(1).max(999).optional(),
})

async function loadConfigRow(storeId: string): Promise<FiscalConfigRow | null> {
  return (await prisma.configuracaoFiscalLoja.findUnique({
    where: { storeId },
  })) as FiscalConfigRow | null
}

export async function GET(req: Request) {
  const storeId = storeIdFromAssistecRequestForRead(req)
  const acl = await requireFiscalAdmin(storeId)
  if (!acl.ok) return jsonError(acl.error, acl.status)
  try {
    await prismaEnsureConnected()
    const [row, series, certificados] = await Promise.all([
      loadConfigRow(acl.storeId),
      prisma.serieFiscal.findMany({
        where: { storeId: acl.storeId },
        select: { id: true, modelo: true, ambiente: true, serie: true, proximoNumero: true, ativo: true },
        orderBy: [{ modelo: "asc" }, { serie: "asc" }],
      }),
      prisma.certificadoDigital.findMany({
        where: { storeId: acl.storeId },
        select: {
          id: true, apelido: true, tipo: true, titularCn: true, cnpjTitular: true,
          serialNumber: true, fingerprint: true, validoDe: true, validoAte: true,
          status: true, ativo: true, blobRef: true, senhaRef: true, createdAt: true, updatedAt: true,
        },
        orderBy: [{ ativo: "desc" }, { createdAt: "desc" }],
      }),
    ])
    const provider = resolveFiscalSecretProvider()
    return NextResponse.json({
      ok: true,
      config: sanitizeFiscalConfigForClient(row),
      // Bloco `cofre` (GOAL-016C): provider do Secret Provider + disponibilidade/capacidades.
      cofre: {
        provider: provider.provider,
        disponivel: provider.availability.disponivel,
        capacidades: provider.availability.capacidades,
        mensagem: provider.availability.mensagem,
      },
      series: series.map((s) => ({
        id: s.id, modelo: s.modelo, ambiente: s.ambiente, serie: s.serie,
        proximoNumero: s.proximoNumero, ativo: s.ativo,
      })),
      certificados: certificados.map((c) => ({
        id: c.id, apelido: c.apelido, tipo: c.tipo, titularCn: c.titularCn,
        cnpjTitular: c.cnpjTitular, serialNumber: c.serialNumber, fingerprint: c.fingerprint,
        validoDe: c.validoDe ? c.validoDe.toISOString() : null,
        validoAte: c.validoAte ? c.validoAte.toISOString() : null,
        status: c.status, ativo: c.ativo,
        // refs indicam configuração; nunca o segredo
        blobConfigured: Boolean((c.blobRef || "").trim()),
        senhaConfigured: Boolean((c.senhaRef || "").trim()),
        createdAt: c.createdAt.toISOString(),
        /** Última alteração da linha (validação, ativação, rotação, revogação). */
        atualizadoEm: c.updatedAt.toISOString(),
      })),
    })
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Falha ao carregar identidade fiscal", 500)
  }
}

export async function PUT(req: Request) {
  const storeId = storeIdFromAssistecRequestForWrite(req)
  const acl = await requireFiscalAdmin(storeId)
  if (!acl.ok) return jsonError(acl.error, acl.status)

  let body: z.infer<typeof putSchema>
  try {
    body = putSchema.parse(await req.json())
  } catch {
    return jsonError("Dados inválidos.", 400)
  }

  // Validações semânticas (campos opcionais; valida quando presente/não-vazio)
  if (body.cnpj && body.cnpj.trim() && !isValidCnpj(body.cnpj)) return jsonError("CNPJ inválido.", 400)
  if (!isValidInscricaoEstadual(body.inscricaoEstadual)) return jsonError("Inscrição estadual inválida.", 400)
  if (body.uf && body.uf.trim() && !isValidUf(body.uf)) return jsonError("UF inválida.", 400)
  if (!isValidCep(body.cep)) return jsonError("CEP inválido (use 8 dígitos).", 400)
  if (!isValidCodigoMunicipioIbge(body.codigoMunicipioIbge)) return jsonError("Código IBGE inválido (7 dígitos).", 400)
  if (!isValidCnae(body.cnae)) return jsonError("CNAE inválido (7 dígitos).", 400)
  if (body.regimeTributario && body.regimeTributario.trim() && !isValidRegimeTributario(body.regimeTributario))
    return jsonError("Regime tributário inválido.", 400)
  if (body.ambiente && body.ambiente.trim() && !isValidAmbiente(body.ambiente))
    return jsonError("Ambiente inválido.", 400)
  if (body.modeloFiscal && body.modeloFiscal.trim() && !isValidModeloFiscal(body.modeloFiscal))
    return jsonError("Modelo fiscal inválido.", 400)

  try {
    await prismaEnsureConnected()
    const prev = await loadConfigRow(acl.storeId)
    const { data } = normalizeFiscalConfigForUpsert(body, prev?.providerConfig ?? null)
    const { providerConfig, ...rest } = data
    const writeData = { ...rest, providerConfig: providerConfig as Prisma.InputJsonValue }

    // fiscalEnabled NÃO entra no upsert → permanece false (default no create; intacto no update).
    const saved = (await prisma.configuracaoFiscalLoja.upsert({
      where: { storeId: acl.storeId },
      create: { storeId: acl.storeId, ...writeData },
      update: { ...writeData },
    })) as FiscalConfigRow

    // Série padrão (dormente): garante a linha; NÃO reseta proximoNumero se já existe.
    if (typeof body.serieFiscalPadrao === "number") {
      const modelo = data.modeloFiscal as ModeloFiscal
      const ambiente = data.ambiente as AmbienteFiscal
      const existing = await prisma.serieFiscal.findUnique({
        where: {
          storeId_modelo_serie_ambiente: {
            storeId: acl.storeId, modelo, serie: body.serieFiscalPadrao, ambiente,
          },
        },
        select: { id: true },
      })
      if (!existing) {
        await prisma.serieFiscal.create({
          data: {
            storeId: acl.storeId, modelo, ambiente, serie: body.serieFiscalPadrao,
            descricao: "Série padrão (configurada na Identidade Fiscal)",
          },
        })
      }
    }

    await recordFiscalAdminLog({
      session: acl.session,
      storeId: acl.storeId,
      acao: "config.update",
      mensagem: "Identidade fiscal atualizada",
      detalhe: { ambiente: data.ambiente, modeloFiscal: data.modeloFiscal, regime: data.regimeTributario },
    })

    return NextResponse.json({ ok: true, config: sanitizeFiscalConfigForClient(saved) })
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Falha ao salvar identidade fiscal", 500)
  }
}
