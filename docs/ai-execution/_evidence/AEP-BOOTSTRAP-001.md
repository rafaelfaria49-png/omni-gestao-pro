# AEP-BOOTSTRAP-001 — evidências literais

Bootstrap do **AEP/1.0-R2** (Agent Execution Protocol) no repositório OmniGestão Pro.

- worktree dedicada: `C:/Projetos/aep-bootstrap` · branch `chore/aep-bootstrap`
- base: `origin/main` = `2556d892cd8e9a5186e02d97574b547f0e2496d6`
- data: 2026-07-29 · node v24.14.1 · git 2.54.0.windows.1

Este arquivo guarda as **saídas literais completas** das doze validações. O relatório de
entrega aponta para cá e não repete saída nenhuma.

## Onde cada validação foi executada

| Onde | Validações |
| --- | --- |
| Worktree real `C:/Projetos/aep-bootstrap` (somente leitura + o commit final) | a, b, c, d, e, h, j, l |
| Repositórios Git **temporários** do fixture de `scripts/track.test.mjs` | f, g, i, k |

Nenhum commit simulado, nenhum código produtivo staged e nenhuma alteração de arquivo da
aplicação foi feita na worktree real. As evidências f, g, i e k são emitidas pelo próprio
`track.test.mjs` quando rodado com `AEP_EVIDENCE=1`, a partir dos repositórios
temporários que ele mesmo cria e descarta.

> Nota de formatação: o `node:test` indenta o stdout de cada teste com dois espaços.
> Na extração abaixo essa indentação de dois espaços foi removida; o conteúdo é literal.

---

## FASE 0 — pré-flight (saídas literais)

```text
$ git rev-parse --show-toplevel
C:/Projetos/omni-gestao

$ git status --porcelain      # WIP preexistente: REGISTRADO, não limpo, não stashado, não restaurado
 M docs/architecture/FISCAL_SECURITY.md
 M docs/architecture/INDEX.md
 M docs/architecture/NFCE_ARCHITECTURE.md
 M docs/audits/PDV_ACESSORIOS_MODELO_COR_AUDIT_001.md
 M docs/decisions/INDEX.md
 M docs/governance/MASTER_FISCAL_EXECUTION_PLAN.md
 M docs/roadmaps/ROADMAP_FISCAL.md
?? docs/audits/AUDITORIA_FISCAL_CUPOM_FINANCEIRO_STATUS_001.md
?? docs/audits/AUDITORIA_FISCAL_RECONCILIACAO_CODIGO_001.md
?? docs/audits/AUDITORIA_OMNI_AGENT_TO_PLATFORM_v01.md
?? docs/audits/AUDITORIA_PDV_TRIO_CODE_AUDIT_001_v01.md
?? docs/audits/CADASTROS_V2_PRODUTO_UPSERTPRODUTO_PARITY_AUDIT_001.md
?? docs/audits/CADASTROS_V2_PRODUTO_VARIACOES_UNIDADES_AUDIT_001.md
?? docs/audits/PDV_CAPABILITIES_MODULAR_SETTINGS_CURRENT_STATE_AUDIT_001.md
?? docs/context-packs/
?? docs/decisions/ADR-0010-supabase-vault-backend-kms-fiscal.md
?? docs/decisions/ADR-0011-sefaz-direta-homologacao-inicial.md
?? docs/decisions/ADR-0012-piloto-homologacao-sp-matriz-rafacell.md
?? e2e/specs/99-temp-manual-check.spec.ts

$ git worktree list | wc -l
125
   -> 125 worktrees ativas; nenhuma delas é ../aep-bootstrap (lista completa omitida por volume)

$ git fetch --prune origin
EXIT=0

$ git ls-remote --symref origin HEAD
ref: refs/heads/main	HEAD
2556d892cd8e9a5186e02d97574b547f0e2496d6	HEAD
   -> default branch remota CONFIRMADA: main (não presumida)

$ git branch --list chore/aep-bootstrap
(vazio)
$ git ls-remote --heads origin chore/aep-bootstrap
(vazio)
$ git worktree list --porcelain | grep -i aep
(vazio)
$ ls -d ../aep-bootstrap
ls: cannot access '../aep-bootstrap': No such file or directory
   -> ZERO colisão

$ git worktree add ../aep-bootstrap -b chore/aep-bootstrap origin/main
Preparing worktree (new branch 'chore/aep-bootstrap')
branch 'chore/aep-bootstrap' set up to track 'origin/main'.
HEAD is now at 2556d89 fix(vendas): corrigir gaps da infraestrutura de numeracao
EXIT=0
```

