# PDV · Receber conta — UI multitítulo (G3)

| | |
|---|---|
| **GOAL** | `PDV-RECEBIMENTO-MULTITITULO-UI-G3-005` (G3 da sequência G1→G2→G3) |
| **Tipo** | Implementação de UI + recibo consolidado. **Sem schema, sem alteração do backend G2.** |
| **Data** | 2026-09-05 |
| **Base** | `origin/main` @ `a18c06d` |
| **Branch** | `goal/pdv-recebimento-multititulo-ui-g3-005` |
| **Design aprovado** | [`AUDITORIA_PDV_RECEBIMENTO_MULTITITULO_DESIGN_001.md`](./AUDITORIA_PDV_RECEBIMENTO_MULTITITULO_DESIGN_001.md) §3 · projeto Claude Design `433f40ee-849c-4f8f-a6e4-b45c68eab9aa` |
| **Backend** | [`RELATORIO_PDV_RECEBIMENTO_MULTITITULO_BACKEND_G2_003.md`](./RELATORIO_PDV_RECEBIMENTO_MULTITITULO_BACKEND_G2_003.md) — `POST /api/pdv/receber-conta-lote`, consumido sem alteração |
| **Estado** | PR aberta. **Não mergeada.** Revisão independente por outra família pendente. |

---

## 1. O que passou a existir

O `PdvRecebimentoModal` deixou de ser um fluxo de um título por vez. Depois de escolher o
cliente, o operador vê **abas Em aberto / Recebidos**, marca N títulos por checkbox (com
**Selecionar todos**), opcionalmente informa **valor parcial por título**, confere numa
etapa de confirmação e grava **tudo numa requisição** para o endpoint de lote do G2.

O botão **"Quitar este título"** continua em cada linha, chamando a rota singular
`/api/pdv/receber-conta` exatamente como antes — receber um título só nunca passou a
exigir seleção múltipla.

---

## 2. Arquivos

**Criados**

| Arquivo | Papel |
|---|---|
| `lib/contas-receber-cliente-match.ts` | Escada determinística `clienteId → documento → telefone → nome exato` |
| `lib/contas-receber-lote.ts` | Seleção, payload do lote, idempotência, trava de submissão, leitura de conflito, abas |
| `lib/contas-receber-cliente-match.test.ts` · `lib/contas-receber-lote.test.ts` · `lib/contas-receber-recibo-lote.test.ts` | 45 testes focados do G3 |

**Alterados**

| Arquivo | Mudança |
|---|---|
| `components/dashboard/vendas/pdv-recebimento-modal.tsx` | UI multitítulo, abas, confirmação, sucesso, conflito, recibo consolidado |
| `lib/contas-receber-recibo.ts` | `buildReciboLoteInnerHtml` / `imprimirReciboLote` / `resolveReciboLojaNome` (aditivos) |
| `app/api/ops/contas-receber-list/route.ts` | Expõe `clienteId` na linha (aditivo) |
| `lib/contas-receber-types.ts` | Campo opcional `clienteId` em `ContaReceberRow` |
| `lib/contas-receber-aberto.test.ts` | 3 asserções de fonte reescritas para o mecanismo novo (§7) |

**Não tocados:** `prisma/schema.prisma`, auth/proxy, Fiscal, `lib/financeiro/services/recebimento-lote-service.ts`,
`app/api/pdv/receber-conta-lote/route.ts`, `app/api/pdv/receber-conta/route.ts`, os três call sites do modal.

---

## 3. Por que a regra financeira mora fora do componente

O harness do Vitest roda em `environment: "node"` e o `include` é `**/*.test.ts` — **`.tsx`
não é compilado**. Testar seleção, payload e conflito dentro do componente seria
impossível. Toda a decisão financeira ficou em módulos puros (`contas-receber-lote.ts`,
`contas-receber-cliente-match.ts`) e o `.tsx` é casca visual. Os 45 testes do G3 exercitam
o mesmo código que a tela executa.

---

## 4. Matching de cliente — o defeito fechado

O achado H da auditoria de design era substring bidirecional
(`titulo.includes(cliente) || cliente.includes(titulo)`) sobre nome, documento **ou**
telefone: selecionar **"Ana"** trazia os títulos de **"Mariana"** e **"Joana"**, e o
operador podia dar baixa na conta de outra pessoa.

