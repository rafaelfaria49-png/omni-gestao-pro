/**
 * Inspeção do certificado A1 enviado no onboarding (GOAL-016B · itens 1 e 2).
 *
 * Abre o PKCS#12 EXCLUSIVAMENTE EM MEMÓRIA (via `loadPkcs12`, que já garante: sem arquivo
 * temporário, sem OpenSSL CLI, sem `child_process`), extrai apenas o que o X.509 realmente
 * carrega e devolve um resultado SANEADO. O `.pfx`, a senha, o PEM e a chave privada NUNCA saem
 * daqui — nem no retorno, nem em log, nem em mensagem de erro.
 *
 * Limite honesto de escopo: endereço, IE, CRT/regime e CSC **não existem** num A1 ICP-Brasil.
 * Este módulo jamais os atribui ao certificado — eles vêm da loja, da fonte cadastral ou do
 * preenchimento manual (ver `certificate-reconcile`).
 *
 * Fail-closed: senha incorreta, arquivo ilegível, certificado vencido/fora de janela, cadeia
 * ausente ou chave fraca ⇒ bloqueio. Nada é persistido nesta etapa.
 */
import { Pkcs12ParseError, loadPkcs12, zeroBuffer, type Pkcs12Meta } from "@/lib/fiscal/vault/pkcs12-loader"
import type {
  CertificadoExtraido,
  OnboardingBloqueio,
  OnboardingBloqueioCodigo,
} from "./onboarding-types"

/** Tamanho máximo aceito para um `.pfx` A1 (arquivos reais têm poucos KB). */
export const PFX_TAMANHO_MAXIMO_BYTES = 512 * 1024

/** Extensões aceitas no upload do certificado A1. */
export const PFX_EXTENSOES_ACEITAS = [".pfx", ".p12"] as const

/**
 * Content-types aceitos. Navegadores variam bastante para PKCS#12 — por isso a extensão é a
 * checagem forte e o content-type é permissivo (mas nunca `text/*`, `image/*` etc.).
 */
export const PFX_CONTENT_TYPES_ACEITOS = [
  "application/x-pkcs12",
  "application/pkcs12",
  "application/x-pkcs12-certificate",
  "application/octet-stream",
  "",
] as const

const MENSAGENS: Record<OnboardingBloqueioCodigo, string> = {
  arquivo_ausente: "Envie o arquivo do certificado digital A1 (.pfx ou .p12).",
  arquivo_muito_grande: "Arquivo acima do limite permitido para um certificado A1.",
  tipo_arquivo_invalido: "Formato de arquivo não aceito — envie um .pfx ou .p12.",
  senha_ausente: "Informe a senha do certificado.",
  senha_incorreta: "Senha do certificado incorreta.",
  arquivo_invalido: "Arquivo não é um certificado PKCS#12 legível.",
  certificado_sem_chave: "O certificado não contém chave privada.",
  certificado_sem_titular: "O certificado não contém o certificado do titular.",
  chave_fraca: "Chave do certificado abaixo do mínimo exigido (RSA 2048 bits).",
  certificado_vencido: "Certificado vencido — não pode ser usado.",
  certificado_ainda_nao_valido: "Certificado ainda não entrou em vigência.",
  cadeia_invalida: "Cadeia de certificação ausente ou inválida no arquivo enviado.",
  cnpj_certificado_ausente: "Não foi possível identificar o CNPJ no certificado.",
  cnpj_divergente: "O CNPJ do certificado não confere com o CNPJ da loja.",
  certificado_de_outra_loja: "Este certificado já está vinculado a outra unidade.",
  erro_inesperado: "Não foi possível ler o certificado.",
}

/** Constrói um bloqueio com a mensagem canônica (nunca contém segredo). */
export function bloqueio(codigo: OnboardingBloqueioCodigo): OnboardingBloqueio {
  return { codigo, mensagem: MENSAGENS[codigo] }
}

export type InspecaoCertificado = {
  /** `true` quando não há bloqueio decorrente do próprio arquivo. */
  ok: boolean
  /** Dados extraídos; `null` quando o arquivo sequer pôde ser aberto. */
  extraido: CertificadoExtraido | null
  bloqueios: OnboardingBloqueio[]
}

/** Remove o sufixo `:CNPJ` do CN no padrão ICP-Brasil, preservando o nome empresarial. */
export function nomeEmpresarialDoCn(titularCn: string): string {
  return String(titularCn ?? "")
    .replace(/:\d{14}\s*$/, "")
    .trim()
}

/**
 * Avaliação PURA do material já aberto. Separada de `inspecionarCertificadoPfx` para que cenários
 * que o leitor PKCS#12 rejeita antes (ex.: container sem cadeia) possam ser provados diretamente.
 */
