/**
 * Recebimento de VÁRIOS títulos de Contas a Receber numa única operação lógica
 * (GOAL `PDV-RECEBIMENTO-MULTITITULO-BACKEND-003` · G2).
 *
 * Este módulo é a camada de domínio do lote — a rota só faz HTTP. Tudo aqui roda
 * DENTRO da `$transaction` do chamador (`Prisma.TransactionClient` obrigatório): não há
 * fallback para o singleton global, porque um lançamento fora da transação não voltaria
 * atrás no rollback.
 *
 * Invariantes:
 *  - **Atômico.** Qualquer recusa vira `RecebimentoLoteError` LANÇADO — nunca um retorno
 *    de erro. Retornar erro de dentro de `$transaction` faria o Prisma COMMITAR o que já
 *    tivesse sido escrito; lançar é o que garante "zero títulos alterados, zero
 *    movimentações, zero CaixaOperacao".
 *  - **Saldo revalidado no servidor.** `saldoEsperado` do cliente é só uma asserção de
 *    concorrência: o saldo real vem do ledger (`buildContaReceberAuditTrail`) lido dentro
 *    da transação. O total também é recalculado aqui — o cliente não envia total.
 *  - **Idempotência do lote** por advisory lock transacional + `payload.localId`
 *    determinístico da `CaixaOperacao`. Sem `Date.now()`, escopado por loja e sessão.
 *  - **Um lançamento financeiro por título**, com `referenciaId = titulo.id` (apropriação
 *    individual preservada para relatórios e estorno) e **uma única** `CaixaOperacao`
 *    consolidada, compatível com o fechamento do caixa.
 *  - **Distribuição explícita.** O servidor aplica exatamente o que recebeu por item; não
 *    existe "mais antigos primeiro" aqui — esse cálculo é da UI (G3).
 */
import type { Prisma } from "@/generated/prisma"
import { PAY_EPS, safeMoney } from "@/lib/financeiro/contracts/valores"
import { RECEBER_STATUS, normalizeReceberStatus } from "@/lib/financeiro/contracts/status"
import {
  buildContaReceberAuditTrail,
  liquidarContaReceber,
  registrarPagamentoParcial,
} from "@/lib/financeiro/services/contas-receber-service"
import { createMovimentacaoEntradaFromReceber } from "@/lib/financeiro/services/movimentacoes-service"
import { recalcularSaldoCarteira } from "@/lib/financeiro/services/carteiras-service"

/** O lote SEMPRE roda dentro da transação do chamador — nunca no singleton global. */
export type RecebimentoLoteTx = Prisma.TransactionClient

/**
 * Teto de itens por lote.
 *
 * Evidência: a app conecta via pgBouncer em modo transação com `connection_limit=1`
 * (`.env.example:11`). Uma transação interativa fixa a conexão enquanto dura, então o
 * lote precisa ser curto. Com 25 itens o pior caso é ~85 queries (1 leitura em bloco +
 * 3 por título + recálculo por carteira distinta + a operação de caixa) — folgado dentro
 * do `timeout` de 15 s herdado do G1, e ainda assim um teto que a UI de PDV não alcança.
 */
export const RECEBIMENTO_LOTE_MAX_ITENS = 25

export const RECEBIMENTO_LOTE_LOCAL_ID_PREFIX = "pdv-rc-lote"

/**
 * `idempotencyKey` é a ÚNICA identidade do lote: dois lotes distintos com a mesma chave
 * na mesma sessão colapsam num replay — e o segundo pagamento some. Por isso a chave é
 * exigida opaca e longa (o cliente gera um UUID), e sem `:` para não ser possível forjar
 * um `localId` que se pareça com o de outra loja/sessão.
 */
export const RECEBIMENTO_LOTE_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{8,120}$/

export type RecebimentoLoteItemInput = {
  /** Conferência extra: se vier, precisa bater com o título achado por `localKey`. */
  tituloId?: string
  localKey: string
  saldoEsperado: number
  valorReceber: number
}

/**
 * Contexto do lote. Os itens NÃO vêm aqui: chegam a `executarRecebimentoLote` já
 * normalizados por `validarRecebimentoLote`, para que não exista caminho em que a
 * execução veja um item que o contrato não aprovou.
 */
export type RecebimentoLoteInput = {
  storeId: string
  sessaoId: string
  formaPagamento: string
  observacao?: string
  idempotencyKey: string
  userLabel: string
}

