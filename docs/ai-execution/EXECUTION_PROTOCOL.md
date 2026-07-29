# EXECUTION_PROTOCOL — AEP/1.0-R2

Regras completas do Agent Execution Protocol. O `ENTRYPOINT.md` é o resumo operacional;
este documento é a referência.

O núcleo é **Git + testes + Node + arquivos estruturados**. Zero dependências externas,
nenhum recurso exclusivo de plataforma. O protocolo é **agnóstico de executor**.

O objetivo central **não é impedir a ação** — é impedir que ela seja **RATIFICADA**, isto
é, que entre no ledger, no `state.json` ou no histórico.

---

## 1. Estrutura

```
docs/ai-execution/            ENTRYPOINT, este arquivo, GATES.md (gerado), TASK_LEVELS,
                              ADAPTERS, protocol.json, executors.json, _evidence/
docs/execution-tracks/
  REGISTRY.md                 gerado
  <trilha>/
    TRACK.md                  escopo, testes, gates, plano de origem (humano)
    state.json                ÚLTIMO ESTADO RATIFICADO — derivado, nunca editado à mão
    LEDGER.jsonl              append-only, uma linha JSON por ratificação
    goals/                    caminho quente: no máximo 3 GOALs
    _closed/goals/            GOALs DONE, BLOCKED, SUPERSEDED
    _closed/reports/          relatórios de fechamento, manifestos importados
.githooks/                    hooks finos que delegam ao Node
.aep-active                   gitignored, por worktree — a chave do opt-in
import/                       gitignored — insumo bruto de importação, nunca commitado
```

## 2. Regra de ouro do ciclo de estado

`status`, `open`, `check` e `attempt --fail` **não escrevem nenhum arquivo versionado**.
Somente `close`, `block`, `import`, `registry`, `init` e `sync-adapters` escrevem.
`open` escreve apenas `.aep-active`.

`state.json` é 100% **derivado** de `protocol.json` + `LEDGER.jsonl` + `goals/` +
`_closed/goals/` + `TRACK.md`. Não existe nele um único campo não derivável — é por isso
que `verify` consegue detectar edição manual.

### Ritual de planejamento

Adicionar ou remover um GOAL em `goals/` é ato **humano** e muda o estado derivado
(`current_goal`, `next_goal`, `status`) sem passar por `close`. Reconcilie assim:

```bash
# 1. edite/adicione o arquivo do GOAL em docs/execution-tracks/<trilha>/goals/
node scripts/track.mjs registry          # reescreve state.json + REGISTRY.md + GATES.md
AEP_WRITE=1 git commit -m "aep(<trilha>): plan <o que mudou>" -- <caminhos explícitos>
```

`AEP_WRITE=1` aqui é **fluxo interno declarado**, não segredo — ver § 14.

## 3. Máquina de estado do GOAL

```
DRAFT ──(planejamento humano)──▶ READY ──(open)──▶ IN_PROGRESS
                                                   ├─(close, check PASS)──▶ DONE      → _closed/goals/
                                                   ├─(block | 3ª tentativa)─▶ BLOCKED → _closed/goals/
                                                   └─(plan_rev mais novo)───▶ SUPERSEDED → _closed/goals/
```

- `IN_PROGRESS` **não é persistido em arquivo versionado** — existe só no `.aep-active`.
- Desbloquear é ato humano: mover o arquivo de `_closed/goals/` de volta para `goals/`
  com `status: "READY"`, ou planejar um GOAL sucessor.

## 4. Máquina de estado da trilha

| Estado | Quando |
| --- | --- |
| `PLANNED` | sem ledger, sem GOALs, sem GOALs fechados |
| `RUNNING` | existe ao menos um GOAL `READY` em `goals/` |
| `BLOCKED` | sem GOAL elegível e a última linha do ledger é `BLOCKED` |
| `PAUSED` / `DONE` | sem GOAL elegível; qual dos dois vem de `completion_when_empty` no bloco `AEP:TRACK` do `TRACK.md` |

Fechar o **último** GOAL da trilha é permitido: a ausência de próximo GOAL é informativa
(item 12 do `check`), nunca bloqueante.

## 5. Veredito de contexto

O `close` termina com um destes:

- **CLEAR** — não há próximo GOAL. Encerre.
- **CONTINUE** — há próximo GOAL, o fechamento foi em primeira tentativa e o risco da
  trilha é BAIXO/MÉDIO. Siga no mesmo contexto.
- **NEW_SESSION** — houve tentativa falha registrada, ou o risco da trilha é ALTO/CRÍTICO.
  Limpe o contexto antes do próximo GOAL.

