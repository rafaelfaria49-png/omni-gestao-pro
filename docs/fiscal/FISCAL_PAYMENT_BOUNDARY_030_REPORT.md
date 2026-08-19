# FISCAL-030 — Fronteira canônica de pagamento NFC-e (fail-closed)

| Campo | Valor |
|---|---|
| **GOAL** | `FISCAL-030-PAYMENT-BOUNDARY-CANONICAL-CONTRACT-073` |
| **Base** | `origin/main` = `659fb2969befa4257da4f45deeb356f2677f6113` (GOAL 029) |
| **ADR** | [ADR-0023](../decisions/ADR-0023-pagamento-fiscal-canonico-nfce-fail-closed.md) (proposta) |
| **Schema / migration** | **zero** |
| **SEFAZ / H-9 / H-10 / #73** | **intactos** |
| **Classificação** | **B** |

---

## 1. main usada

`659fb2969befa4257da4f45deeb356f2677f6113` — merge do PR #81 (FISCAL-029 SAT/NFC-e SP).

## 2. Formatos reais encontrados nos produtores

Não se alterou nenhum produtor. Auditoria read-only:

| Produtor | O que persiste |
|---|---|
| PDV clássico / supermercado / assistência / venda-completa / Black | objeto plano `PaymentBreakdownFull` via `finalizeSaleTransaction` / `reducePaymentsToBreakdown` |
| `app/api/ops/venda-persist` → `upsertVendaInTransaction` | grava `sale.paymentBreakdown` no `Venda.payload` (números) |
| `aPrazoConfig` | parcelas/vencimento para Contas a Receber — **não** é tPag |
| `PaymentMethod.maquininhaId/Nome` | existe no modal; **não** entra no payload da venda |
| Troco | calculado na UI; `normalizePaymentsToMatchTotal` **corta** o dinheiro ao total — **não** persiste valor entregue nem `vTroco` |

Formato heurístico de array `{forma, valor}` **não** é produzido pelos PDVs ativos.

Chaves reais: `dinheiro`, `pix`, `cartaoDebito`, `cartaoCredito`, `carne`, `aPrazo`, `creditoVale`.

## 3. Problema do fallback atual (removido)

O XML fazia `parsePagamentos` heurístico e, se soma ≠ `vNF` ou breakdown ausente,
emitia `{ tPag: "01", vPag: vNF }`. Forma desconhecida virava `tPag=99`.

## 4. Contrato canônico criado

`lib/fiscal/payment/**` v1, congelado em `snapshot.venda.pagamentoFiscal` (+ `pagamentoFiscalErro`).
`paymentBreakdown` permanece como evidência bruta. XML **não** o interpreta.

Snapshots novos derivam o contrato no `buildVendaFiscalSnapshot`. Snapshots legados sem o
campo falham na emissão com `pagamento_canonico_ausente` — **sem** consultar Caixa/Financeiro/PDV vivo e **sem** reescrever NotaFiscal histórica.

## 5. Tabela forma interna → tPag comprovada

Fonte: IT 2024.002 v1.11 + XSD `PL_010e_v1.02` (`tPag` = `[0-9]{2}`).
A tabela de rótulos do DANFC-e **não** é autoridade.

| Forma interna | tPag | Descrição oficial | Capacidade neste GOAL |
|---|---|---|---|
| `dinheiro` | 01 | Dinheiro | **A** |
| `pix` | 17 | PIX: QR Code Dinâmico | **A** no valor; **B** nos subtipos 20/23 (não persistidos) |
| `cartaoCredito` | 03 | Cartão de Crédito | **A** no valor; **B** no grupo `card` |
| `cartaoDebito` | 04 | Cartão de Débito | **A** no valor; **B** no grupo `card` |
| `aPrazo` | — | — | **B** |
| `carne` | — | — | **B** |
| `creditoVale` | — | — | **B** |
| chave desconhecida | — | — | erro `PAGAMENTO_FORMA_DESCONHECIDA` (não vira 99) |

## 6. Situação cartão (leiaute 4.00)

XSD (`pag/detPag/card`, minOccurs=0):

| Campo | XSD | Persistido na venda? | Este GOAL |
|---|---|---|---|
| `tpIntegra` | obrigatório **se** o grupo `card` existir (1=TEF/integrado, 2=não integrado) | não | grupo **omitido** — não inventar `2` |
| `CNPJ` | opcional | não | omitido |
| `tBand` | opcional `[0-9]{2}` | não | omitido |
| `cAut` | opcional | não | omitido |

Handoff mínimo para fechar o gap B de cartão: persistir na venda, no instante do pagamento,
`tpIntegra` + (se integrado) CNPJ da credenciadora, `tBand` e `cAut`. Sem TEF neste GOAL.

## 7. Situação a prazo

`aPrazo` e `carne` são persistidos e usados em produção. IT 2024.002 oferece 05 (crediário /
private label), 15 (boleto) e 91 (pagamento posterior). A venda **não declara** qual é.
**Não mapeado.** Emissão com essas formas falha `PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL`.

Handoff mínimo: a venda persistir `tPag` fiscal explícito (ou um discriminador ratificado por ADR)
no instante do fechamento.

## 8. Situação troco

Não há fonte canônica de valor entregue. `vTroco` do contrato é sempre `null`. O DANFC-e
continua podendo *exibir* `<vTroco>` se o XML autorizado já o trouxer (parse do XML persistido,
não reconstrução).

## 9. Tratamento de snapshots legados

Campo `pagamentoFiscal` ausente → `pagamento_canonico_ausente`. Não se reconstrói. Não se
consulta dado vivo. Não se reescreve a nota.

Hash do snapshot: contrato de hash permanece v1 (mesma canonização). Conteúdo novo (campo
aditivo) muda o SHA-256 de snapshots **novos**. XML do dry-run 005 permanece byte-idêntico
(`unsignedXmlSha256` inalterado); só `snapshotSha256` da prova 005 foi rebaseado.

## 10. Arquivos

**Criados:** `lib/fiscal/payment/**`, ADR-0023, este relatório.

**Alterados (Fiscal):** snapshot builder, XML builder/validation/types, testes e fixtures
XML-path (dinheiro canônico no lugar do fallback), golden `snapshotSha256` da prova 005.

**Não tocados:** PaymentModal, finalizeSaleTransaction, Caixa, Financeiro, schema/migrations,
adquirentes, H-9/H-10, #73, provider/transporte SEFAZ.

## 11. Testes

Cobertura obrigatória no contrato + XML builder: dinheiro, PIX, débito, crédito, split,
forma desconhecida, breakdown ausente, soma abaixo/acima, valor inválido, legado sem contrato,
XML nunca cai para dinheiro, XML nunca lê `paymentBreakdown`/módulos vivos, hash estável à
ordem das chaves e diferente do legado.

## 12. Revisão independente

Outra família (GPT) revisou o diff contra os 8 eixos do GOAL. **PASS em todos:**
ausência de fallback `tPag=01`; mapeamento oficial; cartão sem invenção de `tpIntegra`;
split sem fabricar troco; legado fail-closed; zero schema; zero SEFAZ; XML não lê
`paymentBreakdown`.

## 13–18. Git / schema / SEFAZ / classificação

PR Draft contra `main`. Schema = zero. #73 intacta. Zero SEFAZ.

**Classificação B:** fronteira canônica implementada para as formas com evidência suficiente
(dinheiro/PIX/débito/crédito/split), com matriz de gap explícita para a prazo/carnê/vale,
grupo de cartão, subtipo PIX e troco. Não é D: Fiscal não altera pagamento nem inventa forma.