---

## a) `node --test` — todos passando

`node --test scripts/` **não funciona no Node ≥ 23**: a partir dessa versão os argumentos
posicionais de `node --test` são interpretados como **glob**, não como diretório a
percorrer, então `scripts/` não casa com arquivo nenhum e `scripts/**` varreria todos os
scripts do repositório que não são teste. O comando canônico equivalente, registrado em
`protocol.json.test_runner` e válido também no Node 20/22, é:

```text
$ node --test "scripts/*.test.mjs"
✔ path com glob não suportado falha com exit 1 antes de qualquer execução (1441.8076ms)
✔ bloco AEP:META ausente falha com exit 1 (1250.3607ms)
✔ bloco AEP:META duplicado falha com exit 1 apontando as linhas (1301.8745ms)
✔ bloco AEP:META malformado falha com exit 1 citando as linhas do miolo (1255.622ms)
✔ bloco AEP:META sem "-->" falha com exit 1 (1272.3836ms)
✔ open falha por branch errada com exit 5 e NÃO troca de branch (1974.1536ms)
✔ open falha por worktree divergente com exit 5 (1909.9756ms)
✔ open NÃO suja a árvore: git status --porcelain segue vazio (2246.1347ms)
✔ check falha com árvore suja (3257.1966ms)
✔ check falha quando o teste do GOAL falha e close ABORTA sem escrever (3294.0671ms)
✔ close com check verde ratifica, remove .aep-active e fecha o ÚLTIMO GOAL sem próximo (4260.6198ms)
✔ check acusa base_commit inexistente e commit em branch errada (4178.4989ms)
✔ check acusa caminho fora da allowlist e gate de caminho não liberado (3498.9395ms)
✔ teto de 3 tentativas: a falha que o esgota converte o GOAL em BLOCKED (exit 3) (3077.0209ms)
✔ SEM .aep-active: commit feat(...) tocando código produtivo passa normalmente (1640.2214ms)
✔ SEM .aep-active: modificar state.json à mão é RECUSADO pelo hook (exit 2) (1677.4231ms)
✔ SEM .aep-active: CRIAÇÃO de state.json/LEDGER/REGISTRY passa (sem exceção de bootstrap) (1197.2775ms)
✔ COM .aep-active: hook recusa CONJUNTO STAGED fora da allowlist (exit 2) (2430.5729ms)
✔ COM .aep-active: hook recusa caminho que bate em gate NÃO autorizado (exit 2) (2473.7622ms)
✔ ledger com linha deletada: hook recusa e, se contornado, check item 9 acusa (3434.8816ms)
✔ COM .aep-active: commit-msg exige goal(...) ou aep(...) (3054.8051ms)
✔ verify detecta state.json editado à mão e sai com 4 (1978.7959ms)
✔ verify detecta LEDGER.jsonl com linha ratificada removida (4003.1126ms)
✔ sync-adapters preserva conteúdo humano fora do bloco e é idempotente (1104.367ms)
✔ sync-adapters recusa bloco duplicado e marcador sem par, sem escrever nada (1064.044ms)
✔ status é somente leitura, cabe em 18 linhas e suporta --json (1818.3668ms)
✔ doctor emite AVISO de camada remota ausente e ainda assim retorna exit 0 (1540.9882ms)
✔ importador reconcilia DONE verificado, DONE sem prova, READY, SUPERSEDED e DRAFT (2682.1638ms)
✔ importador mantém no máximo 3 GOALs no caminho quente e reporta o excedente (2007.0496ms)
✔ importador recusa manifesto com path fora da gramática (exit 1) (1313.4118ms)
ℹ tests 30
ℹ suites 0
ℹ pass 30
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 67761.7324
```

---

## b) `node scripts/track.mjs doctor` — exit 0, com as duas seções

