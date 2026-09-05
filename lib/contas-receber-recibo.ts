/** Nome exibido no recibo térmico (80 mm). */
export const RECIBO_LOJA_NOME_PADRAO = "Minha Loja"

/**
 * Último recurso do cabeçalho do cupom quando NENHUMA fonte real de identidade da
 * unidade respondeu. Deliberadamente neutro: "Minha Loja" parecia nome comercial e
 * saía impresso em caixa alta como se fosse a razão social do cliente (achado G da
 * `AUDITORIA_PDV_RECEBIMENTO_MULTITITULO_DESIGN_001.md`).
 */
export const RECIBO_LOJA_NOME_FALLBACK = "Loja"

/**
 * Nome da loja para o cupom, na ordem de confiança das fontes que o PDV já tem
 * (prop explícita do call site → cadastro da unidade ativa → …).
 *
 * Só descarta candidato vazio; **não inventa** nome fantasia nem razão social. Se
 * nada real chegou, devolve o rótulo neutro — melhor um cupom sem marca do que um
 * cupom com marca errada.
 */
export function resolveReciboLojaNome(...candidatos: Array<string | null | undefined>): string {
  for (const c of candidatos) {
    const t = String(c ?? "").trim()
    if (t) return t
  }
  return RECIBO_LOJA_NOME_FALLBACK
}

export const FORMAS_PAGAMENTO_RECIBO = [
  "Dinheiro",
  "PIX",
  "Cartão de Crédito",
  "Cartão de Débito",
] as const

export type FormaPagamentoRecibo = (typeof FORMAS_PAGAMENTO_RECIBO)[number]

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function normClienteKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function statusAbertoReceber(status: string): boolean {
  const t = String(status || "")
    .trim()
    .toLowerCase()
  return t === "pendente" || t === "atrasado"
}

/**
 * Soma valores de outros títulos em aberto (**pendentes** + **atrasados**) do mesmo cliente (exclui o título atual).
 * Usado no rodapé do recibo como saldo devedor remanescente.
 */
export function calcSaldoDevedorOutrosPendentesMesmoCliente(
  todas: { id: string | number; cliente: string; status: string; valor: number }[],
  tituloAtual: { id: string | number; cliente: string }
): number {
  const key = normClienteKey(tituloAtual.cliente || "")
  if (!key) return 0
  return todas
    .filter(
      (c) =>
        statusAbertoReceber(c.status) &&
        normClienteKey(c.cliente || "") === key &&
        String(c.id) !== String(tituloAtual.id)
    )
    .reduce((s, c) => s + (Number.isFinite(c.valor) ? c.valor : 0), 0)
}

/**
 * Saldo total ainda devido pelo cliente após o pagamento registrado no recibo:
 * saldo remanescente **deste título** (abatimento parcial / parcelas) + demais títulos em aberto do mesmo cliente.
 * @deprecated Prefira `calcSaldoDevedorClienteTodaLoja` para o rodapé do recibo.
 */
export function calcSaldoDevedorTotalAposPagamentoRecibo(
  todas: { id: string | number; cliente: string; status: string; valor: number }[],
  tituloAposPagamento: { id: string | number; cliente: string; status: string; valor: number }
): number {
  const saldoRemanescenteEsteTitulo =
    statusAbertoReceber(tituloAposPagamento.status) && Number.isFinite(Number(tituloAposPagamento.valor))
      ? Math.max(0, Math.round(Number(tituloAposPagamento.valor) * 100) / 100)
      : 0
  const saldoOutrosTitulos = calcSaldoDevedorOutrosPendentesMesmoCliente(todas, tituloAposPagamento)
  return Math.round((saldoRemanescenteEsteTitulo + saldoOutrosTitulos) * 100) / 100
}

export type ContaLinhaSaldoRecibo = {
  cliente: string
  status: string
  valor: number
  parcelas?: Array<{ valor?: number }>
}

