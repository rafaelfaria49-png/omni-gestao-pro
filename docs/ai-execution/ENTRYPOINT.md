# ENTRYPOINT — AEP/1.0-R2

Fonte canônica de execução. Vale para qualquer executor. O protocolo é OPT-IN: sem `.aep-active` nesta worktree, nada aqui se aplica.

## Começar
1. `node scripts/track.mjs status <trilha>` — leitura pura, não escreve nada.
2. `node scripts/track.mjs open <trilha>` — escreve só `.aep-active` (gitignored) e imprime o briefing: o ÚNICO arquivo de GOAL a ler, branch, base, tentativa, allowlist, gates liberados, teste e orçamento de leitura.
3. Leia apenas esse arquivo de GOAL. Trabalhe apenas dentro da allowlist.

## Regras não negociáveis
- Escreva só dentro da allowlist impressa pelo `open`.
- Nunca use `git add .`, `git add -A` ou `git commit -a` — adicione por caminho explícito. Regra OPERACIONAL HUMANA: o hook valida o conjunto staged e não tem como saber qual comando você digitou.
- Commit do agente: `goal(<trilha>-<nnn>): ...`.
- Gate não liberado no GOAL = pare e peça autorização humana. Não contorne.
- Não edite `state.json`, `LEDGER.jsonl` nem `REGISTRY.md` à mão.
- Corretivo é TENTATIVA, não GOAL novo: `attempt <trilha> --fail --reason="..."`. Teto de 3 tentativas; esgotou, vira BLOCKED.

## Terminar
- `node scripts/track.mjs close <trilha>` — roda `check`. Falhou: nada é escrito e `.aep-active` é preservado. Passou: ratifica e cria o commit `aep(<trilha>): close`.
- Bloqueou: `node scripts/track.mjs block <trilha> --reason="..." --by=gate|dependencia|externo|decisao`.

## Limpar o contexto
O `close` imprime o veredito: CLEAR (nada mais a fazer), CONTINUE (siga no mesmo contexto) ou NEW_SESSION (limpe o contexto antes do próximo GOAL). Obedeça ao veredito.

Regras completas, máquinas de estado e MODELO DE SEGURANÇA: `EXECUTION_PROTOCOL.md`.
