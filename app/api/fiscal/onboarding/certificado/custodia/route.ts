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
  inspecionarCertificadoPfx,
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

    // PRÉ-INSPEÇÃO em memória (sobre uma cópia — a inspeção zera o buffer que recebe): todas as
    // recusas acontecem ANTES de qualquer gravação no cofre. Segredo rejeitado nunca é armazenado.
    const pre = inspecionarCertificadoPfx({ pfx: Buffer.from(pfx), senha })
    if (!pre.extraido || pre.bloqueios.length > 0) {
      return jsonBloqueado(pre.bloqueios.length > 0 ? pre.bloqueios : [bloqueio("arquivo_invalido")], 422)
    }
    const extraidoPrevio = pre.extraido

    // Reconciliação multi-loja ANTES do cofre: CNPJ × unidade e fingerprint de outra unidade.
    await prismaEnsureConnected()
    const contexto = await carregarContextoOnboarding({
      storeId: acl.storeId,
      fingerprint: extraidoPrevio.fingerprintSha1,
    })

    const bloqueiosReconciliacao: OnboardingBloqueio[] = []
    const cnpjLoja = cnpjConhecidoDaLoja(contexto)
    if (extraidoPrevio.cnpj && cnpjLoja && onlyDigits(extraidoPrevio.cnpj) !== cnpjLoja) {
      bloqueiosReconciliacao.push(bloqueio("cnpj_divergente"))
    }
    if (contexto.certificados.fingerprintVinculadaAOutraLoja) {
      bloqueiosReconciliacao.push(bloqueio("certificado_de_outra_loja"))
    }
    if (bloqueiosReconciliacao.length > 0) {
      await recordFiscalAdminLog({
        session: acl.session,
        storeId: acl.storeId,
        acao: "certificado.custodia.armazenar",
        mensagem: "Custódia recusada na reconciliação com a unidade — nada gravado no cofre",
        detalhe: { fingerprint: extraidoPrevio.fingerprintSha1, bloqueios: bloqueiosReconciliacao.map((b) => b.codigo) },
      })
      return jsonBloqueado(bloqueiosReconciliacao, 422)
    }

    // Revogação é TERMINAL: reenviar a mesma fingerprint NÃO ressuscita a linha.
    const existente = contexto.certificadoMesmaFingerprint
    if (existente && String(existente.status).toUpperCase() === "REVOGADO") {
      return NextResponse.json(
        { ok: false, error: "Este certificado está revogado nesta unidade (estado terminal). Registre um novo certificado.", codigo: "certificado_revogado" },
        { status: 409 },
      )
    }

    // Reenvio sobre certificado ATIVO derrubaria a linha em uso — o caminho correto é a ROTAÇÃO.
    if (existente?.ativo === true) {
      return NextResponse.json(
        { ok: false, error: "Este certificado está ativo nesta unidade. Use a rotação para trocar o material sem quebrar a referência.", codigo: "certificado_ativo_use_rotacao" },
        { status: 409 },
      )
    }

    /**
     * Já existe OUTRO certificado ATIVO na unidade, com fingerprint diferente. Num backend de
     * referência estável (EnvVault: slot canônico por loja) armazenar aqui gravaria no MESMO slot
     * do certificado em uso, substituindo em silêncio o material de uma linha que continuaria
     * marcada como ATIVA — a linha nova nasceria inativa e o ativo passaria a apontar para material
     * que não é o dele. O caminho controlado é rotacionar a linha ativa.
     *
     * Bloqueio ANTES do cofre e antes de qualquer escrita de domínio no Prisma (só a trilha de
     * auditoria é registrada, append-only).
     */
    if (contexto.certificados.possuiAtivoComOutraFingerprint) {
      await recordFiscalAdminLog({
        session: acl.session,
        storeId: acl.storeId,
        acao: "certificado.custodia.armazenar",
        mensagem: "Custódia recusada: já há certificado ATIVO com outra fingerprint na unidade — cofre intocado",
        detalhe: { fingerprint: extraidoPrevio.fingerprintSha1, motivo: "ativo_com_outra_fingerprint" },
      })
      return NextResponse.json(
        {
          ok: false,
          error:
            "Esta unidade já tem um certificado ATIVO diferente. Rotacione o certificado ativo para trocar o material — armazenar um novo aqui substituiria o segredo em uso.",
          codigo: "certificado_ativo_divergente_use_rotacao",
        },
        { status: 409 },
      )
    }

    // Todas as recusas ficaram para trás: agora sim, valida (de novo, no serviço) e grava no cofre.
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
      // Banco falhou depois da gravação no cofre: desfaz as refs novas SOMENTE se forem diferentes
      // das que a linha já tinha (refs idênticas = valor in-place já era desta linha — revogar
      // destruiria o segredo em uso).
      const refsDiferentes =
        !existente || existente.blobRef !== refs.blobRef || existente.senhaRef !== refs.senhaRef
      if (refsDiferentes) {
        await revogarSegredosCertificado({ vault, storeId: acl.storeId, ...refs })
      }
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
    // Mensagem genérica ao cliente: erro inesperado nunca carrega material do certificado.
    // Log server-side SANITIZADO (nome/mensagem do erro — nossos erros nunca embutem segredo).
    console.error(
      "[fiscal:custodia] erro inesperado:",
      e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : "erro desconhecido",
    )
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