export type RecebimentoLoteItemResultado = {
  tituloId: string
  localKey: string
  saldoAntes: number
  valorRecebido: number
  saldoDepois: number
  statusFinal: string
}

export type RecebimentoLoteResultado = {
  /** `true` = o lote já estava registrado; nada foi gravado de novo. */
  jaRegistrado: boolean
  localId: string
  sessaoId: string
  totalRecebido: number
  itens: RecebimentoLoteItemResultado[]
}

export type RecebimentoLoteDetalhe = {
  localKey: string
  motivo: string
  saldoReal?: number
  saldoEsperado?: number
}

export type RecebimentoLoteErrorCode =
  | "caixa_fechado"
  | "saldo_divergente"
  | "titulo_alterado"
  | "movimentacao_financeira_falhou"

/**
 * Recusa do lote. É LANÇADA (não devolvida) para abortar a transação inteira; a rota a
 * converte em HTTP. `status` acompanha o código para que a rota não precise reimplementar
 * o mapeamento.
 */
export class RecebimentoLoteError extends Error {
  readonly code: RecebimentoLoteErrorCode
  readonly status: number
  readonly detalhes: RecebimentoLoteDetalhe[]

  constructor(
    code: RecebimentoLoteErrorCode,
    status: number,
    message: string,
    detalhes: RecebimentoLoteDetalhe[] = [],
  ) {
    super(message)
    this.name = "RecebimentoLoteError"
    this.code = code
    this.status = status
    this.detalhes = detalhes
  }
}

export function isRecebimentoLoteError(e: unknown): e is RecebimentoLoteError {
  return e instanceof RecebimentoLoteError
}

// ─── validação pura (sem banco) ───────────────────────────────────────────────

export type RecebimentoLoteValidacaoCode =
  | "lote_vazio"
  | "lote_excede_teto"
  | "item_duplicado"
  | "valor_invalido"
  | "saldo_esperado_insuficiente"
  | "idempotency_key_invalida"

export type RecebimentoLoteItemNormalizado = {
  tituloId?: string
  localKey: string
  saldoEsperado: number
  valorReceber: number
}

export type RecebimentoLoteValidacao =
  | { ok: true; itens: RecebimentoLoteItemNormalizado[]; totalReceber: number }
  | { ok: false; code: RecebimentoLoteValidacaoCode; mensagem: string; detalhes: RecebimentoLoteDetalhe[] }

