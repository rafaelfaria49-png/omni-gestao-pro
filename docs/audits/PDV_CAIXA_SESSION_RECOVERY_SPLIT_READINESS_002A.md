---
title: PDV_CAIXA_SESSION_RECOVERY_SPLIT_READINESS_002A · readiness de merge da recuperação de sessão de caixa
audit_id: PDV-READINESS-002A
hub: pdv
tipo: forense
data: 2026-08-02
auditor_humano: Rafael Faria
auditor_ia: opus
escopo: readiness independente de `origin/goal/pdv-caixa-session-recovery-split-fix-002a` (0e355d7) sobre `origin/main` (9068263)
status: publicada
imutavel_apos: publicada
versao_anterior: PDV_CAIXA_SESSION_RECOVERY_CART_DRAFT_READINESS_001
---

# PDV-CAIXA-SESSION-RECOVERY-SPLIT-READINESS-002A

> **Modo:** somente leitura. Nenhuma linha da implementação foi alterada, nenhum merge,
> nenhum push para `main`, nenhum deploy, nenhuma operação em produção.

## 1. SHAs e relação

| Item | Valor | Exigido | Confere |
|---|---|---|---|
| `origin/main` | `9068263b9c4b0db7a75bb3525bcd1e96b794d333` | idem | ✅ |
| Implementação | `0e355d735a950c7ac5385316aee83f9c11d063ef` | idem | ✅ |
| Relação | `0` atrás / `5` à frente | 0 / 5 | ✅ |
| Arquivos no diff | 10 | 10 | ✅ |

Commits (ordem cronológica):

```
0869a64 feat(pdv): contrato puro de reconciliacao da sessao de caixa
5de39a0 fix(pdv): reconciliar caixa apos hidratacao e fora do loadDb
b27011e feat(caixa): acao Atualizar caixa na barra compartilhada
b963847 fix(caixa): abrir caixa somente apos confirmacao do servidor
0e355d7 fix(pdv): recuperar sessao de caixa antes de abrir o pagamento
```

`main` não avançou durante a auditoria — nenhuma sobreposição em caixa, PDV, vendas ou
`operations-store` a considerar.

**Ambiente de validação:** Node 20 portátil `v20.19.5`
(`C:\tmp\omni-readiness-final-001\node20`), worktree
`C:\tmp\omni-gestao-pdv-caixa-session-recovery-readiness-002a`, branch
`audit/pdv-caixa-session-recovery-split-readiness-002a`.
`package.json` declara `engines: node 20.x`; a Vercel builda em 20.20.2 — o patch local
diverge (20.19.5), sem impacto conhecido nesta superfície.

## 2. Reprodução independente da causa raiz (contra `origin/main`)

Build de produção de `main` (`next build` + `next start` em `127.0.0.1:3312`), Playwright
com `serviceWorkers: "block"`, **todas** as rotas `/api/**` interceptadas e
`DATABASE_URL`/`DIRECT_URL` apontando para `127.0.0.1:59999` — escrita em banco impossível
por construção. Os testes da implementação **não** foram usados como prova.

| # | Afirmação do GOAL | Cenário | Resultado observado em `main` | Confirmado |
|---|---|---|---|---|
| 1 | `isOpen=true` + `sessaoId` ausente não era reconciliado | servidor devolve sessão ABERTA; local aberto sem referência | `caixaSessaoId` permanece `null` | ✅ |
| 2 | `sessaoId` obsoleto não era substituído | servidor devolve `sess-servidor-ATIVA`; local aponta `sess-antiga-OBSOLETA` | `caixaSessaoId` permanece `sess-antiga-OBSOLETA` | ✅ |
| 3 | Falha em `inventory`/`ordens` impedia a reconciliação | as duas rotas em 500; servidor **tem** caixa aberto; local fechado | nada adotado: `sessaoId=null`, `isOpen=false` | ✅ |
| 4 | Abertura local ocorria antes do sucesso do POST | `POST /api/ops/caixa/abrir` → 500, pela UI real do modal | `isOpen=true` + `sessaoId=null` — o estado degradado nasce aqui | ✅ |
| 5 | O estado degradado sobrevivia a F5 e a novo login | ver abaixo | ✅ em duas condições | ✅ |

**Refinamento honesto da afirmação (5).** Na primeira formulação (servidor **sem** sessão,
sem falha de estoque) `main` **fecha** o caixa no F5 — o ramo `!openSessao && isOpen`
funciona. O estado degradado sobrevive nas duas condições que realmente ocorrem no
incidente, ambas medidas em três cargas seguidas (1ª carga → F5 → nova navegação):

- **M5a — referência perdida com sessão viva no servidor:** `isOpen=true / sessaoId=null`
  nas três cargas. É o caso permanente: `main` nunca reconcilia esse par.
- **M5b — servidor sem sessão + `inventory`/`ordens` em 500:** `isOpen=true / sessaoId=null`
  nas três cargas — o caixa falso aberto nunca fecha porque a reconciliação nem chega a
  rodar.

