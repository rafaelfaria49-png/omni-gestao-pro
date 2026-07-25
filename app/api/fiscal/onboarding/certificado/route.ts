/**
 * Onboarding fiscal — LEITURA do certificado A1 (GOAL-016B · itens 1–5).
 *
 * Recebe o `.pfx`/`.p12` + senha em multipart, processa TUDO no servidor e devolve a PRÉVIA de
 * confirmação. Esta rota **não persiste nada**: nem o arquivo, nem a senha, nem a identidade.
 *
 * Segurança (inegociável):
 *  - Apenas ADMIN fiscal (`requireFiscalAdmin`), multi-loja via `x-assistec-loja-id`.
 *  - Limite de tamanho e de tipo ANTES de qualquer parse; `content-length` barrado na entrada.
 *  - O `.pfx` vive apenas como Buffer em memória e é zerado ao final (inclusive em erro).
 *  - Senha, bytes do `.pfx`, PEM e chave privada NUNCA entram em resposta, log ou auditoria.
 *  - Nenhuma emissão, nenhuma transmissão à SEFAZ, `fiscalEnabled` intocado.
 */
import { NextResponse } from "next/server"
import { prismaEnsureConnected } from "@/lib/prisma"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { requireFiscalAdmin } from "@/lib/fiscal/guard-fiscal-admin"
import { recordFiscalAdminLog } from "@/lib/fiscal/fiscal-log"
import { zeroBuffer } from "@/lib/fiscal/vault/pkcs12-loader"
import {
  PFX_TAMANHO_MAXIMO_BYTES,
  bloqueio,
  inspecionarCertificadoPfx,
  reconciliarOnboarding,
  resolveFiscalIdentityLookupProvider,
  validarArquivoPfx,
} from "@/lib/fiscal/certificate"
import { carregarContextoOnboarding } from "@/lib/fiscal/certificate/onboarding-context"
import type { OnboardingBloqueio } from "@/lib/fiscal/certificate/onboarding-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

/** Folga sobre o limite do arquivo para o envelope multipart (nomes de campo, boundaries, senha). */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024

function jsonError(msg: string, status: number) {
  return NextResponse.json({ ok: false, error: msg }, { status })
}

/** Resposta de recusa: só códigos + mensagens canônicas, jamais o conteúdo enviado. */
function jsonBloqueado(bloqueios: OnboardingBloqueio[], status: number) {
  return NextResponse.json({ ok: false, error: bloqueios[0]?.mensagem ?? "Certificado recusado.", bloqueios }, { status })
}

export async function POST(req: Request) {
  const storeId = storeIdFromAssistecRequestForWrite(req)
  const acl = await requireFiscalAdmin(storeId)
  if (!acl.ok) return jsonError(acl.error, acl.status)

  // Barreira de tamanho antes de materializar o corpo.
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

  let pfx: Buffer | null = null
  try {
    pfx = Buffer.from(await arquivo.arrayBuffer())

    // Leitura + extração em memória. `inspecionarCertificadoPfx` zera o buffer ao final.
    const inspecao = inspecionarCertificadoPfx({ pfx, senha })
    pfx = null

    // Arquivo ilegível/senha incorreta: recusa cedo, sem tocar o banco.
    if (!inspecao.extraido) return jsonBloqueado(inspecao.bloqueios, 422)

    await prismaEnsureConnected()
    const contexto = await carregarContextoOnboarding({
      storeId: acl.storeId,
      fingerprint: inspecao.extraido.fingerprintSha1,
    })

    const lookupProvider = resolveFiscalIdentityLookupProvider()
    const lookup = await lookupProvider.consultar({
      cnpj: inspecao.extraido.cnpj ?? "",
      uf: contexto.fiscalLoja?.uf || contexto.store?.endereco.estado || "",
    })

    const preview = reconciliarOnboarding({
      storeId: acl.storeId,
      extraido: inspecao.extraido,
      bloqueiosInspecao: inspecao.bloqueios,
      fiscalLoja: contexto.fiscalLoja,
      store: contexto.store,
      lookup,
      certificados: contexto.certificados,
    })

    // Auditoria: identidade do certificado e veredito. NUNCA senha/bytes/PEM.
    await recordFiscalAdminLog({
      session: acl.session,
      storeId: acl.storeId,
      acao: "certificado.onboarding.inspecionar",
      mensagem: `Certificado A1 lido para onboarding (${preview.podeConfirmar ? "apto" : "bloqueado"})`,
      detalhe: {
        fingerprint: inspecao.extraido.fingerprintSha1,
        serialNumber: inspecao.extraido.serialNumber,
        cnpjCertificado: inspecao.extraido.cnpj,
        cnpjConfere: preview.reconciliacao.confere,
        bloqueios: preview.bloqueios.map((b) => b.codigo),
        lookup: preview.lookup.status,
        arquivoBytes: arquivo.size,
      },
    })

    return NextResponse.json({ ok: true, preview })
  } catch (e) {
    // Mensagem genérica: um erro inesperado nunca deve carregar material do certificado.
    void e
    return jsonBloqueado([bloqueio("erro_inesperado")], 500)
  } finally {
    zeroBuffer(pfx)
    pfx = null
  }
}

/** Diagnóstico da rota (sem dados) — útil para a UI saber os limites aceitos. */
export async function GET(req: Request) {
  const storeId = storeIdFromAssistecRequestForWrite(req)
  const acl = await requireFiscalAdmin(storeId)
  if (!acl.ok) return jsonError(acl.error, acl.status)
  return NextResponse.json({
    ok: true,
    limites: { tamanhoMaximoBytes: PFX_TAMANHO_MAXIMO_BYTES, extensoes: [".pfx", ".p12"] },
    transmissao: "nenhuma",
  })
}