/** Saldo em aberto de um título para o rodapé do recibo: prioriza soma das parcelas quando existir plano. */
function saldoAbertoTituloRecibo(c: ContaLinhaSaldoRecibo): number {
  if (!statusAbertoReceber(c.status)) return 0
  if (Array.isArray(c.parcelas) && c.parcelas.length > 0) {
    const sp = c.parcelas.reduce(
      (s, p) => s + (Number.isFinite(Number(p.valor)) ? Number(p.valor) : 0),
      0
    )
    if (sp > 0.009) return Math.round(sp * 100) / 100
  }
  const v = Number(c.valor)
  return Number.isFinite(v) ? Math.max(0, Math.round(v * 100) / 100) : 0
}

/**
 * O que o cliente ainda deve na loja após o recebimento: soma do saldo em aberto de **todos** os títulos
 * pendentes/atrasados do mesmo cliente (lista já atualizada). Com parcelas, usa a soma dos saldos das parcelas
 * quando o plano existir — alinhado a “total do contrato − já pago” no modelo de dados.
 */
export function calcSaldoDevedorClienteTodaLoja(todas: ContaLinhaSaldoRecibo[], clienteNome: string): number {
  const key = normClienteKey(clienteNome || "")
  if (!key) return 0
  const soma = todas
    .filter((c) => normClienteKey(c.cliente || "") === key)
    .reduce((acc, c) => acc + saldoAbertoTituloRecibo(c), 0)
  return Math.round(soma * 100) / 100
}

/**
 * Saldo devedor do cliente para o rodapé do recibo a partir de saldos em aberto **autoritativos**
 * (já calculados pelo servidor como `valor − pagamentos`), sem reinferir nada por status/`valor`/parcelas.
 *
 * - `saldoRemanescenteEsteTitulo`: o que ainda resta DESTE título após o pagamento do recibo
 *   (= saldo em aberto antes − valor pago agora). Em quitação total é 0; em parcial é o restante.
 * - `saldosOutrosTitulos`: saldo em aberto dos demais títulos do mesmo cliente.
 *
 * Nunca retorna negativo e **nunca assume zero enquanto houver saldo remanescente** — só dá 0
 * quando, de fato, não sobra nada a receber.
 */
export function calcSaldoDevedorClienteDeSaldos(
  saldoRemanescenteEsteTitulo: number,
  saldosOutrosTitulos: number[],
): number {
  const este = Number.isFinite(saldoRemanescenteEsteTitulo) ? Math.max(0, saldoRemanescenteEsteTitulo) : 0
  const outros = (saldosOutrosTitulos || []).reduce(
    (acc, v) => acc + (Number.isFinite(v) ? Math.max(0, v) : 0),
    0,
  )
  return Math.round((este + outros) * 100) / 100
}

export type ReciboPagamentoPayload = {
  lojaNome: string
  cliente: string
  descricaoTitulo: string
  valorPago: number
  dataPagamento: Date
  formaPagamento: string
  saldoDevedorAtual: number
}

/** Estilos embutidos no cupom (impressão via área isolada no DOM). */
const RECIBO_THERMAL_CSS = `
.recibo-thermal * { box-sizing: border-box; }
.recibo-thermal {
  font-family: ui-monospace, "Cascadia Mono", "Consolas", "Courier New", monospace;
  font-size: 11px;
  line-height: 1.45;
  color: #0a0a0a;
  background: #fff;
  width: 100%;
  max-width: 100%;
  padding: 0;
  margin: 0;
  word-wrap: break-word;
  overflow-wrap: anywhere;
  hyphens: auto;
}
.recibo-thermal h1 {
  font-size: 15px;
  text-align: center;
  margin: 0 0 6px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.recibo-thermal .sub { text-align: center; font-size: 10px; margin: 0 0 10px; }
.recibo-thermal .dash { border: none; border-top: 1px dashed #222; margin: 10px 0; }
.recibo-thermal .row { margin: 6px 0; }
.recibo-thermal .label { font-weight: 700; display: block; margin-bottom: 2px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.02em; }
.recibo-thermal .valor {
  font-size: 15px;
  font-weight: 800;
  text-align: center;
  margin: 12px 0;
  padding: 8px 6px;
  border: 2px solid #000;
}
.recibo-thermal .forma { margin: 8px 0; font-size: 11px; }
.recibo-thermal .saldo {
  margin-top: 12px;
  padding: 8px 4px;
  border: 1px solid #333;
  font-weight: 800;
  font-size: 11px;
  text-align: center;
  line-height: 1.35;
}
.recibo-thermal .sign-wrap {
  margin-top: 32px;
  padding-top: 8px;
  border-top: 2px solid #000;
  min-height: 56px;
}
.recibo-thermal .sign-label { font-size: 10px; font-weight: 700; margin-bottom: 8px; }
.recibo-thermal .sign-space { min-height: 44px; border-bottom: 1px dotted #666; margin-top: 4px; }
.recibo-thermal .muted { font-size: 9px; color: #333; margin-top: 14px; text-align: center; }
`

