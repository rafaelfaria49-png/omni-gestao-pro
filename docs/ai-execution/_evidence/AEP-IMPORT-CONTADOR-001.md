# AEP-IMPORT-CONTADOR-001 — evidências da importação da trilha `contador`

- protocolo: AEP/1.0-R2
- bootstrap_commit: `d4817244c8d1f4fdabb2773e419e2910ac62658a`
- plan_ref: `CONTADOR-HUB-FABLE5-MASTERPLAN-001` · plan_rev: `1`
- worktree: `C:/Projetos/aep-import-contador` · branch: `chore/aep-import-contador`
- data: 2026-07-29

> **RESULTADO DA RODADA 1 (2026-07-29): IMPORTAÇÃO BLOQUEADA.** O importador recusou o
> manifesto e nada foi escrito em `state.json`, `LEDGER.jsonl` ou `REGISTRY.md`. A trilha
> permanece `PLANNED`, exatamente como no commit de bootstrap. Os defeitos estão na seção 9.
> Nenhum arquivo de estado foi editado à mão.
>
> **SUPERADO PELA RODADA 2 (2026-07-30): IMPORTAÇÃO CONCLUÍDA** — ver **seção 11**. As
> seções 1–10 abaixo ficam preservadas como registro histórico da tentativa bloqueada;
> não foram reescritas.

---

## a) Fase 0 — cadeia de proveniência até o commit de bootstrap

### Passo 1 — o commit existe

```
$ git rev-parse --verify "d4817244c8d1f4fdabb2773e419e2910ac62658a^{commit}"
d4817244c8d1f4fdabb2773e419e2910ac62658a
```

### Passo 2 — onde ele está e o que é

```
$ git branch --contains d4817244c8d1f4fdabb2773e419e2910ac62658a
+ chore/aep-bootstrap

$ git log -1 --format='%H%n%ad%n%s' d4817244c8d1f4fdabb2773e419e2910ac62658a
d4817244c8d1f4fdabb2773e419e2910ac62658a
Wed Jul 29 06:43:13 2026 -0300
aep(bootstrap): implanta AEP/1.0-R2 e esqueleto da trilha contador
```

Mensagem confere com a esperada.

### Passo 3 — a infraestrutura está no commit (sem checkout)

```
$ git cat-file -e d4817244:scripts/track.mjs                             → OK
$ git cat-file -e d4817244:docs/ai-execution/protocol.json               → OK
$ git cat-file -e d4817244:.githooks/pre-commit                          → OK
$ git cat-file -e d4817244:docs/execution-tracks/contador/TRACK.md       → OK
```

### Passo 4 — versão do protocolo

```
$ git show d4817244:docs/ai-execution/protocol.json
{
  "aep": "1.0-R2",
  ...
  "test_runner": "node --test \"scripts/*.test.mjs\"",
  "max_hot_goals": 3,
  "gates": [ G-DADOS-SCHEMA, G-DADOS-SEED, G-AUTH, G-CI, G-CONFIG-DEPLOY, G-AEP-CORE ]
  ...
}
```

`"aep": "1.0-R2"` — confere. Os **seis** IDs de gate acima são o vocabulário
completo de gates do protocolo neste commit (relevante para o defeito D1).

### Passo 5 — fetch

```
$ git fetch --prune origin
EXIT=0
```

### Passo 6 — worktrees e estado

`git worktree list` retornou 130 worktrees pré-existentes; nenhuma foi tocada,
limpa, restaurada ou incorporada. O `git status --porcelain` do repositório
primário apresentava WIP não relacionado (docs fiscais/auditorias), preservado
intacto.

### Passo 7 — colisão

```
$ git rev-parse --verify refs/heads/chore/aep-import-contador
fatal: Needed a single revision                → branch não existe (OK)

$ ls -d /c/Projetos/aep-import-contador
No such file or directory                      → path não existe (OK)
```

### Passo 8 — worktree dedicada a partir do commit de bootstrap

```
$ git worktree add /c/Projetos/aep-import-contador -b chore/aep-import-contador d4817244c8d1f4fdabb2773e419e2910ac62658a
Preparing worktree (new branch 'chore/aep-import-contador')
HEAD is now at d481724 aep(bootstrap): implanta AEP/1.0-R2 e esqueleto da trilha contador
EXIT=0
```

