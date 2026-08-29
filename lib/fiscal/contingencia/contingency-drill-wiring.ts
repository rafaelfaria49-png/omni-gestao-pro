/**
 * Caminho EXPLÍCITO do drill de transmissão posterior da contingência
 * (CONTINGENCIA_TRANSMISSAO) em homologação — GOAL 020.
 *
 * Segregação deliberada: o DRAIN GENÉRICO continua no wiring dormente do piloto
 * (`createNfceHomologationPilotWiring`, capability `EXTERNAL_EXECUTION_DENIED`,
 * transporte offline) e NÃO ganha capacidade externa aqui. Este módulo só é
 * alcançado pela superfície administrativa própria do drill
 * (`/api/internal/fiscal/contingencia-drill`) e recusa tudo que não seja o job
 * de contingência autorizado da loja-piloto sob gate efêmero vigente.
 *
 * Ordem canônica de cada execução (todas antes de qualquer rede):
 *  1. job EXATAMENTE `CONTINGENCIA_TRANSMISSAO`, com jobId/storeId coerentes;
 *  2. loja-piloto RESOLVIDA do registro fiscal (nunca literal);
 *  3. configuração NFCE + HOMOLOGACAO + SEFAZ_DIRETO + fiscalEnabled;
 *  4. gate efêmero específico da contingência VIGENTE;
 *  5. documento já persistido em CONTINGENCIA com SHA-256 conferido;
 *  6. consumo one-shot persistente da ativação (activationId + job + loja);
 *  7. capability positiva POR EXECUÇÃO, do binding opaco;
 *  8. executor GOAL-012/coordenador: bytes exatos persistidos, `prepare`
 *     jamais chamado, numeração jamais criada — os dez guards D4
 *     (`runSefazPreTransportGuards`) rodam de novo dentro do provider,
 *     imediatamente antes do envelope/transporte.
 */
import { prisma } from "@/lib/prisma"
import { resolveActiveCertificate } from "@/lib/fiscal/certificate/resolve-active-certificate"
import type { ResolveActiveCertificateResult } from "@/lib/fiscal/certificate/resolve-active-certificate"
import { NfceSignError } from "@/lib/fiscal/signing"
import { SefazDiretoProvider } from "@/lib/fiscal/provider/sefaz/sefaz-direto-provider"
import { SefazSoapTransport } from "@/lib/fiscal/provider/sefaz/sefaz-soap-transport"
import type { SefazGuardPorts, SefazXsdAttestation } from "@/lib/fiscal/provider/sefaz/sefaz-guards"
import type { SefazTransport } from "@/lib/fiscal/provider/sefaz/sefaz-transport.types"
import { drainFiscalQueue } from "@/lib/fiscal/queue/queue-worker"
import {
  createPrismaFiscalQueueWorkerPorts,
  eligibleWhere,
} from "@/lib/fiscal/queue/prisma-queue-worker"
import {
  createUncertainStateJobExecutor,
} from "@/lib/fiscal/emission/uncertain-state-job-executor"
import { createPrismaUncertainStatePersistence } from "@/lib/fiscal/emission/prisma-uncertain-state-persistence"
import { EXTERNAL_EXECUTION_DENIED } from "@/lib/fiscal/emission/uncertain-state.types"
import type {
  FiscalExternalExecutionCapability,
  FinalizedDocumentPreparer,
  UncertainStatePersistence,
} from "@/lib/fiscal/emission/uncertain-state.types"
import type {
  FiscalQueueExecutionResult,
  FiscalQueueJob,
  FiscalQueueWorkerPorts,
} from "@/lib/fiscal/queue/queue.types"
import {
  CONTINGENCY_HOMOLOGATION_WINDOW,
  consumeContingencyDrillActivation,
  contingencyDrillCapability,
  evaluateContingencyHomologationWindow,
  type ContingencyDrillLedgerClient,
  type ContingencyHomologationWindowConfig,
} from "./contingency-homologation-gate"
import { fiscalBytesSha256 } from "./offline-contingency"

type Row = Record<string, unknown>