`check` que falha dentro do `close` imprime **CONTEXTO: CONTINUE** — nada foi escrito e
`.aep-active` foi preservado, então a sessão continua no mesmo GOAL e na mesma tentativa.

## 6. Tentativas

Teto de **3 tentativas** por GOAL. `attempt --fail --reason="..."` escreve **somente** no
`.aep-active`. A falha registrada na tentativa 3 esgota o teto e converte o GOAL em
`BLOCKED` (exit 3), gravando `previous_attempts` no ledger.

**Um corretivo é tentativa, não GOAL novo.** Criar um GOAL para consertar o GOAL anterior
mascara o custo real e quebra a contagem.

## 7. plan_rev e SUPERSEDED

Cada GOAL carrega `plan_rev`. Quando o plano humano avança de revisão, GOALs que ainda não
foram executados e carregam `plan_rev` menor são marcados `SUPERSEDED` e vão para
`_closed/goals/`. Um GOAL já `DONE` **não** é superado: ele já foi ratificado.

## 8. origin/&lt;default&gt;

A branch default é **declarada** em `protocol.json.default_branch`. Isso é deliberado:
`refs/remotes/origin/HEAD` local fica obsoleto com frequência e produz falso positivo.
O `doctor` confronta a declaração com `git ls-remote --symref origin HEAD` e avisa se
divergirem. `base_commit` é sempre `git merge-base HEAD origin/<default>`.

**Uma trilha = uma branch = uma worktree.** O `open` valida branch e worktree e falha com
exit 5 se não conferirem. O AEP **nunca** executa `checkout`, `switch`, `stash` ou `reset`
— trocar de branch é ato seu.

## 9. O ciclo de DOIS COMMITS

1. `goal(<trilha>-<nnn>): ...` — o commit do **agente**, com o trabalho de verdade.
2. `aep(<trilha>): close <ID>` — o commit de **estado**, criado pelo script depois que o
   `check` passou: ledger, `state.json`, relatório, movimentação do GOAL, registry.

**Por que não é um commit só?** Porque o objeto verificado precisa ser imutável no momento
da verificação. O `check` roda contra um `HEAD` que já existe: árvore limpa, teste rodando
sobre exatamente aquele conteúdo, diff `base..HEAD` fechado. Se estado e trabalho fossem o
mesmo commit, o `check` estaria validando algo que ainda não existe e o resultado seria
gravado no próprio objeto sendo julgado — auditoria circular. Separando, o ledger sempre
aponta para um `head_commit` anterior e independente, e qualquer terceiro pode refazer o
`check` a partir dele.

## 10. Gramática de caminhos

Duas formas, e apenas duas, em allowlists e em gates de caminho:

- `a/b/c/arquivo.ext` — igualdade exata da string.
- `a/b/c/**` — `caminho.startsWith("a/b/c/")`.

Sem `*` isolado, sem `?`, sem chaves, sem negação. Entrada fora dessas formas → **exit 1**
na leitura do GOAL, antes de qualquer execução.

Gate de dados é **gate de caminho** (`prisma/migrations/**`, arquivos de seed). Varredura
de conteúdo do diff, quando existir, é **AVISO HEURÍSTICO** rotulado como tal e **nunca**
gate — confiança falsa é pior que ausência de verificação.

## 11. Metadados

Cada GOAL é um `.md` com um bloco JSON estritamente delimitado:

```
<!-- AEP:META
{ ...json... }
-->
```

O arquivo deve conter **exatamente uma** linha literal `<!-- AEP:META`; o bloco termina na
primeira linha igual a `-->`; o miolo vai direto para `JSON.parse`. Qualquer outro caso →
exit 1 apontando a linha ofensora. **Não existe parser YAML neste protocolo** — é também
por isso que o manifesto de importação é JSON.

## 12. Importação

`import <trilha> --manifest=<caminho>` reconcilia um plano humano com a verdade do Git.
Precedência das regras, nesta ordem:

1. Declarado mas ausente do plano → `BLOCKED`, `blocked_by: "decisao"`.
2. `DONE` com commit que **existe** e **está na branch declarada** → linha de ledger com
   `"source":"importado"`, `result: DONE`, `bootstrap_commit`; arquivo em `_closed/goals/`.
   `DONE` com commit inexistente, fora da branch, ou ausente → `BLOCKED`,
   `blocked_by: "divergencia"`, **entra no relatório de divergências. Nunca se presume DONE.**
3. `plan_rev` do GOAL menor que o do manifesto → `SUPERSEDED` → `_closed/goals/`.
4. `READY` → arquivo em `goals/`, gerado a partir das fontes.
5. No plano mas não no manifesto → `DRAFT`, fora de `goals/`, listado como pendência.

