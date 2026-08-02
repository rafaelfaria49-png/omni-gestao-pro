import { describe, expect, it, vi } from "vitest"
import {
  activeCaixaSessionUrl,
  applyCaixaSessionDecision,
  createSingleFlight,
  decideAberturaCaixa,
  decideCaixaSessionSync,
  fetchActiveCaixaSession,
  isCaixaReferenceStale,
  isCaixaSessionRejectionCode,
  reconcileCaixaSession,
  type CaixaSessionApplicable,
  type ServerCaixaSession,
} from "@/lib/pdv-caixa-session"

const STORE = "loja-1"
const OUTRA_LOJA = "loja-2"

function serverSession(over: Partial<ServerCaixaSession> = {}): ServerCaixaSession {
  return {
    id: "sess-servidor",
    storeId: STORE,
    saldoInicial: 200,
    abertaEm: "2026-08-02T12:00:00.000Z",
    ...over,
  }
}

/** `fetch` que devolve a lista de sessões do endpoint real. */
function fetchComSessoes(sessoes: unknown[]) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ sessoes }), { status: 200 }),
  ) as unknown as typeof fetch
}

function fetchComStatus(status: number) {
  return vi.fn(async () => new Response("", { status })) as unknown as typeof fetch
}

function fetchQueCai() {
  return vi.fn(async () => {
    throw new TypeError("Failed to fetch")
  }) as unknown as typeof fetch
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. As quatro combinações servidor × cliente
// ─────────────────────────────────────────────────────────────────────────────

describe("decideCaixaSessionSync — as quatro combinações servidor/cliente", () => {
  it("caso 1: servidor ABERTO + cliente FECHADO ⇒ adota a sessão do servidor", () => {
    const d = decideCaixaSessionSync({
      storeId: STORE,
      local: { isOpen: false, sessaoId: null },
      server: serverSession(),
    })
    expect(d).toEqual({
      action: "adopt",
      reason: "local-fechado",
      sessaoId: "sess-servidor",
      saldoInicial: 200,
      abertaEm: "2026-08-02T12:00:00.000Z",
      replaced: null,
    })
  })

  it("caso 2: servidor SEM sessão + cliente ABERTO ⇒ fecha o estado local", () => {
    const d = decideCaixaSessionSync({
      storeId: STORE,
      local: { isOpen: true, sessaoId: "sess-fantasma" },
      server: null,
    })
    expect(d).toEqual({ action: "close", reason: "servidor-sem-sessao-aberta" })
  })

  it("caso 3: servidor ABERTO + cliente ABERTO sem sessaoId ⇒ adota (referência ausente)", () => {
    const d = decideCaixaSessionSync({
      storeId: STORE,
      local: { isOpen: true, sessaoId: null },
      server: serverSession(),
    })
    expect(d).toMatchObject({
      action: "adopt",
      reason: "referencia-ausente",
      sessaoId: "sess-servidor",
      replaced: null,
    })
  })

  it("caso 4: servidor ABERTO + cliente ABERTO com sessaoId obsoleto ⇒ substitui", () => {
    const d = decideCaixaSessionSync({
      storeId: STORE,
      local: { isOpen: true, sessaoId: "sess-antiga" },
      server: serverSession(),
    })
    expect(d).toMatchObject({
      action: "adopt",
      reason: "referencia-obsoleta",
      sessaoId: "sess-servidor",
      replaced: "sess-antiga",
    })
  })

  it("sessaoId só de espaços é tratado como ausente, não como obsoleto", () => {
    const d = decideCaixaSessionSync({
      storeId: STORE,
      local: { isOpen: true, sessaoId: "   " },
      server: serverSession(),
    })
    expect(d).toMatchObject({ action: "adopt", reason: "referencia-ausente" })
  })

  it("em sincronia ⇒ mantém (nada a fazer)", () => {
    const d = decideCaixaSessionSync({
      storeId: STORE,
      local: { isOpen: true, sessaoId: "sess-servidor" },
      server: serverSession(),
    })
    expect(d).toEqual({ action: "keep", reason: "em-sincronia" })
  })

  it("fechado nas duas pontas ⇒ mantém", () => {
    const d = decideCaixaSessionSync({
      storeId: STORE,
      local: { isOpen: false, sessaoId: null },
      server: null,
    })
    expect(d).toEqual({ action: "keep", reason: "sem-sessao-em-ambos" })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Hidratação (regressão A0)
// ─────────────────────────────────────────────────────────────────────────────

describe("hidratação — nada é decidido antes do estado persistido ser restaurado (A0)", () => {
  it("não consulta o servidor enquanto não hidratado", async () => {
    const fetchImpl = fetchComSessoes([serverSession()])
    const r = await reconcileCaixaSession({
      storeId: STORE,
      local: { isOpen: false, sessaoId: null },
      fetchImpl,
      hydrated: false,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(r.decision).toBeNull()
    expect(r.outcome).toEqual({ ok: false, status: "falha", reason: "nao-hidratado" })
  })

  it("não adota sessão antes da hidratação, mesmo com caixa aberto no servidor", async () => {
    const r = await reconcileCaixaSession({
      storeId: STORE,
      local: { isOpen: false, sessaoId: null },
      fetchImpl: fetchComSessoes([serverSession()]),
      hydrated: false,
    })
    expect(r.decision).toBeNull()
  })

  it("não fecha o caixa local antes da hidratação, mesmo sem sessão no servidor", async () => {
    const r = await reconcileCaixaSession({
      storeId: STORE,
      local: { isOpen: true, sessaoId: "sess-local" },
      fetchImpl: fetchComSessoes([]),
      hydrated: false,
    })
    expect(r.decision).toBeNull()
  })

  it("saldo local NÃO é sobrescrito antes da hidratação (experimento H1 da readiness)", async () => {
    // O estado PADRÃO do provider é "fechado, saldo 0"; o persistido é 111 com a
    // MESMA sessão do servidor, que traz 999. Decidir sobre o padrão adotaria 999.
    const persistido = estadoCliente({ isOpen: true, saldoInicial: 111, sessaoId: "sess-igual" })
    const padrao = estadoCliente({ isOpen: false, saldoInicial: 0, sessaoId: null })
    const servidor = [serverSession({ id: "sess-igual", saldoInicial: 999 })]

    const antesDaHidratacao = await reconcileCaixaSession({
      storeId: STORE,
      local: { isOpen: padrao.caixa.isOpen, sessaoId: padrao.caixaSessaoId },
      fetchImpl: fetchComSessoes(servidor),
      hydrated: false,
    })
    expect(antesDaHidratacao.decision).toBeNull()
    // Sem decisão não há o que aplicar: o saldo persistido sobrevive.
    expect(persistido.caixa.saldoInicial).toBe(111)

    // Depois de hidratado, a mesma consulta enxerga o estado real e conclui
    // "em-sincronia" — o saldo continua 111, não vira 999.
    const depois = await reconcileCaixaSession({
      storeId: STORE,
      local: { isOpen: persistido.caixa.isOpen, sessaoId: persistido.caixaSessaoId },
      fetchImpl: fetchComSessoes(servidor),
      hydrated: true,
    })
    expect(depois.decision).toEqual({ action: "keep", reason: "em-sincronia" })
    const aplicado = applyCaixaSessionDecision(persistido, depois.decision!)
    expect(aplicado.caixa.saldoInicial).toBe(111)
    expect(aplicado).toBe(persistido)
  })

  it("corrida: a MESMA entrada decide 'close' depois de hidratada e nada antes", async () => {
    const local = { isOpen: true, sessaoId: "sess-fantasma" }
    const semHidratar = await reconcileCaixaSession({
      storeId: STORE,
      local,
      fetchImpl: fetchComSessoes([]),
      hydrated: false,
    })
    const hidratado = await reconcileCaixaSession({
      storeId: STORE,
      local,
      fetchImpl: fetchComSessoes([]),
      hydrated: true,
    })
    expect(semHidratar.decision).toBeNull()
    expect(hidratado.decision).toEqual({ action: "close", reason: "servidor-sem-sessao-aberta" })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Erros de consulta nunca fecham o caixa
// ─────────────────────────────────────────────────────────────────────────────

describe("erros de consulta — nunca fecham o caixa local", () => {
  it("rede offline ⇒ sem decisão, falha recuperável", async () => {
    const r = await reconcileCaixaSession({
      storeId: STORE,
      local: { isOpen: true, sessaoId: "sess-local" },
      fetchImpl: fetchQueCai(),
      hydrated: true,
    })
    expect(r.decision).toBeNull()
    expect(r.outcome).toEqual({ ok: false, status: "falha", reason: "rede" })
  })

  it.each([401, 403, 500])("HTTP %i ⇒ sem decisão (caixa aberto permanece aberto)", async (status) => {
    const r = await reconcileCaixaSession({
      storeId: STORE,
      local: { isOpen: true, sessaoId: "sess-local" },
      fetchImpl: fetchComStatus(status),
      hydrated: true,
    })
    expect(r.decision).toBeNull()
    expect(r.outcome).toEqual({ ok: false, status: "falha", reason: "http" })
  })

  it("resposta sem o array `sessoes` ⇒ resposta-invalida, sem decisão", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ inesperado: true }), { status: 200 }),
    ) as unknown as typeof fetch
    const r = await reconcileCaixaSession({
      storeId: STORE,
      local: { isOpen: true, sessaoId: "sess-local" },
      fetchImpl,
      hydrated: true,
    })
    expect(r.decision).toBeNull()
    expect(r.outcome).toEqual({ ok: false, status: "falha", reason: "resposta-invalida" })
  })

  it("JSON quebrado ⇒ resposta-invalida, sem decisão", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("{isso não é json", { status: 200 }),
    ) as unknown as typeof fetch
    const r = await reconcileCaixaSession({
      storeId: STORE,
      local: { isOpen: true, sessaoId: "sess-local" },
      fetchImpl,
      hydrated: true,
    })
    expect(r.decision).toBeNull()
  })

  it("aplicar uma falha é impossível: `decision` nulo não altera estado nenhum", async () => {
    const prev = estadoCliente({ isOpen: true, saldoInicial: 300, sessaoId: "sess-local" })
    const r = await reconcileCaixaSession({
      storeId: STORE,
      local: { isOpen: true, sessaoId: "sess-local" },
      fetchImpl: fetchQueCai(),
      hydrated: true,
    })
    expect(r.decision).toBeNull()
    expect(prev.caixa.isOpen).toBe(true)
    expect(prev.caixa.saldoInicial).toBe(300)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Multi-loja
// ─────────────────────────────────────────────────────────────────────────────

describe("multi-loja — sessão de outra loja nunca é adotada", () => {
  it("sessão de outra loja ⇒ keep, sem adotar e sem fechar", () => {
    const d = decideCaixaSessionSync({
      storeId: STORE,
      local: { isOpen: true, sessaoId: "sess-local" },
      server: serverSession({ id: "sess-da-loja-2", storeId: OUTRA_LOJA }),
    })
    expect(d).toEqual({ action: "keep", reason: "sessao-de-outra-loja" })
  })

  it("sessão de outra loja não fecha o caixa nem quando o local está fechado", () => {
    const d = decideCaixaSessionSync({
      storeId: STORE,
      local: { isOpen: false, sessaoId: null },
      server: serverSession({ storeId: OUTRA_LOJA }),
    })
    expect(d.action).toBe("keep")
  })

  it("reconcile devolve status `outra-loja` e o estado fica intacto", async () => {
    const prev = estadoCliente({ isOpen: true, saldoInicial: 50, sessaoId: "sess-local" })
    const r = await reconcileCaixaSession({
      storeId: STORE,
      local: { isOpen: true, sessaoId: "sess-local" },
      fetchImpl: fetchComSessoes([serverSession({ id: "sess-alheia", storeId: OUTRA_LOJA })]),
      hydrated: true,
    })
    expect(r.outcome).toEqual({ ok: true, status: "outra-loja" })
    expect(applyCaixaSessionDecision(prev, r.decision!)).toBe(prev)
  })

  it("a consulta carrega o storeId na URL e no header", async () => {
    const fetchImpl = fetchComSessoes([])
    await fetchActiveCaixaSession(OUTRA_LOJA, fetchImpl)
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe(activeCaixaSessionUrl(OUTRA_LOJA))
    expect(url).toContain(`lojaId=${OUTRA_LOJA}`)
    expect((init as RequestInit).headers).toMatchObject({ "x-assistec-loja-id": OUTRA_LOJA })
  })

  it("troca de loja com request pendente: a resposta da loja antiga não vale para a nova", async () => {
    // Espelha a guarda do provider: a decisão só é aplicada se o storeId ativo
    // no momento da resposta ainda for o storeId consultado.
    let lojaAtiva = STORE
    const emVoo = reconcileCaixaSession({
      storeId: STORE,
      local: { isOpen: false, sessaoId: null },
      fetchImpl: fetchComSessoes([serverSession({ id: "sess-da-loja-1" })]),
      hydrated: true,
    })
    lojaAtiva = OUTRA_LOJA // operador troca de loja antes da resposta chegar
    const r = await emVoo

    expect(r.decision).toMatchObject({ action: "adopt", sessaoId: "sess-da-loja-1" })
    const podeAplicar = lojaAtiva === STORE
    expect(podeAplicar).toBe(false)

    const prev = estadoCliente({ isOpen: false, saldoInicial: 0, sessaoId: null })
    const proximo = podeAplicar ? applyCaixaSessionDecision(prev, r.decision!) : prev
    expect(proximo.caixaSessaoId).toBeNull()
    expect(proximo.caixa.isOpen).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Single-flight
// ─────────────────────────────────────────────────────────────────────────────

describe("single-flight — duas atualizações simultâneas", () => {
  it("duas chamadas concorrentes compartilham UMA consulta", async () => {
    const single = createSingleFlight<string>()
    const task = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10))
      return "pronto"
    })
    const [a, b] = await Promise.all([single(task), single(task)])
    expect(task).toHaveBeenCalledTimes(1)
    expect(a).toBe("pronto")
    expect(b).toBe("pronto")
  })

  it("uma nova chamada DEPOIS de concluída dispara nova consulta", async () => {
    const single = createSingleFlight<number>()
    const task = vi.fn(async () => 1)
    await single(task)
    await single(task)
    expect(task).toHaveBeenCalledTimes(2)
  })

  it("falha não deixa a porta trancada", async () => {
    const single = createSingleFlight<number>()
    const ruim = vi.fn(async () => {
      throw new Error("falhou")
    })
    await expect(single(ruim)).rejects.toThrow("falhou")
    const bom = vi.fn(async () => 7)
    await expect(single(bom)).resolves.toBe(7)
  })

  it("duas reconciliações simultâneas fazem UM fetch e devolvem o mesmo desfecho", async () => {
    const fetchImpl = fetchComSessoes([serverSession()])
    const single = createSingleFlight<Awaited<ReturnType<typeof reconcileCaixaSession>>>()
    const run = () =>
      single(() =>
        reconcileCaixaSession({
          storeId: STORE,
          local: { isOpen: false, sessaoId: null },
          fetchImpl,
          hydrated: true,
        }),
      )
    const [r1, r2] = await Promise.all([run(), run()])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(r1).toBe(r2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. Fila de vendas pendentes intacta
// ─────────────────────────────────────────────────────────────────────────────

type EstadoComVendas = CaixaSessionApplicable & {
  sales: Array<{ id: string; pedidoId: string; syncPending: boolean }>
  devolucoes: Array<{ id: string }>
  pendingCaixaOperations: Array<{ id: string; syncPending: boolean }>
}

function estadoCliente(over: {
  isOpen: boolean
  saldoInicial: number
  sessaoId: string | null
}): EstadoComVendas {
  return {
    caixa: {
      isOpen: over.isOpen,
      saldoInicial: over.saldoInicial,
      dataAbertura: over.isOpen ? new Date("2026-08-01T09:00:00.000Z") : null,
      totalEntradas: 40,
      totalSaidas: 15,
    },
    caixaSessaoId: over.sessaoId,
    sales: [
      { id: "VDA-2026-1", pedidoId: "VDA-2026-1", syncPending: true },
      { id: "VDA-2026-2", pedidoId: "VDA-2026-2", syncPending: true },
    ],
    devolucoes: [{ id: "DEV-1" }],
    pendingCaixaOperations: [{ id: "OP-1", syncPending: true }],
  }
}

describe("pendências de sincronização — reconciliar caixa não toca na fila de vendas", () => {
  it("ADOÇÃO preserva a fila de vendas por REFERÊNCIA (mesmo array, mesmos pedidoId)", () => {
    const prev = estadoCliente({ isOpen: true, saldoInicial: 111, sessaoId: null })
    const filaAntes = prev.sales
    const next = applyCaixaSessionDecision(prev, {
      action: "adopt",
      reason: "referencia-ausente",
      sessaoId: "sess-servidor",
      saldoInicial: 200,
      abertaEm: "2026-08-02T12:00:00.000Z",
      replaced: null,
    })

    expect(next.sales).toBe(filaAntes)
    expect(next.sales.map((s) => s.pedidoId)).toEqual(["VDA-2026-1", "VDA-2026-2"])
    expect(next.sales.every((s) => s.syncPending)).toBe(true)
    expect(next.devolucoes).toBe(prev.devolucoes)
    expect(next.pendingCaixaOperations).toBe(prev.pendingCaixaOperations)
    // e o que DEVE mudar, mudou:
    expect(next.caixaSessaoId).toBe("sess-servidor")
    expect(next.caixa.isOpen).toBe(true)
  })

  it("FECHAMENTO preserva a fila de vendas pendentes (não descarta a venda offline)", () => {
    const prev = estadoCliente({ isOpen: true, saldoInicial: 111, sessaoId: "sess-fantasma" })
    const next = applyCaixaSessionDecision(prev, {
      action: "close",
      reason: "servidor-sem-sessao-aberta",
    })

    expect(next.sales).toBe(prev.sales)
    expect(next.sales).toHaveLength(2)
    expect(next.pendingCaixaOperations).toBe(prev.pendingCaixaOperations)
    // sessão inválida é limpa, caixa fecha
    expect(next.caixaSessaoId).toBeNull()
    expect(next.caixa.isOpen).toBe(false)
    expect(next.caixa.saldoInicial).toBe(0)
  })

  it("KEEP devolve o MESMO objeto de estado (nenhuma escrita, nenhum re-render)", () => {
    const prev = estadoCliente({ isOpen: true, saldoInicial: 111, sessaoId: "sess-servidor" })
    expect(applyCaixaSessionDecision(prev, { action: "keep", reason: "em-sincronia" })).toBe(prev)
    expect(applyCaixaSessionDecision(prev, { action: "keep", reason: "sessao-de-outra-loja" })).toBe(prev)
    expect(applyCaixaSessionDecision(prev, { action: "keep", reason: "sem-sessao-em-ambos" })).toBe(prev)
  })

  it("nenhuma decisão renumera venda nem inventa idempotency key", () => {
    const prev = estadoCliente({ isOpen: true, saldoInicial: 111, sessaoId: "sess-antiga" })
    const idsAntes = prev.sales.map((s) => s.pedidoId)
    for (const next of [
      applyCaixaSessionDecision(prev, {
        action: "adopt",
        reason: "referencia-obsoleta",
        sessaoId: "sess-nova",
        saldoInicial: 10,
        abertaEm: "",
        replaced: "sess-antiga",
      }),
      applyCaixaSessionDecision(prev, { action: "close", reason: "servidor-sem-sessao-aberta" }),
    ]) {
      expect(next.sales.map((s) => s.pedidoId)).toEqual(idsAntes)
    }
  })

  it("adoção sem `abertaEm` mantém a data de abertura anterior", () => {
    const prev = estadoCliente({ isOpen: true, saldoInicial: 111, sessaoId: null })
    const next = applyCaixaSessionDecision(prev, {
      action: "adopt",
      reason: "referencia-ausente",
      sessaoId: "sess-servidor",
      saldoInicial: 200,
      abertaEm: "",
      replaced: null,
    })
    expect(next.caixa.dataAbertura).toBe(prev.caixa.dataAbertura)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. Abertura de caixa — servidor decide primeiro
// ─────────────────────────────────────────────────────────────────────────────

describe("abertura de caixa — nada abre localmente sem confirmação do servidor", () => {
  it("falha de rede ⇒ recusa (não há como marcar isOpen: não vem sessaoId nem saldo)", () => {
    const d = decideAberturaCaixa({
      saldoDigitado: 150,
      operadorDigitado: "Ana",
      resposta: { ok: false, reason: "rede" },
    })
    expect(d).toEqual({ action: "recusar", reason: "rede" })
    expect(d).not.toHaveProperty("sessaoId")
  })

  it.each([401, 403, 500])("HTTP %i ⇒ recusa com o status preservado", (status) => {
    const d = decideAberturaCaixa({
      saldoDigitado: 150,
      operadorDigitado: "Ana",
      resposta: { ok: false, reason: "http", status },
    })
    expect(d).toEqual({ action: "recusar", reason: "http", status })
  })

  it("200 sem sessaoId ⇒ recusa (o estado degradado do incidente nasce exatamente aqui)", () => {
    const d = decideAberturaCaixa({
      saldoDigitado: 150,
      operadorDigitado: "Ana",
      resposta: { ok: true, body: {} },
    })
    expect(d).toEqual({ action: "recusar", reason: "resposta-sem-sessao" })
  })

  it("200 com sessaoId em branco ⇒ recusa", () => {
    const d = decideAberturaCaixa({
      saldoDigitado: 150,
      operadorDigitado: "Ana",
      resposta: { ok: true, body: { sessaoId: "   " } },
    })
    expect(d).toEqual({ action: "recusar", reason: "resposta-sem-sessao" })
  })

  it("abertura bem-sucedida ⇒ abre com o sessaoId do servidor e o saldo digitado", () => {
    const d = decideAberturaCaixa({
      saldoDigitado: 150,
      operadorDigitado: "Ana",
      resposta: { ok: true, body: { sessaoId: "sess-nova" } },
    })
    expect(d).toEqual({
      action: "abrir",
      sessaoId: "sess-nova",
      saldoInicial: 150,
      operador: "Ana",
      jaEstavaAberto: false,
    })
  })

  it("caixa já aberto no servidor ⇒ adota sessão, saldo e operador existentes", () => {
    const d = decideAberturaCaixa({
      saldoDigitado: 150,
      operadorDigitado: "Ana",
      resposta: {
        ok: true,
        body: {
          sessaoId: "sess-existente",
          alreadyOpen: true,
          sessao: { saldoInicial: 900, operador: "Bruno" },
        },
      },
    })
    expect(d).toEqual({
      action: "abrir",
      sessaoId: "sess-existente",
      saldoInicial: 900,
      operador: "Bruno",
      jaEstavaAberto: true,
    })
  })

  it("já aberto sem saldo no corpo ⇒ cai para o valor digitado, sem quebrar", () => {
    const d = decideAberturaCaixa({
      saldoDigitado: 150,
      operadorDigitado: "Ana",
      resposta: { ok: true, body: { sessaoId: "sess-existente", alreadyOpen: true } },
    })
    expect(d).toMatchObject({ action: "abrir", saldoInicial: 150, operador: "Ana" })
  })

  it("uma abertura recusada nunca produz sessão utilizável para o pré-pagamento", () => {
    const d = decideAberturaCaixa({
      saldoDigitado: 150,
      operadorDigitado: "Ana",
      resposta: { ok: false, reason: "http", status: 403 },
    })
    // Reproduz a consequência: sem `abrir`, o cliente segue fechado ⇒ referência
    // não fica "stale" (isOpen true + sessão vazia), que era o caixa fantasma.
    const clienteAposRecusa = { isOpen: false, sessaoId: null }
    expect(d.action).toBe("recusar")
    expect(isCaixaReferenceStale(clienteAposRecusa)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 8. Pré-pagamento
// ─────────────────────────────────────────────────────────────────────────────

describe("pré-pagamento — sessão obsoleta é recuperada antes de abrir o pagamento", () => {
  it("caixa aberto sem sessaoId é sinalizado como referência desatualizada", () => {
    expect(isCaixaReferenceStale({ isOpen: true, sessaoId: null })).toBe(true)
    expect(isCaixaReferenceStale({ isOpen: true, sessaoId: "  " })).toBe(true)
    expect(isCaixaReferenceStale({ isOpen: true, sessaoId: "sess-1" })).toBe(false)
    expect(isCaixaReferenceStale({ isOpen: false, sessaoId: null })).toBe(false)
  })

  it("sessão obsoleta no pré-pagamento é substituída pela ativa (venda sai com a certa)", async () => {
    const prev = estadoCliente({ isOpen: true, saldoInicial: 111, sessaoId: "sess-obsoleta" })
    const r = await reconcileCaixaSession({
      storeId: STORE,
      local: { isOpen: prev.caixa.isOpen, sessaoId: prev.caixaSessaoId },
      fetchImpl: fetchComSessoes([serverSession({ id: "sess-ativa" })]),
      hydrated: true,
    })
    expect(r.outcome).toMatchObject({
      ok: true,
      status: "adotada",
      sessaoId: "sess-ativa",
      substituiu: "sess-obsoleta",
      motivo: "referencia-obsoleta",
    })
    const next = applyCaixaSessionDecision(prev, r.decision!)
    expect(next.caixaSessaoId).toBe("sess-ativa")
    // A venda pendente NÃO foi reassociada nem reenviada.
    expect(next.sales).toBe(prev.sales)
  })

  it("sem caixa aberto no servidor, o pré-pagamento fica bloqueado (sem-caixa-aberto)", async () => {
    const r = await reconcileCaixaSession({
      storeId: STORE,
      local: { isOpen: true, sessaoId: "sess-fantasma" },
      fetchImpl: fetchComSessoes([]),
      hydrated: true,
    })
    expect(r.outcome).toEqual({ ok: true, status: "sem-caixa-aberto" })
  })

  it("recusa do servidor por sessão dispara reconsulta; conflito de identidade não", () => {
    expect(isCaixaSessionRejectionCode("CAIXA_FECHADO")).toBe(true)
    expect(isCaixaSessionRejectionCode("SESSAO_INVALIDA")).toBe(true)
    // Reenviar a venda aqui não resolve e arriscaria duplicidade.
    expect(isCaixaSessionRejectionCode("CAIXA_ORIGINAL_FECHADO")).toBe(false)
    expect(isCaixaSessionRejectionCode("PEDIDO_ID_CONFLITO")).toBe(false)
    expect(isCaixaSessionRejectionCode(undefined)).toBe(false)
    expect(isCaixaSessionRejectionCode(null)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 9. Consulta da sessão ativa
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchActiveCaixaSession — leitura da sessão ativa", () => {
  it("lista vazia ⇒ ok com sessao nula (o servidor respondeu: não há caixa aberto)", async () => {
    const r = await fetchActiveCaixaSession(STORE, fetchComSessoes([]))
    expect(r).toEqual({ ok: true, sessao: null })
  })

  it("normaliza saldo não numérico e sessão sem id", async () => {
    const r = await fetchActiveCaixaSession(
      STORE,
      fetchComSessoes([{ id: "sess-1", saldoInicial: "abc", abertaEm: "2026-08-02T12:00:00.000Z" }]),
    )
    expect(r).toEqual({
      ok: true,
      sessao: { id: "sess-1", storeId: null, saldoInicial: 0, abertaEm: "2026-08-02T12:00:00.000Z" },
    })

    const semId = await fetchActiveCaixaSession(STORE, fetchComSessoes([{ saldoInicial: 10 }]))
    expect(semId).toEqual({ ok: true, sessao: null })
  })

  it("propaga o status HTTP da falha", async () => {
    const r = await fetchActiveCaixaSession(STORE, fetchComStatus(403))
    expect(r).toEqual({ ok: false, reason: "http", status: 403 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 10. Independência de inventory/ordens
// ─────────────────────────────────────────────────────────────────────────────

describe("independência — inventory e ordens falhando não impedem a reconciliação", () => {
  it("a reconciliação só consulta a rota de sessões de caixa", async () => {
    const chamadas: string[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      chamadas.push(url)
      // Estoque e OS estão fora do ar; sessões respondem normalmente.
      if (url.includes("/api/ops/inventory") || url.includes("/api/ops/ordens")) {
        return new Response("", { status: 500 })
      }
      return new Response(JSON.stringify({ sessoes: [serverSession()] }), { status: 200 })
    }) as unknown as typeof fetch

    const r = await reconcileCaixaSession({
      storeId: STORE,
      local: { isOpen: false, sessaoId: null },
      fetchImpl,
      hydrated: true,
    })

    expect(chamadas).toEqual([activeCaixaSessionUrl(STORE)])
    expect(chamadas.some((u) => u.includes("/api/ops/inventory"))).toBe(false)
    expect(chamadas.some((u) => u.includes("/api/ops/ordens"))).toBe(false)
    expect(r.outcome).toMatchObject({ ok: true, status: "adotada", sessaoId: "sess-servidor" })
  })
})