type DrillPrismaClient = {
  $transaction: <T>(fn: (tx: never) => Promise<T>) => Promise<T>
  fiscalEmissaoJob: {
    findUnique: (args: unknown) => Promise<unknown | null>
    findFirst: (args: unknown) => Promise<unknown | null>
    updateMany: (args: unknown) => Promise<{ count: number }>
    create: (args: unknown) => Promise<unknown>
  }
  fiscalLog: {
    findFirst: (args: unknown) => Promise<unknown | null>
    findMany: (args: unknown) => Promise<unknown[]>
    create: (args: unknown) => Promise<unknown>
  }
  configuracaoFiscalLoja: {
    findUnique: (args: unknown) => Promise<unknown | null>
  }
  notaFiscal: {
    findFirst: (args: unknown) => Promise<unknown | null>
    updateMany: (args: unknown) => Promise<{ count: number }>
  }
  venda: {
    updateMany: (args: unknown) => Promise<{ count: number }>
  }
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {}
}

function texto(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

const DRILL_JOB_SELECT = {
  id: true,
  storeId: true,
  vendaId: true,
  notaFiscalId: true,
  tipo: true,
  status: true,
  tentativas: true,
  maxTentativas: true,
  proximaTentativaEm: true,
  prioridade: true,
  lockOwner: true,
  lockedAt: true,
  lockExpiresAt: true,
  dedupeKey: true,
  payload: true,
  ultimoErro: true,
  concluidoEm: true,
  createdAt: true,
  updatedAt: true,
} as const

/**
 * Portas D4 do drill — mesmo contrato do runtime de cancelamento (GOAL 018):
 * piloto resolvido do registro fiscal da própria loja (nunca literal) e
 * certificado pelo resolver 016D-A0. O atestado XSD é porta INJETADA e o
 * default é `null` ⇒ guard 8 bloqueia (fail-closed; jamais presumido).
 */
export function createContingencyDrillSefazGuardPorts(
  client: DrillPrismaClient,
  storeId: string,
  deps: {
    readXsdAttestation?: SefazGuardPorts["readXsdAttestation"]
    resolveCertificate?: (params: { storeId: string }) => Promise<ResolveActiveCertificateResult>
  } = {},
): SefazGuardPorts {
  return {
    resolvePilotStoreId: async () => {
      const row = record(
        await client.configuracaoFiscalLoja.findUnique({
          where: { storeId },
          select: { storeId: true, provider: true },
        }),
      )
      if (texto(row.provider) !== "SEFAZ_DIRETO") return null
      const id = texto(row.storeId) || storeId
      return id || null
    },
    loadFiscalConfig: async (id) => {
      const row = record(
        await client.configuracaoFiscalLoja.findUnique({
          where: { storeId: id },
          select: { provider: true },
        }),
      )
      const provider = texto(row.provider)
      return provider ? { provider } : null
    },
    readXsdAttestation:
      deps.readXsdAttestation ??
      (async (): Promise<SefazXsdAttestation | null> => {
        return null
      }),
    resolveActiveCertificate: (params) =>
      (deps.resolveCertificate ?? resolveActiveCertificate)({ storeId: params.storeId }),
  }
}

/** Preparer que NUNCA prepara: o drill só transmite bytes já persistidos. */
const REFUSING_DRILL_PREPARER: FinalizedDocumentPreparer = {
  async prepare() {
    throw new NfceSignError(
      "material_ausente",
      "Drill de contingência não compõe documento; somente os bytes persistidos são transmitidos.",
    )
  },
}

export type ContingencyDrillWiringDeps = {
  readonly client?: DrillPrismaClient
  readonly ledgerClient?: ContingencyDrillLedgerClient
  readonly window?: ContingencyHomologationWindowConfig
  readonly clock?: () => Date
  readonly persistence?: UncertainStatePersistence
  readonly transport?: SefazTransport
  readonly readXsdAttestation?: SefazGuardPorts["readXsdAttestation"]
  readonly resolveCertificate?: (params: { storeId: string }) => Promise<ResolveActiveCertificateResult>
}

export type ContingencyDrillWiring = {
  /** Executa SOMENTE o job autorizado; qualquer outro input é terminal negado. */
  readonly execute: (job: FiscalQueueJob) => Promise<FiscalQueueExecutionResult>
  /** Ports do worker com aquisição restrita ao job autorizado. */
  readonly ports: FiscalQueueWorkerPorts
}

/**
 * Wiring POR EXECUÇÃO: nasce preso ao par (jobId, storeId) autorizado e a
 * capability positiva — quando existir — nasce do consumo one-shot dentro de
 * `execute`. Nenhuma instância é global; nada é reutilizável entre jobs.
 */
export function createContingencyHomologationDrillWiring(input: {
  readonly jobId: string
  readonly storeId: string
  readonly deps?: ContingencyDrillWiringDeps
}): ContingencyDrillWiring {
  const client = input.deps?.client ?? (prisma as unknown as DrillPrismaClient)
  const ledgerClient = input.deps?.ledgerClient ?? (client as unknown as ContingencyDrillLedgerClient)
  const windowConfig = input.deps?.window ?? CONTINGENCY_HOMOLOGATION_WINDOW
  const clock = input.deps?.clock ?? (() => new Date())
  const basePersistence = input.deps?.persistence ?? createPrismaUncertainStatePersistence(client as never)
  /**
   * `uf` e `correlationId` são metadados de GUARDE de transporte (D4 itens 4/4b),
   * nunca bytes fiscais: `uf` vem da configuração fiscal da loja e o
   * correlationId identifica o drill pelo job autorizado. Os bytes transmitidos
   * continuam sendo EXATAMENTE os persistidos na entrada em contingência.
   */
  const enriquecer = async (document: Awaited<ReturnType<UncertainStatePersistence["load"]>>) => {
    if (!document || (document.uf && document.correlationId)) return document
    const configRow = record(
      await client.configuracaoFiscalLoja.findUnique({
        where: { storeId: document.storeId },
        select: { uf: true },
      }),
    )
    return {
      ...document,
      uf: document.uf ?? (texto(configRow.uf) || undefined),
      correlationId: document.correlationId ?? `contingencia-drill:${input.jobId}`,
    }
  }
  const persistence: UncertainStatePersistence = {
    ...basePersistence,
    load: async (locator) => enriquecer(await basePersistence.load(locator)),
    // A transição CONTINGENCIA→TRANSMITINDO RECARREGA o documento no adapter;
    // o enriquecimento precisa sobreviver a ela (uf/correlationId são metadados
    // de guarda, jamais bytes).
    beginTransmission: basePersistence.beginTransmission
      ? async (transitionInput) => {
          const next = await basePersistence.beginTransmission!(transitionInput)
          return (await enriquecer(next)) as NonNullable<typeof next>
        }
      : undefined,
  }
  const guardPorts = createContingencyDrillSefazGuardPorts(client, input.storeId, {
    readXsdAttestation: input.deps?.readXsdAttestation,
    resolveCertificate: input.deps?.resolveCertificate,
  })
  const provider = new SefazDiretoProvider({
    ports: guardPorts,
    transport: input.deps?.transport ?? new SefazSoapTransport(),
  })

  const execute = async (job: FiscalQueueJob): Promise<FiscalQueueExecutionResult> => {
    const negado = (code: string, mensagem: string): FiscalQueueExecutionResult => ({
      kind: "terminal",
      code,
      mensagem,
      simulado: false,
      externalTransmissionAttempted: false,
      providerInvoked: false,
    })
    // 1 — tipo e coerência jobId/storeId (o caller só identifica o job).
    if (job.tipo !== "CONTINGENCIA_TRANSMISSAO") {
      return negado("drill_tipo_nao_suportado", "Drill executa somente CONTINGENCIA_TRANSMISSAO.")
    }
    if (job.id !== input.jobId || job.storeId !== input.storeId) {
      return negado("drill_job_incoerente", "Job não corresponde ao autorizado para este drill.")
    }
    // 2 — loja-piloto RESOLVIDA (nunca literal).
    const pilotStoreId = texto(await guardPorts.resolvePilotStoreId())
    if (!pilotStoreId || pilotStoreId !== job.storeId) {
      return negado("loja_fora_do_piloto", "Loja do job não é a loja-piloto resolvida.")
    }
    // 3 — configuração do piloto.
    const config = record(
      await client.configuracaoFiscalLoja.findUnique({
        where: { storeId: job.storeId },
        select: { provider: true, ambiente: true, modeloFiscal: true, fiscalEnabled: true },
      }),
    )
    if (
      texto(config.provider) !== "SEFAZ_DIRETO" ||
      texto(config.ambiente) !== "HOMOLOGACAO" ||
      texto(config.modeloFiscal) !== "NFCE" ||
      config.fiscalEnabled !== true
    ) {
      return negado(
        "contexto_piloto_invalido",
        "Configuração da loja fora do piloto NFCE/HOMOLOGACAO/SEFAZ_DIRETO.",
      )
    }
    // 4 — gate efêmero vigente (dormente/parcial/futura/expirada bloqueiam).
    const windowStatus = evaluateContingencyHomologationWindow(windowConfig, clock())
    if (!windowStatus.active) {
      return negado(
        `drill_gate_${windowStatus.reason}`,
        "Gate efêmero da contingência não está vigente; transmissão bloqueada.",
      )
    }
    // 5 — documento persistido, bytes íntegros (SHA-256 antes de qualquer rede).
    const locator = {
      storeId: job.storeId,
      vendaId: job.vendaId,
      notaFiscalId: String(job.notaFiscalId ?? ""),
    }
    if (!locator.notaFiscalId) {
      return negado("nota_fiscal_ausente", "Job sem notaFiscalId; drill fail-closed.")
    }
    const document = await persistence.load(locator)
    if (!document || document.status !== "CONTINGENCIA" || !document.xmlAssinado) {
      return negado(
        "drill_documento_nao_contingencia",
        "Documento não está persistido em CONTINGENCIA; drill recusado.",
      )
    }
    const payloadDocument = record(record(job.payload).document)
    const declaredHash = texto(payloadDocument.bytesSha256).toLowerCase()
    const actualHash = fiscalBytesSha256(new TextEncoder().encode(document.xmlAssinado))
    if (!declaredHash || declaredHash !== actualHash) {
      return negado(
        "drill_bytes_divergentes",
        "SHA-256 do payload diverge dos bytes persistidos; transmissão recusada.",
      )
    }
    // 6 — consumo one-shot ANTES da rede (replay/cold start/concorrência não retransmitem).
    const consumed = await consumeContingencyDrillActivation(
      ledgerClient,
      windowConfig,
      {
        jobId: job.id,
        storeId: job.storeId,
        notaFiscalId: document.notaFiscalId,
        operatorId: "fiscal-contingencia-drill",
      },
      clock,
    )
    if (!consumed.ok) {
      return negado(
        consumed.code === "window_unavailable"
          ? "drill_gate_window_unavailable"
          : "drill_activation_ja_consumida",
        "Ativação do drill indisponível ou já consumida; nenhum transporte autorizado.",
      )
    }
    // 7 — capability positiva POR EXECUÇÃO (binding opaco; nunca global).
    const capability: FiscalExternalExecutionCapability | null = contingencyDrillCapability(
      consumed.activation,
      { jobId: job.id, storeId: job.storeId },
    )
    if (!capability || !capability.allowExternalProviderExecution) {
      return negado(
        "drill_capability_indisponivel",
        "Capability de execução não nasceu do consumo da ativação; bloqueado.",
      )
    }
    // 8 — executor GOAL-012 canônico: coordinator transmite os bytes exatos,
    // jamais chama prepare e jamais cria numeração. Guards D4 rodam no provider.
    const executor = createUncertainStateJobExecutor({
      persistence,
      preparer: REFUSING_DRILL_PREPARER,
      provider,
      now: clock,
      capability,
    })
    return executor(job)
  }

  // Ports do worker canônico com o executor do drill no lugar do executor
  // padrão — o dispatch da fila continua idêntico (CONTINGENCIA_TRANSMISSAO
  // jamais vai ao emissor legado).
  const ports = createPrismaFiscalQueueWorkerPorts(
    client as never,
    async () => {
      throw new Error("Emissor legado inacessível no drill de contingência.")
    },
    execute,
  )
  const scopedPorts: FiscalQueueWorkerPorts = {
    ...ports,
    // Aquisição restrita: CAS com as MESMAS condições de elegibilidade da fila,
    // fixado ao (id, storeId, tipo) autorizado. Nenhum outro job é tocado.
    acquireNextJob: async (acquireInput) => {
      const where = {
        AND: [
          { id: input.jobId, storeId: input.storeId, tipo: "CONTINGENCIA_TRANSMISSAO" },
          eligibleWhere(acquireInput.now, acquireInput.pausedStoreIds),
        ],
      }
      const acquired = await client.fiscalEmissaoJob.updateMany({
        where,
        data: {
          status: "PROCESSANDO",
          lockOwner: acquireInput.workerId,
          lockedAt: acquireInput.now,
          lockExpiresAt: new Date(acquireInput.now.getTime() + acquireInput.leaseMs),
          tentativas: { increment: 1 },
        },
      })
      if (acquired.count !== 1) return null
      const locked = record(
        await client.fiscalEmissaoJob.findUnique({
          where: { id: input.jobId },
          select: DRILL_JOB_SELECT,
        }),
      )
      if (!locked.id) return null
      return {
        job: {
          id: String(locked.id ?? ""),
          storeId: String(locked.storeId ?? ""),
          vendaId: String(locked.vendaId ?? ""),
          notaFiscalId: locked.notaFiscalId == null ? null : String(locked.notaFiscalId),
          tipo: String(locked.tipo ?? "") as FiscalQueueJob["tipo"],
          status: String(locked.status ?? "") as FiscalQueueJob["status"],
          tentativas: Number(locked.tentativas ?? 0),
          maxTentativas: Number(locked.maxTentativas ?? 5),
          proximaTentativaEm: locked.proximaTentativaEm instanceof Date ? locked.proximaTentativaEm : null,
          prioridade: Number(locked.prioridade ?? 0),
          lockOwner: locked.lockOwner == null ? null : String(locked.lockOwner),
          lockedAt: locked.lockedAt instanceof Date ? locked.lockedAt : null,
          lockExpiresAt: locked.lockExpiresAt instanceof Date ? locked.lockExpiresAt : null,
          dedupeKey: locked.dedupeKey == null ? null : String(locked.dedupeKey),
          payload: Object.keys(record(locked.payload)).length > 0 ? record(locked.payload) : null,
          ultimoErro: locked.ultimoErro == null ? null : String(locked.ultimoErro),
          concluidoEm: locked.concluidoEm instanceof Date ? locked.concluidoEm : null,
          createdAt: locked.createdAt instanceof Date ? locked.createdAt : new Date(0),
          updatedAt: locked.updatedAt instanceof Date ? locked.updatedAt : new Date(0),
        },
        takeover: false,
      }
    },
  }

  return { execute, ports: scopedPorts }
}

export type ContingencyDrillRunReport = {
  readonly ok: boolean
  readonly code: string
  readonly mensagem: string
  /** Desfecho sanitizado do item drenado (status + mensagem da fila; nunca segredo nem bytes). */
  readonly outcome: {
    readonly status: string
    readonly mensagem: string
  } | null
}

/**
 * Runner do drill: valida o job apontado, monta o wiring POR EXECUÇÃO e drena
 * EXATAMENTE um job — o autorizado — pelo pipeline canônico da fila.
 */
export async function executeContingencyHomologationDrillTransmission(
  input: {
    readonly jobId: string
    readonly storeId: string
    readonly workerId?: string
  },
  deps: ContingencyDrillWiringDeps = {},
): Promise<ContingencyDrillRunReport> {
  const jobId = input.jobId.trim()
  const storeId = input.storeId.trim()
  if (!jobId || !storeId) {
    return { ok: false, code: "parametros_invalidos", mensagem: "jobId e storeId são obrigatórios.", outcome: null }
  }
  const client = deps.client ?? (prisma as unknown as DrillPrismaClient)
  const jobRow = record(
    await client.fiscalEmissaoJob.findUnique({ where: { id: jobId }, select: DRILL_JOB_SELECT }),
  )
  if (!jobRow.id) {
    return { ok: false, code: "job_nao_encontrado", mensagem: "Job do drill não encontrado.", outcome: null }
  }
  if (String(jobRow.storeId ?? "") !== storeId) {
    return { ok: false, code: "drill_job_incoerente", mensagem: "Job pertence a outra loja.", outcome: null }
  }
  if (String(jobRow.tipo ?? "") !== "CONTINGENCIA_TRANSMISSAO") {
    return {
      ok: false,
      code: "drill_tipo_nao_suportado",
      mensagem: "Somente job CONTINGENCIA_TRANSMISSAO pode ser apontado ao drill.",
      outcome: null,
    }
  }

  const wiring = createContingencyHomologationDrillWiring({ jobId, storeId, deps })
  const report = await drainFiscalQueue(
    {
      workerId:
        input.workerId?.trim() ||
        `contingencia-drill:${jobId.slice(0, 8)}`,
      batchSize: 1,
      now: deps.clock,
    },
    wiring.ports,
  )
  const item = report.items[0]
  return {
    ok: item?.status === "concluido",
    code: item?.status ?? "drill_sem_execucao",
    mensagem:
      item?.status === "concluido"
        ? "Drill executado pelo pipeline da fila."
        : "Drill terminou sem conclusão; ver o desfecho do item drenado.",
    outcome: item ? { status: item.status, mensagem: item.mensagem } : null,
  }
}
