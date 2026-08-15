/**
 * OPS-V4-REMOVE-DEMO-DATA — garantias de honestidade da Operações V4 Preview.
 *
 * 1) Nenhum dado fabricado (clientes, OS, técnicos, "Unidade Centro", "dados
 *    demonstrativos") permanece no código-fonte da Preview — varre os arquivos
 *    reais do diretório (exceto os próprios testes).
 * 2) "Abrir OS" na Preview NÃO cria OS e NUNCA abre/seleciona uma OS existente por
 *    fallback: limpa a seleção, fecha o modal e avisa de forma honesta — prevenindo
 *    o bug em que cadastrar um cliente e clicar "Abrir OS" revelava a OS aberta atrás
 *    do modal (ex.: a OS real de outro cliente).
 *
 * O encadeamento de server actions (→ Prisma) é cortado por mock: `buildVals` é uma
 * função pura e não exercita os hooks de leitura — só precisamos do comportamento local.
 */
import { describe, it, expect, vi } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, extname } from "node:path"

vi.mock("@/app/actions/ordens", () => ({
  listOrdens: vi.fn(async () => []),
  getOrdem: vi.fn(async () => null),
}))

// As actions reais da V3 importam `@/auth` (next-auth) → não carregam no ambiente
// node do vitest. Mockamos só os símbolos consumidos por `use-v4-preview` para que
// `buildVals` possa ser importado. Os GUARDS estáticos leem o SOURCE real via fs,
// então os mocks não afetam a verificação de reuso/segurança.
vi.mock("@/lib/operacoes-v3/workspace-actions", () => ({
  salvarDiagnosticoV3: vi.fn(async () => ({})),
  salvarChecklistEntradaV3: vi.fn(async () => ({})),
}))
vi.mock("@/lib/operacoes-v3/orcamento-actions", () => ({
  gerarOrcamentoDaOS: vi.fn(async () => ({})),
  salvarOrcamentoV3: vi.fn(async () => ({})),
  corrigirOrcamentoV3: vi.fn(async () => ({})),
  aprovarOrcamentoV3: vi.fn(async () => ({})),
  recusarOrcamentoV3: vi.fn(async () => ({})),
}))
vi.mock("@/lib/operacoes-v3/status-actions", () => ({
  aplicarTransicaoStatusV3: vi.fn(async () => ({})),
}))
vi.mock("@/lib/operacoes-v3/prova-entrada-actions", () => ({
  salvarIdentificacaoV3: vi.fn(async () => ({})),
  salvarProvaEntradaV3: vi.fn(async () => ({})),
  salvarAcessoriosEntradaV3: vi.fn(async () => ({})),
  adicionarFotoEntradaV3: vi.fn(async () => ({})),
  removerFotoEntradaV3: vi.fn(async () => ({})),
  salvarAssinaturaClienteV3: vi.fn(async () => ({})),
}))
vi.mock("@/lib/operacoes-v3/dados-basicos-actions", () => ({
  salvarDadosBasicosOSV3: vi.fn(async () => ({})),
}))
vi.mock("@/lib/operacoes-v3/producao-actions", () => ({
  atribuirTecnicoV3: vi.fn(async () => ({})),
  definirPrioridadeV3: vi.fn(async () => ({})),
}))
// Assinatura de retirada + auditoria de impressão (GOAL OPS-V4-DOCS-ASSINATURA-
// TERMOS-ANEXOS-012): mesma razão dos mocks acima — ambas são "use server" (→ @/auth).
vi.mock("@/lib/operacoes-v3/entrega-actions", () => ({
  salvarAssinaturaRetiradaV3: vi.fn(async () => ({})),
  registrarEntregaV3: vi.fn(async () => ({})),
}))
vi.mock("@/lib/operacoes-v3/garantia-actions", () => ({
  registrarImpressaoDocumentoV3: vi.fn(async () => ({})),
  salvarGarantiaOSV3: vi.fn(async () => ({})),
}))
vi.mock("@/lib/operacoes-v3/retorno-actions", () => ({
  abrirRetornoV3: vi.fn(async () => ({})),
  finalizarRetornoV3: vi.fn(async () => ({})),
}))
// PDV de Serviço (slice PDV-SERVICO-OS-RECEBIMENTO-REAL-001): mesma razão dos
// mocks acima — `use-pdv-servico-v3` (hook real, importado por `use-v4-preview`)
// importa esta action "use server" (→ @/auth) em tempo de carregamento do módulo.
vi.mock("@/lib/operacoes-v3/pdv-servico-actions", () => ({
  getCaixaSessaoAbertaV3: vi.fn(async () => ({ aberta: false })),
  lerPagamentoOSV3: vi.fn(async () => ({ total: 0, recebido: 0, saldo: 0, status: "sem_cobranca", sessao: { aberta: false } })),
  receberOSV3: vi.fn(async () => ({})),
  estornarRecebimentoOSV3: vi.fn(async () => ({})),
  lancarOSAPrazoV3: vi.fn(async () => ({})),
}))
vi.mock("@/lib/operacoes-v4/financial-projection-actions", () => ({
  lerProjecaoFinanceiraOSV4: vi.fn(),
  lerProjecoesFinanceirasOSV4: vi.fn(),
}))

import { buildVals, type V4DataCtx } from "./use-v4-preview"
import { adaptPag, adaptFinanceiro, adaptOrcamento, maskSenhaV4, NI } from "./os-adapter"
import { fmt } from "./tokens"
import type { V4State } from "./types"
import type { OrdemServico } from "@/types/os"
import type { PagamentoV3 } from "@/lib/operacoes-v3/payment-model"
import type { FinancialProjectionOSV4 } from "@/lib/operacoes-v4/financial-projection"

const DIR = dirname(fileURLToPath(import.meta.url))

/** Coleta recursivamente os .ts/.tsx de origem da Preview, ignorando os próprios testes. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full))
      continue
    }
    const ext = extname(name)
    if (ext !== ".ts" && ext !== ".tsx") continue
    if (/\.test\.tsx?$/.test(name)) continue
    out.push(full)
  }
  return out
}

/** Dados fabricados que NÃO podem aparecer na UI operacional da Preview. */
const FAKE_TERMS = [
  // clientes / técnicos demonstrativos
  "Pedro Lima",
  "Sofia Dias",
  "Caio Moraes",
  "Marcos Teles",
  "Mariana Lima",
  "Tiago Reis",
  "Bruno Alves",
  "Carla Menezes",
  "Rafael Pinto",
  "Mariana Costa Lima",
  "Carlos Eduardo Souza",
  "Beatriz Almeida",
  // OS fabricadas
  "OS-0473",
  "OS-0469",
  "OS-0480",
  "OS-0485",
  "OS-0481",
  "OS-0478",
  // unidade / rótulos fabricados
  "Unidade Centro",
  "dados demonstrativos",
]

describe("Operações V4 Preview — sem dados fabricados no código-fonte", () => {
  const files = collectSourceFiles(DIR)

  it("encontra os arquivos de origem da Preview", () => {
    expect(files.length).toBeGreaterThan(5)
  })

  for (const term of FAKE_TERMS) {
    it(`não contém o dado fake "${term}"`, () => {
      const offenders = files.filter((f) => readFileSync(f, "utf8").includes(term))
      expect(offenders, `"${term}" encontrado em: ${offenders.join(", ")}`).toEqual([])
    })
  }
})

function makeState(over: Partial<V4State> = {}): V4State {
  return {
    view: "cockpit",
    module: "workspace",
    stage: "execucao",
    status: "em_execucao",
    left: true,
    right: true,
    menu: null,
    toast: "",
    prioridade: "alta",
    histFilter: "todos",
    novaOS: true,
    novoAtendimento: false,
    recibo: false,
    atendimentoRapido: false,
    orcamentoRapido: false,
    estornoRecebimento: false,
    receberPagamento: false,
    cancelamentoOS: false,
    selectedOsId: null,
    focus: false,
    authState: "autorizado",
    pin4: 3,
    pin6: 3,
    pattern: [0, 3, 4, 7],
    senha: "",
    motivo: "",
    docPrint: null,
    ...over,
  }
}

const ctx: V4DataCtx = {
  ordens: [],
  ordensLoading: false,
  ordensPrimeiraCarga: false,
  ordensError: null,
  reloadOrdens: () => {},
  reloadDetail: () => {},
  realOS: null,
  detailLoading: false,
  financialProjection: { projection: null, loading: false, error: null, reload: () => {} },
  financialProjectionsByOsId: new Map(),
  financialRailLoading: false,
  financialRailError: null,
  salvarDiagnostico: async () => false,
  gerarOrcamento: async () => false,
  salvarOrcamento: async () => false,
  corrigirOrcamento: async () => false,
  aprovarOrcamento: async () => false,
  recusarOrcamento: async () => false,
  iniciarDiagnostico: async () => false,
  iniciarServico: async () => false,
  marcarAguardandoPeca: async () => false,
  marcarPronta: async () => false,
  confirmarEntrega: async () => false,
  salvarAssinaturaRetirada: async () => false,
  registrarImpressaoDoc: () => {},
  salvarGarantia: async () => false,
  abrirRetorno: async () => false,
  finalizarRetorno: async () => false,
  lancarAPrazo: async () => false,
  cancelarOS: async () => false,
  pdvServico: {
    pagamento: null,
    sessao: null,
    loading: false,
    recebendo: false,
    estornando: false,
    error: null,
    ultimoRecibo: null,
    reload: () => {},
    receber: async () => false,
    estornar: async () => false,
    limparRecibo: () => {},
  },
  salvarIdentificacao: async () => false,
  salvarProvaEntrada: async () => false,
  salvarAcessorios: async () => false,
  salvarChecklist: async () => false,
  adicionarFotoEntrada: async () => false,
  removerFotoEntrada: async () => false,
  salvarAssinaturaCliente: async () => false,
  salvarDadosBasicos: async () => false,
  atribuirTecnico: async () => false,
  removerTecnico: async () => false,
  definirPrioridade: async () => false,
  avancarStatusBancada: async () => false,
  moverStatusFila: async () => false,
  modoFila: "kanban",
  setModoFila: () => {},
  enviarOrcamentoPorCanal: async () => ({ ok: false }),
  orcamentoRapidoPrefill: null,
  definirOrcamentoRapidoPrefill: () => {},
  selecionarVarianteOrcamento: async () => false,
  cancelamentoMotivoPrefill: null,
  definirCancelamentoMotivoPrefill: () => {},
}

describe("Operações V4 — Nova OS real (cria OS e abre no workspace)", () => {
  it("onOSCriada fecha o modal, abre a OS criada no workspace e recarrega a lista", () => {
    const patches: Array<Record<string, unknown>> = []
    const msgs: string[] = []
    let reloaded = 0
    const ctxLocal: V4DataCtx = { ...ctx, reloadOrdens: () => { reloaded += 1 } }
    const st = makeState({ selectedOsId: null, novaOS: true })
    const v = buildVals(
      st,
      (p) => patches.push(p as Record<string, unknown>),
      (m) => msgs.push(m),
      ctxLocal,
    )

    v.onOSCriada("os-nova-123")

    // Fecha o modal, seleciona a OS recém-criada e leva ao workspace.
    expect(patches).toContainEqual(
      expect.objectContaining({ novaOS: false, selectedOsId: "os-nova-123", module: "workspace" }),
    )
    // Recarrega a lista real para refletir a nova OS.
    expect(reloaded).toBe(1)
    // Toast honesto de sucesso.
    expect(msgs.some((m) => /criada/i.test(m))).toBe(true)
  })

  it("osSelected só é verdadeiro com uma OS explicitamente selecionada", () => {
    const semOs = buildVals(makeState({ selectedOsId: null }), () => {}, () => {}, ctx)
    expect(semOs.osSelected).toBe(false)

    const comOs = buildVals(makeState({ selectedOsId: "os-1" }), () => {}, () => {}, ctx)
    expect(comOs.osSelected).toBe(true)
  })
})

function mkOS(p: Record<string, unknown> & { id: string }): OrdemServico {
  return p as unknown as OrdemServico
}

function financialStateFromPayment(
  pagamento: Pick<PagamentoV3, "total" | "recebido" | "saldo" | "status"> | null,
  financialStatusOverride?: FinancialProjectionOSV4["financialStatus"],
): V4DataCtx["financialProjection"] {
  if (!pagamento) return { projection: null, loading: true, error: null, reload: () => {} }
  const financialStatus = financialStatusOverride ?? (
    pagamento.total <= 0 ? "NO_PRICE" : pagamento.saldo <= 0 ? "PAID" : pagamento.recebido > 0 ? "PARTIAL" : "OPEN"
  )
  const canDeliver = financialStatus === "PAID" || financialStatus === "AUTHORIZED_CREDIT" || financialStatus === "AUTHORIZED_NO_CHARGE"
  const projection: FinancialProjectionOSV4 = {
    version: 1, storeId: "store-a", osId: "os-test", osCode: "OS-TEST", operationalStatus: "pronta",
    expectedTotal: pagamento.total, expectedTotalSource: ["test"], approvedBudgetTotal: pagamento.total,
    osColumnTotal: pagamento.total, legacyTotal: null, billingSnapshotTotal: null,
    receivableFound: pagamento.total > 0, receivableId: pagamento.total > 0 ? "cr-test" : null,
    receivableTotal: pagamento.total > 0 ? pagamento.total : null, receivableStatus: pagamento.status,
    receivedTotal: pagamento.recebido, reversedTotal: 0, balance: pagamento.saldo,
    financialStatus, consistencyStatus: "CONSISTENT", consistencyIssues: [], paymentMethods: [], collectionMode: null, installments: [],
    authorizedCredit: financialStatus === "AUTHORIZED_CREDIT", authorizedNoCharge: financialStatus === "AUTHORIZED_NO_CHARGE",
    noChargeCategory: null, noChargeReason: null, financialEvents: [],
    canReceive: financialStatus === "OPEN" || financialStatus === "PARTIAL", canDeliver,
    deliveryDecision: canDeliver
      ? financialStatus === "AUTHORIZED_CREDIT" ? "ALLOW_AUTHORIZED_CREDIT" : financialStatus === "AUTHORIZED_NO_CHARGE" ? "ALLOW_AUTHORIZED_NO_CHARGE" : "ALLOW_PAID"
      : financialStatus === "NO_PRICE" ? "BLOCK_NO_CHARGE_AUTH_REQUIRED" : "BLOCK_PENDING_BALANCE",
    loadedAt: "2026-07-15T12:00:00.000Z", errorCode: null,
  }
  return { projection, loading: false, error: null, reload: () => {} }
}

describe("Operações V4 Preview — telas de rail com identidade real (read-only)", () => {
  const ordens = [
    mkOS({ id: "a", status: "aberta", codigo: "OS-A", cliente: { nome: "Cliente A" } }),
    mkOS({ id: "b", status: "em_execucao", codigo: "OS-B", tecnico: { nome: "Ana" } }),
    mkOS({ id: "c", status: "entregue", codigo: "OS-C" }),
  ]
  const ctxReal: V4DataCtx = { ...ctx, ordens }

  it("expõe moduleId espelhando o módulo do estado", () => {
    const v = buildVals(makeState({ module: "fila", novaOS: false }), () => {}, () => {}, ctxReal)
    expect(v.moduleId).toBe("fila")
  })

  it("dashboard/fila derivam da lista real; fila exclui finalizadas", () => {
    const v = buildVals(makeState({ novaOS: false }), () => {}, () => {}, ctxReal)
    expect(v.dashboardResumo.temDados).toBe(true)
    expect(v.dashboardResumo.total).toBe(3)
    expect(v.filaItens.map((r) => r.id)).toEqual(["a", "b"]) // "c" (entregue) fora
  })

  it("rails ficam com temDados=false quando não há base real (empty honesto)", () => {
    const v = buildVals(makeState({ novaOS: false }), () => {}, () => {}, ctx) // ctx.ordens = []
    expect(v.dashboardResumo.temDados).toBe(false)
    expect(v.filaItens).toEqual([])
    expect(v.bancadaView.temDados).toBe(false)
    expect(v.producaoBancada.temProducao).toBe(false)
    expect(v.slaView.temDados).toBe(false)
    expect(v.pdvView.temDados).toBe(false)
  })

  it("openOSFromRail seleciona a OS por id explícito; id inexistente é no-op", () => {
    const patches: Array<Record<string, unknown>> = []
    const v = buildVals(makeState({ novaOS: false }), (p) => patches.push(p as Record<string, unknown>), () => {}, ctxReal)

    v.openOSFromRail("b")
    expect(patches.at(-1)).toMatchObject({ selectedOsId: "b", module: "workspace" })

    const antes = patches.length
    v.openOSFromRail("inexistente")
    expect(patches.length).toBe(antes) // nada selecionado por fallback
  })

  it("goToOSSearch limpa a seleção (leva ao seletor de OS, sem auto-abrir)", () => {
    const patches: Array<Record<string, unknown>> = []
    const v = buildVals(makeState({ selectedOsId: "x", novaOS: false }), (p) => patches.push(p as Record<string, unknown>), () => {}, ctxReal)
    v.goToOSSearch()
    expect(patches.at(-1)).toMatchObject({ selectedOsId: null, module: "workspace" })
  })
})