```text
AEP/1.0-R2 · doctor

== CAMADA LOCAL ==
  [OK ] node v24.14.1 (exigido >= 20)
         evidência: node --version
  [OK ] git disponível: git version 2.54.0.windows.1
         evidência: git --version
  [AVISO] core.hooksPath NÃO configurado — os hooks locais estão INATIVOS nesta worktree.
         evidência: git config core.hooksPath
         ação: git config core.hooksPath .githooks   (caminho RELATIVO, ver ADAPTERS.md)
  [INFO] caminho efetivo de hooks: C:/Projetos/omni-gestao/.git/hooks
         evidência: git rev-parse --git-path hooks
  [INFO] extensions.worktreeConfig: não definido
         evidência: git config extensions.worktreeConfig
  [OK ] .githooks/pre-commit presente (bit de execução não se aplica no Windows)
         evidência: ls -l .githooks/pre-commit
  [OK ] .githooks/commit-msg presente (bit de execução não se aplica no Windows)
         evidência: ls -l .githooks/commit-msg
  [OK ] protocol.json válido · runner de teste: node --test "scripts/*.test.mjs" · trilhas: contador
         evidência: cat docs/ai-execution/protocol.json
  [INFO] .aep-active: ausente — protocolo INATIVO (opt-in) nesta worktree
         evidência: ls .aep-active
  [INFO] versão do protocolo: AEP/1.0-R2
         evidência: node scripts/track.mjs doctor

== CAMADA REMOTA ==
  [OK ] remote origin presente
         evidência: git remote -v
  [AVISO] NENHUM workflow em .github/workflows/** contém literalmente "track.mjs verify"
         evidência: grep -rl "track.mjs verify" .github/workflows/
  [INFO] branch protection: NÃO VERIFICÁVEL LOCALMENTE (exige API do forge).
         evidência: —
  [INFO] protocol.json.remote_layer — CONFIRMAÇÃO DECLARADA, nunca fato verificado:
         ci_verify: false
         branch_protection_confirmada_por: null
         branch_protection_confirmada_em: null

  AVISO — CAMADA REMOTA NÃO CONFIGURADA.
  Os hooks locais protegem contra ACIDENTE e mantêm no trilho um agente COOPERATIVO.
  Eles NÃO são barreira contra um executor deliberadamente não cooperativo, que pode
  usar `git commit --no-verify`, definir `AEP_WRITE=1`, reapontar `core.hooksPath`,
  usar `--amend` ou manipular `.git` diretamente.
  A ratificação só vira GARANTIA com PR obrigatório + CI rodando `verify --all` +
  branch protection. Ver docs/ai-execution/EXECUTION_PROTOCOL.md § MODELO DE SEGURANÇA.
  Implantação da camada remota: Comando Mestre 3.
  Até lá, `verify --all` continua servindo para DETECTAR divergência depois do fato.

doctor: 2 aviso(s) — core.hooksPath ausente; CI verify ausente.
doctor NUNCA bloqueia o bootstrap local: exit 0.

$ echo $?
0
```

---

## c) `node scripts/track.mjs status contador` — PLANNED, sem inventar nada

Sem GOAL, sem ledger, sem commit, sem branch declarada: o esqueleto é honestamente vazio.
(`árvore 10 caminho(s) sujo(s)` é a própria infraestrutura do AEP ainda não commitada no
momento da captura.)

```text
AEP/1.0-R2 · trilha contador · 🟡 amarelo PLANNED
risco MEDIO · GOAL atual — · próximo —
ratificados: 0 DONE · 0 BLOCKED · 0 linhas de ledger
bootstrap_commit: (nenhum) · última ratificação: —
git: branch chore/aep-bootstrap · árvore 10 caminho(s) sujo(s)
sessão: nenhum GOAL aberto nesta worktree (.aep-active ausente)

ledger (últimas 0):
  (vazio)

próximo passo: nenhum GOAL elegível em docs/execution-tracks/contador/goals/ — planejamento humano.

$ echo $?
0
```

---

## d) `node scripts/track.mjs sync-adapters --check` — exit 0

```text
AEP/1.0-R2 · sync-adapters --check
  [OK] AGENTS.md — EM DIA
  [OK] CLAUDE.md — EM DIA
  [OK] GEMINI.md — EM DIA

O AEP escreve SOMENTE entre <!-- AEP:BEGIN --> e <!-- AEP:END -->.
Conteúdo humano fora dos marcadores nunca é removido, movido nem reordenado.

$ echo $?
0
```

---

## e) `node scripts/track.mjs verify --all` — exit 0

```text
AEP/1.0-R2 · verify --all
  [OK]   contador — state.json bate com o estado derivado; ledger append-only.
  [OK]   REGISTRY.md idêntico ao gerado.
  [OK]   GATES.md idêntico ao gerado a partir de protocol.json.

verify: sem divergências.

$ echo $?
0
```

