# TASK_LEVELS — AEP/1.0-R2

Classificação de tarefa. Ela não decide *se* algo deve ser feito (isso é a camada humana),
decide **quanta cerimônia** o GOAL exige.

## Classes

| Classe | Natureza | Superfície típica | Exige |
| --- | --- | --- | --- |
| **C1** | Mecânica e verificável por inspeção | 1–2 arquivos, sem lógica nova | teste do GOAL verde |
| **C2** | Implementação local com decisão contida | poucos arquivos de um módulo | teste do GOAL verde + allowlist estreita |
| **C3** | Atravessa fronteira de módulo ou contrato | vários módulos, ou contrato público | teste verde + **revisão independente (R)** |
| **C4** | Toca fundação: dados, auth, dinheiro, fiscal | schema, migrations, auth, ledger financeiro | gate humano explícito **+ R** |

## Papel R — revisão independente

R é uma **segunda leitura por executor de outra família DECLARADA** — a família vem de
`executors.json` e precisa estar escrita no GOAL (`familia_executor`). O ponto de R não é
"mais um par de olhos": é que dois executores da mesma família tendem a errar junto, com o
mesmo viés. Se a família não estiver declarada, R **não foi cumprido** — não presuma.

R revisa: o diff contra a allowlist, a evidência do `check`, e se o GOAL fez o que dizia
fazer. R **não** reimplementa.

## Bloco de classificação — 8 campos

Impresso pelo `open` e derivado do bloco `AEP:META` do GOAL:

| # | Campo | Origem |
| --- | --- | --- |
| 1 | classe | `class` |
| 2 | revisão independente R | `revisao_independente` |
| 3 | família do executor | `familia_executor` (declarada; consultiva) |
| 4 | risco | `risk_tier` do GOAL, senão o da trilha |
| 5 | superfície | tamanho da `allowlist` |
| 6 | reversibilidade | `reversibilidade` |
| 7 | gates envolvidos | gates cujos caminhos tocam a allowlist |
| 8 | orçamento de leitura | `read_budget` |

## Regras de derivação

- Allowlist toca caminho de gate `G-DADOS-*`, `G-AUTH` ou `G-CI` → **no mínimo C4**.
- Allowlist atravessa mais de um módulo de primeiro nível → **no mínimo C3**.
- `reversibilidade: "baixa"` → sobe uma classe.
- Risco da trilha `ALTO` ou `CRITICO` → **R obrigatório**, qualquer que seja a classe.
- Classe declarada abaixo da derivada é **erro de planejamento**, não atalho.

## Rubrica de 5 perguntas

Responda antes de abrir o GOAL. Qualquer "sim" empurra a classe para cima.

1. Se isto estiver errado, o dano aparece em **dados** (e não em tela)?
2. Existe caminho em que o erro **não seja revertido** por um `git revert`?
3. A mudança altera um **contrato** que alguém fora deste GOAL consome?
4. Preciso ler mais arquivos do que o **orçamento de leitura** declarado?
5. Estou tentado a tocar um caminho **fora da allowlist** para "fazer direito"?

Se a resposta a 4 ou 5 for sim, o GOAL está mal delimitado. Pare e replaneje — não amplie
a allowlist no meio da execução.

## Executores

`executors.json` é tabela **substituível e fora do núcleo**. O campo `verificado` é
**consultivo**: `open` não bloqueia tarefa comum por executor não verificado, apenas avisa.
Tarefas ALTO ou CRÍTICO continuam exigindo gate humano ou R, independentemente da tabela.
