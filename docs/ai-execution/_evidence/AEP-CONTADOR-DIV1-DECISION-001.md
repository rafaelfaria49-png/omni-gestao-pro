# AEP-CONTADOR-DIV1-DECISION-001 — decisão humana sobre a DIV-1 do GOAL 001

- protocolo: AEP/1.0-R2
- trilha: `contador`
- data da decisão: **2026-07-31**
- worktree: `C:/Projetos/aep-import-contador` · branch: `chore/aep-import-contador`
- bootstrap_commit: `d4817244c8d1f4fdabb2773e419e2910ac62658a`
- plan_ref: `CONTADOR-HUB-FABLE5-MASTERPLAN-001` · plan_rev: `1`
- manifesto aplicado: `import/contador/MANIFEST-R4.json` · `package_revision = 4`

> **DECISÃO:** `CONTADOR-HUB-STATUS-RECONCILE-001` passa de **BLOCKED / `divergencia`**
> para **SUPERSEDED**. A DIV-1, aberta desde 2026-07-29 e reconfirmada em 2026-07-30
> (ver `AEP-IMPORT-CONTADOR-001.md` §§ g e 11.4/11.9), está **encerrada**.

---

## 1. O GOAL e a divergência

| campo | valor |
|---|---|
| GOAL | `CONTADOR-HUB-STATUS-RECONCILE-001` |
| commit histórico | `f56039918fb34a45e7f7790e861f0d871832469b` |
| autor / data | Rafael Faria · Sun Jul 12 11:29:52 2026 -0300 |
| assunto | `docs(contador): reconciliar estado do Contador HUB e tracking de mocks (GOAL 001)` |
| branch real | `goal/contador-001-status-reconcile` (local **e** remota) |
| branch declarada no manifesto R3 | `origin/main` |

O manifesto R3 declarava `situacao: DONE` com prova em `origin/main`. O Git nunca
sustentou essa afirmação: o commit existe, mas não pertence à branch declarada.

## 2. Prova de que o commit NÃO pertence à main declarada

Levantada nesta tarefa, em 2026-07-31, contra `origin/main = 654ceedea73eb27fc5f3a2c439590f93298a3958`
(`merge(cadastros): integrar hardening da importacao de produtos`, 2026-07-30):

```
$ git rev-parse --verify f56039918fb34a45e7f7790e861f0d871832469b^{commit}
f56039918fb34a45e7f7790e861f0d871832469b            → o commit EXISTE

$ git merge-base --is-ancestor f56039918fb34a45e7f7790e861f0d871832469b origin/main
exit 1                                              → NÃO é ancestral de origin/main

$ git branch -a --contains f56039918fb34a45e7f7790e861f0d871832469b
+ goal/contador-001-status-reconcile
  remotes/origin/goal/contador-001-status-reconcile → vive SÓ na própria branch
```

O resultado é idêntico ao das rodadas anteriores, agora contra uma `main` que
avançou 100+ commits desde 2026-07-28. O commit continua branch-only.

**Nota de método:** aqui `--is-ancestor` é conclusivo porque o commit nunca foi
cherry-pickado para a linha principal — não há reescrita de SHA que possa mascarar
contenção, ao contrário do caso descrito em `AEP-IMPORT-CONTADOR-001.md` § 11.1.

## 3. A decisão e sua justificativa

O GOAL 001 foi um trabalho **documental** de reconciliação de estado do Contador
HUB. Sua função — apurar o que era real e o que era mock na trilha — foi
integralmente **substituída** pela reconciliação produzida pelo próprio protocolo
em `AEP-IMPORT-CONTADOR-001` (`docs/execution-tracks/contador/_closed/reports/RECONCILIACAO.md`),
que é derivada do Git e verificável por `verify --all`.

Havia duas saídas possíveis para a DIV-1:

1. integrar `goal/contador-001-status-reconcile` em `main` — restauraria o DONE, mas
   traria de volta um documento de estado hoje obsoleto e concorrente com a
   reconciliação canônica do AEP;
2. reclassificar o GOAL como **SUPERSEDED** — reconhece o trabalho como histórico e
   encerra a divergência sem inventar prova de publicação.

**Escolhida: a opção 2.** SUPERSEDED é a classificação honesta: não afirma que o
commit está em `main` (não está) e não descarta o trabalho (a referência histórica
permanece). `commit` e `branch` foram removidos do manifesto R4 **de propósito** —
eles só existem no vocabulário do AEP como prova operacional de DONE, e não há DONE
a provar. A referência histórica ao SHA fica preservada em `import/contador/MANIFEST.json`
(R3), em `IMPORT-1-MANIFEST.json` e neste documento.

## 4. Ledger append-only e a transição last-wins

A reclassificação foi aplicada **sem reescrever uma única linha antiga**. O ledger
cresceu de 13 para 14 linhas por **append**:

| | linhas | bytes | SHA-256 |
|---|---|---|---|
| antes do R4 | 13 | 6324 | `b54853392ce058b349cb505796c6a1b2db36501cf47dc9398f3a5e7c8b6f8c96` |
| depois do R4 | 14 | 6637 | `4224d75d5d5091f42015a7496137e0574ae098216c3a0cc4a46660d08db4d43a` |

Prova de prefixo byte-a-byte — os 6324 bytes antigos permanecem intactos no início
do arquivo novo:

```
$ head -c 6324 LEDGER.jsonl | sha256sum
b54853392ce058b349cb505796c6a1b2db36501cf47dc9398f3a5e7c8b6f8c96   (idêntico ao "antes")
```

As duas linhas do GOAL 001 coexistem, e a **última vence** (`last-wins`):

```
linha 12  ts 2026-07-30T21:29:13.806Z  result BLOCKED     blocked_by "divergencia"
                                       reason "DONE sem prova no Git"
                                       evidencia: merge-base --is-ancestor → exit 1

linha 14  ts 2026-07-31T03:13:49.583Z  result SUPERSEDED  superseded_from_rev 1
```

A linha BLOCKED **não foi apagada**: ela é o registro permanente de que a
divergência existiu e de como foi detectada. A projeção por GOAL passa a ler
SUPERSEDED porque a última classificação física do GOAL no ledger é SUPERSEDED —
semântica introduzida pelo corretivo `02d514f7a958d8cf070bcb20e4bdd42b70a3545e`
(`fix(aep): suportar reimportacao incremental last-wins`), coberta pelos testes
A1–A4, C-R4 e D-R4.

Commit de estado gerado pelo próprio importador: `5289a9930deb57179bc0c8f82cdc21beea9a638c`
(`aep(contador): import 2 (plan_rev 1)`).

## 5. Estado da trilha após a decisão

```
$ node scripts/track.mjs status contador
AEP/1.0-R2 · trilha contador · 🔴 vermelho BLOCKED
ratificados (projeção por GOAL): 9 DONE · 3 SUPERSEDED · 1 BLOCKED · 14 linhas de ledger
```

| classificação | nº | GOALs |
|---|---|---|
| DONE | 9 | 002, 003, 004, 005, 006, 007, 008, 009, 011 |
| SUPERSEDED | 3 | **001**, 010, 012 |
| BLOCKED | 1 | 012G (gate humano) |
| DRAFT | 7 | 013, 014, 015, 016, 017, 018, 019 |
| READY | 0 | — |

## 6. O 012G continua BLOCKED — nada foi autorizado

```
gate humano (BLOCKED): 1 → CONTADOR-HUB-FECHAMENTO-R2-012G-PUBLISH-MAIN
                            [HUMAN_PUSH_AUTHORIZATION_NOT_SENT]
```

`CONTADOR-HUB-FECHAMENTO-R2-012G-PUBLISH-MAIN` permanece bloqueado por gate humano,
com o motivo inalterado. **Esta tarefa não o autorizou, não o abriu e não o
desbloqueou.** `docs/execution-tracks/contador/goals/` continua sem nenhum arquivo
de GOAL; `node scripts/track.mjs open contador` recusa com exit 1; `.aep-active`
segue ausente. Nenhum GOAL é executável na trilha.

## 7. Escopo — zero código produtivo

A reclassificação é puramente registral. Nada sob `app/`, `lib/`, `components/`,
`prisma/`, `auth*.ts`, `proxy.ts` ou `.github/` foi lido para escrita ou alterado.
Nenhuma migration, `.env`, secret ou configuração de CI foi tocada.

Alterações desta tarefa, na ordem:

1. `02d514f` — corretivo do núcleo (`scripts/track.mjs`, `scripts/track.test.mjs`,
   `docs/ai-execution/EXECUTION_PROTOCOL.md`), aplicado por `merge --ff-only`,
   preservando o SHA. Infraestrutura do protocolo, não produto.
2. `5289a99` — commit automático do importador, inteiramente dentro de
   `docs/execution-tracks/`.
3. este documento, em `docs/ai-execution/_evidence/`.

`import/` segue gitignored (`.gitignore:52`) e nada de lá foi commitado. Nenhum push,
nenhum merge, `main` intocada.

## 8. Idempotência da reimportação

Reaplicar o mesmo manifesto R4 é NO-OP comprovado:

```
$ node scripts/track.mjs import contador --manifest=import/contador/MANIFEST-R4.json --dry-run
delta: 0 NOVO · 0 ALTERADO · 13 INALTERADO
linhas de ledger a anexar: 0

$ node scripts/track.mjs import contador --manifest=import/contador/MANIFEST-R4.json
Estado desejado já é o estado vigente: nada foi escrito, nada foi commitado.
ledger intacto: 13 GOAL(s) projetado(s), 0 linha anexada.
```

SHA-256 do ledger e HEAD idênticos antes e depois da segunda aplicação real. A
decisão de supersede não se duplica se o pacote for reimportado.

## 9. Pendência remanescente — fora do escopo desta tarefa

**`risk_tier` continua pendente.** O `MANIFEST-R4.json` declara `risk_tier: "ALTO"`,
enquanto `state.json` / `status contador` reportam `risco MEDIO`. A divergência é
**conhecida e deliberadamente não corrigida aqui**: esta tarefa proibiu tocá-la, e
corrigi-la exige decisão própria sobre qual das duas fontes é autoritativa. Deve ser
tratada em tarefa separada, antes de qualquer readiness de publicação.

Com a DIV-1 encerrada, esta passa a ser a única pendência documental aberta da
importação — o 012G não é pendência de importação, e sim uma autorização humana
que o protocolo está corretamente retendo.