---

## f) Com `.aep-active`, o hook recusa o CONJUNTO STAGED

O hook **não** consegue saber qual comando foi digitado — ele valida **apenas o conjunto
staged**. A regra "não use `git add .`" é operacional humana e vive no `ENTRYPOINT.md`.

### f1 — caminho fora da allowlist

```text
$ git add -- services/fora-da-allowlist.ts
$ git commit -m "goal(demo-001): caminho fora da allowlist"
$ exit 1
FALHA [2] gate violado
evidência: git diff --cached --name-only → services/fora-da-allowlist.ts
ação: Caminho staged fora da allowlist do GOAL demo-001. Remova do índice ou amplie a allowlist no GOAL (ato humano).
```

### f2 — caminho que bate em gate NÃO autorizado

```text
$ git add -- prisma/migrations/0001_init/migration.sql
$ git commit -m "goal(demo-001): migration nao autorizada"
$ exit 1
FALHA [2] gate violado
evidência: git diff --cached --name-only → G-DADOS-SCHEMA: prisma/migrations/0001_init/migration.sql
ação: Gate "G-DADOS-SCHEMA" não está em gates_liberados do GOAL demo-001. Pare e peça autorização humana.
```

---

## g) Sem `.aep-active` — opt-in preservado

### g1 — commit `feat(...)` tocando código produtivo passa normalmente

```text
$ git add -- app/produtivo.ts
$ git commit -m "feat(app): mexe em codigo produtivo sem AEP"
$ exit 0
[main 3add7a6] feat(app): mexe em codigo produtivo sem AEP
 1 file changed, 1 insertion(+), 1 deletion(-)
```

### g2 — modificar `state.json` à mão é RECUSADO pelo hook no fluxo normal

```text
$ git add -- docs/execution-tracks/demo/state.json
$ git commit -m "chore: mexe no state a mao"
$ exit 1
FALHA [2] gate violado
evidência: git diff --cached --name-only --diff-filter=MD → docs/execution-tracks/demo/state.json
ação: state.json, LEDGER.jsonl e REGISTRY.md são ratificados pelo AEP, não editados à mão. Use `close`/`block`/`registry`.
```

O teste `SEM .aep-active: CRIAÇÃO de state.json/LEDGER/REGISTRY passa` prova o
complemento: **criação** (`--diff-filter=A`) passa naturalmente, que é como o commit de
bootstrap atravessa o hook. **Não existe nenhuma exceção de bootstrap** — nenhuma flag,
variável ou modo especial que precise ser desativado depois.

### g3 — o próprio commit deste bootstrap atravessa o hook naturalmente

Executado na worktree real, em **dry-run** (o comando `hook` só lê o índice; não commita,
não escreve nada) sobre o conjunto staged real desta entrega:

```text
$ node scripts/track.mjs hook pre-commit
$ echo $?
0

$ git diff --cached --name-only --diff-filter=MD    # modificados/deletados
.gitignore
CLAUDE.md
   -> nenhum arquivo imutável (state.json / LEDGER.jsonl / REGISTRY.md) é MODIFICADO ou DELETADO

$ git diff --cached --name-only --diff-filter=A | grep -E "state.json|LEDGER.jsonl|REGISTRY.md"
docs/execution-tracks/REGISTRY.md
docs/execution-tracks/contador/LEDGER.jsonl
docs/execution-tracks/contador/state.json
   -> os três são CRIAÇÃO (filtro A) e, sem .aep-active, passam sem nenhuma exceção especial
```

---

## h) `CLAUDE.md` preexistente 100% preservado, bloco acrescentado ao FINAL

