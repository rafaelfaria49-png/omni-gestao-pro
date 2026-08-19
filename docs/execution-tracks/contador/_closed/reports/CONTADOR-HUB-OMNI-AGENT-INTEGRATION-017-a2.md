# CONTADOR-HUB-OMNI-AGENT-INTEGRATION-017 — tentativa 2

- trilha: `contador`
- resultado: **DONE**
- ratificado em: 2026-08-19T19:06:45.065Z
- branch: `goal/contador-017-omni-agent-integration`
- base_commit: `97a9f0f4e8a42c859868034a5dfad20a3107a865`
- head_commit: `96733688b2adf51879edca180e3406089f14d2a7`
- teste: `npm run typecheck` → exit 0
- upstream: rebase_needed

## Caminhos alterados

- `app/api/contador/notificacoes/[id]/rascunho/route.ts`
- `app/api/contador/notificacoes/[id]/tratar/route.ts`
- `app/api/contador/notificacoes/avaliar/route.ts`
- `app/api/contador/notificacoes/route.ts`
- `components/dashboard/contador/avisos/contador-avisos-real.tsx`
- `components/dashboard/contador/contador-hub-honesty.test.ts`
- `components/dashboard/contador/contador-hub-preview.tsx`
- `docs/contador/OMNI_AGENT_CONTRATO_017.md`
- `docs/status/MOCKS_TRACKING.md`
- `lib/contador/__tests__/notificacoes/avaliar.test.ts`
- `lib/contador/__tests__/notificacoes/concurrency.test.ts`
- `lib/contador/__tests__/notificacoes/helpers.ts`
- `lib/contador/__tests__/notificacoes/honesty.test.ts`
- `lib/contador/__tests__/notificacoes/manifesto.test.ts`
- `lib/contador/__tests__/notificacoes/regras.test.ts`
- `lib/contador/__tests__/notificacoes/trilha.test.ts`
- `lib/contador/notificacoes/chave.ts`
- `lib/contador/notificacoes/http.ts`
- `lib/contador/notificacoes/index.ts`
- `lib/contador/notificacoes/limiares.ts`
- `lib/contador/notificacoes/manifesto-zip.ts`
- `lib/contador/notificacoes/pacote-fonte.ts`
- `lib/contador/notificacoes/rascunhos.ts`
- `lib/contador/notificacoes/regras.ts`
- `lib/contador/notificacoes/repo-prisma.ts`
- `lib/contador/notificacoes/repo.ts`
- `lib/contador/notificacoes/sanear.ts`
- `lib/contador/notificacoes/service.ts`
- `lib/contador/notificacoes/tipos.ts`

## Tentativas anteriores

- tentativa 1 (2026-08-19T17:47:03.949Z): revisao independente do PR 85: tratar sem trilha emitido, rascunho de tratado, pacote via snapshot duplicado

## Evidência do check

- [PASS] branch atual = branch do GOAL — `git rev-parse --abbrev-ref HEAD` → goal/contador-017-omni-agent-integration (esperado goal/contador-017-omni-agent-integration)
- [PASS] worktree = a registrada no open — `git rev-parse --show-toplevel` → /workspace (esperado /workspace)
- [PASS] árvore limpa — `git status --porcelain` → (vazio)
- [PASS] HEAD aponta para um commit — `git rev-parse --verify HEAD^{commit}` → 96733688b2adf51879edca180e3406089f14d2a7
- [PASS] base_commit é ancestral da branch — `git merge-base --is-ancestor 97a9f0f4e8a42c859868034a5dfad20a3107a865 goal/contador-017-omni-agent-integration` → ancestral confirmado
- [PASS] caminhos do diff dentro da allowlist — `git diff --name-only 97a9f0f4e8a42c859868034a5dfad20a3107a865..HEAD` → 29 caminho(s), todos dentro
- [PASS] nenhum gate de caminho não liberado — `git diff --name-only 97a9f0f4e8a42c859868034a5dfad20a3107a865..HEAD` → nenhum gate tocado
- [PASS] docs/execution-tracks/*/goals/** não alterado — `git diff --name-only 97a9f0f4e8a42c859868034a5dfad20a3107a865..HEAD` → caminho quente intocado
- [PASS] LEDGER.jsonl sem deleções — `git diff --numstat 97a9f0f4e8a42c859868034a5dfad20a3107a865..HEAD -- docs/execution-tracks/contador/LEDGER.jsonl` → 0 linha removida
- [PASS] teste do GOAL passa — `npm run typecheck` → exit 0
- [AVISO] upstream origin/main no escopo — `git fetch origin && git log 97a9f0f4e8a42c859868034a5dfad20a3107a865..origin/main` → rebase_needed: 3 commit(s) upstream no escopo: 96733688 goal(contador-017): ler pendencias reais do manifesto oficial do ZIP | 1bc5ba29 goal(contador-017): trilha emitido-tratado, rascunho ativo e fonte canônica do pacote | 86d89307 goal(contador-017): alertas internos, central de avisos e rascunhos pt-BR
- [AVISO] próximo GOAL elegível (informativo) — `ls docs/execution-tracks/contador/goals/` → nenhum — fechar o último GOAL da trilha é permitido
