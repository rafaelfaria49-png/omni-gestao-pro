# FISCAL-030 — Grupo `card` mínimo para POS não integrado (`tpIntegra=2`)

| Campo | Valor |
|---|---|
| **GOAL** | `FISCAL-030-CARD-POS-SIMPLE-TPINTEGRA-087` |
| **main usada** | `291038266aeb0384e07a1b7644bbd9cc4d18ea30` (ancestral Fiscal `54a6a044` — merge PR #95 / auditoria 085 — é ancestral desta main) |
| **ADR** | [ADR-0023](../decisions/ADR-0023-pagamento-fiscal-canonico-nfce-fail-closed.md) (**aceita/vigente**; adendo 087) |
| **Schema / migration** | **zero** |
| **SEFAZ / H-9 / H-10 / #73** | **intactos** (#73 apenas observada: `OPEN` · *chore(fiscal): preparar nova janela H9 H10*) |
| **Classificação** | **A** |

---

## 1. main usada

HEAD de `main` no início: `291038266aeb0384e07a1b7644bbd9cc4d18ea30` (Contador homolog Postgres). O ancestral pedido `54a6a044995cbe21064095cec47aa5e0d13ab4c7` (integração da auditoria 085) **é ancestral**. Sem rebase Fiscal. Sem merge adicional.

## 2. Contrato final

Versão do handoff e do contrato canônico **permanece 1**. Evolução **aditiva**:

- `FiscalPaymentHandoffLinha.tpIntegra?: "1" | "2"`
- `PagamentoFiscalDetalhe.tpIntegra?: "1" | "2"`

Não versionar: o campo é opcional; linhas sem `tpIntegra` (dinheiro/PIX/vale) continuam válidas; 03/04 **sem** o campo passam a fail-closed em vez de emitir XML incompleto. Um bump de versão rejeitaria handoffs 075–083 inteiros (dinheiro/PIX) sem necessidade.

Capacidade deste slice:

| Forma | tPag | YA04 |
|---|---|---|
| `cartaoCredito` (handoff novo) | 03 | `<card><tpIntegra>2</tpIntegra></card>` |
| `cartaoDebito` (handoff novo) | 04 | idem |
| PIX 17/20/23 | inalterado | **sem** `card` (residual 17+YA04) |
| dinheiro 01 | inalterado | não se aplica |

Filhos **não** emitidos e **não** persistidos: CNPJ, tBand, cAut, CNPJReceb, idTermPag, NSU.

## 3. Origem server-side do tpIntegra

`buildFiscalPaymentHandoff` (chamado só em `upsertVendaInTransaction`) grava `tpIntegra: "2"` nas linhas `cartaoDebito` / `cartaoCredito`.

- **Não** deriva de `maquininhaId`.
- **Não** lê `tpIntegra` / `card` / CNPJ / tBand / cAut do cliente.
- Hints extras (`tpIntegra: "1"`, etc.) são ignorados.
- PaymentModal **não** foi alterado: a evidência é o fluxo POS manual já auditado (GOAL 085).

## 4. Handoff novo

```
cartaoCredito → tPag "03" + tpIntegra "2" + capability supported
cartaoDebito  → tPag "04" + tpIntegra "2" + capability supported
```

O servidor reconstrói o handoff no upsert. Campos YA04 / `card` / `NSU` / `tpIntegra` enviados no `SalePayload` são descartados.

## 5. Tratamento tpIntegra=1

Código estável: `PAGAMENTO_CARTAO_INTEGRADO_NAO_SUPORTADO` → XML `pagamento_cartao_integrado_nao_suportado`.

Não inventa CNPJ / tBand / cAut para “completar” YA05-10. TEF permanece fora.

## 6. Tratamento legado

| Caso | Código |
|---|---|
| Handoff 03/04 sem `tpIntegra` | `PAGAMENTO_CARTAO_TPINTEGRA_AUSENTE` |
| `tpIntegra` fora de `1`\|`2` | `PAGAMENTO_CARTAO_TPINTEGRA_INVALIDO` |
| `tpIntegra=1` | `PAGAMENTO_CARTAO_INTEGRADO_NAO_SUPORTADO` |
| `paymentBreakdown` histórico 03/04 (sem handoff) | `PAGAMENTO_CARTAO_LEGADO_SEM_EVIDENCIA` |
| CNPJ / tBand / cAut / NSU / `card` no handoff | `PAGAMENTO_CARTAO_DADOS_NAO_SUPORTADOS` |
| `tpIntegra` em PIX/dinheiro (analogia) | `PAGAMENTO_CARTAO_DADOS_NAO_SUPORTADOS` |

Não reclassifica Venda histórica. Não presume POS simples só porque existe `paymentBreakdown` com débito/crédito.

Contrato congelado `fonte=paymentBreakdown` + 03/04 **não autoriza** nova preparação. Contrato congelado handoff + 03/04 sem `tpIntegra` também bloqueia.

## 7–8. XML 03 e 04

Ordem XSD `detPag` (PL_010e_v1.02 `leiauteNFe_v4.00.xsd`): `indPag?` · `tPag` · `xPag?` · `vPag` · `dPag?` · `(CNPJPag+UFPag)?` · **`card?`**. `vTroco` permanece em `pag`, depois dos `detPag`.

Grupo `card`: `tpIntegra` (obrigatório se o grupo existir) · CNPJ? · tBand? · cAut? · CNPJReceb? · idTermPag?.

Emitido:

```xml
<detPag>
  <tPag>03</tPag>
  <vPag>…</vPag>
  <card>
    <tpIntegra>2</tpIntegra>
  </card>
</detPag>
```

Idem `tPag` 04. Nenhum outro filho. Nova preparação 03/04 **não** produz XML sem `card` (fail-closed no contrato + cinto no builder).

## 9. Splits

Cada linha 03/04 tem o próprio `card`/`tpIntegra=2`. Coberto: crédito+dinheiro; débito+dinheiro; crédito+PIX; débito+PIX; crédito+débito; cartão+dinheiro com `vTroco`. PIX 17 no split **não** ganha `card`.

## 10. Autorizado / reprint

NFC-e já AUTORIZADA: XML persistido é a fonte. DANFC-e parseia `tPag`/`vPag` do XML; não reconstrói YA04. Testes: XML legado 03 **sem** `card` reimprime; XML com `card`/`tpIntegra=2` reimprime sem inventar filhos.

## 11. Residual PIX 17

tPag 17 + YA04 **não** foi resolvido por analogia. PIX dinâmico continua 17 sem grupo `card`. Estático 20 / automático 23 inalterados. PIX legado fail-closed inalterado. GOAL separado.

## 12. Caixa / Financeiro

Intocados. `MovimentacaoFinanceira.valor` continua o total da venda. PaymentModal, taxas, `maquininhaId`, parcelamento, estoque e fechamento comercial não foram alterados.

## 13. Arquivos

**Criados:** `lib/fiscal/payment/card-evidence.ts` (+ teste); este relatório.

**Alterados:** `lib/vendas/fiscal-payment-handoff.ts` (+ teste); `lib/fiscal/payment/{types,index,from-handoff,from-venda-breakdown}.ts` (+ testes); `lib/ops-upsert-venda.ts` (+ teste de handoff); snapshot (+ teste); XML builder/types/validation (+ teste); finalized-nfce-preparer teste; DANFC-e teste; ADR-0023; `CURRENT_STATUS.md`.

**Não tocados:** PaymentModal; `prisma/schema.prisma`; migrations; auth/proxy; Caixa/Financeiro engines; H-9/H-10; #73; adquirente; SEFAZ.

## 14. Testes

Cobertos: handoff 03/04 + `tpIntegra=2`; hints/cliente ignorados; splits; fail-closed (ausente / inválido / `1` / legado / dados extra / analogia PIX); snapshot; XML 03 e 04; XML splits + `vTroco`; PIX 17 sem `card`; preparer; DANFC-e reprint legado e com `card`; upsert reconstrói evidência.

## 15. Build

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **0 erros** (após correção TS2352 no teste de tampering e strip de `CNPJ`) |
| testes focados | **360 passed / 16 files**; upsert re-rodado após strip `CNPJ`: **24 passed** |
| ESLint focado (`.ts` tocados) | **exit 0** |
| `npm run build` | **pass** (Next.js 16.2.0 webpack; `MIGRATION_SKIPPED`; Prisma Client gerado sem schema change) |
| `git diff --check` | **ok** |
| xmllint ambiental | **não reapareceu** neste slice |

## 16. Revisão independente

Outra família (read-only). Primeira passagem: **FAIL** no eixo 4 — `CNPJ` top-level não era descartado no upsert (CNPJReceb sim). Correção: strip de `CNPJ` + assert no teste de tampering.

Revisão após correção: **PASS**. Classificação semântica **A**. Eixos 1–10 PASS. Zero `tpIntegra=1` inventado; zero CNPJ/`tBand`/`cAut` fabricados; PIX 17 sem analogia; comercial intacto; zero schema; zero adquirente/SEFAZ.

## 17–21. Git / schema / #73 / SEFAZ

PR Draft contra `main`. Schema = **zero**. #73 apenas observada. Zero adquirente. Zero SEFAZ.

## 22. Classificação

**A** — 03/04 novos emitem `card` + `tpIntegra=2` com evidência server-side; legado inseguro bloqueado; comercial intacto; sem CNPJ/`tBand`/`cAut` fabricados; sem `tpIntegra=1` inventado.
