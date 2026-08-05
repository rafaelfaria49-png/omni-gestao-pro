---
title: Decisões Arquiteturais (ADRs) — OmniGestão Pro
status: vivo
owner: produto/arquitetura
last_update: 2026-08-04
---

# 🧭 Decisões Arquiteturais — Índice oficial

> **Fonte da verdade** para todas as decisões arquiteturais e de produto do OmniGestão Pro.
> **Protocolo:** `docs/governance/AUDIT_PROTOCOL.md` (auditorias geram ADR quando há decisão) e `docs/governance/SPRINT_PROTOCOL.md` (sprints implementam ADR).
> **Template oficial:** [`TEMPLATE_ADR.md`](./TEMPLATE_ADR.md).

---

## 1. Convenções

### 1.1 Naming

```
ADR-<NNNN>-<slug-kebab-case>.md

Exemplos:
  ADR-0001-os-route-oficial.md
  ADR-0002-marketplace-adapter-interface.md
  ADR-0003-storeid-logsauditoria.md
```

- `<NNNN>` é sequencial global do projeto (4 dígitos), sem reset.
- `<slug>` é curto, em kebab-case, descreve o tema.
- Datas no front matter (não no nome).

### 1.2 Status possíveis

| Status | Significado |
|---|---|
| `proposta` | Em discussão, ainda não decidida |
| `aceita` | Decidida — vigente |
| `superada` | Substituída por outro ADR (`superado_por` aponta) |
| `rejeitada` | Foi proposta e descartada (mantida como referência) |
| `depreciada` | Foi aceita um dia mas não vale mais (sem substituto direto) |

### 1.3 Quando criar um ADR

- Decisão arquitetural com **impacto > 1 arquivo** ou que **muda contrato** entre módulos.
- Escolha entre alternativas reais (não há "óbvio").
- Decisão que **outras IAs/devs precisarão entender** sem perguntar.
- Trade-off explícito (escolhi A em vez de B, sabendo dos custos).

**Não criar ADR para:**
- Microajuste cosmético.
- Decisão local de implementação que cabe num comentário.
- "Vou usar `useState` em vez de `useReducer`" (a menos que vire padrão).

### 1.4 Imutabilidade

- ADR aceito **não é editado** depois — exceto para mudar `status` (para `superada`, `depreciada`).
- Mudança de direção → **novo ADR** referenciando o anterior em `substitui:`.

---

## 2. Como criar um ADR novo

```bash
# 1. Pegue o próximo número (olhe o maior NNNN deste index e some 1)
# 2. Copie o template
cp docs/decisions/TEMPLATE_ADR.md docs/decisions/ADR-<NNNN>-<slug>.md
# 3. Preencha front matter + 8 seções
# 4. Adicione linha neste INDEX.md (tabela §3)
# 5. Atualize ADRs relacionados (campo "Referências")
# 6. Commit: docs(adr): ADR-<NNNN> · <título>
```

**Quem cria:** geralmente Opus (após discussão), Sonnet se a decisão é técnica pura.
**Quem aprova:** humano dono do projeto (mudança de status de `proposta` → `aceita`).

---

## 3. Índice de ADRs

