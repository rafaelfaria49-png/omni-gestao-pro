# CONTADOR-015 — Recuperação do WIP, publicação e smoke com a flag OFF

Evidência operacional do GOAL `CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015`.
Documento estritamente factual: sem segredos, sem credenciais, sem dados de loja,
documento ou pacote. **O GOAL permanece ABERTO** — não há ratificação aqui.

## 1. Recuperação do WIP pelo transcript

A tentativa 1 parou por esgotamento de cota durante a fase 3 e a worktree
`C:/Projetos/contador-014-identidade-convite` foi removida do disco antes de o
código ser commitado.

O git não guardava nada: reflog de `goal/contador-015-portal-externo-readonly`
com exatamente 3 entradas (criação + `import 9` + `import 10`, todas doc-only),
`git stash list` vazio, e o índice órfão em
`.git/worktrees/contador-014-identidade-convite/index` com mtime idêntico ao
commit time de `e1ac31c` — ou seja, nada além do último commit chegou a ser
staged. `git worktree list` seguia exibindo a worktree como registro vivo
(`prunable`), o que é um falso positivo de existência.

**Origem exata do transcript recuperado:**

```
~/.kimi-code/sessions/wd_contador-014-identidade-convite_091176b68646/
  session_1fccd99e-07de-4eeb-afea-cb710a0572dc/agents/agent-1/wire.jsonl
```

Formato JSONL; eventos `context.append_loop_event` com `type: "tool.call"`,
campos `name` e `args`. Reconstrução por replay cronológico de `Write`
(`path`, `content`) e `Edit` (`path`, `old_string`, `new_string`), restrito à
allowlist do GOAL.

**Resultado: 42 arquivos reconstruídos, ZERO falha de replay**, mais 7 edits
sobre arquivos pré-existentes. Armadilha registrada: o transcript usa LF e o
working tree CRLF (`core.autocrlf=true`) — os `old_string` só casam após
normalizar CRLF→LF.

Nenhuma ferramenta destrutiva foi usada; a branch e a worktree antigas não foram
resetadas, apagadas nem podadas.

## 2. Correções feitas sobre o WIP recuperado

O executor anterior não chegou a rodar os testes; três defeitos reais foram
encontrados e corrigidos, cada um provado por teste:

1. **Imports relativos dos testes de rota subiam um nível** (`../_shared`,
   `../_testutils`, `../lojas/**` a partir de `app/api/contador-externo/`),
   resolvendo para `app/api/_shared` — 5 arquivos de teste sequer carregavam.
2. **`_testutils` não reexportava `ENV_SEGREDO_SESSAO_EXTERNA`**: o nome chegava
   `undefined` nos testes, que então gravavam `process.env[undefined]` e **todo
   login falhava com 503**. Causa raiz: sob `isolatedModules` o esbuild não prova
   que um binding importado é valor e elide `export { X }` como type-only; o
   reexport tem de ser `export { X } from "módulo"`.
3. **Fixture reintroduzia o fallback hardcoded da loja legada**, reprovando o
   guard estático multi-loja **F-02**. Substituído por constante nomeada.

## 3. Commits e publicação

- Base: `origin/main` avançou de `9068263` para `97267843bf4af240af27683caf3c933677abdcce`
  (10 commits de PDV/caixa) durante a execução. **Interseção de arquivos com o
  GOAL 015: zero** — os commits foram reaplicados por rebase sobre a main atual,
  **sem conflito**.
- `1eb2038` — merge que traz o charter e os artefatos AEP do GOAL 015 (imports 8,
  9 e 10), que nunca haviam chegado à main. Somente `docs/execution-tracks/**`.
- `4fe53af` — implementação: fases 1, 2 e 3 do portal externo read-only.
- Push **fast-forward, sem force**: `9726784..4fe53af HEAD -> main`.
  `git ls-remote origin refs/heads/main` → `4fe53af`.

**Superfície:** 64 arquivos — 57 de código/config + 7 de artefatos AEP.
Sem `prisma/schema.prisma`, sem migrations, sem alteração fiscal, de PDV, de
caixa, de vendas ou da trilha CADASTROS-MARTINS. `proxy.ts` **não** foi alterado:
o segmento `/contador-externo/**` já era integralmente coberto pelo GOAL 014, de
modo que a alteração mínima necessária era nenhuma — o gate G-AUTH ficou sem uso.

Do GOAL 014, apenas três arquivos de **teste** foram tocados, sem enfraquecer
asserção alguma: `auth.test.ts` e `convite.test.ts` receberam só ampliação de
timeout (arquivos bcrypt-bound que estouravam o default de 5s sob a carga da
suíte, flake de tempo e não de lógica) e `namespace.test.ts` teve a lista fechada
de rotas atualizada com as 11 novas. Nenhum código de produção do 014 mudou.

## 4. Verificações

| Verificação | Resultado |
|---|---|
| Testes focados do GOAL 015 | **118/118** em 22 arquivos ✓ |
| Suíte completa | **4183 passam**, 0 teste falhando, 2 expected-fail, 136 skipped |
| TypeScript (`npm run typecheck`) | limpo ✓ |
| ESLint nos arquivos do GOAL | limpo ✓ |
| `npm run build` | passa; 31 rotas `contador-externo`, incluindo as 2 páginas novas ✓ |
| `git diff --check` | limpo ✓ |
| Guard multi-loja F-02 | verde ✓ |
| Isolamento estático do ERP | verde — nenhum import de store, loja ativa ou provider do dashboard ✓ |

