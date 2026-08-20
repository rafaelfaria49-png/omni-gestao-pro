---
title: ADR-0023 · Contrato canônico de pagamento fiscal da NFC-e (fail-closed)
status: aceita
data: 2026-08-19
autor: Grok (FISCAL-030-PAYMENT-BOUNDARY-CANONICAL-CONTRACT-073)
revisores: [revisão independente de outra família — ver relatório 030]
hub: cross
tags: [fiscal, nfce, pagamento, tPag, snapshot, fail-closed]
superado_por:
substitui:
---

# ADR-0023 · Contrato canônico de pagamento fiscal da NFC-e (fail-closed)

> **Status:** aceita
> **Decisão em uma frase:** o XML NFC-e consome somente um contrato tipado/versionado de
> pagamento congelado no snapshot da venda; inconsistência bloqueia a emissão; Fiscal não
> executa, corrige, inventa nem reconstrói pagamento a partir de dado vivo.

---

## 1. Contexto

Antes deste GOAL, `VendaFiscalSnapshot.venda.paymentBreakdown` era `Record<string, unknown>`
e o builder XML (`lib/fiscal/xml/nfce-xml-builder.ts`) interpretava o objeto com heurística
(`forma`/`tipo`/`method`, aliases `cash`/`especie`, fallback `tPag=99`) e, se a soma não
fechava com `vNF` ou o breakdown faltava, **caía silenciosamente para um único `detPag`
DINHEIRO/`tPag=01`**. Isso é inadequado para homologação.

**Estado atual relevante:**
- PDVs ativos persistem `PaymentBreakdownFull`: `dinheiro`, `pix`, `cartaoDebito`,
  `cartaoCredito`, `carne`, `aPrazo`, `creditoVale` (números). Não persistem array
  `{forma, valor}`, nem `tPag`, nem grupo de cartão, nem valor entregue/troco
  (`normalizePaymentsToMatchTotal` corta o excesso de dinheiro no PDV).
- Snapshot e `snapshotPagamento` JSONB já são o veículo aditivo (hash, tributação).

---

## 2. Decisão

Criar `lib/fiscal/payment/**` (contrato v1) e congelá-lo em
`snapshot.venda.pagamentoFiscal` (JSONB aditivo, **sem migration**).

- O XML lê **somente** `pagamentoFiscal`. Nunca `paymentBreakdown`, Caixa, Financeiro ou PDV vivo.
- Forma desconhecida, valor inválido, soma divergente, ausência e snapshot legado sem contrato
  → erro fiscal explícito **antes** de assinatura/provider.
- Zero fallback para dinheiro. Zero conversão automática para `tPag=99`.
- `tPag` somente do catálogo IT 2024.002 v1.11 + padrão XSD `PL_010e_v1.02`.
- Cartão: emite `tPag` 03/04 + `vPag`; **não** emite grupo `card` (tpIntegra/CNPJ/tBand/cAut
  não existem na venda persistida — não inventar “não integrado”).
- Troco: `vTroco` sempre `null` neste contrato.
- Histórico: NotaFiscal já persistida **não é reescrita**. Emissão futura de snapshot legado
  falha com `pagamento_canonico_ausente`.

**O que esta decisão NÃO inclui:**
- alterar produtores de pagamento (PaymentModal, finalizeSale, Caixa, Financeiro);
- TEF/adquirência; schema/migration; SEFAZ; H-9/H-10; #73.

---

## 3. Alternativas consideradas

| Alternativa | Prós | Contras | Por que não escolhida |
|---|---|---|---|
| A) Continuar heurística + fallback dinheiro | XML sempre monta | Homologação mentirosa | Proibida pelo GOAL |
| B) Inventar tpIntegra=2 / tPag=05/91/19 | Cartão e a prazo “completos” | Dado fiscal fabricado | Proibida (classificação D) |
| C) Contrato canônico fail-closed sobre o persistido (escolhida) | Fronteira honesta | Gaps B nas formas sem evidência | — |

---

## 4. Consequências

### 4.1 Positivas
- NFC-e de dinheiro/PIX/débito/crédito/split com evidência persistida suficiente.
- Inconsistência visível e bloqueante, não silenciosa.

### 4.2 Negativas / Custos
- Vendas a prazo, carnê e crédito-vale **não emitem** até handoff do PDV (gap B).
- Débito/crédito sem grupo `card` podem ser recusados por regra de negócio SEFAZ mesmo
  válidos no XSD (`card` minOccurs=0).