A escada nova é **positiva e decisiva**: o primeiro degrau em que os dois lados têm valor
decide. Bateu, é do cliente; não bateu, **não cai para o degrau seguinte** — descer depois
de um `clienteId` divergente reabriria exatamente a porta do homônimo.

| Degrau | Fonte no título | Estado hoje |
|---|---|---|
| 1. `clienteId` | `payload.clienteId` → `Cliente.id` (mesmo id de `/api/clientes`) | **Vivo** — exposto na listagem por este GOAL |
| 2. documento | `clienteDocumento` | Sem produtor no repositório (§9 P2-1) |
| 3. telefone | `clienteTelefone` | Sem produtor no repositório (§9 P2-1) |
| 4. nome exato normalizado | coluna `cliente` | **Vivo** — sem acento, sem caixa, igualdade exata |

Sem identificação segura o título **não** aparece para o cliente. Falso-negativo é
preferível: deixar de cobrar é recuperável, receber a conta de outra pessoa não é.

O rodapé do recibo singular também deixou de agregar por `normClienteKey` (que somava
homônimos) e passou a usar a mesma lista casada pelo matcher.

---

## 5. Contrato com o backend G2

Cada item enviado carrega `localKey`, `saldoEsperado`, `valorReceber` e `tituloId` quando a
listagem trouxe o `audit` — **nunca** nome de cliente. O saldo sai sempre do `saldoAberto`
canônico do servidor; `row.valor` é o valor bruto e não diminui em baixa parcial.

**Total.** A UI soma só para exibir e para travar a CTA. O número que vale é o
`totalRecebido` que o servidor recalcula dentro da transação — é ele que vai para o estado
de sucesso, para o recibo e para `adicionarEntrada`.

**Distribuição.** Não existe "mais antigo primeiro". Cada título leva o valor que o
operador determinou (saldo cheio por padrão, ou o parcial digitado, limitado ao saldo).

**Idempotência.** A chave é por *tentativa econômica* — impressão de `sessaoId + forma +
pares título/valor`, ordenada por `localKey` para que reordenar a tela não invente uma
segunda operação. Enquanto a tentativa não tem desfecho, o retry **reusa** a chave: se o
POST commitou e a resposta se perdeu, o servidor reconhece o replay em vez de gravar um
segundo recebimento. Sucesso ou recusa definitiva encerram a chave; a próxima operação
nasce com chave nova. Falha de rede **não** é desfecho e preserva a chave.

**`adicionarEntrada` no replay.** Em `jaRegistrado: true` a entrada local **é** somada. A
única forma de chegar a um replay com essa chave é o retry de uma tentativa cujo resultado
se perdeu — o servidor gravou, o cliente caiu no `catch` e nunca somou. Somar ali converge
o estado local e **não** gera segunda operação server-side (o servidor recusou regravar).
A trava síncrona impede duas execuções concorrentes.

---

## 6. Conflito, duplo submit e estados

| Código do servidor | Comportamento da tela |
|---|---|
| `saldo_divergente` · `titulo_alterado` | Não assume sucesso · recarrega a listagem · retira da seleção os `localKey` apontados em `detalhes[]` · aviso **"Os valores foram atualizados. Confira novamente antes de receber."** · **sem retry automático** |
| `idempotency_conflict` | Chave encerrada · recarrega · **limpa a seleção inteira** (sem `detalhes`, reaproveitar seleção stale é o que o GOAL proíbe) |
| `caixa_fechado` | Mensagem própria e saída do fluxo de gravação |
| `periodo_fechado` | Mensagem própria, sem recarregar |
| 409 sem código | Tratado como conflito de estado: recarrega e reconfere |
| 5xx | **Não** encerra a tentativa — a chave sobrevive para o retry incerto |

**Duplo submit.** `disabled` no botão só chega ao DOM no render seguinte; Enter + clique no
mesmo tick passariam. A trava é síncrona (`iniciarSubmissao`), tomada antes de qualquer
escrita e liberada no `finally`. Durante a gravação: CTA e "Voltar" bloqueados, indicador
de processamento, e o modal **não fecha** (ESC, clique fora e `onOpenChange` recusados).

**Sucesso.** Quantidade, total do servidor, forma, item a item com valor recebido e saldo
remanescente, saldo devedor do cliente, e `onReceived` chamado **uma única vez**.