function trim(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

/**
 * Contrato do lote antes de qualquer I/O: chave de idempotência, teto, duplicidade e
 * coerência dos valores. Nome/documento/telefone NÃO são chave financeira — só
 * `localKey` (e `tituloId` como conferência) entram aqui.
 *
 * Os valores são normalizados em centavos (`safeMoney`) na entrada: isso faz o corte
 * "quita o título" ser exato mais adiante, em vez de depender do epsilon.
 */
export function validarRecebimentoLote(input: {
  idempotencyKey: string
  itens: RecebimentoLoteItemInput[]
}): RecebimentoLoteValidacao {
  if (!RECEBIMENTO_LOTE_IDEMPOTENCY_KEY_PATTERN.test(trim(input.idempotencyKey))) {
    return {
      ok: false,
      code: "idempotency_key_invalida",
      mensagem: "idempotencyKey deve ter de 8 a 120 caracteres [A-Za-z0-9._-].",
      detalhes: [],
    }
  }

  const itens = Array.isArray(input.itens) ? input.itens : []
  if (itens.length === 0) {
    return { ok: false, code: "lote_vazio", mensagem: "Informe ao menos um título.", detalhes: [] }
  }
  if (itens.length > RECEBIMENTO_LOTE_MAX_ITENS) {
    return {
      ok: false,
      code: "lote_excede_teto",
      mensagem: `Máximo de ${RECEBIMENTO_LOTE_MAX_ITENS} títulos por lote.`,
      detalhes: [],
    }
  }

  const vistosLocalKey = new Set<string>()
  const vistosTituloId = new Set<string>()
  const normalizados: RecebimentoLoteItemNormalizado[] = []
  let total = 0

  for (const raw of itens) {
    const localKey = trim(raw?.localKey)
    if (!localKey) {
      return { ok: false, code: "valor_invalido", mensagem: "localKey é obrigatório em todos os itens.", detalhes: [] }
    }
    if (vistosLocalKey.has(localKey)) {
      return {
        ok: false,
        code: "item_duplicado",
        mensagem: "O mesmo título aparece mais de uma vez no lote.",
        detalhes: [{ localKey, motivo: "duplicado" }],
      }
    }
    vistosLocalKey.add(localKey)

    const tituloId = trim(raw?.tituloId) || undefined
    if (tituloId) {
      if (vistosTituloId.has(tituloId)) {
        return {
          ok: false,
          code: "item_duplicado",
          mensagem: "O mesmo título aparece mais de uma vez no lote.",
          detalhes: [{ localKey, motivo: "duplicado" }],
        }
      }
      vistosTituloId.add(tituloId)
    }

    const valorReceber = safeMoney(raw?.valorReceber)
    const saldoEsperado = safeMoney(raw?.saldoEsperado)
    if (!(valorReceber > PAY_EPS)) {
      return {
        ok: false,
        code: "valor_invalido",
        mensagem: "valorReceber deve ser maior que zero.",
        detalhes: [{ localKey, motivo: "valor_invalido" }],
      }
    }
    if (!(saldoEsperado >= 0)) {
      return {
        ok: false,
        code: "valor_invalido",
        mensagem: "saldoEsperado não pode ser negativo.",
        detalhes: [{ localKey, motivo: "valor_invalido" }],
      }
    }
    if (valorReceber > saldoEsperado + PAY_EPS) {
      return {
        ok: false,
        code: "saldo_esperado_insuficiente",
        mensagem: "valorReceber não pode exceder o saldoEsperado do título.",
        detalhes: [{ localKey, motivo: "valor_maior_que_saldo", saldoEsperado }],
      }
    }

    normalizados.push({ tituloId, localKey, saldoEsperado, valorReceber })
    total = safeMoney(total + valorReceber)
  }

  return { ok: true, itens: normalizados, totalReceber: total }
}

/**
 * Identidade determinística do lote — mesma família do `localId` singular
 * (`pdv-rc:<storeId>:<sessaoId>:<chave>`), escopada por loja E sessão. Serve ao mesmo
 * tempo como chave do advisory lock e como `payload.localId` da `CaixaOperacao`.
 */
export function buildRecebimentoLoteLocalId(params: {
  storeId: string
  sessaoId: string
  idempotencyKey: string
}): string {
  return `${RECEBIMENTO_LOTE_LOCAL_ID_PREFIX}:${params.storeId}:${params.sessaoId}:${params.idempotencyKey.trim()}`
}

// ─── primitivas transacionais ─────────────────────────────────────────────────

/**
 * Advisory lock TRANSACIONAL do lote (primitive do PostgreSQL, sem schema novo).
 *
 * `findFirst(payload.localId)` sozinho não basta: dois POSTs simultâneos passam juntos
 * pela checagem e gravam dois lotes (P2-B do G1). O lock serializa as duas transações na
 * MESMA chave — a segunda só enxerga o estado depois do commit da primeira e cai no
 * replay. Chaves diferentes (outra loja, outra sessão, outro lote) não se bloqueiam.
 *
 * O cast `::text AS lock` é obrigatório: `pg_advisory_xact_lock()` devolve `void` e o
 * `$queryRaw` do Prisma não desserializa coluna void (P2010) — lição já paga na trilha
 * Fiscal (`wsdl-ephemeral-execution-window.ts`). Colisão de `hashtext` só aumenta espera;
 * a autoridade continua sendo o `localId` conferido logo depois.
 */
export async function recebimentoLoteAdvisoryLock(tx: RecebimentoLoteTx, dedupeKey: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${dedupeKey}))::text AS lock`
}

type SessaoCaixaTravada = { id: string; storeId: string; status: string }

/**
 * Relê a sessão de caixa DENTRO da transação e trava a linha (`FOR UPDATE`).
 *
 * Só reler não fecharia a corrida com `POST /api/ops/caixa/fechar`, que faz um `update`
 * em autocommit: o fechamento poderia commitar entre a leitura e a gravação do lote, e o
 * recebimento cairia numa sessão já fechada. Com a linha travada, o fechamento espera o
 * lote terminar — e se o fechamento chegou primeiro, esta leitura já enxerga `FECHADA` e
 * o lote inteiro é recusado.
 */
export async function lerSessaoCaixaParaAtualizacao(
  tx: RecebimentoLoteTx,
  storeId: string,
  sessaoId: string,
): Promise<SessaoCaixaTravada | null> {
  const rows = await tx.$queryRaw<SessaoCaixaTravada[]>`
    SELECT "id", "storeId", "status"::text AS status
    FROM "sessoes_caixa"
    WHERE "id" = ${sessaoId} AND "storeId" = ${storeId}
    FOR UPDATE
  `
  return Array.isArray(rows) && rows.length > 0 ? rows[0]! : null
}

// ─── execução ─────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

function carteiraIdDoPayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  const raw = payload.carteiraId
  return typeof raw === "string" && raw.trim() ? raw.trim() : null
}

type ItemPersistidoPayload = {
  tituloId: string
  localKey: string
  valor: number
  saldoAntes: number
  saldoDepois: number
  statusFinal: string
}

function lerItensPersistidos(payload: unknown): RecebimentoLoteItemResultado[] {
  if (!isRecord(payload) || !Array.isArray(payload.itens)) return []
  const out: RecebimentoLoteItemResultado[] = []
  for (const raw of payload.itens) {
    if (!isRecord(raw)) continue
    const item = raw as Partial<ItemPersistidoPayload>
    out.push({
      tituloId: typeof item.tituloId === "string" ? item.tituloId : "",
      localKey: typeof item.localKey === "string" ? item.localKey : "",
      saldoAntes: safeMoney(item.saldoAntes),
      valorRecebido: safeMoney(item.valor),
      saldoDepois: safeMoney(item.saldoDepois),
      statusFinal: typeof item.statusFinal === "string" ? item.statusFinal : "",
    })
  }
  return out
}

/**
 * Aplica o lote inteiro dentro da transação recebida.
 *
 * Ordem deliberada: lock → sessão travada → replay → carga e revalidação de TODOS os
 * títulos → escrita. Nada é gravado antes da última divergência possível ser descartada.
 */
export async function executarRecebimentoLote(
  tx: RecebimentoLoteTx,
  input: RecebimentoLoteInput,
  itens: RecebimentoLoteItemNormalizado[],
): Promise<RecebimentoLoteResultado> {
  const storeId = input.storeId
  const localId = buildRecebimentoLoteLocalId({
    storeId,
    sessaoId: input.sessaoId,
    idempotencyKey: input.idempotencyKey,
  })

  // 1. Serialização: PRIMEIRA instrução da transação, antes de qualquer leitura de estado.
  await recebimentoLoteAdvisoryLock(tx, localId)

  // 2. Sessão de caixa relida e travada dentro da transação.
  const sessao = await lerSessaoCaixaParaAtualizacao(tx, storeId, input.sessaoId)
  if (!sessao || sessao.status !== "ABERTA") {
    throw new RecebimentoLoteError(
      "caixa_fechado",
      409,
      "Sessão de caixa não encontrada ou já fechada. Abra o caixa no PDV.",
    )
  }

  // 3. Replay: depois do lock, a checagem é confiável mesmo com POSTs simultâneos.
  // O recorte por `sessaoId` é gratuito e não é redundante: o `localId` já carrega a
  // sessão, então nenhuma operação de outra sessão poderia casar — mas o filtro usa
  // `@@index([sessaoId])` e mantém a varredura do JSONB no tamanho de UMA sessão de
  // caixa, em vez de toda a história da loja. Transação sob advisory lock: quanto
  // menos ela varre, menos tempo segura a conexão do pooler.
  const jaRegistrado = await tx.caixaOperacao.findFirst({
    where: {
      storeId,
      sessaoId: sessao.id,
      tipo: "recebimento_cr",
      payload: { path: ["localId"], equals: localId },
    },
    select: { id: true, sessaoId: true, valor: true, payload: true },
  })
  if (jaRegistrado) {
    return {
      jaRegistrado: true,
      localId,
      sessaoId: jaRegistrado.sessaoId,
      totalRecebido: safeMoney(jaRegistrado.valor),
      itens: lerItensPersistidos(jaRegistrado.payload),
    }
  }

  // 4. Carga de TODOS os títulos numa leitura, já escopada pela loja.
  const localKeys = itens.map((i) => i.localKey)
  const titulos = await tx.contaReceberTitulo.findMany({
    where: { storeId, localKey: { in: localKeys } },
  })
  const porLocalKey = new Map(titulos.map((t) => [t.localKey ?? "", t]))

  // 5. Revalidação server-side ANTES de qualquer escrita.
  const divergencias: RecebimentoLoteDetalhe[] = []
  const alterados: RecebimentoLoteDetalhe[] = []
  const plano: Array<{
    titulo: (typeof titulos)[number]
    item: RecebimentoLoteItemNormalizado
    saldoReal: number
    quitaTitulo: boolean
  }> = []

  for (const item of itens) {
    const titulo = porLocalKey.get(item.localKey)
    if (!titulo) {
      alterados.push({ localKey: item.localKey, motivo: "titulo_nao_encontrado" })
      continue
    }
    if (item.tituloId && item.tituloId !== titulo.id) {
      alterados.push({ localKey: item.localKey, motivo: "titulo_id_divergente" })
      continue
    }

    const status = normalizeReceberStatus(titulo.status)
    if (
      status === RECEBER_STATUS.CANCELADO ||
      status === RECEBER_STATUS.ESTORNADO ||
      status === RECEBER_STATUS.PAGO
    ) {
      alterados.push({ localKey: item.localKey, motivo: `titulo_${status}` })
      continue
    }

    // Saldo canônico: valor − ledger do `payload.historico`. Nunca o status textual,
    // nunca o valor bruto da coluna.
    const saldoReal = buildContaReceberAuditTrail([titulo])[0]?.saldoAberto ?? 0
    if (!(saldoReal > PAY_EPS)) {
      alterados.push({ localKey: item.localKey, motivo: "titulo_sem_saldo", saldoReal })
      continue
    }
    if (Math.abs(saldoReal - item.saldoEsperado) > PAY_EPS) {
      divergencias.push({
        localKey: item.localKey,
        motivo: "saldo_esperado_divergente",
        saldoReal,
        saldoEsperado: item.saldoEsperado,
      })
      continue
    }
    if (item.valorReceber > saldoReal + PAY_EPS) {
      divergencias.push({
        localKey: item.localKey,
        motivo: "valor_maior_que_saldo",
        saldoReal,
        saldoEsperado: item.saldoEsperado,
      })
      continue
    }

    plano.push({ titulo, item, saldoReal, quitaTitulo: item.valorReceber + PAY_EPS >= saldoReal })
  }

  if (alterados.length > 0) {
    throw new RecebimentoLoteError(
      "titulo_alterado",
      409,
      "Um ou mais títulos mudaram de estado. Recarregue a lista e tente de novo.",
      alterados,
    )
  }
  if (divergencias.length > 0) {
    throw new RecebimentoLoteError(
      "saldo_divergente",
      409,
      "O saldo de um ou mais títulos mudou. Recarregue a lista e tente de novo.",
      divergencias,
    )
  }

  // 6. Preparação da escrita. O total NÃO é somado aqui: sai do que for de fato
  // aplicado (passo 9), para que o valor da CaixaOperacao seja igual à soma dos
  // lançamentos por construção, e não por argumento de arredondamento.
  const forma = input.formaPagamento
  const obsBase = trim(input.observacao)
  const observacao = obsBase
    ? `${obsBase} · PDV lote · ${forma}`
    : `Recebimento PDV (lote) · ${forma}`

  // 7. Escrita: título + histórico + UMA MovimentacaoFinanceira por título.
  /** `carteiraId` do payload → id validado na loja (ou `null`). Uma consulta por carteira. */
  const carteirasValidadas = new Map<string, string | null>()
  const carteirasAfetadas = new Set<string>()
  const resultados: RecebimentoLoteItemResultado[] = []

  for (const passo of plano) {
    const { titulo, item, saldoReal, quitaTitulo } = passo
    // `safeMoney` na entrada garante centavos exatos dos dois lados: quando o item quita
    // o título, `valorReceber === saldoReal` e o valor gravado no ledger é o mesmo do
    // caixa. Nunca o valor BRUTO da coluna.
    const valorAplicado = quitaTitulo ? saldoReal : item.valorReceber

    const res = quitaTitulo
      ? await liquidarContaReceber({
          storeId,
          id: titulo.id,
          observacao,
          formaPagamento: forma,
          userLabel: input.userLabel,
          loteId: input.idempotencyKey,
          db: tx,
        })
      : await registrarPagamentoParcial({
          storeId,
          id: titulo.id,
          valorPago: valorAplicado,
          observacao,
          formaPagamento: forma,
          userLabel: input.userLabel,
          loteId: input.idempotencyKey,
          db: tx,
        })
    if (!res.ok) {
      // O service é a autoridade final. Recusa aqui = o título mudou entre a
      // revalidação e a escrita — o lote inteiro cai.
      throw new RecebimentoLoteError("titulo_alterado", 409, "Título recusado na gravação.", [
        { localKey: item.localKey, motivo: res.reason, saldoReal },
      ])
    }

    const candidata = carteiraIdDoPayload(res.data.payload)
    let carteiraId: string | null = null
    if (candidata) {
      if (carteirasValidadas.has(candidata)) {
        carteiraId = carteirasValidadas.get(candidata) ?? null
      } else {
        const c = await tx.carteiraFinanceira.findFirst({
          where: { id: candidata, storeId, ativo: true },
          select: { id: true },
        })
        carteiraId = c?.id ?? null
        carteirasValidadas.set(candidata, carteiraId)
      }
    }

    const mov = await createMovimentacaoEntradaFromReceber(
      { id: res.data.id, storeId: res.data.storeId, descricao: res.data.descricao, cliente: res.data.cliente },
      valorAplicado,
      {
        parcial: !quitaTitulo,
        carteiraId,
        db: tx,
        // A idempotência do LOTE (advisory lock + `localId`) é a autoridade. A heurística
        // de soma do helper suprimiria uma segunda parcial legítima de mesmo valor —
        // dinheiro recebido que sumiria do financeiro.
        idempotenciaDoChamador: true,
        // Uma carteira recebe N lançamentos no mesmo lote; o recálculo (que varre todas as
        // movimentações dela) roda UMA vez por carteira, no fim.
        adiarRecalculoCarteira: true,
      },
    )
    if (!mov.ok) {
      throw new RecebimentoLoteError(
        "movimentacao_financeira_falhou",
        503,
        `Falha ao lançar a movimentação financeira (${mov.reason}).`,
        [{ localKey: item.localKey, motivo: mov.reason }],
      )
    }
    if (carteiraId) carteirasAfetadas.add(carteiraId)

    // Saldo depois vem do registro atualizado — não da subtração.
    const saldoDepois = buildContaReceberAuditTrail([res.data])[0]?.saldoAberto ?? 0
    resultados.push({
      tituloId: res.data.id,
      localKey: res.data.localKey ?? item.localKey,
      saldoAntes: saldoReal,
      valorRecebido: valorAplicado,
      saldoDepois,
      statusFinal: normalizeReceberStatus(res.data.status) ?? res.data.status,
    })
  }

  // 8. Total do SERVIDOR: soma do que foi realmente lançado, item a item. O cliente não
  // envia total; se enviasse, seria ignorado.
  const totalRecebido = resultados.reduce((acc, r) => safeMoney(acc + r.valorRecebido), 0)

  // 8.1. Saldo das carteiras afetadas: uma vez cada, no MESMO cliente transacional.
  for (const carteiraId of carteirasAfetadas) {
    await recalcularSaldoCarteira(carteiraId, storeId, tx)
  }

  // 9. UMA operação de caixa consolidada, com rastreabilidade de todos os títulos.
  const clienteRef = plano[0]?.titulo.cliente || plano[0]?.titulo.descricao || "Recebimento"
  const motivo =
    plano.length === 1
      ? `Recebimento CR — ${clienteRef} (${forma})`
      : `Recebimento CR — ${plano.length} títulos (${forma})`

  await tx.caixaOperacao.create({
    data: {
      sessaoId: sessao.id,
      storeId,
      tipo: "recebimento_cr",
      valor: totalRecebido,
      motivo: motivo.slice(0, 240),
      operador: input.userLabel,
      payload: {
        localId,
        origem: "pdv_lote",
        formaPagamento: forma,
        idempotencyKey: input.idempotencyKey,
        itens: resultados.map((r) => ({
          tituloId: r.tituloId,
          localKey: r.localKey,
          valor: r.valorRecebido,
          saldoAntes: r.saldoAntes,
          saldoDepois: r.saldoDepois,
          statusFinal: r.statusFinal,
        })),
      } as Prisma.InputJsonValue,
    },
  })

  return { jaRegistrado: false, localId, sessaoId: sessao.id, totalRecebido, itens: resultados }
}
