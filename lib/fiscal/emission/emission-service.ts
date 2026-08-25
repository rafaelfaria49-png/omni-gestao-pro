/**
 * Serviço do Pipeline de Emissão Fiscal (GOAL_007) — orquestração de I/O DORMENTE.
 *
 * Carrega Venda (só `fiscalStatus`) + NotaFiscal VIGENTE (+ itens) + ConfiguracaoFiscalLoja,
 * reconstrói o snapshot congelado (sem ler Produto/Venda vivos), resolve o provider (GOAL_006)
 * e chama o pipeline puro injetando as portas (update de `Venda.fiscalStatus` + FiscalLog).
 *
 * NÃO emite XML/DANFE/QRCode, NÃO acessa a internet, NÃO toca PDV/Caixa/Financeiro/Estoque,
 * NÃO altera o snapshot nem o Produto. A ÚNICA escrita de negócio é `Venda.fiscalStatus`.
 * Só roda quando chamado explicitamente — nada é automático.
 */
import { prisma } from "@/lib/prisma"
import { FiscalStatusVenda } from "@/generated/prisma"
import { normalizeFiscalStatus } from "../venda-fiscal-state-machine"
import { resolveFiscalProvider } from "../provider/resolver"
import type { FiscalProvider, FiscalProviderConfigInput } from "../provider/types"
import { allocateFiscalNumber } from "../numbering/allocate-fiscal-number"
import { createPrismaFiscalNumberingPorts } from "../numbering/prisma-numbering-ports"
import { enqueueInutilizacao, JUSTIFICATIVA_LACUNA_PADRAO } from "../inutilizacao/enqueue"
import { createPrismaInutilizacaoPorts } from "../inutilizacao/prisma-ports"
import { runEmissionPipeline } from "./emission-pipeline"
import { recordFiscalEmissionLog } from "./emission-log"
import { reconstructSnapshotFromNota, type NotaFiscalRow } from "./snapshot-reader"
import type { EmissionInput, EmissionOutcome, EmissionPorts } from "./emission.types"

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim()
}

function buildErroOutcome(
  storeId: string,
  vendaId: string,
  code: EmissionOutcome["errorCode"],
  mensagem: string,
  anterior: FiscalStatusVenda,
): EmissionOutcome {
  return {
    ok: false,
    resultado: "erro",
    simulado: true,
    provider: "",
    fiscalStatusAnterior: anterior,
    fiscalStatusNovo: anterior,
    idempotente: false,
    notaFiscalId: null,
    dados: null,
    mensagem,
    pendencias: [],
    erros: [],
    errorCode: code,
    etapas: [],
    durationMs: 0,
  }
}

function toConfigInput(config: {
  provider: string
  ambiente: string
  modeloFiscal: string
  fiscalEnabled: boolean
  cnpj: string
  razaoSocial: string
  uf: string
  providerConfig: unknown
  providerTokenRef: string | null
  cscId: string
  cscTokenRef: string | null
} | null): FiscalProviderConfigInput {
  if (!config) return null
  return {
    provider: config.provider,
    ambiente: config.ambiente,
    modeloFiscal: config.modeloFiscal,
    fiscalEnabled: config.fiscalEnabled,
    cnpj: config.cnpj,
    razaoSocial: config.razaoSocial,
    uf: config.uf,
    providerConfig:
      config.providerConfig && typeof config.providerConfig === "object"
        ? (config.providerConfig as Record<string, unknown>)
        : null,
    providerTokenRef: config.providerTokenRef,
    cscId: config.cscId,
    cscTokenRef: config.cscTokenRef,
  }
}

/**
 * Executa o pipeline de emissão fiscal (SIMULADO) para uma venda. Idempotente:
 * se a venda já estiver AUTORIZADA/EMITINDO o pipeline não retransmite.
 */