Estados cobertos na tela: cliente sem títulos · vários abertos · alguns selecionados ·
todos · parcial · confirmação · processando · sucesso · aba Recebidos · erro de carregamento ·
conflito/stale · caixa fechado.

---

## 7. Aba Recebidos

A listagem canônica **completa** fica em memória (`rows`) e as visões são derivadas por
`partitionTitulos`: **em aberto = saldo > ε**, nunca status textual — o snapshot do
`payload` ainda diz "pendente" para título já quitado no servidor. Cancelado e estornado
saem das duas abas: não são dívida a cobrar nem dinheiro que entrou.

Três asserções de `lib/contas-receber-aberto.test.ts` liam a fonte do modal por nomes que o
G3 substituiu (`isTituloEmAberto` → `partitionTitulos`, `somaSaldoEmAberto` → soma dos
saldos canônicos, `{filtered.length}` → `{abertos.length}`). Foram reescritas para o
mecanismo atual **preservando a propriedade guardada** — o corte continua sendo por saldo
canônico, nunca por status ou valor bruto.

---

## 8. Recibo

`buildReciboLoteInnerHtml` / `imprimirReciboLote` produzem **um** cupom para os N títulos:
nome real da loja, cliente, data/hora, forma, lista dos títulos com valor recebido e
situação (quitado / abatido com o que resta), total recebido e saldo devedor restante. O
cupom singular (`buildReciboPagamentoInnerHtml`) segue intacto e coberto pelos testes
originais. Nunca se imprime N recibos individuais para um lote.

**Nome da loja.** `resolveReciboLojaNome` escolhe a primeira fonte real: prop `lojaNome` do
call site (o PDV Classic já passava) → `empresaDocumentos.nomeFantasia` → `razaoSocial`, do
`useLojaAtiva()` que o modal já consumia. Isso corrigiu Assistência e Supermercado **sem
tocar nos call sites**. Sem nenhuma fonte real, cai no rótulo neutro
`RECIBO_LOJA_NOME_FALLBACK = "Loja"` — não se fabrica nome comercial. O literal
`"Minha Loja"` deixou de ser alcançável pelo recebimento.

---

## 9. P0 / P1 / P2

**P0 = 0 · P1 = 0.**

### P2-1 — dois degraus da escada sem produtor
`ContaReceberTitulo` não tem FK de cliente nem coluna de documento/telefone; só
`payload.clienteId` (gravado pela origem OS) e a coluna `cliente`. Os degraus 2 e 3 estão
implementados e testados, mas **nenhum writer do repositório os alimenta hoje**. Consequência
honesta: para títulos sem `clienteId`, dois clientes com o **mesmo nome exato** continuam
compartilhando a lista. É estritamente melhor que a substring anterior (que misturava nomes
diferentes), e fechar de vez exige FK/coluna — schema, fora do escopo.

### P2-2 — aba Recebidos sem data e sem valor do recebimento
A listagem canônica não devolve quando nem quanto foi recebido, só o título e o saldo zerado.
A aba mostra o **valor do título** rotulado como tal, e o vencimento — não uma "data de
recebimento" que não existe. O botão "Reimprimir recibo" do design **não** foi implementado:
não há recibo persistido para reimprimir, e um botão que gerasse um documento novo seria mock
enganoso.

### P2-3 — divergência consciente do design: distribuição automática
O design (E4) previa "dos mais antigos para os mais novos" como modo de distribuição. O GOAL
veda distribuição implícita, então só o modo **manual** foi implementado: cada título recebe o
valor que o operador digitou, limitado ao próprio saldo. O painel de "sobra sem título" do
design perde a razão de existir nesse modelo e não foi construído.

### P2-4 — teto de itens duplicado
`RECEBIMENTO_LOTE_UI_MAX_ITENS = 25` espelha `RECEBIMENTO_LOTE_MAX_ITENS` do service, que não
pode ser importado no cliente (arrastaria `@/generated/prisma` para o bundle). Há teste que lê
o arquivo do service e falha se os números divergirem.

### P2-5 — `sm:max-w-lg` do shadcn
O `DialogContent` do repositório traz `sm:max-w-lg`; um `max-w-*` sem variante não o vence.
O modal precisou de `sm:max-w-5xl`. O modal antigo tinha `max-w-3xl` e estava, na prática,
limitado a 512 px — a tabela densa não caberia. Nenhum outro modal foi tocado.