export function avaliarMaterialCertificado(params: {
  meta: Pkcs12Meta
  cadeiaDisponivel: boolean
  agora?: Date
  exigirRsa2048?: boolean
}): { extraido: CertificadoExtraido; bloqueios: OnboardingBloqueio[] } {
  const { meta, cadeiaDisponivel } = params
  const agora = params.agora ?? new Date()
  const exigirRsa2048 = params.exigirRsa2048 ?? true

  const bloqueios: OnboardingBloqueio[] = []

  const antes = agora.getTime() < meta.notBefore.getTime()
  const depois = agora.getTime() > meta.notAfter.getTime()
  const vigente = !antes && !depois
  if (antes) bloqueios.push(bloqueio("certificado_ainda_nao_valido"))
  if (depois) bloqueios.push(bloqueio("certificado_vencido"))
  if (!cadeiaDisponivel) bloqueios.push(bloqueio("cadeia_invalida"))
  if (exigirRsa2048 && meta.chavePublicaRsaBits < 2048) bloqueios.push(bloqueio("chave_fraca"))
  if (!meta.cnpj) bloqueios.push(bloqueio("cnpj_certificado_ausente"))

  const extraido: CertificadoExtraido = {
    cnpj: meta.cnpj,
    titularCn: meta.titularCn,
    subject: meta.subject,
    nomeEmpresarial: nomeEmpresarialDoCn(meta.titularCn),
    email: meta.email,
    validoDe: meta.notBefore.toISOString(),
    validoAte: meta.notAfter.toISOString(),
    autoridadeCertificadora: meta.issuerCn,
    serialNumber: meta.serialNumber,
    fingerprintSha1: meta.fingerprintSha1,
    cadeiaDisponivel,
    vigente,
    chavePublicaRsaBits: meta.chavePublicaRsaBits,
  }

  return { extraido, bloqueios }
}

/**
 * Abre o `.pfx` em memória e devolve a extração saneada. Zera o buffer de entrada ao final
 * (best-effort — `loadPkcs12` já zera no caminho normal; aqui garantimos também nas falhas).
 */
export function inspecionarCertificadoPfx(params: {
  pfx: Buffer | null | undefined
  senha: string
  agora?: Date
  exigirRsa2048?: boolean
}): InspecaoCertificado {
  const { pfx, senha } = params

  if (!pfx || pfx.length === 0) return { ok: false, extraido: null, bloqueios: [bloqueio("arquivo_ausente")] }
  if (!String(senha ?? "")) {
    zeroBuffer(pfx)
    return { ok: false, extraido: null, bloqueios: [bloqueio("senha_ausente")] }
  }

  try {
    // `material` contém PEM/chave privada — permanece nesta função e NUNCA é devolvido.
    const material = loadPkcs12(pfx, senha)
    const { extraido, bloqueios } = avaliarMaterialCertificado({
      meta: material.meta,
      cadeiaDisponivel: material.cadeiaDisponivel,
      agora: params.agora,
      exigirRsa2048: params.exigirRsa2048,
    })
    return { ok: bloqueios.length === 0, extraido, bloqueios }
  } catch (e) {
    if (e instanceof Pkcs12ParseError) {
      switch (e.code) {
        case "senha_invalida":
          return { ok: false, extraido: null, bloqueios: [bloqueio("senha_incorreta")] }
        case "sem_chave_privada":
          return { ok: false, extraido: null, bloqueios: [bloqueio("certificado_sem_chave")] }
        case "sem_certificado":
          return { ok: false, extraido: null, bloqueios: [bloqueio("certificado_sem_titular")] }
        default:
          return { ok: false, extraido: null, bloqueios: [bloqueio("arquivo_invalido")] }
      }
    }
    return { ok: false, extraido: null, bloqueios: [bloqueio("erro_inesperado")] }
  } finally {
    zeroBuffer(pfx)
  }
}

/**
 * Re-deriva os bloqueios a partir de metadados JÁ EXTRAÍDOS. Usado na confirmação, que não reabre
 * o `.pfx`: garante que omitir os bloqueios no payload não libera a gravação. A fonte autoritativa
 * continua sendo a validação do certificado real pelo cofre, no passo de ativação.
 */
export function bloqueiosDoCertificadoDeclarado(
  extraido: CertificadoExtraido,
  agora: Date = new Date(),
): OnboardingBloqueio[] {
  const bloqueios: OnboardingBloqueio[] = []

  const de = extraido.validoDe ? new Date(extraido.validoDe) : null
  const ate = extraido.validoAte ? new Date(extraido.validoAte) : null
  if (!de || !ate || Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime())) {
    bloqueios.push(bloqueio("arquivo_invalido"))
  } else {
    if (agora.getTime() < de.getTime()) bloqueios.push(bloqueio("certificado_ainda_nao_valido"))
    if (agora.getTime() > ate.getTime()) bloqueios.push(bloqueio("certificado_vencido"))
  }
  if (!extraido.cadeiaDisponivel) bloqueios.push(bloqueio("cadeia_invalida"))
  if (extraido.chavePublicaRsaBits < 2048) bloqueios.push(bloqueio("chave_fraca"))
  if (!extraido.cnpj) bloqueios.push(bloqueio("cnpj_certificado_ausente"))

  return bloqueios
}

/** Valida nome/tamanho/tipo do arquivo ANTES de qualquer parse. Fail-closed. */
export function validarArquivoPfx(params: {
  nome: string
  tamanho: number
  contentType: string
}): OnboardingBloqueio[] {
  const bloqueios: OnboardingBloqueio[] = []
  const nome = String(params.nome ?? "").trim().toLowerCase()
  const tipo = String(params.contentType ?? "").trim().toLowerCase().split(";")[0]!.trim()

  if (params.tamanho <= 0) bloqueios.push(bloqueio("arquivo_ausente"))
  else if (params.tamanho > PFX_TAMANHO_MAXIMO_BYTES) bloqueios.push(bloqueio("arquivo_muito_grande"))

  const extensaoOk = PFX_EXTENSOES_ACEITAS.some((ext) => nome.endsWith(ext))
  const tipoOk = (PFX_CONTENT_TYPES_ACEITOS as readonly string[]).includes(tipo)
  if (!extensaoOk || !tipoOk) bloqueios.push(bloqueio("tipo_arquivo_invalido"))

  return bloqueios
}
