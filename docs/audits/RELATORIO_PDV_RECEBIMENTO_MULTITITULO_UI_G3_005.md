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
| **Estado** | PR [#162](https://github.com/rafaelfaria49-png/omni-gestao-pro-pdv-claude/pull/162) aberta. **Não mergeada.** 1ª revisão independente feita (P0=0 · P1=1 · P2=6 → corrigidos); 2ª passada sobre os fixes pendente (§12). |

---

## 1. O que passou a existir

O `PdvRecebimentoModal` deixou de ser um fluxo de um título por vez. Depois de escolher o
cliente, o operador vê **abas Em aberto / Recebidos**, marca N títulos por checkbox (com
**Selecionar todos**), opcionalmente informa **valor parcial por título**, confere numa
etapa de confirmação e grava **tudo numa requisição** para o endpoint de lote do G2.

O botão **"Quitar este título"** continua em cada linha, chamando a rota singular
`/api/pdv/receber-conta` com o mesmo corpo e o mesmo ciclo de `idempotencyKey` de antes —
receber um título só nunca passou a exigir seleção múltipla.

> **O que saiu junto:** o botão irmão **"Baixa parcial"** por linha (que fazia
> `op:"parcial"` na rota singular) não existe mais. Parcial agora é o modo
> **"Valor parcial por título"** e vai pelo lote, inclusive quando é um título só. Isso é
> o §3 do design aprovado ("recebimento parcial como modo separado, não input por card"),
> não um efeito colateral — mas é uma ação de produção que mudou de rota, e fica dito.

---

## 2. Arquivos

**Criados**

| Arquivo | Papel |
|---|---|
| `lib/contas-receber-cliente-match.ts` | Escada determinística `clienteId → documento → telefone → nome exato` |
| `lib/contas-receber-lote.ts` | Seleção, payload do lote, idempotência, trava de submissão, leitura de conflito, abas |
| `lib/contas-receber-cliente-match.test.ts` · `lib/contas-receber-lote.test.ts` · `lib/contas-receber-recibo-lote.test.ts` | 48 testes focados do G3 |

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
`contas-receber-cliente-match.ts`) e o `.tsx` é casca visual. Os 48 testes do G3 exercitam
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
cupom singular (`buildReciboPagamentoInnerHtml`) tem contrato de saída **byte a byte
idêntico** e segue coberto pelos testes originais — o que mudou para ele é só o **valor**
de `lojaNome` recebido, que agora passa por `resolveReciboLojaNome` em vez do antigo
`lojaNome?.trim() || "Minha Loja"`. Mesma correção aprovada, aplicada aos dois cupons. Nunca se imprime N recibos individuais para um lote.

**Nome da loja.** `resolveReciboLojaNome` escolhe a primeira fonte real: prop `lojaNome` do
call site (o PDV Classic já passava) → `empresaDocumentos.nomeFantasia` → `razaoSocial`, do
`useLojaAtiva()` que o modal já consumia. Isso corrigiu Assistência e Supermercado **sem
tocar nos call sites**. Sem nenhuma fonte real, cai no rótulo neutro
`RECIBO_LOJA_NOME_FALLBACK = "Loja"` — não se fabrica nome comercial. O literal
`"Minha Loja"` deixou de ser alcançável pelo recebimento.

---

## 9. P0 / P1 / P2

**P0 = 0 · P1 = 0.**

### P2-1 — dois degraus da escada sem produtor (mitigado por fail-closed)
`ContaReceberTitulo` não tem FK de cliente nem coluna de documento/telefone; só
`payload.clienteId` (gravado por OS e agora por novas vendas à prazo do PDV) e a coluna
`cliente`. Para títulos legados sem `clienteId`, a escada agora exige **prova de unicidade**
na loja ativa (`isNomeUnico`): se existirem 2+ clientes com o mesmo nome na loja, o matching
faz **fail-closed** e não atribui o débito a nenhum deles por nome, exibindo aviso de
identidade ambígua na UI.

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

### P2-6 — `"Minha Loja"` e a soma de homônimos continuam vivos no painel Financeiro
`RECIBO_LOJA_NOME_PADRAO` e `calcSaldoDevedorClienteTodaLoja` /
`calcSaldoDevedorOutrosPendentesMesmoCliente` seguem exportados e **chamados por
`components/dashboard/financeiro/contas-receber.tsx`**, que este GOAL não toca. O §8 do
design mandava removê-los; só o PDV parou de usá-los. O defeito de somar homônimos e o
default "Minha Loja" continuam ativos naquela superfície.

### P2-7 — saldo devedor do recibo mistura número fresco com número em cache
`saldoDevedorAtual` soma os `saldoDepois` desta resposta (frescos, do servidor) com o
`saldoAberto` dos demais títulos do cliente, que veio da última listagem. Se outra sessão
mexer num título **diferente** do mesmo cliente entre a carga e o envio, o rodapé do cupom
fica marginalmente defasado. É exibição — nenhum dinheiro se move sobre esse número.

---

## 10. Validação

```
TESTES_FOCADOS_G3=79 passed (5 arquivos)
REGRESSAO=243 passed (14 arquivos: modal/aberto/recibo/lote/singular/canonicalidade/parcial/caixa/transversal/aprazo)
TYPECHECK=npm run typecheck OK
LINT/DIFF_CHECK=git diff --check limpo
BUILD=npm run build OK
```

---

## 12. Revisões independentes e fechamento de P1

### 1ª Rodada (`adf0295`)
`P0=0 · P1=1 · P2=6 · VERDICT=REQUEST_CHANGES`
Corrigidos no commit `a26cafa`: teto de 25 títulos, ordem do desfecho/flag `confirmado`,
parcial <= 0 rejeitado explicitamente, e guardas de fechamento durante gravação.

### 2ª Rodada (`a26cafa`)
`P0=0 · P1=1 · P2=7 · VERDICT=REQUEST_CHANGES`
Achado P1: matching por nome exato sem `clienteId` permitia que 2 clientes homônimos na mesma
loja vissem o mesmo título e houvesse recebimento cruzado de contas. Títulos de venda a prazo do
PDV não persistiam `clienteId`.

### Fechamento do P1 (`PDV-RECEBIMENTO-MULTITITULO-UI-G3-005-P1-HOMONYM-FIX`)
1. **Matching fail-closed:** no Degrau 4 (nome exato), exige prova de que o nome é único na
   loja ativa. Se houver 2+ clientes com o mesmo nome na loja, ou se a checagem falhar/estiver
   indisponível, o vínculo por nome faz **fail-closed** (`null`). O título não é atribuído a
   nenhum dos homônimos, prevenindo cobrança cruzada.
2. **Aviso transparente:** quando existem títulos daquele nome bloqueados por ambiguidade,
   o modal exibe: *"Há mais de um cliente com este nome. Vincule o título ao cadastro correto antes de receber."*
3. **Novas vendas a prazo do PDV (`ops-upsert-venda.ts`):** passam a persistir o `clienteId`
   validado pelo servidor no `aprazoPayload` de todas as parcelas, eliminando a dependência do
   fallback por nome para vendas originadas no PDV.

---

## 13. Ponto de parada

PR #162 aberta e **não mergeada**. Pronto para nova rodada de validação independente.