---

## 10. Validação

```
TESTES_FOCADOS_G3=45 passed (3 arquivos)
REGRESSAO=200 passed (12 arquivos: modal/aberto/recibo/lote/singular/canonicalidade/parcial/caixa/transversal)
SUITE_COMPLETA=7194 passed · 3 arquivos falhando, todos PRÉ-EXISTENTES e de ambiente:
  lib/fiscal/xml/nfce-xml-builder.test.ts  → "xmllint ausente no PATH"
  tools/fiscal-dry-run-integrity-proof/    → Java 8 lendo class file 61.0
  scripts/contador/setup-storage.test.ts   → SyntaxError no próprio arquivo
  (nenhum importa contas a receber / PDV; fora do diff)
TYPECHECK=npm run typecheck OK
LINT=eslint dos 10 arquivos OK
DIFF_CHECK=git diff --check limpo
BUILD=npm run build → "✓ Compiled successfully in 2.3min"
```

> Nota de execução: as worktrees aninhadas `.claude/worktrees/**` e `.qwen/worktrees/**` têm
> cópias dos mesmos testes em commits antigos e são varridas pelo `vitest run` do repositório
> raiz. Foram excluídas explicitamente; as falhas delas não pertencem a este diff.

### Validação visual

Feita contra o design aprovado em **1440×900** e **375×812**, com o componente real
(tokens, shadcn e Tailwind de produção) montado num harness temporário fora do gate de
sessão, com `fetch` stubado e dados sintéticos. **O harness foi apagado antes do commit**
(`app/icon-g3-check/` não existe no diff nem no build) e a entrada de dev server usada ficou
em `.claude/launch.json`, que é gitignorado. Nenhuma gravação real foi executada.

Conferido:

- estado **E2 do design** reproduzido com os mesmos números — 4 selecionados, CTA
  `Receber 4 títulos — R$ 262,38`;
- cabeçalho derivado do saldo canônico: `Saldo em aberto R$ 637,86 · Vencidos ● 3 · Títulos 9`;
- abas `Em aberto 9` / `Recebidos 2`; pills `VENCIDO`/`PARCIAL`; data vencida em `foreground`
  bold + ponto `bg-destructive` (a restrição de token do design critique: `--destructive` não
  serve como cor de texto solta);
- parcial por título: `40,00` em título de `R$ 89,90` → "Fica devendo R$ 49,90" e total do
  lote de `R$ 637,86` para `R$ 587,96`;
- confirmação com os 9 títulos, `TOTAL A RECEBER R$ 587,96` e "fica devendo R$ 49,90";
- **conflito 409 real** exercitado ponta a ponta pela UI: toast, volta para a lista, banner
  "Os valores foram atualizados. Confira novamente antes de receber.", seleção limpa, CTA
  desabilitada, sem retry automático;
- 375 px sem overflow horizontal (`scrollWidth === clientWidth === 375`), CTA acessível,
  nenhum valor ou ação cortada. Ajustes feitos por causa da medição: descrição com
  `line-clamp-2`, "Recarregar" icon-only, forma e CTA na mesma linha (área de lista
  139 px → 200 px).

---

## 11. Critérios de aceite

```
MULTI_SELECT_UI=true
SELECT_ALL=true
PARTIAL_PER_TITLE=true
BATCH_ENDPOINT_USED=true
BATCH_TOTAL_FROM_SERVER=true
SINGULAR_RECEIPT_PRESERVED=true
CLIENT_FUZZY_MATCH_REMOVED=true
CROSS_CUSTOMER_RECEIPT_BLOCKED=true    (ver P2-1: homônimo exato sem clienteId)
STALE_409_HANDLED=true
DOUBLE_SUBMIT_BLOCKED=true
OPEN_RECEIVED_TABS=true
CONSOLIDATED_RECEIPT=true
REAL_STORE_NAME_RECEIPT=true
LOADING_EMPTY_ERROR_STATES=true
RESPONSIVE=true
SCHEMA_CHANGED=false
G2_BACKEND_REGRESSION=false
```

---

## 12. Ponto de parada

PR aberta e **não mergeada**, conforme o GOAL. O próximo gate é a **revisão independente por
outra família de modelo**, com foco em seleção financeira, matching de cliente, payload G2,
conflitos 409, recibo e regressão do fluxo singular.
