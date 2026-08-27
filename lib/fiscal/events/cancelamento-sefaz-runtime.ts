/**
 * Composição canônica do cancelamento fiscal administrativo (GOAL 018).
 *
 * Reusa o adapter 016/017: `SefazDiretoProvider` + `SefazSoapTransport` + guards D4 +
 * `resolveActiveCertificate` + EnvVault/A1. `SEFAZ_DIRETO` NÃO entra no REGISTRY P1.
 *
 * Fail-closed: STUB, provider ausente/incompatível, A1 indisponível ⇒ recusa.
 * Não usa o wiring dormente do piloto de emissão (resolução de A1 dormente recusada).
 */
import { FiscalProviderTipo } from "@/generated/prisma"
import { resolveActiveCertificate } from "@/lib/fiscal/certificate/resolve-active-certificate"
import type { ResolveActiveCertificateResult } from "@/lib/fiscal/certificate/resolve-active-certificate"
import { SefazDiretoProvider } from "@/lib/fiscal/provider/sefaz/sefaz-direto-provider"
import { SefazSoapTransport } from "@/lib/fiscal/provider/sefaz/sefaz-soap-transport"
import type { SefazGuardPorts } from "@/lib/fiscal/provider/sefaz/sefaz-guards"
import type { SefazTransport } from "@/lib/fiscal/provider/sefaz/sefaz-transport.types"
import type { FiscalCertificateMaterial } from "@/lib/fiscal/signing/signer.types"
import { EnvVault, type EnvLike } from "@/lib/fiscal/vault/env-vault"
import type { FiscalSecretVault } from "@/lib/fiscal/vault/fiscal-secret-vault"
import { loadPkcs12, Pkcs12ParseError } from "@/lib/fiscal/vault/pkcs12-loader"

const PROVIDER_SEFAZ = FiscalProviderTipo.SEFAZ_DIRETO
const PROVIDER_STUB = FiscalProviderTipo.STUB_HOMOLOGACAO

export type CancelamentoSefazRuntimeConfig = {
  provider: string
  ambiente?: string
  modeloFiscal?: string
  fiscalEnabled?: boolean
  cnpj?: string
  razaoSocial?: string
  uf?: string
  providerConfig?: unknown
  providerTokenRef?: string | null
  cscId?: string
  cscTokenRef?: string | null
  storeId?: string
}

type RuntimePrismaLike = {
  configuracaoFiscalLoja: {
    findUnique: (args: unknown) => Promise<CancelamentoSefazRuntimeConfig | null>
  }
}

export type CancelamentoSefazRuntimeDeps = {
  storeId: string
  client: RuntimePrismaLike
  env?: EnvLike
  transport?: SefazTransport
  guardPorts?: SefazGuardPorts
  resolveCertificate?: (params: { storeId: string; env?: EnvLike }) => Promise<ResolveActiveCertificateResult>
  vault?: FiscalSecretVault
  signingMaterial?: FiscalCertificateMaterial
  signingPassphrase?: string
  signEvento?: (unsignedXml: string) => string | Promise<string>
}

export type CancelamentoSefazRuntimeFailure = {
  ok: false
  code: string
  mensagem: string
  statusHttp: number
}

export type CancelamentoSefazRuntimeSuccess = {
  ok: true
  provider: SefazDiretoProvider
}

export type CancelamentoSefazRuntimeResult =
  | CancelamentoSefazRuntimeSuccess
  | CancelamentoSefazRuntimeFailure

function fail(
  code: string,
  mensagem: string,
  statusHttp = 422,
): CancelamentoSefazRuntimeFailure {
  return { ok: false, code, mensagem, statusHttp }
}