**Linha de base extra (usada em F-01).** No mesmo build de `main`, com o servidor
devolvendo a sessão de **outro terminal** (`sess-PDV2`) e o local em `sess-PDV1`, `main`
**mantém** `sess-PDV1` e o saldo local (111). Isso estabelece que o comportamento descrito
em F-01 é regressão introduzida pela branch, não herança.


### 2.6 Leitura de código que sustenta a reprodução

O bloco removido pelo commit `5de39a0` (visível no diff de `lib/operations-store.tsx`)
tratava **duas** das quatro combinações:

```
if (openSessao && !localCaixa.isOpen)      → adota
else if (!openSessao && localCaixa.isOpen) → fecha
```

`servidor ABERTO + cliente ABERTO` cai fora dos dois ramos — daí (1) e (2). O bloco vivia
**depois** de `Promise.all([inventory, ordens])` e depois do guard
`if (!rInv.ok || !rOs.ok) { … return }`, daí (3). Em
`components/dashboard/caixa/abertura-caixa-modal.tsx` o `abrirCaixa(valor)` era a primeira
instrução do handler, antes do `fetch` — daí (4). `caixaSessaoId` e `caixa` são persistidos
(`toPersistedRest`, `saveCaixaSnapshot`), daí (5).

## 3. Análise dos 10 arquivos

| Arquivo | Δ | Papel na correção |
|---|---|---|
| `lib/pdv-caixa-session.ts` | **novo**, 446 | Módulo puro: `decideCaixaSessionSync`, `reconcileCaixaSession` (com porta `hydrated`), `applyCaixaSessionDecision`, `decideAberturaCaixa`, `createSingleFlight`, `isCaixaSessionRejectionCode`, `isCaixaReferenceStale` |
| `lib/pdv-caixa-session.test.ts` | **novo**, 735 | 51 testes sobre o módulo puro |
| `lib/operations-store.tsx` | +191/−… | Sinal de hidratação por CHAVE, `refreshCaixaSession` fora do `loadDb`, gatilhos (montagem/visibilidade/rede), reconsulta em recusa por sessão |
| `components/dashboard/caixa/abertura-caixa-modal.tsx` | ±154 | Servidor decide primeiro; estado local só abre após 2xx com `sessaoId` |
| `components/dashboard/caixa/caixa-provider.tsx` | +16 | Expõe `refreshSession` e `sessaoDesatualizada` |
| `components/dashboard/caixa/caixa-status-bar.tsx` | +85 | Botão "Atualizar caixa" nos 3 estados da barra + faixa de sessão desatualizada |
| `components/dashboard/caixa/use-atualizar-caixa.ts` | **novo**, 123 | `useAtualizarCaixa` (ação manual) e `useGarantirSessaoCaixa` (pré-pagamento) |
| `components/dashboard/vendas/pdv-classic.tsx` | ±40 | Pré-pagamento e F5/F9 chamam `garantirSessao` |
| `components/dashboard/vendas/pdv-supermercado.tsx` | ±28 | Porta `caixaProntoParaFinalizar` antes de abrir o pagamento |
| `components/dashboard/vendas/pdv-assistencia-enterprise.tsx` | ±15 | Pré-pagamento passa a exigir `sessaoId` e recuperar |

**Áreas protegidas (CORE_RULES §5):** `auth.ts`, `auth.config.ts`, `proxy.ts`,
`prisma/schema.prisma`, migrations, `lib/prisma.ts`, `next.config.mjs`, `tsconfig.json`,
`AppShell.tsx`, `lib/financeiro/*` — **nenhum tocado**. Nenhuma rota de API alterada.
**Tokens visuais:** a faixa nova usa `border-warning/30 bg-warning/10 text-warning`;
`--warning` existe em `app/globals.css` (10 temas) e já é usado em 10+ componentes.
Nenhuma cor hardcoded; `min-w-0` presente no bloco de texto da faixa.

## 4. Ausência de código de rascunho

`grep -riE "pdv-cart-draft|use-pdv-cart-draft|clearDraft|cartDraft"` sobre **a worktree
inteira**: **zero ocorrências**. O escopo do GOAL 002A ficou restrito à sessão de caixa —
o rascunho de carrinho (A1/A2 da readiness 001) não entrou nem por resíduo.

## 5. Hidratação e troca de loja

`bootstrapDoneRef` é marcado **dentro** do efeito de bootstrap: no mesmo flush de efeitos
ele já vale `true` enquanto `state` ainda é o PADRÃO. A correção troca o sinal por
`caixaHydratedFor` (`useState`) contendo a **chave** hidratada, enfileirado no mesmo lote
dos `setState` de restauração; `caixaHydrated = caixaHydratedFor === storageKey`.