| # | Título | HUB | Status | Data | Arquivo |
|---|--------|-----|--------|------|---------|
| 0001 (legado) | Rota Oficial de Operações de Serviço | Operações | ✅ Decidido | 2026-05-15 | [`OS_ROUTE_OFICIAL.md`](./OS_ROUTE_OFICIAL.md) |
| 0002 | Congelamento do Skill Front Matter v1 até pós-piloto | cross / governance | ✅ Aceita | 2026-05-27 | [`ADR-0002-skill-front-matter-v1.md`](./ADR-0002-skill-front-matter-v1.md) |
| 0003 | Eliminar fallback `LEGACY_PRIMARY_STORE_ID` em leituras de API | multi_loja | ✅ Aceita | 2026-05-29 | [`ADR-0003-eliminar-fallback-legacy-primary-store-id.md`](./ADR-0003-eliminar-fallback-legacy-primary-store-id.md) |
| 0004 | SAFE-lite como modo padrão; Engine de 17 fases como modo pesado reservado | governança | ✅ Aceita | 2026-05-30 | [`ADR-0004-safe-lite-modo-padrao.md`](./ADR-0004-safe-lite-modo-padrao.md) |
| 0006 | Roteamento WhatsApp multi-loja por `phone_number_id` (fim do webhook single-store) | whatsapp / multi_loja | ✅ Aceita | 2026-06-01 | [`ADR-0006-whatsapp-router-multi-loja.md`](./ADR-0006-whatsapp-router-multi-loja.md) |
| 0007 | Modelo de Depósitos (multi-depósito por loja) — fundação de saldo segmentado | estoque / multi_loja | ✅ Aceita | 2026-06-01 | [`ADR-0007-modelo-depositos.md`](./ADR-0007-modelo-depositos.md) |
| 0008 | Arquitetura oficial do módulo Fiscal (satélite pós-commit · snapshot imutável · provider-agnóstico) | cross / fiscal | ✅ Aceita | 2026-06-24 | [`ADR-0008-fiscal-architecture.md`](./ADR-0008-fiscal-architecture.md) |
| 0009 | Cofre de segredos fiscais (A1/senha/CSC por referência · EnvVault piloto → KmsStorageVault produção) | cross / fiscal | ✅ Aceita | 2026-06-24 | [`ADR-0009-fiscal-secret-vault.md`](./ADR-0009-fiscal-secret-vault.md) |
| 0010 | Validação XSD fiscal em worker containerizado com `xmllint` provisionado (opção B2) | cross / fiscal | ✅ Aceita | 2026-07-14 | [`ADR-0010-validacao-xsd-worker-containerizado-xmllint-provisionado.md`](./ADR-0010-validacao-xsd-worker-containerizado-xmllint-provisionado.md) |
| 0011 | Assinatura XMLDSig da NFC-e em RSA-SHA1/SHA-1 — **imposta** pelo schema oficial (`fixed`), confinada à assinatura fiscal | cross / fiscal | ✅ Aceita | 2026-07-14 | [`ADR-0011-assinatura-xmldsig-nfce-rsa-sha1-imposta-pelo-schema.md`](./ADR-0011-assinatura-xmldsig-nfce-rsa-sha1-imposta-pelo-schema.md) |
| 0012 | Cobertura de ST no motor fiscal — CSOSN 500 (substituído) mínimo, matriz origem 0–8, fail-closed; 201/202/203/900 e CST bloqueados | cross / fiscal | ✅ Aceita | 2026-07-22 | [`ADR-0012-st-csosn-500-motor-tributario.md`](./ADR-0012-st-csosn-500-motor-tributario.md) |
| 0013 | Redefinição do gate executável do dry-run fiscal — 11 itens auferíveis com autoridade e evidência | cross / fiscal | ✅ Aceita | 2026-07-22 | [`ADR-0013-redefinicao-gate-executavel-dry-run.md`](./ADR-0013-redefinicao-gate-executavel-dry-run.md) |
| 0014 | Supabase Vault como backend KMS do cofre fiscal de produção (complementa ADR-0009 D3) | cross / fiscal | ✅ Aceita | 2026-07-22 | [`ADR-0014-supabase-vault-backend-kms-fiscal.md`](./ADR-0014-supabase-vault-backend-kms-fiscal.md) |
| 0015 | Integração direta com a SEFAZ na homologação inicial (resolve Gate G-F5) | cross / fiscal | ✅ Aceita | 2026-07-22 | [`ADR-0015-sefaz-direta-homologacao-inicial.md`](./ADR-0015-sefaz-direta-homologacao-inicial.md) |
| 0016 | SP e Matriz RafaCell como escopo da primeira homologação NFC-e (resolve Gate G-F5.1) | cross / fiscal | ✅ Aceita | 2026-07-22 | [`ADR-0016-piloto-homologacao-sp-matriz-rafacell.md`](./ADR-0016-piloto-homologacao-sp-matriz-rafacell.md) |
| 0017 | Estado incerto e reconciliação obrigatória antes de retransmitir | cross / fiscal | ✅ Aceita | 2026-07-23 | [`ADR-0017-estado-incerto-reconciliacao-por-chave.md`](./ADR-0017-estado-incerto-reconciliacao-por-chave.md) |
| 0018 | Persistência legal do XML assinado/autorizado e do protocolo NFC-e (coluna primária · imutável · espelho opcional) | cross / fiscal | ✅ Aceita | 2026-07-23 | [`ADR-0018-persistencia-legal-xml-e-protocolo.md`](./ADR-0018-persistencia-legal-xml-e-protocolo.md) |
| 0019 | Numeração server-side de vendas por loja e ano | pdv / multi_loja | ✅ Aceita | 2026-07-30 | [`ADR-0019-numeracao-server-side-vendas.md`](./ADR-0019-numeracao-server-side-vendas.md) |
| 0020 | Fronteira do Provider SEFAZ Direto e Estado Incerto (P2-only · REGISTRY sem `SEFAZ_DIRETO` · `PROCESSING`/`THROTTLED`) | cross / fiscal | ✅ Aceita | 2026-08-04 | [`ADR-0020-fronteira-provider-sefaz-direto-estado-incerto.md`](./ADR-0020-fronteira-provider-sefaz-direto-estado-incerto.md) |
| 0021 | Identidade técnica (`clientSaleId`) × número comercial (`pedidoId`) da venda · replay por `(storeId, clientSaleId)` · gate de runtime fail-open para o writer v1 | pdv / multi_loja | ✅ Aceita | 2026-08-04 | [`ADR-0021-identidade-tecnica-e-numero-comercial-da-venda.md`](./ADR-0021-identidade-tecnica-e-numero-comercial-da-venda.md) |

