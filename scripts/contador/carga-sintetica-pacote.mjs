/**
 * Contador HUB · teste de CARGA SINTÉTICA da geração do pacote (GOAL 019).
 *
 * Executa a MESMA cadeia produtiva do pacote — paginação por cursor
 * (`carregarFontesPacoteComCliente`) → agregação → checklist → montagem dos arquivos
 * → guardas de segurança → ZIP — sobre massa gerada em memória.
 *
 * NUNCA toca banco: o `PacoteReaderClient` é injetado e responde a partir de arrays
 * sintéticos. Não há `DATABASE_URL`, não há Prisma no grafo, não há como este script
 * alcançar Production nem por engano de variável de ambiente. É a razão de ele medir
 * a cadeia por injeção em vez de semear um banco.
 *
 * Uso:
 *   npx tsx scripts/contador/carga-sintetica-pacote.mjs
 *   npx tsx scripts/contador/carga-sintetica-pacote.mjs --vendas=20000 --json
 *
 * O relatório traz o observado (linhas, duração, memória, bytes). NÃO existe SLA
 * numérico canônico para a geração do pacote no masterplan ou no roadmap — então o
 * script REGISTRA o resultado e não inventa threshold de aprovação. O único teto
 * comparado é o que já existe no código: `TIMEOUT_LOGICO_MS`.
 */
import { performance } from "node:perf_hooks"
import { resolvePeriodoUtc } from "@/lib/contador/competencia"
import { montarChecklistFechamento } from "@/lib/contador/fechamento"
import { carregarFontesPacoteComCliente } from "@/lib/contador/pacote/carregar-fontes"
import { montarConteudoPacote } from "@/lib/contador/pacote/builder"
import { montarDados } from "@/lib/contador/readers"
import { ziparArquivos } from "@/lib/contador/pacote/zip"
import { TIMEOUT_LOGICO_MS } from "@/lib/contador/pacote/seguranca"

const STORE_ID = "loja-carga-sintetica"
const USER_ID = "usuario-carga-sintetica"
const COMPETENCIA = { ano: 2026, mes: 3 }
const AGORA = new Date("2026-04-01T12:00:00.000Z")

function arg(nome, padrao) {
  const bruto = process.argv.find((a) => a.startsWith(`--${nome}=`))
  if (!bruto) return padrao
  const valor = Number(bruto.split("=")[1])
  return Number.isFinite(valor) && valor > 0 ? valor : padrao
}

/** PRNG determinístico: duas execuções produzem a MESMA massa e são comparáveis. */
function prng(semente) {
  let estado = semente >>> 0
  return () => {
    estado = (estado * 1664525 + 1013904223) >>> 0
    return estado / 0x1_0000_0000
  }
}

function pad(n, tamanho) {
  return String(n).padStart(tamanho, "0")
}

/** Massa sintética — sem PII: nomes são rótulos sequenciais, não pessoas. */
function gerarMassa(totalVendas) {
  const rnd = prng(20260819)
  const periodo = resolvePeriodoUtc(COMPETENCIA)
  const janelaMs = periodo.fimExclusivo.getTime() - periodo.inicio.getTime()

  const vendas = []
  const devolucoes = []
  const movimentacoes = []
  const contasReceber = []
  const contasPagar = []

  for (let i = 0; i < totalVendas; i++) {
    const id = `vda-${pad(i, 8)}`
    const at = new Date(periodo.inicio.getTime() + Math.floor(rnd() * janelaMs))
    const qtdItens = 1 + Math.floor(rnd() * 3)
    const itens = []
    let total = 0
    for (let j = 0; j < qtdItens; j++) {
      const precoUnitario = Math.round((5 + rnd() * 400) * 100) / 100
      const quantidade = 1 + Math.floor(rnd() * 4)
      const lineTotal = Math.round(precoUnitario * quantidade * 100) / 100
      total += lineTotal
      itens.push({
        id: `${id}-it-${j}`,
        inventoryId: `prod-${pad(Math.floor(rnd() * 500), 5)}`,
        nome: `Produto sintetico ${pad(Math.floor(rnd() * 500), 5)}`,
        quantidade,
        precoUnitario,
        lineTotal,
      })
    }
    total = Math.round(total * 100) / 100

    vendas.push({
      id,
      storeId: STORE_ID,
      pedidoId: `PED-${pad(i, 8)}`,
      at,
      total,
      status: "concluida",
      formaPagamento: rnd() < 0.5 ? "dinheiro" : "cartao_credito",
      canal: "pdv",
      sessaoId: `ses-${pad(i % 120, 5)}`,
      operadorNome: `Operador ${i % 7}`,
      clienteId: null,
      itens,
    })

    // ~2% de devoluções e ~35% de movimentações, proporções plausíveis de um mês real.
    if (i % 50 === 0) {
      devolucoes.push({
        id: `dev-${pad(i, 8)}`,
        storeId: STORE_ID,
        vendaId: id,
        at,
        valor: Math.round(total * 0.5 * 100) / 100,
        motivo: "troca",
        status: "concluida",
      })
    }
    if (i % 3 === 0) {
      movimentacoes.push({
        id: `mov-${pad(i, 8)}`,
        storeId: STORE_ID,
        at,
        tipo: rnd() < 0.7 ? "entrada" : "saida",
        valor: total,
        categoria: "vendas",
        descricao: `Movimento sintetico ${pad(i, 8)}`,
        formaPagamento: "dinheiro",
        origem: "pdv",
      })
    }
    if (i % 7 === 0) {
      const titulo = {
        id: `tit-${pad(i, 8)}`,
        storeId: STORE_ID,
        descricao: `Titulo sintetico ${pad(i, 8)}`,
        valor: total,
        vencimento: at,
        status: "aberto",
        pagoEm: null,
        categoria: "operacional",
        createdAt: at,
        updatedAt: at,
      }
      if (i % 14 === 0) contasPagar.push(titulo)
      else contasReceber.push(titulo)
    }
  }

  const sessoes = []
  const operacoes = []
  for (let s = 0; s < 120; s++) {
    const abertaEm = new Date(periodo.inicio.getTime() + Math.floor((s / 120) * janelaMs))
    sessoes.push({
      id: `ses-${pad(s, 5)}`,
      storeId: STORE_ID,
      abertaEm,
      fechadaEm: new Date(abertaEm.getTime() + 8 * 60 * 60 * 1000),
      status: "fechada",
      terminalId: `pdv-${s % 3}`,
      operadorNome: `Operador ${s % 7}`,
      saldoInicial: 200,
      saldoFinal: 200,
    })
    operacoes.push({
      id: `ope-${pad(s, 5)}`,
      storeId: STORE_ID,
      sessaoId: `ses-${pad(s, 5)}`,
      at: abertaEm,
      tipo: "suprimento",
      valor: 200,
      motivo: "abertura",
      operadorNome: `Operador ${s % 7}`,
    })
  }

  return { vendas, devolucoes, movimentacoes, contasReceber, contasPagar, sessoes, operacoes }
}