| Exigência | Resultado | Evidência |
|---|---|---|
| Nenhuma decisão antes da hidratação da chave atual | ✅ | `reconcileCaixaSession` recusa com `nao-hidratado` **antes do fetch** (`lib/pdv-caixa-session.ts:259`); `hydrated: caixaHydratedForRef.current === storageKey` |
| Troca de `storeId` invalida a hidratação anterior | ✅ | Sinal é a CHAVE, não booleano — `storageKey` novo ⇒ `caixaHydrated` volta a `false` |
| Resposta tardia da loja anterior não altera a loja atual | ✅ | `storageKeyRef.current !== storageKey` ⇒ `loja-trocada`, sem `setState`; single-flight recriado por efeito em `[storageKey]` |
| Saldo/`sessaoId` não persistidos antes da hidratação | ⚠️ parcial | `saveCaixaSnapshot` passou a ser gateado por `caixaHydrated` ✅; **a chave de ops continua gravando o estado PADRÃO** (dívida preexistente — §12) |
| Servidor sem sessão fecha o local só depois da hidratação | ✅ | S4 + testes de mutação |
| Servidor aberto substitui id ausente ou obsoleto | ✅ | S2, S3 |
| Rede / 401 / 403 mantêm o estado anterior | ✅ | S7a (403 real no navegador: estado intacto) |

**Teste de mutação (a guarda tem dentes).** Com a worktree limpa ao final de cada rodada:

| Mutação | Efeito |
|---|---|
| `if (!params.hydrated)` → `if (false)` | **5 testes falham** (os 5 de hidratação, incl. o experimento H1) |
| `adopt`/`close` clonando `sales` | **3 testes falham** (preservação por referência da fila) |
| guard de loja diferente desligado | **3 testes falham** |
| abertura aceitando resposta sem `sessaoId` | **2 testes falham** |

## 6. Abertura do caixa

Fluxo real conferido em `abertura-caixa-modal.tsx:86-190`: (1) `POST /api/ops/caixa/abrir`;
(2) `decideAberturaCaixa` sobre a resposta; (3) `abrirCaixa()` + `setSessaoId()` **somente**
em `action: "abrir"`. `action: "recusar"` não carrega `sessaoId` nem saldo — é
estruturalmente impossível marcar `isOpen: true` a partir dele.

| Caso | Resultado | Prova |
|---|---|---|
| HTTP de erro (500) | caixa permanece fechado | S9 (navegador) |
| Resposta 200 sem `sessaoId` | caixa permanece fechado | S9 (navegador) |
| Falha de rede | `recusar/rede`, nada aplicado | teste unitário + código |
| Clique duplo | ≤ 1 `POST /caixa/abrir` | S9c (navegador) — `disabled={abrindo}` |
| Servidor informa sessão já existente | adota `sessaoId`, saldo e operador do servidor | teste unitário `alreadyOpen` |
| Loja alterada durante a requisição | *não coberto* — ver F-04 |

**Mudança de comportamento a registrar:** sem `lojaAtivaId` a abertura agora é **recusada**
("Selecione a unidade antes de abrir o caixa"); antes abria localmente. É o
comportamento correto sob DT-13/DT-14 (sem fallback `loja-1`), mas é uma mudança visível.

## 7. Reconciliação — os quatro casos

| # | Servidor | Cliente | Decisão | Prova de navegador |
|---|---|---|---|---|
| 1 | ABERTA | fechado | `adopt / local-fechado` | **S1** ✅ `sessaoId=ATIVA, isOpen=true, saldo=999` |
| 2 | sem sessão | aberto | `close` | **S4** ✅ `isOpen=false, sessaoId=null` |
| 3 | ABERTA | aberto sem `sessaoId` | `adopt / referencia-ausente` | **S2** ✅ |
| 4 | ABERTA | aberto com id obsoleto | `adopt / referencia-obsoleta` | **S3** ✅ |

Independência de `inventory`/`ordens`: **S10** — com as duas rotas em 500 a adoção
acontece do mesmo jeito (`sessaoId=ATIVA, isOpen=true`). Era exatamente o que `main` não
fazia.

Gatilhos verificados no navegador: montagem pós-hidratação (S1–S4), `online` (S7b),
botão "Atualizar caixa" (S8), e o caminho de recusa `CAIXA_FECHADO` → reconsulta
(código, `operations-store.tsx:1670`). `visibilitychange` usa o mesmo handler de `online`.

**Single-flight.** Medido com atraso artificial de 2 s na rota:

```
1 disparo de 'online'      => 3 consultas
2 disparos no mesmo tick   => 3 consultas
5 disparos no mesmo tick   => 3 consultas
1 clique no botão          => 1 consulta
```

O número **não cresce** com o número de disparos ⇒ o serializador funciona dentro da
instância do provider. As 3 consultas por evento **não** vêm de reentrância: são
`loja-2`, `loja-1`, `loja-2` — o `OperationsProvider` é remontado (`key={opsStorageKey}`)
porque `opsStorageKey` oscila para a chave legada durante o refresh da lista de lojas.
Ver F-03.

## 8. Proteção das 24 pendências de sincronização

Fixture local: 24 vendas `syncPending` com `id`, `pedidoId`, `idempotencyKey`,
`terminalId` e `sessaoId` de origem (1/3 delas **sem** `sessaoId`, para representar o
conflito real), 1 devolução pendente e 1 operação de caixa pendente.

