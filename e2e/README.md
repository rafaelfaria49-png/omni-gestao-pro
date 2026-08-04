# E2E — Playwright (Fase 1)

Smoke tests contra a app Next.js em execução (porta **3000** por defeito).

## Variáveis de ambiente

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `PLAYWRIGHT_E2E_EMAIL` | Não | Por defeito `admin@rafacell.com.br` |
| `PLAYWRIGHT_E2E_PASSWORD` ou `ADMIN_DEFAULT_PASSWORD` | **Sim** (setup) | Credencial NextAuth do utilizador de teste |
| `PLAYWRIGHT_BASE_URL` | Não | Por defeito alinha com `NEXTAUTH_URL` ou `http://localhost:3000` (evitar misturar `localhost` com `127.0.0.1` — cookies de sessão) |
| `PLAYWRIGHT_E2E_SKIP_WEBSERVER=1` | Não | Não arranca `npm run dev` (usa servidor já a correr). O script `npm run test:e2e` remove `SKIP_WEBSERVER` herdado do shell para evitar falhas acidentais. |
| `PLAYWRIGHT_PDV_SKU` | Não | Se definido, o teste do PDV tenta adicionar produto por código/nome |

No Windows PowerShell, com `.env` na raiz do projeto:

```powershell
Get-Content .env | ForEach-Object { if ($_ -match '^([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim('"'), 'Process') } }
npm run test:e2e
```

Ou exporte manualmente `ADMIN_DEFAULT_PASSWORD` antes de `npm run test:e2e`.

## Comportamento importante

- O `playwright.config.ts` carrega `.env` na raiz (via `dotenv`) para `ADMIN_DEFAULT_PASSWORD`, `NEXTAUTH_URL`, etc.
- O setup **não** emite selo de assinatura: desde o GOAL 003D-lite o proxy exige apenas sessão NextAuth para entrar em `/dashboard`. Não reintroduza `POST /api/subscription/seal` no setup — o endpoint é administrativo e recusa chamadas anónimas.
- **Host:** o Playwright normaliza `localhost` → `127.0.0.1` no `baseURL` para evitar `::1` / ECONNREFUSED no Windows; em dev o `next.config.mjs` inclui `allowedDevOrigins: ['127.0.0.1']` para o HMR. Alinhe `NEXTAUTH_URL` com a mesma origem se notar redirecionamentos estranhos no login.
- O wizard **Boas-vindas! Vamos configurar sua loja** é fechado com «Voltar depois» nos specs (o dismiss fica em `sessionStorage`, não no `storageState`).

## Comandos

```bash
npm run test:e2e          # arranca dev se necessário (reuseExistingServer)
PLAYWRIGHT_E2E_SKIP_WEBSERVER=1 npm run test:e2e
npm run test:e2e:ui
npx playwright install chromium   # primeira vez / após upgrade
```

## Estrutura

- `auth.setup.ts` — login e `e2e/.auth/storage.json`
- `specs/*.spec.ts` — cenários smoke