/**
 * Cliente que imita a paginação por cursor do Prisma (`cursor`+`skip`+`take`+
 * `orderBy`), para que o custo medido inclua o mesmo número de round-trips lógicos
 * que a rota real faria.
 */
function clienteSintetico(massa, contador) {
  const paginar = (linhas) => async (args) => {
    contador.queries += 1
    const take = args?.take ?? linhas.length
    let inicio = 0
    const cursorId = args?.cursor?.id
    if (cursorId) {
      const idx = linhas.findIndex((l) => l.id === cursorId)
      inicio = idx >= 0 ? idx + (args?.skip ?? 1) : 0
    }
    return linhas.slice(inicio, inicio + take)
  }

  const ordenar = (linhas, campo) =>
    [...linhas].sort((a, b) => {
      const da = a[campo] instanceof Date ? a[campo].getTime() : 0
      const db = b[campo] instanceof Date ? b[campo].getTime() : 0
      return da === db ? String(a.id).localeCompare(String(b.id)) : da - db
    })

  const produtos = new Map()
  for (const venda of massa.vendas) {
    for (const item of venda.itens) {
      if (item.inventoryId && !produtos.has(item.inventoryId)) {
        produtos.set(item.inventoryId, {
          id: item.inventoryId,
          sku: `SKU-${item.inventoryId}`,
          barcode: null,
          nome: item.nome,
        })
      }
    }
  }

  return {
    venda: { findMany: paginar(ordenar(massa.vendas, "at")) },
    produto: {
      findMany: async (args) => {
        contador.queries += 1
        const ids = args?.where?.id?.in ?? []
        return ids.map((id) => produtos.get(id)).filter(Boolean)
      },
    },
    devolucaoVenda: { findMany: paginar(ordenar(massa.devolucoes, "at")) },
    movimentacaoFinanceira: { findMany: paginar(ordenar(massa.movimentacoes, "at")) },
    contaReceberTitulo: { findMany: paginar(ordenar(massa.contasReceber, "createdAt")) },
    contaPagarTitulo: { findMany: paginar(ordenar(massa.contasPagar, "createdAt")) },
    sessaoCaixa: { findMany: paginar(ordenar(massa.sessoes, "abertaEm")) },
    caixaOperacao: { findMany: paginar(ordenar(massa.operacoes, "at")) },
  }
}

function memoriaMb() {
  const m = process.memoryUsage?.()
  if (!m) return null
  return {
    heapUsedMb: Math.round((m.heapUsed / (1024 * 1024)) * 10) / 10,
    rssMb: Math.round((m.rss / (1024 * 1024)) * 10) / 10,
  }
}