export function buildReciboPagamentoInnerHtml(p: ReciboPagamentoPayload): string {
  const valorFmt = p.valorPago.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  const dataFmt = p.dataPagamento.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  })
  const saldoFmt = p.saldoDevedorAtual.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  const loja = escapeHtml(p.lojaNome)
  const cliente = escapeHtml(p.cliente || "—")
  const desc = escapeHtml(p.descricaoTitulo || "—")
  const forma = escapeHtml(p.formaPagamento || "—")

  return `
  <div class="recibo-thermal">
    <h1>${loja}</h1>
    <p class="sub">Recibo de pagamento</p>
    <hr class="dash" />
    <div class="row"><span class="label">Cliente</span>${cliente}</div>
    <div class="row"><span class="label">Descrição do título</span>${desc}</div>
    <div class="forma"><span class="label">Forma de pagamento</span>${forma}</div>
    <div class="valor">${escapeHtml(valorFmt)}</div>
    <div class="row"><span class="label">Data do pagamento</span>${escapeHtml(dataFmt)}</div>
    <hr class="dash" />
    <div class="saldo">SALDO DEVEDOR ATUAL: ${escapeHtml(saldoFmt)}</div>
    <div class="sign-wrap">
      <div class="sign-label">Assinatura do recebedor</div>
      <div class="sign-space"></div>
    </div>
    <p class="muted">Documento gerado eletronicamente — ${loja}</p>
  </div>`
}

// ─── recibo consolidado (lote multitítulo) ───────────────────────────────────

export type ReciboLoteItem = {
  descricao: string
  valorRecebido: number
  /** Saldo que ficou NESTE título depois da baixa (0 em quitação total). */
  saldoRestante: number
}

export type ReciboLotePayload = {
  lojaNome: string
  cliente: string
  dataPagamento: Date
  formaPagamento: string
  itens: ReciboLoteItem[]
  /** Total confirmado pelo SERVIDOR (`totalRecebido` da resposta do lote). */
  totalRecebido: number
  /** O que o cliente ainda deve na unidade depois deste recebimento. */
  saldoDevedorAtual: number
}

/** Estilos exclusivos do cupom consolidado — somados ao CSS térmico compartilhado. */
const RECIBO_LOTE_CSS = `
.recibo-thermal .itens { margin: 10px 0 2px; }
.recibo-thermal .item { margin: 0 0 7px; }
.recibo-thermal .item-d { font-size: 10px; font-weight: 700; }
.recibo-thermal .item-l { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; }
.recibo-thermal .item-r { font-size: 9px; color: #333; }
.recibo-thermal .tot { display: flex; justify-content: space-between; gap: 8px; font-weight: 800; font-size: 12px; margin-top: 8px; }
`

/**
 * Cupom de UM recebimento que baixou VÁRIOS títulos. Um documento por operação — o
 * cliente pagou uma vez, então assina uma vez. Imprimir N cupons individuais para um
 * lote reintroduziria a leitura de "N pagamentos".
 */
