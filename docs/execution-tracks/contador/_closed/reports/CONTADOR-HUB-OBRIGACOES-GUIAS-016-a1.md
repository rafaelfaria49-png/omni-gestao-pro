# CONTADOR-HUB-OBRIGACOES-GUIAS-016 — tentativa 1

- trilha: `contador`
- resultado: **DONE**
- ratificado em: 2026-08-19T16:00:28.165Z
- branch: `goal/contador-016-obrigacoes`
- base_commit: `659fb2969befa4257da4f45deeb356f2677f6113`
- head_commit: `e1a42c3176f2b32d879e98fa6a33995c145f607d`
- teste: `npm run typecheck` → exit 0
- upstream: rebase_needed

## Caminhos alterados

- `app/api/contador/agenda/guias/[id]/pagar/route.ts`
- `app/api/contador/agenda/guias/[id]/route.ts`
- `app/api/contador/agenda/guias/route.ts`
- `app/api/contador/agenda/obrigacoes/[id]/route.ts`
- `app/api/contador/agenda/obrigacoes/[id]/status/route.ts`
- `app/api/contador/agenda/obrigacoes/instanciar/route.ts`
- `app/api/contador/agenda/obrigacoes/route.ts`
- `app/api/contador/agenda/route.ts`
- `app/api/contador/agenda/templates/[id]/route.test.ts`
- `app/api/contador/agenda/templates/[id]/route.ts`
- `app/api/contador/agenda/templates/route.test.ts`
- `app/api/contador/agenda/templates/route.ts`
- `app/dashboard/contador/page.tsx`
- `components/dashboard/contador/agenda/contador-agenda-real.tsx`
- `components/dashboard/contador/contador-hub-honesty.test.ts`
- `components/dashboard/contador/contador-hub-preview.tsx`
- `components/dashboard/contador/contador-preview-data.ts`
- `docs/ai-execution/_evidence/CONTADOR-016-AEP-015-CLOSED-INTEGRITY.md`
- `docs/ai-execution/_evidence/CONTADOR-016-PRODUCTION-MIGRATION.md`
- `docs/ai-execution/_evidence/CONTADOR-016-SCHEMA-REDUCTION-RATIFICATION.md`
- `docs/contador/CONTADOR_HUB_OBRIGACOES_GUIAS_016.md`
- `docs/status/MOCKS_TRACKING.md`
- `lib/contador/agenda/erros.ts`
- `lib/contador/agenda/honesty.test.ts`
- `lib/contador/agenda/http.ts`
- `lib/contador/agenda/index.ts`
- `lib/contador/agenda/repo-prisma.concurrency.test.ts`
- `lib/contador/agenda/repo-prisma.ts`
- `lib/contador/agenda/service.test.ts`
- `lib/contador/agenda/service.ts`
- `lib/contador/agenda/tipos.ts`
- `lib/contador/agenda/vencimento.test.ts`
- `lib/contador/agenda/vencimento.ts`
- `lib/contador/fechamento/montar-checklist.test.ts`
- `lib/contador/fechamento/montar-checklist.ts`
- `prisma/migrations/0017_contador_agenda/migration.sql`
- `prisma/schema.prisma`

## Tentativas anteriores

- (nenhuma)

## Evidência do check

- [PASS] branch atual = branch do GOAL — `git rev-parse --abbrev-ref HEAD` → goal/contador-016-obrigacoes (esperado goal/contador-016-obrigacoes)
- [PASS] worktree = a registrada no open — `git rev-parse --show-toplevel` → /workspace (esperado /workspace)
- [PASS] árvore limpa — `git status --porcelain` → (vazio)
- [PASS] HEAD aponta para um commit — `git rev-parse --verify HEAD^{commit}` → e1a42c3176f2b32d879e98fa6a33995c145f607d
- [PASS] base_commit é ancestral da branch — `git merge-base --is-ancestor 659fb2969befa4257da4f45deeb356f2677f6113 goal/contador-016-obrigacoes` → ancestral confirmado
- [PASS] caminhos do diff dentro da allowlist — `git diff --name-only 659fb2969befa4257da4f45deeb356f2677f6113..HEAD` → 37 caminho(s), todos dentro
- [PASS] nenhum gate de caminho não liberado — `git diff --name-only 659fb2969befa4257da4f45deeb356f2677f6113..HEAD` → nenhum gate tocado
- [PASS] docs/execution-tracks/*/goals/** não alterado — `git diff --name-only 659fb2969befa4257da4f45deeb356f2677f6113..HEAD` → caminho quente intocado
- [PASS] LEDGER.jsonl sem deleções — `git diff --numstat 659fb2969befa4257da4f45deeb356f2677f6113..HEAD -- docs/execution-tracks/contador/LEDGER.jsonl` → 0 linha removida
- [PASS] teste do GOAL passa — `npm run typecheck` → exit 0
- [AVISO] upstream origin/main no escopo — `git fetch origin && git log 659fb2969befa4257da4f45deeb356f2677f6113..origin/main` → rebase_needed: 7 commit(s) upstream no escopo: a8cd29dc goal(contador-016): recheck pós-lock no lote em vez de P2002 na tx | 73e32dd8 goal(contador-016): travar agenda contra fechamento e guia paga concorrentes | 751fd744 aep(contador): reconciliar baseline oficial na branch 016
- [AVISO] próximo GOAL elegível (informativo) — `ls docs/execution-tracks/contador/goals/` → nenhum — fechar o último GOAL da trilha é permitido