| Exigência | Resultado |
|---|---|
| Identidade e conteúdo das 24 intactos após montagem + `online` + 2 cliques | ✅ S13 (24/24 idênticas em `id`, `pedidoId`, `idempotencyKey`, `sessaoId`, `syncPending`) |
| Devoluções e `pendingCaixaOperations` intactos | ✅ S1b/S4b/S13 |
| Adoção preserva a fila **por referência** | ✅ mutação B: clonar `sales` quebra 3 testes |
| Fechamento (`close`) não descarta pendência | ✅ S4b |
| "Atualizar caixa" não limpa fila / não renumera / não associa à sessão nova | ✅ S13, S13b |
| "Atualizar caixa" não chama `flushPendingSales` nem reenvia | ✅ **R1: 0 POSTs de `venda-persist` provocados pelo clique** (1 consulta de sessão) |
| "Atualizar caixa" não apaga cache local | ✅ S13, S15b |

**Ruído que precisou ser isolado.** A primeira rodada mediu 24 e 48 POSTs de
`venda-persist` e isso **não** vem da recuperação: `loadDb` faz
`finally { setOpsDbReady(true) }` mesmo quando `inventory`/`ordens` falham, e o efeito
pré-existente (`operations-store.tsx:1309-1340`) chama `flushPendingSales()` na montagem,
no `online`, no `visibilitychange` e a cada 30 s. Medido isoladamente (R3): **24 POSTs na
montagem, 0 provocados pelo botão**. É o auto-reenvio já conhecido, idêntico em `main`.

## 9. Cobertura dos PDVs ativos

Modalidades resolvidas por rota/navegação (`vendas-pdv.tsx`, `vendas-page-client.tsx`,
`VendasHub.tsx`, `app/dashboard/**`):

| Modalidade | Rota | Barra + "Atualizar caixa" | Porta de pré-pagamento com `sessaoId` |
|---|---|---|---|
| PDV Clássico (`lovable`) | `/dashboard/vendas` | ✅ S14 | ✅ `garantirSessao` |
| PDV Assistência (`services`) | `/dashboard/vendas` | ✅ S14 | ✅ `garantirSessao` |
| PDV Supermercado | `/dashboard/vendas` | ✅ S14 | ✅ `caixaProntoParaFinalizar` |
| **Venda Completa** | `/dashboard/vendas/venda-completa` | ✅ S14 | ❌ **F-02** |
| PDV Next (Black Edition) | `/dashboard/pdv-next` | n/a | ❌ — **gated off** em produção (`NEXT_PUBLIC_OG_EXPERIMENTAL`); persiste venda real quando ligado |
| `pdv-venda-completa-enterprise.tsx` | — | n/a | código morto, não roteado (cabeçalho do arquivo) |

Em todos os PDVs testados o erro mantém os itens já montados: as três portas fazem
`return` **antes** de abrir o modal de pagamento; o carrinho não é tocado e nenhuma venda
é enviada — quem finaliza de novo é o operador (evita venda duplicada). O PDV
Supermercado não cria pendência nova por ausência de sessão: `openPaymentModal` e o
pagamento múltiplo passaram a ser barrados antes do envio.

## 10. Provas de navegador

Build de produção local, `serviceWorkers: "block"`, `/api/**` 100 % interceptado, banco
inalcançável por construção. **25 de 29 cenários OK.** Os 4 desfechos negativos:

| Cenário | Desfecho | Natureza |
|---|---|---|
| S10b / S13c (POSTs de `venda-persist`) | reclassificados | **ruído do harness** — auto-flush pré-existente; re-medido em R1/R3 |
| S11 (dois cliques) | reclassificado | **artefato do harness** — o botão fica `disabled`, o 2º clique só ocorre depois; single-flight comprovado no micro-teste |
| **S16 (multi-terminal)** | **defeito confirmado** | ver F-01 |

Cenários exigidos pelo GOAL e cobertos: 1 (S1), 2 (S2), 3 (S3), 4 (S4), 5 (S5), 7 (S7a/b),
8 (S8), 9 (S9, S9c), 10 (S10), 11 (micro-teste), 13 (S13/R1), 14 (S14). Somam-se S16
(multi-terminal, fora da lista do GOAL) e S15 (dívida preexistente).
**Não cobertos no navegador:** cenário 6 (troca de loja durante a requisição) e cenário 12
(pré-pagamento após reconciliação com carrinho real) — ver §15 "limites desta auditoria".

## 11. Testes, lint, typecheck e build

| Comando | Resultado |
|---|---|
| `npm ci` | ok (909 pacotes) |
| `npx prisma generate` | ok (Prisma 6.19.3) |
| `npx vitest run lib/pdv-caixa-session.test.ts` | **51/51 ✅** |
| `npx vitest run lib/operations-store* components/dashboard/caixa components/dashboard/vendas` | **3 arquivos / 17 testes ✅** |
| `npx vitest run` (completo) | **282 ✅ / 1 ❌ / 4 skipped (287)** · 4073 testes ✅, 2 expected-fail, 136 skipped |
| `npm run typecheck` | **✅ zero erros** |
| `npx eslint` (4 caminhos) | **0 erros**, 20 warnings — todos `react-hooks/exhaustive-deps` preexistentes |
| `git diff --check` | **✅ limpo** |
| `npm run build` | **✅ sucesso** |

