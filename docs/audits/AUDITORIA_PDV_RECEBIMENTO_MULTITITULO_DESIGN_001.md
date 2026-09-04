# PDV · Receber conta — auditoria e redesenho do recebimento multitítulo

| | |
|---|---|
| **GOAL** | `PDV-RECEBIMENTO-MULTITITULO-DESIGN-001` |
| **Tipo** | Auditoria + design. **Nenhuma alteração de código produtivo.** |
| **Data** | 2026-09-03 |
| **Base** | `origin/main` @ `9978e30` |
| **Branch** | `design/pdv-recebimento-multititulo-001` |
| **Status** | **GATE VISUAL 1 APROVADO** — implementação do lote **não autorizada** |

> Este documento é o entregável de design/documental do GOAL. Ele **não** autoriza
> implementação. O próximo GOAL técnico é o de pré-requisitos (§6), não o do lote.

---

## 1. Escopo e ponto de parada

Feito: auditoria do comportamento real do fluxo "Receber conta" (F5/F9) no PDV,
fechamento do contrato funcional desejado, redesenho no Claude Design, design
critique com segunda passada, e esta documentação.

Não feito, por decisão humana explícita: alteração de componente produtivo, de API,
de Financeiro, de Caixa, de schema/migration, de auth/proxy, de Fiscal; implementação
multitítulo; merge.

---

## 2. Decisão de sequenciamento (governante)

Aprovada a direção visual, os achados de canonicalidade, `payload.historico`,
atomicidade, idempotência do Caixa e re-liquidação de título pago **deixam de ser
observações e passam a ser pré-requisitos obrigatórios**, anteriores ao lote.

Sequência decidida:

```
G1  pré-requisitos técnicos (§6)   ← próximo GOAL
G2  endpoint de recebimento em lote (§7)
G3  UI multitítulo aprovada (§3) + recibo consolidado (§8)
```

Inverter essa ordem constrói o lote sobre um saldo que não é confiável (§5) e sobre
services que não fazem rollback (§6.1).

---

## 3. Direção visual aprovada

Preview navegável (Claude Design):
<https://claude.ai/design/p/433f40ee-849c-4f8f-a6e4-b45c68eab9aa?file=Recebimento-Multititulo.dc.html>

Projeto `433f40ee-849c-4f8f-a6e4-b45c68eab9aa` · arquivos `Recebimento-Multititulo.dc.html`,
`theme.css`, `support.js`. Dados sintéticos; nenhum dado real de cliente foi usado.

Estados alcançáveis pela trilha lateral (a trilha e o alternador de tema são
**controles de demonstração** — não são produto e não devem virar código):

| id | estado | id | estado |
|---|---|---|---|
| E1 | vários títulos em aberto | E7 | aba Recebidos |
| E2 | alguns selecionados (4 — R$ 262,38) | E8 | vazio, sem dívida |
| E3 | todos selecionados (9 — R$ 637,86) | E9 | erro ao carregar |
| E4 | recebimento parcial | E10 | gravando / duplo clique |
| E5 | confirmação final | E11 | erro parcial com rollback |
| E6 | sucesso + recibo consolidado | E12 | alterado por outra sessão |

Aprovado explicitamente: tabela densa (linha de 54px) em vez de cards; checkbox por
título (20px em alvo de 44px); Selecionar todos; abas **Em aberto / Recebidos**;
quantidade e total selecionados; footer/action bar fixa; CTA `Receber N títulos — R$ X`;
ação individual **"Quitar este título"** (copy inequívoca, substitui "Quitar total");
recebimento parcial como **modo separado**, não input por card; etapa de confirmação
antes da escrita; estados de loading/busy, sucesso, erro, rollback e concorrência;
recibo consolidado; tokens reais do OmniGestão (sem cor hardcoded — o
`bg-emerald-600 text-zinc-950` atual sai em favor de `--primary`).

**"Em aberto" = saldo real > ε (0,009)**, nunca status textual. Título zerado sai da
lista operacional de cobrança e aparece em Recebidos.

**Modo parcial** sempre exibe: valor recebido · valor distribuído · sobra sem título ·
títulos afetados; e por título: saldo · abater agora · fica devendo. Distribuição
*mais antigos primeiro* ou *manual*. Sobra > 0 bloqueia a CTA — R$ 262,38 digitados
com um título de R$ 5,00 nunca podem parecer pagamento global.

---

## 4. Comportamento atual auditado

Confirmado no código (`origin/main` @ `9978e30`), não apenas pelo briefing.