### Passo 9 — infraestrutura viva na worktree

`node scripts/track.mjs doctor` → **exit 0**, 2 avisos:

- `[AVISO] core.hooksPath NÃO configurado — os hooks locais estão INATIVOS nesta worktree.`
- `[AVISO] NENHUM workflow em .github/workflows/** contém literalmente "track.mjs verify"`
  (camada remota — esperado nesta fase, implantação é do Comando Mestre 3)

O aviso de `core.hooksPath` **não foi corrigido de propósito**: `git config
core.hooksPath` sem `extensions.worktreeConfig` é global ao repositório e
afetaria as outras 130 worktrees do usuário. Fica registrado como pendência.

---

## b) `node --test "scripts/*.test.mjs"` — runner do protocol.json

```
ℹ tests 30
ℹ suites 0
ℹ pass 30
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 217789.6789
EXIT=0
```

Nota: a suíte leva ~218 s. `node --test scripts/` (forma citada no comando) não
encontra nada no Node 24 — o runner correto é o declarado em `protocol.json`.

## c) `node scripts/track.mjs verify --all`

```
AEP/1.0-R2 · verify --all
  [OK]   contador — state.json bate com o estado derivado; ledger append-only.
  [OK]   REGISTRY.md idêntico ao gerado.
  [OK]   GATES.md idêntico ao gerado a partir de protocol.json.

verify: sem divergências.
EXIT=0
```

## d) `node scripts/track.mjs status contador`

```
AEP/1.0-R2 · trilha contador · 🟡 amarelo PLANNED
risco MEDIO · GOAL atual — · próximo —
ratificados: 0 DONE · 0 BLOCKED · 0 linhas de ledger
bootstrap_commit: (nenhum) · última ratificação: —
git: branch chore/aep-import-contador · árvore limpa
sessão: nenhum GOAL aberto nesta worktree (.aep-active ausente)

ledger (últimas 0):
  (vazio)

próximo passo: nenhum GOAL elegível em docs/execution-tracks/contador/goals/ — planejamento humano.
EXIT=0
```

Coerente com o bloqueio: a importação não ocorreu, logo o estado é o do bootstrap.

## e) contagem de arquivos em `goals/`

```
$ ls -1 docs/execution-tracks/contador/goals/ | sed '/^$/d' | wc -l
0
```

0 ≤ 3 — teto respeitado (por ausência de importação).

---

## f) Prova Git de CADA GOAL declarado `DONE` no manifesto

Referência: `origin/main = 2556d892cd8e9a5186e02d97574b547f0e2496d6`
(`fix(vendas): corrigir gaps da infraestrutura de numeracao`, Tue Jul 28 20:51:29 2026 -0300).

Estas provas foram levantadas de forma **independente do importador**, com o
mesmo trio de comandos que ele usa internamente (`verifyCommit`, track.mjs:1774).

### CONFIRMADOS (9)

| GOAL | commit | `--is-ancestor origin/main` | assunto |
|---|---|---|---|
| CONTADOR-HUB-HONESTY-ROUTE-SAFETY-002 | `7310d9e6…3024ab1a` | exit 0 | feat(contador): reforcar honestidade visual do preview |
| CONTADOR-HUB-P0-AUTH-EXTERNA-003 | `a23c0f8a…a3b66dd6` | exit 0 | fix(contador): endurecer autenticacao do portal legado |
| CONTADOR-HUB-P0-STORE-SCOPE-004 | `066e9f23…14b6b54c` | exit 0 | fix(security): exigir ACL de loja nas leituras operacionais do contador |
| CONTADOR-HUB-COMPETENCIA-CONTRATOS-005 | `50c1db82…57130f24` | exit 0 | feat(contador): contrato canônico de competência mensal (GOAL 005) |
| CONTADOR-HUB-DADOS-REAIS-READONLY-006 | `4f901968…81c1d0c4` | exit 0 | test(contador): fechar matriz civil e serializacao do GOAL 006 |
| CONTADOR-HUB-FECHAMENTO-READONLY-007 | `7217acbf…38f6922f8` | exit 0 | fix(contador): alinhar semantica do fechamento read-only (GOAL 007B) |
| CONTADOR-HUB-PACOTE-EXPORT-MVP-008 | `ab0b754e…cc483e0a` | exit 0 | fix(contador): fechar integridade dos limites do pacote MVP (GOAL 008D) |
| CONTADOR-HUB-SCHEMA-NUCLEO-009 | `2d808c44…c29ab6e6` | exit 0 | feat(contador): criar schema nucleo do dominio contador |
| CONTADOR-HUB-STATUS-COMENTARIOS-011 | `1f1190a0…380ec11c` | exit 0 | feat(contador): adicionar status, comentarios e timeline reais |

