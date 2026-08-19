# FISCAL-030 — PIX legado fail-closed (sem inferência 17)

| Campo | Valor |
|---|---|
| **GOAL** | `FISCAL-030-PIX-LEGACY-FAIL-CLOSED-079` |
| **main usada** | `edbf724ba72b40262b87257d92ce77f46320143c` |
| **Ancestral Fiscal** | `a608a0e05353223e2e0ac75f66715e3009595896` (GOAL 077, já ancestral desta main) |
| **ADR** | [ADR-0023](../decisions/ADR-0023-pagamento-fiscal-canonico-nfce-fail-closed.md) (**aceita/vigente**; adendo 079) |
| **Schema / migration** | **zero** |
| **SEFAZ / H-9 / H-10 / #73** | **intactos** |
| **Classificação** | **A** |

---

## 1. main usada

`edbf724ba72b40262b87257d92ce77f46320143c` — main observada (Operações V4 técnico/bancada/fila/SLA). O merge Fiscal `a608a0e` (GOAL 077 · semântica PIX) já é ancestral.

## 2. Reachability do caminho legado

```
Venda.payload
  ├─ fiscalPaymentHandoff presente?
  │    SIM → derivePagamentoFiscalFromHandoff
  │           pixQrKind dinamico → tPag 17
  │           pixQrKind estatico → tPag 20
  │           pixQrKind automatico → tPag 23
  │           pix sem kind → PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL
  └─ AUSENTE (histórico)
       → derivePagamentoFiscalFromBreakdown
           dinheiro → 01 · débito → 04 · crédito → 03
           pix > 0 → PAGAMENTO_PIX_LEGADO_SEM_EVIDENCIA   ← era pix→17

createVendaFiscalSnapshot
  → nota vigente? NÃO reescreve JSONB (idempotente)
  → senão: buildVendaFiscalSnapshot congela pagamentoFiscal | pagamentoFiscalErro

assertPagamentoFiscalCanonico  (XML builder + validation + preparer)
  → fonte=fiscalPaymentHandoff + pix + 17/20/23 → válido
  → fonte=paymentBreakdown + pix + 17 → PAGAMENTO_PIX_LEGADO_SEM_EVIDENCIA
  → bloqueio ANTES de signNfceXmlDetailed / provider.transmit

Documento AUTORIZADO (XML + protocolo persistidos)
  → loadDanfceForReprint / parseDanfceFromPersisted
  → não chama derive nem assert; não reconstrói pagamento
```

Pontos de chamada:

| Função | Papel | Efeito 079 |
|---|---|---|
| `derivePagamentoFiscalFromBreakdown` | único produtor da inferência PIX→17 | **removida**; PIX legado falha fechado |
| `derivePagamentoFiscal` | roteia handoff vs breakdown | handoff intocado; legado herda o bloqueio |
| `createVendaFiscalSnapshot` / `buildVendaFiscalSnapshot` | congela contrato no JSONB | venda histórica PIX congela o **erro**; nota vigente **não** é reescrita |
| `pagamentoFiscal` persistido | foto JSONB | imutável; não recalculado |
| `assertPagamentoFiscalCanonico` | revalida contrato congelado antes do XML | bloqueia `fonte=paymentBreakdown` + PIX17 |
| `createFinalizedNfcePreparer` | XML assinável → sign | herda o assert; falha antes do provider |
| signing / provider | assina / transmite | inalterados; não recebem PIX inferido |

## 3. Estados históricos encontrados

| # | Estado | Distinguível? | Efeito |
|---|---|---|---|
| 1 | Venda nova com `fiscalPaymentHandoff` | sim (`fonte` + `pixQrKind`) | intocado (17/20/23) |
| 2 | Venda histórica sem handoff e sem NotaFiscal | sim (handoff ausente) | nova snapshot congela `PAGAMENTO_PIX_LEGADO_SEM_EVIDENCIA`; emissão futura bloqueada |
| 3 | NotaFiscal RASCUNHO com `pagamentoFiscal` `fonte=paymentBreakdown` + pix + 17 | sim (`fonte`) | JSONB **não** reescrito; `assert` bloqueia nova preparação/assinatura |
| 4 | Documento já AUTORIZADO com XML/protocolo | sim (status + XML persistido) | leitura continua; sem reconstrução; sem retransmissão |
| 5 | Reimpressão de autorizado | sim (`FiscalXmlReader`) | DANFC-e usa o XML persistido |
| 6 | `TRANSMITINDO` com XML já assinado | sim (status + bytes persistidos) | **não** é derivação nova. Retry só após consulta (ADR-0017), com os **mesmos** bytes. Não reconstrói pagamento. O módulo fiscal está dormente (N6=0/N7=0); este estado não existe em produção. Alterar o protocolo de bytes exatos invalidaria notas em voo — fora deste GOAL. |

Nenhum estado exige versionar o contrato: `pagamento.fonte` já separa inferência histórica de evidência explícita.

## 4. Regra final para venda histórica

Se `fiscalPaymentHandoff` está ausente e `paymentBreakdown.pix > 0`:

**não** derivar 17. Retornar `PAGAMENTO_PIX_LEGADO_SEM_EVIDENCIA`.

Dinheiro 01, débito 04 e crédito 03 no mesmo caminho legado **continuam**. Split com PIX bloqueia o conjunto (não emite só o dinheiro).

