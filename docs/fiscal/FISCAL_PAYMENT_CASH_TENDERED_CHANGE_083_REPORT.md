# FISCAL-030 — Dinheiro entregue e troco fiscal (`cashTendered` / `vTroco`)

| Campo | Valor |
|---|---|
| **GOAL** | `FISCAL-030-CASH-TENDERED-CHANGE-083` |
| **main usada** | `2317d2f11033060fa18004a10c3f49642b1cbb93` (OPS-V4-DASHBOARD-HISTORICO-FINAL-017) |
| **Ancestral Fiscal** | `26a03dc9181776764dc0500b6f2b4a0ac809e3b6` (PR #90, crédito em loja tPag 21) — já ancestral desta main |
| **ADR** | [ADR-0023](../decisions/ADR-0023-pagamento-fiscal-canonico-nfce-fail-closed.md) (**aceita/vigente**; adendo 083) |
| **Schema / migration** | **zero** |
| **SEFAZ / H-9 / H-10 / #73** | **intactos** |
| **Classificação** | **A** |

---

## 1. main usada

`2317d2f11033060fa18004a10c3f49642b1cbb93` — HEAD de `main` no início da tarefa. O ancestral Fiscal pedido (`26a03dc9`, merge do PR #90 / GOAL 082) **é ancestral** deste commit (Ops V4 dashboard/histórico veio depois, sem rebase Fiscal). Sem merge adicional.

A PR #89 do Contador permanece paralela. Este GOAL não toca arquivos do Contador; `CURRENT_STATUS.md` só recebeu o parágrafo Fiscal 083 no cabeçalho.

## 2. Fonte oficial vPag / vTroco

| Fonte | Versão | Publicação | O que prova |
|---|---|---|---|
| XSD `PL_010e_v1.02/NFe/leiauteNFe_v4.00.xsd` (repo) | PL_010e_v1.02 · leiaute 4.00 | NFC-e mod. 65 usa o mesmo grupo `pag` | **YA03 `vPag`**: “Valor do Pagamento” (obrigatório salvo tPag=90). **YA09 `vTroco`**: “Valor do Troco.” (`minOccurs=0`, após `detPag`) |
| Nota Técnica **2016.002** | **v1.61** | **10/09/2018** | Inclusão do campo YA09; regras YA03-10/20 e YA09-10; W16-70 **excluída** |
| Manual de Orientação do Contribuinte (regras de validação da NT) | MOC / NT 2016.002 | citada pela própria NT | IDs YA03, YA09, W16 |

Regras oficiais aplicadas (NT 2016.002 v1.61, modelos 55 e 65):

| RV | Texto | Msg | Efeito |
|---|---|---|---|
| **YA03-10** (facult.) | `Σ(vPag) < vNF` | 865 | Total dos pagamentos menor que o total da nota |
| **YA03-20** (facult.) | `Σ(vPag) > vNF` e `vTroco` ausente | 866 | Ausência de troco |
| **YA09-10** (obrig.) | `vTroco` informado e `vTroco ≠ Σ(vPag) − vNF` | 869 | Valor do troco incorreto |

A NT v1.61 **exclui** W16-70 (histórico: `Σ(vPag) − vTroco ≠ vNF`, msg 767, tolerância R$ 1,00). A invariância matemática vigente é a de YA09-10. Este GOAL fecha no **centavo** e emite `vTroco` sempre que há evidência de excesso em espécie, o que também evita YA03-20.

**Semântica:**

- `detPag.vPag` (YA03) é o valor **pago/recebido** naquela forma, não o líquido da venda. Em dinheiro com troco, `vPag` do tPag 01 é o valor **fisicamente entregue**.
- `pag.vTroco` (YA09) é o troco. Opcional no XSD; **obrigatório** na prática quando `Σ(vPag) > vNF`.
- Invariância: **`Σ(vPag) − vTroco = vNF`**. A regra antiga `Σ(vPag) == total` só vale quando `vTroco` é omitido (null).
- Pagamento misto: cada `detPag` traz o `vPag` daquela forma; o excesso que gera troco está no dinheiro (tPag 01). Demais formas usam o valor **aplicado**. `vTroco = cashTendered − dinheiroAplicado` ≡ `Σ(vPag) − vNF`.
- Quando o entregue em espécie excede o saldo em dinheiro da venda, `vPag` (01) sobe para o entregue e `vTroco` absorve a diferença. Não se “corta” o `vPag` fiscal ao total.

IT 2024.002 v1.11 continua a autoridade de **tPag**; não altera YA03/YA09.

A tabela de rótulos do DANFC-e **não** é autoridade. Zero acesso SEFAZ neste GOAL.

## 3. Fluxo atual do dinheiro

PDVs ativos que usam o `PaymentModal` compartilhado e `finalizeSaleTransaction`:

| PDV | Caminho |
|---|---|
| Clássico | `pdv-classic.tsx` |
| Supermercado | `pdv-supermercado.tsx` |
| Assistência | `pdv-assistencia-enterprise.tsx` |
| Venda completa | `pdv-venda-completa-enterprise.tsx` · `venda-completa-enterprise.tsx` |
| Black | `PdvBlackEdition.tsx` |

Fluxo:

`PaymentModal` → valor informado em dinheiro (linhas `payments`) → troco **visual** (`totalPaid − total`) → `sumCashTendered(payments)` **antes** de `normalizePaymentsToMatchTotal` → `onConfirm(normalized, { cashTendered })` → PDV reduz `paymentBreakdown` a partir do normalizado → `finalizeSaleTransaction` → `upsertVendaInTransaction` → `paymentBreakdown` (aplicado) + `cashTendered` (entregue) → `fiscalPaymentHandoff`.

`trocas-devolucao.tsx` chama o finalizer **sem** PaymentModal; não envia `cashTendered` (ausência = sem troco).

## 4. Dado atualmente perdido (antes deste GOAL)

O operador digitava o dinheiro entregue. `normalizePaymentsToMatchTotal` **cortava** o excesso no dinheiro para a soma bater com o total. Só o líquido (`paymentBreakdown.dinheiro`) era persistido. O valor físico e o troco visual **não** iam para a Venda. O contrato Fiscal tinha `vTroco: null` sempre.

## 5. Contrato `cashTendered`

Campo explícito `cashTendered?: number` em:

- `SaleRecord` / `SalePayload` (`Venda.payload` JSONB, sem schema)
- `FiscalPaymentHandoff` (aditivo, versão **1**)

Significado: dinheiro **fisicamente entregue**. Não é receita adicional. Não é o valor aplicado à venda (`linhas.valor` / `paymentBreakdown.dinheiro`).

O cliente **não** envia `vTroco`. `upsertVendaInTransaction` descarta `vTroco`/`tPag`/`fiscalPaymentHandoff` do cliente.

Validação no servidor (`resolveCashTenderedEvidence`):

- finito e ≥ 0;
- só relevante quando dinheiro aplicado > 0;
- ≥ dinheiro aplicado;
- ausência → sem evidência, sem troco;
- inválido / menor que o aplicado → **não** persiste como evidência.

## 6. Regra matemática final

```
dinheiroAplicado = paymentBreakdown.dinheiro   // comercial / Caixa
cashTendered     = evidência persistida        // físico

se cashTendered ausente ou == aplicado:
  vPag(01) = dinheiroAplicado
  vTroco   = null
  Σ(vPag)  = vNF

se cashTendered > aplicado (evidência válida):
  vPag(01) = cashTendered
  vTroco   = cashTendered − dinheiroAplicado
  Σ(vPag) − vTroco = vNF
```

`assertPagamentoFiscalCanonico` passou a exigir `Σ(vPag) − (vTroco ?? 0) = total` (NT 2016.002 YA09-10; W16-70 excluída). `vTroco` zero é omitido (null). `vTroco` > 0 exige tPag 01 e não pode exceder o `vPag` de dinheiro.

## 7. Comportamento em split

Exemplo do GOAL (total 100, PIX 40, dinheiro aplicado 60, entregue 70):

| Campo | Valor |
|---|---|
| `paymentBreakdown.pix` | 40 (aplicado; Caixa/comercial) |
| `paymentBreakdown.dinheiro` | 60 (aplicado) |
| `cashTendered` | 70 |
| `detPag` PIX `vPag` | 40 |
| `detPag` 01 `vPag` | **70** (recebido) |
| `vTroco` | **10** |
| `Σ(vPag) − vTroco` | 110 − 10 = 100 = vNF |

Cartão + dinheiro segue a mesma conta. Carnê/a prazo continuam fail-closed (GOAL 081).

## 8. Efeito no Caixa

Inalterado. `valorAVistaVenda(total, pb)` e `MovimentacaoFinanceira.valor` usam o **total da venda**, não o entregue. `paymentBreakdown.dinheiro` continua o aplicado. Ledger `vendasDinheiro` soma o aplicado. Estoque e Financeiro (a prazo / crédito-vale) não leem `cashTendered`.

## 9. Comportamento legado

Venda histórica sem `cashTendered`: `vTroco` null; `Σ(vPag) = vNF` — fiscalmente válido. Não se inventa troco. Não se reescreve Venda/NotaFiscal. NFC-e AUTORIZADA e DANFC-e/reimpressão continuam no XML persistido (já parseava `<vTroco>`). Handoff legado com `cashTendered` menor que o aplicado ou inválido: fail-closed na derivação (`PAGAMENTO_VALOR_INVALIDO`); o construtor do handoff **não** grava essa evidência em vendas novas.

## 10. XML resultante

- Exato: `<detPag><tPag>01</tPag><vPag>50.00</vPag></detPag>` — sem `<vTroco>`.
- Com troco: `<detPag>…<vPag>70.00</vPag></detPag><vTroco>20.00</vTroco>` (ordem XSD: `vTroco` depois de `detPag`).
- Split: um `detPag` por forma; só o dinheiro pode ter `vPag` > aplicado.

## 11. Arquivos

**Criados:** `lib/pdv-payments.test.ts`, este relatório.

**Alterados:** `payment-modal.tsx`, `lib/pdv-payments.ts`, `lib/operations-sale-types.ts`, `lib/operations-store.tsx`, PDVs listados na §3, `lib/ops-upsert-venda.ts`, `lib/vendas/fiscal-payment-handoff.ts` (+ teste), `lib/fiscal/payment/**`, snapshot, XML builder/testes, DANFC-e reprint test, ADR-0023, `CURRENT_STATUS.md`.

**Não tocados:** `prisma/schema.prisma`, migrations, auth/proxy, Caixa/Financeiro engines, H-9/H-10, #73, Contador, SEFAZ.

## 12. Testes

Cobertos: dinheiro exato; acima do total; split PIX + dinheiro; split cartão + dinheiro; `cashTendered` ausente; menor que o aplicado; inválido; persistência da evidência; handoff server-side; snapshot; XML com `vTroco`; invariância `Σ − vTroco = vNF`; Caixa só com o valor da venda; estoque/Financeiro equivalentes (não leem o campo); autorizado/reprint histórico com `<vTroco>` persistido. Regressão de PDVs via asserção de fonte (encaminham `meta.cashTendered`; nenhum monta o handoff).

## 13. Build

| Gate | Resultado |
|---|---|
| `npx vitest run` (PDV/pagamento, finalize/upsert, handoff, `lib/fiscal/payment`, snapshot, XML, DANFC-e, dry-run) | **318 passed** / 17 arquivos |
| `npm run typecheck` | **0 erros** |
| `npm run build` | **OK** (Next.js 16.2.0 webpack; tipos já validados pelo typecheck) |
| ESLint focado nos arquivos tocados | **0 errors**; 13 warnings pré-existentes de `react-hooks/exhaustive-deps` em PDVs |
| `git diff --check` | **limpo** |

## 14. Revisão independente

Outra família: **PASS WITH NITS**, classificação **A**.

Confirmou: XSD YA03/YA09; split 100/PIX40/aplicado60/entregue70 → vPag 70+40, vTroco 10; Caixa via `valorAVistaVenda(total, pb)`; servidor descarta `vTroco`/`tPag`/handoff do cliente; legado sem evidência não inventa troco; schema e SEFAZ intactos.

Nit absorvido: W16-70 foi **excluída** na NT 2016.002; a regra vigente de invariância é **YA09-10**. Documentação e mensagens de erro passaram a citar YA09-10. A matemática implementada não mudou.

## 15–20. Git / schema / #73 / SEFAZ / classificação

PR Draft contra `main`. Schema = **zero**. #73 apenas observada. Zero SEFAZ.

**Classificação A:** valor entregue preservado, `vTroco` conforme NT 2016.002 v1.61 + XSD PL_010e_v1.02, split correto, operação comercial (Caixa/estoque/Financeiro) inalterada.
