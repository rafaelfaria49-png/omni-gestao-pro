/**
 * Resolver do certificado ativo por loja (GOAL-016D-A0 · ADR-0020 · plano 016D §016D-A0).
 *
 * Fecha o elo `storeId → ConfiguracaoFiscalLoja.certificadoAtivoId → CertificadoDigital →
 * {blobRef, senhaRef}`, server-side, somente leitura e multi-loja. Devolve APENAS referências
 * opacas — nunca material de certificado (`.pfx`, senha, PEM). Resolver o material a partir das
 * referências é responsabilidade do CONSUMIDOR (assinatura/mTLS, slice 016D-A e além) — este
 * módulo é infraestrutura offline e não é alcançado por nenhum caminho de emissão.
 *
 * Fail-closed em toda a cadeia: storeId vazio, configuração ausente, certificado não configurado/
 * inexistente/de outra loja/inativo/revogado/expirado/ainda não vigente/sem referências, ou o
 * Secret Provider indisponível ⇒ falha tipada com código estável — nunca um valor parcial.
 *
 * Isolamento por loja: a busca do certificado combina `id` + `storeId` numa ÚNICA query — não há
 * lookup global anterior. "Não existe" e "existe em outra loja" produzem o MESMO código
 * (`certificado_ativo_indisponivel`) e a MESMA mensagem: nenhum dos dois é um existence oracle.
 *
 * Este módulo NÃO lê `fiscalEnabled` (não ativa emissão) e NÃO chama nenhum método do
 * `FiscalSecretVault` que leia ou grave segredo — consulta somente `resolveFiscalSecretProvider`
 * para saber se o cofre está disponível, e usa apenas `.availability`/`.provider` do resultado.
 * NÃO executa nenhuma escrita Prisma.
 *
 * Fora de escopo (responsabilidade do CALLER, não deste resolver): confirmar que quem está
 * pedindo o certificado tem POSSE de `storeId` (autenticação/autorização). Este módulo só prova
 * ISOLAMENTO entre lojas — nunca decide se o chamador pode agir em nome da loja informada.
 */
import { prisma } from "@/lib/prisma"
import { CertificadoStatus } from "@/generated/prisma"
import { resolveFiscalSecretProvider } from "@/lib/fiscal/vault/provider-resolver"
import type { EnvLike } from "@/lib/fiscal/vault/env-vault"

export type ResolveActiveCertificateErrorCode =
  | "store_id_invalido"
  | "configuracao_fiscal_ausente"
  | "certificado_ativo_nao_configurado"
  | "certificado_ativo_indisponivel"
  | "certificado_inativo"
  | "certificado_revogado"
  | "certificado_expirado"
  | "certificado_ainda_nao_valido"
  | "referencias_do_certificado_ausentes"
  | "secret_provider_indisponivel"

/** Sucesso: SÓ referências opacas — nunca CNPJ, titular, serial, fingerprint ou datas. */
export type ResolveActiveCertificateSuccess = {
  ok: true
  storeId: string
  certificadoId: string
  blobRef: string
  senhaRef: string
  /** Identificação sanitizada do backend do cofre (ex.: `env-piloto`) — nunca um segredo. */
  provider: string
}

/** Falha tipada — `mensagem` é sempre sanitizada (nunca contém `blobRef`/`senhaRef`/segredo). */
export type ResolveActiveCertificateFailure = {
  ok: false
  codigo: ResolveActiveCertificateErrorCode
  mensagem: string
}

export type ResolveActiveCertificateResult = ResolveActiveCertificateSuccess | ResolveActiveCertificateFailure

export type ResolveActiveCertificateParams = {
  storeId: string
  /** Instante de referência para a validade temporal (default: agora). Injetável para testes. */
  now?: Date
  /**
   * Fonte de variáveis de ambiente para resolver o Secret Provider (default: `process.env`).
   * SOMENTE para testes determinísticos — nunca alimentar com dado vindo de request/cliente.
   */
  env?: EnvLike
}

function falha(codigo: ResolveActiveCertificateErrorCode, mensagem: string): ResolveActiveCertificateFailure {
  return { ok: false, codigo, mensagem }
}

/**
 * Resolve o certificado ativo da loja. Read-only: nenhuma escrita Prisma, nenhuma leitura de
 * segredo no cofre. `fiscalEnabled` nunca é considerado — este resolver não ativa emissão.
 */