Saídas literais (trio completo por GOAL), formato:

```
$ git rev-parse --verify <sha>^{commit}           → <sha>            (existe)
$ git merge-base --is-ancestor <sha> origin/main  → exit 0           (na branch declarada)
$ git log -1 --format='%H %ad %s' <sha>           → <sha> <data> <assunto>
```

Exemplo integral (CONTADOR-HUB-STATUS-COMENTARIOS-011):

```
$ git rev-parse --verify 1f1190a078ea54e2092da02ce844856f380ec11c^{commit}
1f1190a078ea54e2092da02ce844856f380ec11c
$ git merge-base --is-ancestor 1f1190a078ea54e2092da02ce844856f380ec11c origin/main
exit=0 (ANCESTRAL de origin/main)
$ git log -1 --format='%H %ad %s' 1f1190a078ea54e2092da02ce844856f380ec11c
1f1190a078ea54e2092da02ce844856f380ec11c Tue Jul 28 00:54:22 2026 -0300 feat(contador): adicionar status, comentarios e timeline reais
```

---

## g) DIVERGÊNCIAS — comando e saída literal

### DIV-1 · `CONTADOR-HUB-STATUS-RECONCILE-001` — DONE sem prova na branch declarada

O manifesto afirma: `situacao: DONE`, `commit f56039918fb34a45e7f7790e861f0d871832469b`,
`branch origin/main`.

O Git mostra: o commit **existe**, mas **não está em `origin/main`**.

```
$ git rev-parse --verify f56039918fb34a45e7f7790e861f0d871832469b^{commit}
f56039918fb34a45e7f7790e861f0d871832469b

$ git merge-base --is-ancestor f56039918fb34a45e7f7790e861f0d871832469b origin/main
exit=1 (NAO ancestral de origin/main)

$ git log -1 --format='%H %ad %s' f56039918fb34a45e7f7790e861f0d871832469b
f56039918fb34a45e7f7790e861f0d871832469b Sun Jul 12 11:29:52 2026 -0300 docs(contador): reconciliar estado do Contador HUB e tracking de mocks (GOAL 001)

$ git branch --all --contains f56039918fb34a45e7f7790e861f0d871832469b
+ goal/contador-001-status-reconcile
  remotes/origin/goal/contador-001-status-reconcile

$ git cat-file -e origin/main:docs/contador/CONTADOR_HUB_STATUS_RECONCILE_001.md
fatal: path 'docs/contador/CONTADOR_HUB_STATUS_RECONCILE_001.md' does not exist in 'origin/main'
```

**Leitura:** o GOAL 001 vive apenas na sua própria branch (local e remota) e
nunca foi integrado à `main`. Classificação obrigatória: **BLOCKED /
`divergencia`** — jamais DONE. O que precisa de decisão humana: integrar
`goal/contador-001-status-reconcile` à `main`, ou corrigir a branch declarada
no manifesto para a branch onde o commit de fato está.

**Consequência colateral, já observada:** por isso o arquivo
`docs/contador/CONTADOR_HUB_STATUS_RECONCILE_001.md` está **ausente do commit de
bootstrap** — ele nunca chegou à linha principal. Ver seção 8 (proveniência).

---

## h) `git diff --stat` — nenhum código produtivo tocado

```
$ git diff --stat
(vazio)

$ git diff --stat --cached
(apenas docs/ai-execution/_evidence/AEP-IMPORT-CONTADOR-001.md — este arquivo)
```

Nenhum arquivo sob `app/`, `lib/`, `components/`, `prisma/`, `scripts/`,
`auth*.ts`, `proxy.ts`, `.github/` foi lido-para-escrita, alterado ou encenado.
Nenhuma migration, `.env`, secret ou configuração de CI foi tocada.

## i) `git status --porcelain` ao final

