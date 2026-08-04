# DEPLOY-PRODUCTION-MIGRATION-AUTHORITY-ACTIVATE-006

## 1. Veredito executivo

| Item | Resultado |
|---|---|
| Veredito | **APROVADO** — autoridade de migrations ativada e comprovada em Production |
| Base implantada nos dois projetos | `origin/main@69fb4190362b7f850632fcb1dcb0020371a957a1` |
| Guard integrado (PR #39) | `a50ad7e` — **ancestral confirmado** de `origin/main` |
| Projeto canônico | `omni-gestao-pro` — `MIGRATION_AUTHORITY_ENABLED` **PRESENT** (Production) |
| Projeto legado | `omni-gestao` — `MIGRATION_AUTHORITY_ENABLED` **ABSENT** (todos os escopos) |
| Canônico | `MIGRATION_RUN: 1` · `MIGRATION_SUCCEEDED: 1` · `MIGRATION_SKIPPED: 0` · Ready |
| Legado | `MIGRATION_SKIPPED: 1` · `MIGRATION_RUN: 0` · `prisma migrate deploy: 0` · Ready |
| `prisma migrate deploy` no canônico | executado **uma vez** — `No pending migrations to apply.` |
| Alteração de código, Git, schema ou migrations | **Zero** |
| SQL, rollback, `migrate resolve` ou acesso direto ao banco | **Zero** |
| Migration `0016` | mantida nos dois bancos, sem alteração |
| Deployments adicionais inesperados | **Nenhum** — exatamente um redeploy por projeto |
| GOAL 002C | **não iniciado** |

O guard fail-closed passou de contrato versionado a **contrato operacionalmente
ativo**: o mesmo commit, no mesmo runner, produziu decisões opostas nos dois
projetos, determinadas somente pela identidade do projeto e pela flag explícita.

## 2. Escopo e limites

Este GOAL autorizou apenas: criação de `MIGRATION_AUTHORITY_ENABLED` no projeto
canônico (Production, nível de projeto), redeploy controlado dos dois projetos e
leitura dos logs dos deployments.

Não foram executados: alteração de código, commit funcional, push, PR, alteração
de schema ou de migrations, SQL, Prisma manual, `migrate deploy` fora do build
autorizado, `migrate resolve`, `db push`, rollback, acesso direto ao Neon,
alteração de `DATABASE_URL`/`DIRECT_URL`, desconexão de Git/domínio/Production,
smoke operacional, abertura do dashboard autenticado da aplicação, limpeza das
seis pendências ou integração do writer 002C.

Nenhum ID completo de projeto, connection string, token ou valor de variável foi
persistido neste relatório.

### 2.1 Identificadores sanitizados

Fingerprints SHA-256 (12 caracteres) — **continuidade confirmada** com
`DEPLOY_PRODUCTION_MIGRATION_GOVERNANCE_AUDIT_001.md`:

| Alias | Projeto | Fingerprint do project ID |
|---|---|---|
| `PROJECT_A` | `omni-gestao-pro` (canônico) | `2cfcc0a76da7` |
| `PROJECT_B` | `omni-gestao` (legado) | `02bf338b1365` |

## 3. Pré-flight read-only

| Verificação | Resultado |
|---|---|
| `origin/main` atual | `69fb419` |
| `a50ad7e` ancestral de `origin/main` | ✅ `ANCESTOR_OK` |
| `scripts/vercel-build.mjs` idêntico ao auditado em `a50ad7e` | ✅ blob idêntico |
| `scripts/migration-authority-guard.mjs` idêntico ao auditado | ✅ blob idêntico |
| `scripts/prisma-baseline.mjs` idêntico ao auditado | ✅ blob idêntico |
| `buildCommand` efetivo (`vercel.json`) nos dois projetos | `node scripts/vercel-build.mjs` |
| Project ID canônico | ✅ `CANONICAL_ID_MATCH` |
| Project ID legado | ✅ `LEGACY_ID_DIFFERENT` |
| `MIGRATION_AUTHORITY_ENABLED` antes do GOAL — canônico | `ABSENT` |
| `MIGRATION_AUTHORITY_ENABLED` antes do GOAL — legado | `ABSENT` |
| Deployment Production anterior — canônico (`…pf6e0s0vm`) | `Ready`, commit `69fb419`, `MIGRATION_SKIPPED` |
| Deployment Production anterior — legado (`…6uk568br1`) | `Ready`, commit `69fb419`, `MIGRATION_SKIPPED` |

Nenhum contrato do guard mudou depois de `a50ad7e`. Pré-flight aprovado.

### 3.1 Limitação declarada — System Environment Variables

O item "System Environment Variables habilitadas nos dois projetos" **não pôde
ser reverificado ao vivo** neste GOAL: a UI autenticada da Vercel não estava
acessível pela automação de browser, o `vercel` CLI não expõe
`autoExposeSystemEnvs` em nenhum comando (`project inspect`, `env ls`, `pull`) e
a REST API rejeitou o token local do CLI (`403 invalidToken`).

A confirmação usada foi **documental e versionada**:
`docs/audits/DEPLOY_LEGACY_PROJECT_REAL_USAGE_AUDIT_001.md` registra
"habilitadas na UI" para os dois projetos, e `docs/ai/CURRENT_STATUS.md` registra
a disponibilidade de `VERCEL_PROJECT_ID`/`VERCEL_ENV` no build.

O risco era contido por construção: `VERCEL_PROJECT_ID` ausente com flag `true`
produziria `MIGRATION_GUARD_BLOCKED` e falha de build **antes** de qualquer
escrita, mantendo o alias Production no deployment anterior. O resultado
observado (`MIGRATION_RUN` no canônico) **prova a posteriori** que
`VERCEL_ENV` e `VERCEL_PROJECT_ID` estão efetivamente disponíveis ao build do
`PROJECT_A`.

## 4. Configuração aplicada

| Propriedade | Valor |
|---|---|
| Projeto | `omni-gestao-pro` (`PROJECT_A`) |
| Variável | `MIGRATION_AUTHORITY_ENABLED` |
| Valor | não impresso — criado exatamente como `true` |
| Escopo | **Production somente** (sem Preview, sem Development) |
| Nível | projeto (`vercel env add`), **não** Shared Environment Variable |
| Tipo atribuído pela plataforma | Sensitive/Encrypted — não legível de volta |
| Ocorrências no canônico | `1` |
| Outras variáveis alteradas | **nenhuma** |

No projeto legado nada foi criado, removido ou alterado.

## 5. Deploy canônico — `PROJECT_A`

Redeploy controlado do deployment Production mais recente que continha o guard
(`…pf6e0s0vm`). Sem commit vazio, sem push, sem alteração da `main`.

| Evento | Horário (BRT, 04/08/2026) |
|---|---|
| Clone `main` @ `69fb419` | 16:14:36 |
| `MIGRATION_RUN` | 16:15:29 |
| `[baseline] _prisma_migrations existe — baseline não necessário.` | 16:15:30 |
| `16 migrations found in prisma/migrations` | 16:15:33 |
| `No pending migrations to apply.` | 16:15:35 |
| `MIGRATION_SUCCEEDED` | 16:15:35 |
| Prisma Client gerado (pós-migration) | 16:15:39 |
| Next build — `Compiled successfully` | 16:17:50 |
| `Build Completed` | 16:18:29 |
| Deployment | `● Ready`, aliased em `omni-gestao-pro.vercel.app` |

Contagens no log do deployment `…reiivs22y`:

| Evento | Contagem |
|---|---|
| `MIGRATION_RUN` | **1** |
| `prisma migrate deploy` (invocação) | **1** |
| `MIGRATION_SUCCEEDED` | **1** |
| `MIGRATION_SKIPPED` | **0** |
| `MIGRATION_GUARD_BLOCKED` | **0** |
| `MIGRATION_FAILED` | **0** |
| `Applying migration` | **0** |

Nenhuma condição de bloqueio ocorreu. A `0016` já estava aplicada, então
`migrate deploy` reportou ausência de migrations pendentes — resultado previsto
e aceito pelo GOAL. O baseline foi **no-op** porque `_prisma_migrations` já
existe; nenhum `migrate resolve` foi executado.

## 6. Deploy legado — `PROJECT_B`

Redeploy controlado do deployment Production mais recente que continha o guard
(`…6uk568br1`). Sem flag, sem alteração de variáveis, sem desconexão de Git,
domínio ou Production.

| Evento | Horário (BRT, 04/08/2026) |
|---|---|
| Clone `main` @ `69fb419` | 16:19:57 |
| `MIGRATION_SKIPPED` | 16:20:39 |
| Prisma Client gerado | 16:20:42 |
| Next build — `Compiled successfully` | 16:22:44 |
| `Build Completed` | 16:23:25 |
| Deployment | `● Ready`, aliased em `omni-gestao-pi.vercel.app` |

Contagens no log do deployment `…567mzw2gd`:

| Evento | Contagem |
|---|---|
| `MIGRATION_SKIPPED` | **1** |
| `MIGRATION_RUN` | **0** |
| `prisma migrate deploy` | **0** |
| `prisma-baseline` | **0** |
| `MIGRATION_SUCCEEDED` | **0** |
| `MIGRATION_GUARD_BLOCKED` | **0** |
| `MIGRATION_FAILED` | **0** |

## 7. Matriz observada

| Projeto | Commit | Flag | Project ID | Decisão do guard | `migrate deploy` | Build | Status |
|---|---|---|---|---|---|---|---|
| `PROJECT_A` canônico | `69fb419` | `PRESENT` (Production) | match | `MIGRATION_RUN` → `MIGRATION_SUCCEEDED` | 1× | Ready | ✅ |
| `PROJECT_B` legado | `69fb419` | `ABSENT` | diferente | `MIGRATION_SKIPPED` | 0× | Ready | ✅ |

Mesmo commit, mesmo runner, decisões opostas determinadas exclusivamente por
identidade de projeto e flag explícita.

## 8. Verificação cruzada

| Verificação | Resultado |
|---|---|
| Flag `PRESENT` somente no canônico | ✅ `1` ocorrência, escopo Production |
| Flag `ABSENT` no legado | ✅ `0` ocorrências em todos os escopos |
| Nenhuma flag compartilhada no time | ✅ criada no nível do projeto; team em plano Hobby, sem Shared Environment Variables |
| Nenhum terceiro projeto recebeu a flag | ✅ os outros dois projetos do time verificados — `0` ocorrências |
| Canônico executou migration exatamente uma vez | ✅ `MIGRATION_RUN: 1` |
| Legado executou zero migration | ✅ `MIGRATION_RUN: 0` |
| Nenhum deploy adicional inesperado | ✅ exatamente um novo deployment Production por projeto |
| Nenhum secret, ID completo ou datasource nos logs | ✅ o runner emite somente eventos constantes |
| Alteração manual de banco | ✅ zero |

## 9. Governança de migrations

A governança de migrations está **fechada**:

- existe um único executor automático autorizado — `scripts/vercel-build.mjs`
  sob o guard fail-closed;
- existe uma única autoridade Production — `PROJECT_A`, por identidade de
  project ID **e** flag explícita;
- o projeto legado continua ativo, servindo tráfego residual, sem autoridade de
  migration e sem possibilidade de adquiri-la por nome ou domínio;
- a migration `0016_add_sale_numbering_infrastructure` permanece aplicada nos
  dois bancos, sem rollback e sem nova verificação física.

## 10. Riscos

| Sev | Risco | Situação |
|---|---|---|
| P1 | — | nenhum risco P1 aberto por este GOAL |
| P2 | `autoExposeSystemEnvs` não reverificado ao vivo no `PROJECT_B` | mitigado por evidência documental; irrelevante para o legado, que não tem autoridade em nenhum cenário |
| P2 | Com a flag ativa, todo deployment Production do canônico passa a executar `migrate deploy` automaticamente | comportamento pretendido; exige que migrations novas cheguem à `main` já revisadas |
| P3 | `PROJECT_B` continua conectado ao mesmo repositório e à mesma branch `main` | fora do escopo; a decisão sobre a desativação do projeto legado segue pendente |
| P3 | Node 20.x deprecado no `PROJECT_A` — builds criados a partir de 01/10/2026 falharão | fora do escopo deste GOAL; requer `engines.node = 24.x` em GOAL próprio |
| P3 | Bancos distintos entre os dois projetos (`DIFFERENT_DATABASES`) | inalterado; disposição do banco legado segue sujeita a decisão humana |

## 11. Próximo passo

**Readiness do GOAL 002C.** Este GOAL não iniciou o writer 002C, não tocou nas
seis pendências antigas e não executou smoke operacional. A pré-condição de
governança de migrations que bloqueava o 002C está agora satisfeita e
comprovada em Production.