O único arquivo vermelho é `tools/fiscal-dry-run-integrity-proof/proof.test.ts`, que
invoca uma ferramenta **Java externa** (`java-external.ts:49`, `URLClassLoader` sem
classpath). Não há interseção com os 10 arquivos da branch: é falha de ambiente desta
máquina, não da entrega.

Confirmado contra `origin/main` no mesmo ambiente:
`npx vitest run tools/fiscal-dry-run-integrity-proof/proof.test.ts` também falha em `main`,
com `UnsupportedClassVersionError: … class file version 61.0, this version of the Java
Runtime only recognizes class file versions up to 52.0` — a máquina tem JRE 8 e o
verificador foi compilado em Java 17. **Falha preexistente e idêntica nas duas pontas.**


## 12. Dívida preexistente — janela do estado padrão de ops

`operations-store.tsx:607` ainda usa `bootstrapDoneRef`. No **mesmo flush** de efeitos da
montagem, o efeito de bootstrap marca o ref e o efeito de persistência já grava
`toPersistedRest(state)` com o estado **PADRÃO** — `sales: []`, `devolucoes: []`,
`pendingCaixaOperations: []`, `caixaSessaoId: null` — por cima de
`assistec-pro-ops-v1-{loja}`. No commit seguinte o estado restaurado é regravado.

Medido no navegador (S15, `Storage.prototype.setItem` instrumentado):
**5 escritas na chave de ops, a 1ª com `sales = 0`**, estado final correto (`sales = 24`).

Classificação pedida pelo GOAL:

- **Pode apagar vendas ou pendências locais?** Sim, em duas situações: (a) crash/kill do
  navegador dentro da janela (sub-milissegundo — risco baixo); (b) **entre abas** — o
  listener `storage` (`operations-store.tsx:626-642`) faz outra aba adotar
  `incoming.sales` e a escrita transitória `sales: []` é um evento `storage` válido.
- **É agravada pela branch?** **Não.** O efeito, o listener e `toPersistedRest` são
  idênticos a `main`. A branch **melhorou** o lado do caixa: `saveCaixaSnapshot` deixou de
  gravar o padrão por cima do snapshot (agora gateado por `caixaHydrated`).
- **Bloqueia esta entrega?** **Não.** É risco preexistente, não introduzido nem ampliado.
- **Deve virar GOAL separado?** **Sim** — trocar `bootstrapDoneRef` por sinal de
  hidratação por chave também no efeito de persistência de ops, e tornar o merge do
  listener `storage` monotônico. Sugestão: `PDV-OPS-PERSIST-HYDRATION-GATE-002C`.

## 13. Achados por prioridade

### F-01 · Reconciliação adota a sessão de OUTRO terminal da mesma loja — `P0`

- **Local:** `lib/pdv-caixa-session.ts:205` (`activeCaixaSessionUrl`) + `lib/operations-store.tsx:836`
- **Descrição:** a consulta é `status=ABERTA&take=1` **sem `terminalId`**, ordenada por
  `abertaEm desc`. Sessões de caixa são **por terminal**: `SessaoCaixa.terminalId` existe,
  `POST /api/ops/caixa/abrir` faz o guard de duplicidade *por terminal*
  (`abrir/route.ts:77`) e `lib/ops-upsert-venda.ts:507` resolve a sessão *por terminal*.
  Uma loja com PDV1 e PDV2 abertos tem duas sessões ABERTAS legítimas; a mais recente
  vence a consulta. Como a branch passou a adotar também em `referencia-obsoleta`, o PDV1
  — com sessão **válida** — é reapontado para a sessão do PDV2.
- **Evidência (navegador, S16):** local `sessaoId=sess-PDV1`, servidor devolve
  `sess-PDV2` (mais recente) ⇒ estado final `caixaSessaoId=sess-PDV2`, `saldoInicial=500`
  (o do PDV2). Reproduzível em montagem, `visibilitychange`, `online`, botão e
  pré-pagamento.
- **Impacto:** as vendas seguintes do PDV1 são gravadas com `payload.sessaoId = sess-PDV2`;
  `sessao-detalhe/route.ts:208` busca vendas **por `payload.sessaoId`**, então o dinheiro
  do PDV1 aparece no fechamento do PDV2. Saldo inicial e hora de abertura exibidos no PDV1
  também passam a ser os do PDV2. Regra de upgrade do template (dinheiro/caixa) ⇒ **P0**.
- **Regressão?** Sim. Em `main` o único ramo de adoção exigia `!localCaixa.isOpen`; um PDV
  com caixa aberto nunca era reapontado.