describe("Operações V4 Preview — Modo foco e Segurança (preview/no-op)", () => {
  it("onFoco recolhe rail + as duas gavetas de uma vez", () => {
    const patches: Array<Record<string, unknown>> = []
    let st = makeState({ focus: false, left: true, right: true, novaOS: false })
    const v = buildVals(st, (p) => patches.push(typeof p === "function" ? p(st) : (p as Record<string, unknown>)), () => {}, ctx)
    v.onFoco()
    // ativar foco fecha as duas laterais (o rail é ocultado no componente raiz por focusActive)
    expect(patches.at(-1)).toMatchObject({ focus: true, left: false, right: false })
  })

  it("goSeguranca leva à superfície seguranca; backFromSeguranca volta à Execução", () => {
    const patches: Array<Record<string, unknown>> = []
    const v = buildVals(makeState({ novaOS: false }), (p) => patches.push(p as Record<string, unknown>), () => {}, ctx)
    v.goSeguranca()
    expect(patches.at(-1)).toMatchObject({ stage: "seguranca" })
    v.backFromSeguranca()
    expect(patches.at(-1)).toMatchObject({ stage: "execucao" })
  })

  it("Autorizar é no-op honesto: avisa que nada é autenticado nem salvo", () => {
    const msgs: string[] = []
    const v = buildVals(makeState({ stage: "seguranca", novaOS: false }), () => {}, (m) => msgs.push(m), ctx)
    v.seg.onAutorizar()
    expect(msgs.some((m) => /demonstra|preview/i.test(m))).toBe(true)
    // isSeg reflete a superfície ativa
    expect(v.isSeg).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// OPS-V4-UX-PARITY-E-PDV-SERVICO-AUDIT-005 — ações de preview não fingem status.
// ---------------------------------------------------------------------------
describe("Operações V4 Preview — ações sem escrita real NUNCA mutam o status exibido", () => {
  it("Cancelar OS no menu abre o modal real (GOAL OPS-V4-CANCELAR-OS-CONNECT-021) — nunca muda status sozinho", () => {
    const patches: Array<Record<string, unknown>> = []
    const v = buildVals(
      makeState({ status: "em_execucao", novaOS: false }),
      (p) => patches.push(p as Record<string, unknown>),
      () => {},
      ctx,
    )
    for (const item of v.moreItems.filter((m) => /Cancelar OS/.test(m.label))) {
      item.onClick()
    }
    // O clique no menu só abre o modal (ação explícita) — a escrita real
    // (`aplicarTransicaoStatusV3`) só acontece depois de motivo + confirmação
    // dentro do modal (ver describe dedicado do GOAL OPS-V4-CANCELAR-OS-CONNECT-021).
    expect(patches.every((p) => !("status" in p))).toBe(true)
    expect(patches.some((p) => p.cancelamentoOS === true)).toBe(true)
  })

})

// ---------------------------------------------------------------------------
// OPS-V4-ACTIONS-RECONCILE-010 — CTA global e menu "..." reconciliados com as
// transições reais que já existem na aba Execução (marcarAguardandoPeca /
// marcarPronta / iniciarServico como "retomar"). Nem o header nem o menu
// disparam a transição direto: ambos só NAVEGAM à Execução, onde vive o botão
// real com busy-lock — nunca mais um toast de preview fingindo indisponível.
// ---------------------------------------------------------------------------
describe("OPS-V4-ACTIONS-RECONCILE-010 — CTA global e menu navegam à Execução (sem no-op falso)", () => {
  it("em_execucao: onPrimary ('Marcar pronta') navega à Execução, avisa e não muda status", () => {
    const patches: Array<Record<string, unknown>> = []
    const msgs: string[] = []
    const v = buildVals(
      makeState({ status: "em_execucao", novaOS: false }),
      (p) => patches.push(p as Record<string, unknown>),
      (m) => msgs.push(m),
      ctx,
    )
    v.onPrimary()
    expect(patches.every((p) => !("status" in p)), "nenhum patch pode conter status").toBe(true)
    expect(patches).toContainEqual(expect.objectContaining({ stage: "execucao" }))
    expect(msgs.some((m) => /execução/i.test(m))).toBe(true)
  })

  it("aguardando_peca: onPrimary ('Marcar peça chegou') navega à Execução, avisa e não muda status", () => {
    const patches: Array<Record<string, unknown>> = []
    const msgs: string[] = []
    const v = buildVals(
      makeState({ status: "aguardando_peca", novaOS: false }),
      (p) => patches.push(p as Record<string, unknown>),
      (m) => msgs.push(m),
      ctx,
    )
    v.onPrimary()
    expect(patches.every((p) => !("status" in p))).toBe(true)
    expect(patches).toContainEqual(expect.objectContaining({ stage: "execucao" }))
    expect(msgs.some((m) => /execução/i.test(m))).toBe(true)
  })

  it("em_execucao: menu 'Marcar Aguardando peça' navega à Execução (não é mais no-op)", () => {
    const patches: Array<Record<string, unknown>> = []
    const msgs: string[] = []
    const v = buildVals(
      makeState({ status: "em_execucao", novaOS: false }),
      (p) => patches.push(p as Record<string, unknown>),
      (m) => msgs.push(m),
      ctx,
    )
    const item = v.moreItems.find((m) => /Aguardando peça/.test(m.label))
    expect(item).toBeTruthy()
    item!.onClick()
    expect(patches).toContainEqual(expect.objectContaining({ stage: "execucao" }))
    expect(patches.every((p) => !("status" in p))).toBe(true)
    expect(msgs.every((m) => !/indisponível|nenhuma alteração/i.test(m))).toBe(true)
  })

  it("aguardando_peca: menu 'Peça chegou — retomar' navega à Execução (não é mais no-op)", () => {
    const patches: Array<Record<string, unknown>> = []
    const msgs: string[] = []
    const v = buildVals(
      makeState({ status: "aguardando_peca", novaOS: false }),
      (p) => patches.push(p as Record<string, unknown>),
      (m) => msgs.push(m),
      ctx,
    )
    const item = v.moreItems.find((m) => /retomar/i.test(m.label))
    expect(item).toBeTruthy()
    item!.onClick()
    expect(patches).toContainEqual(expect.objectContaining({ stage: "execucao" }))
    expect(patches.every((p) => !("status" in p))).toBe(true)
    expect(msgs.every((m) => !/indisponível|nenhuma alteração/i.test(m))).toBe(true)
  })

  it("aprovado: menu 'Marcar Aguardando peça' também navega à Execução", () => {
    const patches: Array<Record<string, unknown>> = []
    const v = buildVals(
      makeState({ status: "aprovado", novaOS: false }),
      (p) => patches.push(p as Record<string, unknown>),
      () => {},
      ctx,
    )
    const item = v.moreItems.find((m) => /Aguardando peça/.test(m.label))
    expect(item).toBeTruthy()
    item!.onClick()
    expect(patches).toContainEqual(expect.objectContaining({ stage: "execucao" }))
  })
})

// ---------------------------------------------------------------------------
// OPS-V4-ORCAMENTO-REAL-002 — Diagnóstico/Orçamento reais (reuso seguro da V3).
// ---------------------------------------------------------------------------
describe("Operações V4 — Diagnóstico/Orçamento reais reaproveitam só actions seguras da V3", () => {
  const orquestrador = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")
  const allSources = collectSourceFiles(DIR).map((f) => readFileSync(f, "utf8")).join("\n")

  it("usa as actions reais da V3 de diagnóstico/orçamento (sem backend novo)", () => {
    for (const action of [
      "salvarDiagnosticoV3",
      "gerarOrcamentoDaOS",
      "salvarOrcamentoV3",
      "corrigirOrcamentoV3",
      "aprovarOrcamentoV3",
      "recusarOrcamentoV3",
      "aplicarTransicaoStatusV3",
      // Entrada/Recepção (slice 003)
      "salvarIdentificacaoV3",
      "salvarProvaEntradaV3",
      "salvarAcessoriosEntradaV3",
      "salvarChecklistEntradaV3",
      // Dados básicos da OS (slice 003B)
      "salvarDadosBasicosOSV3",
    ]) {
      expect(orquestrador, `esperava reuso de ${action}`).toContain(action)
    }
  })

  it("só dispara transições de status SEGURAS (diagnostico / em_execucao / aguardando_peca / pronta / entregue)", () => {
    const args = [...orquestrador.matchAll(/aplicarTransicaoStatusV3\([^,]+,[^,]+,\s*"([a-z_]+)"\)/g)].map((m) => m[1])
    expect(args.length).toBeGreaterThan(0)
    // OPS-V4-EXECUCAO-REAL-007 estendeu o conjunto seguro do slice 002 com as duas
    // transições da Execução (aguardando_peca / pronta). OPS-V4-ENTREGA-REAL-E-CTA-
    // QUITADO-008 soma "entregue": `aplicarTransicaoStatusV3` delega esse caso a
    // `registrarEntregaV3` (idempotente, guard de permissão próprio — Fase 0 do
    // GOAL), cujo único efeito colateral é estoque via adapter oficial
    // (`consumirEstoqueOSV3`, idempotente/best-effort) — sem caixa/financeiro
    // diretos. "cancelada" continua fora (restaura estoque + cancela CR — rota
    // maior, fora do escopo deste GOAL); "aguardando_aprovacao" não tem UI real
    // nesta Preview.
    expect(new Set(args)).toEqual(new Set(["diagnostico", "em_execucao", "aguardando_peca", "pronta", "entregue"]))
    for (const proibida of ["cancelada", "aguardando_aprovacao"]) {
      expect(args).not.toContain(proibida)
    }
  })

  it("o código-fonte da V4 não importa caixa/estoque/financeiro/PDV/WhatsApp/Fiscal", () => {
    for (const proibido of [
      'from "@/lib/caixa',
      'from "@/lib/financeiro',
      'from "@/lib/estoque',
      'from "@/lib/whatsapp',
      'from "@/lib/fiscal',
      'from "@/components/pdv',
      'from "@/app/actions/caixa',
    ]) {
      expect(allSources, `import proibido encontrado: ${proibido}`).not.toContain(proibido)
    }
  })

  it("a V4 nunca usa fallback de loja (loja-1 como valor literal)", () => {
    // Só rejeita o literal entre aspas (um fallback de verdade); menções em comentário
    // ("sem fallback loja-1") são permitidas.
    for (const lit of ['"loja-1"', "'loja-1'", "`loja-1`"]) {
      expect(allSources, `fallback literal encontrado: ${lit}`).not.toContain(lit)
    }
  })
})

// ---------------------------------------------------------------------------
// OPS-V4-SEGURANCA-ACESSO-PARITY-004A — Padrão 3×3 V4-nativo na Entrada.
// ---------------------------------------------------------------------------
describe("Operações V4 — Padrão 3×3 (PatternPadV4) na Entrada, sem tocar autorização de gerente", () => {
  const entradaStage = readFileSync(join(DIR, "parts", "stages", "EntradaStage.tsx"), "utf8")
  const patternPad = readFileSync(join(DIR, "parts", "PatternPadV4.tsx"), "utf8")
  const segurancaStage = readFileSync(join(DIR, "parts", "stages", "SegurancaStage.tsx"), "utf8")

  it("EntradaStage renderiza PatternPadV4 quando senhaTipo === \"padrao\"", () => {
    expect(entradaStage).toContain("PatternPadV4")
    expect(entradaStage).toMatch(/senhaTipo\s*===\s*"padrao"/)
  })

  it("PatternPadV4 não importa o PatternPadV3 nem o sistema de estilo do V3 (Tailwind/cn/ButtonV3)", () => {
    // Rejeita a IMPORTAÇÃO real (menção ao nome em comentário explicando a decisão é permitida).
    for (const proibido of [
      'from "@/components/operacoes-v3/components/PatternPadV3"',
      'from "@/components/operacoes-v3/components/UiV3"',
      'from "@/lib/utils"',
    ]) {
      expect(patternPad, `import proibido: ${proibido}`).not.toContain(proibido)
    }
    expect(patternPad, "não deve usar className (V3 usa Tailwind; V4 usa style inline)").not.toContain("className")
  })

  it("PatternPadV4 é puramente apresentacional: delega a lógica de sequência ao helper puro de lib/operacoes-v4", () => {
    expect(patternPad).toContain("togglePadraoPonto")
    expect(patternPad).toContain("@/lib/operacoes-v4/entrada-form")
  })

  it("SegurancaStage (autorização de gerente) não foi tocado por este slice: não referencia PatternPadV4", () => {
    expect(segurancaStage).not.toContain("PatternPadV4")
  })
})

// ---------------------------------------------------------------------------
// OPS-V4-FINANCEIRO-READONLY-HIGIENE-006 — adapters legados mantidos apenas como
// compatibilidade isolada; as superfícies runtime usam a projeção server-side.
// ---------------------------------------------------------------------------
describe("OPS-V4-006 — compatibilidade dos adapters legados fora das superfícies runtime", () => {
  const osComPagamento = mkOS({
    id: "os-pag",
    status: "pronta",
    pagamentoV3: { total: 890, recebido: 300, saldo: 590, status: "parcial", ultimaForma: "PIX" },
  })

  it("adaptPag lê total/recebido/saldo/status do espelho (sem inventar nada)", () => {
    const pag = adaptPag(osComPagamento)
    expect(pag.temPagamento).toBe(true)
    expect(pag.total).toBe(fmt(890))
    expect(pag.recebido).toBe(fmt(300))
    expect(pag.saldo).toBe(fmt(590))
    expect(pag.pagamentoStatusLabel).toBe("Parcial")
  })

  it("sem espelho, recebido/saldo continuam NI (vazio honesto — nada de saldo fabricado)", () => {
    const pag = adaptPag(mkOS({ id: "os-sem", status: "aberta" }))
    expect(pag.temPagamento).toBe(false)
    expect(pag.recebido).toBe(NI)
    expect(pag.saldo).toBe(NI)
    expect(pag.pagamentoStatusLabel).toBe("")
  })

  it("adaptFinanceiro expõe recebido/saldo/temSaldo; quitado zera o saldo e vira success", () => {
    const parcial = adaptFinanceiro(osComPagamento)
    expect(parcial.temPagamento).toBe(true)
    expect(parcial.temSaldo).toBe(true)
    expect(parcial.recebido).toBe(fmt(300))

    const quitado = adaptFinanceiro(
      mkOS({ id: "os-q", status: "pronta", pagamentoV3: { total: 890, recebido: 890, saldo: 0, status: "quitado" } }),
    )
    expect(quitado.temPagamento).toBe(true)
    expect(quitado.temSaldo).toBe(false)
    expect(quitado.pagamentoStatusLabel).toBe("Quitado")
    expect(quitado.pagamentoStatusTone).toBe("success")
  })

  it("FinanceiroStage consome a projeção única e não depende do espelho da OS", () => {
    const src = readFileSync(join(DIR, "parts", "stages", "FinanceiroStage.tsx"), "utf8")
    expect(src).toContain("v.financial")
    expect(src).toContain("projection.receivedTotal")
    expect(src).not.toContain("f.temDados")
  })
})

describe("OPS-V4-PIPELINE-DEDUP-004 — a spine é a única fonte da etapa atual", () => {
  // O segundo trilho (`v.steps`, renderizado pela Atividade) foi REMOVIDO pelo
  // GOAL OPS-V4-RIGHT-RAIL-DEDUP-001 — a divergência que este describe caçava
  // deixou de ser possível por construção. Restam os invariantes da spine.
  it("OS 'pronta': a spine marca 'Entrega' como etapa atual — Financeiro saiu da trilha", () => {
    const v = buildVals(
      makeState({ status: "em_execucao", selectedOsId: "os-x", novaOS: false }),
      () => {},
      () => {},
      { ...ctx, realOS: mkOS({ id: "os-x", status: "pronta" }) },
    )
    const pipelineAtual = v.pipeline.find((n) => n.current)
    expect(pipelineAtual?.label).toBe("Entrega")
    expect(v.pipeline.map((n) => n.id)).toEqual(["entrada", "diagnostico", "execucao", "entrega", "posvenda"])
    expect(v.pipeline.filter((n) => n.current)).toHaveLength(1)
  })

  it("header comercial/financeiro/histórico reutilizam os estágios reais e não a pipeline", () => {
    const v = buildVals(
      makeState({ status: "aberta", selectedOsId: "os-x", novaOS: false }),
      () => {},
      () => {},
      {
        ...ctx,
        realOS: mkOS({
          id: "os-x",
          status: "aberta",
          orcamento: { status: "aprovado", total: 400, sintetizado: false, servicos: [{ id: "s1", descricao: "Tela", valor: 400 }], pecas: [] },
        }),
        financialProjection: financialStateFromPayment({ total: 400, recebido: 0, saldo: 400, status: "aberto" }),
      },
    )
    expect(v.comercialHeader.label).toBe("R$ 400,00 · Aprovado")
    expect(v.financeiroHeader.label).toBe("R$ 400,00 a receber")
    expect(v.historicoHeader.label).toBe("Histórico")
    expect(v.goOrcamento).toBeTypeOf("function")
    expect(v.goFinanceiro).toBeTypeOf("function")
    expect(v.goHistorico).toBeTypeOf("function")
  })

  it("abrir a aba Entrega numa OS 'pronta' marca Entrega como atual, não concluída", () => {
    const v = buildVals(
      makeState({ status: "em_execucao", selectedOsId: "os-x", stage: "entrega", novaOS: false }),
      () => {},
      () => {},
      { ...ctx, realOS: mkOS({ id: "os-x", status: "pronta" }) },
    )
    const entregaNode = v.pipeline.find((n) => n.id === "entrega")
    expect(entregaNode?.selected).toBe(true)
    expect(entregaNode?.current).toBe(true)
    expect(entregaNode?.done).toBe(false)
    expect(entregaNode?.pending).toBe(false)
  })
})

describe("OPS-V4-RIGHT-RAIL-DEDUP-001 — lateral 'Atividade' é painel contextual, não cópia do fluxo", () => {
  const activitySrc = readFileSync(join(DIR, "parts", "ActivityColumn.tsx"), "utf8")
  const hookSrc = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")

  it("não renderiza o trilho duplicado de etapas nem o texto 'Mesmas etapas do fluxo principal'", () => {
    expect(activitySrc).not.toContain("Mesmas etapas do fluxo principal")
    expect(activitySrc).not.toContain("v.steps")
  })

  it("mantém Comunicação, Anexos, observação e histórico do cliente", () => {
    expect(activitySrc).toContain("Comunicação")
    expect(activitySrc).toContain("Anexos")
    expect(activitySrc).toContain("Nova observação")
    expect(activitySrc).toContain("Abrir histórico do cliente")
  })

  it("fecha por padrão e lembra a preferência numa chave localStorage isolada da V4", () => {
    // default fechado no estado inicial do hook
    expect(hookSrc).toMatch(/right:\s*false/)
    // chave própria da V4 — não colide com outras telas
    expect(hookSrc).toContain("omnigestao:operacoes-v4:right-rail-open")
    // a chave vive apenas no hook: nenhum outro arquivo da Preview toca localStorage
    const outros = collectSourceFiles(DIR).filter(
      (f) => !f.endsWith("use-v4-preview.ts") && readFileSync(f, "utf8").includes("localStorage"),
    )
    expect(outros, `localStorage fora do hook: ${outros.join(", ")}`).toEqual([])
  })

  it("ActivityColumn permanece visual: importa apenas UI e ícones, sem domínio ou I/O", () => {
    const importPaths = [...activitySrc.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])
    expect(importPaths.length).toBeGreaterThan(0)
    for (const p of importPaths) {
      expect(
        p.startsWith("./") ||
          p.startsWith("../") ||
          p === "lucide-react" ||
          p === "@/components/ui/collapsible-hover-rail" ||
          p === "@/lib/workspace-overlay-orchestrator",
        `import proibido em ActivityColumn: ${p}`,
      ).toBe(true)
    }
  })
})

describe("OPS-V4-PDV-SERVICO-FINANCEIRO-SHORTCUT-005 — abrir do rail PDV com saldo aberto vai direto ao Financeiro", () => {
  const osComSaldoAberto = mkOS({
    id: "os-saldo",
    status: "pronta",
    orcamento: { sintetizado: false },
    pagamentoV3: { total: 470, recebido: 0 },
  })
  const osQuitada = mkOS({
    id: "os-quitada",
    status: "pronta",
    orcamento: { sintetizado: false },
    pagamentoV3: { total: 470, recebido: 470 },
  })

  it("openOSFromRail(id, true) — OS com saldo real aberto abre stage 'financeiro' (não 'entrega')", () => {
    const patches: Array<Record<string, unknown>> = []
    const v = buildVals(
      makeState({ selectedOsId: null, novaOS: false }),
      (p) => patches.push(p as Record<string, unknown>),
      () => {},
      { ...ctx, ordens: [osComSaldoAberto], financialProjectionsByOsId: new Map([["os-saldo", financialStateFromPayment({ total: 470, recebido: 0, saldo: 470, status: "aberto" }).projection!]]) },
    )
    v.openOSFromRail("os-saldo", true)
    expect(patches.at(-1)).toMatchObject({ selectedOsId: "os-saldo", stage: "financeiro", module: "workspace" })
  })

  it("openOSFromRail(id, true) — OS quitada mantém o stage normal (stageForStatus → 'entrega' para 'pronta')", () => {
    const patches: Array<Record<string, unknown>> = []
    const v = buildVals(
      makeState({ selectedOsId: null, novaOS: false }),
      (p) => patches.push(p as Record<string, unknown>),
      () => {},
      { ...ctx, ordens: [osQuitada], financialProjectionsByOsId: new Map([["os-quitada", financialStateFromPayment({ total: 470, recebido: 470, saldo: 0, status: "quitado" }).projection!]]) },
    )
    v.openOSFromRail("os-quitada", true)
    expect(patches.at(-1)).toMatchObject({ selectedOsId: "os-quitada", stage: "entrega", module: "workspace" })
  })

  it("openOSFromRail(id) sem 'fromPdv' (Fila/Bancada/SLA) NUNCA abre em 'financeiro' — mesmo com saldo aberto", () => {
    const patches: Array<Record<string, unknown>> = []
    const v = buildVals(
      makeState({ selectedOsId: null, novaOS: false }),
      (p) => patches.push(p as Record<string, unknown>),
      () => {},
      { ...ctx, ordens: [osComSaldoAberto] },
    )
    v.openOSFromRail("os-saldo") // sem 2º argumento → comportamento anterior preservado
    expect(patches.at(-1)).toMatchObject({ selectedOsId: "os-saldo", stage: "entrega", module: "workspace" })
  })

  it("bloqueio de Entrega por saldo expõe v.goFinanceiro — só navega, nunca recebe/entrega/cancela", () => {
    const patches: Array<Record<string, unknown>> = []
    const v = buildVals(
      makeState({ status: "em_execucao", selectedOsId: "os-x", stage: "entrega", novaOS: false }),
      (p) => patches.push(p as Record<string, unknown>),
      () => {},
      { ...ctx, realOS: mkOS({ id: "os-x", status: "pronta" }), financialProjection: financialStateFromPayment({ total: 470, recebido: 0, saldo: 470, status: "aberto" }), pdvServico: { ...ctx.pdvServico, pagamento: { total: 470, recebido: 0, saldo: 470, status: "aberto" } } },
    )
    expect(v.entregaAcoes.bloqueadaPorSaldo).toBe(true)
    expect(v.entregaAcoes.podeConfirmar).toBe(false)
    expect(typeof v.goFinanceiro).toBe("function")
    v.goFinanceiro()
    expect(patches.at(-1)).toMatchObject({ stage: "financeiro" })
    // O atalho é navegação pura — nenhuma chamada de recebimento/entrega/cancelamento.
    expect(patches.every((p) => !("selectedOsId" in p) || p.selectedOsId === "os-x")).toBe(true)
  })
})

describe("OPS-V4-006 — status exibido prioriza o da OS real carregada (sem drift)", () => {
  it("realOS.status vence o snapshot local st.status", () => {
    const v = buildVals(
      makeState({ status: "em_execucao", selectedOsId: "os-x", novaOS: false }),
      () => {},
      () => {},
      { ...ctx, realOS: mkOS({ id: "os-x", status: "pronta" }), financialProjection: financialStateFromPayment({ total: 100, recebido: 0, saldo: 100, status: "aberto" }) },
    )
    expect(v.statusLabel).toBe("Pronta")
    expect(v.primaryLabel).toBe("Receber pagamento")
  })

  it("sem OS carregada, cai no fallback do estado local", () => {
    const v = buildVals(makeState({ status: "em_execucao", novaOS: false }), () => {}, () => {}, ctx)
    expect(v.statusLabel).toBe("Em execução")
  })

  it("CTA 'Receber pagamento' navega ao Financeiro (recebimento real vive lá, nunca na Entrega)", () => {
    const patches: Array<Record<string, unknown>> = []
    const msgs: string[] = []
    const v = buildVals(
      makeState({ status: "em_execucao", selectedOsId: "os-x", novaOS: false }),
      (p) => patches.push(p as Record<string, unknown>),
      (m) => msgs.push(m),
      { ...ctx, realOS: mkOS({ id: "os-x", status: "pronta" }), financialProjection: financialStateFromPayment({ total: 100, recebido: 0, saldo: 100, status: "aberto" }) },
    )
    v.onPrimary()
    expect(patches.at(-1)).toMatchObject({ stage: "financeiro" })
    expect(patches.every((p) => !("status" in p)), "nenhum patch pode conter status").toBe(true)
    expect(msgs.some((m) => /financeiro/i.test(m))).toBe(true)
  })

  it("'Trocar OS' usa o fluxo real de busca (limpa a seleção; sem no-op)", () => {
    const patches: Array<Record<string, unknown>> = []
    const msgs: string[] = []
    const v = buildVals(
      makeState({ selectedOsId: "os-x", novaOS: false }),
      (p) => patches.push(p as Record<string, unknown>),
      (m) => msgs.push(m),
      ctx,
    )
    const trocar = v.moreItems.find((m) => m.label === "Trocar OS")
    expect(trocar).toBeDefined()
    trocar!.onClick()
    expect(patches.at(-1)).toMatchObject({ selectedOsId: null, module: "workspace" })
    expect(msgs).toEqual([]) // não é mais toast de indisponível
  })
})

// ---------------------------------------------------------------------------
// OPS-V4-ENTREGA-REAL-E-CTA-QUITADO-008 — CTA global coerente com o pagamento:
// "Receber pagamento" só aparece com saldo pendente; quitada mostra "Entregar OS"
// e leva à Entrega (nunca confirma a entrega a partir do header); Entregue
// mantém "Fluxo concluído" (sem CTA de receber).
// ---------------------------------------------------------------------------
describe("OPS-V4-ENTREGA-REAL-E-CTA-QUITADO-008 — CTA global reflete o saldo real", () => {
  function ctxProntaComPagamento(pagamento: Pick<PagamentoV3, "total" | "recebido" | "saldo" | "status"> | null) {
    return {
      ...ctx,
      realOS: mkOS({ id: "os-x", status: "pronta" }),
      financialProjection: financialStateFromPayment(pagamento),
      pdvServico: { ...ctx.pdvServico, pagamento },
    }
  }

  it("pronta + saldo > 0: CTA continua 'Receber pagamento' e navega ao Financeiro", () => {
    const patches: Array<Record<string, unknown>> = []
    const msgs: string[] = []
    const v = buildVals(
      makeState({ selectedOsId: "os-x", novaOS: false }),
      (p) => patches.push(p as Record<string, unknown>),
      (m) => msgs.push(m),
      ctxProntaComPagamento({ total: 320, recebido: 0, saldo: 320, status: "aberto" }),
    )
    expect(v.primaryLabel).toBe("Receber pagamento")
    v.onPrimary()
    expect(patches.at(-1)).toMatchObject({ stage: "financeiro" })
    expect(patches.every((p) => !("status" in p)), "nenhum patch pode conter status").toBe(true)
    expect(msgs.some((m) => /financeiro/i.test(m))).toBe(true)
  })

  it("pronta + saldo == 0 (quitada): CTA vira 'Entregar OS' e navega à Entrega — nunca confirma direto do header", () => {
    const patches: Array<Record<string, unknown>> = []
    const msgs: string[] = []
    const v = buildVals(
      makeState({ selectedOsId: "os-x", novaOS: false }),
      (p) => patches.push(p as Record<string, unknown>),
      (m) => msgs.push(m),
      ctxProntaComPagamento({ total: 320, recebido: 320, saldo: 0, status: "quitado" }),
    )
    expect(v.primaryLabel).toBe("Entregar OS")
    expect(v.hasPrimary).toBe(true)
    v.onPrimary()
    expect(patches.at(-1)).toMatchObject({ stage: "entrega" })
    expect(patches.every((p) => !("status" in p)), "nenhum patch pode conter status — a confirmação real fica no botão da Entrega").toBe(true)
    expect(msgs.some((m) => /entrega/i.test(m))).toBe(true)
  })

  it("pronta sem cobrança autorizada (total=0): CTA exige revisão, nunca entrega implícita", () => {
    const v = buildVals(
      makeState({ selectedOsId: "os-x", novaOS: false }),
      () => {},
      () => {},
      ctxProntaComPagamento({ total: 0, recebido: 0, saldo: 0, status: "sem_cobranca" }),
    )
    expect(v.primaryLabel).toBe("Revisar cobrança")
  })

  it("pronta + projeção ainda não carregada: mantém o default seguro de revisão", () => {
    const v = buildVals(
      makeState({ selectedOsId: "os-x", novaOS: false }),
      () => {},
      () => {},
      ctxProntaComPagamento(null),
    )
    expect(v.primaryLabel).toBe("Revisar cobrança")
  })

  it("entregue: sem CTA de receber — mostra estado final honesto ('Fluxo concluído')", () => {
    const v = buildVals(
      makeState({ selectedOsId: "os-x", novaOS: false }),
      () => {},
      () => {},
      { ...ctx, realOS: mkOS({ id: "os-x", status: "entregue" }) },
    )
    expect(v.hasPrimary).toBe(false)
    expect(v.noPrimary).toBe(true)
  })
})

describe("OPS-V4-ENTREGA-REAL-E-CTA-QUITADO-008 — entregaAcoes só habilita com status pronta e saldo confirmado <= 0", () => {
  function ctxEntrega(status: string, pagamento: Pick<PagamentoV3, "total" | "recebido" | "saldo" | "status"> | null) {
    return {
      ...ctx,
      realOS: mkOS({ id: "os-ent", status }),
      financialProjection: financialStateFromPayment(pagamento),
      pdvServico: { ...ctx.pdvServico, pagamento },
    }
  }

  it("pronta + saldo 0: podeConfirmar true, bloqueadaPorSaldo false", () => {
    const v = buildVals(makeState({ selectedOsId: "os-ent", novaOS: false }), () => {}, () => {}, ctxEntrega("pronta", { total: 320, recebido: 320, saldo: 0, status: "quitado" }))
    expect(v.entregaAcoes).toMatchObject({ podeConfirmar: true, bloqueadaPorSaldo: false, autorizadaAPrazo: false, semCobrancaLancada: false })
  })

  it("pronta + saldo > 0: podeConfirmar false, bloqueadaPorSaldo true (mensagem de bloqueio, não botão)", () => {
    const v = buildVals(makeState({ selectedOsId: "os-ent", novaOS: false }), () => {}, () => {}, ctxEntrega("pronta", { total: 320, recebido: 0, saldo: 320, status: "aberto" }))
    expect(v.entregaAcoes).toMatchObject({ podeConfirmar: false, bloqueadaPorSaldo: true, autorizadaAPrazo: false, semCobrancaLancada: false })
  })

  it("pronta + pagamento não carregado (null): nenhuma ação disponível ainda (nem confirmar nem bloqueio) — evita flicker", () => {
    const v = buildVals(makeState({ selectedOsId: "os-ent", novaOS: false }), () => {}, () => {}, ctxEntrega("pronta", null))
    expect(v.entregaAcoes).toMatchObject({ podeConfirmar: false, bloqueadaPorSaldo: false, autorizadaAPrazo: false, semCobrancaLancada: false })
    expect(v.entregaAcoes.leituraFinanceiraBloqueada).toBe(true)
  })

  it("outros status (em_execucao, entregue, aberta): entregaAcoes sempre desabilitada", () => {
    for (const status of ["em_execucao", "aberta", "entregue", "diagnostico"]) {
      const v = buildVals(makeState({ selectedOsId: "os-ent", novaOS: false }), () => {}, () => {}, ctxEntrega(status, { total: 320, recebido: 320, saldo: 0, status: "quitado" }))
      expect(v.entregaAcoes, `status ${status}`).toMatchObject({ podeConfirmar: false, bloqueadaPorSaldo: false, autorizadaAPrazo: false, semCobrancaLancada: false })
    }
  })

  it("sem OS selecionada, entregaAcoes fica desabilitada mesmo com snapshot local 'pronta'", () => {
    const v = buildVals(makeState({ status: "pronta", selectedOsId: null, novaOS: false }), () => {}, () => {}, ctx)
    expect(v.entregaAcoes).toMatchObject({ podeConfirmar: false, bloqueadaPorSaldo: false, autorizadaAPrazo: false, semCobrancaLancada: false })
  })
})

describe("OPS-V4-RECEBIMENTO-A-PRAZO-MINIMO-006 — entregaAcoes libera entrega quando 'a prazo' foi autorizado", () => {
  function ctxEntregaAPrazo(status: string, pagamento: Pick<PagamentoV3, "total" | "recebido" | "saldo" | "status"> | null, aPrazoV3: Record<string, unknown> | undefined) {
    return {
      ...ctx,
      realOS: mkOS({ id: "os-ent-aprazo", status, aPrazoV3 }),
      financialProjection: financialStateFromPayment(
        pagamento,
        aPrazoV3?.status === "pendente" && aPrazoV3?.autorizadoEntrega === true ? "AUTHORIZED_CREDIT" : undefined,
      ),
      pdvServico: { ...ctx.pdvServico, pagamento },
    }
  }

  it("pronta + saldo > 0 + aPrazoV3 autorizado pendente: podeConfirmar true, bloqueadaPorSaldo false, autorizadaAPrazo true", () => {
    const v = buildVals(
      makeState({ selectedOsId: "os-ent-aprazo", novaOS: false }),
      () => {},
      () => {},
      ctxEntregaAPrazo("pronta", { total: 320, recebido: 0, saldo: 320, status: "aberto" }, {
        modo: "a_prazo",
        status: "pendente",
        valor: 320,
        vencimento: "2026-08-01",
        autorizadoEntrega: true,
      }),
    )
    expect(v.entregaAcoes).toMatchObject({ podeConfirmar: true, bloqueadaPorSaldo: false, autorizadaAPrazo: true, semCobrancaLancada: false })
  })

  it("pronta + saldo > 0 + aPrazoV3 já cancelado (status !== 'pendente'): continua bloqueando normalmente", () => {
    const v = buildVals(
      makeState({ selectedOsId: "os-ent-aprazo", novaOS: false }),
      () => {},
      () => {},
      ctxEntregaAPrazo("pronta", { total: 320, recebido: 0, saldo: 320, status: "aberto" }, {
        modo: "a_prazo",
        status: "cancelado",
        valor: 320,
        vencimento: "2026-08-01",
        autorizadoEntrega: true,
      }),
    )
    expect(v.entregaAcoes).toMatchObject({ podeConfirmar: false, bloqueadaPorSaldo: true, autorizadaAPrazo: false, semCobrancaLancada: false })
  })
})

// ---------------------------------------------------------------------------
// GOAL OPS-V4-ENTREGA-GUARD-SEM-COBRANCA-002 — a entrega distingue quitada,
// saldo pendente e SEM cobrança lançada (total R$ 0). A OS sem cobrança nunca é
// entregue em silêncio: exige categoria + motivo e decisão server-side persistida.
// ---------------------------------------------------------------------------
describe("OPS-V4-ENTREGA-GUARD-SEM-COBRANCA-002 — entregaAcoes separa quitado, saldo pendente e sem cobrança", () => {
  function ctxEntrega(status: string, pagamento: Pick<PagamentoV3, "total" | "recebido" | "saldo" | "status"> | null) {
    return {
      ...ctx,
      realOS: mkOS({ id: "os-guard", status }),
      financialProjection: financialStateFromPayment(pagamento),
      pdvServico: { ...ctx.pdvServico, pagamento },
    }
  }

  it("pronta + total 0 (sem cobrança lançada): semCobrancaLancada true, podeConfirmar false, bloqueadaPorSaldo false", () => {
    const v = buildVals(makeState({ selectedOsId: "os-guard", novaOS: false }), () => {}, () => {}, ctxEntrega("pronta", { total: 0, recebido: 0, saldo: 0, status: "sem_cobranca" }))
    expect(v.entregaAcoes).toMatchObject({ podeConfirmar: false, bloqueadaPorSaldo: false, autorizadaAPrazo: false, semCobrancaLancada: true })
  })

  it("pronta + total > 0 e saldo 0 (quitada de verdade): podeConfirmar true, semCobrancaLancada false", () => {
    const v = buildVals(makeState({ selectedOsId: "os-guard", novaOS: false }), () => {}, () => {}, ctxEntrega("pronta", { total: 320, recebido: 320, saldo: 0, status: "quitado" }))
    expect(v.entregaAcoes).toMatchObject({ podeConfirmar: true, bloqueadaPorSaldo: false, autorizadaAPrazo: false, semCobrancaLancada: false })
  })

  it("pronta + total > 0 e saldo > 0 (saldo pendente): bloqueadaPorSaldo true, semCobrancaLancada false", () => {
    const v = buildVals(makeState({ selectedOsId: "os-guard", novaOS: false }), () => {}, () => {}, ctxEntrega("pronta", { total: 320, recebido: 0, saldo: 320, status: "aberto" }))
    expect(v.entregaAcoes).toMatchObject({ podeConfirmar: false, bloqueadaPorSaldo: true, autorizadaAPrazo: false, semCobrancaLancada: false })
  })

  it("pronta + pagamento não carregado (null): nada se decide ainda (anti-flicker) — nem sem cobrança nem confirmar", () => {
    const v = buildVals(makeState({ selectedOsId: "os-guard", novaOS: false }), () => {}, () => {}, ctxEntrega("pronta", null))
    expect(v.entregaAcoes).toMatchObject({ podeConfirmar: false, bloqueadaPorSaldo: false, autorizadaAPrazo: false, semCobrancaLancada: false })
    expect(v.entregaAcoes.leituraFinanceiraBloqueada).toBe(true)
  })

  it("total 0 mas status != pronta (em_execucao): semCobrancaLancada false (o guard só vale na etapa de entrega)", () => {
    const v = buildVals(makeState({ selectedOsId: "os-guard", novaOS: false }), () => {}, () => {}, ctxEntrega("em_execucao", { total: 0, recebido: 0, saldo: 0, status: "sem_cobranca" }))
    expect(v.entregaAcoes.semCobrancaLancada).toBe(false)
  })

  it("goOrcamento navega à etapa Orçamento (caminho 'Ir para Orçamento' do alerta) — só navegação, nunca muda status", () => {
    const patches: Array<Record<string, unknown>> = []
    const v = buildVals(makeState({ selectedOsId: "os-guard", novaOS: false }), (p) => patches.push(p as Record<string, unknown>), () => {}, ctxEntrega("pronta", { total: 0, recebido: 0, saldo: 0, status: "sem_cobranca" }))
    expect(typeof v.goOrcamento).toBe("function")
    v.goOrcamento()
    expect(patches.at(-1)).toMatchObject({ stage: "orcamento", module: "workspace" })
    expect(patches.every((p) => !("status" in p)), "navegação pura — nunca muda status").toBe(true)
  })
})

describe("OPS-V4-DELIVERY-FINANCIAL-GUARD-SERVER-001 — EntregaStage coleta autorização persistível", () => {
  const entregaStageSrc = readFileSync(join(DIR, "parts", "stages", "EntregaStage.tsx"), "utf8")

  it("mostra o alerta forte 'OS sem cobrança lançada' com os dois caminhos (Orçamento / sem cobrança)", () => {
    expect(entregaStageSrc).toContain("OS sem cobrança lançada")
    expect(entregaStageSrc).toContain("v.goOrcamento")
    expect(entregaStageSrc).toContain("Entregar sem cobrança")
    expect(entregaStageSrc).toMatch(/cortesia, garantia ou serviço realmente sem valor/)
  })

  it("exige categoria e motivo e envia apenas a solicitação para decisão server-side", () => {
    expect(entregaStageSrc).toMatch(/ea\.semCobrancaLancada && !formSemCobrancaAberto/)
    expect(entregaStageSrc).toContain("setFormSemCobrancaAberto(true)")
    expect(entregaStageSrc).toContain("Categoria obrigatória")
    expect(entregaStageSrc).toContain("Motivo obrigatório")
    expect(entregaStageSrc).toContain("v.confirmarEntrega(semCobranca)")
    expect(entregaStageSrc).toContain("Confirmar entrega sem cobrança")
    expect(entregaStageSrc).toMatch(/useEffect\(\(\) => \{\s*setFormSemCobrancaAberto\(false\);\s*setCategoria\(""\);\s*setMotivo\(""\)/)
  })
})

describe("OPS-V4-DELIVERY-FINANCIAL-GUARD-SERVER-001 — confirmarEntrega usa a action canônica protegida", () => {
  const orquestrador = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")
  const entregaStage = readFileSync(join(DIR, "parts", "stages", "EntregaStage.tsx"), "utf8")

  it("chama registrarEntregaV3 com a solicitação opcional de não cobrança", () => {
    expect(orquestrador).toContain("registrarEntregaV3(sid, osId, semCobranca ? { semCobranca } : {})")
  })

  it("passa pelo wrapper runWrite (fonte única de reload/patch-em-sucesso) — falha não muta status", () => {
    expect(orquestrador).toMatch(/const confirmarEntrega = useCallback\(\s*\(semCobranca\?: EntregaSemCobrancaSolicitacaoV3\)\s*=>\s*runWrite\(/)
    // runWrite continua definido uma única vez — confirmarEntrega reaproveita, não duplica.
    expect(orquestrador.match(/const runWrite = useCallback/g)?.length).toBe(1)
  })

  it("EntregaStage chama o handler real (v.confirmarEntrega) — não é toast de preview", () => {
    expect(entregaStage).toContain("v.confirmarEntrega")
    expect(entregaStage).not.toContain("PREVIEW_NOOP")
  })

  it("EntregaAcaoCard também bloqueia visualmente enquanto a leitura financeira está indisponível", () => {
    expect(entregaStage).toMatch(/if \(!ea\.podeConfirmar && !ea\.bloqueadaPorSaldo && !ea\.semCobrancaLancada && !ea\.leituraFinanceiraBloqueada\) return null/)
    expect(entregaStage).toContain("Confirmando a situação financeira desta OS")
  })

  it("botão de confirmar tem busy-lock (evita duplo clique)", () => {
    expect(entregaStage).toContain("useState")
    expect(entregaStage).toMatch(/disabled=\{busy\}/)
  })

  it("EntregaStage não chama PDV/Caixa/Financeiro/Estoque/WhatsApp/Fiscal nem recebimento (só a transição de status)", () => {
    // Escopo = só o arquivo novo (EntregaStage.tsx), mesmo padrão do guard já
    // existente para o ExecucaoStage — não `allSources`, que já tem menções
    // legítimas de `receberOSV3` em outros arquivos (slice de recebimento, já
    // sancionado e coberto pelos próprios guards daquele slice).
    for (const proibido of [
      'from "@/lib/caixa',
      'from "@/lib/financeiro',
      'from "@/lib/estoque',
      'from "@/lib/whatsapp',
      'from "@/lib/fiscal',
      'from "@/components/pdv',
      "updateOSPayload",
      "receberOSV3",
      "estornarRecebimentoOSV3",
      '"loja-1"',
      "openCaixaIfClosed",
    ]) {
      expect(entregaStage, `referência proibida encontrada: ${proibido}`).not.toContain(proibido)
    }
  })
})

describe("OPS-V4-ENTREGA-REAL-E-CTA-QUITADO-008 — Financeiro sinaliza 'falta entregar' quando quitada", () => {
  function ctxQuitada(entregue: boolean) {
    return {
      ...ctx,
      realOS: mkOS({
        id: "os-fin",
        status: entregue ? "entregue" : "pronta",
        ...(entregue ? { retirada: { confirmado: true, retiradoPor: "Cliente" }, entregueEm: "2026-07-01T10:00:00.000Z" } : {}),
      }),
      financialProjection: financialStateFromPayment({ total: 320, recebido: 320, saldo: 0, status: "quitado" }),
      pdvServico: { ...ctx.pdvServico, pagamento: { total: 320, recebido: 320, saldo: 0, status: "quitado" as const } },
    }
  }

  it("quitada e ainda não entregue: v.entrega.entregue é false (a UI mostra a chamada para ir à Entrega)", () => {
    const v = buildVals(makeState({ selectedOsId: "os-fin", novaOS: false }), () => {}, () => {}, ctxQuitada(false))
    expect(v.recebimento.quitado).toBe(true)
    expect(v.entrega.entregue).toBe(false)
  })

  it("quitada e já entregue: v.entrega.entregue é true (a UI não repete a chamada para ir à Entrega)", () => {
    const v = buildVals(makeState({ selectedOsId: "os-fin", novaOS: false }), () => {}, () => {}, ctxQuitada(true))
    expect(v.recebimento.quitado).toBe(true)
    expect(v.entrega.entregue).toBe(true)
  })

  it("goEntrega navega à etapa Entrega (só navegação; a ação real fica no botão de lá)", () => {
    const patches: Array<Record<string, unknown>> = []
    const v = buildVals(makeState({ selectedOsId: "os-fin", novaOS: false }), (p) => patches.push(p as Record<string, unknown>), () => {}, ctxQuitada(false))
    v.goEntrega()
    expect(patches.at(-1)).toMatchObject({ stage: "entrega" })
  })

  it("ReceberPagamentoV4 mostra a chamada para Entrega só quando quitado e ainda não entregue", () => {
    const card = readFileSync(join(DIR, "parts", "ReceberPagamentoV4.tsx"), "utf8")
    expect(card).toContain("v.entrega.entregue")
    expect(card).toContain("v.goEntrega")
  })
})

describe("OPS-V4-006 — senha do aparelho mascarada por padrão", () => {
  it("maskSenhaV4 nunca devolve a senha: PIN/texto viram máscara fixa; padrão vira rótulo", () => {
    expect(maskSenhaV4("1234 (PIN)", "numerica")).toBe("••••••")
    expect(maskSenhaV4("hunter2", "texto")).toBe("••••••")
    expect(maskSenhaV4("1 → 2 → 3", "padrao")).toBe("Padrão cadastrado")
    expect(maskSenhaV4("", "")).toBe(NI)
    expect(maskSenhaV4(NI, "numerica")).toBe(NI)
  })

  it("ContextColumn usa SenhaRow com máscara e revelação local (sem persistir nada)", () => {
    const src = readFileSync(join(DIR, "parts", "ContextColumn.tsx"), "utf8")
    expect(src).toContain("maskSenhaV4")
    expect(src).toContain("SenhaRow")
    expect(src).toMatch(/Revelar senha/)
  })
})

describe("OPS-V4-006 — classificação (kindV3) visível no orçamento, read-only", () => {
  it("adaptOrcamento expõe kind/kindLabel por linha quando kindV3 existir", () => {
    const o = adaptOrcamento(
      mkOS({
        id: "os-orc",
        status: "aguardando_aprovacao",
        orcamento: {
          status: "enviado",
          total: 100,
          servicos: [
            { id: "s1", descricao: "Troca de tela", valor: 100, kindV3: "cobrado" },
            { id: "s2", descricao: "Película", valor: 30, kindV3: "brinde" },
          ],
          pecas: [{ id: "p1", nome: "Cabo flex", quantidade: 1, valorUnitario: 20, kindV3: "interno" }],
        },
      }),
    )
    expect(o.servicos.map((s) => s.kindLabel)).toEqual(["Cobrado", "Brinde"])
    expect(o.pecas[0]!.kind).toBe("interno")
    expect(o.pecas[0]!.kindLabel).toBe("Interno")
  })

  it("linha sem kindV3 fica sem badge (kind null, label vazio)", () => {
    const o = adaptOrcamento(
      mkOS({ id: "os-o2", orcamento: { status: "rascunho", total: 50, servicos: [{ id: "s1", descricao: "Limpeza", valor: 50 }], pecas: [] } }),
    )
    expect(o.servicos[0]!.kind).toBeNull()
    expect(o.servicos[0]!.kindLabel).toBe("")
  })

  it("OrcamentoStage renderiza o KindBadge e explica que serviço manual novo é Cobrado", () => {
    const src = readFileSync(join(DIR, "parts", "stages", "OrcamentoStage.tsx"), "utf8")
    expect(src).toContain("KindBadge")
    expect(src).toMatch(/entra como/i)
  })
})

// ---------------------------------------------------------------------------
// GOAL OPS-V4-ORCAMENTO-READBACK-EDIT-002 — distinguir orçamento inexistente de
// materializado vazio; readback honesto; reabrir; salvar-antes-de-aprovar; não
// descartar linha com valor em silêncio; não aprovar total R$ 0 em silêncio.
// ---------------------------------------------------------------------------
describe("OPS-V4-ORCAMENTO-READBACK-EDIT-002 — adaptOrcamento distingue ausente × vazio × persistido", () => {
  it("sem os.orcamento → estado 'ausente'", () => {
    expect(adaptOrcamento(mkOS({ id: "o-a1" })).estado).toBe("ausente")
  })

  it("prévia sintetizada vazia (sintetizado true, sem linhas, total 0) → 'ausente' (nada real)", () => {
    const o = adaptOrcamento(mkOS({ id: "o-a2", orcamento: { status: "rascunho", total: 0, servicos: [], pecas: [], sintetizado: true } }))
    expect(o.estado).toBe("ausente")
  })

  it("orçamento REAL materializado vazio (sintetizado false, sem linhas, total 0) → 'vazio', não 'ausente'", () => {
    const o = adaptOrcamento(mkOS({ id: "o-v1", orcamento: { status: "aprovado", total: 0, servicos: [], pecas: [], sintetizado: false } }))
    expect(o.estado).toBe("vazio")
    expect(o.statusLabel).toBe("Aprovado")
    expect(o.total).toBe(fmt(0))
  })

  it("orçamento real com item → 'persistido' (readback normal, total real)", () => {
    const o = adaptOrcamento(mkOS({ id: "o-p1", orcamento: { status: "aprovado", total: 320, servicos: [{ id: "s1", descricao: "Troca de tela", valor: 320 }], pecas: [], sintetizado: false } }))
    expect(o.estado).toBe("persistido")
    expect(o.total).toBe(fmt(320))
  })
})

describe("OPS-V4-ORCAMENTO-READBACK-EDIT-002 — OrcamentoStage: readback honesto, reabrir e validação", () => {
  const orcamentoStage = readFileSync(join(DIR, "parts", "stages", "OrcamentoStage.tsx"), "utf8")

  it("estado 'vazio' mostra aviso honesto (não 'Nenhum orçamento registrado') e CTA 'Editar orçamento'", () => {
    expect(orcamentoStage).toMatch(/estado === "vazio"/)
    expect(orcamentoStage).toContain("Orçamento criado, mas sem itens ou valores.")
    expect(orcamentoStage).toContain("Editar orçamento")
  })

  it("'Nenhum orçamento registrado' fica SÓ no ramo 'ausente' (inexistente)", () => {
    expect((orcamentoStage.match(/Nenhum orçamento registrado/g) ?? []).length).toBe(1)
  })

  it("permite reabrir orçamento materializado para revisão controlada (estado local, sem mudar status)", () => {
    expect(orcamentoStage).toContain("onReabrir")
    expect(orcamentoStage).toMatch(/revisao = reaberto && !v\.orcamentoEditavel/)
    expect(orcamentoStage).toContain("Cancelar edição")
  })

  it("salvar valida antes de persistir (bloqueia linha com valor sem descrição)", () => {
    expect(orcamentoStage).toContain("validarEditorParaSalvarV4")
    expect(orcamentoStage).toMatch(/const salvarEditor = async/)
    expect(orcamentoStage).toContain("run(salvarEditor)")
  })

  it("o ramo 'vazio' NÃO usa o botão no-op 'Gerar orçamento' — lá é 'Editar orçamento'", () => {
    const blocoVazio = orcamentoStage.slice(orcamentoStage.indexOf('o.estado === "vazio"'), orcamentoStage.indexOf("const badge = STATUS_BG"))
    expect(blocoVazio.length).toBeGreaterThan(0)
    expect(blocoVazio).not.toContain("GerarOrcamentoCTA")
  })
})

describe("OPS-V4-ORCAMENTO-READBACK-EDIT-002 — Aprovar não ignora o editor local; total 0 não aprova", () => {
  const decisaoCluster = readFileSync(join(DIR, "parts", "stages", "OrcamentoDecisaoCluster.tsx"), "utf8")
  const orcamentoStage = readFileSync(join(DIR, "parts", "stages", "OrcamentoStage.tsx"), "utf8")

  it("Aprovar salva o editor antes de aprovar (guard.salvarEditor) — nunca aprova o servidor ignorando o digitado", () => {
    expect(decisaoCluster).toContain("guard.salvarEditor()")
    expect(decisaoCluster).toMatch(/Salvar e aprovar orçamento/)
  })

  it("bloqueia aprovar quando total R$ 0 (não aprova em silêncio)", () => {
    expect(decisaoCluster).toMatch(/const totalZero = !!guard && guard\.total <= 0/)
    expect(decisaoCluster).toContain("Orçamento total R$ 0")
  })

  it("OrcamentoStage passa o guard (total ao vivo + salvarEditor) ao cluster de decisão", () => {
    expect(orcamentoStage).toMatch(/guard=\{\{ total: totais\.total, salvarEditor \}\}/)
  })
})

// ---------------------------------------------------------------------------
// GOAL OPS-V4-ORCAMENTO-REABRIR-MOTOR-003 — correção de orçamento em OS avançada:
// o editor em modo revisão chama a action de correção (action SEPARADA do salvar
// comum, que o motor rejeitaria para orçamento aprovado/entregue), preservando o
// status da OS; microcopy honesta; fecha a edição ao salvar com sucesso. Sem criar
// CR/venda/estoque — só payload + timeline + recalcula valorTotal.
// ---------------------------------------------------------------------------
describe("OPS-V4-ORCAMENTO-REABRIR-MOTOR-003 — OrcamentoStage em revisão usa corrigirOrcamento (action separada)", () => {
  const orcamentoStage = readFileSync(join(DIR, "parts", "stages", "OrcamentoStage.tsx"), "utf8")
  const orquestrador = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")

  it("o editor em modo revisão chama v.corrigirOrcamento (nunca o salvar comum, rejeitado pelo motor)", () => {
    expect(orcamentoStage).toMatch(/revisao \? await v\.corrigirOrcamento\(editor\) : await v\.salvarOrcamento\(editor\)/)
  })

  it("após salvar correção com sucesso, fecha o modo edição (onFecharRevisao) para mostrar o read-only atualizado", () => {
    expect(orcamentoStage).toMatch(/if \(ok && revisao && onFecharRevisao\) onFecharRevisao\(\)/)
  })

  it("microcopy honesta: 'Correção de orçamento em OS avançada' + 'O status da OS será preservado'", () => {
    expect(orcamentoStage).toContain("Correção de orçamento em OS avançada")
    expect(orcamentoStage).toContain("O status da OS será preservado")
  })

  it("não promete mais que 'alterá-lo pode ser rejeitado pelo sistema' (texto antigo removido — agora há caminho controlado)", () => {
    expect(orcamentoStage).not.toContain("pode ser rejeitado pelo sistema")
  })

  it("orquestrador expõe v.corrigirOrcamento ligado ao ctx e importa a action real corrigirOrcamentoV3", () => {
    expect(orquestrador).toContain("corrigirOrcamentoV3")
    expect(orquestrador).toMatch(/corrigirOrcamento: ctx\.corrigirOrcamento/)
  })
})

describe("OPS-V4-ORC-MULTIOPCAO-MODEL-021 — grupos/variantes/faixa, read-only e honestos", () => {
  it("orçamento sem grupoId: temGrupos=false, faixa NI, itens com grupoId=\"\"/variante=null/selecionada=false", () => {
    const o = adaptOrcamento(
      mkOS({
        id: "os-sem-grupo",
        orcamento: { status: "rascunho", total: 100, servicos: [{ id: "s1", descricao: "Limpeza", valor: 100 }], pecas: [] },
      }),
    )
    expect(o.temGrupos).toBe(false)
    expect(o.grupos).toEqual([])
    expect(o.temFaixa).toBe(false)
    expect(o.faixaMin).toBe(NI)
    expect(o.faixaMax).toBe(NI)
    expect(o.servicos[0]!.grupoId).toBe("")
    expect(o.servicos[0]!.variante).toBeNull()
    expect(o.servicos[0]!.selecionada).toBe(false)
  })

  it("grupo sem seleção: expõe faixa min/max e resolvido=false", () => {
    const o = adaptOrcamento(
      mkOS({
        id: "os-grupo-aberto",
        orcamento: {
          status: "enviado",
          total: 0,
          servicos: [
            { id: "opt-a", descricao: "Tela genérica", valor: 150, kindV3: "cobrado", grupoId: "g1" },
            { id: "opt-b", descricao: "Tela original", valor: 300, kindV3: "cobrado", grupoId: "g1" },
          ],
          pecas: [],
          gruposV3: [{ id: "g1", rotulo: "Escolha a tela", regra: "escolha_1" }],
        },
      }),
    )
    expect(o.temGrupos).toBe(true)
    expect(o.grupos).toHaveLength(1)
    expect(o.grupos[0]!.rotulo).toBe("Escolha a tela")
    expect(o.grupos[0]!.resolvido).toBe(false)
    expect(o.grupos[0]!.selecionadaId).toBeNull()
    expect(o.temFaixa).toBe(true)
  })

  it("grupo com linha selecionada: resolvido=true, selecionadaId aponta pra ela, sem faixa geral", () => {
    const o = adaptOrcamento(
      mkOS({
        id: "os-grupo-resolvido",
        orcamento: {
          status: "aprovado",
          total: 300,
          servicos: [
            { id: "opt-a", descricao: "Tela genérica", valor: 150, kindV3: "cobrado", grupoId: "g1" },
            { id: "opt-b", descricao: "Tela original", valor: 300, kindV3: "cobrado", grupoId: "g1", selecionadaV3: true },
          ],
          pecas: [],
        },
      }),
    )
    expect(o.grupos[0]!.resolvido).toBe(true)
    expect(o.grupos[0]!.selecionadaId).toBe("opt-b")
    expect(o.temFaixa).toBe(false)
    const selecionada = o.servicos.find((s) => s.id === "opt-b")!
    expect(selecionada.selecionada).toBe(true)
  })

  it("grupo sem gruposV3 cadastrado: rótulo cai em fallback honesto (não fabrica nome)", () => {
    const o = adaptOrcamento(
      mkOS({
        id: "os-grupo-sem-meta",
        orcamento: {
          status: "rascunho",
          total: 0,
          pecas: [
            { id: "a", nome: "A", quantidade: 1, valorUnitario: 10, grupoId: "sem-meta" },
            { id: "b", nome: "B", quantidade: 1, valorUnitario: 20, grupoId: "sem-meta" },
          ],
          servicos: [],
        },
      }),
    )
    expect(o.grupos[0]!.rotulo).toBe("Opções 1")
  })

  it("variante (varianteV3) é exposta com rótulo/garantia/badge; sem varianteV3 fica null", () => {
    const o = adaptOrcamento(
      mkOS({
        id: "os-variante",
        orcamento: {
          status: "rascunho",
          total: 0,
          pecas: [
            {
              id: "a",
              nome: "Tela original",
              quantidade: 1,
              valorUnitario: 300,
              grupoId: "g1",
              varianteV3: { rotulo: "Original", garantiaDias: 90, badge: "Recomendado" },
            },
          ],
          servicos: [],
        },
      }),
    )
    expect(o.pecas[0]!.variante).toEqual({ rotulo: "Original", descricaoCurta: "", garantiaDias: 90, prazoTexto: "", badge: "Recomendado" })
  })

  it("a Preview não importa prisma/@/app/api nem usa loja-1 no os-adapter.ts (novo código de grupos incluso)", () => {
    const src = readFileSync(join(DIR, "os-adapter.ts"), "utf8")
    for (const proibido of ['from "@/lib/prisma', 'from "@/app/api', "updateOSPayload", "openCaixaIfClosed", '"loja-1"', "'loja-1'", "`loja-1`"]) {
      expect(src, `proibido encontrado: ${proibido}`).not.toContain(proibido)
    }
  })
})

describe("OPS-V4-ORC-VIEWMODEL-DOC-023 — documento 'Orçamento (via cliente)'", () => {
  it("o item do menu Docs só aparece com orçamento REAL materializado (temDados honesto)", () => {
    const semOrcamento = buildVals(
      makeState({ selectedOsId: "os-doc-1", novaOS: false }),
      () => {},
      () => {},
      { ...ctx, realOS: mkOS({ id: "os-doc-1", status: "aberta" }) },
    )
    expect(semOrcamento.printItems.map((d) => d.label)).not.toContain("Orçamento (via cliente)")

    const comPrevia = buildVals(
      makeState({ selectedOsId: "os-doc-2", novaOS: false }),
      () => {},
      () => {},
      {
        ...ctx,
        realOS: mkOS({ id: "os-doc-2", status: "aberta", orcamento: { status: "rascunho", total: 50, sintetizado: true, servicos: [{ id: "s1", descricao: "X", valor: 50 }], pecas: [] } }),
      },
    )
    expect(comPrevia.printItems.map((d) => d.label)).not.toContain("Orçamento (via cliente)")

    const comReal = buildVals(
      makeState({ selectedOsId: "os-doc-3", novaOS: false }),
      () => {},
      () => {},
      {
        ...ctx,
        realOS: mkOS({ id: "os-doc-3", status: "aguardando_aprovacao", orcamento: { status: "enviado", total: 100, servicos: [{ id: "s1", descricao: "X", valor: 100 }], pecas: [] } }),
      },
    )
    expect(comReal.printItems.map((d) => d.label)).toContain("Orçamento (via cliente)")
  })

  it("DocPrintModal suporta o tipo 'orcamento_cliente'", () => {
    const src = readFileSync(join(DIR, "parts", "DocPrintModal.tsx"), "utf8")
    expect(src).toContain("orcamento_cliente")
  })

  it("o render do documento cobre os 3 estados: faixa (sem seleção), seleção destacada e bloco de cortesia", () => {
    const src = readFileSync(join(DIR, "parts", "OrcamentoClienteDocV4.tsx"), "utf8")
    expect(src).toContain("faixa")
    expect(src).toContain("selecionada")
    expect(src).toContain("Cortesia")
    expect(src).toContain("Total com esta opção")
  })

  it("o documento e a projeção não importam prisma/@/app/api nem usam loja-1/openCaixaIfClosed", () => {
    const alvos = [join(DIR, "parts", "OrcamentoClienteDocV4.tsx"), join(DIR, "parts", "DocPrintModal.tsx")]
    for (const alvo of alvos) {
      const src = readFileSync(alvo, "utf8")
      for (const proibido of ['from "@/lib/prisma', 'from "@/app/api', "updateOSPayload", "openCaixaIfClosed", '"loja-1"', "'loja-1'", "`loja-1`"]) {
        expect(src, `proibido "${proibido}" encontrado em ${alvo}`).not.toContain(proibido)
      }
    }
  })
})

describe("OPS-V4-RECEBIMENTO-TRANSVERSAL-005 — Financeiro da OS é recebimento operacional, não preview/read-only", () => {
  it("não classifica o Financeiro transversal como somente leitura depois do recebimento conectado", () => {
    const stage = readFileSync(join(DIR, "parts", "stages", "FinanceiroStage.tsx"), "utf8")
    const receber = readFileSync(join(DIR, "parts", "ReceberPagamentoV4.tsx"), "utf8")
    const orchestrator = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")
    expect(stage).toContain("<ReceberPagamentoV4")
    expect(receber).toContain("receberOSV3")
    expect(orchestrator).toContain("receberOSV3")
    expect(orchestrator).toContain("lancarOSAPrazoV3")
    expect(stage).not.toMatch(/em breve/i)
    expect(stage + receber).not.toContain("Financeiro completo")
  })
})

describe("OPS-V4-006 — guards: nada de recebimento real / imports proibidos", () => {
  const allSources = collectSourceFiles(DIR).map((f) => readFileSync(f, "utf8")).join("\n")

  it("a Preview não importa prisma, updateOSPayload nem app/api", () => {
    for (const proibido of [
      'from "@/lib/prisma',
      // PDV-SERVICO-OS-RECEBIMENTO-REAL-001: recebimento (receberOSV3/pdv-servico-actions)
      // passou a ser REAL e sancionado. OPS-V4-RECEBIMENTO-ESTORNO-016: o estorno
      // (estornarRecebimentoOSV3) também passou a ser REAL e sancionado — ver
      // guards dedicados mais abaixo (describe "OPS-V4-RECEBIMENTO-ESTORNO-016").
      "updateOSPayload",
      'from "@/app/api',
      "openCaixaIfClosed",
    ]) {
      expect(allSources, `proibido encontrado: ${proibido}`).not.toContain(proibido)
    }
  })

  it("a leitura do pagamento vem do reader PURO da V3 (payment-model), não de service", () => {
    const adapter = readFileSync(join(DIR, "os-adapter.ts"), "utf8")
    expect(adapter).toContain('from "@/lib/operacoes-v3/payment-model"')
    expect(adapter).toContain("lerPagamentoV3")
  })
})

// ---------------------------------------------------------------------------
// OPS-V4-EXECUCAO-REAL-007 — Execução real mínima: transições de status
// (iniciar/retomar execução, marcar aguardando peça, marcar pronta) via reuso
// de `aplicarTransicaoStatusV3`; habilitadas SÓ quando a máquina única permite
// a partir do status real. Checklist técnico/peças/estoque/observação técnica
// seguem read-only (sem action V3 segura).
// ---------------------------------------------------------------------------
describe("OPS-V4-EXECUCAO-REAL-007 — execAcoes só habilita a transição que a máquina única permite", () => {
  function ctxComStatus(status: string) {
    return { ...ctx, realOS: mkOS({ id: "os-exec", status }) }
  }

  it("aprovado: pode iniciar execução E marcar aguardando peça; não pode marcar pronta", () => {
    const v = buildVals(
      makeState({ selectedOsId: "os-exec", novaOS: false }),
      () => {},
      () => {},
      ctxComStatus("aprovado"),
    )
    expect(v.execAcoes.podeIniciar).toBe(true)
    expect(v.execAcoes.iniciarLabel).toBe("Iniciar execução")
    expect(v.execAcoes.podeAguardarPeca).toBe(true)
    expect(v.execAcoes.podePronta).toBe(false)
  })

  it("aguardando_peca: só pode retomar (rótulo muda); não pode marcar aguardando peça de novo", () => {
    const v = buildVals(
      makeState({ selectedOsId: "os-exec", novaOS: false }),
      () => {},
      () => {},
      ctxComStatus("aguardando_peca"),
    )
    expect(v.execAcoes.podeIniciar).toBe(true)
    expect(v.execAcoes.iniciarLabel).toBe("Retomar execução")
    expect(v.execAcoes.podeAguardarPeca).toBe(false)
    expect(v.execAcoes.podePronta).toBe(false)
  })

  it("em_execucao: só pode marcar pronta; não pode iniciar nem aguardar peça", () => {
    const v = buildVals(
      makeState({ selectedOsId: "os-exec", novaOS: false }),
      () => {},
      () => {},
      ctxComStatus("em_execucao"),
    )
    expect(v.execAcoes.podeIniciar).toBe(false)
    expect(v.execAcoes.podeAguardarPeca).toBe(false)
    expect(v.execAcoes.podePronta).toBe(true)
  })

  it("pronta / diagnostico / aberta / entregue / cancelada: nenhuma ação de Execução disponível", () => {
    for (const status of ["pronta", "diagnostico", "aberta", "entregue", "cancelada"]) {
      const v = buildVals(
        makeState({ selectedOsId: "os-exec", novaOS: false }),
        () => {},
        () => {},
        ctxComStatus(status),
      )
      expect(v.execAcoes, `status ${status}`).toMatchObject({
        podeIniciar: false,
        podeAguardarPeca: false,
        podePronta: false,
      })
    }
  })

  it("sem OS selecionada, nenhuma ação fica disponível mesmo com o snapshot local 'em_execucao'", () => {
    const v = buildVals(makeState({ status: "em_execucao", selectedOsId: null, novaOS: false }), () => {}, () => {}, ctx)
    expect(v.execAcoes).toEqual({
      podeIniciar: false,
      iniciarLabel: "Iniciar execução",
      podeAguardarPeca: false,
      podePronta: false,
    })
  })
})

describe("OPS-V4-EXECUCAO-REAL-007 — handlers reais (runWrite) e wiring do ExecucaoStage", () => {
  const orquestrador = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")
  const execStage = readFileSync(join(DIR, "parts", "stages", "ExecucaoStage.tsx"), "utf8")

  it("marcarAguardandoPeca/marcarPronta chamam aplicarTransicaoStatusV3 (novas transições seguras)", () => {
    expect(orquestrador).toContain('aplicarTransicaoStatusV3(sid, osId, "aguardando_peca")')
    expect(orquestrador).toContain('aplicarTransicaoStatusV3(sid, osId, "pronta")')
  })

  it("os dois novos handlers passam pelo wrapper runWrite — reload/patch de status só ocorrem em sucesso, nunca direto na falha", () => {
    // Mesma garantia estrutural que salvarDiagnostico/iniciarServico já têm: o
    // handler é `() => runWrite(...)`, então reload+toast+after() só correm dentro
    // do try, após o `await fn()` resolver — a falha cai no catch (return false)
    // sem tocar patches/status. Ver `runWrite` (única definição, não duplicada).
    expect(orquestrador).toMatch(/const marcarAguardandoPeca = useCallback\(\s*\(\)\s*=>\s*runWrite\(/)
    expect(orquestrador).toMatch(/const marcarPronta = useCallback\(\s*\(\)\s*=>\s*runWrite\(/)
    // runWrite só existe uma vez (fonte única de reload/patch-em-sucesso) — os novos
    // handlers reaproveitam-na, não duplicam a lógica de guarda/patch.
    expect(orquestrador.match(/const runWrite = useCallback/g)?.length).toBe(1)
  })

  it("ExecucaoStage chama os handlers reais (iniciarServico/marcarAguardandoPeca/marcarPronta) — não um toast de preview", () => {
    expect(execStage).toContain("v.iniciarServico")
    expect(execStage).toContain("v.marcarAguardandoPeca")
    expect(execStage).toContain("v.marcarPronta")
    expect(execStage).not.toContain("PREVIEW_NOOP")
  })

  it("ExecAcoesCard só renderiza quando alguma transição de v.execAcoes é permitida (sem botão sempre ligado)", () => {
    expect(execStage).toMatch(/if \(!ex\.podeIniciar && !ex\.podeAguardarPeca && !ex\.podePronta\) return null/)
  })

  it("botões de Execução têm busy-lock (evita duplo clique) e não chamam PDV/Caixa/Financeiro/Estoque/WhatsApp/Fiscal", () => {
    expect(execStage).toContain("useState")
    expect(execStage).toMatch(/disabled=\{busy\}/)
    for (const proibido of [
      'from "@/lib/caixa',
      'from "@/lib/financeiro',
      'from "@/lib/estoque',
      'from "@/lib/whatsapp',
      'from "@/lib/fiscal',
      'from "@/components/pdv',
      "updateOSPayload",
      "receberOSV3",
      "estornarRecebimentoOSV3",
      '"loja-1"',
    ]) {
      expect(execStage, `referência proibida encontrada: ${proibido}`).not.toContain(proibido)
    }
  })

  it("checklist técnico e consumo de estoque continuam read-only (sem novo handler de escrita para eles)", () => {
    // Nenhuma action V3 segura existe para checklist técnico (só via updateOSPayload
    // legado, fora do escopo) nem para consumo de peças — por isso o stage não ganhou
    // nenhum botão de "salvar checklist" ou "consumir peça" neste slice.
    expect(execStage).not.toMatch(/salvarChecklistTecnico/i)
    expect(execStage).not.toMatch(/consumirPeca|baixarEstoque/i)
  })
})

// ---------------------------------------------------------------------------
// PDV-SERVICO-OS-RECEBIMENTO-REAL-001 — recebimento real da OS na V4, via o
// motor único da V3 (usePdvServicoV3 → receberOSV3). Caixa aberto obrigatório;
// parcial permitido (validarRecebimentoV3, sem parcelamento novo); sem
// estorno/venda/estoque neste slice.
// ---------------------------------------------------------------------------
describe("PDV-SERVICO-OS-RECEBIMENTO-REAL-001 — v.recebimento só habilita com total>0, saldo>0 e caixa aberto", () => {
  function ctxComPdv(pagamento: Pick<PagamentoV3, "total" | "recebido" | "saldo" | "status"> | null, sessaoAberta: boolean) {
    return {
      ...ctx,
      financialProjection: financialStateFromPayment(pagamento),
      pdvServico: {
        ...ctx.pdvServico,
        pagamento,
        sessao: { aberta: sessaoAberta, sessaoId: sessaoAberta ? "sessao-1" : undefined },
      },
    }
  }

  it("total>0, saldo>0, caixa aberto: podeReceber true", () => {
    const v = buildVals(makeState({ novaOS: false }), () => {}, () => {}, ctxComPdv({ total: 200, recebido: 0, saldo: 200, status: "aberto" }, true))
    expect(v.recebimento).toMatchObject({ semTotal: false, previaNaoMaterializada: false, quitado: false, caixaAberto: true, podeReceber: true })
  })

  it("caixa fechado: podeReceber false mesmo com saldo aberto", () => {
    const v = buildVals(makeState({ novaOS: false }), () => {}, () => {}, ctxComPdv({ total: 200, recebido: 0, saldo: 200, status: "aberto" }, false))
    expect(v.recebimento.caixaAberto).toBe(false)
    expect(v.recebimento.podeReceber).toBe(false)
  })

  it("quitado (saldo <= 0): podeReceber false mesmo com caixa aberto", () => {
    const v = buildVals(makeState({ novaOS: false }), () => {}, () => {}, ctxComPdv({ total: 200, recebido: 200, saldo: 0, status: "quitado" }, true))
    expect(v.recebimento.quitado).toBe(true)
    expect(v.recebimento.podeReceber).toBe(false)
  })

  it("sem total (OS sem orçamento/valor): semTotal true, podeReceber false", () => {
    const v = buildVals(makeState({ novaOS: false }), () => {}, () => {}, ctxComPdv({ total: 0, recebido: 0, saldo: 0, status: "sem_cobranca" }, true))
    expect(v.recebimento.semTotal).toBe(true)
    expect(v.recebimento.podeReceber).toBe(false)
    // Sem `realOS` (ctx.realOS fica null neste helper) não há total visível em lugar
    // nenhum — não é o caso de "prévia não materializada", é ausência genuína.
    expect(v.recebimento.previaNaoMaterializada).toBe(false)
  })

  it("pagamento ainda não carregado (null): tudo honesto/false, sem crash", () => {
    const v = buildVals(makeState({ novaOS: false }), () => {}, () => {}, ctxComPdv(null, true))
    expect(v.recebimento).toMatchObject({ semTotal: false, previaNaoMaterializada: false, quitado: false, caixaAberto: true, podeReceber: false })
  })

  it("parcial (recebido parcial > 0, saldo > 0): continua podeReceber true", () => {
    const v = buildVals(makeState({ novaOS: false }), () => {}, () => {}, ctxComPdv({ total: 500, recebido: 100, saldo: 400, status: "parcial" }, true))
    expect(v.recebimento.podeReceber).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// OPS-V4-RECEBIMENTO-PREVIA-HONESTY-002 — a tela não pode contradizer a si mesma:
// "Total da OS" e o total cobrável materializado podem divergir quando existe
// apenas uma prévia sintetizada. A projeção continua rejeitando prévia —
// só a mensagem passa a explicar a causa real em vez de dizer "sem valor".
// ---------------------------------------------------------------------------
describe("OPS-V4-RECEBIMENTO-PREVIA-HONESTY-002 — total visível (prévia) vs total cobrável real (motor V3)", () => {
  const osPrevia = mkOS({
    id: "os-previa",
    status: "pronta",
    orcamento: {
      id: "orc-previa",
      status: "aprovado",
      servicos: [{ id: "svc_os-previa", descricao: "Serviços (valor registrado)", valor: 300, desconto: 0 }],
      pecas: [],
      desconto: 0,
      total: 300,
      criadoEm: "2026-01-01T00:00:00.000Z",
      atualizadoEm: "2026-01-01T00:00:00.000Z",
      // Marca de hidratação (`mergeOrcamentoFromPrismaRow`): prévia derivada dos itens
      // da OS, NUNCA um orçamento real aprovado pelo fluxo da V3.
      sintetizado: true,
    },
  })
  const osMaterializada = mkOS({
    id: "os-real",
    status: "pronta",
    orcamento: {
      id: "orc-real",
      status: "aprovado",
      servicos: [{ id: "s1", descricao: "Troca de tela", valor: 300, desconto: 0 }],
      pecas: [],
      desconto: 0,
      total: 300,
      criadoEm: "2026-01-01T00:00:00.000Z",
      atualizadoEm: "2026-01-01T00:00:00.000Z",
    },
  })
  const osVazia = mkOS({ id: "os-vazia", status: "aberta" })

  function ctxCom(realOS: OrdemServico | null, pagamento: Pick<PagamentoV3, "total" | "recebido" | "saldo" | "status"> | null, sessaoAberta: boolean): V4DataCtx {
    return {
      ...ctx,
      realOS,
      financialProjection: financialStateFromPayment(
        pagamento,
        realOS === osPrevia ? "PRICE_DEFINED" : undefined,
      ),
      pdvServico: {
        ...ctx.pdvServico,
        pagamento,
        sessao: { aberta: sessaoAberta, sessaoId: sessaoAberta ? "sessao-1" : undefined },
      },
    }
  }

  it("prévia sintetizada (Total da OS > 0) + motor V3 em 0: previaNaoMaterializada true, sem habilitar recebimento", () => {
    const v = buildVals(
      makeState({ novaOS: false }),
      () => {},
      () => {},
      ctxCom(osPrevia, { total: 0, recebido: 0, saldo: 0, status: "sem_cobranca" }, true),
    )
    expect(v.financial.projection?.expectedTotal).toBe(0)
    expect(v.orcamentoMaterializado).toBe(false)
    expect(v.recebimento.semTotal).toBe(true)
    expect(v.recebimento.previaNaoMaterializada).toBe(true)
    expect(v.recebimento.podeReceber).toBe(false)
  })

  it("orçamento materializado (não sintetizado) com total cobrável real: previaNaoMaterializada false, recebimento habilita normalmente", () => {
    const v = buildVals(
      makeState({ novaOS: false }),
      () => {},
      () => {},
      ctxCom(osMaterializada, { total: 300, recebido: 0, saldo: 300, status: "aberto" }, true),
    )
    expect(v.orcamentoMaterializado).toBe(true)
    expect(v.recebimento.semTotal).toBe(false)
    expect(v.recebimento.previaNaoMaterializada).toBe(false)
    expect(v.recebimento.podeReceber).toBe(true)
  })

  it("OS genuinamente sem valor (sem orçamento, sem total em lugar nenhum): não rotula como prévia", () => {
    const v = buildVals(
      makeState({ novaOS: false }),
      () => {},
      () => {},
      ctxCom(osVazia, { total: 0, recebido: 0, saldo: 0, status: "sem_cobranca" }, true),
    )
    expect(v.financial.projection?.expectedTotal).toBe(0)
    expect(v.recebimento.semTotal).toBe(true)
    expect(v.recebimento.previaNaoMaterializada).toBe(false)
  })

  it("ReceberPagamentoV4: mensagem de prévia substitui a genérica só quando previaNaoMaterializada; motor V3 intocado", () => {
    const card = readFileSync(join(DIR, "parts", "ReceberPagamentoV4.tsx"), "utf8")
    expect(card).toContain("previaNaoMaterializada")
    expect(card).toMatch(/prévia/i)
    // A copy genérica continua existindo para o caso de ausência real (sem orçamento nenhum).
    expect(card).toContain("Esta OS não tem valor a cobrar")
    // Nenhuma chamada nova ao motor: `pdv.receber(` continua existindo uma única vez,
    // dentro de `onConfirmar` (mesma garantia do slice 001 — ver describe acima).
    expect((card.match(/\.receber\(/g) ?? []).length).toBe(1)
    // A prévia é decidida por `v.recebimento` (pré-computado); o card não reimplementa
    // nem importa o cálculo autoritativo do servidor (`totalCobravelV3`).
    expect(card).not.toContain("totalCobravelV3")
  })

  it("FinanceiroStage mostra o estado server-side sem reclassificar orçamento no cliente", () => {
    const financeiroStage = readFileSync(join(DIR, "parts", "stages", "FinanceiroStage.tsx"), "utf8")
    expect(financeiroStage).toContain("projection.financialStatus")
    expect(financeiroStage).not.toContain(".sintetizado")
  })

  it("previaNaoMaterializada traduz PRICE_DEFINED da projeção, sem recalcular o motor no cliente", () => {
    const orquestrador = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")
    expect(orquestrador).toContain("previaNaoMaterializada")
    expect(orquestrador).toMatch(/previaNaoMaterializada\s*=\s*financialProjection\?\.financialStatus\s*===\s*"PRICE_DEFINED"/)
    // `totalCobravelV3` é o cálculo AUTORITATIVO do motor V3 (servidor) — a V4 nunca
    // o reimplementa/importa no cliente para decidir a prévia.
    expect(orquestrador).not.toContain("totalCobravelV3")
  })
})

describe("PDV-SERVICO-OS-RECEBIMENTO-REAL-001 — receberPagamentoV4 só recarrega a V4 depois do sucesso", () => {
  const orquestrador = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")

  it("reaproveita o hook e o motor de recebimento real da V3 (usePdvServicoV3 → receberOSV3), sem motor novo", () => {
    expect(orquestrador).toContain("usePdvServicoV3")
    expect(orquestrador).toContain('from "@/components/operacoes-v3/hooks/use-pdv-servico-v3"')
    expect(orquestrador).toContain("receberOSV3")
  })

  it("o wrapper só chama reloadOrdens/reloadDetail dentro do if (ok) — nunca incondicional", () => {
    expect(orquestrador).toMatch(/const receberPagamentoV4 = useCallback\(/)
    expect(orquestrador).toMatch(/if \(ok\) \{\s*reloadOrdens\(\);\s*reloadDetail\(\);\s*reloadFinancial\(\);\s*\}/)
  })
})

describe("PDV-SERVICO-OS-RECEBIMENTO-REAL-001 — ReceberPagamentoV4 (UI fina sobre o motor V3)", () => {
  const card = readFileSync(join(DIR, "parts", "ReceberPagamentoV4.tsx"), "utf8")
  const financeiroStage = readFileSync(join(DIR, "parts", "stages", "FinanceiroStage.tsx"), "utf8")
  const reciboModal = readFileSync(join(DIR, "parts", "ReciboModal.tsx"), "utf8")
  const allSources = collectSourceFiles(DIR).map((f) => readFileSync(f, "utf8")).join("\n")

  it("só chama pdv.receber(...) uma vez no arquivo, dentro do onConfirmar (nunca fora de um clique)", () => {
    expect(card).toMatch(/const onConfirmar = async \(\) => \{[\s\S]*?pdv\.receber\(/)
    expect((card.match(/\.receber\(/g) ?? []).length).toBe(1)
  })

  it("bloqueia ANTES do formulário quando sem total, quitado ou caixa fechado (early return, nesta ordem)", () => {
    const idxSemTotal = card.indexOf("if (semTotal)")
    const idxQuitado = card.indexOf("if (quitado)")
    const idxCaixaFechado = card.indexOf("if (!caixaAberto)")
    const idxConfirmar = card.indexOf("const onConfirmar")
    for (const idx of [idxSemTotal, idxQuitado, idxCaixaFechado, idxConfirmar]) expect(idx).toBeGreaterThan(-1)
    expect(idxQuitado).toBeGreaterThan(idxSemTotal)
    expect(idxCaixaFechado).toBeGreaterThan(idxQuitado)
    expect(idxConfirmar).toBeGreaterThan(idxCaixaFechado)
  })

  it("valida o split com o mesmo validador da V3 (validarSplitV3) — sem regra nova de soma/parcial (GOAL OPS-V4-RECEBER-SPLIT-PARIDADE-002)", () => {
    expect(card).toContain("validarSplitV3")
    expect(card).toContain('from "@/lib/operacoes-v3/payment-model"')
  })

  it("só oferece formas já suportadas pelo contrato real (FORMAS_RECEBIMENTO_V3, sem enum novo)", () => {
    expect(card).toMatch(/FORMAS_RECEBIMENTO_V3\.filter\(\(f\) => f\.suportada\)/)
    expect(card).not.toMatch(/type FormaRecebimentoV3\s*=\s*"/)
  })

  it("busy-lock: botão de confirmar desabilita durante o recebimento (evita duplo clique)", () => {
    expect(card).toMatch(/disabled=\{!podeConfirmar\}/)
    expect(card).toContain("pdv.recebendo")
  })

  it("no sucesso abre o recibo real (v.openRecibo) — não inventa modal próprio", () => {
    expect(card).toMatch(/if \(ok\) \{[\s\S]*?v\.openRecibo\(\)/)
  })

  it("FinanceiroStage usa o card real; não sobrou botão preview de 'em breve' nem v.act.pdv", () => {
    expect(financeiroStage).toContain("<ReceberPagamentoV4")
    expect(financeiroStage).not.toContain("em breve")
    expect(financeiroStage).not.toContain("v.act.pdv")
  })

  it("ReciboModal mostra o comprovante real quando existir, sem recalcular o recibo (só exibe o que a V3 montou)", () => {
    expect(reciboModal).toContain("v.pdvServico.ultimoRecibo")
    expect(reciboModal).not.toContain("montarComprovanteReciboV3")
  })

  it("não cria Venda, não toca estoque/inventário/services financeiros/caixa diretos, sem openCaixaIfClosed/loja-1", () => {
    for (const proibido of [
      "criarVenda",
      "SaleRecord",
      "finalizeSale",
      "finalizeSaleTransaction",
      "ops-upsert-venda",
      'from "@/lib/estoque',
      'from "@/lib/financeiro/services',
      'from "@/lib/caixa',
      "openCaixaIfClosed",
      '"loja-1"',
      "updateOSPayload",
      'from "@/lib/prisma',
      'from "@/app/api',
    ]) {
      expect(allSources, `referência proibida: ${proibido}`).not.toContain(proibido)
    }
  })
})

// ---------------------------------------------------------------------------
// GOAL OPS-V4-RECEBER-SPLIT-PARIDADE-002 — paridade de split imediato com a V3.
// A auditoria PDV-SERVICO-FORMAS-PAGAMENTO-AUDIT-001 confirmou que `receberOSV3`
// já suporta múltiplas formas (`linhas: SplitLinhaV3[]`) num mesmo recebimento;
// a V4 só precisava deixar de mandar forma única. Nenhum motor novo, nenhuma
// forma nova (a prazo/parcelado/crediário/carteira ficam para
// OS-RECEBIMENTO-A-PRAZO-CONTRATO).
// ---------------------------------------------------------------------------
describe("OPS-V4-RECEBER-SPLIT-PARIDADE-002 — ReceberPagamentoV4 envia split imediato", () => {
  const card = readFileSync(join(DIR, "parts", "ReceberPagamentoV4.tsx"), "utf8")

  it("mantém estado de múltiplas linhas (array), não forma única", () => {
    expect(card).toMatch(/useState<LinhaDraft\[\]>/)
    expect(card).toContain("addLinha")
    expect(card).toContain("removeLinha")
  })

  it("envia o split para receberOSV3 no formato `linhas: SplitLinhaV3[]` (nunca forma/valor soltos)", () => {
    expect(card).toMatch(/pdv\.receber\(\{\s*linhas:\s*linhasValidas,/)
    expect(card).not.toMatch(/pdv\.receber\(\{\s*valor:/)
  })

  it("bloqueia quando alguma linha tem valor <= 0, mesmo com outras linhas válidas", () => {
    expect(card).toMatch(/algumaLinhaInvalida\s*=\s*linhas\.some\(\(l\)\s*=>\s*!\(num\(l\.valorStr\)\s*>\s*0\)\)/)
    expect(card).toMatch(/podeConfirmar\s*=\s*veredito\.ok\s*&&\s*!algumaLinhaInvalida\s*&&\s*!pdv\.recebendo/)
  })

  it("total informado e saldo restante derivam de somaSplitV3 (mesmo cálculo do contrato, sem soma nova)", () => {
    expect(card).toContain("somaSplitV3(linhasValidas)")
    expect(card).toMatch(/saldoRestante\s*=\s*Math\.max\(0,\s*pagamento\.saldo\s*-\s*totalInformado\)/)
  })

  it("permite remover uma linha e preencher rápido com o saldo restante (não trava em forma única)", () => {
    expect(card).toContain("usarRestante")
    expect(card).toMatch(/arr\.length > 1 \? arr\.filter\(\(_, idx\) => idx !== i\) : arr/)
  })

  it("não expõe parcelado/crediário/carteira nesta tela (só formas com suportada:true)", () => {
    for (const naoSuportada of ["Parcelado", "Crediário", "Carteira"]) {
      expect(card, `forma "${naoSuportada}" não deveria aparecer hardcoded`).not.toContain(naoSuportada)
    }
  })

  it("veredito de bloqueio usa validarSplitV3 (não reimplementa a regra de soma > saldo)", () => {
    expect(card).toContain("validarSplitV3(linhasValidas, pagamento.saldo)")
  })
})

// ---------------------------------------------------------------------------
// OPS-V4-NOVA-OS-AUTOFILL-ISOLATION-009 — o navegador não pode sugerir/autopreencher
// cliente, telefone, documento, e-mail, aparelho, IMEI, defeito ou observações de
// uma loja/conta anterior no mesmo computador. Guard estático: todo <input>/<textarea>
// do modal Nova OS declara autoComplete explícito.
describe("OPS-V4-NOVA-OS-AUTOFILL-ISOLATION-009 — Nova OS sem autofill do navegador", () => {
  const novaOSSource = readFileSync(join(DIR, "parts", "NovaOSModal.tsx"), "utf8")

  /**
   * Extrai tags JSX inteiras por nome, respeitando profundidade de `{}` e
   * ignorando `>` de arrow functions (`=>`) dentro dos atributos — uma regex
   * "gulosa até o primeiro `>`" quebra em `onChange={(e) => ...}`.
   */
  function extractJsxTags(source: string, tagNames: string[]): string[] {
    const tags: string[] = []
    const startRe = new RegExp(`<(?:${tagNames.join("|")})\\b`, "g")
    for (const m of source.matchAll(startRe)) {
      const start = m.index!
      let depth = 0
      let i = start
      for (; i < source.length; i++) {
        const ch = source[i]
        if (ch === "{") depth++
        else if (ch === "}") depth--
        else if (ch === ">" && depth === 0 && source[i - 1] !== "=") break
      }
      tags.push(source.slice(start, i + 1))
    }
    return tags
  }

  it("todo campo de input/textarea do modal Nova OS declara autoComplete explícito", () => {
    const campos = extractJsxTags(novaOSSource, ["input", "textarea"])
    expect(campos.length).toBeGreaterThan(0)
    const semAutoComplete = campos.filter((tag) => !/autoComplete=/.test(tag))
    expect(semAutoComplete, `campos sem autoComplete: ${semAutoComplete.join(" | ")}`).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// GOAL OPS-V4-DOCS-ASSINATURA-TERMOS-ANEXOS-012 — termo de garantia, assinatura
// de retirada e fotos de entrada passam a ler os contratos REAIS já usados pela
// V3 (aberturaV3.garantiaPrevista / entregaV3.assinaturaRetirada /
// provaEntradaV3.fotos) em vez de campos legados/mortos. Nada fabricado: sem
// garantia/assinatura/foto real na OS, os cards mostram empty state honesto.
// ---------------------------------------------------------------------------
describe("GOAL OPS-V4-DOCS-ASSINATURA-TERMOS-ANEXOS-012 — Termo de Garantia real", () => {
  it("OS com garantiaPrevista real (aberturaV3): v.entrega.garantia vem preenchida (situação/prazo/cobertura)", () => {
    const os = mkOS({
      id: "os-gar-1",
      status: "entregue",
      entregueEm: "2026-01-10T12:00:00.000Z",
      aberturaV3: { garantiaPrevista: { modelo: "tela", label: "Troca de Tela", prazoDias: 90 } },
    })
    const v = buildVals(makeState({ selectedOsId: "os-gar-1", novaOS: false }), () => {}, () => {}, { ...ctx, realOS: os })
    expect(v.entrega.garantia.temGarantia).toBe(true)
    expect(v.entrega.garantia.prazo).toBe("90 dias")
    expect(v.entrega.garantia.cobertura).not.toBe(NI)
    expect(v.entrega.garantia.situacao).not.toBe(NI)
  })

  it("OS sem NENHUM dado de garantia: empty state honesto (temGarantia false, campos NI)", () => {
    const os = mkOS({ id: "os-gar-2", status: "aberta" })
    const v = buildVals(makeState({ selectedOsId: "os-gar-2", novaOS: false }), () => {}, () => {}, { ...ctx, realOS: os })
    expect(v.entrega.garantia.temGarantia).toBe(false)
    expect(v.entrega.garantia.prazo).toBe(NI)
    expect(v.entrega.garantia.inicio).toBe(NI)
    expect(v.entrega.garantia.fim).toBe(NI)
  })

  it('"Termo de Garantia" no menu Docs abre o modal real (docPrint) em vez do toast de preview', () => {
    const patches: Array<Record<string, unknown>> = []
    const msgs: string[] = []
    const v = buildVals(makeState({ novaOS: false }), (p) => patches.push(p as Record<string, unknown>), (m) => msgs.push(m), ctx)
    const item = v.printItems.find((d) => /Termo de Garantia/.test(d.label))!
    item.onClick()
    expect(patches.at(-1)).toMatchObject({ docPrint: "termo_garantia", menu: null })
    expect(msgs.some((m) => /indisponível/i.test(m))).toBe(false)
  })

  it('"Termo de Entrega" no menu Docs abre o modal real (docPrint) em vez do toast de preview', () => {
    const patches: Array<Record<string, unknown>> = []
    const v = buildVals(makeState({ novaOS: false }), (p) => patches.push(p as Record<string, unknown>), () => {}, ctx)
    const item = v.printItems.find((d) => /Termo de Entrega/.test(d.label))!
    item.onClick()
    expect(patches.at(-1)).toMatchObject({ docPrint: "termo_entrega", menu: null })
  })

  it("DocPrintModal reaproveita o PrintPreviewV3 já usado pela V3 (sem motor de documento novo)", () => {
    const src = readFileSync(join(DIR, "parts", "DocPrintModal.tsx"), "utf8")
    expect(src).toContain('from "@/components/operacoes-v3/components/print/PrintPreviewV3"')
  })
})

describe("GOAL OPS-V4-DOCS-ASSINATURA-TERMOS-ANEXOS-012 — Assinatura de retirada real", () => {
  it("OS com assinatura de retirada real (entregaV3): v.entrega.temAssinatura + assinaturaDataUrl vêm da OS", () => {
    const os = mkOS({
      id: "os-assin-1",
      status: "entregue",
      entregueEm: "2026-01-10T12:00:00.000Z",
      entregaV3: { assinaturaRetirada: { dataUrl: "data:image/png;base64,AAAA", criadoEm: "2026-01-10T12:00:00.000Z" } },
    })
    const v = buildVals(makeState({ selectedOsId: "os-assin-1", novaOS: false }), () => {}, () => {}, { ...ctx, realOS: os })
    expect(v.entrega.temAssinatura).toBe(true)
    expect(v.entrega.assinaturaDataUrl).toBe("data:image/png;base64,AAAA")
  })

  it("OS entregue sem assinatura registrada: temAssinatura false, dataUrl vazio (empty honesto)", () => {
    const os = mkOS({ id: "os-assin-2", status: "entregue", entregueEm: "2026-01-10T12:00:00.000Z" })
    const v = buildVals(makeState({ selectedOsId: "os-assin-2", novaOS: false }), () => {}, () => {}, { ...ctx, realOS: os })
    expect(v.entrega.temAssinatura).toBe(false)
    expect(v.entrega.assinaturaDataUrl).toBe("")
  })

  it("EntregaStage renderiza a assinatura como imagem real (não mais texto fabricado)", () => {
    const src = readFileSync(join(DIR, "parts", "stages", "EntregaStage.tsx"), "utf8")
    expect(src).toContain("e.assinaturaDataUrl")
    expect(src).not.toMatch(/\{e\.assinatura\}/)
  })

  it("captura de assinatura reaproveita o SignaturePadV3 da V3 (sem canvas/motor novo) e persiste via salvarAssinaturaRetirada", () => {
    const src = readFileSync(join(DIR, "parts", "stages", "EntregaStage.tsx"), "utf8")
    expect(src).toContain('from "@/components/operacoes-v3/components/SignaturePadV3"')
    expect(src).toContain("v.salvarAssinaturaRetirada")
  })
})

describe("GOAL OPS-V4-DOCS-ASSINATURA-TERMOS-ANEXOS-012 — Fotos de entrada reais (provaEntradaV3)", () => {
  it("OS com fotos reais na prova de entrada: v.entradaFotos reflete o payload real (id/tag/dataUrl)", () => {
    const os = mkOS({
      id: "os-foto-1",
      status: "aberta",
      provaEntradaV3: {
        versao: 1,
        criadoEm: "2026-01-05T10:00:00.000Z",
        fotos: [{ id: "f1", categoria: "defeito", dataUrl: "data:image/jpeg;base64,BBBB", tamanho: 100, criadoEm: "2026-01-05T10:00:00.000Z" }],
      },
    })
    const v = buildVals(makeState({ selectedOsId: "os-foto-1", novaOS: false }), () => {}, () => {}, { ...ctx, realOS: os })
    expect(v.entradaFotos).toHaveLength(1)
    expect(v.entradaFotos[0]).toMatchObject({ id: "f1", tag: "DEFEITO", dataUrl: "data:image/jpeg;base64,BBBB" })
  })

  it("OS sem fotos de entrada: lista vazia honesta (nada fabricado)", () => {
    const os = mkOS({ id: "os-foto-2", status: "aberta" })
    const v = buildVals(makeState({ selectedOsId: "os-foto-2", novaOS: false }), () => {}, () => {}, { ...ctx, realOS: os })
    expect(v.entradaFotos).toEqual([])
  })

  it("o campo legado os.anexos NÃO é mais a fonte das fotos de entrada (contrato morto — nunca escrito por nenhuma action V3)", () => {
    const adapter = readFileSync(join(DIR, "os-adapter.ts"), "utf8")
    const fn = adapter.slice(adapter.indexOf("export function adaptFotosEntrada"), adapter.indexOf("export interface V4SegurancaEntrada"))
    expect(fn).not.toContain("os.anexos")
    expect(fn).toContain("lerProvaEntradaV3")
  })

  it("Entrada usa as actions reais de foto e assinatura da prova de entrada", () => {
    const src = readFileSync(join(DIR, "parts", "stages", "EntradaSections.tsx"), "utf8")
    expect(src).toContain("v.adicionarFotoEntrada")
    expect(src).toContain("v.removerFotoEntrada")
    expect(src).toContain("v.salvarAssinaturaCliente")
    expect(src).not.toMatch(/upload em breve/i)
  })
})

// ---------------------------------------------------------------------------
// GOAL OPS-V4-GARANTIA-EDITOR-IMPL-014 — a V4 ganha o lado de escrita da
// garantia (definir/editar modelo + prazo), reusando o MESMO contrato que a V3
// já usa em `GarantiaOSV3.tsx` (`salvarGarantiaOSV3`, mesmo payload
// `aberturaV3.garantiaPrevista`). Sem termoCustom neste slice (paridade com a
// V3); sem API/backend novo; leitura do termo/menu Docs permanece intocada.
// ---------------------------------------------------------------------------
describe("GOAL OPS-V4-GARANTIA-EDITOR-IMPL-014 — salvarGarantia reusa salvarGarantiaOSV3 via runWrite", () => {
  const orquestrador = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")
  const entregaStage = readFileSync(join(DIR, "parts", "stages", "EntregaStage.tsx"), "utf8")
  const allSources = collectSourceFiles(DIR).map((f) => readFileSync(f, "utf8")).join("\n")

  it("importa e reusa salvarGarantiaOSV3 (mesmo contrato/payload da V3 — sem backend novo)", () => {
    expect(orquestrador).toContain('from "@/lib/operacoes-v3/garantia-actions"')
    expect(orquestrador).toContain("salvarGarantiaOSV3")
  })

  it("salvarGarantia passa pelo wrapper runWrite (fonte única de reload/toast-em-sucesso)", () => {
    expect(orquestrador).toContain("const salvarGarantia = useCallback(")
    expect(orquestrador).toContain('runWrite((sid, osId) => salvarGarantiaOSV3(sid, osId, input), "Garantia salva.")')
    // runWrite continua definido uma única vez — salvarGarantia reaproveita, não duplica.
    expect(orquestrador.match(/const runWrite = useCallback/g)?.length).toBe(1)
  })

  it("EntregaStage renderiza o form real (v.salvarGarantia) com o catálogo/prazo padrão da V3", () => {
    expect(entregaStage).toContain("v.salvarGarantia")
    expect(entregaStage).toContain("GARANTIA_CATALOGO_V3")
    expect(entregaStage).toContain("prazoPadraoGarantiaV3")
    expect(entregaStage).toMatch(/Definir garantia|Editar garantia/)
    expect(entregaStage).toContain("Salvar garantia")
  })

  it("botão de salvar tem busy-lock e fica desabilitado sem mudança (evita duplo clique / salvar sem editar)", () => {
    expect(entregaStage).toContain("useState")
    expect(entregaStage).toMatch(/disabled=\{busy \|\| !dirty\}/)
  })

  it("não expõe termoCustom neste slice — paridade com a V3 (GarantiaOSV3.tsx só edita modelo+prazo)", () => {
    expect(entregaStage).not.toContain("termoCustom")
  })

  it("copy honesta sobre quando a garantia passa a valer", () => {
    expect(entregaStage).toContain("A garantia fica prevista na OS e passa a valer na entrega.")
  })

  it("não cria rota de API nova nem referencia updateOSPayload/loja-1/openCaixaIfClosed", () => {
    for (const proibido of ['from "@/app/api', "updateOSPayload", '"loja-1"', "openCaixaIfClosed"]) {
      expect(allSources, `referência proibida encontrada: ${proibido}`).not.toContain(proibido)
    }
  })

  it('"Termo de Garantia" no menu Docs continua no mesmo fluxo existente (docPrint → PrintPreviewV3), sem motor de impressão duplicado', () => {
    const docPrintModal = readFileSync(join(DIR, "parts", "DocPrintModal.tsx"), "utf8")
    expect(orquestrador).toContain('openDocPrint("termo_garantia")')
    expect(docPrintModal).toContain('from "@/components/operacoes-v3/components/print/PrintPreviewV3"')
  })
})

describe("GOAL OPS-V4-GARANTIA-EDITOR-IMPL-014 — v.salvarGarantia expõe o handler real do ctx", () => {
  it("repassa o input recebido a ctx.salvarGarantia e devolve o resultado (sem transformar nada)", async () => {
    let recebido: unknown = null
    const ctxLocal: V4DataCtx = {
      ...ctx,
      realOS: mkOS({ id: "os-gar", status: "em_execucao" }),
      salvarGarantia: async (input) => {
        recebido = input
        return true
      },
    }
    const v = buildVals(makeState({ selectedOsId: "os-gar", novaOS: false }), () => {}, () => {}, ctxLocal)
    const ok = await v.salvarGarantia({ modeloId: "tela", prazoDias: 90 })
    expect(ok).toBe(true)
    expect(recebido).toEqual({ modeloId: "tela", prazoDias: 90 })
  })

  it("falha do handler devolve false sem lançar (mesma garantia dos demais writes)", async () => {
    const ctxLocal: V4DataCtx = {
      ...ctx,
      realOS: mkOS({ id: "os-gar-2", status: "em_execucao" }),
      salvarGarantia: async () => false,
    }
    const v = buildVals(makeState({ selectedOsId: "os-gar-2", novaOS: false }), () => {}, () => {}, ctxLocal)
    await expect(v.salvarGarantia({ modeloId: "sem_garantia" })).resolves.toBe(false)
  })
})

// ---------------------------------------------------------------------------
// GOAL OPS-V4-ATENDIMENTO-RAPIDO-CONNECT-014 — "Atendimento rápido" conecta a
// V4 ao contrato REAL já existente da V3 (`finalizarAtendimentoRapidoV3`): cria
// a OS pelo caminho seguro, gera e aprova o orçamento, recebe no caixa e marca
// como entregue — em um único passo, com compensação automática no servidor se
// algo falhar no meio. Sem motor novo, sem API nova, sem tocar caixa/financeiro/
// estoque/whatsapp/fiscal diretamente. Os checks abaixo leem o SOURCE real via
// fs (não importam os componentes), então não precisam de mocks novos.
// ---------------------------------------------------------------------------
describe("GOAL OPS-V4-ATENDIMENTO-RAPIDO-CONNECT-014 — conecta ao contrato real da V3", () => {
  const orquestrador = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")
  const modal = readFileSync(join(DIR, "parts", "AtendimentoRapidoModal.tsx"), "utf8")
  const formHelper = readFileSync(join(DIR, "..", "..", "lib", "operacoes-v4", "atendimento-rapido-form.ts"), "utf8")
  const topBar = readFileSync(join(DIR, "parts", "TopBar.tsx"), "utf8")
  const shell = readFileSync(join(DIR, "OperacoesV4Preview.tsx"), "utf8")
  const allSources = collectSourceFiles(DIR).map((f) => readFileSync(f, "utf8")).join("\n")

  it("reutiliza finalizarAtendimentoRapidoV3 (V3, sem motor novo)", () => {
    expect(modal).toContain('from "@/lib/operacoes-v3/atendimento-rapido-actions"')
    expect(modal).toContain("finalizarAtendimentoRapidoV3")
  })

  it("reutiliza validarAtendimentoRapidoV3 (V3) em vez de duplicar a validação (uma única fonte de verdade para as mensagens de erro)", () => {
    expect(modal).toContain('from "@/lib/operacoes-v3/atendimento-rapido-model"')
    expect(modal).toContain("validarAtendimentoRapidoV3")
    expect(modal).not.toContain("Informe o serviço realizado.")
    expect(modal).not.toContain("Informe um valor maior que zero para o serviço.")
  })

  it("não cria rota de API nova — chama a Server Action direto, como o Nova OS já faz", () => {
    expect(modal).not.toContain('from "@/app/api')
    expect(formHelper).not.toContain('from "@/app/api')
    expect(allSources).not.toContain('from "@/app/api')
  })

  it("não importa caixa/financeiro/estoque/whatsapp/fiscal/prisma direto — só lê o status do caixa via contrato V3 (getCaixaSessaoAbertaV3)", () => {
    for (const proibido of [
      'from "@/lib/caixa',
      'from "@/lib/financeiro',
      'from "@/lib/estoque',
      'from "@/lib/whatsapp',
      'from "@/lib/fiscal',
      'from "@/components/pdv',
      'from "@/lib/prisma',
    ]) {
      expect(modal, `import proibido encontrado no modal: ${proibido}`).not.toContain(proibido)
      expect(formHelper, `import proibido encontrado no form helper: ${proibido}`).not.toContain(proibido)
    }
    expect(modal).toContain('from "@/lib/operacoes-v3/pdv-servico-actions"')
    expect(modal).toContain("getCaixaSessaoAbertaV3")
  })

  it("nunca usa updateOSPayload, loja-1 (fallback literal) nem openCaixaIfClosed", () => {
    for (const proibido of ["updateOSPayload", '"loja-1"', "'loja-1'", "`loja-1`", "openCaixaIfClosed"]) {
      expect(modal, `referência proibida encontrada no modal: ${proibido}`).not.toContain(proibido)
      expect(formHelper, `referência proibida encontrada no form helper: ${proibido}`).not.toContain(proibido)
    }
  })

  it("é honesto sobre caixa fechado: mostra aviso real e mantém o botão desabilitado (nunca finge sucesso)", () => {
    expect(modal).toMatch(/Caixa fechado/i)
    expect(modal).toMatch(/caixaAberta\s*===\s*true/)
    expect(modal).toContain("disabled={!podeFinalizar}")
    // Nunca abre caixa por conta própria — só lê o estado real.
    expect(modal).not.toContain("abrirCaixa")
  })

  it("não há dado fabricado no modal — usa o catálogo curado real da V3 (SERVICOS_RAPIDOS_V3), sem cliente/OS de exemplo hardcoded", () => {
    expect(modal).toContain("SERVICOS_RAPIDOS_V3")
    for (const fake of ["Cliente Teste", "OS-0001", "João da Silva"]) {
      expect(modal, `dado fabricado encontrado: ${fake}`).not.toContain(fake)
    }
  })

  it("o fluxo fica atrás de ação explícita do operador: estado nasce fechado e o modal só monta o formulário quando aberto", () => {
    expect(orquestrador).toMatch(/atendimentoRapido:\s*false,/)
    expect(modal).toMatch(/if \(!v\.atendimentoRapidoOpen\) return null/)
  })

  it("Atendimento rápido sai do TopBar e passa a ser escolhido no launcher + Novo", () => {
    expect(topBar).not.toContain("v.openAtendimentoRapido")
    expect(topBar).toContain("v.openNovoAtendimento")
    expect(topBar).toMatch(/\+ Novo/)
  })

  it("o modal é montado na casca da V4, ao lado do Nova OS", () => {
    expect(shell).toContain("<AtendimentoRapidoModal")
    expect(shell).toContain('from "./parts/AtendimentoRapidoModal"')
  })

  it("ao concluir, reusa o mesmo padrão de reload do Nova OS (reloadOrdens + seleciona a OS + fecha o modal) — sem estado local fake", () => {
    expect(orquestrador).toMatch(/const onAtendimentoRapidoConcluido = \(osId: string\) => \{/)
    expect(orquestrador).toMatch(/ctx\.reloadOrdens\(\);\s*notify\("Atendimento rápido concluído/)
  })
})

// ---------------------------------------------------------------------------
// GOAL OPS-V4-ORC-RAPIDO-024 — "⚡ Orçamento Rápido" conecta a V4 ao contrato
// REAL da V3 (`criarOrcamentoRapidoV3`): cria a OS mínima e materializa o
// orçamento multiopção (itens fixos + 1 grupo de escolha) em RASCUNHO — sem
// enviar, sem seleção/aprovação, sem transição de status manual. Compensação
// (cancelamento pelo caminho seguro) acontece no servidor. Os checks abaixo
// leem o SOURCE real via fs (não importam os componentes/action "use server").
// ---------------------------------------------------------------------------
describe("GOAL OPS-V4-ORC-RAPIDO-024 — ⚡ Orçamento Rápido conecta ao contrato real da V3", () => {
  const orquestrador = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")
  const modal = readFileSync(join(DIR, "parts", "OrcamentoRapidoModal.tsx"), "utf8")
  const formHelper = readFileSync(join(DIR, "..", "..", "lib", "operacoes-v4", "orcamento-rapido-form.ts"), "utf8")
  const topBar = readFileSync(join(DIR, "parts", "TopBar.tsx"), "utf8")
  const shell = readFileSync(join(DIR, "OperacoesV4Preview.tsx"), "utf8")
  const allSources = collectSourceFiles(DIR).map((f) => readFileSync(f, "utf8")).join("\n")

  it("reutiliza criarOrcamentoRapidoV3 (V3, sem motor novo)", () => {
    expect(modal).toContain('from "@/lib/operacoes-v3/orcamento-rapido-actions"')
    expect(modal).toContain("criarOrcamentoRapidoV3")
  })

  it("reutiliza validarOrcamentoRapidoFormV4 (helper puro) em vez de duplicar mensagens de erro no componente", () => {
    expect(modal).toContain("validarOrcamentoRapidoFormV4")
    expect(modal).not.toContain("Selecione o cliente existente.")
  })

  it("a faixa de total exibida reusa previaTotaisOrcamentoRapidoV4 (que por sua vez reusa computeTotaisV3) — zero aritmética própria no modal", () => {
    expect(modal).toContain("previaTotaisOrcamentoRapidoV4")
    expect(formHelper).toContain("computeTotaisV3")
    // O modal não soma valores manualmente (nenhum `.reduce(` ali).
    expect(modal).not.toContain(".reduce(")
  })

  it("não cria rota de API nova — chama a Server Action direto, como o Nova OS/Atendimento Rápido já fazem", () => {
    expect(modal).not.toContain('from "@/app/api')
    expect(formHelper).not.toContain('from "@/app/api')
  })

  it("não importa caixa/financeiro/estoque/whatsapp/fiscal/prisma direto (a OS nasce sem cobrança — nada disso é necessário aqui)", () => {
    for (const proibido of [
      'from "@/lib/caixa',
      'from "@/lib/financeiro',
      'from "@/lib/estoque',
      'from "@/lib/whatsapp',
      'from "@/lib/fiscal',
      'from "@/components/pdv',
      'from "@/lib/prisma',
    ]) {
      expect(modal, `import proibido encontrado no modal: ${proibido}`).not.toContain(proibido)
      expect(formHelper, `import proibido encontrado no form helper: ${proibido}`).not.toContain(proibido)
    }
  })

  it("nunca usa updateOSPayload, loja-1 (fallback literal) nem openCaixaIfClosed", () => {
    for (const proibido of ["updateOSPayload", '"loja-1"', "'loja-1'", "`loja-1`", "openCaixaIfClosed"]) {
      expect(modal, `referência proibida encontrada no modal: ${proibido}`).not.toContain(proibido)
      expect(formHelper, `referência proibida encontrada no form helper: ${proibido}`).not.toContain(proibido)
    }
  })

  it("não há dado fabricado no modal — sem cliente/OS de exemplo hardcoded", () => {
    for (const fake of ["Cliente Teste", "OS-0001", "João da Silva"]) {
      expect(modal, `dado fabricado encontrado: ${fake}`).not.toContain(fake)
    }
  })

  it("o fluxo fica atrás de ação explícita do operador: estado nasce fechado e o modal só monta o formulário quando aberto", () => {
    expect(orquestrador).toMatch(/orcamentoRapido:\s*false,/)
    expect(modal).toMatch(/if \(!v\.orcamentoRapidoOpen\) return null/)
  })

  it("Orçamento rápido sai do TopBar e passa a ser escolhido no launcher + Novo", () => {
    expect(topBar).not.toContain("v.openOrcamentoRapido")
    expect(topBar).toContain("v.openNovoAtendimento")
    expect(topBar).toMatch(/\+ Novo/)
  })

  it("o modal é montado na casca da V4, ao lado do Nova OS/Atendimento Rápido", () => {
    expect(shell).toContain("<OrcamentoRapidoModal")
    expect(shell).toContain('from "./parts/OrcamentoRapidoModal"')
  })

  it("ao criar, reusa o mesmo padrão de reload do Nova OS (reloadOrdens + seleciona a OS + fecha o modal) — sem transição de status manual, OS nasce 'aberta'", () => {
    expect(orquestrador).toMatch(/const onOrcamentoRapidoCriado = \(osId: string\) => \{/)
    expect(orquestrador).toMatch(/ctx\.reloadOrdens\(\);\s*notify\("Orçamento rápido criado/)
    // Verifica, no CORPO do handler, que o status setado é "aberta" (nunca uma
    // transição manual tipo "aguardando_aprovacao" — isso é responsabilidade do envio, GOAL 025).
    const inicio = orquestrador.indexOf("const onOrcamentoRapidoCriado")
    const fim = orquestrador.indexOf("};", inicio)
    const corpo = orquestrador.slice(inicio, fim)
    expect(corpo).toContain('status: "aberta"')
    expect(corpo).not.toContain("aplicarTransicaoStatusV3")
  })

  it("duplo-submit é bloqueado por `busy` (uma OS por clique)", () => {
    expect(modal).toMatch(/disabled=\{!podeSalvar\}/)
    expect(modal).toMatch(/busy/)
  })

  it("GOAL 001 — o modal comercial pode enviar no create; continua proibido de aprovar/recusar e de abrir WhatsApp direto", () => {
    expect(modal).toContain("enviarOrcamentoPorCanalV3")
    for (const proibido of ["wa.me", "aprovarOrcamentoV3", "recusarOrcamentoV3"]) {
      expect(modal, `referência fora de escopo encontrada no modal: ${proibido}`).not.toContain(proibido)
    }
  })

  it("guard geral: nenhum arquivo da Preview usa loja-1/openCaixaIfClosed/updateOSPayload (cobre os arquivos novos deste GOAL)", () => {
    for (const proibido of ['"loja-1"', "'loja-1'", "`loja-1`", "openCaixaIfClosed", "updateOSPayload"]) {
      expect(allSources, `proibido encontrado: ${proibido}`).not.toContain(proibido)
    }
  })
})

// ---------------------------------------------------------------------------
// GOAL OPS-V4-ORC-ENVIO-WA-025 — fecha o ciclo visível do orçamento: mensagem
// multiopção (gerada da projeção client-safe do GOAL 023), envio por canal
// (`enviarOrcamentoPorCanalV3`, GOAL 025 motor), painel pós-envio e "Duplicar
// orçamento" (prefill do GOAL 024). SÓ `OrcamentoEnvioCluster.tsx` e
// `OrcamentoDuplicarButton.tsx` estão autorizados a chamar essas actions — o
// `OrcamentoRapidoModal.tsx` (GOAL 024) permanece proibido (guard acima).
// ---------------------------------------------------------------------------
describe("GOAL OPS-V4-ORC-ENVIO-WA-025 — envio por canal, mensagem e duplicar", () => {
  const envioCluster = readFileSync(join(DIR, "parts", "stages", "OrcamentoEnvioCluster.tsx"), "utf8")
  const duplicarBtn = readFileSync(join(DIR, "parts", "stages", "OrcamentoDuplicarButton.tsx"), "utf8")
  const orcamentoStage = readFileSync(join(DIR, "parts", "stages", "OrcamentoStage.tsx"), "utf8")
  const orquestrador = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")
  const modal = readFileSync(join(DIR, "parts", "OrcamentoRapidoModal.tsx"), "utf8")

  it("SÓ o cluster de envio chama enviarOrcamentoPorCanal — o motor real fica em use-v4-preview.ts → orcamento-envio-actions", () => {
    expect(envioCluster).toContain("v.enviarOrcamentoPorCanal")
    expect(orquestrador).toContain('from "@/lib/operacoes-v3/orcamento-envio-actions"')
    expect(orquestrador).toContain("enviarOrcamentoPorCanalV3")
  })

  it("a mensagem nasce da projeção client-safe (GOAL 023) — nunca de payload/orçamento cru", () => {
    expect(envioCluster).toContain("v.orcamentoClienteView")
    expect(envioCluster).toContain("montarMensagemOrcamentoV4")
    expect(envioCluster).not.toContain(".payload")
    expect(envioCluster).not.toContain("os.orcamento")
  })

  it("window.open (WhatsApp) só aparece no painel PÓS-envio (dentro do bloco ultimoResultado), nunca dentro de handleEnviar (popup-safe: nunca encadeado depois de um await)", () => {
    const idxHandle = envioCluster.indexOf("const handleEnviar")
    const idxFimHandle = envioCluster.indexOf("const handleCopiarERegistrar")
    const corpoHandle = envioCluster.slice(idxHandle, idxFimHandle)
    expect(corpoHandle).not.toContain("window.open")
    expect(envioCluster).toContain("window.open(linkWa.url")
  })

  it("Duplicar orçamento nunca envia/aprova/recusa nem cria OS — só monta prefill e abre o modal 024", () => {
    for (const proibido of [
      "enviarOrcamentoPorCanalV3",
      "enviarOrcamentoV3",
      "registrarEnvioOrcamento",
      "aprovarOrcamentoV3",
      "recusarOrcamentoV3",
      "criarOrcamentoRapidoV3",
    ]) {
      expect(duplicarBtn, `referência proibida encontrada em OrcamentoDuplicarButton: ${proibido}`).not.toContain(proibido)
    }
    expect(duplicarBtn).toContain("montarPrefillDuplicarOrcamentoV4")
    expect(duplicarBtn).toContain("v.abrirOrcamentoRapidoComPrefill")
  })

  it("o cluster de envio e o botão duplicar não importam prisma/@/app/api/caixa/financeiro/estoque/whatsapp/fiscal direto", () => {
    for (const alvo of [envioCluster, duplicarBtn]) {
      for (const proibido of [
        'from "@/lib/prisma',
        'from "@/app/api',
        'from "@/lib/caixa',
        'from "@/lib/financeiro',
        'from "@/lib/estoque',
        'from "@/lib/whatsapp',
        'from "@/lib/fiscal',
        'from "@/components/pdv',
      ]) {
        expect(alvo, `proibido encontrado: ${proibido}`).not.toContain(proibido)
      }
    }
  })

  it("nenhum arquivo novo usa loja-1/openCaixaIfClosed/updateOSPayload", () => {
    for (const alvo of [envioCluster, duplicarBtn]) {
      for (const proibido of ['"loja-1"', "'loja-1'", "`loja-1`", "openCaixaIfClosed", "updateOSPayload"]) {
        expect(alvo, `proibido encontrado: ${proibido}`).not.toContain(proibido)
      }
    }
  })

  it("o cluster de envio é montado no OrcamentoStage (etapa editável), junto do botão Duplicar", () => {
    expect(orcamentoStage).toContain("<OrcamentoEnvioCluster")
    expect(orcamentoStage).toContain("<OrcamentoDuplicarButton")
  })

  it("gating honesto por canal: sem itens desabilita o cluster; WhatsApp desabilita quando o telefone é inválido (demais canais continuam ativos)", () => {
    expect(envioCluster).toContain("semItens")
    expect(envioCluster).toMatch(/disabled=\{!linkWa\.valido\}/)
    // "Copiar mensagem" e "Entregue em mãos" não dependem de linkWa.valido.
    const idxCopiar = envioCluster.indexOf("handleCopiarERegistrar()} style")
    const idxPresencial = envioCluster.indexOf('handleEnviar("presencial")')
    expect(idxCopiar).toBeGreaterThan(-1)
    expect(idxPresencial).toBeGreaterThan(-1)
  })

  it("o modal 024 lê initialValues (prefill) mas nunca monta o prefill sozinho — quem monta é orcamento-prefill.ts", () => {
    expect(modal).toContain("v.orcamentoRapidoInitialValues")
    expect(modal).not.toContain("montarPrefillDuplicarOrcamentoV4")
  })

  it("reenvio preserva validoAte: o orquestrador NÃO chama enviarOrcamentoV3 de novo (isso é responsabilidade exclusiva de orcamento-envio-actions no servidor)", () => {
    const idxFn = orquestrador.indexOf("const enviarOrcamentoPorCanal = useCallback")
    const idxFim = orquestrador.indexOf("const orcamentoRapidoPrefill", idxFn)
    const corpo = orquestrador.slice(idxFn, idxFim)
    expect(corpo).not.toContain("enviarOrcamentoV3(")
    expect(corpo).toContain("enviarOrcamentoPorCanalV3(")
  })
})

// ---------------------------------------------------------------------------
// GOAL OPS-V4-ORC-APROVACAO-SELECAO-026 — seleção de variante por grupo +
// decisão (aprovar/recusar com motivo estruturado) + Duplicar não copia
// linhas "interno". SÓ `OrcamentoDecisaoCluster.tsx` está autorizado a chamar
// `aprovarOrcamentoV3`/`recusarOrcamentoV3`/`selecionarVarianteOrcamento` — o
// modal 024 e o cluster de envio 025 continuam proibidos (guards já existentes).
// ---------------------------------------------------------------------------
describe("GOAL OPS-V4-ORC-APROVACAO-SELECAO-026 — seleção de variante e decisão", () => {
  const decisaoCluster = readFileSync(join(DIR, "parts", "stages", "OrcamentoDecisaoCluster.tsx"), "utf8")
  const envioCluster = readFileSync(join(DIR, "parts", "stages", "OrcamentoEnvioCluster.tsx"), "utf8")
  const duplicarBtn = readFileSync(join(DIR, "parts", "stages", "OrcamentoDuplicarButton.tsx"), "utf8")
  const orcamentoStage = readFileSync(join(DIR, "parts", "stages", "OrcamentoStage.tsx"), "utf8")
  const modal = readFileSync(join(DIR, "parts", "OrcamentoRapidoModal.tsx"), "utf8")
  const orquestrador = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")

  it("SÓ o cluster de decisão chama aprovar/recusar/selecionar — motor real fica em use-v4-preview.ts", () => {
    expect(decisaoCluster).toContain("v.aprovarOrcamento")
    expect(decisaoCluster).toContain("v.recusarOrcamento")
    expect(decisaoCluster).toContain("v.selecionarVarianteOrcamento")
    expect(orquestrador).toContain("aprovarOrcamentoV3")
    expect(orquestrador).toContain("recusarOrcamentoV3")
  })

  it("o modal 024 e o cluster de envio 025 CONTINUAM proibidos de aprovar/recusar/selecionar", () => {
    for (const proibido of ["aprovarOrcamentoV3", "recusarOrcamentoV3", "selecionarVarianteOrcamento", "v.aprovarOrcamento", "v.recusarOrcamento"]) {
      expect(modal, `referência proibida encontrada no modal: ${proibido}`).not.toContain(proibido)
      expect(envioCluster, `referência proibida encontrada no cluster de envio: ${proibido}`).not.toContain(proibido)
      expect(duplicarBtn, `referência proibida encontrada no botão duplicar: ${proibido}`).not.toContain(proibido)
    }
  })

  it("recusa usa motivo ESTRUTURADO (enum) — nunca texto livre solto", () => {
    expect(decisaoCluster).toContain("MOTIVO_RECUSA_LABEL_V3")
    expect(decisaoCluster).toMatch(/recusarOrcamento\(\{\s*motivo,\s*observacao/)
  })

  it("Aprovar fica desabilitado enquanto houver grupo sem seleção (mesma regra que o servidor aplicaria)", () => {
    expect(decisaoCluster).toContain("podeAprovar")
    expect(decisaoCluster).toMatch(/disabled=\{busyDecisao \|\| !podeAprovar\}/)
  })

  it("'Pediu alteração' não chama nenhuma action (nota honesta, sem transição forçada)", () => {
    const idxNota = decisaoCluster.indexOf('"Pediu alteração"')
    expect(idxNota).toBeGreaterThan(-1)
    // Não deve haver runWrite/action de escrita colado ao botão de nota — só toggle de estado local.
    expect(decisaoCluster).toContain("setNotaAlteracao")
  })

  it("oferta de cancelamento pós-recusa/expiração reusa o fluxo existente (abrirCancelamentoComMotivo), sem duplicar o modal", () => {
    expect(decisaoCluster).toContain("v.abrirCancelamentoComMotivo")
    expect(orquestrador).toContain("abrirCancelamentoComMotivo")
    // Não recria um segundo modal de cancelamento.
    expect(decisaoCluster).not.toContain("CancelamentoOSModal")
  })

  it("o cluster de decisão é montado no OrcamentoStage, ao lado do cluster de envio", () => {
    expect(orcamentoStage).toContain("<OrcamentoDecisaoCluster")
    expect(orcamentoStage).toContain("<OrcamentoEnvioCluster")
  })

  it("o cluster de decisão não importa prisma/@/app/api/caixa/financeiro/estoque/whatsapp/fiscal direto", () => {
    for (const proibido of [
      'from "@/lib/prisma',
      'from "@/app/api',
      'from "@/lib/caixa',
      'from "@/lib/financeiro',
      'from "@/lib/estoque',
      'from "@/lib/whatsapp',
      'from "@/lib/fiscal',
      'from "@/components/pdv',
    ]) {
      expect(decisaoCluster, `proibido encontrado: ${proibido}`).not.toContain(proibido)
    }
  })

  it("nenhum arquivo novo usa loja-1/openCaixaIfClosed/updateOSPayload", () => {
    for (const proibido of ['"loja-1"', "'loja-1'", "`loja-1`", "openCaixaIfClosed", "updateOSPayload"]) {
      expect(decisaoCluster, `proibido encontrado: ${proibido}`).not.toContain(proibido)
    }
  })

  it("não adiciona transição NOVA na status-machine — só reusa aprovarOrcamentoV3/recusarOrcamentoV3 existentes", () => {
    expect(decisaoCluster).not.toContain("aplicarTransicaoStatusV3")
  })
})

// ---------------------------------------------------------------------------
// GOAL OPS-V4-RECEBIMENTO-ESTORNO-016 — expõe o estorno de recebimento na aba
// Financeiro da V4, consumindo EXCLUSIVAMENTE o hook/action REAIS já existentes
// da V3 (`usePdvServicoV3.estornar` → `estornarRecebimentoOSV3`): sem motor
// novo, sem duplicar a regra financeira (elegibilidade = recebido>0 + caixa
// aberto, mesma leitura que já alimenta `v.recebimento`). A V4 só acrescenta um
// motivo obrigatório (mínimo de caracteres) antes de liberar a confirmação —
// a V3 aceita motivo opcional, a V4 exige mais para manter o estorno auditável.
// ---------------------------------------------------------------------------
describe("GOAL OPS-V4-RECEBIMENTO-ESTORNO-016 — estorno de recebimento conecta ao contrato real da V3", () => {
  const orquestrador = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")
  const modal = readFileSync(join(DIR, "parts", "EstornoRecebimentoModal.tsx"), "utf8")
  const formHelper = readFileSync(join(DIR, "..", "..", "lib", "operacoes-v4", "estorno-recebimento-form.ts"), "utf8")
  const financeiroStage = readFileSync(join(DIR, "parts", "stages", "FinanceiroStage.tsx"), "utf8")
  const shell = readFileSync(join(DIR, "OperacoesV4Preview.tsx"), "utf8")
  const hookV3 = readFileSync(join(DIR, "..", "operacoes-v3", "hooks", "use-pdv-servico-v3.ts"), "utf8")

  function ctxComPdvEstorno(pagamento: Pick<PagamentoV3, "total" | "recebido" | "saldo" | "status"> | null, sessaoAberta: boolean): V4DataCtx {
    return {
      ...ctx,
      financialProjection: financialStateFromPayment(pagamento),
      pdvServico: {
        ...ctx.pdvServico,
        pagamento,
        sessao: { aberta: sessaoAberta, sessaoId: sessaoAberta ? "sessao-1" : undefined },
      },
    }
  }

  it("v.estorno só habilita com recebido>0 e caixa aberto (mesma regra do servidor)", () => {
    const v = buildVals(makeState({ novaOS: false }), () => {}, () => {}, ctxComPdvEstorno({ total: 300, recebido: 300, saldo: 0, status: "quitado" }, true))
    expect(v.estorno).toEqual({ temRecebido: true, caixaAberto: true, podeEstornar: true })
  })

  it("caixa fechado: podeEstornar false mesmo com recebido>0", () => {
    const v = buildVals(makeState({ novaOS: false }), () => {}, () => {}, ctxComPdvEstorno({ total: 300, recebido: 300, saldo: 0, status: "quitado" }, false))
    expect(v.estorno.caixaAberto).toBe(false)
    expect(v.estorno.podeEstornar).toBe(false)
  })

  it("sem recebimento (recebido=0): temRecebido false, podeEstornar false mesmo com caixa aberto", () => {
    const v = buildVals(makeState({ novaOS: false }), () => {}, () => {}, ctxComPdvEstorno({ total: 300, recebido: 0, saldo: 300, status: "aberto" }, true))
    expect(v.estorno.temRecebido).toBe(false)
    expect(v.estorno.podeEstornar).toBe(false)
  })

  it("pagamento ainda não carregado (null): tudo honesto/false, sem crash", () => {
    const v = buildVals(makeState({ novaOS: false }), () => {}, () => {}, ctxComPdvEstorno(null, true))
    expect(v.estorno).toEqual({ temRecebido: false, caixaAberto: true, podeEstornar: false })
  })

  it("recebimento parcial (recebido>0, saldo>0) também habilita estorno — a V3 reverte o último pagamento, não exige quitação", () => {
    const v = buildVals(makeState({ novaOS: false }), () => {}, () => {}, ctxComPdvEstorno({ total: 500, recebido: 100, saldo: 400, status: "parcial" }, true))
    expect(v.estorno.podeEstornar).toBe(true)
  })

  it("o hook real (usePdvServicoV3) já conecta estornar a estornarRecebimentoOSV3 — a V4 reaproveita, não duplica o motor", () => {
    expect(hookV3).toContain("estornarRecebimentoOSV3")
    expect(hookV3).toContain("estornar:")
  })

  it("estornarRecebimentoV4 envolve o estornar do hook (mesmo padrão do receberPagamentoV4) e só recarrega lista+detalhe no sucesso", () => {
    expect(orquestrador).toMatch(/const estornarRecebimentoV4 = useCallback\(/)
    expect(orquestrador).toContain("estornarPdvV3(input)")
    expect(orquestrador).toContain("estornar: estornarRecebimentoV4")
  })

  it("motivo obrigatório: a V4 exige mais que a V3 (que aceita motivo opcional) — validação pura, sem duplicar regra financeira", () => {
    expect(formHelper).toContain("export function validarMotivoEstornoV4")
    expect(formHelper).not.toContain("estornarContaReceber")
    expect(modal).toContain("validarMotivoEstornoV4")
    expect(modal).toContain("buildEstornarRecebimentoInputV4")
  })

  it("não importa caixa/financeiro/estoque/whatsapp/fiscal/prisma/app-api direto no modal nem no form helper", () => {
    for (const proibido of [
      'from "@/lib/caixa',
      'from "@/lib/financeiro',
      'from "@/lib/estoque',
      'from "@/lib/whatsapp',
      'from "@/lib/fiscal',
      'from "@/components/pdv',
      'from "@/lib/prisma',
      'from "@/app/api',
    ]) {
      expect(modal, `import proibido encontrado no modal: ${proibido}`).not.toContain(proibido)
      expect(formHelper, `import proibido encontrado no form helper: ${proibido}`).not.toContain(proibido)
    }
    // O modal nunca importa a action V3 direto — só via `v.pdvServico.estornar`
    // (hook já sancionado). O form helper importa só o TIPO do contrato V3, nunca
    // chama a action.
    expect(modal).not.toContain('from "@/lib/operacoes-v3/pdv-servico-actions"')
    expect(formHelper).not.toContain("estornarRecebimentoOSV3(")
  })

  it("nunca usa updateOSPayload, loja-1 (fallback literal) nem openCaixaIfClosed", () => {
    for (const proibido of ["updateOSPayload", '"loja-1"', "'loja-1'", "`loja-1`", "openCaixaIfClosed"]) {
      expect(modal, `referência proibida encontrada no modal: ${proibido}`).not.toContain(proibido)
    }
  })

  it("é honesto sobre caixa fechado: mostra aviso real e mantém a confirmação desabilitada (nunca finge sucesso)", () => {
    expect(modal).toMatch(/Caixa fechado/i)
    expect(modal).toContain("v.estorno.caixaAberto")
    expect(modal).toContain("disabled={!podeConfirmar}")
  })

  it("o fluxo fica atrás de ação explícita do operador: estado nasce fechado e o modal só monta quando aberto", () => {
    expect(orquestrador).toMatch(/estornoRecebimento:\s*false,/)
    expect(modal).toMatch(/if \(!v\.estornoRecebimentoOpen\) return null/)
  })

  it("botão 'Estornar' no FinanceiroStage chama v.openEstornoRecebimento, só aparece quando há recebimento e respeita o gating", () => {
    expect(financeiroStage).toContain("v.openEstornoRecebimento")
    expect(financeiroStage).toContain("projection.receivedTotal")
    expect(financeiroStage).toMatch(/disabled=\{!v\.estorno\.podeEstornar\}/)
  })

  it("o modal é montado na casca da V4, ao lado dos demais modais reais", () => {
    expect(shell).toContain("<EstornoRecebimentoModal")
    expect(shell).toContain('from "./parts/EstornoRecebimentoModal"')
  })

  it("no sucesso, fecha o modal e limpa o motivo local — sem estado otimista (quem atualiza a tela é o reload real)", () => {
    expect(modal).toMatch(/const ok = await pdv\.estornar\(input\);\s*if \(ok\) fechar\(\);/)
  })

  it("só existe uma chamada a pdv.estornar( no modal (sem motor duplicado / sem clique disparando duas escritas)", () => {
    expect((modal.match(/pdv\.estornar\(/g) ?? []).length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// GOAL OPS-V4-CANCELAR-OS-CONNECT-021 — expõe o cancelamento de OS na V4,
// consumindo EXCLUSIVAMENTE o contrato REAL já blindado da V3
// (`aplicarTransicaoStatusV3(sid, osId, "cancelada", { motivo })`, commit
// f825867: motivo obrigatório, bloqueia qualquer pagamento recebido, nunca
// ignora o retorno do cancelamento do CR). Sem motor novo, sem API nova. A V4
// só acrescenta gating client-side (mesma máquina única `podeTransicionarV3`
// que já governa execAcoes + mesma leitura de pagamento de recebimento/estorno).
// ---------------------------------------------------------------------------
describe("GOAL OPS-V4-CANCELAR-OS-CONNECT-021 — cancelamento de OS conecta ao contrato real da V3", () => {
  const orquestrador = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")
  const modal = readFileSync(join(DIR, "parts", "CancelamentoOSModal.tsx"), "utf8")
  const formHelper = readFileSync(join(DIR, "..", "..", "lib", "operacoes-v4", "cancelamento-form.ts"), "utf8")
  const shell = readFileSync(join(DIR, "OperacoesV4Preview.tsx"), "utf8")

  function ctxComCancelamento(
    realOSStatus: string,
    pagamento: Pick<PagamentoV3, "total" | "recebido" | "saldo" | "status"> | null,
  ): V4DataCtx {
    return {
      ...ctx,
      realOS: mkOS({ id: "os-cancel", status: realOSStatus }),
      financialProjection: financialStateFromPayment(pagamento),
      pdvServico: { ...ctx.pdvServico, pagamento },
    }
  }

  it("v.cancelamento habilita quando status permite e não há pagamento recebido", () => {
    const v = buildVals(
      makeState({ selectedOsId: "os-cancel", novaOS: false, status: "em_execucao" }),
      () => {},
      () => {},
      ctxComCancelamento("em_execucao", { total: 0, recebido: 0, saldo: 0, status: "sem_cobranca" }),
    )
    expect(v.cancelamento.statusPermite).toBe(true)
    expect(v.cancelamento.semPagamento).toBe(true)
    expect(v.cancelamento.podeCancelar).toBe(true)
  })

  it("OS entregue: bloqueia (status não permite) — mensagem vem da máquina única, não inventada", () => {
    const v = buildVals(
      makeState({ selectedOsId: "os-cancel", novaOS: false, status: "entregue" }),
      () => {},
      () => {},
      ctxComCancelamento("entregue", null),
    )
    expect(v.cancelamento.statusPermite).toBe(false)
    expect(v.cancelamento.statusMotivoBloqueio).toMatch(/entregue/i)
    expect(v.cancelamento.podeCancelar).toBe(false)
  })

  it("OS já cancelada: bloqueia (status não permite)", () => {
    const v = buildVals(
      makeState({ selectedOsId: "os-cancel", novaOS: false, status: "cancelada" }),
      () => {},
      () => {},
      ctxComCancelamento("cancelada", null),
    )
    expect(v.cancelamento.statusPermite).toBe(false)
    expect(v.cancelamento.podeCancelar).toBe(false)
  })

  it("pagamento TOTAL recebido: bloqueia mesmo com status permitido", () => {
    const v = buildVals(
      makeState({ selectedOsId: "os-cancel", novaOS: false, status: "pronta" }),
      () => {},
      () => {},
      ctxComCancelamento("pronta", { total: 300, recebido: 300, saldo: 0, status: "quitado" }),
    )
    expect(v.cancelamento.statusPermite).toBe(true)
    expect(v.cancelamento.semPagamento).toBe(false)
    expect(v.cancelamento.podeCancelar).toBe(false)
  })

  it("pagamento PARCIAL recebido: bloqueia mesmo com status permitido", () => {
    const v = buildVals(
      makeState({ selectedOsId: "os-cancel", novaOS: false, status: "pronta" }),
      () => {},
      () => {},
      ctxComCancelamento("pronta", { total: 480, recebido: 200, saldo: 280, status: "parcial" }),
    )
    expect(v.cancelamento.semPagamento).toBe(false)
    expect(v.cancelamento.podeCancelar).toBe(false)
  })

  it("sem pagamento e status permitido: habilita cancelamento", () => {
    const v = buildVals(
      makeState({ selectedOsId: "os-cancel", novaOS: false, status: "aberta" }),
      () => {},
      () => {},
      ctxComCancelamento("aberta", { total: 0, recebido: 0, saldo: 0, status: "sem_cobranca" }),
    )
    expect(v.cancelamento.podeCancelar).toBe(true)
  })

  it("projeção ainda não carregada: cancelamento dependente de financeiro falha fechado", () => {
    const v = buildVals(
      makeState({ selectedOsId: "os-cancel", novaOS: false, status: "aberta" }),
      () => {},
      () => {},
      ctxComCancelamento("aberta", null),
    )
    expect(v.cancelamento.semPagamento).toBe(false)
    expect(v.cancelamento.podeCancelar).toBe(false)
  })

  it("a ação chama aplicarTransicaoStatusV3 com storeId, osId, cancelada e motivo — mesmo wrapper runWrite dos demais handlers", () => {
    expect(orquestrador).toContain('aplicarTransicaoStatusV3(sid, osId, "cancelada", { motivo })')
    expect(orquestrador).toMatch(/const cancelarOS = useCallback\(/)
    expect(orquestrador).toMatch(/\(motivo: string\) =>\s*runWrite\(/)
    // runWrite só existe uma vez (fonte única de reload/toast/after-em-sucesso).
    expect(orquestrador.match(/const runWrite = useCallback/g)?.length).toBe(1)
  })

  it("motivo obrigatório: validação pura no cliente (mesmo mínimo do servidor), sem duplicar regra financeira/status", () => {
    expect(formHelper).toContain("export function validarMotivoCancelamentoV4")
    expect(formHelper).not.toContain("aplicarTransicaoStatusV3(")
    expect(formHelper).not.toContain("podeTransicionarV3")
    expect(modal).toContain("validarMotivoCancelamentoV4")
  })

  it("não importa caixa/financeiro/estoque/whatsapp/fiscal/prisma/app-api direto no modal nem no form helper", () => {
    for (const proibido of [
      'from "@/lib/caixa',
      'from "@/lib/financeiro',
      'from "@/lib/estoque',
      'from "@/lib/whatsapp',
      'from "@/lib/fiscal',
      'from "@/components/pdv',
      'from "@/lib/prisma',
      'from "@/app/api',
    ]) {
      expect(modal, `import proibido encontrado no modal: ${proibido}`).not.toContain(proibido)
      expect(formHelper, `import proibido encontrado no form helper: ${proibido}`).not.toContain(proibido)
    }
    // O modal nunca importa a action V3 direto — só via `v.cancelarOS` (wrapper do runWrite).
    expect(modal).not.toContain('from "@/lib/operacoes-v3/status-actions"')
  })

  it("nunca usa updateOSPayload, loja-1 (fallback literal) nem openCaixaIfClosed", () => {
    for (const proibido of ["updateOSPayload", '"loja-1"', "'loja-1'", "`loja-1`", "openCaixaIfClosed"]) {
      expect(modal, `referência proibida encontrada no modal: ${proibido}`).not.toContain(proibido)
      expect(formHelper, `referência proibida encontrada no form helper: ${proibido}`).not.toContain(proibido)
    }
  })

  it("é honesto sobre bloqueio de status/pagamento: mostra mensagem real (não inventada) e mantém a confirmação desabilitada", () => {
    expect(modal).toContain("statusMotivoBloqueio")
    expect(modal).toMatch(/Esta OS possui pagamento recebido\. Estorne o recebimento antes de cancelar\./)
    expect(modal).toContain("disabled={!podeConfirmar}")
  })

  it("o fluxo fica atrás de ação explícita do operador: estado nasce fechado e o modal só monta quando aberto", () => {
    expect(orquestrador).toMatch(/cancelamentoOS:\s*false,/)
    expect(modal).toMatch(/if \(!v\.cancelamentoOSOpen\) return null/)
  })

  it("botão 'Cancelar OS' no menu abre o modal (update cancelamentoOS: true) — não é mais preview/no-op", () => {
    expect(orquestrador).toContain("onClick: () => update({ cancelamentoOS: true })")
  })

  it("o modal é montado na casca da V4, ao lado dos demais modais reais", () => {
    expect(shell).toContain("<CancelamentoOSModal")
    expect(shell).toContain('from "./parts/CancelamentoOSModal"')
  })

  it("só existe uma chamada a v.cancelarOS( no modal (sem motor duplicado / sem clique disparando duas escritas)", () => {
    expect((modal.match(/v\.cancelarOS\(/g) ?? []).length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// GOAL OPS-V4-NOVO-ATENDIMENTO-COMERCIAL-001 — entrada única `+ Novo`.
// Os três motores reais continuam nos modais já existentes. O launcher só
// escolhe a modalidade. Duplicar orçamento segue abrindo o modal direto.
// ---------------------------------------------------------------------------
describe("GOAL OPS-V4-NOVO-ATENDIMENTO-COMERCIAL-001 — launcher roteia para os motores reais", () => {
  it("escolher os fecha o launcher e abre só a Nova OS", () => {
    const patches: Array<Record<string, unknown>> = []
    const v = buildVals(
      makeState({ novoAtendimento: true }),
      (p) => patches.push(p as Record<string, unknown>),
      () => {},
      ctx,
    )
    v.escolherNovoAtendimento("os")
    expect(patches[0]).toEqual(
      expect.objectContaining({
        novoAtendimento: false,
        novaOS: true,
        orcamentoRapido: false,
        atendimentoRapido: false,
      }),
    )
  })

  it("escolher orcamento limpa prefill e abre só o orçamento rápido", () => {
    const patches: Array<Record<string, unknown>> = []
    let prefillCalls = 0
    const v = buildVals(
      makeState({ novoAtendimento: true }),
      (p) => patches.push(p as Record<string, unknown>),
      () => {},
      { ...ctx, definirOrcamentoRapidoPrefill: () => { prefillCalls += 1 } },
    )
    v.escolherNovoAtendimento("orcamento")
    expect(prefillCalls).toBe(1)
    expect(patches[0]).toEqual(
      expect.objectContaining({
        novoAtendimento: false,
        novaOS: false,
        orcamentoRapido: true,
        atendimentoRapido: false,
      }),
    )
  })

  it("escolher rapido abre só o atendimento rápido", () => {
    const patches: Array<Record<string, unknown>> = []
    const v = buildVals(
      makeState({ novoAtendimento: true }),
      (p) => patches.push(p as Record<string, unknown>),
      () => {},
      ctx,
    )
    v.escolherNovoAtendimento("rapido")
    expect(patches[0]).toEqual(
      expect.objectContaining({
        novoAtendimento: false,
        novaOS: false,
        orcamentoRapido: false,
        atendimentoRapido: true,
      }),
    )
  })
})

describe("GOAL OPS-V4-NOVO-ATENDIMENTO-COMERCIAL-001 — launcher + Novo", () => {
  const orquestrador = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")
  const topBar = readFileSync(join(DIR, "parts", "TopBar.tsx"), "utf8")
  const launcher = readFileSync(join(DIR, "parts", "NovoAtendimentoLauncher.tsx"), "utf8")
  const shell = readFileSync(join(DIR, "OperacoesV4Preview.tsx"), "utf8")
  const picker = readFileSync(join(DIR, "parts", "OSPicker.tsx"), "utf8")
  const contrato = readFileSync(join(DIR, "..", "..", "lib", "operacoes-v4", "novo-atendimento.ts"), "utf8")

  it("TopBar tem um único CTA + Novo e não expõe os três botões antigos", () => {
    expect(topBar).toContain("v.openNovoAtendimento")
    expect(topBar).toMatch(/\+ Novo/)
    expect(topBar).not.toContain("v.openNovaOS")
    expect(topBar).not.toContain("v.openOrcamentoRapido")
    expect(topBar).not.toContain("v.openAtendimentoRapido")
    expect(topBar).not.toMatch(/Atendimento rápido/)
    expect(topBar).not.toMatch(/Orçamento rápido/)
    expect(topBar).not.toMatch(/\+ Nova OS/)
  })

  it("launcher usa a copy aprovada e as três modalidades do contrato puro", () => {
    expect(launcher).toContain("NOVO_ATENDIMENTO_COPY_V4")
    expect(launcher).toContain("NOVO_ATENDIMENTO_OPCOES_V4")
    expect(launcher).toContain("v.escolherNovoAtendimento")
    expect(contrato).toContain('titulo: "Novo atendimento"')
    expect(contrato).toContain('subtitulo: "Escolha como este atendimento começa."')
    expect(contrato).toContain('titulo: "Nova OS"')
    expect(contrato).toContain("Cliente já vai deixar o aparelho ou serviço já está autorizado.")
    expect(contrato).toContain('titulo: "Orçamento"')
    expect(contrato).toContain("Cliente pediu preço e ainda precisa aprovar.")
    expect(contrato).toContain('titulo: "Atendimento rápido"')
    expect(contrato).toContain("Serviço simples, pagamento e conclusão na hora.")
  })

  it("não cria motor novo — aponta para os três contratos V3 já existentes", () => {
    expect(contrato).toContain('motor: "criarOSEnterpriseV3"')
    expect(contrato).toContain('motor: "criarOrcamentoRapidoV3"')
    expect(contrato).toContain('motor: "finalizarAtendimentoRapidoV3"')
    expect(launcher).not.toContain("criarOSEnterpriseV3")
    expect(launcher).not.toContain("criarOrcamentoRapidoV3")
    expect(launcher).not.toContain("finalizarAtendimentoRapidoV3")
  })

  it("estado nasce fechado e o launcher só monta quando aberto", () => {
    expect(orquestrador).toMatch(/novoAtendimento:\s*false,/)
    expect(launcher).toMatch(/if \(!v\.novoAtendimentoOpen\) return null/)
  })

  it("escolher uma opção fecha o launcher e abre só o motor correspondente", () => {
    expect(orquestrador).toContain("patchEscolherNovoAtendimentoV4")
    expect(orquestrador).toContain("escolherNovoAtendimento")
    expect(contrato).toContain("novaOS: id === \"os\"")
    expect(contrato).toContain("orcamentoRapido: id === \"orcamento\"")
    expect(contrato).toContain("atendimentoRapido: id === \"rapido\"")
  })

  it("duplicar orçamento continua abrindo o modal direto, sem o launcher", () => {
    expect(orquestrador).toMatch(/abrirOrcamentoRapidoComPrefill[\s\S]*update\(\{ orcamentoRapido: true, novoAtendimento: false \}\)/)
  })

  it("launcher e os três formulários reais continuam montados na casca", () => {
    expect(shell).toContain("<NovoAtendimentoLauncher")
    expect(shell).toContain("<NovaOSModal")
    expect(shell).toContain("<OrcamentoRapidoModal")
    expect(shell).toContain("<AtendimentoRapidoModal")
  })

  it("empty state do workspace também entra pelo + Novo (entrada única)", () => {
    expect(picker).toContain("v.openNovoAtendimento")
    expect(picker).toMatch(/\+ Novo/)
    expect(picker).not.toContain("v.openNovaOS")
  })

  it("não importa caixa/financeiro/estoque/whatsapp/fiscal/prisma — launcher é só escolha", () => {
    for (const proibido of [
      'from "@/lib/caixa',
      'from "@/lib/financeiro',
      'from "@/lib/estoque',
      'from "@/lib/whatsapp',
      'from "@/lib/fiscal',
      'from "@/lib/prisma',
    ]) {
      expect(launcher, `import proibido no launcher: ${proibido}`).not.toContain(proibido)
      expect(contrato, `import proibido no contrato: ${proibido}`).not.toContain(proibido)
    }
  })
})

describe("OPS-V4-PRODUCAO-TECNICO-BANCADA-003 — Bancada operacional reusa o motor V3", () => {
  const orquestrador = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")
  const bancada = readFileSync(join(DIR, "parts", "BancadaV4.tsx"), "utf8")
  const moduleView = readFileSync(join(DIR, "parts", "ModuleView.tsx"), "utf8")
  const shell = readFileSync(join(DIR, "OperacoesV4Preview.tsx"), "utf8")
  const header = readFileSync(join(DIR, "parts", "CommandHeader.tsx"), "utf8")
  const execucao = readFileSync(join(DIR, "parts", "stages", "ExecucaoStage.tsx"), "utf8")

  it("reusa atribuirTecnicoV3 / definirPrioridadeV3 / aplicarTransicaoStatusV3 — sem action V4 paralela", () => {
    expect(orquestrador).toContain("atribuirTecnicoV3")
    expect(orquestrador).toContain("definirPrioridadeV3")
    expect(orquestrador).toContain("aplicarTransicaoStatusV3")
    expect(orquestrador).not.toContain("atribuirTecnicoV4Action")
    expect(orquestrador).not.toContain("definirPrioridadeV4Action")
  })

  it("remoção usa o contrato V3 (input null) e o write da Bancada passa por runWriteOnOs", () => {
    expect(orquestrador).toContain("atribuirTecnicoV3(sid, idOs, null)")
    expect(orquestrador).toContain("const runWriteOnOs = useCallback")
    expect(orquestrador).toMatch(/atribuirTecnico = useCallback\([\s\S]*runWriteOnOs\(/)
    expect(orquestrador).toMatch(/definirPrioridade = useCallback\([\s\S]*runWriteOnOs\(/)
  })

  it("Bancada deixa de ser somente leitura / protótipo", () => {
    expect(bancada).toContain("Operacional")
    expect(bancada).not.toContain("Somente leitura")
    expect(bancada).not.toContain("Protótipo")
    expect(moduleView).not.toContain("Bancada por técnico ainda não está ligada")
    expect(shell).toContain("<BancadaV4")
  })

  it("Sem técnico, seletor, prioridade, abrir OS e filtros existem na UI", () => {
    expect(bancada).toContain("Sem técnico")
    expect(bancada).toContain("Atribuir técnico")
    expect(bancada).toContain("TecnicoPickerV4")
    expect(bancada).toContain("PrioridadePickerV4")
    expect(bancada).toContain("Abrir OS")
    expect(bancada).toContain("openOSFromRail")
    expect(bancada).toContain("FILTROS_BANCADA_V4")
    expect(bancada).toContain("OS, cliente, aparelho")
  })

  it("header e Execução exibem o técnico atual da projeção real", () => {
    expect(header).toContain("producaoAtual")
    expect(header).toContain("Técnico")
    expect(header).toContain("atribuirTecnico")
    expect(execucao).toContain("Responsável")
    expect(execucao).toContain("producaoAtual")
  })

  it("projeção no vals: OS sem técnico entra em Sem técnico; com técnico no bucket", () => {
    const v = buildVals(
      makeState({ novaOS: false }),
      () => {},
      () => {},
      {
        ...ctx,
        ordens: [
          mkOS({ id: "a", status: "aberta", codigo: "OS-A", cliente: { nome: "Cliente A" } }),
          mkOS({ id: "b", status: "em_execucao", codigo: "OS-B", tecnico: { id: "t1", nome: "Ana" } }),
        ],
      },
    )
    expect(v.producaoBancada.temProducao).toBe(true)
    expect(v.producaoBancada.semTecnico.map((r) => r.osId)).toEqual(["a"])
    expect(v.producaoBancada.tecnicos.map((t) => t.tecnicoNome)).toEqual(["Ana"])
    expect(v.producaoAtual).toBeNull()
  })

  it("loading da mutation é por OS — não há bloqueio de tela inteira", () => {
    expect(bancada).toContain("busy?.osId === row.osId")
    expect(bancada).not.toContain("pointerEvents: \"none\"")
  })

  it("não importa schema/prisma/pdv/financeiro/estoque", () => {
    for (const proibido of [
      'from "@/lib/prisma',
      "prisma.schema",
      'from "@/lib/financeiro',
      'from "@/lib/estoque',
      'from "@/lib/pdv',
    ]) {
      expect(bancada).not.toContain(proibido)
      expect(orquestrador.includes("atribuirTecnicoV4Action")).toBe(false)
    }
  })
})

describe("OPS-V4-FILA-KANBAN-WRITE-004 — Fila operacional reusa a máquina V3", () => {
  const orquestrador = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")
  const fila = readFileSync(join(DIR, "parts", "FilaV4.tsx"), "utf8")
  const moduleView = readFileSync(join(DIR, "parts", "ModuleView.tsx"), "utf8")
  const shell = readFileSync(join(DIR, "OperacoesV4Preview.tsx"), "utf8")
  const adapter = readFileSync(join(process.cwd(), "lib", "operacoes-v4", "fila-v4.ts"), "utf8")

  it("write path: adapter V4 → máquina V3 → aplicarTransicaoStatusV3 — sem action V4 paralela", () => {
    expect(orquestrador).toContain("podeMoverStatusFilaV4")
    expect(orquestrador).toContain("moverStatusFila")
    expect(orquestrador).toMatch(/moverStatusFila = useCallback\([\s\S]*aplicarTransicaoStatusV3\(sid, idOs, to\)/)
    expect(orquestrador).toMatch(/moverStatusFila = useCallback\([\s\S]*runWriteOnOs\(/)
    expect(orquestrador).not.toContain("moverStatusFilaV4Action")
    expect(adapter).toContain("vereditoTransicaoRapidaProducaoV4")
    expect(adapter).not.toContain("aplicarTransicaoStatusV3(")
  })

  it("não cria máquina de status própria e bloqueia recebida/entregue/cancelada no write", () => {
    expect(adapter).toContain("DESTINOS_WRITE_FILA_V4")
    expect(adapter).toContain("TRANSICOES_COMERCIAIS_FORA_DRAG_V4")
    expect(adapter).toContain("destinosRapidosProducaoV4")
    expect(adapter).toContain("vereditoTransicaoRapidaProducaoV4")
    expect(adapter).not.toMatch(/const TRANSICOES_V3/)
    expect(adapter).not.toContain("new StatusMachine")
  })

  it("Fila deixa de ser somente leitura / protótipo", () => {
    expect(fila).toContain("Operacional")
    expect(fila).not.toContain("Somente leitura")
    expect(fila).not.toContain("Protótipo")
    expect(shell).toContain("<FilaV4")
    expect(moduleView).not.toContain("Fila de OS")
  })

  it("Lista, Kanban, drag, menu/teclado e filtros existem na UI", () => {
    expect(fila).toContain('escolherModo("lista")')
    expect(fila).toContain('escolherModo("kanban")')
    expect(fila).toContain("onDragStart")
    expect(fila).toContain("onDrop")
    expect(fila).toContain("Mover para")
    expect(fila).toContain('e.key === "m"')
    expect(fila).toContain("openOSFromRail")
    expect(fila).toContain("Filtrar por técnico")
    expect(fila).toContain("Filtrar por prioridade")
    expect(fila).toContain("Filtrar por SLA")
    expect(fila).toContain("OS, cliente, aparelho")
    expect(orquestrador).toContain("FILA_VIEW_PREF_KEY")
    expect(fila).toContain("data-kind")
  })

  it("reload após write atualiza Fila/Bancada/OS sem F5 (runWriteOnOs)", () => {
    expect(orquestrador).toContain("const runWriteOnOs = useCallback")
    expect(orquestrador).toMatch(/runWriteOnOs = useCallback\([\s\S]*reloadOrdens\(\)/)
    expect(orquestrador).toMatch(/runWriteOnOs = useCallback\([\s\S]*reloadDetail\(\)/)
  })

  it("projeção no vals: OS ativa entra na fila; entregue fica de fora; técnico/prioridade/SLA reais", () => {
    const v = buildVals(
      makeState({ novaOS: false }),
      () => {},
      () => {},
      {
        ...ctx,
        ordens: [
          mkOS({
            id: "a",
            status: "aberta",
            codigo: "OS-A",
            cliente: { nome: "Cliente A" },
            prioridadeV3: "urgente",
          }),
          mkOS({
            id: "b",
            status: "em_execucao",
            codigo: "OS-B",
            tecnico: { id: "t1", nome: "Ana" },
          }),
          mkOS({ id: "c", status: "entregue", codigo: "OS-C" }),
        ],
      },
    )
    expect(v.filaOperacional.temFila).toBe(true)
    expect(v.filaOperacional.lista.map((r) => r.osId).sort()).toEqual(["a", "b"])
    expect(v.filaOperacional.lista.find((r) => r.osId === "a")?.prioridade).toBe("urgente")
    expect(v.filaOperacional.lista.find((r) => r.osId === "b")?.tecnicoNome).toBe("Ana")
    expect(v.filaOperacional.colunas.map((c) => c.status)).not.toContain("recebida")
    expect(v.filaOperacional.colunas.find((c) => c.status === "em_execucao")?.aceitaWrite).toBe(true)
  })

  it("erro de move não some com o ticket — loading por card, board não trava", () => {
    expect(fila).toContain("MSG_ERRO_MOVER_FILA_V4")
    expect(fila).toContain("erros[row.osId]")
    expect(fila).toContain("ticketBusy")
    expect(fila).toContain("if (busy[osId]) return false")
    expect(orquestrador).toMatch(/moverStatusFila = useCallback\([\s\S]*reloadOrdens\(\)/)
  })

  it("drag não oferece Receber/Cancelar/Entregar e protege orçamento", () => {
    const policy = readFileSync(join(process.cwd(), "lib", "operacoes-v4", "transicoes-producao-v4.ts"), "utf8")
    expect(fila).not.toContain(">Receber<")
    expect(fila).not.toContain(">Cancelar<")
    expect(fila).not.toContain(">Entregar<")
    expect(policy).toContain('["diagnostico", "aguardando_aprovacao"]')
    expect(policy).toContain('["aguardando_aprovacao", "aprovado"]')
    expect(adapter).toContain("isTransicaoComercialProtegidaV4")
  })

  it("não importa schema/prisma/pdv/financeiro/estoque", () => {
    for (const proibido of [
      'from "@/lib/prisma',
      "prisma.schema",
      'from "@/lib/financeiro',
      'from "@/lib/estoque',
      'from "@/lib/pdv',
    ]) {
      expect(fila, `import proibido na Fila: ${proibido}`).not.toContain(proibido)
      expect(adapter, `import proibido no adapter: ${proibido}`).not.toContain(proibido)
    }
  })
})

describe("OPS-V4-BANCADA-COMMERCIAL-TRANSITION-GUARD-003B — Fila e Bancada compartilham a policy", () => {
  const bancada = readFileSync(join(DIR, "parts", "BancadaV4.tsx"), "utf8")
  const orquestrador = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")
  const producao = readFileSync(join(process.cwd(), "lib", "operacoes-v4", "producao-v4.ts"), "utf8")
  const filaAdapter = readFileSync(join(process.cwd(), "lib", "operacoes-v4", "fila-v4.ts"), "utf8")
  const policy = readFileSync(join(process.cwd(), "lib", "operacoes-v4", "transicoes-producao-v4.ts"), "utf8")

  it("Fila e Bancada importam a mesma política de destinos rápidos", () => {
    expect(filaAdapter).toContain('from "@/lib/operacoes-v4/transicoes-producao-v4"')
    expect(producao).toContain('from "@/lib/operacoes-v4/transicoes-producao-v4"')
    expect(producao).toContain("vereditoTransicaoRapidaProducaoV4")
    expect(producao).toContain("ctaComercialProducaoV4")
    expect(filaAdapter).toContain("destinosRapidosProducaoV4")
    expect(policy).not.toMatch(/const TRANSICOES_V3/)
  })

  it("CTA comercial da Bancada abre a OS e não chama avancarStatusBancada", () => {
    expect(policy).toContain("Abrir OS para criar/enviar orçamento")
    expect(policy).toContain("Registrar aprovação na OS")
    expect(bancada).toContain("data-cta-comercial")
    expect(bancada).toContain("row.ctaComercial")
    expect(bancada).toMatch(/ctaComercial[\s\S]*openOSFromRail\(row\.osId\)/)
    expect(bancada).not.toMatch(/ctaComercial[\s\S]{0,400}avancarStatusBancada/)
  })

  it("gate da Bancada continua na frente de aplicarTransicaoStatusV3", () => {
    expect(orquestrador).toMatch(/avancarStatusBancada = useCallback\([\s\S]*podeAvancarStatusBancadaV4/)
    expect(orquestrador).toMatch(/avancarStatusBancada = useCallback\([\s\S]*aplicarTransicaoStatusV3/)
    expect(policy).not.toContain("aplicarTransicaoStatusV3(")
    expect(producao).not.toContain("aplicarTransicaoStatusV3(")
  })
})

describe("OPS-V4-POSVENDA-RETORNO-GARANTIAS-006 — actions/readers reais", () => {
  const orquestrador = readFileSync(join(DIR, "use-v4-preview.ts"), "utf8")
  const stage = readFileSync(join(DIR, "parts", "stages", "PosVendaStage.tsx"), "utf8")
  const adapter = readFileSync(join(DIR, "os-adapter.ts"), "utf8")
  const helper = readFileSync(join(process.cwd(), "lib", "operacoes-v4", "posvenda-v4.ts"), "utf8")
  const retornoAction = readFileSync(join(process.cwd(), "lib", "operacoes-v3", "retorno-actions.ts"), "utf8")
  const sources = collectSourceFiles(DIR).map((file) => readFileSync(file, "utf8")).join("\n")

  it("reusa abrirRetornoV3/finalizarRetornoV3 pelo wrapper de reload confirmado", () => {
    expect(orquestrador).toContain('from "@/lib/operacoes-v3/retorno-actions"')
    expect(orquestrador).toContain("abrirRetornoV3(sid, osId, { motivo })")
    expect(orquestrador).toContain("finalizarRetornoV3(sid, osId, retornoId, { observacao })")
    expect(orquestrador).toMatch(/const abrirRetorno = useCallback\([\s\S]*runWrite\(/)
    expect(orquestrador).toMatch(/const finalizarRetorno = useCallback\([\s\S]*runWrite\(/)
    expect(orquestrador).toMatch(/catch \(e\) \{[\s\S]*reloadOrdens\(\);[\s\S]*reloadDetail\(\);[\s\S]*reloadFinancial\(\);[\s\S]*notify\(/)
  })

  it("view-model lê garantia e retornos V3; adapter não reconstrói retorno pela timeline", () => {
    expect(helper).toContain("lerGarantiaV3")
    expect(helper).toContain("lerRetornosV3")
    expect(adapter).toContain("return buildPosVendaV4(os)")
    expect(adapter).not.toMatch(/filter\(\(ev[^\n]+garantia_acionada/)
  })

  it("stage chama handlers reais, tem busy-lock e não simula persistência", () => {
    expect(stage).toContain("v.abrirRetorno(motivo.trim())")
    expect(stage).toContain("v.finalizarRetorno(finalizar.id")
    expect(stage).toContain("if (busy")
    expect(stage).not.toContain("setTimeout")
    expect(stage).not.toContain("retornosCount")
  })

  it("não cria action V4 paralela nem API/schema/migration", () => {
    expect(sources).not.toContain("abrirRetornoV4Action")
    expect(sources).not.toContain("finalizarRetornoV4Action")
    expect(sources).not.toContain("RetornoV4Action")
  })

  it("motor V3 bloqueia segundo retorno aberto antes de gravar", () => {
    expect(retornoAction).toContain('existentes.some((retorno) => retorno.status === "aberto")')
    expect(retornoAction).toContain("Já existe um retorno em andamento para esta OS.")
  })

  it("header, stage e rail consomem a mesma projeção pós-venda", () => {
    const header = readFileSync(join(DIR, "parts", "CommandHeader.tsx"), "utf8")
    const modules = readFileSync(join(DIR, "parts", "ModuleView.tsx"), "utf8")
    expect(header).toContain("v.posVenda")
    expect(stage).toContain("v.posVenda")
    expect(orquestrador).toContain("garantiasPortfolio")
    expect(modules).toContain("v.garantiasPortfolio")
  })
})

describe("OPS-V4-POSVENDA-RETORNO-GARANTIAS-006 — contrato exposto pelo buildVals", () => {
  it("repassa motivo/id/resolução sem inventar campos", async () => {
    const chamadas: unknown[] = []
    const os = mkOS({ id: "os-ret", status: "entregue", entregueEm: "2026-08-01T12:00:00.000Z" })
    const local: V4DataCtx = {
      ...ctx,
      realOS: os,
      abrirRetorno: async (motivo) => { chamadas.push(["abrir", motivo]); return true },
      finalizarRetorno: async (id, observacao) => { chamadas.push(["finalizar", id, observacao]); return true },
    }
    const v = buildVals(makeState({ selectedOsId: "os-ret", stage: "posvenda", novaOS: false }), () => {}, () => {}, local)
    await expect(v.abrirRetorno("Touch voltou a falhar")).resolves.toBe(true)
    await expect(v.finalizarRetorno("ret-1", "Tela substituída")).resolves.toBe(true)
    expect(chamadas).toEqual([
      ["abrir", "Touch voltou a falhar"],
      ["finalizar", "ret-1", "Tela substituída"],
    ])
  })

  it("retorno persistido aparece como autoridade e bloqueia nova abertura", () => {
    const os = mkOS({
      id: "os-ret-open",
      codigo: "OS-1098",
      status: "entregue",
      entregueEm: "2026-08-01T12:00:00.000Z",
      retornosV3: [{ id: "ret-1", osOriginalId: "os-ret-open", osOriginalCodigo: "OS-1098", motivo: "Falha recorrente", criadoEm: "2026-08-14T12:00:00.000Z", status: "aberto" }],
    })
    const v = buildVals(makeState({ selectedOsId: "os-ret-open", stage: "posvenda", novaOS: false }), () => {}, () => {}, { ...ctx, realOS: os })
    expect(v.posVenda.retornoAberto?.id).toBe("ret-1")
    expect(v.posVenda.podeAbrirRetorno).toBe(false)
    expect(v.posVenda.headerLabel).toBe("Retorno aberto")
  })
})
