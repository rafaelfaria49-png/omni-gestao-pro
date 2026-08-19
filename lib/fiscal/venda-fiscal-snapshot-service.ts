/**
 * Serviço do Snapshot Fiscal da Venda (GOAL_005) — orquestração + persistência DORMENTE.
 *
 * Carrega Venda + itens + ConfiguracaoFiscalLoja + Cliente + Produtos (fiscal via
 * getProdutoFiscal — GOAL_004), monta o snapshot puro (venda-fiscal-snapshot) e grava
 * UMA `NotaFiscal` em estado RASCUNHO (vigente) + `NotaFiscalItem` congelados.
 *
 * DORMENTE de propósito:
 *  - NÃO emite, NÃO gera XML, NÃO chama provider/SEFAZ, NÃO numera (série/número ficam nulos).
 *  - NÃO altera `Venda.fiscalStatus` (permanece como está — zero mudança de comportamento).
 *  - NÃO toca PDV/Caixa/Financeiro/Estoque/Workspace/Configurações/finalizeSaleTransaction.
 *
 * Idempotência: 1 venda → 1 NotaFiscal vigente. Se já existir, retorna a existente.
 */
import { prisma } from "@/lib/prisma"
import { Prisma, StatusNotaFiscal, TipoEmissao } from "@/generated/prisma"
import { getProdutoFiscal } from "@/lib/produto-fiscal"
import {
  buildVendaFiscalSnapshot,
  resolveSnapshotLocalKey,
  type BuildSnapshotInput,
  type SnapshotErrorCode,
  type SnapshotItemInput,
  type SnapshotItemTributos,
  type SnapshotLojaInput,
  type VendaFiscalSnapshot,
} from "./venda-fiscal-snapshot"
import {
  computeSnapshotHash,
  SNAPSHOT_HASH_CONTRATO_VERSAO,
  SNAPSHOT_HASH_ALGORITHM,
} from "./venda-fiscal-snapshot-hash"

export type CreateVendaFiscalSnapshotResult =
  | {
      ok: true
      /** false quando já existia uma NotaFiscal vigente (idempotência — não duplicou). */
      created: boolean
      notaFiscalId: string
      localKey: string
      diagnostico: VendaFiscalSnapshot["diagnostico"] | null
      /** Hash SHA-256 determinístico do snapshot (presente quando `created=true`). */
      snapshotHash: string | null
      /** Versão do contrato de hash canonização (presente quando `created=true`). */
      hashContratoVersao: number | null
    }
  | {
      ok: false
      code: SnapshotErrorCode | "venda_nao_encontrada"
      error: string
      pendencias: string[]
    }

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim()
}
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

/**
 * Cria (ou retorna a existente) o snapshot fiscal da venda como NotaFiscal RASCUNHO.
 * Tudo dormente — nenhuma emissão.
 */