Após o commit desta tarefa: vazio, salvo o conteúdo **gitignored** de `import/`
(`.gitignore:52 → import/`), que por definição não aparece e não é commitado.

```
$ git check-ignore -v import/contador/MANIFEST.json
.gitignore:52:import/	import/contador/MANIFEST.json
```

---

## 8) Fase 1A — pacote canônico de entrada

`AEP_IMPORT_PACKAGE = C:\Users\rafae\Downloads\CONTADOR_HUB_AEP_IMPORT_READY_2026-07-29.zip`
(caminho absoluto, existente, nome conforme, 22018 bytes). Conteúdo do ZIP:

```
      1749  import/contador/SOURCE_MAP.md
      3182  import/contador/MANIFEST.json
     57790  import/contador/RESUMO.md
       166  import/contador/reports/README.md
```

Os quatro arquivos exigidos foram produzidos na extração.

### MANIFEST.json — validação dos campos exigidos

| campo | valor | veredito |
|---|---|---|
| `aep` | `1.0-R2` | OK |
| `track` | `contador` | OK |
| `bootstrap_commit` | `d4817244c8d1f4fdabb2773e419e2910ac62658a` | OK — idêntico a `AEP_BOOTSTRAP_COMMIT` |
| `plan_ref` | `CONTADOR-HUB-FABLE5-MASTERPLAN-001` | OK |
| `plan_rev` | `1` | OK |

`paths_base` respeita a gramática limitada (caminho exato ou prefixo terminado
em `/**`): 7 prefixos `**`, 1 caminho exato (`prisma/schema.prisma`), 1 prefixo
`prisma/migrations/0014_contador_hub_nucleo/**`. Aceito.

### MASTERPLAN.md — cópia byte-preservada

```
$ git show d4817244:docs/contador/CONTADOR_HUB_FABLE5_MASTERPLAN_001.md   → 38006 bytes
$ git show d4817244:docs/contador/CONTADOR_HUB_ADRS_PROPOSTOS_001.md      → 18398 bytes
                                              import/contador/MASTERPLAN.md = 56404 bytes
```

38006 + 18398 = 56404 — concatenação exata, sem resumo.

### COMANDOS.md — cópia byte-preservada

`CONTADOR_HUB_IMPLEMENTATION_GOALS_001.md` + `CONTADOR_HUB_COMMANDS_001.md` +
seção `# 5. Próximos GOALs reais` do RESUMO.md (linhas 684–815, encerrando
imediatamente antes de `# 6. Decisões e guardrails` na linha 816) = 132907 bytes.
Nenhum ID foi alterado.

### reports/ — proveniência

Do commit de bootstrap:

- `CONTADOR_HUB_DADOS_REAIS_READONLY_006.md` (18927 b)
- `CONTADOR_HUB_STATUS_COMENTARIOS_011.md` (18019 b)
- `0014_contador_hub_nucleo__migration.sql` (19285 b)

Da linha 012E — **ref (a), a de maior preferência**, validado:

```
$ git rev-parse --verify goal/contador-012e-r2-safety-corrections^{commit}
18a4d8539f670eb77a0db44addeb6729e22e1d76
```

- `CONTADOR_HUB_FECHAMENTO_SNAPSHOT_012.md` (24337 b)
- `CONTADOR_HUB_STORAGE_PROVIDER_DECISION_012B.md` (45892 b)

Ambos presentes no ref (a); não foi necessário recorrer a (b) ou (c).

**Desvio registrado (DESV-1):** `CONTADOR_HUB_STATUS_RECONCILE_001.md` **não
existe no commit de bootstrap**:

```
$ git ls-tree --name-only d4817244:docs/contador/
CONTADOR_HUB_ADRS_PROPOSTOS_001.md
CONTADOR_HUB_COMMANDS_001.md
CONTADOR_HUB_DADOS_REAIS_READONLY_006.md
CONTADOR_HUB_FABLE5_MASTERPLAN_001.md
CONTADOR_HUB_IMPLEMENTATION_GOALS_001.md
CONTADOR_HUB_STATUS_COMENTARIOS_011.md

$ git log --all --oneline --diff-filter=A -- docs/contador/CONTADOR_HUB_STATUS_RECONCILE_001.md
f560399 docs(contador): reconciliar estado do Contador HUB e tracking de mocks (GOAL 001)
```

