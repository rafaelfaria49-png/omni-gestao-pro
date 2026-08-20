# FISCAL-030 — PIX dinâmico não integrado (tPag 17 + YA04 `tpIntegra=2`)

| Campo | Valor |
|---|---|
| **GOAL** | `FISCAL-030-PIX17-YA04-NONINTEGRATED-089` |
| **main usada** | `c021e9124d2bb137e5c827479f07c51f1363895f` (merge PR #96 / GOAL 087) |
| **ADR** | [ADR-0023](../decisions/ADR-0023-pagamento-fiscal-canonico-nfce-fail-closed.md) (**aceita/vigente**, adendo 089) |
| **Schema / migration** | **zero** |
| **SEFAZ / H-9 / H-10 / #73 / #97** | **intactos** (#73 `OPEN` · *chore(fiscal): preparar nova janela H9 H10*; #97 `OPEN` · GOAL 018) |
| **Classificação** | **A** |

---

## 1. main usada

HEAD de `main` no início: `c021e9124d2bb137e5c827479f07c51f1363895f`. Ancestral Fiscal pedido. Sem rebase. Sem merge adicional.

## 2. Fonte oficial (reconfirmada, não só o 085)

| Fonte | Versão | O que prova |
|---|---|---|
| XSD `PL_010e_v1.02/NFe/leiauteNFe_v4.00.xsd` (repo) | leiaute 4.00 | Grupo `card` `minOccurs=0`. Se existir, `tpIntegra` é **obrigatório** (enum `1`\|`2`). Filhos CNPJ/`tBand`/`cAut`/`CNPJReceb`/`idTermPag` `minOccurs=0`. Documentação: **1** = integrado (TEF / e-commerce / POS integrado); **2** = **não** integrado (POS simples). `cAut` = “autorização da operação com cartões, **PIX**, boletos…”. |
| NT **2025.001 v1.02** (PDF ENCAT, set/2025) | YA04-10 msg **391** | “Se o Pagamento for por cartão (tag:tPag=03, 04), **ou PIX (tpag=17)**, deve ser informado o grupo de cartões (tag:card)”. Modelo 55 = implementação futura; **NFC-e 65 não adiada**. Coluna Aplic. = Obrig. |
| NT **2025.001 v1.03** (changelog) | 29/09/2025 | **Não altera YA04-10.** Deltas: YA03-10/30 (exceção tPag 91) e E16a-30. |
| NT 2025.001 YA05-10 msg **392** | v1.02 | CNPJ + `cAut` **somente** se `tpIntegra=1`. Com `tpIntegra=2` o XSD e a YA05-10 **não** obrigam YA05. |
| Portaria 219/2019-PB / alerta SEFAZ-PB | estadual | Exige `tpIntegra=1` + CNPJ + e2eid para PIX dinâmico **no Estado**. **Não** é regra nacional. **Não** adotada. |

`minOccurs=0` no XSD **não** anula YA04-10 na NFC-e 65. YA04-10 **não** lista tPag 20 nem 23 — sem obrigação nova de `card` para estático/automático.

## 3. Fluxo PIX dinâmico real (reauditoria)

```
PaymentModal (valor PIX + pixQrKind observado)
  → PDVs (clássico, supermercado, assistência, venda completa ×2, Black)
  → finalizeSaleTransaction({ pixQrKind })
  → upsertVendaInTransaction
  → buildFiscalPaymentHandoff → fiscalPaymentHandoff
```

Confirmado no código vigente:

| Capacidade | Evidência |
|---|---|
| OmniGestão **não** gera cobrança PIX | sem API/PSP de cobrança; `pix` é valor informado no caixa |
| **não** gera QR via PSP | ícone Lucide `QrCode`; picker só observa o tipo |
| **não** consulta PSP | zero MercadoPago/Asaas/PagSeguro/Stone/EFI/OpenPix no fluxo PDV |
| **não** recebe confirmação automática | operador confirma a venda |
| **não** recebe e2eid | campo inexistente; cliente `cAut`/`card` é descartado no upsert |
| QR dinâmico é **externo** | microcopy: “Foi gerado um QR ou link com o valor desta venda” = observação, não geração |

Nenhum fluxo integrado real. **Não parar em B.**

## 4. Integração existente ou ausente

**Ausente.** Não há TEF, SDK de adquirente, PSP PIX, geração de QR, consulta de status nem e2eid. `tpIntegra=1` seria invenção.

## 5. Regra `tpIntegra`

XSD: 1 = integrado ao sistema de automação; 2 = não integrado. O fluxo auditado é **2**. YA05-10 não se aplica. Não fabricar e2eid para “completar” YA05.

## 6. Handoff 17 (novo)

`pixQrKind = dinamico` → servidor grava `tPag="17"` + `tpIntegra="2"` + `capability=supported`.

Cliente **não** é autoridade: `tpIntegra`, `CNPJ`, `tBand`, `cAut`, `CNPJReceb`, `idTermPag`, `card`, `NSU`, `fiscalPaymentHandoff` injetados são descartados em `upsertVendaInTransaction`. Hints extras (`tpIntegra: "1"`, e2eid) são ignorados.

## 7. Comportamento 20/23

- `estatico` → tPag **20**, **sem** `card` / `tpIntegra`.
- `automatico` → tPag **23**, **sem** `card` / `tpIntegra`.
- `tpIntegra` em 20/23 → `PAGAMENTO_CARTAO_DADOS_NAO_SUPORTADOS` (dado extra, não analogia YA04-10).

Códigos 20/23 **não** foram alterados.

## 8. Legado

Não reclassifica Venda histórica. Handoff antigo tPag 17 **sem** `tpIntegra` persistido → `PAGAMENTO_PIX_TPINTEGRA_AUSENTE`. Não presume `2` só porque hoje o sistema não tem PSP. `paymentBreakdown` + PIX 17 inferido continua `PAGAMENTO_PIX_LEGADO_SEM_EVIDENCIA`.

## 9. XML

Ordem XSD `detPag`: `indPag?` · `tPag` · `xPag?` · `vPag` · `dPag?` · `(CNPJPag+UFPag)?` · **`card?`**.

Novo tPag 17 válido:

```xml
<detPag>
  <tPag>17</tPag>
  <vPag>…</vPag>
  <card>
    <tpIntegra>2</tpIntegra>
  </card>
</detPag>
```

Nenhum outro filho. 20/23: `tPag` + `vPag` sem `card`. Nova preparação 17 **não** produz XML sem `card` (fail-closed no contrato + cinto no builder).

## 10. Splits

Cada linha 17 tem o próprio `card`/`tpIntegra=2`. Cartão 03/04 continua com o **próprio** YA04 (códigos `PAGAMENTO_CARTAO_*`). PIX+dinheiro: 17 com card, 01 sem. PIX+cartão: dois grupos `card` independentes.

## 11. Autorizado / reprint

NFC-e já AUTORIZADA: XML persistido é a fonte. DANFC-e parseia `tPag`/`vPag`; não reconstrói YA04. Testes: XML legado 17 **sem** `card` reimprime; XML com `card`/`tpIntegra=2` reimprime sem inventar filhos.

## 12. Arquivos

**Criados:** `lib/fiscal/payment/pix-ya04-evidence.ts` (+ teste); este relatório.

**Alterados:** `lib/vendas/fiscal-payment-handoff.ts` (+ teste); `lib/fiscal/payment/{types,index,from-handoff,from-venda-breakdown,card-evidence}.ts` (+ testes); `lib/ops-upsert-venda-fiscal-handoff.test.ts`; snapshot (+ teste); XML builder/types/validation (+ teste); finalized-nfce-preparer teste; DANFC-e teste; ADR-0023; `CURRENT_STATUS.md`.

**Não tocados:** PaymentModal (UX `pixQrKind` intacta); `prisma/schema.prisma`; migrations; auth/proxy; Caixa/Financeiro engines; H-9/H-10; #73; #97; adquirente; SEFAZ; carnê/aPrazo.

## 13. Testes

Cobertos: dinâmico 17 + `tpIntegra=2`; dinâmico sem `tpIntegra` bloqueado; dinâmico `tpIntegra=1` bloqueado; estático 20 sem card; automático 23 sem card; histórico 17 sem evidência bloqueado; autorizado 17 antigo reimprimível; PIX + dinheiro; PIX + cartão 03/04; cartão continua com YA04 próprio; hints/cliente ignorados; zero e2eid inventado.

## 14. Build

| Gate | Resultado |
|---|---|
| `npm run typecheck` | **0 erros** |
| testes focados | **377 passed / 17 files** (handoff, payment, snapshot, XML, preparer, DANFC-e, dry-run, upsert) |
| ESLint focado (`.ts` tocados) | **exit 0** |
| `npm run build` | **pass** (Next.js 16.2.0 webpack; `MIGRATION_SKIPPED`; Prisma Client gerado sem schema change) |
| `git diff --check` | **ok** |

## 15. Revisão independente

Outra família (read-only) após a implementação. Ver PR / seção de revisão.

## 16–21. Git / schema / #73 / #97 / SEFAZ

PR Draft **#98** contra `main`. Schema = **zero**. #73 e #97 apenas observadas (`OPEN`). Zero adquirente. Zero SEFAZ. Zero TEF.

## 22. Classificação

**A** — PIX dinâmico atual é pagamento **não** integrado; YA04-10 aplica-se a tPag 17 na NFC-e 65; novas emissões 17 emitem `card` + `tpIntegra=2` com evidência server-side; 20/23 inalterados; legado inseguro bloqueado; autorizado/reprint preservado; sem e2eid/PSP inventado; sem analogia indevida com cartão (códigos PIX específicos).