| | Sintoma | Evidência |
|---|---|---|
| A | "Quitar total" quita só um título | botão dentro do `<li>` de cada título `components/dashboard/vendas/pdv-recebimento-modal.tsx:634` → `callLiquidar(row)` `:322` → POST com `localKey: String(row.id)` `:291` |
| B | "Valor parcial" pertence a um título | input por card `:602-611`, estado `parcialValue[id]` `:130`, `callParcial(row)` `:361` |
| C | não existe multitítulo real | `app/api/pdv/receber-conta/route.ts` só aceita `tituloId \| localKey` singular `:43-60` |
| D | saldo 0 continua PENDENTE | `liquidarContaReceber` atualiza só a **coluna** `status` e apenda histórico `lib/financeiro/services/contas-receber-service.ts:233-239` — nunca reescreve `payload.status`/`payload.valor`; a lista devolve o **snapshot do payload** `app/api/ops/contas-receber-list/route.ts:39-42`; o modal filtra e desenha o badge por esse status textual `:170`, `:594` |
| E | contagem inclui título sem saldo | `Títulos abertos = filtered.length` `:536`; `filtered` `:213-216` cruza só cliente × status textual |
| F | `audit.saldoAberto` diverge do snapshot | `audit` vem das colunas + histórico (`buildContaReceberAuditTrail`), `rows` vem do `payload`; `saldoAbertoDe` `:223-230` cai para `row.valor` **bruto** quando o audit falta |
| G | recibo cai em "MINHA LOJA" | `RECIBO_LOJA_NOME_PADRAO = "Minha Loja"` `lib/contas-receber-recibo.ts:2` + `h1 { text-transform: uppercase }` no cupom; **2 dos 3 call sites não passam `lojaNome`** (`pdv-assistencia-enterprise.tsx:2933`, `pdv-supermercado.tsx:1596`); só `pdv-classic.tsx:1812` passa, e ainda cai no default se `nomeFantasia` estiver vazio |
| H | matching textual do cliente | `clienteMatchesTitulo` `:84-92` aceita **substring bidirecional** sobre nome, documento **ou** telefone: "Ana" casa com "Mariana" e "Joana". `saldoDevedorClienteApos` `:238-249` agrega por `normClienteKey` — o rodapé do recibo soma homônimos |

Nenhuma divergência: os oito sintomas do briefing são verdadeiros na main atual.

### Achados adicionais (fora do briefing)

- **I. `CaixaOperacao` do PDV não é idempotente** — `localId` contém `Date.now()`
  (`app/api/pdv/receber-conta/route.ts:179`). Retry ou duplo POST cria duas operações
  de caixa. O helper compartilhado `lib/caixa/recebimento-cr-caixa.ts` tem idempotência
  por `localId`; a rota do PDV não o usa.
- **J. Re-liquidar título já PAGO lança valor BRUTO no caixa** — `liquidarContaReceber`
  devolve `{ok:true}` para status PAGO (`contas-receber-service.ts:219`), `abertoAntes = 0`,
  e `valorMov = res.data.valor` (`route.ts:153`). A `MovimentacaoFinanceira` é barrada pela
  idempotência (`movimentacoes-service.ts:253-256`); a `CaixaOperacao` **não**.
- **K. O fluxo já não é atômico nem para um título** — `createMovimentacaoEntradaFromReceber`
  roda com `.catch(console.error)` (`route.ts:177`): a baixa persiste mesmo se a
  movimentação financeira falhar.

---

## 5. Problema de canonicalidade

O `payload` JSONB acumula dois papéis incompatíveis: **snapshot do registro do
localStorage** do painel legado *e* **livro-razão do servidor** (`payload.historico`,
única fonte de `saldoAberto`).

`POST /api/ops/contas-receber-persist` grava com `replacePayload: true`
(`app/api/ops/contas-receber-persist/route.ts:74`), e o painel envia a **lista inteira**
do localStorage a cada escrita — não a linha alterada
(`components/dashboard/financeiro/contas-receber.tsx:650-662`). Como `ContaReceberRow`
não tem a chave `historico`, o merge vira `{...row}` e **apaga `payload.historico` de
todos os títulos da loja**, além de reescrever a coluna `status` com o status do cliente.

E `saldoAberto()` é `valor − soma(historico)`
(`lib/financeiro/services/contas-receber-service.ts:198-204`) — apagar o histórico
**ressuscita saldo já recebido**.

Na direção contrária, liquidar/parcial no servidor não atualizam o snapshot: PDV e
painel seguem exibindo "pendente" com valor bruto. Isso explica D, E e F de uma vez.

Writers equivalentes: `app/api/ops/sync-legacy-financeiro/route.ts:72` e
`lib/importador-avancado/persistidor.ts:961`.

**Consequência vinculante:** nenhum recebimento em lote pode se apoiar em
`payload.status` ou `payload.valor`. O lote exige saldo canônico derivado no servidor
e revalidado no momento da escrita.

---

## 6. Pré-requisitos obrigatórios antes do lote (GOAL G1)