export function buildReciboLoteInnerHtml(p: ReciboLotePayload): string {
  const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  const dataFmt = p.dataPagamento.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
  const loja = escapeHtml(p.lojaNome)
  const cliente = escapeHtml(p.cliente || "—")
  const forma = escapeHtml(p.formaPagamento || "—")
  const qtd = p.itens.length

  const itens = p.itens
    .map((it) => {
      const resta = Number.isFinite(it.saldoRestante) ? Math.max(0, it.saldoRestante) : 0
      const situacao = resta > 0.009 ? `abatido — resta ${brl(resta)}` : "quitado"
      return `
      <div class="item">
        <div class="item-d">${escapeHtml(it.descricao || "Título")}</div>
        <div class="item-l"><span>${escapeHtml(situacao)}</span><span>${escapeHtml(brl(it.valorRecebido))}</span></div>
      </div>`
    })
    .join("")

  return `
  <div class="recibo-thermal">
    <h1>${loja}</h1>
    <p class="sub">Recibo de recebimento</p>
    <hr class="dash" />
    <div class="row"><span class="label">Cliente</span>${cliente}</div>
    <div class="forma"><span class="label">Forma de pagamento</span>${forma}</div>
    <div class="row"><span class="label">Data do pagamento</span>${escapeHtml(dataFmt)}</div>
    <hr class="dash" />
    <div class="itens">
      <span class="label">${qtd} ${qtd === 1 ? "título recebido" : "títulos recebidos"}</span>
      ${itens}
    </div>
    <div class="tot"><span>Total recebido</span><span>${escapeHtml(brl(p.totalRecebido))}</span></div>
    <div class="valor">${escapeHtml(brl(p.totalRecebido))}</div>
    <hr class="dash" />
    <div class="saldo">SALDO DEVEDOR ATUAL: ${escapeHtml(brl(p.saldoDevedorAtual))}</div>
    <div class="sign-wrap">
      <div class="sign-label">Assinatura do recebedor</div>
      <div class="sign-space"></div>
    </div>
    <p class="muted">Documento gerado eletronicamente — ${loja}</p>
  </div>`
}

function ensurePrintMount(): HTMLDivElement {
  let el = document.getElementById("recibo-print-mount") as HTMLDivElement | null
  if (!el) {
    el = document.createElement("div")
    el.id = "recibo-print-mount"
    el.setAttribute("aria-hidden", "true")
    document.body.appendChild(el)
  }
  return el
}

/**
 * Imprime apenas o recibo: usa `data-printing-recibo` + CSS global @media print
 * para ocultar layout do app (sidebar, header, etc.).
 */
export type ImprimirReciboOpts = {
  bobina?: "58mm" | "80mm"
}

export function imprimirReciboPagamento(
  payload: ReciboPagamentoPayload,
  opts?: ImprimirReciboOpts,
): void {
  printReciboInnerHtml(buildReciboPagamentoInnerHtml(payload), opts)
}

/**
 * Imprime o recibo CONSOLIDADO do lote — um único cupom para os N títulos baixados
 * na mesma operação. Compartilha a mesma montagem e o mesmo CSS do cupom singular.
 */
export function imprimirReciboLote(payload: ReciboLotePayload, opts?: ImprimirReciboOpts): void {
  printReciboInnerHtml(buildReciboLoteInnerHtml(payload), opts, RECIBO_LOTE_CSS)
}

/** Montagem, `@page` e ciclo de impressão — compartilhados pelos dois cupons. */
function printReciboInnerHtml(inner: string, opts?: ImprimirReciboOpts, extraCss = ""): void {
  if (typeof document === "undefined") return
  const pageSize = opts?.bobina === "58mm" ? "58mm" : "80mm"
  const pageCss = `
@media print { @page { size: ${pageSize} auto; margin: 0; } }
`
  /** Montagem e `print()` fora do mesmo tick da baixa — evita travar a UI antes do loading sumir. */
  window.setTimeout(() => {
    const mount = ensurePrintMount()
    mount.innerHTML = `<div class="recibo-print-root"><style>${pageCss}${RECIBO_THERMAL_CSS}${extraCss}</style>${inner}</div>`

    document.documentElement.setAttribute("data-printing-recibo", "true")

    const cleanup = () => {
      document.documentElement.removeAttribute("data-printing-recibo")
      mount.innerHTML = ""
    }

    requestAnimationFrame(() => {
      try {
        window.print()
      } catch {
        cleanup()
      }
    })

    window.addEventListener("afterprint", cleanup, { once: true })
    window.setTimeout(cleanup, 1_200)
  }, 0)
}
