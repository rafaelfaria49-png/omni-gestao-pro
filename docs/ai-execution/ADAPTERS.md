# ADAPTERS — AEP/1.0-R2

Adaptadores são **conveniência**, não corretude. Remover qualquer um deles não pode quebrar
o protocolo: o núcleo é `scripts/track.mjs` + Git + os arquivos de trilha. Se um adaptador
sumir, o executor daquela plataforma simplesmente não recebe o atalho — ele ainda pode (e
deve) ler `docs/ai-execution/ENTRYPOINT.md`.

`node scripts/track.mjs sync-adapters` escreve **somente** entre `<!-- AEP:BEGIN -->` e
`<!-- AEP:END -->`. Conteúdo humano fora dos marcadores nunca é removido, movido nem
reordenado. Mais de um bloco, ou marcador sem par → exit 1, sem escrever nada.

## AGENTS.md — executor genérico
- Convenção mais difundida entre agentes de linha de comando.
- Arquivo criado pelo AEP; contém apenas o bloco gerado.
- É o adaptador de referência: os outros dois repetem o mesmo miolo.
- `sync-adapters --check` compara **só o miolo**; o resto do arquivo é ignorado.

## CLAUDE.md — Claude Code
- **Arquivo mantido à mão neste repositório.** O AEP acrescenta o bloco ao FINAL.
- Toda a governança preexistente acima do bloco continua valendo e é preservada 100%.
- Em caso de conflito aparente, a governança do repositório vence; o bloco só aponta caminho.

## GEMINI.md — Gemini / Antigravity
- Arquivo criado pelo AEP; contém apenas o bloco gerado.
- Regras de importação de UI externa continuam nos documentos do repositório, não aqui.

## core.hooksPath e múltiplas worktrees

Instale com **caminho RELATIVO**:

```bash
git config core.hooksPath .githooks
```

A config vive no `.git` comum e é compartilhada por todas as worktrees — mas o caminho
**relativo** resolve dentro do checkout de **cada** worktree. Consequência desejada: uma
worktree posicionada em uma branch anterior ao AEP não tem `.githooks/`, não recebe hook
algum e commita normalmente. É assim que o opt-in sobrevive a um repositório com dezenas de
worktrees vivas.

Caminho **absoluto** quebra essa propriedade: passaria a impor os hooks a toda worktree,
inclusive as que não conhecem o protocolo. O `doctor` avisa quando detecta caminho absoluto.

Confira o destino efetivo com `git rev-parse --git-path hooks`. Se
`extensions.worktreeConfig` estiver ativo, a config pode ser por worktree — o `doctor`
reporta o valor, mas não altera nada.

Os hooks exigem `node` no PATH. São **proteção local contra acidente** e contra desvio de
agente cooperativo — **não** são barreira contra executor não cooperativo. Ver
`EXECUTION_PROTOCOL.md` § MODELO DE SEGURANÇA.
