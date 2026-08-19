# FISCAL-030 — Semântica fiscal do PIX (captura `pixQrKind`)

| Campo | Valor |
|---|---|
| **GOAL** | `FISCAL-030-PIX-SEMANTICS-CAPTURE-077` |
| **main usada** | `97a9f0f4e8a42c859868034a5dfad20a3107a865` |
| **Ancestral Fiscal** | `36cf894eec68f8720977de633ca7e3c92a1e02e8` (PR #84, GOAL 075) — já ancestral desta main |
| **ADR** | [ADR-0023](../decisions/ADR-0023-pagamento-fiscal-canonico-nfce-fail-closed.md) (**aceita/vigente**; adendo 077) |
| **Schema / migration** | **zero** |
| **SEFAZ / H-9 / H-10 / #73** | **intactos** |
| **Classificação** | **A** |

---

## 1. main usada

`97a9f0f4e8a42c859868034a5dfad20a3107a865` — main observada (merge OPS-V4 documentos + ancestral Fiscal `36cf894e` / PR #84).

Não foi necessário merge adicional: o handoff de origem (075) já estava no histórico.

## 2. Fontes oficiais

| Fonte | Versão | Data | O que prova |
|---|---|---|---|
| XSD `PL_010e_v1.02/NFe/leiauteNFe_v4.00.xsd` (repo) | PL_010e_v1.02 | leiaute 4.00 | `tPag` = `[0-9]{2}` (sem enum); grupo `card` `minOccurs=0`; o mesmo leiaute cobre NF-e 55 e NFC-e 65 |
| Informe Técnico 2024.002 | **v1.11** | publicação **04/03/2026**; teste **02/04/2026**; produção **04/05/2026** | tabela vigente de meios de pagamento dos DF-e; inclusão 23/24; observação do 20 |
| Informe Técnico 2024.002 | v1.00 | produção **01/07/2024** | item 17 passa a “Dinâmico”; inclusão do item 20 “Estático” |
| Portal Nacional da NF-e / ENCAT | — | citado pelo próprio IT | tabela em Documentos → Diversos (`www.nfe.fazenda.gov.br`) |

PDF conferido: `IT2024.002v1.11-Atualiza-Tabela-Meios-de-Pagamento-04032026` (cópia pública FENACON do informe ENCAT). A tabela de rótulos do DANFC-e **não** é autoridade.

## 3. Significado exato 17 / 20 / 23

| tPag | Descrição oficial (IT 2024.002) | Vigência | NFC-e mod. 65 |
|---|---|---|---|
| **17** | Pagamento Instantâneo (PIX) – **Dinâmico**. QR-Code dinâmico (ou URL dinâmica) gerado para a transação. | produção 01/07/2024 (v1.00) | mesmo `tPag` do leiaute 4.00 |
| **20** | Pagamento Instantâneo (PIX) – **Estático**. IT v1.11: PIX com QR Code estático, **ou chave Pix**, **ou agência e conta**. | produção 01/07/2024 (v1.00); observação ampliada v1.11 | idem |
| **23** | Pagamento Instantâneo (PIX) – **Automático**. Débito recorrente com autorização prévia (PIX Automático). | teste 02/04/2026 · produção **04/05/2026** (v1.11) | idem |

A distinção oficial **não** é “PIX vs transferência genérica” nem “iniciador PSP”: é QR dinâmico (17) vs QR estático / chave / conta (20) vs PIX Automático (23). Transferência por chave/conta cai em **20**, não em 17.

Grupo `card` (e2eid / CNPJ da instituição) permanece **fora deste GOAL** (cartão/troco não iniciados). XSD permite omitir `card`. UFs que rejeitam 17 sem `cAut` são gap residual documentado, não autorizado a fabricar e2eid.

## 4. Fluxo PIX atual (auditoria)

Nos PDVs ativos o PIX entra só pelo `PaymentModal` compartilhado:

- o operador informa **valor** PIX (linha de pagamento);
- o ícone `QrCode` é Lucide — **não** há QR gerado pelo OmniGestão;
- **não** há integração PSP/adquirente/PIX Copia-e-Cola automática;
- **não** há metadata de QR estático/dinâmico persistida antes deste GOAL;
- o PIX é **confirmado manualmente**;
- até `finalizeSaleTransaction` seguia só `paymentBreakdown.pix` (número);
- o inserto fiscal seguro é um discriminador **ao lado** do valor, sem alterar o valor.

`pix` genérico **não** equivale a tPag 17.

## 5. Capacidade real de distinção

O operador observa o ato do caixa:

- QR/chave/conta **fixos da loja** (várias vendas) → `estatico` → 20;
- QR/link **gerado agora com o valor desta venda** → `dinamico` → 17.

`automatico` (tPag 23) permanece no **contrato/servidor** (payload explícito), mas **não** é opção do PaymentModal: o PDV não opera PIX Automático BACEN. Oferecer 23 no caixa seria escolha enganosa.

Sem escolha, a venda comercial fecha e o Fiscal permanece fail-closed. Não há default silencioso. O limiar de “há PIX” reusa o epsilon monetário do modal (`> 0,02`), o mesmo das demais formas.

## 6. UX

Campo só quando soma PIX > 0,02 (epsilon do PDV). Duas opções observáveis no caixa (estático / dinâmico), em linguagem operacional (não “17/20/23” nus). Clique de novo desmarca. Microcopy: a venda fecha mesmo em branco; a NFC-e fica bloqueada. PIX Automático não é apresentado.

## 7. Contrato `pixQrKind`

```
"dinamico" | "estatico" | "automatico"
```

Mapeamento só no servidor: `dinamico→17`, `estatico→20`, `automatico→23` (`lib/fiscal/payment/pix-qr-kind.ts`). Versão do handoff permanece **1** (campo aditivo na linha).

## 8. Propagação até a Venda

PaymentModal `meta.pixQrKind`
→ PDVs ativos (clássico, supermercado, assistência, venda completa ×2, Black)
→ `finalizeSaleTransaction({ pixQrKind })`
→ `SaleRecord.pixQrKind` (só se `pix > 0`)
→ `upsertVendaInTransaction`
→ `buildFiscalPaymentHandoff(breakdown, total, { pixQrKind })`
→ `Venda.payload.fiscalPaymentHandoff` + `payload.pixQrKind`

O cliente **não** envia tPag. `tPag` e `fiscalPaymentHandoff` injetados são ignorados/reconstruídos.

## 9. Handoff server-side

- `pixQrKind` conhecido + PIX > 0 → `capability=supported`, `tPag` do catálogo;
- PIX sem discriminador → bloqueado `pix_subtipo_nao_discriminado`;
- discriminador desconhecido → bloqueado `pix_qr_kind_desconhecido`;
- dinheiro 01 / débito 04 / crédito 03 inalterados;
- carnê / aPrazo / creditoVale continuam bloqueados.

## 10. XML resultante

Handoff com `estatico` → `<tPag>20</tPag>` + `vPag`; sem `<card>`; nunca fallback `01`/`99`.
`dinamico` → 17; `automatico` → 23. Snapshot legado sem handoff preserva PIX→17 do GOAL 073.

## 11. Split

PIX + dinheiro e PIX + cartão: cada linha deriva o próprio tPag; o conjunto só emite se **todas** as linhas tiverem capacidade. PIX sem `pixQrKind` no split bloqueia o Fiscal sem cortar o dinheiro/cartão comercial.

## 12. Compatibilidade legado

Vendas/snapshots históricos sem `pixQrKind`/handoff **não** são reclassificados. Fingerprint de replay ignora `pixQrKind` e o handoff (fatos comerciais inalterados).

## 13. Arquivos

**Criados:** `lib/fiscal/payment/pix-qr-kind.ts` (+ teste), este relatório.

**Alterados:** catálogo tPag; `from-handoff` / `from-venda-breakdown`; `fiscal-payment-handoff`; `ops-upsert-venda`; `operations-store` / `operations-sale-types`; `PaymentModal` + 6 PDVs; testes de snapshot/XML/fingerprint/upsert; ADR-0023; `docs/ai/CURRENT_STATUS.md`.

**Não tocados:** schema/migrations, Caixa valores, Financeiro engine, estoque, TEF, H-9/H-10, #73, provider SEFAZ, carnê/aPrazo/vale/cartão/troco.

## 14. Testes

Cobertos: venda sem PIX; PIX sem discriminador; 17/20/23; discriminador inválido; injeção de tPag; split PIX+dinheiro e PIX+cartão; persistência no payload; handoff; snapshot; XML; zero fallback 01/99; venda comercial persiste com PIX fiscalmente bloqueado; regressão dos PDVs (não montam o handoff).

`vitest` focado: **225 passed** (payment/handoff/snapshot/XML/dry-run/upsert) + regressões PDV. `npm run typecheck` ✅. ESLint focado: 0 errors. `git diff --check` limpo.

## 15. Revisão independente

Outra família (GPT) revisou o diff. **PASS** em semântica 17/20/23, autoridade do servidor, fail-closed, pagamento comercial, demais formas, zero schema/SEFAZ, legado PIX→17. **Ajuste feito após o FAIL de UX:** PIX Automático foi retirado das opções do caixa (permanece só no contrato server-side). Nenhum risco D (sem default, sem tPag do cliente, sem mutação comercial). Classificação recomendada após o ajuste: **A**.

## 16–20. Git / schema / #73 / SEFAZ

Commit funcional. PR Draft contra `main`. Schema = zero. #73 apenas observada. Zero SEFAZ.

## 21. Classificação

**A:** semântica oficial comprovada; captura segura; PIX com `pixQrKind` válido passa ao handoff sem inferir o subtipo pela chave `pix`. Não é D: sem default, sem tPag do cliente, sem mudar cobrança/Caixa/Financeiro, fail-closed preservado na ausência.
