/**
 * Teste estático ("lint test") — GOAL 003D-lite.
 *
 * Garante que o selo `assistec_sub_v1` deixou de ser condição de ENTRADA e que
 * nenhum cliente volta a emitir selo automaticamente a partir do navegador.
 *
 * É estático de propósito: `lib/config-empresa.tsx` é um provider React com
 * `localStorage`, e `e2e/auth.setup.ts` só corre sob Playwright — nenhum dos dois
 * é exercitável no ambiente `node` do Vitest. A propriedade que interessa aqui
 * ("este código não existe mais") é exatamente o que uma varredura de fonte prova.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const REPO_ROOT = resolve(__dirname, "..", "..")

function ler(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8")
}

/** Remove blocos de comentário e linhas `//` — comentários explicam a remoção. */
function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

describe("config-empresa não emite mais selo a partir do navegador", () => {
  const src = semComentarios(ler("lib/config-empresa.tsx"))

  it("não faz POST para /api/subscription/seal", () => {
    expect(src).not.toContain("/api/subscription/seal")
  })

  it("não envia plano/status/vencimento para nenhum endpoint", () => {
    expect(src).not.toMatch(/fetch\([^)]*subscription/i)
  })

  it("continua a ser um provider de configuração funcional", () => {
    expect(src).toContain("ConfigEmpresaProvider")
    expect(src).toContain("updateAssinatura")
  })
})

describe("setup E2E não depende de emissão anónima", () => {
  const src = semComentarios(ler("e2e/auth.setup.ts"))

  it("não chama POST /api/subscription/seal", () => {
    expect(src).not.toContain("/api/subscription/seal")
  })

  it("continua a autenticar por login real", () => {
    expect(src).toContain("/login")
    expect(src).toContain("storageState")
  })

  it("não contém segredo fixo nem bypass de ambiente", () => {
    expect(src).not.toMatch(/ASSISTEC_SUBSCRIPTION_SECRET/)
    expect(src).not.toMatch(/E2E_BYPASS|SKIP_AUTH|DISABLE_AUTH/i)
  })
})

describe("proxy não decide entrada pelo selo", () => {
  const src = semComentarios(ler("proxy.ts"))

  it("não lê o cookie do selo", () => {
    expect(src).not.toContain("SUBSCRIPTION_COOKIE_NAME")
    expect(src).not.toContain("assistec_sub_v1")
  })

  it("não verifica assinatura de selo", () => {
    expect(src).not.toContain("verifySubscriptionCookieValue")
    expect(src).not.toContain("isVencimentoExpired")
  })

  it("não usa o segredo do selo", () => {
    expect(src).not.toContain("ASSISTEC_SUBSCRIPTION_SECRET")
  })

  it("decide a entrada pelo classificador de sessão", () => {
    expect(src).toContain("resolveProxyEntry")
  })
})

describe("gate legado não lê mais o cookie do selo", () => {
  const src = semComentarios(ler("lib/api-auth.ts"))

  it("getVerifiedSubscriptionFromCookies delega à sessão", () => {
    expect(src).toContain("getSessionEntitlement")
  })

  it("não verifica nem lê o selo", () => {
    expect(src).not.toContain("verifySubscriptionCookieValue")
    expect(src).not.toContain("SUBSCRIPTION_COOKIE_NAME")
  })
})

describe("emissão de selo continua administrativa e server-side", () => {
  const src = semComentarios(ler("app/api/subscription/seal/route.ts"))

  it("continua exigindo requireAdmin (não regrediu para anónimo)", () => {
    expect(src).toContain("requireAdmin")
  })

  it("continua sem ler o corpo da requisição", () => {
    expect(src).not.toContain("request.json()")
    expect(src).not.toContain("req.json()")
  })
})
