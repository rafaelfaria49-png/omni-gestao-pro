import fs from "node:fs"
import path from "node:path"
import { test as setup, expect } from "@playwright/test"

const authFile = path.join(__dirname, ".auth", "storage.json")

setup("autenticar e gravar sessão", async ({ page }) => {
  const email = process.env.PLAYWRIGHT_E2E_EMAIL?.trim() || "admin@rafacell.com.br"
  const password =
    process.env.PLAYWRIGHT_E2E_PASSWORD?.trim() ||
    process.env.ADMIN_DEFAULT_PASSWORD?.trim() ||
    ""

  if (!password) {
    throw new Error(
      "Defina PLAYWRIGHT_E2E_PASSWORD ou ADMIN_DEFAULT_PASSWORD no ambiente para executar E2E.",
    )
  }

  /** Evita corrida com `webServer` do Playwright (setup pode arrancar antes do `npm run dev` aceitar ligações). */
  const deadline = Date.now() + 90_000
  let originReady = false
  while (Date.now() < deadline) {
    try {
      const probe = await page.request.get("/login")
      if (probe.ok()) {
        originReady = true
        break
      }
    } catch {
      /* ECONNREFUSED enquanto o servidor ainda não escuta */
    }
    await page.waitForTimeout(400)
  }
  if (!originReady) {
    throw new Error("E2E: o servidor de desenvolvimento não respondeu em GET /login dentro do tempo.")
  }

  /**
   * GOAL 003D-lite: o setup deixou de emitir selo anonimamente (o endpoint já não
   * aceita — PLAT-SEC-SEAL-003B — e o proxy já não exige selo). A entrada em
   * `/dashboard` passou a depender apenas do login real abaixo.
   */
  await page.goto("/login")
  await expect(page.getByRole("heading", { name: /OmniGestão Pro/i })).toBeVisible()

  await page.getByLabel("Email").fill(email)
  // `getByLabel("Senha")` ficou ambíguo após o botão "Mostrar senha" (aria-label) — usa o textbox.
  await page.getByRole("textbox", { name: "Senha" }).fill(password)
  try {
    await Promise.all([
      page.waitForURL(/\/dashboard(\/|$)/, { timeout: 15_000 }),
      page.getByRole("button", { name: "Entrar" }).click(),
    ])
  } catch {
    // Timeout explícito: sem ele o textContent espera indefinidamente (actionTimeout
    // global = 0) por um erro que não existe quando o login foi aceito.
    const errText = await page
      .locator("p.text-destructive")
      .first()
      .textContent({ timeout: 3_000 })
      .catch(() => null)
    if (errText?.trim()) {
      throw new Error(`Login não redirecionou para /dashboard: ${errText.trim()} (URL: ${page.url()})`)
    }
    // Sem erro visível: NextAuth pode ter redirecionado para o host canónico do
    // NEXTAUTH_URL (ex.: `localhost`) enquanto o cookie de sessão ficou no host do
    // baseURL (ex.: `127.0.0.1`). Com `reuseExistingServer`, o alinhamento de env do
    // playwright.config não alcança um servidor já em execução — valida a sessão
    // via API no host do baseURL (onde o cookie vive), sem pagar o compile on-demand
    // do /dashboard no `next dev`.
    const sess = await page.request
      .get("/api/auth/session", { timeout: 120_000 })
      .catch(() => null)
    const sessBody = sess ? ((await sess.json().catch(() => null)) as { user?: unknown } | null) : null
    if (!sessBody?.user) {
      // Não aborta: com `next dev` frio/carregado esta rota pode demorar além do timeout.
      // O cookie já foi gravado no contexto; se a autenticação realmente não pegou,
      // os specs falham de forma visível no primeiro `expect`.
      console.warn(
        "[auth.setup] aviso: sessão não confirmada via /api/auth/session — storageState salvo mesmo assim.",
      )
    }
  }

  fs.mkdirSync(path.dirname(authFile), { recursive: true })
  await page.context().storageState({ path: authFile })
})