1. **Services financeiros acoplados ao singleton global `prisma`**, sem client injetável:
   `contas-receber-service.ts:1`, `movimentacoes-service.ts:11`, `carteiras-service.ts`,
   `fechamento-service.ts`, `lib/caixa/recebimento-cr-caixa.ts:24`. Chamados dentro de
   `$transaction`, executariam **fora** dela — sem rollback. Precisa da porta `db`
   injetável; o padrão **já existe no repo** em `lib/contador/**/repo-prisma.ts`
   (ex.: `agenda/repo-prisma.ts:149`, com fake que exercita commit/rollback de verdade).
2. **Erro engolido** em `createMovimentacaoEntradaFromReceber` (`receber-conta/route.ts:177`).
3. **Idempotência da `CaixaOperacao`** do PDV (achado I).
4. **`liquidarContaReceber` devolvendo sucesso para título já PAGO** (achado J) — precisa
   virar `ja_quitado` explícito no protocolo.
5. **Pooler**: a app conecta via pgBouncer em modo transação
   (`?pgbouncer=true&connection_limit=1`, `.env.example:11`). Transação interativa fixa a
   conexão; com `connection_limit=1` uma tx longa serializa a instância. O lote precisa
   ser curto — sem `fetch`, sem I/O externo, sem `console` dentro — com `timeout`/`maxWait`
   explícitos e teto de itens.
6. **Canonicalidade do saldo** (§5): decidir e implementar a fonte de verdade antes de
   qualquer escrita em lote.

**Não é necessária migration:** `ContaReceberTitulo.updatedAt` já existe e serve como
token de concorrência otimista.

---

## 7. Desenho do lote (especificação — GOAL G2)

Novo `POST /api/pdv/receber-conta-lote`. Body:
`{ sessaoId, formaPagamento, observacao?, itens: [{ localKey, tituloId?, valor?, saldoEsperado }] }`.
Nome de cliente **nunca** é chave — entra só como metadado de recibo/auditoria.

1. **Revalidação server-side** antes de qualquer escrita: recarregar cada título por
   `(storeId, localKey)`, recalcular `saldoAberto`, comparar com `saldoEsperado`
   (ε = `PAY_EPS` = 0,009). Divergiu → `409 saldo_divergente` com os títulos afetados
   e **nada gravado** (estado E12).
2. **Uma `prisma.$transaction`**: check de período fechado + sessão ABERTA → `update` de
   cada título com histórico apendado → **uma `MovimentacaoFinanceira` por título**
   (apropriação individual, `referenciaId = tituloId`) → **uma única
   `CaixaOperacao(recebimento_cr)` consolidada**, com `payload.itens = [{tituloId, localKey, valor}]`
   (rastreabilidade e estorno preservados).
3. **Idempotência do lote**: `payload.localId = "pdv-rc-lote:<storeId>:<sessaoId>:<hash(itens+valores)>"`,
   verificado dentro da transação — sem `Date.now()`. Retry devolve o mesmo resultado
   sem regravar.
4. Fora da transação: `recalcularSaldoCarteira` (derivado, reentrante) e a auditoria
   financeira (`void`).
5. Parcial: o cliente envia a distribuição já calculada; o servidor revalida
   `valor ≤ saldoAberto` de cada título e **recusa o lote inteiro** se algum estourar.
6. A rota singular atual permanece intocada (serve "Quitar este título") ou vira um
   lote de 1 — decisão do GOAL de implementação.

Cenário que o desenho deve tornar impossível: `título 1 quitado · título 2 quitado ·
título 3 falha · títulos 4/5 não processados`.

**Financeiro:** apropriação individual correta por título.
**Caixa:** recebimento consolidado coerente com o pagamento do cliente, com referência
a todos os títulos envolvidos e estorno possível.

---

## 8. Plano do recibo (GOAL G3)

Causa do "MINHA LOJA": default `"Minha Loja"` + `lojaNome` não passado em 2 dos 3 PDVs
+ `text-transform: uppercase` no cupom (achado G).

- **Resolver o nome no servidor**: a resposta do lote devolve `loja: { nome, documento }`
  do cadastro da unidade, em vez de depender de prop do componente; passar `lojaNome`
  nos três call sites como cinto de segurança; trocar o default por texto neutro de
  último recurso.
- **Recibo consolidado** (`buildReciboRecebimentoLote`): nome real da loja · cliente ·
  forma de pagamento · valor recebido · **lista dos títulos afetados** com valor abatido
  e situação final · saldo devedor restante **vindo do servidor por `clienteId`** ·
  data/hora.
- Remover a agregação por `normClienteKey` (`calcSaldoDevedorClienteTodaLoja`,
  `saldoDevedorClienteApos`), que hoje soma homônimos.

---

## 9. Arquivos previstos para a implementação (não alterados neste GOAL)

