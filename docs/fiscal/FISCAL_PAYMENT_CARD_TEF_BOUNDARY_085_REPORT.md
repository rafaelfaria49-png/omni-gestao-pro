# FISCAL-030 — Fronteira de cartão e TEF (grupo XML `card`)

| Campo | Valor |
|---|---|
| **GOAL** | `FISCAL-030-CARD-GROUP-TEF-BOUNDARY-AUDIT-085` |
| **main usada** | `26f802d4436071dcab271195693e986083b9b07d` (merge PR #91 · dinheiro entregue e troco) |
| **Tipo** | **Read-only / documental.** Zero TEF, zero adquirente, zero schema, zero SEFAZ |
| **ADR** | [ADR-0023](../decisions/ADR-0023-pagamento-fiscal-canonico-nfce-fail-closed.md) (**aceita/vigente**; adendo 085) |
| **Schema / migration** | **zero** |
| **SEFAZ / H-9 / H-10 / #73** | **intactos** |
| **Classificação** | **A** |

---

## 1. main usada

`26f802d4436071dcab271195693e986083b9b07d` — HEAD de `main` no início da tarefa (GOAL 083 já integrado). Sem rebase. Sem merge adicional.

Estado Fiscal de pagamento nesta main (inalterado neste GOAL):

| Forma | tPag | Grupo XML `card` |
|---|---|---|
| dinheiro | 01 + `cashTendered`/`vTroco` | não se aplica |
| PIX | 17/20/23 só com `pixQrKind` | omitido |
| débito | 04 | **omitido** |
| crédito | 03 | **omitido** |
| `creditoVale` | 21 | não se aplica |
| carnê / aPrazo | fail-closed | — |

---

## 2. Fontes oficiais

Pesquisa em **20/08/2026**. Nenhuma chamada SEFAZ. Nenhuma chamada a adquirente.

| ID | Órgão / artefato | Documento | Versão | Publicação / vigência | O que prova |
|---|---|---|---|---|---|
| F1 | Pacote XSD no repositório | `lib/fiscal/xsd/schemas/PL_010e_v1.02/NFe/leiauteNFe_v4.00.xsd` | PL_010e_v1.02 · leiaute 4.00 | Portal Nacional: **10/07/2026** — “Schemas XML NF-e -010e_v.1.02 - NT 2025.002 v.1.40, NT 2026.002 v.1.0 e NT 2026.003 v.1.0”. Manifesto: [`FISCAL_XSD_MANIFEST_001.md`](./FISCAL_XSD_MANIFEST_001.md). Índice: `https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=BMPFMBoln3w%3D` | Estrutura vigente do grupo `pag/detPag/card`. `card` `minOccurs=0`. Se o grupo existir, `tpIntegra` é **obrigatório** (enum `1`\|`2`). `CNPJ`, `tBand`, `cAut`, `CNPJReceb`, `idTermPag` são `minOccurs=0`. |
| F2 | ENCAT / Portal Nacional | Informe Técnico **2024.002** | **v1.11** | **04/03/2026**. Homologação 02/04/2026 · produção 04/05/2026. Tabela em Documentos → Diversos. Catálogo no repo: `lib/fiscal/payment/tpag-catalog.ts` | tPag **03** = Cartão de Crédito; **04** = Cartão de Débito. Não descreve o grupo `card`. |
| F3 | ENCAT / Portal Nacional | Nota Técnica **2020.006** | **v1.31** | Publicação set/2022. Produção das RVs de pagamento (YA02-60, YA06-10, YA05-20): homologação até 03/05/2021 · produção **01/09/2021** | YA05 = **CNPJ da instituição de pagamento, adquirente ou subadquirente** (não é CNPJ da loja). Distinto do CNPJ do intermediador (YB02). `tBand` passa a tabela externa. YA06-10 (msg **443**, obrig.). YA05-20 (msg **437**, obrig.). |
| F4 | ENCAT / Portal Nacional | Nota Técnica **2023.004** | v1.00 (campos YA) · consolidada **v1.11** (19/03/2024) / **v1.20** (07/10/2024) | Campos do grupo YA (o evento ECONF foi **separado** em versões posteriores — não é autoridade deste GOAL). YA04 passa a **“Cartões, PIX, Boletos e outros Pagamentos Eletrônicos”**. `cAut` 1–128. Inclusão YA10 `CNPJReceb`, YA11 `idTermPag`. **YA04-20** (obrig.): `card` **proibido** se tPag ∉ {03, 04, 10, 11, 12, 13, 15, 17, 18}. Msg na v1.00: **768**; msg **vigente consolidada: 963** | Confirma 03/04 como meios que **aceitam** o grupo. Não autoriza preencher o grupo para tPag 01/21/etc. |
| F5 | ENCAT / Portal Nacional | Nota Técnica **2025.001** | Texto YA04-10 lido em **v1.02** (set/2025). Arquivo vigente no Portal: **v1.03** (29/09/2025; arquivo substituído 01/10/2025). v1.03 **não altera YA04-10** — só YA03-10/30 (exceção tPag 91) e E16a-30 | v1.00 mar/2025; produção do bloco v1.00: **até 01/09/2025**. v1.02: YA04-10 no **modelo 55** = “implementação futura”; **não** adia o modelo 65. v1.03 homologação até 20/10/2025 · produção 03/11/2025 (deltas YA03/E16a) | §02.7: torna obrigatória a aplicação de RVs que eram opcionais por UF (YA03-10 a YA06-10). **YA04-10** (msg **391**): se tPag = **03, 04 ou 17**, deve existir o grupo `card`. **YA05-10** (msg **392**): se `tpIntegra=1`, exigir `card/CNPJ` e `card/cAut`. |
| F6 | NT **2015.002** / **2016.002** (históricas, citadas pela NT 2025.001) | YA04-10 / YA05-10 originais | várias; YA09 em **2016.002 v1.61** (10/09/2018) | YA04-10 nasceu **facultativa a critério da UF**. Exceção: não se aplica em produção a DF-e com dhEmi anterior a 01/04/2016 | Explica o texto residual “opcional a critério da UF” que ainda aparece colado na YA04-10 da NT 2025.001. A coluna **Aplic.** da mesma NT marca **Obrig.** (Facult. riscado). |

**`minOccurs=0` no XSD não significa que a SEFAZ nunca exige o grupo.** A RV YA04-10 (F5) exige `card` para tPag 03/04/17 na NFC-e 65 mesmo o schema permitindo omitir o elemento.

**Não usados como autoridade:** blogs de ERP, wikis comerciais, exemplos Tecnospeed/Oobj. Serviram só para localizar a NT. A leitura de YA04-10/YA05-10 vem de F1+F5. O anúncio da SEFAZ-PB (2025) confirma aplicação nacional da YA04-10 a partir de 01/09/2025, mas a **Portaria 219/2019-PB** (exigir `tpIntegra=1` no Estado) **não** é regra nacional e **não** é adotada aqui.

---

## 3. Estrutura oficial do grupo `card` (YA04)

Leiaute 4.00 vigente (F1), IDs consolidados por F3+F4. Pai: `detPag` (YA01a).

| ID | Tag | Ocor. XSD | Tam. | Conteúdo oficial |
|---|---|---|---|---|
| YA04 | `card` | 0-1 | — | Grupo de Cartões, PIX, Boletos e outros Pagamentos Eletrônicos |
| YA04a | `tpIntegra` | **1-1 se o grupo existir** | 1 | Ver §4 |
| YA05 | `CNPJ` | 0-1 | 14 | CNPJ da **instituição de pagamento** (adquirente / subadquirente; intermediador se este processou o pagamento) |
| YA06 | `tBand` | 0-1 | `[0-9]{2}` | Bandeira — tabela do Portal Nacional |
| YA07 | `cAut` | 0-1 | 1–128 | Número de autorização da operação (cartão, PIX, boleto, outros eletrônicos) |
| YA10 | `CNPJReceb` | 0-1 | 14 | CNPJ do **beneficiário** do pagamento (estabelecimento que recebe) |
| YA11 | `idTermPag` | 0-1 | 1–40 | Identificador do **terminal de pagamento** |

Fora do grupo `card`, no mesmo `detPag`: `tPag`, `vPag`, `indPag` (0-1), `xPag` (0-1), `dPag` (0-1), `CNPJPag`/`UFPag` (0-1, estabelecimento **onde o pagamento foi processado** quando distinto do emitente).

**03/04 no XSD:** nenhum enum de tPag; o padrão é `[0-9]{2}`. A tabela vigente é F2.

---

## 4. Regra `tpIntegra`

Valores válidos (F1 = F4; o XSD vigente inclui “POS Integrado” no valor 1):

| Valor | Significado oficial | Exemplos oficiais |
|---|---|---|
| **1** | Pagamento **integrado** com o sistema de automação da empresa | TEF, comércio eletrônico, **POS Integrado** |
| **2** | Pagamento **não integrado** com o sistema de automação da empresa | **POS Simples** |

O valor **só existe dentro do grupo `card`**. Omitir o grupo é omitir `tpIntegra`; não há `tpIntegra` solto.

**Fluxo atual do OmniGestão:** o operador escolhe débito/crédito no `PaymentModal` **depois** de (ou sem) usar uma maquininha externa. Não há TEF, pinpad, SDK de adquirente nem retorno de autorização. Isso **corresponde à definição oficial do valor 2**. Não corresponde ao valor 1.

**Não se define `tpIntegra=1` só porque existe uma maquininha na loja.** POS externo sem integração sistêmica é o exemplo oficial de 2.

**É possível defini-lo sem TEF?** Sim: **2**, e somente 2, se e quando o grupo for emitido. Emitir 1 sem evidência de integração é invenção (classificação D). Omitir o grupo continua sendo o comportamento **atual** deste GOAL (não implementa).

---

## 5. Regra CNPJ (YA05)

O leiaute espera o CNPJ da **instituição de pagamento / adquirente / subadquirente** — a empresa que processa o cartão (o “fornecedor da maquininha”, na linguagem da NT 2020.006 §6.2: quem fez o **repasse** ao vendedor).

| CNPJ | Tag | Pode ser o da loja? |
|---|---|---|
| Instituição de pagamento | `card/CNPJ` (YA05) | **Não** por conveniência. Só coincidiria se a loja fosse a própria instituição/intermediador que processou o pagamento. |
| Intermediador/marketplace | `infIntermed/CNPJ` (YB02) | Não é YA05. |
| Estabelecimento beneficiário | `card/CNPJReceb` (YA10) | Pode ser o CNPJ do emitente/loja. **Não substitui** YA05. |
| Estabelecimento onde o pagamento ocorreu (quando distinto) | `CNPJPag` (YA03b) | Outro participante. |

Não há CNPJ de credenciadora/adquirente persistido no OmniGestão. O slug `pagbank` / `sicredi` / `mercado_pago` do catálogo local **não** é CNPJ e **não** autoriza interpolar um CNPJ de tabela pública.

YA05-10 (F5, msg 392): CNPJ + `cAut` são exigidos **quando `tpIntegra=1`**. Com `tpIntegra=2`, o XSD e a YA05-10 **não** obrigam YA05.

---

## 6. Regra `tBand`

- XSD: opcional, padrão `[0-9]{2}`.
- Autoridade do catálogo: **Portal Nacional da NF-e → Documentos → Diversos** (“Tabela de Códigos das Operadoras de cartão de crédito e/ou débito”), citada pela NT 2020.006 v1.20 (F3). YA06-10 (msg **443**, obrig. desde 01/09/2021 em produção): se `tBand` for informado, o código **tem** de existir nessa tabela.
- Enum histórico (pré-tabela externa, NTs antigas / SAT): 01 Visa, 02 Mastercard, 03 American Express, 04 Sorocred, 99 Outros. **Não** é o catálogo vigente completo. Este GOAL **não** congela uma cópia local: `tBand` não é emitido.
- OmniGestão **não conhece a bandeira** no instante da venda. Não há campo, picker nem retorno de TEF. Inferir pela maquininha (PagBank “aceita várias bandeiras”) é invenção.

---

## 7. Regra `cAut`

- XSD: opcional, 1–128. NT 2023.004 ampliou de 20 para 128 e passou a cobrir cartão, PIX, boletos e outros eletrônicos.
- Semântica: **número de autorização da operação** retornado pelo processador. Para PIX dinâmico, a prática oficial (NT/IT de meios eletrônicos) aponta o `endToEndId` (e2eid) — **fora do escopo de implementação deste GOAL**.
- **Não usar automaticamente como `cAut`:** NSU genérico, `maquininhaId`, `SaleRecord.id`, `clientSaleId`, `Venda.id`, qualquer transaction id interno, placeholder. NSU **não é campo YA04**. Só poderia coincidir com `cAut` se a adquirente documentar, para aquele produto, que o valor devolvido **é** o identificador de autorização — evidência que o OmniGestão **não tem**.

OmniGestão **não** captura nem persiste autorização real de cartão. NSU também **não existe** no sistema.

---

## 8. Fluxo de cartão atual

```
PaymentModal
  → operador escolhe cartao_debito / cartao_credito (forma manual)
  → opcionalmente escolhe maquininhaId (catálogo local de taxas)
  → onConfirm(PaymentMethod[])
  → PDV reduz a PaymentBreakdownFull (descarta maquininhaId)
  → finalizeSaleTransaction({ paymentBreakdown })
  → upsertVendaInTransaction
  → Venda.payload.paymentBreakdown + fiscalPaymentHandoff
  → Fiscal deriva tPag 03/04 e emite detPag sem <card>
```

PDVs que convergem no mesmo motor: clássico, supermercado, assistência, venda-completa, Black. O operador **informa a forma**; o sistema **não captura** o cartão.

`cartaoLiberado` é forçado `true` ao abrir o modal (`payment-modal.tsx`). Débito/crédito **não** dependem de maquininha ativa. Ausência de catálogo só muda o microcopy de taxas (“venda registrada sem abatimento de taxa”).

---

## 9. Destino atual de `maquininhaId`

| Etapa | Existe? | Evidência |
|---|---|---|
| Tipo `PaymentMethod` no modal | sim (`maquininhaId?`, `maquininhaNome?`) | `components/dashboard/vendas/payment-modal.tsx` |
| Preenchido ao lançar débito/crédito | sim, se houver maquininha ativa no LS | `maq.id` / `maq.nome` do `getMaquininhasParaPdvForStore` |
| `SaleRecord` | **não** | `lib/operations-sale-types.ts` — só `paymentBreakdown` numérico |
| `reducePaymentsToBreakdown` | **descarta** | soma `cartaoDebito`/`cartaoCredito`; ignora id/nome |
| `finalizeSaleTransaction` | **não recebe** | só `paymentBreakdown` |
| Servidor / `upsertVendaInTransaction` | **não** | payload comercial sem o campo |
| `fiscalPaymentHandoff` | **proibido** | teste: `expect(src).not.toMatch(/maquininhaId/)` |
| XML | **não** | `buildPagNode` emite só `tPag`+`vPag` (+ `vTroco`) |

**Semântica hoje:** UX de caixa + conciliação interna de **taxas** (`TaxasMaquininha`: debito, credito, parcelas2a12). Identificação local do terminal **comercial**, não fiscal.

**Não contém** vínculo confiável com credenciadora: o `id` é slug estável (`maq-pagbank`) ou `maq-<timestamp>-<random>`. YA11 (`idTermPag`) é só “identificar o terminal em que foi realizado o pagamento” (1–40) — **não** exige, no texto oficial, um serial de adquirente. Mesmo assim o `maquininhaId` local **não** é evidência suficiente: não é o identificador observado no terminal de pagamento da transação.

Não ampliar a semântica neste GOAL.

---

## 10. Integrações reais encontradas

| Item | Resultado |
|---|---|
| TEF / Sitef / pinpad / POS integrado | **não existe** |
| SDK/API PagBank, Stone, Rede, Mercado Pago, Cielo, Getnet, Adyen | **não existe** no `package.json` nem em código de PDV |
| Stripe (`stripe`, `@stripe/stripe-js`) | billing **SaaS** do OmniGestão — **não** é captura de cartão no PDV |
| Catálogo de maquininhas | **existe** — `lib/centro-financeiro.ts` (`MaquininhaConfig`) |
| Campos do catálogo | `id`, `slug?` (`pagbank` \| `sicredi` \| `mercado_pago` \| `custom`), `nome`, `ativo`, `taxas` |
| CNPJ da credenciadora | **não** |
| bandeira | **não** |
| NSU | **não** |
| código de autorização | **não** |
| e2eid / equivalente | **não** (PIX só tem `pixQrKind`) |
| Persistência do catálogo | `localStorage` por loja (`centro-financeiro-v3::<storeId>`). Espelho opcional `StoreSettings.cardFees` (JSONB já existente). PDV **lê só LS** (`getMaquininhasParaPdvForStore`) — drift já auditado em Settings V3; irrelevante para o XML |
| Operador informa a forma manualmente? | **sim** |

Identificação local da maquininha ≠ evidência fiscal da transação.

---

## 11. Matriz de capacidade

| Dado fiscal | Exigência oficial | Fonte atual no OmniGestão | Confiável? | Persistido? | Pode ser derivado? | Deve permanecer ausente/bloqueado? |
|---|---|---|---|---|---|---|
| `tpIntegra` | Obrigatório **se** `card` existir. 1=integrado; 2=POS simples. YA04-10 (NFC-e 65) exige o **grupo** para tPag 03/04/17 | Nenhuma | — | não | **Sim = `2`**, pelo fluxo auditado (POS manual, sem TEF). **Não = `1`** | Não emitir `1`. `2` só no próximo slice, junto com o grupo. Hoje o grupo está omitido |
| `card/CNPJ` (YA05) | Obrigatório se `tpIntegra=1` (YA05-10). Opcional se `tpIntegra=2`. É CNPJ da instituição de pagamento | Nenhuma | não | não | **não** (slug PagBank ≠ CNPJ) | **Ausente** até evidência de adquirente |
| `tBand` | Opcional no XSD; se informado, YA06-10 obriga catálogo oficial | Nenhuma | não | não | **não** (não inferir pela maquininha) | **Ausente** até a bandeira ser observada na transação |
| `cAut` | Obrigatório se `tpIntegra=1`. Opcional se `2` | Nenhuma | não | não | **não** | **Ausente**. Proibido NSU / id local / sale id |
| NSU | **Não é campo YA04** | Nenhuma | — | não | — | **Ausente**. Não promover a `cAut` |
| `maquininhaId` | Não é campo fiscal. `idTermPag` é outro conceito | `PaymentMethod` (UI) | só para taxas/UX | **não** na Venda | não vira YA11 | **Não ampliar**. Não persistir no handoff Fiscal |
| adquirente / provedor | YA05 (instituição) | slug comercial no LS | não | não (só nome/taxas) | não | **Ausente** no XML até CNPJ real da instituição |
| `CNPJReceb` / `idTermPag` | Opcionais (NT 2023.004); integração pagamento↔DF-e | Nenhuma | não | não | `CNPJReceb` *poderia* ser o CNPJ do emitente, mas **não fecha** YA04-10 e **não** substitui YA05 | **Ausente** neste contrato mínimo |
| grupo `card` (o elemento) | XSD 0-1. YA04-10 **obrig.** NFC-e 65 para 03/04/17 (NT 2025.001). YA04-20 **proíbe** o grupo fora da lista de tPag | omitido | omissão é honesta quanto aos filhos, incompleta quanto à YA04-10 | — | grupo mínimo = `{tpIntegra:2}` | Hoje omitido. Próximo slice: emitir o mínimo honesto para 03/04. **Não** fail-close a venda comercial |

---

## 12. Cartão débito atual

- Forma interna `cartaoDebito` → tPag **04** (IT 2024.002 v1.11), unívoco no handoff (`capability=supported`).
- XML: `<detPag><tPag>04</tPag><vPag>…</vPag></detPag>` — **sem** `<card>`.
- Schema-válido (F1). RV YA04-10 (NFC-e 65): **incompleto**.
- Venda comercial fecha normalmente.

## 13. Cartão crédito atual

- Forma interna `cartaoCredito` → tPag **03**, mesmo padrão do débito, sem grupo `card`.
- Mesmos limites da §12.

---

## 14. Necessidade real de grupo `card`

| Camada | 03/04 sem `card` |
|---|---|
| XSD PL_010e_v1.02 | **permitido** (`minOccurs=0`) |
| YA04-10 NFC-e **65** (NT 2025.001, produção até 01/09/2025) | **grupo exigido** (msg 391). Não exige, por si, CNPJ/`tBand`/`cAut` |
| YA04-10 NF-e **55** | “implementação futura” (NT 2025.001 v1.02) |
| YA05-10 | só se o grupo existir **e** `tpIntegra=1` |
| UF que ainda não ligou a RV | omissão pode autorizar; **não** foi sondado (zero SEFAZ) |

**Capacidade atual documentada:** emitir 03/04 sem `card` é XML schema-válido e é o comportamento congelado (testes `débito válido → tPag 04 sem grupo card`). **Limite:** NFC-e 65 em autorizador que aplique YA04-10 rejeita 391. Isso **não** autoriza fabricar CNPJ, bandeira, `cAut` nem `tpIntegra=1`.

O grupo mínimo que satisfaz YA04-10 **sem TEF** é:

```xml
<card>
  <tpIntegra>2</tpIntegra>
</card>
```

Não implementado neste GOAL.

**Não fail-close** débito/crédito comercial. Não fail-close emissão 03/04 neste GOAL (comportamento inalterado). O gap é o grupo, fechável no próximo slice com `tpIntegra=2` apenas.

**Residual relacionado (não implementar agora):** YA04-10 também exige `card` para tPag **17** (PIX dinâmico). O GOAL 077 emite 17 sem grupo. Fora deste slice; não misturar com carnê/aPrazo.

---

## 15. Dados faltantes

Para um grupo `card` **completo** (`tpIntegra=1`): TEF/adquirente real → CNPJ da instituição, `tBand` observado, `cAut` retornado, opcionalmente `idTermPag` da adquirente.

Para o **contrato mínimo sem TEF** (próximo slice): nenhum dado novo do operador. O servidor deriva `tpIntegra=2` da evidência de fluxo já auditada. Falta só **persistir essa decisão no handoff** e **emitir o elemento**.

Ainda não capturado (e não necessário ao mínimo): tabela oficial de `tBand` em bytes (Portal Diversos); CNPJ da instituição por maquininha; serial de terminal; NSU; e2eid.

---

## 16. Arquitetura recomendada

Separar explicitamente:

**A. Pagamento comercial atual** — PDV, Caixa, taxas, `maquininhaId` local, `paymentBreakdown`. Continua dono de valor e forma interna. **Não** vira TEF.

**B. Evidência fiscal mínima** — `fiscalPaymentHandoff` + `pagamentoFiscal` + XML. Consome só o que a venda persistiu. Para cartão, o mínimo honesto é tPag 03/04 + grupo `{tpIntegra:2}`. Filhos YA05/YA06/YA07 ausentes até evidência.

**C. Futura integração TEF/adquirente** — motor de pagamento **fora** do Fiscal. Só então `tpIntegra=1` e o preenchimento de YA05/YA07 (e `tBand` se a adquirente devolver bandeira). Fiscal **não** executa captura, webhook, PAN, CVV, token.

Fiscal não vira motor de pagamento.

---

## 17. Próximo slice mínimo (proposta; não implementar aqui)

Se os fatos desta auditoria forem aceitos:

| Campo tipado | Origem | Autoridade | Persistência | XML |
|---|---|---|---|---|
| `tpIntegra: "2"` nas linhas `cartaoDebito` / `cartaoCredito` do handoff | derivado no **servidor** (`upsertVendaInTransaction` / `buildFiscalPaymentHandoff`) a partir da forma 03/04 no fluxo POS-manual já congelado | **não** o cliente; **não** o `maquininhaId` | JSONB aditivo no handoff v1 (campo novo nas linhas), **sem schema** | `<card><tpIntegra>2</tpIntegra></card>` só nesses `detPag` |
| `CNPJ` / `tBand` / `cAut` / `idTermPag` / NSU | — | — | não | omitir |
| `maquininhaId` | permanece na UI | comercial | **não** no handoff Fiscal | não |

Camada B consome o handoff; o XML deixa de omitir `card` em 03/04. Testes: débito/crédito passam a conter exatamente `tpIntegra=2` e **nenhum** CNPJ/`tBand`/`cAut`. Split, dinheiro, PIX, vale, carnê/aPrazo inalterados. Venda comercial inalterada.

**Fora do próximo slice:** SDK, TEF, captura, webhook, PAN/CVV/token, picker de bandeira, carnê/aPrazo, H-9/H-10, schema.

Se a evidência for rejeitada: manter omissão do grupo e registrar que YA04-10 (NFC-e 65) permanece gap.

---

## 18. Arquivos

**Criados:** este relatório.

**Alterados:** ADR-0023 (adendo 085); `docs/ai/CURRENT_STATUS.md` (capacidade Fiscal de cartão redescrita).

**Não tocados:** PaymentModal, finalizeSale, upsert, handoff runtime, XML builder, schema/migrations, Caixa, Financeiro, adquirência, H-9/H-10, #73, provider SEFAZ.

---

## 19. Testes / validações

GOAL de auditoria: regressão dos testes já existentes de payment/handoff/XML (sem novos casos de implementação).

- `vitest` payment/handoff/`pdv-payments`: **143 passed** (6 files).
- `vitest` `nfce-xml-builder.test.ts`: **57 passed** (após `prisma generate` local só para o runner; **não** commitado).
- Typecheck: isento (sem `.ts`/`.tsx` neste GOAL).
- `git diff --check` na documentação: limpo.

Zero chamada a adquirente. Zero chamada SEFAZ.

---

## 20. Revisão independente

Outra família (GPT) revisou o relatório contra o código e as NTs. **PASS** nos eixos 2–10 (tpIntegra, CNPJ, tBand, cAut, POS×TEF, zero invenção, zero obrigação exagerada de YA05 para `tpIntegra=2`, Fiscal ≠ pagamento, zero schema/integração).

**Nits absorvidos neste documento (eixos 1 e 11):**

- YA04-20: msg **768** só na NT 2023.004 v1.00; msg **vigente consolidada = 963**.
- NT 2023.004: ECONF separado em versões posteriores — não é autoridade deste GOAL.
- NT 2025.001: citar v1.03 vigente; YA04-10 permanece o da v1.02.
- NSU: não mapear automaticamente; só com prova de que o valor **é** o identificador de autorização.
- YA11: texto oficial = identificar o terminal; não exigir serial de adquirente. `maquininhaId` local continua insuficiente.

Após as correções: classificação **A** (não D). O núcleo (POS = `tpIntegra=2`; não inventar YA05/tBand/cAut; próximo contrato mínimo) **não mudou**.

---

## 21–25. Git / schema / #73 / SEFAZ

Commit documental. PR Draft contra `main`. Schema = zero. #73 intacta. Zero adquirente/SEFAZ. H-9/H-10 intocados.

---

## 26. Classificação

**A** — requisitos oficiais (F1–F5) e capacidade real (fluxo §8–10) mapeados; próximo contrato mínimo definido **sem invenção** (`tpIntegra=2` apenas).

Não é D: nenhum dado de cartão foi fabricado, nenhum CNPJ de loja proposto como YA05, nenhum `tpIntegra=1` presumido, nenhuma captura sensível, nenhuma integração.

Residual consciente (não rebaixa a A): (i) texto residual “opcional a critério da UF” ainda colado na YA04-10 da NT 2025.001, resolvido pela coluna Aplic.=Obrig. + §02.7 + adiamento **somente** do modelo 55; (ii) tabela `tBand` vigente não foi snapshotada (não será emitida); (iii) lag de autorizador por UF não sondado (proibido neste GOAL); (iv) PDF integral da NT 2025.001 **v1.03** não foi relido — deltas públicos não tocam YA04-10.
