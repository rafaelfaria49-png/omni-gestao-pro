# CONTADOR-014 — Ativação Operacional em Produção (ENABLEMENT)

Fechamento operacional do GOAL `CONTADOR-HUB-IDENTIDADE-CONVITE-014` em produção.
Documento estritamente factual: sem valores de segredo, sem credenciais, sem dados
sensíveis. Zero alteração funcional adicional além do aqui registrado.

## 1. SHA e deployment

- origin/main: `0c0a518` (histórico: `950cc18` [close GOAL 013] → … → `a52f0fe`
  [close GOAL 014] → `fd63654` runner → `7145b23` buildCommand → `5dbf2f9`
  baseline → `0c0a518` fix probe). Todos fast-forward, sem force push.
- Deployment de Production: `omni-gestao-dkl2swmvt` — ● Ready.
- Alias de produção `https://omni-gestao-pro.vercel.app` apontando para esse
  deployment; `/api/version` → `buildId: 0c0a5181189d` (commit `0c0a518`).
- O deployment contém integralmente o GOAL 014 (código já publicado em `a52f0fe`).

## 2. Segredo de sessão externa

- `CONTADOR_EXTERNO_SESSION_SECRET` criado no ambiente **Production** da Vercel
  (projeto `omni-gestao-pro`), tipo **Sensitive**, valor de 32 bytes gerado com
  fonte criptográfica (`crypto.randomBytes`), enviado por stdin, nunca impresso,
  salvo em arquivo ou registrado. Confirmado presente via `vercel env ls
  production` (somente nome/tipo).
- `DATABASE_URL` e `DIRECT_URL` permanecem **Sensitive** — não foram removidas,
  recriadas nem rebaixadas.

## 3. Migration 0015 — aplicada

- Banco de produção (Neon) não possuía `_prisma_migrations` (schema criado
  historicamente fora do fluxo migrate) — `migrate deploy` falhava com P3005.
- Solução permanente e fail-closed (commits `fd63654`, `7145b23`, `5dbf2f9`,
  `0c0a518`): build de Production roda `scripts/vercel-build.mjs` →
  `scripts/prisma-baseline.mjs` → `prisma migrate deploy` → `prisma generate` →
  `next build --webpack`. Fora de Production, baseline e migration nunca rodam.
- Baseline executado no build (log do deployment `dkl2swmvt`):
  1. prova READ-ONLY: `prisma migrate diff` do schema pré-0015
     (`prisma/schema-pre-0015.prisma`, extraído verbatim do commit canônico
     `950cc18`) contra o banco real → **diff vazio** (banco idêntico ao pré-0015);
  2. `migrate resolve --applied` nas migrations **0001–0014** (14/14, lista
     congelada do commit `950cc18`);
  3. `prisma migrate deploy` → **`0015_contador_identidade_externa` aplicada**
     ("All migrations have been successfully applied").
- A 0015 aplicada é exatamente a publicada (aditiva: 3 enums + 4 tabelas novas +
  índices + FKs; zero DROP/ALTER destrutivo). Nenhuma migration publicada foi
  editada; `prisma db push` não foi usado em nenhum momento.

## 4. Smoke do GOAL 014 (produção, 2026-08-02)

| Verificação | Resultado |
|---|---|
| `GET /contador-externo/login` | **200** ✓ |
| `GET /contador-externo/convite` | **200** ✓ |
| `GET /api/contador-externo/auth/sessao` sem cookie | **401** `nao_autenticado` (antes: 503 fail-closed) ✓ |
| Convite falso (`POST /convite/consultar`, token inexistente) | **200** `{"estado":"invalido"}` — anti-enumeração, não 500 ✓ |
| Login com credenciais falsas | **401** mensagem genérica (anti-enumeração) ✓ |
| Cookie interno forjado na sessão externa | **401** — autenticação interna não autentica o portal ✓ |
| `POST /auth/logout` sem sessão | **200** idempotente, não 500 ✓ |
| Rotas do GOAL 015 (`/contador-externo/painel`, `/obrigacoes`, `/guias`) | **404** — nada exposto antecipadamente ✓ |
| Respostas 500 inesperadas | **nenhuma** ✓ |
| Token bruto em URL/query/logs | token viaja só em body de POST; logs de build sem nenhum segredo ✓ |

Logout com revogação real de sessão e ciclo completo de convite foram cobertos
pelos testes do GOAL 014 (`auth.test.ts`, `convite.test.ts`, `internas.test.ts`,
`lojas/route.test.ts`) e pela sessão externa persistida/revogável no banco;
em produção não foi criado nenhum usuário/convite de teste (zero escrita em
dados reais durante o smoke).

## 5. Garantias

- Ausência de dados sensíveis neste documento e nos logs citados.
- Nenhuma funcionalidade além do GOAL 014 foi alterada; nenhuma funcionalidade
  futura antecipada.
- Trabalho paralelo preservado (snapshot fiscal de outra sessão nunca tocado;
  `.gitignore` do `vercel link` não commitado).

## 6. Estado

`CONTADOR_014_PRODUCTION_ENABLED=true`
