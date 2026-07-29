<!-- AEP:BEGIN -->
## Protocolo de execução — AEP/1.0-R2

Antes de qualquer tarefa neste repositório, leia `docs/ai-execution/ENTRYPOINT.md`.

- início: `node scripts/track.mjs status <trilha>` e depois `node scripts/track.mjs open <trilha>`
- término: `node scripts/track.mjs close <trilha>`
- regra 1: escreva apenas dentro da allowlist impressa pelo `open`.
- regra 2: adicione por caminho explícito — nunca `git add .`, `git add -A` ou `git commit -a`.
- regra 3: gate não liberado no GOAL = pare e peça autorização humana.

O protocolo é OPT-IN: sem `.aep-active` nesta worktree, nada aqui se aplica.
Este bloco é GERADO. A governança completa NÃO está aqui — está em `docs/ai-execution/`.
Adaptador: GEMINI.md — Gemini / Antigravity.
<!-- AEP:END -->
