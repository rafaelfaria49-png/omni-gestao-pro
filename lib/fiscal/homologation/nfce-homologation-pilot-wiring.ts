/**
 * Composição canônica única do piloto de homologação NFC-e (GOAL 022).
 *
 * Monta o pipeline já existente, sem segundo caminho:
 * fila → executor GOAL-012 → createFinalizedNfcePreparer →
 * persistBeforeTransmission → SefazDiretoProvider.
 *
 * DORMENTE e fail-closed:
 *  - não registra cron, rota, webhook nem worker;
 *  - capability externa é sempre `EXTERNAL_EXECUTION_DENIED`;
 *  - nenhum env/banco libera execução;
 *  - A1 só seria resolvido dentro de `prepare()` (lazy) e o default recusa;
 *  - transporte default permanece offline/recusando;
 *  - nada executa só por importar este módulo.
 */
import { prisma } from "@/lib/prisma"
import { selectNfceSpPublicUrls } from "@/lib/fiscal/danfce/urls-sp"
import { resolveActiveCertificate } from "@/lib/fiscal/certificate/resolve-active-certificate"
import {
  createFinalizedNfcePreparer,
  type FinalizedNfceCertificateResolver,
  type FinalizedNfcePreparerDependencies,
  type NfceQrUrlConfig,
} from "@/lib/fiscal/emission/finalized-nfce-preparer"
import { createPersistedNfceFinalizationSourceResolver } from "@/lib/fiscal/emission/nfce-finalization-source-resolver"
import { createPrismaUncertainStatePersistence } from "@/lib/fiscal/emission/prisma-uncertain-state-persistence"
import type { UncertainStateJobExecutorDependencies } from "@/lib/fiscal/emission/uncertain-state-job-executor"
import {
  EXTERNAL_EXECUTION_DENIED,
  type FinalizedDocumentPreparer,
  type UncertainStatePersistence,
} from "@/lib/fiscal/emission/uncertain-state.types"
import { NfceSignError } from "@/lib/fiscal/signing"
import { SefazDiretoProvider } from "@/lib/fiscal/provider/sefaz/sefaz-direto-provider"
import type { SefazGuardPorts } from "@/lib/fiscal/provider/sefaz/sefaz-guards"
import {
  sefazOfflineRefusingTransport,
  type SefazTransport,
} from "@/lib/fiscal/provider/sefaz/sefaz-transport.types"
import { createPrismaGoal012FiscalQueueWorkerPorts } from "@/lib/fiscal/queue/prisma-queue-worker"
import type { FiscalQueueWorkerPorts } from "@/lib/fiscal/queue/queue.types"

type WiringPrismaClient = NonNullable<
  Parameters<typeof createPrismaGoal012FiscalQueueWorkerPorts>[1]
> &
  NonNullable<Parameters<typeof createPrismaUncertainStatePersistence>[0]> & {
    notaFiscal: {
      findFirst: (args: unknown) => Promise<unknown | null>
    }
    configuracaoFiscalLoja: {
      findUnique: (args: unknown) => Promise<unknown | null>
    }
  }

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Default do piloto: A1 nunca é aberto neste GOAL. Só falha se `prepare()` for alcançado. */
export async function refuseDormantA1CertificateResolution(): Promise<never> {
  throw new NfceSignError(
    "material_ausente",
    "Resolução de certificado A1 recusada no wiring dormente do piloto NFC-e.",
  )
}

export const NFCE_HOMOLOGATION_PILOT_QR_URLS: NfceQrUrlConfig = (() => {
  const urls = selectNfceSpPublicUrls("HOMOLOGACAO")
  return { qrCodeBaseUrl: urls.qrCodeBaseUrl, urlChave: urls.urlChave }
})()

export function createDormantSefazGuardPorts(
  client: WiringPrismaClient,
): SefazGuardPorts {
  return {
    resolvePilotStoreId: async () => null,
    loadFiscalConfig: async (storeId) => {
      const row = record(
        await client.configuracaoFiscalLoja.findUnique({
          where: { storeId },
          select: { provider: true },
        }),
      )
      const provider = typeof row.provider === "string" ? row.provider.trim() : ""
      return provider ? { provider } : null
    },
    readXsdAttestation: async () => null,
    resolveActiveCertificate: (params) => resolveActiveCertificate({ storeId: params.storeId }),
  }
}

export type NfceHomologationPilotWiring = {
  ports: FiscalQueueWorkerPorts
  preparer: FinalizedDocumentPreparer
  persistence: UncertainStatePersistence
  provider: SefazDiretoProvider
  transport: SefazTransport
  capability: typeof EXTERNAL_EXECUTION_DENIED
}

export type NfceHomologationPilotWiringOptions = {
  client?: WiringPrismaClient
  persistence?: UncertainStatePersistence
  resolveSource?: FinalizedNfcePreparerDependencies["resolveSource"]
  /**
   * Lazy A1. Default recusa sem abrir cofre/PKCS#12.
   * Testes isolados injetam fixture; produção deste GOAL não carrega A1.
   */
  resolveCertificate?: FinalizedNfceCertificateResolver
  sefazGuardPorts?: SefazGuardPorts
  /**
   * Transporte injetável somente para prova. Omitido ⇒ offline recusando.
   * Este GOAL nunca seleciona transporte HTTP/mTLS.
   */
  transport?: SefazTransport
  now?: UncertainStateJobExecutorDependencies["now"]
}

/**
 * Única fábrica produtiva do piloto. Não agenda execução.
 * Capability é literalmente `EXTERNAL_EXECUTION_DENIED` — não há parâmetro
 * que a inverta, nem leitura de env/banco.
 */
export function createNfceHomologationPilotWiring(
  options: NfceHomologationPilotWiringOptions = {},
): NfceHomologationPilotWiring {
  const client = (options.client ?? (prisma as unknown as WiringPrismaClient))
  const persistence = options.persistence ?? createPrismaUncertainStatePersistence(client)
  const resolveCertificate =
    options.resolveCertificate ?? refuseDormantA1CertificateResolution
  const preparer = createFinalizedNfcePreparer({
    resolveSource:
      options.resolveSource ?? createPersistedNfceFinalizationSourceResolver(client),
    resolveCertificate,
    qrUrls: NFCE_HOMOLOGATION_PILOT_QR_URLS,
  })
  const transport = options.transport ?? sefazOfflineRefusingTransport
  const provider = new SefazDiretoProvider({
    ports: options.sefazGuardPorts ?? createDormantSefazGuardPorts(client),
    transport,
  })
  const ports = createPrismaGoal012FiscalQueueWorkerPorts(
    {
      persistence,
      preparer,
      provider,
      now: options.now,
      capability: EXTERNAL_EXECUTION_DENIED,
    },
    client,
  )
  return {
    ports,
    preparer,
    persistence,
    provider,
    transport,
    capability: EXTERNAL_EXECUTION_DENIED,
  }
}
