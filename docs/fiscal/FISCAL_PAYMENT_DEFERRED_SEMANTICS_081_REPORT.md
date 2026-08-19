# FISCAL-030 — Semântica fiscal de pagamentos diferidos (carnê / a prazo / crédito-vale)

| Campo | Valor |
|---|---|
| **GOAL** | `FISCAL-030-DEFERRED-PAYMENT-SEMANTICS-081` |
| **main usada** | `93cca73c5b984824bbd6c6e168e59792aa37c3da` (PR #87, PIX legado fail-closed) |
| **ADR** | [ADR-0023](../decisions/ADR-0023-pagamento-fiscal-canonico-nfce-fail-closed.md) (**aceita/vigente**; adendo 081) |
| **Schema / migration** | **zero** |
| **SEFAZ / H-9 / H-10 / #73** | **intactos** |
| **Classificação** | **A** |

---

## 1. main usada

`93cca73c5b984824bbd6c6e168e59792aa37c3da` — merge do PR #87 (`FISCAL-030-PIX-LEGACY-FAIL-CLOSED-079`). Ancestral Fiscal esperado pelo GOAL; sem merge adicional.

## 2. Fontes oficiais

| Fonte | Versão | Publicação | Vigência relevante | O que prova |
|---|---|---|---|---|
| XSD `PL_010e_v1.02/NFe/leiauteNFe_v4.00.xsd` (repo) | PL_010e_v1.02 | leiaute 4.00 | NFC-e mod. 65 usa o mesmo `tPag` `[0-9]{2}` | XSD **não** enumera códigos; `indPag` 0/1 é opcional e **não** foi inventado |
| Informe Técnico 2024.002 | v1.00 | Abril/2024 | produção **01/07/2024** | 05 deixa de ser “Crédito de Loja”; nasce o item **21** |
| Informe Técnico 2024.002 | v1.01 | Junho/2024 | (correção do 05) | 05 passa a cobrir “outras formas de crediário” |
| Informe Técnico 2024.002 | v1.10 | Setembro/2025 | teste 20/10/2025 · produção **03/11/2025** | inclusão do **91** |
| Informe Técnico 2024.002 | **v1.11** | **04/03/2026** (PDF 04032026; FENACON 06/03/2026) | teste 02/04/2026 · produção 04/05/2026 (23/24) | tabela vigente; 05/15/19/21/91 inalterados nesta versão |
| Portal Nacional da NF-e / ENCAT | — | citado pelo próprio IT | tabela em Documentos → Diversos (`www.nfe.fazenda.gov.br`) | autoridade da tabela de meios de pagamento |

PDF conferido: `IT2024.002v1.11-Atualiza-Tabela-Meios-de-Pagamento-04032026` (cópia pública FENACON do informe ENCAT). A tabela de rótulos do DANFC-e **não** é autoridade.

## 3. Tabela oficial relevante (NFC-e mod. 65)

O mesmo leiaute 4.00 cobre NF-e 55 e NFC-e 65. Códigos aplicáveis a este GOAL:

| tPag | Descrição oficial (IT 2024.002 v1.11) | Publicação da descrição | Vigência | Observações / restrições oficiais |
|---|---|---|---|---|
| **05** | Cartão da Loja (Private Label), Crediário Digital, Outros Crediários | v1.00 (texto) + v1.01 (outras formas de crediário) | produção 01/07/2024 | “Cartão da loja (na forma de crediário), Crediário Digital, Crediário com ou sem Carnê etc. Não usar para o cartão de loja bandeirado.” v1.00: o item 5 **deixou** de ser “Crédito de Loja”. |
| **14** | Duplicata Mercantil | histórico; observação v1.00 | 01/01/2020 | Título de crédito da Lei 5.474/68. **Não** aplicável: o PDV não emite duplicata. |
| **15** | Boleto Bancário | histórico | 01/01/2020 | Boleto **bancário**. Sem observação especial no IT. |
| **12** | Vale Presente | histórico | 01/01/2020 | Instrumento de vale-presente. **Não** é o `ClienteCredito`. |
| **19** | Programa de Fidelidade, Cashback, Crédito Virtual | tabela vigente | (sem dIniVig destacado no IT v1.11) | Programa/cashback/crédito virtual. OmniGestão **não** tem esse produto. |
| **21** | Crédito em Loja | v1.00 | produção 01/07/2024 | IT v1.00: “pode decorrer de: valor pago antecipadamente, devolução de mercadoria etc.” |
| **90** | Sem Pagamento | histórico | 01/01/2020 | Não representa venda a prazo com título. |
| **91** | Pagamento Posterior | v1.10 | produção **03/11/2025** | “Usado para informar quando o pagamento for ocorrer em momento posterior à emissão do documento fiscal ou fato gerador do imposto. … Aplicabilidade: Pagamento Integral ou Parcial Posterior.” |

Não se mapeia por semelhança de nome. 99 (“Outros”) continua **proibido** como fallback.

## 4. Semântica real de `carne`

Auditoria no código (não no nome da propriedade):

| Evidência | Onde |
|---|---|
| Botão do operador: “Carnê / Crediário” (`id=carne`) | `lib/pdv-formas-pagamento.ts` |
| Exige cliente + CPF | mesma config; `PaymentModal` recusa sem cliente |
| Parcelas 1–12 só na UI; `installments` no `PaymentMethod` | `payment-modal.tsx` |
| “Gerar Boleto/Carnê” abre HTML **local** “Carnê de parcelamento” (CNPJ + cliente + parcelas) e `window.print()` | `handleGerarBoletoCarne` — **não** há banco, convênio, linha digitável nem título |
| Persistência: só `paymentBreakdown.carne` (número) | PDVs → `finalizeSaleTransaction` |
| Entra no caixa (`valorAVistaVenda` inclui carnê; `AVISTA_CASH_KEYS`) | `lib/financeiro/correcao-pagamento-plan.ts`, `upsertVendaInTransaction` |
| **Não** cria `ContaReceberTitulo` | só `aPrazo` cria título |

Carnê no OmniGestão é **recebimento imediato com carnê impresso localmente**, não um crediário rastreado nem um boleto bancário.

## 5. Carnê vs boleto

São **rótulos de configuração distintos** e **um único mecanismo**:

- `FormaPagamentoConfigId` inclui `carne` **e** `boleto`.
- `toPaymentMethodType("boleto") === "carne"` (`lib/pdv-formas-pagamento.ts`; teste existente).
- `findFormaByPaymentType(..., "carne")` aceita `id=carne` **ou** `id=boleto`.
- PDV clássico agrupa os dois em `parcelado`.
- Toast: “Selecione o cliente para emitir carnê ou boleto parcelado.”
- A chave persistida é sempre `carne`. Não há `paymentBreakdown.boleto`.

Conclusão: carnê e boleto **não** são mecanismos distintos. Criar um picker “carnê vs boleto” implicaria tPag 05 vs 15 sem boleto bancário real — picker enganoso. **Sem discriminator.** Fail-closed preservado.

## 6. Semântica real de `aPrazo`

| Evidência | Onde |
|---|---|
| Rótulo: “À prazo”; tipo `a_prazo` | formas + `PaymentModal` |
| Comentário do tipo: “À vista faturado em conta do cliente → Contas a Receber (diferente de carnê parcelado)” | `payment-modal.tsx` |
| Exige cliente + CPF/CNPJ | modal + `finalizeSaleTransaction` |
| `aPrazoConfig`: parcelas 1–24, primeiro vencimento, intervalo, observação | `operations-sale-types.ts` |
| Entrada opcional em outra forma (dinheiro/PIX/cartão) + saldo `a_prazo` | `handleConfirmarAPrazo` |
| **Cria** `ContaReceberTitulo` por parcela (`pdv-aprazo-{pedidoId}[-n]`, tipo `pdv_aprazo`) | `upsertVendaInTransaction` §6 |
| **Não** entra no caixa (`valorAVistaVenda = total − aPrazo − creditoVale`) | regra oficial única |
| Sem instituição, sem boleto, sem duplicata | código |

`aPrazo` é **venda com título em Contas a Receber** (fiado 1x ou parcelado Nx). É “pagamento ainda não ocorrido”. **Não** é boleto, duplicata nem carnê.

Não se presume tPag: 15 e 14 estão excluídos por evidência; resta **05 vs 91**. `aPrazoConfig` é dado financeiro, não tPag. Um único fluxo cobre fiado e crediário — o operador não tem produto distinto para escolher.

## 7. Semântica real de `creditoVale`

| Evidência | Onde |
|---|---|
| Rótulo: “Crédito / Vale” | formas |
| UI limita o valor ao `customerStoreCredit` do cliente | `PaymentModal` |
| Único `clienteCredito.create` no repositório | `app/api/ops/devolucao/route.ts` |
| Modelo: `devolucaoId`, `vendaOrigemId`, saldo por `clienteDoc` | `prisma/schema.prisma` `ClienteCredito` |
| Devolução/troca com `vale_credito` emite o crédito; `somente_estoque` não | `operations-store` / devolução |
| Venda **debita** `ClienteCredito` + `UsoCreditoCliente` | `upsertVendaInTransaction` §5 |
| **Não** entra no caixa | `valorAVistaVenda` exclui `creditoVale` |

Natureza: **crédito em loja por devolução/troca** (saldo do cliente). Não é vale-presente vendido, programa de fidelidade, cashback nem abatimento de Conta a Receber.

Correspondência oficial **exata** com tPag **21** (IT v1.00: crédito em loja de valor antecipado / devolução). 12 e 19 não correspondem. Sem picker: a chave já é unívoca.

## 8. Matriz forma → tPag

| Forma interna | Significado real no OmniGestão | Dado no instante da venda | tPag possível | tPag comprovado? | Discriminador adicional? | Suportado ou bloqueado |
|---|---|---|---|---|---|---|
| `dinheiro` | espécie | valor | 01 | sim (prévio) | não | suportado |
| `cartaoDebito` | cartão débito | valor (sem TEF) | 04 | sim no valor; B no grupo `card` | não neste GOAL | suportado (tPag) |
| `cartaoCredito` | cartão crédito | valor (sem TEF) | 03 | idem | não neste GOAL | suportado (tPag) |
| `pix` | PIX genérico | valor; `pixQrKind` opcional | 17/20/23 | só com `pixQrKind` | já existe | inalterado |
| `carne` | recebimento imediato + carnê HTML; boleto colapsa aqui | valor; parcelas só na UI | 05 ou 15 | **não** | não (mecanismos não distintos) | **bloqueado** |
| `aPrazo` | Conta a Receber (fiado/parcelado) | valor + `aPrazoConfig` | 05 ou 91 (15/14 excluídos) | **não** | não (um fluxo só) | **bloqueado** |
| `creditoVale` | abate `ClienteCredito` de devolução/troca | valor | **21** | **sim** (handoff novo) | não necessário | **suportado no handoff novo** |
| chave desconhecida | — | — | — | não | — | `forma_desconhecida` (não vira 99) |

## 9. Discriminadores criados ou motivo do B residual

- **`creditKind` / `deferredPaymentKind`: não criados.**
- `creditoVale→21` é unívoco na chave, como `dinheiro→01`. Picker seria pergunta que o operador não precisa responder.
- Carnê/boleto: discriminator mentiria que há boleto bancário.
- aPrazo: discriminator 05 vs 91 exigiria produto de crediário que o PDV não tem.

Ambiguidade restante (carnê, aPrazo) continua fail-closed — isso é o residual B **dentro** da classificação A do GOAL (“modalidades comprováveis passam; o resto permanece bloqueado”).

## 10. UX

Nenhuma escolha nova no `PaymentModal`. PIX `pixQrKind` inalterado. Sem default silencioso. Sem tPag nua. A venda comercial fecha com carnê/a prazo mesmo com Fiscal bloqueado.

## 11. Handoff server-side

- `buildFiscalPaymentHandoff`: `creditoVale` → `capability=supported`, `tPag=21`.
- Carne / aPrazo: `capability=blocked` (motivos `carne_tpag_ambiguo` / `aprazo_tpag_ambiguo` atualizados com a auditoria).
- `from-handoff`: aceita 21 só se a forma for `creditoVale`; rejeita 12/19 injetados; rejeita tPag em carne/aPrazo.
- `from-venda-breakdown` (venda **sem** handoff): `creditoVale` permanece `PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL`.
- `assertPagamentoFiscalCanonico`: contrato congelado `fonte=paymentBreakdown` + `creditoVale` não autoriza emissão futura.
- Cliente: `tPag` e `fiscalPaymentHandoff` injetados são ignorados; `upsertVendaInTransaction` reconstrói o handoff.
- Preservado: dinheiro 01, débito 04, crédito 03, PIX 17/20/23 só por `pixQrKind`, PIX legado fail-closed, forma desconhecida fail-closed.

## 12. Comportamento legado

- Venda histórica **sem** handoff + `creditoVale`/`carne`/`aPrazo`: fail-closed do GOAL 073.
- Handoff já persistido com `creditoVale` `capability=blocked` (GOALs 075–079): **não reescrito**; emissão futura continua bloqueada.
- Venda **nova** após este GOAL: `creditoVale` no handoff leva 21.
- `NotaFiscal` / XML autorizado / DANFC-e: intocados.

## 13. Arquivos

**Criados:** este relatório.

**Alterados:** `lib/vendas/fiscal-payment-handoff.ts` (+ teste); `lib/fiscal/payment/types.ts`; `from-handoff.ts` / `from-venda-breakdown.ts` (+ testes); `lib/ops-upsert-venda-fiscal-handoff.test.ts`; snapshot + XML tests; ADR-0023 adendo 12; `docs/ai/CURRENT_STATUS.md` (aditivo).

**Não tocados:** `PaymentModal` (sem picker); Caixa valores; Financeiro engine; estoque; schema/migrations; TEF; H-9/H-10; #73; provider SEFAZ; regras de parcelamento/crédito comercial.

## 14. Testes

Cobertos: creditoVale→21; carne vs boleto (colapso + bloqueio); aPrazo sem discriminador; creditoVale legado sem handoff; handoff legado blocked; tPag 19/12/05/91 injetados; split com dinheiro/PIX/cartão; venda comercial conclui com carne/aPrazo bloqueados e com creditoVale 21 sem caixa; demais formas não regrediram; PDVs não montam o handoff.

## 15. Build

- `npx vitest run` focado (payment/handoff/snapshot/XML/upsert/dry-run/fingerprint/PDV formas): **494 passed** (206 + 178 + 110).
- `npm run typecheck` ✅ (heap 4 GB).
- `npm run build` ✅ (Next.js 16.2.0 webpack; `MIGRATION_SKIPPED`; 102 páginas estáticas).
- ESLint focado: 0 errors.
- `git diff --check` limpo.
- xmllint: não reapareceu (não invocado neste GOAL).

## 16. Revisão independente

Outra família deve revisar principalmente: tabela tPag oficial; carnê vs boleto; aPrazo; creditoVale→21; ausência de defaults; autoridade server-side; venda comercial preservada; legado fail-closed; zero schema; zero SEFAZ.

## 17–21. Git / schema / #73 / SEFAZ

Commit funcional único. PR Draft contra `main`. Schema = zero. #73 apenas observada. Zero SEFAZ. Cartão/TEF, troco e H-9/H-10 não iniciados.

## 22. Classificação

**A:** `creditoVale` comprovado passa a carregar tPag 21 no handoff novo. Carnê e a prazo — ambiguidade real — continuam fail-closed. Não é D: sem default, sem tPag do cliente, sem mudar cobrança/Caixa/Financeiro/Contas a Receber/crédito do cliente.