```text
# O CLAUDE.md original foi copiado para fora do repo ANTES de qualquer escrita do AEP.
# Tamanho original: 12871 bytes.

$ git diff --numstat -- CLAUDE.md      # colunas: linhas ADICIONADAS / REMOVIDAS
16	0	CLAUDE.md
   -> 0 remoções: nada foi apagado, movido, reordenado ou reescrito.

$ sha256sum <copia intacta do original>
86704bf1fd2d471a4b8537df553acfed07cd6a1afb350fcfedb19eeadf13daf5 *-
$ head -c 12871 CLAUDE.md | sha256sum      # os primeiros 12871 bytes do arquivo ATUAL
86704bf1fd2d471a4b8537df553acfed07cd6a1afb350fcfedb19eeadf13daf5 *-
   -> hashes IDÊNTICOS: o conteúdo original é prefixo byte-a-byte do arquivo atual.

$ diff -u <original> CLAUDE.md
--- C:/Users/rafae/AppData/Local/Temp/claude/C--Projetos-omni-gestao/e01ff0ce-a84f-4a82-a61e-2ba5f2a9ba01/scratchpad/CLAUDE.md.orig	2026-07-28 23:52:48.601268200 -0300
+++ CLAUDE.md	2026-07-29 00:14:32.556509400 -0300
@@ -214,3 +214,19 @@
 - `docs/architecture/BACKEND.md` — backend services breakdown
 - `docs/modules/FINANCEIRO.md` / `docs/modules/OPERACOES.md` — module-level detail
 - `docs/modules/reports/` — 15+ targeted technical reports on specific features
+
+<!-- AEP:BEGIN -->
+## Protocolo de execução — AEP/1.0-R2
+
+Antes de qualquer tarefa neste repositório, leia `docs/ai-execution/ENTRYPOINT.md`.
+
+- início: `node scripts/track.mjs status <trilha>` e depois `node scripts/track.mjs open <trilha>`
+- término: `node scripts/track.mjs close <trilha>`
+- regra 1: escreva apenas dentro da allowlist impressa pelo `open`.
+- regra 2: adicione por caminho explícito — nunca `git add .`, `git add -A` ou `git commit -a`.
+- regra 3: gate não liberado no GOAL = pare e peça autorização humana.
+
+O protocolo é OPT-IN: sem `.aep-active` nesta worktree, nada aqui se aplica.
+Este bloco é GERADO. A governança completa NÃO está aqui — está em `docs/ai-execution/`.
+Adaptador: CLAUDE.md — Claude Code. A governança do repositório acima deste bloco continua valendo.
+<!-- AEP:END -->
```

---

## i) Importador funcional — classificação correta dos cinco casos

```text
$ node scripts/track.mjs import demo --manifest=import/demo/MANIFEST.json
$ exit 0
AEP/1.0-R2 · import demo · manifesto import/demo/MANIFEST.json
confirmados (DONE):   1 → demo-001
divergentes (BLOCKED):3 → demo-002[divergencia], demo-004[divergencia], demo-006[decisao]
superados (SUPERSEDED):1 → demo-005
prontos (READY, quente):1 → demo-003
pendentes (DRAFT):    1 → demo-007
reconciliação: docs/execution-tracks/demo/_closed/reports/RECONCILIACAO.md
proveniência:  docs/execution-tracks/demo/_closed/reports/IMPORT-1-MANIFEST.json
state.json: status RUNNING · current_goal demo-003
commit de estado: 2cb017c642bd0d85e2ec9fd2bb0551973bf5cce8
```

```text
$ cat docs/execution-tracks/demo/_closed/reports/RECONCILIACAO.md
# Reconciliação de importação — trilha `demo`

- importação nº 1 · 2026-07-29T09:39:34.380Z
- plano: `docs/planos/PLANO_DEMO.md` (plan_rev 3)
- bootstrap_commit declarado: `67beea836458e856abe30f6ea5c3a5e2984d2cdd`
- manifesto (proveniência): `docs/execution-tracks/demo/_closed/reports/IMPORT-1-MANIFEST.json`
- o diretório `import/` é gitignored; o manifesto bruto NÃO é commitado.

## 1. Confirmados (DONE com prova no Git)

- `demo-001` → DONE · commit `0c96cd778ec0ffce7e38a5c98a65b1edd65b4973` · branch `goal/demo-001`
- evidência: `git merge-base --is-ancestor 0c96cd778ec0ffce7e38a5c98a65b1edd65b4973 goal/demo-001` → commit existe e está na branch declarada

## 2. Divergentes (BLOCKED — nunca presumidos DONE)

- `demo-002` → BLOCKED (`divergencia`) · DONE sem prova no Git
- evidência: `git cat-file -e ffffffffffffffffffffffffffffffffffffffff^{commit}` → fatal: Not a valid object name ffffffffffffffffffffffffffffffffffffffff^{commit}
- `demo-004` → BLOCKED (`divergencia`) · DONE sem prova no Git
- evidência: `git merge-base --is-ancestor af46ec838cb767353307d972826221b1827b4c2a goal/demo-004` → fatal: Not a valid object name goal/demo-004
- `demo-006` → BLOCKED (`decisao`) · no manifesto mas não no plano
- evidência: `grep -n "demo-006" docs/planos/PLANO_DEMO.md` → ausente em plano_ids

## 3. Pendentes de planejamento (DRAFT — fora de goals/)

- `demo-007` — no plano mas não declarado no manifesto → DRAFT

## 4. Superados (SUPERSEDED → _closed/goals/)

- `demo-005` — plan_rev 2 < 3

## 5. Caminho quente após a importação

- `demo-003` → `docs/execution-tracks/demo/goals/demo-003.md` (READY)
```