export async function createVendaFiscalSnapshot(params: {
  storeId: string
  vendaId: string
}): Promise<CreateVendaFiscalSnapshotResult> {
  const storeId = str(params.storeId)
  const vendaId = str(params.vendaId)
  if (!storeId || !vendaId) {
    return { ok: false, code: "venda_nao_encontrada", error: "Loja e venda são obrigatórias.", pendencias: [] }
  }

  // 1) Idempotência: já existe NotaFiscal vigente para esta venda? → não duplica.
  const existente = await prisma.notaFiscal.findFirst({
    where: { storeId, vendaId, vigente: true },
    select: { id: true, localKey: true, snapshotPagamento: true },
  })
  if (existente) {
    // Reextrai o hash persistido no JSONB (auditoria de imutabilidade — não recomputa).
    const sp = asRecord(existente.snapshotPagamento)
    const hashPersistido = typeof sp.hash === "string" ? sp.hash : null
    const contratoVersao = typeof sp.hashContratoVersao === "number" ? sp.hashContratoVersao : null
    return {
      ok: true,
      created: false,
      notaFiscalId: existente.id,
      localKey: existente.localKey ?? resolveSnapshotLocalKey(storeId, vendaId),
      diagnostico: null,
      snapshotHash: hashPersistido,
      hashContratoVersao: contratoVersao,
    }
  }

  // 2) Carrega a venda (escopada por loja) com itens e cliente.
  const venda = await prisma.venda.findFirst({
    where: { id: vendaId, storeId },
    select: {
      id: true,
      pedidoId: true,
      at: true,
      total: true,
      operador: true,
      terminalId: true,
      payload: true,
      cliente: {
        select: { name: true, kind: true, document: true, phone: true, email: true, city: true },
      },
      itens: {
        select: { id: true, inventoryId: true, nome: true, quantidade: true, precoUnitario: true, lineTotal: true },
      },
    },
  })
  if (!venda) {
    return { ok: false, code: "venda_nao_encontrada", error: "Venda não encontrada nesta loja.", pendencias: [] }
  }

  // 3) Identidade fiscal da loja (emitente).
  const config = await prisma.configuracaoFiscalLoja.findUnique({
    where: { storeId },
    select: {
      cnpj: true,
      razaoSocial: true,
      nomeFantasia: true,
      inscricaoEstadual: true,
      inscricaoMunicipal: true,
      regimeTributario: true,
      crt: true,
      ambiente: true,
      modeloFiscal: true,
      fiscalEnabled: true,
      logradouro: true,
      numero: true,
      complemento: true,
      bairro: true,
      codigoMunicipioIbge: true,
      municipio: true,
      uf: true,
      cep: true,
      codigoPais: true,
      fone: true,
      email: true,
    },
  })
  const loja: SnapshotLojaInput = config ? { ...config } : null

  // 4) Resolve a identidade fiscal de cada item via Produto (getProdutoFiscal — GOAL_004).
  const rawIds = Array.from(
    new Set(venda.itens.map((i) => str(i.inventoryId)).filter((x) => x.length > 0)),
  )
  const produtos =
    rawIds.length > 0
      ? await prisma.produto.findMany({
          where: { storeId, OR: [{ id: { in: rawIds } }, { sku: { in: rawIds } }, { barcode: { in: rawIds } }] },
          select: { id: true, sku: true, barcode: true, name: true, metadata: true },
        })
      : []

  type ProdRow = (typeof produtos)[number]
  const byId = new Map<string, ProdRow>()
  const bySku = new Map<string, ProdRow>()
  const byBarcode = new Map<string, ProdRow>()
  for (const p of produtos) {
    byId.set(p.id, p)
    if (p.sku) bySku.set(p.sku, p)
    if (p.barcode) byBarcode.set(p.barcode, p)
  }
  const resolveProduto = (invId: string): ProdRow | null =>
    byId.get(invId) ?? bySku.get(invId) ?? byBarcode.get(invId) ?? null

  const itensInput: SnapshotItemInput[] = venda.itens.map((it) => {
    const invId = str(it.inventoryId)
    const prod = invId ? resolveProduto(invId) : null
    const fiscal = getProdutoFiscal(prod ?? null)
    return {
      itemVendaId: it.id,
      produtoId: prod?.id ?? null,
      codigoProduto: str(prod?.sku) || invId,
      descricao: str(it.nome) || str(prod?.name),
      gtin: str(prod?.barcode),
      quantidade: num(it.quantidade),
      valorUnitario: num(it.precoUnitario),
      // Sem coluna de desconto por item (ItemVenda) — desconto é da venda (header).
      valorDesconto: 0,
      valorTotal: num(it.lineTotal),
      fiscal,
    }
  })

  // 5) Contexto da venda (pagamento/desconto/operador/terminal) a partir do payload.
  const payload = asRecord(venda.payload)
  const desconto =
    num(payload.discountTotal) || num(payload.discountReais) || 0
  const operador = str(venda.operador) || str(payload.cashierId)
  const terminal = str(venda.terminalId) || str(payload.terminalId)
  const paymentBreakdown =
    payload.paymentBreakdown && typeof payload.paymentBreakdown === "object"
      ? (payload.paymentBreakdown as Record<string, unknown>)
      : null
  const fiscalPaymentHandoff =
    payload.fiscalPaymentHandoff !== undefined ? payload.fiscalPaymentHandoff : undefined

  const cliente = venda.cliente
    ? {
        nome: str(venda.cliente.name),
        documento: str(venda.cliente.document),
        kind: str(venda.cliente.kind),
        telefone: str(venda.cliente.phone),
        email: str(venda.cliente.email),
        municipio: str(venda.cliente.city),
      }
    : null

  const buildInput: BuildSnapshotInput = {
    storeId,
    vendaId,
    loja,
    cliente,
    venda: {
      pedidoId: str(venda.pedidoId),
      data: venda.at,
      total: num(venda.total),
      desconto,
      operador,
      terminal,
      paymentBreakdown,
      fiscalPaymentHandoff,
    },
    itens: itensInput,
  }

  // 6) Monta o snapshot puro. Loja sem identidade / venda sem itens → erro controlado.
  const built = buildVendaFiscalSnapshot(buildInput)
  if (!built.ok) return built

  const { snapshot, localKey } = built

  // 6b) Hash determinístico do snapshot (SHA-256 canonizado, sem `geradoEm`).
  //     Persistido no JSONB `snapshotPagamento.hash` — NÃO exige schema novo.
  //     O hash é a assinatura de conteúdo do contrato congelado: idempotente e
  //     imutável enquanto o snapshot não for reescrito (o serviço NÃO reescreve).
  const snapshotHash = computeSnapshotHash(snapshot)

  // 7) Persiste UMA NotaFiscal RASCUNHO (dormente) + itens congelados, atômico.
  //    ambiente/modelo vêm das ENUMS da config (não da string do snapshot).
  // Tributação congelada (motor tax-engine, GOAL F2). Persistimos nos campos JÁ existentes:
  // ICMS por item + valor de tributos (Lei da Transparência) + total na nota; o detalhamento
  // completo (PIS/COFINS/situação/versão do motor) fica no JSONB `snapshotPagamento.tributacao`.
  // Hash + versão do contrato de hash + algoritmo também no JSONB `snapshotPagamento`
  // (campos novos no JSON, sem mudança de schema Prisma — apenas chaves adicionais).
  const snapshotPagamento = {
    versao: snapshot.versao,
    geradoEm: snapshot.geradoEm,
    hash: snapshotHash,
    hashAlgoritmo: SNAPSHOT_HASH_ALGORITHM,
    hashContratoVersao: SNAPSHOT_HASH_CONTRATO_VERSAO,
    venda: snapshot.venda,
    totais: snapshot.totais,
    diagnostico: snapshot.diagnostico,
    tributacao: snapshot.tributacao ?? null,
  }

  const tribByItem = new Map<number, SnapshotItemTributos>()
  for (const t of snapshot.tributacao?.itens ?? []) tribByItem.set(t.numeroItem, t)

  // Lei da Transparência (vTotTrib): soma dos aproximados. Baseline Simples (CSOSN 102) = 0.
  const valorTotalTributos = snapshot.tributacao?.totais.valorAproximadoTributos ?? 0

  try {
    const nota = await prisma.notaFiscal.create({
      data: {
        storeId,
        vendaId,
        modelo: config!.modeloFiscal,
        ambiente: config!.ambiente,
        tipoEmissao: TipoEmissao.NORMAL,
        status: StatusNotaFiscal.RASCUNHO,
        vigente: true,
        localKey,
        valorTotal: snapshot.totais.valorTotal,
        valorDesconto: snapshot.totais.valorDesconto,
        valorTotalTributos,
        snapshotEmitente: snapshot.emitente as unknown as Prisma.InputJsonValue,
        snapshotDestinatario: snapshot.destinatario as unknown as Prisma.InputJsonValue,
        snapshotPagamento: snapshotPagamento as unknown as Prisma.InputJsonValue,
        itens: {
          create: snapshot.itens.map((item) => {
            const trib = tribByItem.get(item.numeroItem)
            return {
              itemVendaId: item.itemVendaId,
              produtoId: item.produtoId,
              numeroItem: item.numeroItem,
              codigoProduto: item.codigoProduto,
              descricao: item.descricao,
              gtin: item.gtin || null,
              ncm: item.ncm,
              cest: item.cest || null,
              cfop: item.cfop,
              cst: item.cst || null,
              csosn: item.csosn || null,
              origemMercadoria: Number(item.origemMercadoria) || 0,
              unidadeComercial: item.unidadeComercial,
              quantidade: item.quantidade,
              valorUnitario: item.valorUnitario,
              valorBruto: round2(item.quantidade * item.valorUnitario),
              valorDesconto: item.valorDesconto,
              valorTotal: item.valorTotal,
              // Tributos congelados (Simples baseline = 0; preenchidos pelo motor).
              baseCalculoIcms: trib?.icms.baseCalculo ?? 0,
              aliquotaIcms: trib?.icms.aliquota ?? 0,
              valorIcms: trib?.icms.valor ?? 0,
              valorTributos: trib?.valorAproximadoTributos ?? 0,
            }
          }),
        },
      },
      select: { id: true },
    })

    return {
      ok: true,
      created: true,
      notaFiscalId: nota.id,
      localKey,
      diagnostico: snapshot.diagnostico,
      snapshotHash,
      hashContratoVersao: SNAPSHOT_HASH_CONTRATO_VERSAO,
    }
  } catch (e) {
    // Corrida: outra requisição criou a NotaFiscal vigente/localKey ao mesmo tempo.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await prisma.notaFiscal.findFirst({
        where: { storeId, vendaId, vigente: true },
        select: { id: true, localKey: true, snapshotPagamento: true },
      })
      if (existing) {
        const sp = asRecord(existing.snapshotPagamento)
        const hashPersistido = typeof sp.hash === "string" ? sp.hash : null
        const contratoVersao = typeof sp.hashContratoVersao === "number" ? sp.hashContratoVersao : null
        return {
          ok: true,
          created: false,
          notaFiscalId: existing.id,
          localKey: existing.localKey ?? localKey,
          diagnostico: null,
          snapshotHash: hashPersistido,
          hashContratoVersao: contratoVersao,
        }
      }
    }
    throw e
  }
}