Limites duros: não altera código produtivo, não reimplementa nada, commita apenas dentro
de `docs/execution-tracks/`, mantém no máximo 3 GOALs no caminho quente, `import/` é
gitignored e seu conteúdo bruto não é commitado, e o manifesto é copiado para
`_closed/reports/IMPORT-<n>-MANIFEST.json` como proveniência. A saída é
`_closed/reports/RECONCILIACAO.md` com confirmados, divergentes (com o comando e a saída
que provam a divergência) e pendentes de planejamento.

## 13. Códigos de saída

| Código | Significado |
| --- | --- |
| 0 | OK |
| 1 | erro de uso ou metadado inválido |
| 2 | gate violado |
| 3 | verificação falhou |
| 4 | divergência de estado |
| 5 | pré-condição de ambiente |

Formato de erro, sempre três linhas:

```
FALHA [<n>] <categoria>
  evidência: <comando exato> → <saída>
  ação: <o que fazer>
```

---

## 14. MODELO DE SEGURANÇA

Esta seção é obrigatória e deve ser lida antes de confiar em qualquer garantia do
protocolo. São **três camadas**, e só duas delas existem hoje.

### Camada local — `scripts/track.mjs` + `.githooks/` — IMPLANTADA

**O que ela garante:**

- protege contra **acidente** — o commit errado, o caminho esquecido no índice, a edição
  distraída do `state.json`;
- mantém no trilho um agente **cooperativo** — allowlist por GOAL, gates de caminho,
  imutabilidade de `state.json` / `LEDGER.jsonl` / `REGISTRY.md` no fluxo normal, branch
  correta, ledger append-only;
- produz **evidência imediata**: cada recusa vem com o comando exato e a saída literal.

**O que ela NÃO garante — e isto não é ressalva de rodapé, é o limite honesto:**

- **nada** contra um executor deliberadamente **não cooperativo**. Ele pode usar
  `git commit --no-verify`, definir `AEP_WRITE=1`, reapontar `core.hooksPath`, usar
  `--amend`, ou manipular `.git` diretamente.

Isso é **propriedade do Git, não defeito do protocolo**: um hook local roda com os mesmos
privilégios de quem o invoca. Qualquer documento que prometa mais que isso está mentindo.

`AEP_WRITE=1` é **detalhe de fluxo interno** para o `close` distinguir a própria escrita de
uma edição manual. **Não é segredo, não é credencial, e qualquer um pode reproduzi-lo.**

### Camada remota — PR obrigatório + CI com `verify --all` + branch protection + check obrigatório — **NÃO IMPLANTADA**

É **ela** que torna a ratificação uma **garantia**, e não apenas uma convenção: se o
`state.json` só pode entrar na branch protegida através de um PR cujo check obrigatório
executou `node scripts/track.mjs verify --all` em um runner que o autor do PR não controla,
então divergência não é ratificável — independentemente de quão não cooperativo seja o
executor local.

**Estado atual: NÃO IMPLANTADA.** `protocol.json.remote_layer` registra a confirmação
humana (`ci_verify`, `branch_protection_confirmada_por`, `branch_protection_confirmada_em`)
e o `doctor` a apresenta como **CONFIRMAÇÃO DECLARADA, nunca como fato verificado** —
branch protection não é verificável localmente. Implantação prevista no **Comando Mestre 3**.

### Camada humana — gates de autorização e revisão de PR

Gates de caminho param o agente e devolvem a decisão a uma pessoa. Tarefas de risco ALTO ou
CRÍTICO exigem gate humano ou revisão independente (papel R — ver `TASK_LEVELS.md`).
Nenhuma automação substitui essa camada; ela é o que decide *se* algo deve ser feito.

### Detecção depois do fato

Em qualquer camada, `node scripts/track.mjs verify --all` recalcula o estado a partir do
Git e sai com **4** em divergência. Ele **detecta**, não impede. Enquanto a camada remota
não existir, `verify --all` é o instrumento que transforma uma violação silenciosa em uma
violação **visível** — e é exatamente por isso que ele roda igual no CI e na sua máquina.

### Corolário: o protocolo é OPT-IN

Enquanto uma worktree não tiver `.aep-active`, ela trabalha exatamente como antes e não
percebe que o AEP existe. Sem `.aep-active`, o `pre-commit` aplica **somente**
imutabilidade (e `CRIAÇÃO` desses arquivos continua permitida, que é como o commit de
bootstrap passa naturalmente, sem nenhuma exceção especial) e o `commit-msg` não impõe
padrão algum: `feat(...)`, `fix(...)`, `docs(...)`, `chore(...)` seguem válidos.
