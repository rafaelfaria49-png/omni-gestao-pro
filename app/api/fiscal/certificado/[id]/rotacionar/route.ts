/**
 * Rotação do certificado A1 (GOAL-016C · ADR-0014 §2.1).
 *
 * Recebe o NOVO `.pfx`+senha em multipart e executa a rotação segura:
 *  1. valida o novo certificado EM MEMÓRIA (inválido/vencido/senha errada ⇒ 422 e NADA muda);
 *  2. grava a nova versão no cofre — as referências anteriores seguem intactas e servindo;
 *  3. troca o ponteiro no banco em ÚNICA atualização (refs + metadados reais do novo certificado);
 *     se a troca falhar, a versão nova é descartada do cofre e a anterior permanece (fail-closed);
 *  4. confirmada a troca, revoga as referências anteriores (best-effort reportado).
 *
 * O status/ativo da linha é preservado: um certificado ATIVO continua ATIVO após a rotação porque
 * a nova versão já passou pela MESMA validação exigida na ativação (vigência, RSA ≥ 2048, cadeia,
 * CNPJ presente) — e o CNPJ do novo certificado precisa conferir com a unidade.
 *
 * Segurança: resposta, erros e auditoria NUNCA carregam `.pfx`, senha, PEM ou chave. NÃO liga
 * `fiscalEnabled` e NÃO transmite nada à SEFAZ.
 */
import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { requireFiscalAdmin } from "@/lib/fiscal/guard-fiscal-admin"
import { recordFiscalAdminLog } from "@/lib/fiscal/fiscal-log"
import { onlyDigits } from "@/lib/fiscal/fiscal-validators"
import { PFX_TAMANHO_MAXIMO_BYTES, bloqueio, validarArquivoPfx } from "@/lib/fiscal/certificate"
import type { OnboardingBloqueio } from "@/lib/fiscal/certificate/onboarding-types"
import { resolveFiscalSecretProvider, rotacionarCertificadoA1 } from "@/lib/fiscal/vault"
import { zeroBuffer } from "@/lib/fiscal/vault/pkcs12-loader"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const MULTIPART_OVERHEAD_BYTES = 64 * 1024

function jsonError(msg: string, status: number) {
  return NextResponse.json({ ok: false, error: msg }, { status })
}

function jsonBloqueado(bloqueios: OnboardingBloqueio[], status: number) {
  return NextResponse.json({ ok: false, error: bloqueios[0]?.mensagem ?? "Certificado recusado.", bloqueios }, { status })
}