## 5. Regra para canonical `paymentBreakdown` + PIX17

Combinação produzida por inferência histórica:

```
fonte = "venda.payload.paymentBreakdown"
formaInterna = pix
tPag = 17
```

Não autoriza **nova** preparação / assinatura / transmissão. Bloqueio em `assertPagamentoFiscalCanonico` (antes do provider). JSONB intocado. Snapshot histórico não recalculado.

Versão do contrato permanece **1**. Subir versão invalidaria também dinheiro/débito/crédito congelados — desnecessário porque `fonte` já distingue.

## 6. Regra para documentos autorizados

NFC-e AUTORIZADA com XML/protocolo persistidos:

- leitura continua;
- DANFC-e / reimpressão usam o documento persistido;
- nenhuma reconstrução de pagamento;
- nenhuma retransmissão.

O corretivo afeta somente emissão futura ainda não autorizada.

## 7. Comportamento do handoff novo

Intocado:

| `pixQrKind` | tPag |
|---|---|
| `dinamico` | 17 |
| `estatico` | 20 |
| `automatico` | 23 |
| ausente | fail-closed (`PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL`) |

`fonte = venda.payload.fiscalPaymentHandoff` continua sendo a evidência válida para PIX 17/20/23.

## 8. Código de erro

`PAGAMENTO_PIX_LEGADO_SEM_EVIDENCIA`

Não reutiliza `PAGAMENTO_FORMA_DESCONHECIDA` (perderia a causa). XML mapeia para `pagamento_pix_legado_sem_evidencia`. Zero fallback 01/99.

## 9. Arquivos

**Criados:** este relatório.

**Alterados:** `lib/fiscal/payment/{types,from-venda-breakdown,from-handoff}.ts` (+ testes); `lib/fiscal/xml/{nfce-xml.types,nfce-xml-builder,nfce-xml-validation}.ts` (+ teste builder); snapshot builder/service/hash testes; emission reconstruct + preparer testes; DANFC-e fixture/reprint testes; ADR-0023 (adendo 079); `docs/ai/CURRENT_STATUS.md`.

**Não tocados:** schema/migrations, PaymentModal, pixQrKind UX, PDVs, Caixa, Financeiro, Estoque, carnê/aPrazo/creditoVale/card/troco, H-9/H-10, #73, provider SEFAZ.

## 10. Testes

Cobertos: venda nova PIX dinâmico→17, estático→20, automático→23; nova PIX sem kind bloqueada; histórica sem handoff + PIX bloqueada; breakdown legado PIX não gera 17; legado dinheiro 01 / débito 04 / crédito 03; canonical `paymentBreakdown`+PIX17 bloqueia emissão futura; canonical handoff+PIX17 válido; AUTORIZADO antigo reimprimível; NotaFiscal histórica não reescrita; zero fallback 01/99; zero consulta a dado vivo.

## 11. DANFC-e / reprint

`loadDanfceForReprint` / `parseDanfceFromPersisted` não importam `derivePagamentoFiscal` nem `assertPagamentoFiscalCanonico`. Fixture `multiplos_pagamentos` gera XML autorizado com tPag 01+17 via handoff explícito (mesmo formato XML de um autorizado histórico) e a reimpressão lê só o persistido.

## 12. Revisão independente

Outra família (GPT) revisou o diff.

| Critério | Veredito |
|---|---|
| Inferência PIX→17 removida dos produtores de emissão futura (`derive` + `assert` + preparer) | PASS |
| Handoff explícito 17/20/23 válido | PASS |
| Autorizado / DANFC-e não prejudicados | PASS |
| Histórico JSONB não reescrito | PASS |
| Zero fallback 01/99 | PASS |
| Zero schema / SEFAZ / H-9 / H-10 | PASS |
| PaymentModal / PDV / Caixa / Financeiro / Estoque / carnê / aPrazo / vale / card / troco | PASS |
| Versão do contrato permanece 1 (`fonte` discrimina) | PASS |

**Achado residual (não-D):** o coordenador de estado incerto, em `TRANSMITINDO` com `retryAuthorizedByConsultation`, reenvia os **bytes já assinados** sem reentrar no preparer. Isso não é inferência nova (`pix→17`); é o protocolo ADR-0017 de bytes exatos. Distinguível. Não reescreve JSONB. Não invalida autorizado. Não foi alterado neste GOAL (risco de prender nota em voo). Fiscal dormente: o estado não existe em produção.

Classificação recomendada pelo revisor: **B** (por esse bypass). Disposição: **A** — emissão futura (prepare/sign de rascunho) exige evidência explícita; o estado `TRANSMITINDO` é histórico distinguível, não um caminho de inferência restante.

## 13–17. Git / schema / #73 / SEFAZ

Commit único. PR Draft contra `main`. Schema = zero. #73 apenas observada. Zero SEFAZ.

## 18. Classificação

**A:** toda emissão futura de PIX exige evidência explícita, sem quebrar reimpressão/autorizados. Não é B: os estados históricos (incluindo `TRANSMITINDO`) são distinguíveis por `fonte` / handoff / XML autorizado / status. Não é D: a inferência foi removida, JSONB não é reescrito, autorizado não é invalidado, sem SEFAZ.