- **Plano sugerido:** propagar `terminalId` (de `readSelectedTerminal`) para
  `activeCaixaSessionUrl` e para a decisão, ou recusar a adoção quando
  `server.terminalId` divergir do terminal ativo. GOAL corretivo antes do merge.

### F-02 · Venda Completa (rota ativa) fora da porta de pré-pagamento — `P1`

- **Local:** `components/dashboard/vendas/venda-completa-enterprise.tsx:584`
- **Descrição:** a tela `/dashboard/vendas/venda-completa` (ligada no VendasHub,
  `VendasHub.tsx:45`) valida apenas `caixa.isOpen`. Não checa `sessaoId` e não usa
  `useGarantirSessaoCaixa`. `finalizeSaleTransaction` também não valida `caixaSessaoId`
  (`operations-store.tsx:1461`) — quem recusa é o servidor, com `CAIXA_FECHADO`.
- **Evidência:** leitura de código + S14 (a tela monta a barra compartilhada, logo recebe
  a faixa e o botão, mas não a porta). **Não** reproduzido em navegador: a finalização
  exige cliente selecionado e carrinho montado, fora do alcance do harness selado.
- **Impacto:** enquanto a consulta de sessão estiver falhando (403/rede) o estado
  degradado persiste e esta tela ainda finaliza ⇒ nasce pendência nova, exatamente o
  cenário das pendências fantasmas. Os outros três PDVs bloqueiam.
- **Mitigação existente:** a reconciliação automática do provider conserta o estado em
  montagem/foco/rede quando a consulta responde; a janela é o caso de consulta falhando.
- **Plano sugerido:** aplicar `useGarantirSessaoCaixa` no `handleFinalizar` da Venda
  Completa (2 linhas, mesmo padrão do PDV Assistência).

### F-03 · Reconciliação executada para `loja-1` a cada montagem/remontagem — `P2`

- **Local:** `lib/loja-ativa.tsx:297-301` + `lib/ops-loja-id.ts:8-13` + `components/dashboard/app-ops-providers.tsx:16`
- **Descrição:** antes de a lista de lojas hidratar, `opsStorageKey` cai em
  `OPS_KEY_LEGACY` e `opsLojaIdFromStorageKey` mapeia isso para `loja-1`. Como o provider
  usa `key={opsStorageKey}`, ele **remonta** quando a chave estabiliza — e volta a
  remontar quando `refreshStoresList` roda no `online`/foco.
- **Evidência (navegador):** loja ativa `loja-2`; consultas observadas na montagem:
  `["loja-1","loja-2"]`; após 4 eventos `online`: `loja-2, loja-1, loja-2`.
- **Impacto:** um `GET /api/ops/caixa/sessoes?lojaId=loja-1` com header
  `x-assistec-loja-id: loja-1` por remontagem, e possível adoção/gravação de estado de
  caixa de `loja-1` na chave legada, para um operador que está em outra unidade. Não houve
  contaminação da chave da loja ativa em nenhum cenário medido. É também o que faz o
  single-flight parecer não funcionar.
- **Regressão?** Parcial: a consulta a `loja-1` já existia em `main` (dentro do `loadDb`);
  a branch aumenta a frequência (foco/rede) e amplia as decisões possíveis.
- **Plano sugerido:** não reconciliar caixa enquanto `storesLoaded === false`, ou fazer
  `opsLojaIdFromStorageKey` devolver `null` para a chave legada.

### F-04 · Troca de loja durante a requisição — coberta em código, não em navegador — `P3`

- **Local:** `lib/operations-store.tsx:854`
- **Descrição:** a guarda `storageKeyRef.current !== storageKey ⇒ loja-trocada` existe e
  tem teste unitário; a recriação do single-flight por `[storageKey]` também. Não foi
  possível dirigir a troca de unidade no harness selado.
- **Impacto:** nenhum conhecido — é lacuna de **prova**, não defeito observado.

### F-05 · PDV Next (Black Edition) fora da recuperação — `P3`

- **Local:** `components/pdv-next/PdvBlackEdition.tsx:353`
- **Descrição:** valida só `caixa.isOpen` e persiste venda real pelo motor oficial. Está
  **desligado em produção** (`experimentalPdvEnabled`, `app/dashboard/pdv-next/page.tsx:12`).
- **Plano sugerido:** incluir no mesmo GOAL corretivo de F-02 antes de qualquer
  liberação do flag.

### Resumo

| Severidade | Qtd | Itens |
|---|---|---|
| P0 | 1 | F-01 |
| P1 | 1 | F-02 |
| P2 | 1 | F-03 |
| P3 | 2 | F-04, F-05 |

### Pontos positivos (não regredir)

- A causa real de A0 foi corretamente identificada e o remédio é o certo: sinal de
  hidratação por **chave**, não booleano nem ref — com teste de mutação que prova a guarda.
- `applyCaixaSessionDecision` genérico sobre o estado inteiro transforma "não toca na fila
  de vendas" em invariante **verificável por referência**, não em promessa.
- `decideAberturaCaixa` torna o estado degradado `isOpen:true + sessaoId:null`
  estruturalmente inalcançável a partir de uma abertura recusada.
