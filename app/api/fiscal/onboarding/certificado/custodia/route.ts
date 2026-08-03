/**
 * Custódia do certificado A1 (GOAL-016C) — gravação do material no cofre de segredos.
 *
 * Fluxo server-side completo, em UMA requisição (o `.pfx` nunca persiste entre requests):
 *  1. valida nome/tamanho/tipo do arquivo ANTES de qualquer parse;
 *  2. abre o PKCS#12 EM MEMÓRIA e exige certificado válido, vigente, RSA ≥ 2048, com cadeia e CNPJ;
 *  3. confere o CNPJ do certificado com o CNPJ conhecido da unidade e bloqueia fingerprint já
 *     vinculada a OUTRA unidade (multi-loja);
 *  4. grava `.pfx`+senha no Secret Provider e recebe REFERÊNCIAS OPACAS;
 *  5. registra/atualiza o `CertificadoDigital` com refs + metadados seguros — `PENDENTE_VALIDACAO`,
 *     `ativo = false` (a ativação continua sendo ato administrativo separado, validate-then-activate);
 *  6. se havia refs anteriores para a mesma fingerprint, revoga a versão anterior (rotação por
 *     reenvio) APÓS a gravação confirmada.
 *
 * Fail-closed: provider sem escrita (piloto EnvVault sem store mutável) ⇒ 503 sanitizado e NADA
 * é gravado — a custódia manual por env (fluxo GOAL-016B) segue valendo. Se a gravação no banco
 * falhar depois do cofre, as refs novas são revogadas (best-effort) — nada órfão.
 *
 * Segurança (inegociável): a resposta, os erros e a auditoria NUNCA carregam `.pfx`, senha, PEM
 * ou chave. NÃO liga `fiscalEnabled`, NÃO ativa o certificado e NÃO transmite nada à SEFAZ.
 */
import { NextResponse } from "next/server"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { requireFiscalAdmin } from "@/lib/fiscal/guard-fiscal-admin"
import { recordFiscalAdminLog } from "@/lib/fiscal/fiscal-log"
import { onlyDigits } from "@/lib/fiscal/fiscal-validators"
import {
  PFX_TAMANHO_MAXIMO_BYTES,
  bloqueio,
  validarArquivoPfx,
} from "@/lib/fiscal/certificate"
import { carregarContextoOnboarding, cnpjConhecidoDaLoja } from "@/lib/fiscal/certificate/onboarding-context"
import type { OnboardingBloqueio } from "@/lib/fiscal/certificate/onboarding-types"
import {
  armazenarCertificadoA1,
  resolveFiscalSecretProvider,
  revogarSegredosCertificado,
} from "@/lib/fiscal/vault"
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