```text
$ cat docs/execution-tracks/demo/LEDGER.jsonl
{"aep":"1.0-R2","ts":"2026-07-29T09:39:34.380Z","track":"demo","goal":"demo-001","result":"DONE","attempt":1,"source":"importado","bootstrap_commit":"67beea836458e856abe30f6ea5c3a5e2984d2cdd","branch":"goal/demo-001","head_commit":"0c96cd778ec0ffce7e38a5c98a65b1edd65b4973","plan_ref":"docs/planos/PLANO_DEMO.md","plan_rev":3,"evidencia":{"cmd":"git merge-base --is-ancestor 0c96cd778ec0ffce7e38a5c98a65b1edd65b4973 goal/demo-001","out":"commit existe e está na branch declarada"}}
{"aep":"1.0-R2","ts":"2026-07-29T09:39:34.380Z","track":"demo","goal":"demo-005","result":"SUPERSEDED","attempt":1,"source":"importado","bootstrap_commit":"67beea836458e856abe30f6ea5c3a5e2984d2cdd","plan_ref":"docs/planos/PLANO_DEMO.md","plan_rev":3,"superseded_from_rev":2}
{"aep":"1.0-R2","ts":"2026-07-29T09:39:34.380Z","track":"demo","goal":"demo-002","result":"BLOCKED","attempt":1,"source":"importado","blocked_by":"divergencia","reason":"DONE sem prova no Git","bootstrap_commit":"67beea836458e856abe30f6ea5c3a5e2984d2cdd","plan_ref":"docs/planos/PLANO_DEMO.md","plan_rev":3,"evidencia":{"cmd":"git cat-file -e ffffffffffffffffffffffffffffffffffffffff^{commit}","out":"fatal: Not a valid object name ffffffffffffffffffffffffffffffffffffffff^{commit}"}}
{"aep":"1.0-R2","ts":"2026-07-29T09:39:34.380Z","track":"demo","goal":"demo-004","result":"BLOCKED","attempt":1,"source":"importado","blocked_by":"divergencia","reason":"DONE sem prova no Git","bootstrap_commit":"67beea836458e856abe30f6ea5c3a5e2984d2cdd","plan_ref":"docs/planos/PLANO_DEMO.md","plan_rev":3,"evidencia":{"cmd":"git merge-base --is-ancestor af46ec838cb767353307d972826221b1827b4c2a goal/demo-004","out":"fatal: Not a valid object name goal/demo-004"}}
{"aep":"1.0-R2","ts":"2026-07-29T09:39:34.380Z","track":"demo","goal":"demo-006","result":"BLOCKED","attempt":1,"source":"importado","blocked_by":"decisao","reason":"no manifesto mas não no plano","bootstrap_commit":"67beea836458e856abe30f6ea5c3a5e2984d2cdd","plan_ref":"docs/planos/PLANO_DEMO.md","plan_rev":3,"evidencia":{"cmd":"grep -n \"demo-006\" docs/planos/PLANO_DEMO.md","out":"ausente em plano_ids"}
```

Mapa do que foi provado:

| Caso | GOAL | Resultado | Evidência Git |
| --- | --- | --- | --- |
| DONE com commit que existe e está na branch declarada | `demo-001` | **DONE** (`source: importado`, com `bootstrap_commit`) → `_closed/goals/` | `git merge-base --is-ancestor <sha> goal/demo-001` |
| DONE com commit **inexistente** | `demo-002` | **BLOCKED** `divergencia` | `git cat-file -e ffff…^{commit}` → *Not a valid object name* |
| DONE com commit real **fora da branch declarada** | `demo-004` | **BLOCKED** `divergencia` | `git merge-base --is-ancestor …` → falha |
| READY | `demo-003` | arquivo em `goals/` | — |
| Superado por `plan_rev` mais novo | `demo-005` | **SUPERSEDED** → `_closed/goals/` | `plan_rev 2 < 3` |
| No manifesto, fora do plano | `demo-006` | **BLOCKED** `decisao` | ausente em `plano_ids` |
| No plano, fora do manifesto | `demo-007` | **DRAFT** — pendência, fora de `goals/` | — |