- A reconciliação saiu do `loadDb`: estoque e OS quebrados não travam mais a recuperação.
- Comentários no código explicam o **porquê** de cada guarda, com referência ao incidente.

## 14. Classificação

> ## **C — BLOQUEADA**

A entrega resolve, de forma comprovada, os cinco defeitos que se propôs a resolver, e as
24 pendências ficam intactas em todos os caminhos medidos. O bloqueio é por **F-01**, que
a própria lista de bloqueadores do GOAL cobre duas vezes ("caixa falso aberto"/"falha de
navegador reproduzível") e que a convenção de severidade eleva a P0 por envolver dinheiro:
em loja com dois terminais, um PDV com sessão válida passa a operar sobre a sessão do
outro terminal, e o fechamento de caixa mistura as duas. Não existia em `main`.

**F-02** entra como bloqueador secundário pelo critério literal do GOAL ("algum PDV ativo
fora da recuperação") — é uma correção de duas linhas.

Reclassificação para **A** depende apenas de F-01 e F-02; F-03 pode virar ressalva de
classe B se o corretivo de F-01 for aceito isoladamente.

## 15. Limites desta auditoria

- Cenários 6 (troca de loja em voo) e 12 (pré-pagamento após reconciliação, com carrinho
  real) não foram dirigidos no navegador; ficam com prova de código e teste unitário.
- F-02 é prova de código, não de navegador (justificativa em F-02).
- Nada foi executado contra produção: nenhuma venda, nenhum caixa, nenhuma pendência,
  nenhum banco real. Todo o tráfego `/api/**` foi interceptado e `DATABASE_URL`/`DIRECT_URL`
  apontam para uma porta morta.
- Hook e componente continuam **intestáveis** neste repo (`vitest.config.ts` é
  `environment: "node"` + `include: **/*.test.ts`): toda a prova de fiação é de navegador.

## 16. Próximo passo recomendado

1. Abrir **`PDV-CAIXA-SESSION-TERMINAL-SCOPE-002B`**: propagar `terminalId` na consulta e
   na decisão de adoção (F-01) e aplicar `useGarantirSessaoCaixa` na Venda Completa (F-02).
   Reaproveitar os cenários S16 e S13 desta auditoria como critério de pronto.
2. Reexecutar esta readiness sobre a branch corrigida; com F-01 e F-02 fechados a
   classificação esperada é **A**.
3. Abrir **`PDV-OPS-PERSIST-HYDRATION-GATE-002C`** para a dívida preexistente do §12
   (não bloqueia esta entrega).
4. Manter **`PDV-CART-DRAFT-MULTITAB-HARDENING-002B`** como GOAL separado (A1/A2 da
   readiness 001 seguem em aberto).

---

## Apêndice A · Saídas brutas das provas

### A.1 Implementação (`0e355d7`, `next start` em 127.0.0.1:3311)

```
OK    | S1 servidor ABERTO + local FECHADO ⇒ adota | sessaoId=sess-servidor-ATIVA isOpen=true saldo=999
OK    | S1b fila de 24 pendências intacta após adoção | 24/24 idênticas
OK    | S2 local ABERTO sem sessaoId ⇒ adota referência ausente | sessaoId=sess-servidor-ATIVA
OK    | S3 sessaoId OBSOLETO ⇒ substituído pela sessão ativa | sessaoId=sess-servidor-ATIVA
OK    | S4 servidor SEM sessão ⇒ fecha o caixa local | isOpen=false sessaoId=null snapshot.isOpen=false
OK    | S4b fechamento preserva as 24 pendências | 24/24 idênticas
OK    | S5 F5 ⇒ estado reconciliado persiste e continua correto | sessaoId=sess-servidor-ATIVA isOpen=true
OK    | S7a consulta com HTTP 403 ⇒ estado local INTACTO (não fecha o caixa) | isOpen=true sessaoId=sess-antiga-OBSOLETA
OK    | S7b evento `online` ⇒ reconcilia e adota a sessão ativa | sessaoId=sess-servidor-ATIVA
OK    | S7c 24 pendências intactas após a recuperação | 24/24 idênticas
OK    | S8 botão 'Atualizar caixa' visível + recupera a sessão | botoes=1 banner-degradado=1 sessaoId=sess-servidor-ATIVA
OK    | S9 abertura recusada (HTTP 500) ⇒ caixa NÃO abre localmente | isOpen=false sessaoId=null POSTs=1
OK    | S9 abertura recusada (200 sem sessaoId) ⇒ caixa NÃO abre localmente | isOpen=false sessaoId=null POSTs=1
OK    | S9c clique duplo em Abrir Caixa ⇒ no máximo 1 POST /caixa/abrir | POSTs=1
OK    | S10 inventory+ordens 500 ⇒ reconciliação acontece assim mesmo | sessaoId=sess-servidor-ATIVA isOpen=true
OK    | S10c 24 pendências intactas | 24/24 idênticas
OK    | S13 após 3 reconciliações: identidade e conteúdo das 24 pendências intactos | 24/24 idênticas
OK    | S13b nenhuma pendência associada à sessão nova | sessaoId de origem preservado
OK    | S13d caixa reconciliado apesar de tudo | sessaoId=sess-servidor-ATIVA
OK    | S14 PDV Clássico     | botoes=1 sessaoId=sess-servidor-ATIVA
OK    | S14 PDV Assistência  | botoes=1 sessaoId=sess-servidor-ATIVA
OK    | S14 PDV Supermercado | botoes=1 sessaoId=sess-servidor-ATIVA
OK    | S14 Venda Completa   | botoes=1 sessaoId=sess-servidor-ATIVA
FALHA | S16 terminal PDV1 com sessão válida NÃO deveria adotar a sessão do PDV2 | sessaoId após reconciliação = sess-PDV2 (esperado sess-PDV1) · saldo = 500
OK    | S15 chave de ops grava o estado PADRÃO antes da hidratação (dívida PREEXISTENTE) | 1ª escrita com sales=0 · total escritas=5
OK    | S15b estado final na chave de ops já reconciliado e com 24 pendências | sales=24 sessaoId=sess-servidor-ATIVA
```

Re-teste isolado do ruído do harness:

```
OK    | R3 flush PRÉ-EXISTENTE reenvia as 24 pendências na montagem | POSTs venda-persist na montagem = 24
OK    | R1 clique em 'Atualizar caixa' NÃO dispara reenvio de venda | POSTs venda-persist provocados pelo clique = 0 · consultas de sessão = 1
OK    | R1b fila permanece com 24 pendências e sessões de origem intactas | sales=24
OK    | R1c caixa reconciliado pelo botão | sessaoId=sess-servidor-ATIVA
```

Micro-teste do single-flight (atraso de 2 s na rota) e origem das consultas:

```
montagem: 2 consultas                 → ["loja-1","loja-2"]
1 disparo de 'online'  => 3 consultas → loja-2@+0ms | loja-1@+964ms | loja-2@+1285ms
2 disparos no mesmo tick => 3 consultas
5 disparos no mesmo tick => 3 consultas
1 clique no botão      => 1 consulta
12 s parado (sem evento) => 0 consultas
```

### A.2 `origin/main` (`9068263`, `next start` em 127.0.0.1:3312)

```
OK   | M1 servidor ABERTO + local aberto SEM sessaoId ⇒ main NÃO reconcilia | caixaSessaoId=null
OK   | M2 sessaoId OBSOLETO ⇒ main NÃO substitui pela sessão ativa | caixaSessaoId="sess-antiga-OBSOLETA"
OK   | M3 inventory/ordens 500 ⇒ main não adota nem com caixa ABERTO no servidor | caixaSessaoId=null isOpen=false
OK   | M4 POST /caixa/abrir 500 ⇒ main abre o caixa LOCALMENTE mesmo assim | isOpen=true sessaoId=null
OK   | M6 main NÃO troca a sessão do PDV1 pela do PDV2 | caixaSessaoId=sess-PDV1 saldo=111
OK   | M5a servidor ABERTO + referência perdida ⇒ degradado sobrevive a F5 e a novo login
       1ª carga: isOpen=true/sessao=null · F5: isOpen=true/sessao=null · nova navegação: isOpen=true/sessao=null
OK   | M5b servidor SEM sessão + inventory/ordens 500 ⇒ caixa falso aberto sobrevive a F5
       1ª carga: isOpen=true/sessao=null · F5: isOpen=true/sessao=null · nova navegação: isOpen=true/sessao=null

[padrão de consultas /caixa/sessoes em main] ["loja-1","loja-2","loja-1","loja-2","loja-1","loja-2","loja-1","loja-2","loja-1","loja-2"]
```

### A.3 Testes de mutação (worktree restaurada após cada rodada)

```
if (!params.hydrated) → if (false)          ⇒ 5 falhas | 46 passam (51)
adopt/close clonando `sales`                ⇒ 3 falhas | 48 passam (51)
guard de loja diferente desligado           ⇒ 3 falhas | 48 passam (51)
abertura aceitando resposta sem `sessaoId`  ⇒ 2 falhas | 49 passam (51)
```

### A.4 Reprodutibilidade

Harness escrito do zero para esta auditoria (não reaproveita nenhum teste da branch), em
`node_modules/.audit/` da worktree — deliberadamente fora do controle de versão, conforme
a regra de versionar apenas o relatório. Semente de estado por `page.addInitScript` nas
chaves `assistec-pro-ops-v1-{loja}`, `omnigestao:caixa:{loja}`,
`assistec-pro-loja-ativa-v1`, `@omnigestao:pdv-terminal:{loja}`,
`@omnigestao:pdv-layout::{loja}` e `omni-pdv-classic-layout::{loja}`.
`/api/ops/venda-persist` responde 503 em todos os cenários — sem isso o auto-reenvio
pré-existente zera `syncPending` contra o mock e contamina a evidência da fila.