export async function POST(req: Request) {
  const storeId = storeIdFromAssistecRequestForWrite(req)
  const acl = await requireFiscalAdmin(storeId)
  if (!acl.ok) return jsonError(acl.error, acl.status)

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
  const apelido = String(form.get("apelido") ?? "").trim().slice(0, 120)
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

  // Fail-closed de capacidade: provider sem escrita neste ambiente ⇒ 503 sanitizado, nada gravado.
  const provider = resolveFiscalSecretProvider()
  if (!provider.vault || !provider.availability.capacidades.escrita) {
    await recordFiscalAdminLog({
      session: acl.session,
      storeId: acl.storeId,
      acao: "certificado.custodia.indisponivel",
      mensagem: "Custódia automática indisponível neste ambiente (fail-closed)",
      detalhe: { provider: provider.provider, disponivel: provider.availability.disponivel },
    })
    return NextResponse.json(
      {
        ok: false,
        error:
          "A custódia automática não está disponível neste ambiente. O provisionamento manual do cofre (envs por unidade) segue sendo o caminho do piloto.",
        codigo: "custodia_indisponivel",
        custodia: { provider: provider.provider, disponivel: false, escrita: false },
      },
      { status: 503 },
    )
  }
  const vault = provider.vault

  let pfx: Buffer | null = null
  try {
    pfx = Buffer.from(await arquivo.arrayBuffer())

    // Valida + grava no cofre (o serviço zera o buffer ao final, inclusive em erro).
    const resultado = await armazenarCertificadoA1({ vault, storeId: acl.storeId, pfx, senha })
    pfx = null

    if (!resultado.ok) {
      if (resultado.codigo === "custodia_indisponivel") {
        return NextResponse.json(
          { ok: false, error: resultado.mensagem, codigo: resultado.codigo },
          { status: 503 },
        )
      }
      if (resultado.bloqueios.length > 0) return jsonBloqueado(resultado.bloqueios, 422)
      return jsonError(resultado.mensagem, 500)
    }

    const { refs, extraido } = resultado

    // Reconciliação multi-loja: CNPJ × unidade e fingerprint vinculada a outra unidade.
    await prismaEnsureConnected()
    const contexto = await carregarContextoOnboarding({
      storeId: acl.storeId,
      fingerprint: extraido.fingerprintSha1,
    })

    const bloqueiosReconciliacao: OnboardingBloqueio[] = []
    const cnpjLoja = cnpjConhecidoDaLoja(contexto)
    if (extraido.cnpj && cnpjLoja && onlyDigits(extraido.cnpj) !== cnpjLoja) {
      bloqueiosReconciliacao.push(bloqueio("cnpj_divergente"))
    }
    if (contexto.certificados.fingerprintVinculadaAOutraLoja) {
      bloqueiosReconciliacao.push(bloqueio("certificado_de_outra_loja"))
    }
    if (bloqueiosReconciliacao.length > 0) {
      // Incompatível: desfaz a gravação no cofre (best-effort) — nada órfão, nada registrado.
      await revogarSegredosCertificado({ vault, storeId: acl.storeId, ...refs })
      await recordFiscalAdminLog({
        session: acl.session,
        storeId: acl.storeId,
        acao: "certificado.custodia.armazenar",
        mensagem: "Custódia recusada na reconciliação com a unidade — material descartado do cofre",
        detalhe: { fingerprint: extraido.fingerprintSha1, bloqueios: bloqueiosReconciliacao.map((b) => b.codigo) },
      })
      return jsonBloqueado(bloqueiosReconciliacao, 422)
    }

    // Registro: mesma fingerprint nesta unidade ⇒ atualiza refs + metadados (rotação por reenvio);
    // senão, cria a linha. Sempre `PENDENTE_VALIDACAO` + inativo — ativação é ato separado.
    const metadata = {
      apelido: (apelido || extraido.nomeEmpresarial || "Certificado A1").slice(0, 120),
      tipo: "A1",
      titularCn: extraido.titularCn,
      cnpjTitular: onlyDigits(extraido.cnpj),
      serialNumber: extraido.serialNumber,
      fingerprint: extraido.fingerprintSha1,
      validoDe: parseIsoDate(extraido.validoDe),
      validoAte: parseIsoDate(extraido.validoAte),
      blobRef: refs.blobRef,
      senhaRef: refs.senhaRef,
    }

    const existente = contexto.certificadoMesmaFingerprint
    let certificado
    try {
      certificado = existente
        ? await prisma.certificadoDigital.update({
            where: { id: existente.id },
            data: { ...metadata, status: "PENDENTE_VALIDACAO", ativo: false },
            select: { id: true, apelido: true, status: true, ativo: true, validoAte: true },
          })
        : await prisma.certificadoDigital.create({
            data: { storeId: acl.storeId, ...metadata, status: "PENDENTE_VALIDACAO", ativo: false, uploadedBy: acl.session?.user?.id ?? null },
            select: { id: true, apelido: true, status: true, ativo: true, validoAte: true },
          })
    } catch {
      // Banco falhou depois da gravação no cofre: desfaz as refs novas (best-effort).
      await revogarSegredosCertificado({ vault, storeId: acl.storeId, ...refs })
      throw new Error("Falha ao registrar o certificado — gravação no cofre desfeita (fail-closed).")
    }

    // Rotação por reenvio: refs anteriores da mesma linha deixam de servir APÓS a troca confirmada.
    let revogacaoAnterior: "concluida" | "pendente" | "nao_aplicavel" = "nao_aplicavel"
    const refsAntigasDiferentes =
      existente &&
      ((existente.blobRef && existente.blobRef !== refs.blobRef) || (existente.senhaRef && existente.senhaRef !== refs.senhaRef))
    if (refsAntigasDiferentes) {
      const rev = await revogarSegredosCertificado({
        vault,
        storeId: acl.storeId,
        blobRef: existente.blobRef,
        senhaRef: existente.senhaRef,
      })
      revogacaoAnterior = rev.pendentes.length > 0 ? "pendente" : "concluida"
    }

    await recordFiscalAdminLog({
      session: acl.session,
      storeId: acl.storeId,
      acao: "secret.set",
      mensagem: `Certificado A1 armazenado no cofre (${certificado.apelido || certificado.id})`,
      detalhe: {
        certificadoId: certificado.id,
        provider: provider.provider,
        fingerprint: extraido.fingerprintSha1,
        serialNumber: extraido.serialNumber,
        validoAte: extraido.validoAte,
        rotacaoPorReenvio: Boolean(refsAntigasDiferentes),
        revogacaoAnterior,
      },
    })
    await recordFiscalAdminLog({
      session: acl.session,
      storeId: acl.storeId,
      acao: "certificado.custodia.armazenar",
      mensagem: `Certificado registrado com custódia — aguardando validação/ativação (${certificado.apelido || certificado.id})`,
      detalhe: { certificadoId: certificado.id, status: certificado.status, ativo: certificado.ativo },
    })

    return NextResponse.json({
      ok: true,
      certificado: {
        id: certificado.id,
        apelido: certificado.apelido,
        status: certificado.status,
        ativo: certificado.ativo,
        validoAte: certificado.validoAte ? certificado.validoAte.toISOString() : null,
        titularCn: extraido.titularCn,
        cnpjTitular: onlyDigits(extraido.cnpj) || null,
        fingerprint: extraido.fingerprintSha1,
      },
      custodia: {
        armazenada: true,
        provider: provider.provider,
        revogacaoAnterior,
      },
      transmissao: "nenhuma",
    })
  } catch (e) {
    // Mensagem genérica: erro inesperado nunca carrega material do certificado.
    void e
    return jsonBloqueado([bloqueio("erro_inesperado")], 500)
  } finally {
    zeroBuffer(pfx)
    pfx = null
  }
}

/** Diagnóstico da custódia (sem dados sensíveis) — provider, disponibilidade e capacidades. */
export async function GET(req: Request) {
  const storeId = storeIdFromAssistecRequestForWrite(req)
  const acl = await requireFiscalAdmin(storeId)
  if (!acl.ok) return jsonError(acl.error, acl.status)
  const provider = resolveFiscalSecretProvider()
  return NextResponse.json({
    ok: true,
    custodia: {
      provider: provider.provider,
      disponivel: provider.availability.disponivel,
      capacidades: provider.availability.capacidades,
      mensagem: provider.availability.mensagem,
    },
    limites: { tamanhoMaximoBytes: PFX_TAMANHO_MAXIMO_BYTES, extensoes: [".pfx", ".p12"] },
    transmissao: "nenhuma",
  })
}
