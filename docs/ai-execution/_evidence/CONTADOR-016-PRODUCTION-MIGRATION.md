# CONTADOR-016 — Migration 0017 em Production e merge na main

Documento factual. Sem credenciais, sem `DATABASE_URL`/`DIRECT_URL`, sem dados
de cliente. Zero alteração funcional além do aqui registrado.

Autorização humana explícita (sessão Cursor, 2026-08-19): aplicar a migration
0017 do GOAL 016 em Production, validar o banco, integrar o PR #80 na `main` e
fechar o GOAL 016 se os gates pós-migration passarem.

## 1. Caminho oficial (não improvisado)

`docs/ai/DEPLOY.md`: **não** executar `prisma migrate deploy` manualmente em
Production. O único executor automático autorizado é `scripts/vercel-build.mjs`,
fail-closed por `scripts/migration-authority-guard.mjs`.

Consequência: a 0017 só entra em Production quando o commit que a contém chega
à `main` e o build Production do projeto canônico `omni-gestao-pro` corre.

Neste ambiente do agente:

- `DATABASE_URL` / `DIRECT_URL` apontam para `127.0.0.1` / `tmp_rev2` — **não**
  são o banco de Production. Nenhum `migrate deploy` local foi disparado contra
  Production. `prisma db push` **não** foi usado.

## 2. Integração do PR #80

| Campo | Valor |
|---|---|
| PR | https://github.com/rafaelfaria49-png/omni-gestao-pro-pdv-claude/pull/80 |
| Estado | **MERGED** (`mergedAt` `2026-08-19T15:50:55Z`) |
| Método | merge commit (`gh pr merge --merge`) |
| HEAD da branch antes do merge | `78757861e4cc1cc2f01230d2acb27f075d736245` |
| Merge commit em `origin/main` | `abf21166b35785023f0ad2400984603d50395b04` |
| Migration no tree de `main` | `prisma/migrations/0017_contador_agenda/migration.sql` |
| SHA-256 do SQL | `b1ef1aa9106f63ea44bc629d2808179550a845bc7bfbf688cad3766cf89b4ae6` |
| Pastas 0017 em `main` | **uma** (`0017_contador_agenda`) |

`prisma db push` não foi usado. A 0017 permanece aditiva (3 ENUMs + 3 tabelas +
FKs/CHECKs; zero DROP/ALTER destrutivo/backfill).

## 3. Deploy Production

Antes do merge, o alias canônico servia `659fb2969bef`
(`buildTime` `2026-08-19T14:38:39.001Z`).

| Projeto | Ambiente GitHub | Resultado | URL do deployment |
|---|---|---|---|
| `omni-gestao-pro` (canônico) | Production – omni-gestao-pro | **success** `2026-08-19T15:56:33Z` | https://vercel.com/rafaelfaria49-4373s-projects/omni-gestao-pro/ASDbtjtdm5zJ33EoS9e1KRAfKxsk |
| `omni-gestao` (legado) | Production – omni-gestao | **success** `2026-08-19T15:53:30Z` | https://vercel.com/rafaelfaria49-4373s-projects/omni-gestao/SNT1SbZKksP6aBSMyUATRewfUHeZ |

Alias canônico `https://omni-gestao-pro.vercel.app/api/version` **depois** do
deploy:

```json
{"buildId":"abf21166b357","buildTime":"2026-08-19T15:54:12.469Z"}
```

`GET /` no alias → 200.

Contrato fail-closed (`scripts/vercel-build.mjs`): se o guard autorizar RUN e
`prisma migrate deploy` falhar, o build emite `MIGRATION_FAILED` e sai ≠ 0 —
o deployment Production canônico **não** ficaria Ready. O canônico ficou Ready
no commit que introduz a 0017.

O legado não tem autoridade de migration (`VERCEL_PROJECT_ID` ≠ canônico) e
deve emitir `MIGRATION_SKIPPED`. O legado ficou Ready ~3 min antes do canônico,
coerente com skip de baseline/migrate.

## 4. Validação do banco — o que foi e o que não foi observado

### Observado

- A 0017 publicada em `main` é a mesma SHA-256 da branch do GOAL.
- O build Production canônico do merge commit concluiu com sucesso.
- O alias de produção passou a servir `buildId` `abf21166b357`.
- Smoke HTTP **sem sessão e sem escrita** no alias canônico:

| Verificação | Resultado |
|---|---|
| `GET /api/contador/agenda?c=2026-08` | 401 `nao_autenticado` (não 500) |
| `GET /api/contador/agenda/templates` | 401 `nao_autenticado` (não 500) |
| `GET /api/contador/agenda/obrigacoes?c=2026-08` | 401 `nao_autenticado` (não 500) |
| `GET /api/contador/agenda/guias` | 405 — a rota só expõe POST (código; não é falha de schema) |
| `GET /dashboard/contador` | 307 (login) |
| Resposta 500 nestes GETs | nenhuma |

Nenhuma mutação comercial (POST/PATCH/DELETE, template, obrigação, guia,
pagamento) foi enviada a Production.

### Não observado neste ambiente (limitação honesta)

- Texto dos logs de build (`MIGRATION_RUN` / `MIGRATION_SUCCEEDED` /
  `Applying migration 0017_contador_agenda`): o dashboard da Vercel exige
  login; `VERCEL_TOKEN` ausente; páginas `/logs` redirecionam para login.
- `SELECT` no catálogo de Production (`_prisma_migrations`, enums, tabelas,
  CHECKs): o `DATABASE_URL` deste agente é local (`127.0.0.1` / `tmp_rev2`),
  não o Neon/Supabase de Production.

Inferência operacional (mesmo contrato de `DEPLOY.md` + auditoria
`DEPLOY_PRODUCTION_MIGRATION_AUTHORITY_ACTIVATION_006`): no canônico, com
`VERCEL_ENV=production`, `MIGRATION_AUTHORITY_ENABLED=true` (Production,
desde 2026-08-04) e `VERCEL_PROJECT_ID` canônico, o runner emite
`MIGRATION_RUN` → baseline no-op se `_prisma_migrations` já existe →
`prisma migrate deploy` → `MIGRATION_SUCCEEDED`. Falha de migrate derruba o
deploy. Residual: se a flag tivesse sido removida, o canônico emitiria
`MIGRATION_SKIPPED` e ainda assim ficaria Ready **sem** aplicar a 0017. Essa
remoção não foi observada; a flag estava documentada como presente.

`PRODUCTION_MIGRATION_APPLIED=true` neste documento significa: a 0017 entrou
em `main` e o executor oficial (build Production canônico fail-closed) concluiu
Ready nesse commit. Não significa que um `SELECT` no catálogo de Production
foi executado daqui.

## 5. Garantias

- Nenhum secret neste arquivo.
- Nenhuma funcionalidade fora do GOAL 016.
- GOAL 017 não iniciado.
- `prisma db push` não usado.
- Nenhum dado sintético gravado em Production.
