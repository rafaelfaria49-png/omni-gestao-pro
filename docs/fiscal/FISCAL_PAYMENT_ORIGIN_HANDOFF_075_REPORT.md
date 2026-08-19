# FISCAL-030 — Handoff de origem do pagamento NFC-e

| Campo | Valor |
|---|---|
| **GOAL** | `FISCAL-030-PAYMENT-ORIGIN-HANDOFF-075` |
| **Base / ancestral Fiscal** | `origin/main` = `e1d75af8c519ff06e8a3288483f78a2980ff76cd` (PR #82) |
| **ADR** | [ADR-0023](../decisions/ADR-0023-pagamento-fiscal-canonico-nfce-fail-closed.md) (**aceita/vigente**) |
| **Schema / migration** | **zero** |
| **SEFAZ / H-9 / H-10 / #73** | **intactos** |
| **Classificação** | **B** |

---

## 1. main usada

`e1d75af8c519ff06e8a3288483f78a2980ff76cd` — merge do PR #82 (GOAL 030 fronteira fail-closed + aceite ADR-0023).

## 2. Produtor central encontrado

Único ponto de persistência da Venda dos PDVs ativos: `upsertVendaInTransaction` (`lib/ops-upsert-venda.ts`), chamado por:

- `app/api/ops/venda-persist` (e writer V2 `persistSaleV2`)
- `finalizeSaleTransaction` (`lib/operations-store.tsx`) → sync → o mesmo upsert

Não se duplicou lógica em cada PDV. O handoff é gravado no `create` do payload, **depois** de `stripClientSyncFlags`, **sobrescrevendo** qualquer `fiscalPaymentHandoff` injetado pelo cliente. Fingerprint de replay (`buildLegacySaleFingerprint`) **não** inclui o handoff — fatos comerciais inalterados.

## 3. PDVs cobertos

Todos convergem no mesmo motor (regressão por grep: nenhum monta o handoff):

- PDV clássico
- PDV supermercado
- PDV assistência enterprise
- Venda completa / venda completa enterprise
- PDV Next Black
- `finalizeSaleTransaction` / PaymentModal — **intocados** (UX, autorização, TEF, maquininha)

## 4. Formato do handoff

Congelado em `Venda.payload.fiscalPaymentHandoff` (JSONB aditivo):

```
{
  version: 1,
  catalogoTPag: "IT-2024.002-v1.11",
  linhas: [
    { formaOrigem, valor, tPag?, capability: "supported"|"blocked", status: "ok"|"blocked", motivo?, dadoAdicionalNecessario? }
  ]
}
```

- `tPag` só quando unívoco.
- `vTroco` / `valorEntregue` **omitidos** (não conhecidos na persistência).
- Sem segredo, sem maquininha/CNPJ/autorização, sem duplicar Caixa/Financeiro.

## 5. Matriz forma → tPag

Fonte oficial revalidada: XSD `PL_010e_v1.02/leiauteNFe_v4.00.xsd` (`tPag` = `[0-9]{2}`, sem enum) + tabela IT 2024.002 v1.11 em `lib/fiscal/payment/tpag-catalog.ts`. A tabela do DANFC-e **não** é autoridade.

| Forma interna | Significado comercial real | tPag oficial aplicável | Evidência | Situação |
|---|---|---|---|---|
| `dinheiro` | Espécie no caixa | **01** Dinheiro | única correspondência IT | **suportado** |
| `pix` | PIX genérico (QR não discriminado) | 17 / 20 / 23 | PDV só persiste número `pix` | **bloqueado** |
| `cartaoDebito` | Cartão de débito | **04** | única correspondência IT | **suportado** (grupo `card` ausente) |
| `cartaoCredito` | Cartão de crédito | **03** | única correspondência IT | **suportado** (grupo `card` ausente) |
| `carne` | Carnê **ou** boleto (`toPaymentMethodType("boleto")` → `carne`) | 05 vs 15 | ambíguo | **bloqueado** |
| `aPrazo` | Fiado / Contas a Receber (`aPrazoConfig` é financeiro) | 05 vs 15 vs 91 | ambíguo | **bloqueado** |
| `creditoVale` | Abate saldo de crédito do cliente (não é receita nova) | 19 vs 21 | ambíguo | **bloqueado** |
| chave desconhecida | — | — | não inventar 99 | **erro** `PAGAMENTO_FORMA_DESCONHECIDA` |

Não se escolheu tPag por semelhança de nome (`pix` ≠ 17).

## 6. carne / aPrazo / vale

Permanecem bloqueados. Dado adicional necessário (persistir no instante do pagamento, GOAL futuro, sem UI neste GOAL):

- **carne:** discriminador 05 (crediário) vs 15 (boleto). Hoje `boleto` da config colapsa em `carne`.
- **aPrazo:** discriminador 05 vs 15 vs 91. `aPrazoConfig` (parcelas/vencimento) **não** é tPag.
- **creditoVale:** discriminador 19 vs 21.

## 7. Cartão

Auditado no fluxo real:

| Campo | Existe no PaymentMethod (modal)? | Persiste na Venda? | Handoff |
|---|---|---|---|
| `maquininhaId` / `maquininhaNome` | sim | **não** (`reducePaymentsToBreakdown` descarta) | **não** |
| adquirente / CNPJ | não | não | omitido |
| bandeira / `tBand` | não | não | omitido |
| autorização / `cAut` | não | não | omitido |
| `tpIntegra` | não | não | omitido |

`maquininhaId` sozinho **não** autoriza fabricar `tpIntegra`/`CNPJ`/`tBand`/`cAut`. tPag 03/04 é emitível; grupo `card` continua omitido (XSD `minOccurs=0`). Capacidade parcial / fail-closed no grupo.

## 8. PIX

O sistema **não** distingue semanticamente 17 (QR dinâmico), 20 (QR estático) e 23 (PIX automático). O handoff **não** infere subtipo. Emissão de venda **nova** paga em PIX falha `PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL` até o PDV capturar o subtipo.

Handoff futuro necessário: `pixQrKind: dinamico | estatico | automatico` no instante do pagamento.

## 9. Troco

PaymentModal calcula `troco` na UI e `normalizePaymentsToMatchTotal` **corta** o dinheiro ao total antes de `onConfirm`. A Venda persiste só o líquido. O handoff **não** infere `vTroco`. UI não foi ampliada.

Handoff futuro necessário: persistir `valorEntregue` (dinheiro) no instante do confirm, sem alterar o valor aplicado à venda.

## 10. Integração Fiscal

`lib/fiscal/payment/derivePagamentoFiscal`:

- handoff presente → consome só o handoff (valida versão, tPag explícito, rejeita inconsistente);
- **não** volta ao fallback dinheiro / tPag=01;
- **não** consulta Caixa / Financeiro / PDV vivo;
- venda histórica **sem** handoff → `derivePagamentoFiscalFromBreakdown` (fail-closed já aceito, PIX→17 legado).

XML continua lendo só `snapshot.venda.pagamentoFiscal`. Snapshots/notas históricas **não** são reescritos.

## 11. Compatibilidade legado

PDVs finalizam exatamente como hoje (autorização, valor cobrado, caixa, financeiro, estoque, PaymentModal, TEF). Só o payload da Venda ganha um campo aditivo. Replay/fingerprint ignoram o campo.

## 12. Arquivos

**Criados:** `lib/vendas/fiscal-payment-handoff.ts` (+ teste), `lib/fiscal/payment/from-handoff.ts` (+ teste), `lib/ops-upsert-venda-fiscal-handoff.test.ts`, este relatório.

**Alterados:** `lib/ops-upsert-venda.ts`, `lib/fiscal/payment/{types,index,from-venda-breakdown}.ts` (+ teste fronteira), snapshot builder/service (+ testes), XML builder/validation (+ testes), ADR-0023 (adendo 075), `docs/ai/CURRENT_STATUS.md`.

**Não tocados:** PaymentModal, finalizeSaleTransaction, schema/migrations, Caixa, Financeiro engine, estoque, adquirência/TEF, H-9/H-10, #73, provider/transporte SEFAZ.

## 13. Testes

Cobertura: dinheiro, PIX, débito, crédito, split, carne, aPrazo, creditoVale, forma desconhecida, handoff persistido na Venda, Fiscal consumindo handoff, handoff inconsistente bloqueado, venda histórica sem handoff, nenhum fallback tPag=01, nenhum dado vivo, regressão dos PDVs que compartilham o finalizador.

## 14. Revisão independente

Outra família (GPT) revisou o diff contra os 10 eixos do GOAL. **PASS em todos:**
semântica tPag; produtor único em `upsertVendaInTransaction`; ausência de invenção;
cartão sem grupo fabricado; PIX genérico sem inferir 17/20/23; carnê/a prazo/vale
bloqueados; troco não inferido; PDVs intocados; Fiscal só consumidor sem fallback;
legado fail-closed preservado. Classificação recomendada **B**. Zero risco D.

## 15. CURRENT_STATUS

Atualizado: ADR-0023 = aceita/vigente; estado deste GOAL registrado porque o contrato de origem da Venda mudou.

## 16–20. Git / schema / #73 / SEFAZ

Commit único. PR Draft contra `main`. Schema = zero. #73 intacta. Zero SEFAZ.

## 21. Classificação

**B:** dinheiro/débito/crédito com tPag comprovado; PIX/carnê/a prazo/vale/troco/grupo `card` continuam exigindo dado que o PDV não captura; **nenhuma informação é inventada**. Não é D: pagamento real, caixa, financeiro e TEF inalterados; fail-closed reforçado no handoff.
