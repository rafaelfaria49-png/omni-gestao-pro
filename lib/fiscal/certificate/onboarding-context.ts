/**
 * Leitura do contexto de onboarding a partir do banco (GOAL-016B).
 *
 * Camada fina com Prisma: carrega os snapshots que a reconciliação PURA consome
 * (`ConfiguracaoFiscalLoja`, `Store`, sinais de certificados). Sempre escopada por `storeId`.
 *
 * Exceção consciente ao escopo de loja: a checagem `fingerprintVinculadaAOutraLoja` consulta
 * outras unidades — mas devolve APENAS um booleano, nunca dados da outra loja. Ela existe para
 * cumprir o requisito "bloquear quando o certificado pertencer a outra loja" (GOAL-016B item 3).
 */
import { prisma } from "@/lib/prisma"
import { onlyDigits } from "@/lib/fiscal/fiscal-validators"
import { readCnaeFromProviderConfig } from "@/lib/fiscal/fiscal-identity-service"
import { certificadoTemCustodia } from "./certificate-custody"
import type { CertificadosContexto, FiscalLojaSnapshot, StoreSnapshot } from "./certificate-reconcile"

/**
 * Formato cru da `ConfiguracaoFiscalLoja` usado pelo onboarding. Inclui os campos que a
 * confirmação precisa PRESERVAR (ambiente, modelo, provider, CSC) — nunca alterados aqui.
 */
export type ConfiguracaoFiscalLojaRow = {
  fiscalEnabled: boolean
  ambiente: string
  modeloFiscal: string
  provider: string
  cscId: string
  cscTokenRef: string | null
  razaoSocial: string
  nomeFantasia: string
  cnpj: string
  inscricaoEstadual: string
  inscricaoMunicipal: string
  regimeTributario: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  codigoMunicipioIbge: string
  municipio: string
  uf: string
  cep: string
  fone: string
  email: string
  providerConfig: unknown
}

/** Converte a linha do Prisma no snapshot puro (CNAE vive no JSONB `providerConfig`). */
export function toFiscalLojaSnapshot(row: ConfiguracaoFiscalLojaRow | null): FiscalLojaSnapshot | null {
  if (!row) return null
  return {
    fiscalEnabled: row.fiscalEnabled,
    razaoSocial: row.razaoSocial,
    nomeFantasia: row.nomeFantasia,
    cnpj: row.cnpj,
    inscricaoEstadual: row.inscricaoEstadual,
    inscricaoMunicipal: row.inscricaoMunicipal,
    cnae: readCnaeFromProviderConfig(row.providerConfig),
    regimeTributario: row.regimeTributario,
    logradouro: row.logradouro,
    numero: row.numero,
    complemento: row.complemento,
    bairro: row.bairro,
    codigoMunicipioIbge: row.codigoMunicipioIbge,
    municipio: row.municipio,
    uf: row.uf,
    cep: row.cep,
    fone: row.fone,
    email: row.email,
  }
}

/** Converte a `Store` (endereço em JSONB `{rua,numero,bairro,cidade,estado,cep}`) no snapshot puro. */
export function toStoreSnapshot(
  row: { name: string; cnpj: string; phone: string; address: unknown } | null,
): StoreSnapshot | null {
  if (!row) return null
  const addr =
    row.address && typeof row.address === "object" ? (row.address as Record<string, unknown>) : {}
  const str = (v: unknown) => String(v ?? "").trim()
  return {
    nome: str(row.name),
    cnpj: str(row.cnpj),
    telefone: str(row.phone),
    endereco: {
      rua: str(addr.rua),
      numero: str(addr.numero),
      bairro: str(addr.bairro),
      cidade: str(addr.cidade),
      estado: str(addr.estado),
      cep: str(addr.cep),
    },
  }
}

/** Linha de `CertificadoDigital` desta loja com a mesma impressão do arquivo lido. */
export type CertificadoMesmaFingerprint = {
  id: string
  fingerprint: string | null
  ativo: boolean
  status: string
  blobRef: string | null
  senhaRef: string | null
}

export type OnboardingContexto = {
  fiscalLoja: FiscalLojaSnapshot | null
  store: StoreSnapshot | null
  certificados: CertificadosContexto
  /** Linha crua da configuração — a rota de confirmação precisa dela para preservar provider/CSC. */
  configRow: ConfiguracaoFiscalLojaRow | null
  /** Certificado já registrado com a mesma impressão (base da decisão de custódia). */
  certificadoMesmaFingerprint: CertificadoMesmaFingerprint | null
}

/** Carrega tudo que a reconciliação precisa. `fingerprint` vazia desliga as checagens por impressão. */
export async function carregarContextoOnboarding(params: {
  storeId: string
  fingerprint: string | null
}): Promise<OnboardingContexto> {
  const storeId = String(params.storeId ?? "").trim()
  const fingerprint = String(params.fingerprint ?? "").trim().toLowerCase()

  const [config, store, certsDaLoja, vinculadoAOutraLoja] = await Promise.all([
    prisma.configuracaoFiscalLoja.findUnique({ where: { storeId } }),
    prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true, cnpj: true, phone: true, address: true },
    }),
    prisma.certificadoDigital.findMany({
      where: { storeId },
      select: { id: true, fingerprint: true, ativo: true, status: true, blobRef: true, senhaRef: true },
    }),
    fingerprint
      ? prisma.certificadoDigital
          .findFirst({
            where: { fingerprint, NOT: { storeId } },
            select: { id: true },
          })
          .then((c) => Boolean(c))
      : Promise.resolve(false),
  ])

  const mesmaFingerprint = (v: string | null | undefined) =>
    Boolean(fingerprint) && String(v ?? "").trim().toLowerCase() === fingerprint

  /** Linha desta loja com a MESMA impressão — base da decisão de custódia na confirmação. */
  const mesmoCertificado = certsDaLoja.find((c) => mesmaFingerprint(c.fingerprint)) ?? null

  return {
    fiscalLoja: toFiscalLojaSnapshot(config as ConfiguracaoFiscalLojaRow | null),
    store: toStoreSnapshot(store),
    configRow: config as ConfiguracaoFiscalLojaRow | null,
    certificadoMesmaFingerprint: mesmoCertificado,
    certificados: {
      fingerprintJaRegistradaNestaLoja: Boolean(mesmoCertificado),
      possuiAtivoComOutraFingerprint: certsDaLoja.some((c) => c.ativo && !mesmaFingerprint(c.fingerprint)),
      fingerprintVinculadaAOutraLoja: vinculadoAOutraLoja,
      custodiaConfigurada: certificadoTemCustodia(mesmoCertificado),
    },
  }
}

/** CNPJ conhecido da loja (identidade fiscal manda; cadastro operacional é fallback). */
export function cnpjConhecidoDaLoja(ctx: OnboardingContexto): string | null {
  return onlyDigits(ctx.fiscalLoja?.cnpj) || onlyDigits(ctx.store?.cnpj) || null
}