function texto(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * Portas D4 do cancelamento: piloto resolvido do registro fiscal (nunca literal),
 * certificado pelo resolver 016D-A0. XSD de nfe_v4.00 é inaplicável ao envEvento.
 */
export function createCancelamentoSefazGuardPorts(
  client: RuntimePrismaLike,
  storeId: string,
  resolveCertificate: CancelamentoSefazRuntimeDeps["resolveCertificate"] = resolveActiveCertificate,
): SefazGuardPorts {
  return {
    resolvePilotStoreId: async () => {
      const row = await client.configuracaoFiscalLoja.findUnique({
        where: { storeId },
        select: { storeId: true, provider: true },
      })
      if (!row || texto(row.provider) !== PROVIDER_SEFAZ) return null
      const id = texto(row.storeId) || texto(storeId)
      return id || null
    },
    loadFiscalConfig: async (id) => {
      const row = await client.configuracaoFiscalLoja.findUnique({
        where: { storeId: id },
        select: { provider: true },
      })
      const provider = texto(row?.provider)
      return provider ? { provider } : null
    },
    readXsdAttestation: async () => null,
    resolveActiveCertificate: (params) => resolveCertificate({ storeId: params.storeId }),
  }
}

async function loadSigningMaterialFromVault(input: {
  storeId: string
  blobRef: string
  senhaRef: string
  vault: FiscalSecretVault
}): Promise<FiscalCertificateMaterial | null> {
  try {
    const pfx = await input.vault.getCertificadoPfx(input.storeId, input.blobRef)
    const senha = await input.vault.getCertificadoSenha(input.storeId, input.senhaRef)
    if (!pfx || pfx.length === 0 || !senha) return null
    const loaded = loadPkcs12(pfx, senha)
    return {
      privateKeyPem: loaded.privateKeyPem,
      certificatePem: loaded.certificatePem,
    }
  } catch (e) {
    if (e instanceof Pkcs12ParseError) return null
    return null
  }
}

/**
 * Única fábrica do caminho administrativo persistido. Sem fallback para stub.
 */
export async function createSefazDiretoCancelamentoRuntime(
  deps: CancelamentoSefazRuntimeDeps,
): Promise<CancelamentoSefazRuntimeResult> {
  const storeId = texto(deps.storeId)
  if (!storeId) {
    return fail("parametros_invalidos", "storeId é obrigatório para o runtime SEFAZ_DIRETO.")
  }

  const config = await deps.client.configuracaoFiscalLoja.findUnique({
    where: { storeId },
  })
  if (!config) {
    return fail(
      "config_ausente",
      "Configuração fiscal da loja ausente — cancelamento fiscal recusado.",
    )
  }

  const tipo = texto(config.provider)
  if (!tipo) {
    return fail("provider_desconhecido", "Provider fiscal da loja não informado.")
  }
  if (tipo === PROVIDER_STUB) {
    return fail(
      "provider_incompativel",
      "STUB_HOMOLOGACAO não autoriza persistência de cancelamento fiscal.",
    )
  }
  if (tipo !== PROVIDER_SEFAZ) {
    return fail(
      "provider_nao_implementado",
      `Provider "${tipo}" incompatível com cancelamento fiscal — apenas SEFAZ_DIRETO, por instanciação direta.`,
    )
  }

  const resolveCertificate = deps.resolveCertificate ?? resolveActiveCertificate
  const certificado = await resolveCertificate({ storeId, env: deps.env })
  if (!certificado.ok) {
    return fail(
      "certificado_indisponivel",
      certificado.mensagem || "Certificado A1 ativo indisponível para cancelamento fiscal.",
    )
  }

  let signingMaterial = deps.signingMaterial ?? null
  if (!signingMaterial && !deps.signEvento) {
    const vault = deps.vault ?? new EnvVault({ env: deps.env })
    signingMaterial = await loadSigningMaterialFromVault({
      storeId,
      blobRef: certificado.blobRef,
      senhaRef: certificado.senhaRef,
      vault,
    })
    if (!signingMaterial) {
      return fail(
        "certificado_indisponivel",
        "Material A1 indisponível no cofre — evento de cancelamento não será assinado nem persistido.",
      )
    }
  }

  const transport = deps.transport ?? new SefazSoapTransport()
  const ports =
    deps.guardPorts ?? createCancelamentoSefazGuardPorts(deps.client, storeId, resolveCertificate)

  const provider = new SefazDiretoProvider({
    ports,
    transport,
    signingMaterial: signingMaterial ?? undefined,
    signingPassphrase: deps.signingPassphrase,
    signEvento: deps.signEvento,
  })

  return { ok: true, provider }
}