export async function resolveActiveCertificate(
  params: ResolveActiveCertificateParams,
): Promise<ResolveActiveCertificateResult> {
  const storeId = typeof params.storeId === "string" ? params.storeId.trim() : ""
  if (!storeId) {
    return falha("store_id_invalido", "Identificador da loja ausente ou inválido.")
  }
  // Relógio injetável (testes). Um instante não-finito (ex.: `new Date("inválida")`) NUNCA prova
  // validade — cai no mesmo fail-closed dos demais casos temporais logo abaixo.
  const agora = params.now ?? new Date()
  const agoraValida = Number.isFinite(agora.getTime())

  const config = await prisma.configuracaoFiscalLoja.findUnique({
    where: { storeId },
    select: { certificadoAtivoId: true },
  })
  if (!config) {
    return falha("configuracao_fiscal_ausente", "Configuração fiscal não encontrada para esta loja.")
  }

  const certificadoAtivoId = String(config.certificadoAtivoId ?? "").trim()
  if (!certificadoAtivoId) {
    return falha("certificado_ativo_nao_configurado", "Nenhum certificado ativo configurado para esta loja.")
  }

  // Query única combinando id + storeId: sem lookup global prévio que revelasse existência em
  // outra loja. "Inexistente" e "de outra loja" chegam ao mesmo `null` abaixo.
  const certificado = await prisma.certificadoDigital.findFirst({
    where: { id: certificadoAtivoId, storeId },
    select: { status: true, ativo: true, validoDe: true, validoAte: true, blobRef: true, senhaRef: true },
  })
  if (!certificado) {
    return falha(
      "certificado_ativo_indisponivel",
      "Certificado ativo configurado não foi encontrado para esta loja.",
    )
  }

  if (certificado.status === CertificadoStatus.REVOGADO) {
    return falha("certificado_revogado", "Certificado revogado — estado terminal, não pode ser usado.")
  }
  if (certificado.status === CertificadoStatus.EXPIRADO) {
    return falha("certificado_expirado", "Certificado expirado.")
  }
  if (certificado.ativo !== true || certificado.status !== CertificadoStatus.ATIVO) {
    return falha("certificado_inativo", "Certificado não está ativo.")
  }

  // `Number.isFinite` cobre `validoAte`/`validoDe`/`agora` inválidos (`Invalid Date` → `getTime()`
  // é NaN, e toda comparação com NaN é `false`) — sem a guarda, uma data corrompida "passaria"
  // silenciosamente pelos dois `if` abaixo em vez de falhar fechado.
  const validoAteMs = certificado.validoAte ? certificado.validoAte.getTime() : NaN
  if (!certificado.validoAte || !Number.isFinite(validoAteMs) || !agoraValida || validoAteMs <= agora.getTime()) {
    return falha(
      "certificado_expirado",
      "Certificado sem validade vigente (vencido, sem data de validade registrada, ou data inválida).",
    )
  }
  if (certificado.validoDe) {
    const validoDeMs = certificado.validoDe.getTime()
    if (!Number.isFinite(validoDeMs) || !agoraValida || validoDeMs > agora.getTime()) {
      return falha("certificado_ainda_nao_valido", "Certificado ainda fora da janela de validade.")
    }
  }

  const blobRef = String(certificado.blobRef ?? "").trim()
  const senhaRef = String(certificado.senhaRef ?? "").trim()
  if (!blobRef || !senhaRef) {
    return falha("referencias_do_certificado_ausentes", "Referências do certificado no cofre estão ausentes.")
  }

  // Consulta SOMENTE disponibilidade/capacidades do cofre — nunca `getCertificadoPfx`,
  // `getCertificadoSenha`, `put*`, `rotate*` ou `revoke`. Provider indisponível ⇒ fail-closed.
  const resolution = resolveFiscalSecretProvider(params.env ?? (process.env as EnvLike))
  if (!resolution.availability.disponivel) {
    return falha("secret_provider_indisponivel", resolution.availability.mensagem)
  }

  return {
    ok: true,
    storeId,
    certificadoId: certificadoAtivoId,
    blobRef,
    senhaRef,
    provider: resolution.provider,
  }
}