### 4.3 Riscos introduzidos
- Homologação com cartão sem TEF · mitigação: não inventar grupo; documentar gap.
- PIX 17 vs 20/23 · mitigação: 17 é código oficial vigente; tipo de QR não persistido.

### 4.4 O que muda imediatamente
- Arquivos: `lib/fiscal/payment/**`, snapshot, XML builder/validation, testes, este ADR.
- Docs: `docs/fiscal/FISCAL_PAYMENT_BOUNDARY_030_REPORT.md`.

### 4.5 O que muda no longo prazo
- Handoff mínimo do PDV para fechar gaps B (ver relatório 030).

---

## 5. Plano de implementação

**Esta decisão é só decisão — a implementação deste GOAL já materializa o contrato v1.**

- Owner humano: Rafael
- Pré-requisitos: GOAL 029 na main (`659fb296`)
- Critério de pronto: testes do contrato/snapshot/XML verdes; typecheck; zero schema; zero SEFAZ.

---

## 6. Validação / como saberemos que deu certo

- XML com PIX/débito/crédito nunca contém fallback `tPag=01`.
- Snapshot legado sem `pagamentoFiscal` não gera XML.
- `git diff --check` e `npm run typecheck` limpos.

---

## 7. Referências

- ADRs relacionados: ADR-0008 (arquitetura fiscal), ADR-0022 (NFC-e SP)
- XSD: `lib/fiscal/xsd/schemas/PL_010e_v1.02/NFe/leiauteNFe_v4.00.xsd` (grupo `pag`)
- IT 2024.002 v1.11 (Portal Nacional da NF-e / ENCAT, 04/03/2026)
- Relatório: `docs/fiscal/FISCAL_PAYMENT_BOUNDARY_030_REPORT.md`

---

## 8. Notas / discussão

Aceite formal humano em 2026-08-19 via GOAL `FISCAL-030-PAYMENT-BOUNDARY-ACCEPT-AND-INTEGRATE-074`. A decisão técnica permanece inalterada.

Mapeamento comprovado neste GOAL:

| Forma interna persistida | tPag | Situação |
|---|---|---|
| `dinheiro` | 01 | A |
| `pix` | 17 | A no valor; B no subtipo 17/20/23 |
| `cartaoCredito` | 03 | A no valor; B no grupo `card` |
| `cartaoDebito` | 04 | A no valor; B no grupo `card` |
| `aPrazo` | — | B (05 vs 91 vs 15) |
| `carne` | — | B (05 vs 15) |
| `creditoVale` | — | B (19 vs 21) |

---

## 9. Adendo — GOAL 075 (handoff de origem)

Em 2026-08-19 o GOAL `FISCAL-030-PAYMENT-ORIGIN-HANDOFF-075` materializou o handoff
mínimo previsto em §4.5: `Venda.payload.fiscalPaymentHandoff` (JSONB aditivo, sem
schema), produzido só em `upsertVendaInTransaction`. Fiscal passou a preferir o
handoff; vendas históricas sem o campo preservam o caminho legado deste ADR
(incluindo PIX→17). O handoff **não** infere subtipo PIX 17/20/23. Relatório:
[`FISCAL_PAYMENT_ORIGIN_HANDOFF_075_REPORT.md`](../fiscal/FISCAL_PAYMENT_ORIGIN_HANDOFF_075_REPORT.md).

---

## 10. Adendo — GOAL 077 (semântica fiscal do PIX)

Em 2026-08-19 o GOAL `FISCAL-030-PIX-SEMANTICS-CAPTURE-077` passou a capturar
`pixQrKind` (`dinamico` | `estatico` | `automatico`) no instante do pagamento,
somente quando PIX > 0 e sem default. O servidor deriva tPag 17/20/23 pelo
IT 2024.002 v1.11; tPag enviado pelo cliente é ignorado. PIX sem discriminador
permanece fail-closed; a venda comercial continua finalizando. A UI do caixa
oferece só `estatico`/`dinamico` (observáveis); `automatico` (tPag 23) existe
no contrato mas não é escolha do operador. Relatório:
[`FISCAL_PAYMENT_PIX_SEMANTICS_077_REPORT.md`](../fiscal/FISCAL_PAYMENT_PIX_SEMANTICS_077_REPORT.md).

---