O arquivo existe **somente** em `f560399` — o mesmo commit que o manifesto
declara como GOAL 001. A cópia de proveniência foi feita de lá
(`git show f5603991…:docs/contador/CONTADOR_HUB_STATUS_RECONCILE_001.md`),
byte-preservada, sem invenção de conteúdo. `SOURCE_MAP.md` do pacote prevê
"copiar **quando existirem**". Este desvio é a mesma raiz de **DIV-1**.

Cópia adicional exigida: `RESUMO.md` →
`reports/CONTADOR_HUB_AEP_CANONICAL_IMPORT_PACKAGE_2026-07-29.md` (57790 b). Feita.

---

## 9) DEFEITOS DO IMPORTADOR — motivo do bloqueio

### D1 · `gates_extra` — vocabulário incompatível (bloqueio observado)

```
$ node scripts/track.mjs import contador --manifest=import/contador/MANIFEST.json
FALHA [1] metadado inválido
  evidência: grep -n '"main"' import/contador/MANIFEST.json → gate desconhecido
  ação: gates_extra contém "main", que não existe em docs/ai-execution/protocol.json.
EXIT=1
```

Regra aplicada (`scripts/track.mjs:1813-1819`):

```js
const known = new Set(protocol.gates.map((g) => g.id));
for (const g of manifest.gates_extra || []) {
  if (!known.has(g)) fail(1, 'metadado inválido', …, `gates_extra contém "${g}", que não existe em ${PROTOCOL_REL}.`);
}
```

O manifesto declara 11 gates de domínio do Contador HUB (`main`, `schema`,
`migration`, `auth_externa`, `storage_r2_preview`, `storage_r2_production`,
`fiscal_readonly`, `portal_legado`, `dados_destrutivos`, `secrets`, `deploy`).
O `protocol.json` conhece 6 IDs, todos no formato `G-*`. Interseção: **vazia**.

Cobertura de teste: `scripts/track.test.mjs` usa `gates_extra: []` nas três
fixtures (linhas 742, 850, 873) — o caminho com vocabulário real nunca é
exercitado.

### D2 · `fontes` — forma incompatível entre especificação e código (bloqueio latente)

O formato documentado no Comando Mestre 2 define `fontes` como **objeto**
(`resumo_canonico`, `masterplan`, `comandos`, `relatorios`) e o MANIFEST.json
entregue segue esse formato. Mas `goalDoc` (`scripts/track.mjs:1761`) faz:

```js
...(manifest.fontes || []).map((f) => `- \`${f}\``),
```

Objeto truthy → `.map` é `undefined` → `TypeError`. As fixtures de teste usam
`fontes` como **array** (linhas 744, 852, 874), então a suíte passa e o defeito
não aparece. Este erro dispararia logo após D1 ser resolvido, na geração do
primeiro arquivo de GOAL.

### D3 · `gate_humano` não é implementado (defeito de semântica do piloto)

```
$ grep -n "gate_humano" scripts/track.mjs
(NENHUMA ocorrência)
$ grep -n "gate_humano" scripts/track.test.mjs
(nenhuma)
```

A Regra 4 (`track.mjs:1874-1877`) trata qualquer `situacao: READY` como
`prontos` e escreve o arquivo em `goals/` com `status: 'READY'`;
`baseMeta` não lê `gate_humano` e `gates_liberados` fica `[]`.

Consequência: `CONTADOR-HUB-FECHAMENTO-R2-012G-PUBLISH-MAIN` entraria no
caminho quente como **READY executável, sem gate humano pendente** — violando
a semântica obrigatória do piloto ("012G deve terminar BLOCKED ou com gate
humano pendente `HUMAN_PUSH_AUTHORIZATION_NOT_SENT`").

Conforme instruído, isto é tratado como **defeito do importador**: `state.json`
e `LEDGER.jsonl` **não** foram editados à mão.

### D4 · `plano_ids` ausente → "pendentes de planejamento" sempre vazio (observação)

`track.mjs:1823` usa `manifest.plano_ids` quando presente e, na ausência, cai
para os próprios `goals_declarados`. O manifesto entregue não traz `plano_ids`
(campo opcional, fora de `MANIFEST_REQUIRED`). Efeito: a Regra 5 nunca produz
pendências, e os GOALs **013–019** não seriam registrados como DRAFT em lugar
nenhum. Eles ficam fora do caminho quente — o que satisfaz a exigência —, mas a
lista 3 do RECONCILIACAO.md sairia `_(nenhum)_`, o que não reflete o material.

---

## 10) Pendências para decisão humana

1. **DIV-1** — GOAL 001 fora de `origin/main`: integrar a branch ou corrigir a
   branch declarada no manifesto.
2. **D1/D2** — decidir o contrato: corrigir o manifesto para o formato que o
   código aceita (`gates_extra` com IDs `G-*`, `fontes` como array), ou corrigir
   o importador para aceitar o formato especificado. Alterar `protocol.json`
   para criar gates novos atinge **G-AEP-CORE** e exige autorização explícita.
3. **D3** — implementar `gate_humano` no importador, com teste, antes de
   qualquer importação que inclua 012G.
4. **D4** — decidir se o manifesto deve declarar `plano_ids` com 013–019.
5. `core.hooksPath` não configurado (hooks locais inativos nesta worktree).

Nada disso foi corrigido nesta tarefa: ela é documental e não altera
`scripts/`, `protocol.json`, o manifesto de entrada nem código produtivo.

---

## 11) Rodada 2 — 2026-07-30 — IMPORTAÇÃO CONCLUÍDA

- worktree/branch: `C:/Projetos/aep-import-contador` · `chore/aep-import-contador`
- HEAD inicial desta rodada: `69c0f80cf3c7057ca8ccd6902917b1af16d4e441`
- pacote: `CONTADOR_HUB_AEP_IMPORT_READY_R3_2026-07-30.zip` · `package_revision = 3`

### 11.1 Corretivos do importador (D1–D4) aplicados por cherry-pick

Os dois commits do corretivo foram aplicados na rodada anterior por `cherry-pick`,
o que **reescreve o SHA**. Por isso `merge-base --is-ancestor` responde `1` para os
SHAs originais — é consequência do cherry-pick, não ausência do conteúdo. A contenção
foi provada por equivalência de conteúdo e de patch-id:

```
$ git diff c0bf7a24410e51f9812ed2ebde821ab6be0f4a36 HEAD -- scripts/track.mjs scripts/track.test.mjs
(vazio)

blob track.mjs       HEAD = c0bf7a24 = 4618d52f03675fca287851dee3618bad93cf8157
blob track.test.mjs  HEAD = c0bf7a24 = 8635504c332e5e943cd3d6e5da21d3e26bf47451

patch-id 1a4c8e3 = 3bc80a84 = 801d66da0fc4a791f7309eea2c5f010606758195
patch-id 69c0f80 = c0bf7a24 = af64651fd6e2dd02fd90e078449b1277e820e896
```

### 11.2 Causa da rejeição do pacote R2 e o que o R3 corrigiu

`plano_ids` é o **roster completo** do plano humano; `goals_declarados` é o subconjunto
com situação operacional. `track.mjs` (Regra 1, § 12) bloqueia como `[decisao]` todo
GOAL declarado que esteja ausente de `plano_ids`. O R2 listou apenas os 7 futuros
(013–019), deixando os 13 declarados de fora → dry-run devolveu 0 DONE, 0 SUPERSEDED,
0 gate humano e 13 divergentes. O R3 traz `plano_ids` com os **20 IDs** (13 declarados
+ 7 futuros), que é o formato exercitado pelo teste `CI1` (`track.test.mjs:1459`).
O defeito era do **pacote**, não do importador.

### 11.3 Dry-run (read-only) — saída literal

```
confirmados (DONE):   9 → 002, 003, 004, 005, 006, 007, 008, 009, 011
divergentes (BLOCKED):1 → CONTADOR-HUB-STATUS-RECONCILE-001[divergencia]
superados (SUPERSEDED):2 → CONTADOR-HUB-DOCUMENTOS-REAL-010, CONTADOR-HUB-FECHAMENTO-SNAPSHOT-012
gate humano (BLOCKED):1 → CONTADOR-HUB-FECHAMENTO-R2-012G-PUBLISH-MAIN[HUMAN_PUSH_AUTHORIZATION_NOT_SENT]
prontos (READY, quente):0 → —
rascunhos (DRAFT):    7 → 013, 014, 015, 016, 017, 018, 019
pendências:           0 → —
```

O dry-run não escreveu nada: `sha256` de `state.json`, `LEDGER.jsonl`, `TRACK.md` e dos
`.gitkeep` idênticos antes e depois; `REGISTRY.md` e `RECONCILIACAO.md` seguiam inexistentes;
`git status --porcelain` e `git diff --name-only` vazios nos dois momentos.

### 11.4 DIV-1 confirmada — GOAL-001 continua fora de `origin/main`

Esta é a **única** divergência real, e é documental — não é defeito do importador.
O manifesto declara `commit f56039918fb34a45e7f7790e861f0d871832469b` na branch
`origin/main`; o commit **existe**, mas não é ancestral de `origin/main`:

```
$ git cat-file -t f56039918fb34a45e7f7790e861f0d871832469b   → commit
$ git merge-base --is-ancestor f560399… origin/main          → exit 1
$ git branch -a --contains f560399…
+ goal/contador-001-status-reconcile
  remotes/origin/goal/contador-001-status-reconcile