Nenhum `DONE` foi presumido. Os limites duros também estão sob teste: o commit de estado
só toca `docs/execution-tracks/**`, `import/` é gitignored e não entra no commit, o
manifesto é copiado para `_closed/reports/IMPORT-1-MANIFEST.json` como proveniência, e o
caminho quente é limitado a 3 GOALs (teste dedicado).

---

## j) Nenhum arquivo de código produtivo foi tocado

```text
$ git diff --cached --name-status      # conjunto staged completo
A	.githooks/commit-msg
A	.githooks/pre-commit
M	.gitignore
A	AGENTS.md
M	CLAUDE.md
A	GEMINI.md
A	docs/ai-execution/ADAPTERS.md
A	docs/ai-execution/ENTRYPOINT.md
A	docs/ai-execution/EXECUTION_PROTOCOL.md
A	docs/ai-execution/GATES.md
A	docs/ai-execution/TASK_LEVELS.md
A	docs/ai-execution/_evidence/.gitkeep
A	docs/ai-execution/_evidence/AEP-BOOTSTRAP-001.md
A	docs/ai-execution/executors.json
A	docs/ai-execution/protocol.json
A	docs/execution-tracks/REGISTRY.md
A	docs/execution-tracks/contador/LEDGER.jsonl
A	docs/execution-tracks/contador/TRACK.md
A	docs/execution-tracks/contador/_closed/goals/.gitkeep
A	docs/execution-tracks/contador/_closed/reports/.gitkeep
A	docs/execution-tracks/contador/goals/.gitkeep
A	docs/execution-tracks/contador/state.json
A	scripts/track.mjs
A	scripts/track.test.mjs

$ git diff --cached --stat -- app components lib src pages hooks services types prisma e2e public styles data tools design auth.ts auth.config.ts proxy.ts next.config.mjs package.json package-lock.json tsconfig.json vercel.json .github .env.example
[saída VAZIA acima = NENHUM arquivo de código produtivo, schema, config, CI ou deploy foi tocado]

$ git diff --stat      # árvore de trabalho x índice (nada pendente fora do staged)
[vazio]

$ git status --porcelain --untracked-files=all | grep -v "^A "  # nada além do staged
A  .githooks/commit-msg
A  .githooks/pre-commit
M  .gitignore
A  AGENTS.md
M  CLAUDE.md
A  GEMINI.md
A  docs/ai-execution/ADAPTERS.md
A  docs/ai-execution/ENTRYPOINT.md
A  docs/ai-execution/EXECUTION_PROTOCOL.md
A  docs/ai-execution/GATES.md
A  docs/ai-execution/TASK_LEVELS.md
A  docs/ai-execution/_evidence/.gitkeep
A  docs/ai-execution/_evidence/AEP-BOOTSTRAP-001.md
A  docs/ai-execution/executors.json
A  docs/ai-execution/protocol.json
A  docs/execution-tracks/REGISTRY.md
A  docs/execution-tracks/contador/LEDGER.jsonl
A  docs/execution-tracks/contador/TRACK.md
A  docs/execution-tracks/contador/_closed/goals/.gitkeep
A  docs/execution-tracks/contador/_closed/reports/.gitkeep
A  docs/execution-tracks/contador/goals/.gitkeep
A  docs/execution-tracks/contador/state.json
A  scripts/track.mjs
A  scripts/track.test.mjs
```

---

## k) `git status --porcelain` vazio logo após um `open`