## 11. Adendo — GOAL 079 (PIX legado fail-closed)

Em 19/08/2026 o GOAL `FISCAL-030-PIX-LEGACY-FAIL-CLOSED-079` eliminou a inferência
`pix → tPag 17` do caminho legado (`paymentBreakdown` sem `fiscalPaymentHandoff`).

- Venda nova com handoff: inalterada (`dinamico→17`, `estatico→20`, `automatico→23`;
  ausência de `pixQrKind` → fail-closed).
- Venda histórica sem handoff e `pix > 0`: erro `PAGAMENTO_PIX_LEGADO_SEM_EVIDENCIA`.
  Não usa `PAGAMENTO_FORMA_DESCONHECIDA`.
- Contrato já congelado `fonte=venda.payload.paymentBreakdown` + `formaInterna=pix` +
  `tPag=17` **não autoriza** nova preparação/assinatura/transmissão. O JSONB **não**
  é reescrito. A versão do contrato permanece **1**: `fonte` já distingue inferência
  histórica de evidência explícita no handoff.
- NFC-e já AUTORIZADA (XML/protocolo persistidos): leitura e DANFC-e/reimpressão
  continuam no documento persistido; sem reconstrução de pagamento e sem retransmissão.

Relatório: [`FISCAL_PAYMENT_PIX_LEGACY_FAIL_CLOSED_079_REPORT.md`](../fiscal/FISCAL_PAYMENT_PIX_LEGACY_FAIL_CLOSED_079_REPORT.md).

---

## 12. Adendo — GOAL 081 (semântica de pagamentos diferidos)

Em 19/08/2026 o GOAL `FISCAL-030-DEFERRED-PAYMENT-SEMANTICS-081` capturou a
semântica fiscal comprovável de **crédito/vale** e manteve carnê/a prazo fail-closed.

- `creditoVale` (handoff novo) → tPag **21** (Crédito em Loja). Evidência: único
  originador de `ClienteCredito` é devolução/troca; o PDV apenas abate o saldo.
  Não é vale-presente (12) nem programa de fidelidade (19). Sem picker: a chave
  persistida já é unívoca. Venda histórica sem handoff, ou handoff legado
  `capability=blocked`, permanece fail-closed.
- `carne`: config `boleto` colapsa em `carne` (`toPaymentMethodType`). Mesmo
  mecanismo (recebimento imediato no caixa; carnê HTML local; sem boleto bancário
  nem Conta a Receber). 05 vs 15 não unívoco. Sem discriminator/picker.
- `aPrazo`: cria `ContaReceberTitulo`. Não é boleto (15) nem duplicata (14).
  Resta 05 vs 91. Sem discriminator/picker.
- Cliente não envia tPag. `upsertVendaInTransaction` continua autoridade.
- Pagamento comercial (caixa, Contas a Receber, crédito do cliente) intocado.

Relatório: [`FISCAL_PAYMENT_DEFERRED_SEMANTICS_081_REPORT.md`](../fiscal/FISCAL_PAYMENT_DEFERRED_SEMANTICS_081_REPORT.md).

---

## 13. Adendo — GOAL 083 (dinheiro entregue e vTroco)

Em 20/08/2026 o GOAL `FISCAL-030-CASH-TENDERED-CHANGE-083` passou a persistir
`cashTendered` (dinheiro fisicamente entregue) no payload da Venda e no handoff,
sem alterar o valor comercial aplicado nem o Caixa.

- `detPag.vPag` de dinheiro, quando há evidência válida de excesso, é o valor
  **recebido** (YA03). Demais formas continuam com o valor aplicado.
- `pag.vTroco` (YA09) é derivado no servidor: `cashTendered − dinheiroAplicado`.
- Invariância oficial (NT 2016.002 v1.61 YA09-10; W16-70 excluída):
  `Σ(vPag) − vTroco = vNF`. O cliente **não** envia `vTroco`.
- Ausência de `cashTendered` (legado) → `vTroco` null; emissão com
  `Σ(vPag) = vNF` permanece válida. Valor inválido ou menor que o aplicado
  não é evidência.
- Versão do handoff permanece **1** (campo aditivo). Sem schema.

Relatório: [`FISCAL_PAYMENT_CASH_TENDERED_CHANGE_083_REPORT.md`](../fiscal/FISCAL_PAYMENT_CASH_TENDERED_CHANGE_083_REPORT.md).