```

O importador aplicou a política correta — divergência vira `BLOCKED`, nunca `DONE`
presumido. Ledger: `BLOCKED · divergencia · "DONE sem prova no Git"`.

### 11.5 Importação real

```
$ node scripts/track.mjs import contador --manifest=import/contador/MANIFEST.json
reconciliação: docs/execution-tracks/contador/_closed/reports/RECONCILIACAO.md
proveniência:  docs/execution-tracks/contador/_closed/reports/IMPORT-1-MANIFEST.json
state.json: status BLOCKED · current_goal null
commit de estado: b0ebbf453aad5d88645795f24e17e6ebf5cc095c
```

Classificação idêntica à do dry-run. O próprio importador cria o commit de estado
(`aep(contador): import 1 (plan_rev 1)`), tocando **somente** `docs/execution-tracks/`.

### 11.6 Ledger — 13 linhas, nenhuma para 013–019

| resultado | blocked_by | reason | GOAL |
|---|---|---|---|
| DONE ×9 | — | — | 002, 003, 004, 005, 006, 007, 008, 009, 011 |
| SUPERSEDED ×2 | — | — | 010, 012 |
| BLOCKED | `divergencia` | DONE sem prova no Git | 001 |
| BLOCKED | `gate` | `HUMAN_PUSH_AUTHORIZATION_NOT_SENT` | 012G |

013–019 não têm entrada no ledger, não têm arquivo em `goals/` nem em `_closed/goals/`,
e aparecem apenas como `DRAFT` na seção 3 do `RECONCILIACAO.md`.

### 11.7 Validações

```
$ node scripts/track.mjs verify --all
  [OK] contador — state.json bate com o estado derivado; ledger append-only.
  [OK] REGISTRY.md idêntico ao gerado.
  [OK] GATES.md idêntico ao gerado a partir de protocol.json.
verify: sem divergências.

$ node scripts/track.mjs status contador
🔴 vermelho BLOCKED · ratificados: 9 DONE · 2 BLOCKED · 13 linhas de ledger

$ node scripts/track.mjs open contador
FALHA [1] erro de uso
  evidência: ls docs/execution-tracks/contador/goals/ → nenhum GOAL com status READY
  ação: Não há GOAL elegível. Planejamento é humano — nada a abrir.
```

`open` recusou (exit 1) e `.aep-active` não foi criado. Caminho quente: **0 GOALs**
(`goals/` só tem `.gitkeep`). Nenhum GOAL foi aberto, executado ou autorizado; o 012G
permanece bloqueado à espera de autorização humana explícita.

### 11.8 Escopo

`git diff --name-only 69c0f80 HEAD` fica inteiramente dentro de `docs/` — zero código
produtivo, zero schema, zero migration. `git ls-files -- import` vazio (`import/`
segue gitignored). Nenhum arquivo de estado foi editado à mão. Nenhum push, nenhum merge.

### 11.9 Pendência humana remanescente

**DIV-1** segue aberta e é a única: integrar `goal/contador-001-status-reconcile` em
`main` ou corrigir a branch declarada para o GOAL-001 no manifesto. Enquanto isso, a
trilha fica `BLOCKED` — que é o estado honesto.