**Alteração** — `components/dashboard/vendas/pdv-recebimento-modal.tsx` ·
`lib/contas-receber-recibo.ts` · `app/api/ops/contas-receber-list/route.ts` ·
`lib/financeiro/services/contas-receber-service.ts` ·
`lib/financeiro/services/movimentacoes-service.ts` · `lib/caixa/recebimento-cr-caixa.ts` ·
`components/dashboard/vendas/pdv-assistencia-enterprise.tsx` ·
`components/dashboard/vendas/pdv-supermercado.tsx`

**Criação** — `app/api/pdv/receber-conta-lote/route.ts` ·
`lib/financeiro/services/recebimento-lote-service.ts` · testes de atomicidade,
idempotência e revalidação

**Fora de escopo** — `prisma/schema.prisma`, auth/proxy, Fiscal,
`app/api/pdv/receber-conta/route.ts` (só se virar lote de 1)

---

## 10. Critérios de aceite propostos

1. Aba **Em aberto** lista apenas `saldoAberto > 0,009`; título zerado migra para
   **Recebidos** sem recarregar a página.
2. Contagem e total do cabeçalho derivam do saldo canônico, nunca do status textual.
3. Seleção multitítulo por checkbox, com Selecionar todos, quantidade e total.
4. CTA consolidada grava N títulos em **uma** requisição; o payload carrega
   `localKey`/`tituloId`, nunca nome de cliente.
5. **Atomicidade**: falha injetada no 3º de 5 títulos → os 5 seguem em aberto, zero
   `MovimentacaoFinanceira`, zero `CaixaOperacao`.
6. **Idempotência**: POST duplicado do mesmo lote → uma `CaixaOperacao`, um conjunto de
   movimentações, resposta equivalente.
7. **Revalidação**: `saldoEsperado` divergente → `409` e nada gravado.
8. Financeiro: uma `MovimentacaoFinanceira` por título. Caixa: uma `CaixaOperacao`
   consolidada com referência a todos os títulos, estornável.
9. Recibo com nome real da loja nos três PDVs; teste que falha se cair no default.
10. Parcial: nenhum título recebe mais que seu saldo; sobra > 0 bloqueia a gravação.
11. `npm run typecheck` e `npm run lint` limpos; testes novos passando.

---

## 11. Design critique — registro

Executada `design:design-critique` sobre o preview renderizado, com contraste medido
convertendo oklch→sRGB no DOM (não estimado). Correções aplicadas em segunda passada:

| Achado | Sev. | Correção |
|---|---|---|
| `--warning` como **texto** no tema claro: **2,35:1** — reprovado | 🔴 | warning só como fundo/borda; texto em `--foreground` |
| `--destructive` como texto: 4,12 (escuro) / 4,46 (claro) — abaixo de 4,5 | 🔴 | data vencida em `--foreground` bold + ponto vermelho (grafismo, ≥3:1); pill "Vencido" carrega a semântica |
| ação por título invisível até o hover | 🔴 | sempre visível (.75 → 1 em hover/foco/seleção) |
| lista não rolava → footer fixo não demonstrável | 🟡 | 9 títulos; scroll real com footer ancorado |
| piso tipográfico (pill 9,5px / meta 10,5px) | 🟡 | pill 10px, meta 11px, stamp 11px |
| checkbox 19px em célula 42px | 🟡 | 20px em célula 44px + `:focus-within` na linha |
| valor manual acima do saldo truncado em silêncio | 🟡 | campo marcado + aviso "limitado ao saldo" |
| contagem de vencidos hardcoded; teclas sem `<kbd>` | 🟢 | derivada; `ESC`/`F5` com `<kbd>` |

**Restrição de token registrada para a implementação:** `--warning` e `--destructive`
**não servem como cor de texto** nos temas do produto. Use-os como fundo/borda/grafismo
e mantenha o texto em `--foreground`.

Redundância mantida de propósito: o total aparece no footer **e** dentro da CTA — em
caixa, ler o número duas vezes antes de clicar é proteção, não ruído.

Verificação mecânica: console sem erros; lista rola (486px de conteúdo em 413px) com
header, tabs, resumo e footer fixos; distribuição parcial correta
(R$ 150,00 → 89,90 + 60,10, sobra R$ 0,00); temas Midnight e Soft Ice validados;
larguras 1440 e 1280.

---

## 12. Skills e ferramentas

`.claude/skills/omni-design-loop/SKILL.md` (governança; `design-loop` original preservada) ·
Claude Design MCP (`mcp__claude-design__*`) · `read_design_skill(frontend-design)` e
`read_design_skill(hifi-design)` · `design:design-critique`.

Observação: a skill `frontend-design` orienta trabalho **fora** de um design system
existente. Aqui os tokens do OmniGestão governam, então dela se aplicou apenas o que não
conflita (intencionalidade, restrição tipográfica, densidade controlada) — nenhum sistema
visual paralelo foi criado.