export async function emitirNotaFiscalVenda(input: EmissionInput): Promise<EmissionOutcome> {
  const storeId = str(input.storeId)
  const vendaId = str(input.vendaId)
  const operador = input.operador ?? null

  if (!storeId || !vendaId) {
    return buildErroOutcome(storeId, vendaId, "venda_nao_encontrada", "Loja e venda são obrigatórias.", FiscalStatusVenda.NAO_FISCAL)
  }

  // 1) Venda (escopada por loja) — só o fiscalStatus; nada operacional/financeiro é tocado.
  const venda = await prisma.venda.findFirst({
    where: { id: vendaId, storeId },
    select: { id: true, fiscalStatus: true },
  })
  if (!venda) {
    return buildErroOutcome(storeId, vendaId, "venda_nao_encontrada", "Venda não encontrada nesta loja.", FiscalStatusVenda.NAO_FISCAL)
  }
  const anterior = normalizeFiscalStatus(venda.fiscalStatus)

  // 2 + 3) NotaFiscal VIGENTE com itens — é a fonte do snapshot congelado (não recria).
  const nota = (await prisma.notaFiscal.findFirst({
    where: { storeId, vendaId, vigente: true },
    select: {
      id: true,
      storeId: true,
      vendaId: true,
      modelo: true,
      ambiente: true,
      snapshotEmitente: true,
      snapshotDestinatario: true,
      snapshotPagamento: true,
      itens: {
        select: {
          itemVendaId: true,
          produtoId: true,
          numeroItem: true,
          codigoProduto: true,
          descricao: true,
          gtin: true,
          ncm: true,
          cest: true,
          cfop: true,
          cst: true,
          csosn: true,
          origemMercadoria: true,
          unidadeComercial: true,
          quantidade: true,
          valorUnitario: true,
          valorDesconto: true,
          valorTotal: true,
        },
        orderBy: { numeroItem: "asc" },
      },
    },
  })) as NotaFiscalRow | null

  // snapshot = null → o pipeline reporta "snapshot_inexistente" (e loga).
  const snapshot = nota ? reconstructSnapshotFromNota(nota) : null

  // 4) Identidade fiscal da loja (emitente) + resolução do provider.
  const config = await prisma.configuracaoFiscalLoja.findUnique({
    where: { storeId },
    select: {
      provider: true,
      ambiente: true,
      modeloFiscal: true,
      fiscalEnabled: true,
      cnpj: true,
      razaoSocial: true,
      uf: true,
      providerConfig: true,
      providerTokenRef: true,
      cscId: true,
      cscTokenRef: true,
    },
  })
  const configInput = toConfigInput(config)
  const resolved = resolveFiscalProvider(configInput)
  const provider: FiscalProvider | null = resolved.ok ? resolved.provider : null

  // 5) Portas: a ÚNICA escrita de negócio é Venda.fiscalStatus; o resto é trilha.
  //    A numeração (GOAL_008) toca apenas SerieFiscal (contador) + NotaFiscal (serie/numero).
  const notaId = nota?.id ?? null
  // Sem argumento: usa o singleton `prisma` (em teste, o módulo é mockado).
  const numberingPorts = createPrismaFiscalNumberingPorts()
  const ports: EmissionPorts = {
    setFiscalStatus: async (status: FiscalStatusVenda) => {
      await prisma.venda.update({ where: { id: vendaId }, data: { fiscalStatus: status } })
    },
    log: async (entry) => {
      await recordFiscalEmissionLog({ ...entry, storeId, vendaId, notaFiscalId: notaId, operador })
    },
    allocateNumero: async (ctx) =>
      allocateFiscalNumber({ storeId: ctx.storeId, notaFiscalId: ctx.notaFiscalId ?? "" }, numberingPorts),
    recordLacunasParaInutilizacao: async (lacunas) => {
      const portsInut = createPrismaInutilizacaoPorts()
      for (const gap of lacunas) {
        if (!gap.requerInutilizacao) continue
        await enqueueInutilizacao(
          {
            storeId: gap.storeId,
            vendaId,
            notaFiscalId: gap.notaFiscalId,
            serie: gap.serie,
            numeroInicial: gap.numero,
            numeroFinal: gap.numero,
            justificativa: JUSTIFICATIVA_LACUNA_PADRAO,
            motivo: "lacuna_numeracao",
            operador: operador ?? "fiscal-numbering",
          },
          portsInut,
        )
      }
    },
  }

  // 6) Pipeline puro.
  return runEmissionPipeline(
    {
      provider,
      providerTipo: configInput?.provider != null ? String(configInput.provider) : "",
      config: configInput,
      snapshot,
      currentFiscalStatus: anterior,
      notaFiscalId: notaId,
      resolveError: resolved.ok ? null : resolved.error,
      operador,
    },
    ports,
  )
}