> **Nota sobre o ADR legado:** `OS_ROUTE_OFICIAL.md` foi escrito antes desta convenção e não segue o template/naming atual. Mantido como histórico. Quando precisar ser referenciado, citar como **ADR-0001 (legado)**. Migração para o naming `ADR-0001-os-route-oficial.md` é uma tarefa **opcional** e exige autorização (renomear histórico pode quebrar links externos).

---

## 4. ADRs propostos (em discussão, ainda não decididos)

| # | Título | HUB | Proponente | Data |
|---|--------|-----|------------|------|
| 0005 (draft) | Liberação controlada do modo COWORK (Fase 1 supervisionada) | governança | Opus | 2026-06-01 |

> **0005 (CoWork)** vive como draft em [`drafts/ADR_PROPOSAL_0005_LIBERAR_COWORK.md`](./drafts/ADR_PROPOSAL_0005_LIBERAR_COWORK.md) (aguarda decisão humana). **0006 (WhatsApp)** foi **aceito** no Gate #2 da sprint `MULTI_LOJA-S-003` (ver §3). **0007 (Depósitos)** foi **aceito** no Gate #1 em 2026-06-01 (decisão); **Fase 1 (Fundação) implementada** em 2026-06-02 (`SPRINT_BL07_FASE1`, validada `tsc`/`build`/vitest) — ver **Adendo §9** do ADR (reconciliação as-built: `ProdutoDeposito`≡`EstoqueSaldo`, `principal`≡`isDefault`; `custoMedio`/`tipo`/`depositoId@ledger` diferidos p/ Fase 2/3). Cutover (`db:push`+backfill) pendente. O número `0006` decorre de `0005` já estar reservado ao CoWork (não se renumera histórico publicado).

---

## 5. ADRs superados / depreciados

| # | Título | Status | Superado por |
|---|--------|--------|--------------|
| — | — | — | — |

---

## 6. Atalhos por HUB

> Quando houver ADRs suficientes, organizar por HUB aqui.

- **Operações/OS:** ADR-0001 (legado)
- **PDV:** ADR-0019 (numeração server-side por loja/ano) · ADR-0021 (identidade técnica × número comercial da venda — aceita)
- **Financeiro:** —
- **Estoque:** ADR-0007 (modelo de depósitos — aceita)
- **Marketplace:** —
- **CRM:** —
- **WhatsApp:** ADR-0006 (router multi-loja por `phone_number_id` — aceita)
- **Marketing IA:** —
- **Omni Agent:** —
- **BI:** —
- **Multi-loja:** ADR-0003 (eliminar fallback `loja-1`) · ADR-0006 (router WhatsApp — aceita) · ADR-0007 (modelo de depósitos — aceita) · ADR-0019 (numeração de vendas por loja/ano) · ADR-0021 (`clientSaleId` único por loja — aceita)
- **Fiscal:** ADR-0008 (arquitetura oficial do módulo Fiscal — aceita) · ADR-0009 (contrato do cofre fiscal — aceita) · ADR-0010 (validação XSD em worker containerizado — aceita) · ADR-0011 (assinatura XMLDSig em RSA-SHA1/SHA-1, imposta pelo schema — aceita) · ADR-0012 (ST/CSOSN 500 no motor tributário — aceita) · ADR-0013 (gate executável do dry-run — aceita) · ADR-0014 (Supabase Vault em produção — aceita) · ADR-0015 (SEFAZ direta na homologação — aceita) · ADR-0016 (piloto Matriz/SP — aceita) · ADR-0017 (estado incerto/reconciliação — aceita) · ADR-0018 (persistência legal XML + protocolo — aceita) · ADR-0020 (fronteira provider SEFAZ direto / P2-only / estado incerto — aceita)
- **Governança:** ADR-0002 (congelamento Skill Front Matter v1) · ADR-0004 (SAFE-lite modo padrão)

---

## 7. Anti-padrões em ADRs

- ADR sem alternativa real considerada (vira "registrei o que ia fazer").
- ADR sem trade-off explícito (vira ata, não decisão).
- ADR editado depois de aceito (perde imutabilidade).
- ADR sem referência cruzada (vira ilha).
- Decisão importante sem ADR (vira tribal knowledge — morre quando o autor sai).
- Múltiplas decisões no mesmo ADR (vira documento confuso — quebrar em N).

---

## 8. Fonte da verdade

- **Convenção e índice de ADRs** → este arquivo.
- **Template** → [`TEMPLATE_ADR.md`](./TEMPLATE_ADR.md).
- **Quando criar ADR** → este arquivo §1.3.
- **Como criar ADR** → este arquivo §2.