### 4.1 Waiver ambiental (não é teste verde)

O arquivo `tools/fiscal-dry-run-integrity-proof/proof.test.ts` estoura nesta
máquina por **limitação ambiental externa e comprovada**: a prova externa invoca
`java`, e o JDK local é 1.8 (`java.lang.ClassLoader` recusa as classes). **Isto
não deve ser lido como teste verde.** O waiver é aceitável porque o GOAL não
alterou `tools/**` nem `lib/fiscal/**` (verificado por `git diff --name-only`) e
nenhum teste funcional do GOAL 015 falhou.

### 4.2 AEP check — 9 PASS / 3 FAIL, exceções humanas ratificadas

`node scripts/track.mjs check contador` → **FALHOU em 6, 7, 8**. Os FAILs são
publicados como estão; o protocolo não foi alterado para escondê-los.

- **#6 — caminhos fora da allowlist:** `docs/execution-tracks/**` (artefatos AEP
  do commit de merge). Exceção ratificada pelo humano.
- **#7 — gate `G-CONFIG-DEPLOY` não liberado:** disparado por `.env.example`.
  Liberado pelo humano exclusivamente para documentar `CONTADOR_PORTAL_V2` com
  default OFF, sem criar nem alterar segredo.
- **#8 — goal-file alterado:** preenchimento do critério de pronto aprovado pelo
  humano e correção de branch/worktree após a perda da worktree antiga.

O importador oficial **não podia** reparar o charter: suas fontes
(`import/contador/`, gitignored) desapareceram junto com a worktree removida.

## 5. Deployment

- Deployment de Production `omni-gestao-de3mdkkww` — **● Ready** (build 3m).
- Alias `https://omni-gestao-pro.vercel.app` → `/api/version` responde
  `{"buildId":"4fe53afadd67", ...}`, correspondente ao commit `4fe53af`.
- **Baseline e migration NÃO reexecutados fora do runner normal.** Log do build:
  `[baseline] _prisma_migrations existe — baseline não necessário.` e
  `15 migrations found in prisma/migrations` → `No pending migrations to apply.`
- Aviso pré-existente e não relacionado ao GOAL: a Vercel sinaliza que Node 20.x
  está depreciado e que deployments criados a partir de 2026-10-01 falharão sem
  `"engines": { "node": "24.x" }` no `package.json`.

## 6. Flag de Production

`vercel env ls production` (somente nomes/tipos) lista 17 variáveis e
**`CONTADOR_PORTAL_V2` NÃO está entre elas**. A variável está **ausente**, e o
default do código é OFF (`portalExternoV2Habilitado` só devolve `true` com o
valor exato `"on"`). Nenhum valor anterior inesperado ativa o portal.

A variável **não foi criada, configurada nem ativada** nesta execução.

## 7. Smoke com a flag OFF (Production, 2026-08-03)

20 casos, **0 falhas, 0 respostas 5xx, 0 vazamentos**. Nenhum usuário, convite,
comentário ou confirmação foi criado — com a flag OFF as rotas de escrita
respondem 404 antes de qualquer trabalho.

| Verificação | Esperado | Obtido |
|---|---|---|
| `/contador-externo/login` | 200 | **200** ✓ |
| `/contador-externo/convite` | 200 | **200** ✓ |
| `/contador-externo/sessao-expirada` | 200 | **200** ✓ |
| `GET /api/contador-externo/auth/sessao` sem cookie | 401 | **401** ✓ |
| `POST /api/contador-externo/convite/consultar` token falso | 200 | **200** ✓ |
| `GET /api/contador-externo/lojas` sem sessão | 401 | **401** ✓ |
| `/login-contador` (portal legado) | 200 | **200** ✓ |
| `/contador-externo/lojas/[loja]` | 404 | **404** ✓ |
| `/contador-externo/lojas/[loja]/competencias/[c]` | 404 | **404** ✓ |
| As **11** APIs de dados do GOAL 015 | 404 | **404** em todas ✓ |
| Vazamento de `storageRef`/`signedUrl`/`manifestoHash`/CNPJ | nenhum | **nenhum** ✓ |

Autenticação e convites do GOAL 014 permanecem funcionais; o portal legado
permanece intacto; nenhum dado de loja, documento ou pacote foi exposto.

## 8. Ausências declaradas

- Nenhuma alteração de schema ou migration.
- Nenhum segredo criado, alterado, lido ou impresso.
- Nenhuma alteração de URL de banco, de CORS de bucket ou upload ao R2.
- Nenhum dado sensível neste documento nem nos logs citados.
- Nenhuma funcionalidade dos GOALs 016–019 antecipada.

## 9. Estado

```
CONTADOR_015_PUBLISHED_FLAG_OFF=true
CONTADOR_PORTAL_V2_PRODUCTION=false
GOAL_015_STATUS=ABERTO (sem ratificação, aguardando aceite funcional)
```
