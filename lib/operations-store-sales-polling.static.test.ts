/**
 * GOAL: OMNIGESTAO-PERFORMANCE-VENDAS-POLLING-BOUNDED-003B
 *
 * Contrato estático do provider: o dump `/api/ops/vendas-list` permanece no
 * bootstrap, mas sai do timer periódico de ~30s. Reconciliação de vendas fica
 * em visibility→visible, online e refresh explícito.
 *
 * Limite: OperationsProvider é um client module grande (localStorage, fetch,
 * timers). Sem refactor de injeção, o teste prova o contrato por leitura do
 * efeito — não monta o React tree.
 */
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const REPO_ROOT = resolve(__dirname, "..")

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8")
}

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  expect(startIndex, `marcador inicial ausente: ${start}`).toBeGreaterThanOrEqual(0)
  expect(endIndex, `marcador final ausente: ${end}`).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

describe("OMNIGESTAO-PERFORMANCE-VENDAS-POLLING-BOUNDED-003B — operations-store", () => {
  const store = read("lib/operations-store.tsx")

  const loadDb = between(store, "async function loadDb() {", "void loadDb()")
  const wakeEffect = between(
    store,
    "const flushPendingOnWake = () => {",
    "const setOrdens: OperationsContextType[\"setOrdens\"]",
  )
  const intervalLine = wakeEffect.match(/window\.setInterval\(([^,]+),\s*30_000\)/)
  const caixaVisibility = between(
    store,
    "Reconciliação automática: montagem",
    "useEffect(() => {\n    if (!opsDbReady) return\n    const snap",
  )

  it("T1 — bootstrap inicial ainda recarrega vendas via vendas-list", () => {
    expect(loadDb).toContain("/api/ops/vendas-list?lojaId=")
    expect(loadDb).toContain("mergeSalesById(prev.sales, remoteSales)")
    expect(store).toContain("const refreshSalesFromServer = useCallback")
  })

  it("T2 — timer periódico de ~30s NÃO chama refreshSalesFromServer", () => {
    expect(intervalLine, "setInterval de 30s ausente").not.toBeNull()
    expect(intervalLine?.[1].trim()).toBe("flushPendingOnWake")
    expect(wakeEffect).not.toMatch(/setInterval\([^)]*refreshSalesFromServer/)
    expect(wakeEffect).not.toMatch(/setInterval\(onWake/)
  })

  it("T3 — o mesmo ciclo periódico continua flush de pendências", () => {
    expect(wakeEffect).toContain("flushPendingSales()")
    expect(wakeEffect).toContain("flushPendingDevolucoes()")
    expect(wakeEffect).toContain("flushPendingCaixaOperations()")
    const flushBody = between(wakeEffect, "const flushPendingOnWake = () => {", "const reconcileSalesOnResume")
    expect(flushBody).not.toContain("refreshSalesFromServer")
  })

  it("T4 — visibilitychange para visible dispara reconciliação de vendas", () => {
    expect(wakeEffect).toContain('document.addEventListener("visibilitychange", onVisible)')
    expect(wakeEffect).toContain("document.visibilityState === \"visible\"")
    expect(wakeEffect).toContain("reconcileSalesOnResume()")
    const resume = between(wakeEffect, "const reconcileSalesOnResume = () => {", "const onVisible")
    expect(resume).toContain("void refreshSalesFromServer()")
    expect(resume).toContain("flushPendingOnWake()")
  })

  it("T5 — estado hidden não dispara refresh de vendas", () => {
    const onVisible = between(wakeEffect, "const onVisible = () => {", 'window.addEventListener("online"')
    expect(onVisible).toContain("document.visibilityState === \"visible\"")
    expect(onVisible).not.toMatch(/visibilityState === ["']hidden["']/)
    expect(onVisible).not.toMatch(/if \(document\.visibilityState !== "visible"\)[\s\S]*refreshSalesFromServer/)
  })

  it("T6 — evento online dispara reconciliação de vendas", () => {
    expect(wakeEffect).toContain('window.addEventListener("online", reconcileSalesOnResume)')
    expect(wakeEffect).toContain('window.removeEventListener("online", reconcileSalesOnResume)')
  })

  it("T7 — o efeito de wake registra e remove o mesmo par de listeners", () => {
    expect(wakeEffect).toContain('document.removeEventListener("visibilitychange", onVisible)')
    expect(wakeEffect).toContain("window.clearInterval(interval)")
    expect(wakeEffect.match(/addEventListener\("visibilitychange"/g)?.length).toBe(1)
    expect(wakeEffect.match(/addEventListener\("online"/g)?.length).toBe(1)
    expect(wakeEffect.match(/setInterval\(/g)?.length).toBe(1)
    // Caixa tem o próprio par visibility/online — não é duplicata deste efeito.
    expect(caixaVisibility).toContain("refreshCaixaSession")
    expect(caixaVisibility).not.toContain("refreshSalesFromServer")
  })
})