```text
$ node scripts/track.mjs open demo
AEP/1.0-R2 · open demo · GOAL demo-001 — GOAL de fixture

LEIA EXATAMENTE UM ARQUIVO DE GOAL:
C:/Users/rafae/AppData/Local/Temp/aep-test-jDqCJ8/repo/docs/execution-tracks/demo/goals/demo-001.md

branch:        goal/demo-001   (atual: goal/demo-001)
worktree:      C:/Users/rafae/AppData/Local/Temp/aep-test-jDqCJ8/repo
base_commit:   3de36dfd00e9f48672b816a2a1b5cb8f3fc2ee1b   (git merge-base HEAD origin/main)
tentativa:     1/3
teste do GOAL: node scripts/goal-test.mjs
orçamento de leitura declarado: 4 arquivo(s)

allowlist (única superfície de escrita permitida):
app/**
gates liberados por este GOAL:
(nenhum)

CLASSIFICAÇÃO (8 campos — ver docs/ai-execution/TASK_LEVELS.md):
1 classe:                 C2
2 revisão independente R: não
3 família do executor:    (não declarada)
4 risco:                  MEDIO
5 superfície:             1 padrão(ões) de caminho
6 reversibilidade:        (não declarada)
7 gates envolvidos:       (nenhum)
8 orçamento de leitura:   4

REGRAS DA SESSÃO:
· escreva apenas dentro da allowlist acima;
· adicione por caminho explícito — nunca `git add .`, `git add -A` ou `git commit -a`;
· mensagem do commit do agente: `goal(<trilha>-<nnn>): ...`;
· gate não liberado = pare e peça autorização humana, não contorne;
· terminou: node scripts/track.mjs close demo   (roda check antes de ratificar);
· falhou: node scripts/track.mjs attempt demo --fail --reason="..."

.aep-active escrito (gitignored). Nenhum arquivo versionado foi tocado.

$ git status --porcelain
[saída literal: ""]
$ ls .aep-active
.aep-active (presente, gitignored)
```

---

## l) `doctor` avisa da camada remota ausente e ainda assim retorna exit 0

A saída completa está na validação (b). Os trechos decisivos:

```text
  [AVISO] NENHUM workflow em .github/workflows/** contém literalmente "track.mjs verify"
         evidência: grep -rl "track.mjs verify" .github/workflows/
  [INFO] branch protection: NÃO VERIFICÁVEL LOCALMENTE (exige API do forge).
  [INFO] protocol.json.remote_layer — CONFIRMAÇÃO DECLARADA, nunca fato verificado:
         ci_verify: false
         branch_protection_confirmada_por: null
         branch_protection_confirmada_em: null

  AVISO — CAMADA REMOTA NÃO CONFIGURADA.
  Os hooks locais protegem contra ACIDENTE e mantêm no trilho um agente COOPERATIVO.
  Eles NÃO são barreira contra um executor deliberadamente não cooperativo, que pode
  usar `git commit --no-verify`, definir `AEP_WRITE=1`, reapontar `core.hooksPath`,
  usar `--amend` ou manipular `.git` diretamente.
  A ratificação só vira GARANTIA com PR obrigatório + CI rodando `verify --all` +
  branch protection. Ver docs/ai-execution/EXECUTION_PROTOCOL.md § MODELO DE SEGURANÇA.
  Implantação da camada remota: Comando Mestre 3.
  Até lá, `verify --all` continua servindo para DETECTAR divergência depois do fato.

doctor: 2 aviso(s) — core.hooksPath ausente; CI verify ausente.
doctor NUNCA bloqueia o bootstrap local: exit 0.

$ echo $?
0
```

---

## Decisões e limites registrados neste bootstrap

1. **`core.hooksPath` NÃO foi configurado.** `git config core.hooksPath .githooks` grava no
   `.git` **comum**, compartilhado pelas 126 worktrees vivas deste repositório. Ativar os
   hooks é decisão humana e fica fora do escopo desta tarefa; o `doctor` avisa e imprime o
   comando exato. Como o caminho é relativo, worktrees em branches anteriores ao AEP não
   têm `.githooks/` e continuam commitando normalmente — a propriedade de opt-in que
   `ADAPTERS.md` documenta.
2. **Runner de teste**: `node --test "scripts/*.test.mjs"` (ver validação (a)).
3. **Teto de tentativas**: 3. A falha registrada na tentativa 3 esgota o teto e converte o
   GOAL em `BLOCKED` com exit 3.
4. **Ritual de planejamento**: adicionar/remover GOAL em `goals/` muda o estado derivado
   sem passar por `close`. `registry` reescreve `state.json` e a ratificação usa
   `AEP_WRITE=1` — que é fluxo interno **declarado**, não segredo.
5. **Camada remota NÃO implantada**: sem workflow de CI, sem branch protection, sem
   qualquer chamada de API. É o Comando Mestre 3.