function parseIsoDate(iso: string | null): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const storeId = storeIdFromAssistecRequestForWrite(req)
  const acl = await requireFiscalAdmin(storeId)
  if (!acl.ok) return jsonError(acl.error, acl.status)

  const { id } = await ctx.params
  const certId = String(id ?? "").trim()
  if (!certId) return jsonError("Certificado não informado.", 400)

  const contentLength = Number(req.headers.get("content-length") ?? 0)
  if (Number.isFinite(contentLength) && contentLength > PFX_TAMANHO_MAXIMO_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return jsonBloqueado([bloqueio("arquivo_muito_grande")], 413)
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return jsonError("Envio inválido — use multipart/form-data.", 400)
  }

  const arquivo = form.get("certificado")
  const senha = String(form.get("senha") ?? "")
  if (!(arquivo instanceof File)) return jsonBloqueado([bloqueio("arquivo_ausente")], 400)
  if (!senha) return jsonBloqueado([bloqueio("senha_ausente")], 400)

  const bloqueiosArquivo = validarArquivoPfx({
    nome: arquivo.name,
    tamanho: arquivo.size,
    contentType: arquivo.type,
  })
  if (bloqueiosArquivo.length > 0) {
    return jsonBloqueado(bloqueiosArquivo, bloqueiosArquivo[0]!.codigo === "arquivo_muito_grande" ? 413 : 415)
  }

  const provider = resolveFiscalSecretProvider()
  if (!provider.vault || !provider.availability.capacidades.rotacao) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "A rotação automática não está disponível neste ambiente. A troca do certificado segue por provisionamento manual do cofre (fail-closed).",
        codigo: "custodia_indisponivel",
        custodia: { provider: provider.provider, disponivel: false, rotacao: false },
      },
      { status: 503 },
    )
  }
  const vault = provider.vault

  let pfx: Buffer | null = null
  try {
    await prismaEnsureConnected()
    const cert = await prisma.certificadoDigital.findFirst({
      where: { id: certId, storeId: acl.storeId },
      select: { id: true, apelido: true, ativo: true, status: true, blobRef: true, senhaRef: true },
    })
    if (!cert) return jsonError("Certificado não encontrado nesta unidade.", 404)
    if (cert.status === "REVOGADO") return jsonError("Certificado revogado não pode ser rotacionado — registre um novo.", 409)

    const cfg = await prisma.configuracaoFiscalLoja.findUnique({
      where: { storeId: acl.storeId },
      select: { cnpj: true },
    })

    pfx = Buffer.from(await arquivo.arrayBuffer())

    /** Motivo capturado dentro da confirmação (ex.: CNPJ divergente) para resposta precisa. */
    let motivoTrocaRecusada: string | null = null

    const resultado = await rotacionarCertificadoA1({
      vault,
      storeId: acl.storeId,
      novoPfx: pfx,
      novaSenha: senha,
      refsAnteriores: { blobRef: cert.blobRef, senhaRef: cert.senhaRef },
      confirmarTroca: async (novasRefs, extraido) => {
        // CNPJ do novo certificado precisa conferir com a unidade (quando a loja tem CNPJ).
        const cnpjLoja = onlyDigits(cfg?.cnpj)
        if (extraido.cnpj && cnpjLoja && onlyDigits(extraido.cnpj) !== cnpjLoja) {
          motivoTrocaRecusada = "cnpj_divergente"
          throw new Error("cnpj_divergente")
        }
        // Multi-loja: a fingerprint do novo certificado não pode estar vinculada a OUTRA unidade
        // (mesma regra da custódia inicial — a checagem devolve apenas booleano, nunca dados).
        if (extraido.fingerprintSha1) {
          const vinculadoAOutraLoja = await prisma.certificadoDigital.findFirst({
            where: { fingerprint: extraido.fingerprintSha1, NOT: { storeId: acl.storeId } },
            select: { id: true },
          })
          if (vinculadoAOutraLoja) {
            motivoTrocaRecusada = "certificado_de_outra_loja"
            throw new Error("certificado_de_outra_loja")
          }
        }
        // Troca do ponteiro com guarda otimista: só atualiza se a linha ainda aponta para as refs
        // lidas no início — uma rotação/upload concorrente faz esta troca falhar (fail-closed),
        // e a versão nova é descartada pelo serviço em vez de ficar órfã silenciosamente.
        const trocado = await prisma.certificadoDigital.updateMany({
          where: { id: cert.id, storeId: acl.storeId, blobRef: cert.blobRef, senhaRef: cert.senhaRef },
          data: {
            blobRef: novasRefs.blobRef,
            senhaRef: novasRefs.senhaRef,
            titularCn: extraido.titularCn,
            cnpjTitular: onlyDigits(extraido.cnpj),
            serialNumber: extraido.serialNumber,
            fingerprint: extraido.fingerprintSha1,
            validoDe: parseIsoDate(extraido.validoDe),
            validoAte: parseIsoDate(extraido.validoAte),
          },
        })
        if (trocado.count !== 1) {
          motivoTrocaRecusada = "concorrencia"
          throw new Error("concorrencia_na_troca")
        }
      },
    })
    pfx = null

    if (!resultado.ok) {
      if (resultado.codigo === "custodia_indisponivel") {
        return NextResponse.json({ ok: false, error: resultado.mensagem, codigo: resultado.codigo }, { status: 503 })
      }
      if (resultado.codigo === "troca_nao_confirmada") {
        await recordFiscalAdminLog({
          session: acl.session,
          storeId: acl.storeId,
          acao: "certificado.custodia.rotacionar",
          mensagem: motivoTrocaRecusada
            ? `Rotação recusada (${motivoTrocaRecusada}) — versão anterior mantida (${cert.apelido || cert.id})`
            : `Rotação não confirmada — versão anterior mantida (${cert.apelido || cert.id})`,
          detalhe: { certificadoId: cert.id, motivo: motivoTrocaRecusada },
        })
        if (motivoTrocaRecusada === "cnpj_divergente" || motivoTrocaRecusada === "certificado_de_outra_loja") {
          return jsonBloqueado([bloqueio(motivoTrocaRecusada)], 422)
        }
        return jsonError(resultado.mensagem, 409)
      }
      if (resultado.bloqueios.length > 0) return jsonBloqueado(resultado.bloqueios, 422)
      return jsonError(resultado.mensagem, 500)
    }

    await recordFiscalAdminLog({
      session: acl.session,
      storeId: acl.storeId,
      acao: "secret.rotate",
      mensagem: `Certificado A1 rotacionado no cofre (${cert.apelido || cert.id})`,
      detalhe: {
        certificadoId: cert.id,
        provider: provider.provider,
        fingerprint: resultado.extraido.fingerprintSha1,
        validoAte: resultado.extraido.validoAte,
        revogacaoAnterior: resultado.revogacaoAnterior,
      },
    })
    await recordFiscalAdminLog({
      session: acl.session,
      storeId: acl.storeId,
      acao: "certificado.custodia.rotacionar",
      mensagem: `Rotação concluída — ponteiro atualizado (${cert.apelido || cert.id})`,
      detalhe: { certificadoId: cert.id, revogacaoAnterior: resultado.revogacaoAnterior },
    })

    const updated = await prisma.certificadoDigital.findUnique({
      where: { id: cert.id },
      select: { id: true, apelido: true, ativo: true, status: true, validoAte: true, fingerprint: true },
    })

    return NextResponse.json({
      ok: true,
      certificado: updated
        ? { ...updated, validoAte: updated.validoAte ? updated.validoAte.toISOString() : null }
        : null,
      custodia: {
        provider: provider.provider,
        rotacionada: true,
        revogacaoAnterior: resultado.revogacaoAnterior,
      },
      transmissao: "nenhuma",
    })
  } catch (e) {
    // Mensagem genérica ao cliente; log server-side SANITIZADO (sem payload/material).
    console.error(
      "[fiscal:rotacionar] erro inesperado:",
      e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : "erro desconhecido",
    )
    return jsonBloqueado([bloqueio("erro_inesperado")], 500)
  } finally {
    zeroBuffer(pfx)
    pfx = null
  }
}