async function main() {
  const totalVendas = arg("vendas", 20_000)
  const comoJson = process.argv.includes("--json")

  const tGeracaoMassa = performance.now()
  const massa = gerarMassa(totalVendas)
  const msMassa = performance.now() - tGeracaoMassa

  const contador = { queries: 0 }
  const cliente = clienteSintetico(massa, contador)
  // `scope` nominal: o builder só lê `storeId`/`userId`. Nenhum gate é contornado —
  // não há request, não há sessão e não há banco neste caminho.
  const scope = { storeId: STORE_ID, userId: USER_ID }
  const periodo = resolvePeriodoUtc(COMPETENCIA)

  const falhas = []
  let relatorio = null

  const t0 = performance.now()
  try {
    const tCarga = performance.now()
    const detalhadas = await carregarFontesPacoteComCliente(scope, periodo, COMPETENCIA, cliente)
    const msCarga = performance.now() - tCarga

    const tMontagem = performance.now()
    const dados = montarDados(detalhadas.agregado, COMPETENCIA)
    const checklist = montarChecklistFechamento({ dados, competencia: COMPETENCIA, agora: AGORA })
    const conteudo = montarConteudoPacote({
      detalhadas,
      dados,
      checklist,
      competencia: COMPETENCIA,
      agora: AGORA,
      storeId: STORE_ID,
      userId: USER_ID,
    })
    const msMontagem = performance.now() - tMontagem

    const tZip = performance.now()
    const bytes = await ziparArquivos(conteudo.arquivos, AGORA)
    const msZip = performance.now() - tZip

    const bytesDescompactados = conteudo.arquivos.reduce(
      (acc, a) => acc + Buffer.byteLength(a.conteudo, "utf8"),
      0,
    )

    relatorio = {
      vendasSinteticas: totalVendas,
      itensSinteticos: massa.vendas.reduce((acc, v) => acc + v.itens.length, 0),
      devolucoes: massa.devolucoes.length,
      movimentacoes: massa.movimentacoes.length,
      contasReceber: massa.contasReceber.length,
      contasPagar: massa.contasPagar.length,
      sessoes: massa.sessoes.length,
      queriesLogicas: detalhadas.totalQueries,
      msGeracaoMassa: Math.round(msMassa),
      msCargaFontes: Math.round(msCarga),
      msMontagemConteudo: Math.round(msMontagem),
      msZip: Math.round(msZip),
      msTotalGeracao: Math.round(performance.now() - t0),
      arquivos: conteudo.arquivos.length,
      bytesDescompactados,
      bytesZip: bytes.byteLength,
      memoria: memoriaMb(),
      timeoutLogicoMs: TIMEOUT_LOGICO_MS,
      dentroDoTimeoutLogico: performance.now() - t0 <= TIMEOUT_LOGICO_MS,
      slaCanonico: null,
      observacao:
        "Nao existe SLA numerico canonico para a geracao do pacote no masterplan nem no roadmap. Resultado REGISTRADO, sem threshold inventado. O unico teto comparado e TIMEOUT_LOGICO_MS, que ja existia no codigo.",
      falhas,
    }
  } catch (erro) {
    falhas.push({ etapa: "geracao", erro: erro instanceof Error ? erro.name : "erro" })
    relatorio = {
      vendasSinteticas: totalVendas,
      msTotalGeracao: Math.round(performance.now() - t0),
      falhas,
    }
  }

  if (comoJson) {
    process.stdout.write(`${JSON.stringify(relatorio, null, 2)}\n`)
  } else {
    const l = []
    l.push("Contador HUB · carga sintetica da geracao do pacote (GOAL 019)")
    l.push(`  massa .................. ${relatorio.vendasSinteticas} vendas / ${relatorio.itensSinteticos ?? "-"} itens`)
    l.push(`  outras fontes .......... dev=${relatorio.devolucoes ?? "-"} mov=${relatorio.movimentacoes ?? "-"} cr=${relatorio.contasReceber ?? "-"} cp=${relatorio.contasPagar ?? "-"} ses=${relatorio.sessoes ?? "-"}`)
    l.push(`  queries logicas ........ ${relatorio.queriesLogicas ?? "-"}`)
    l.push(`  duracao carga .......... ${relatorio.msCargaFontes ?? "-"} ms`)
    l.push(`  duracao montagem ....... ${relatorio.msMontagemConteudo ?? "-"} ms`)
    l.push(`  duracao zip ............ ${relatorio.msZip ?? "-"} ms`)
    l.push(`  DURACAO TOTAL .......... ${relatorio.msTotalGeracao} ms (teto logico ${TIMEOUT_LOGICO_MS} ms)`)
    l.push(`  arquivos ............... ${relatorio.arquivos ?? "-"}`)
    l.push(`  bytes descompactados ... ${relatorio.bytesDescompactados ?? "-"}`)
    l.push(`  bytes zip .............. ${relatorio.bytesZip ?? "-"}`)
    l.push(`  memoria ................ heap=${relatorio.memoria?.heapUsedMb ?? "-"} MB rss=${relatorio.memoria?.rssMb ?? "-"} MB`)
    l.push(`  falhas ................. ${relatorio.falhas.length}`)
    l.push(`  SLA canonico ........... nao existe — resultado registrado, sem threshold inventado`)
    process.stdout.write(`${l.join("\n")}\n`)
  }

  if (falhas.length > 0) process.exitCode = 1
}

await main()
