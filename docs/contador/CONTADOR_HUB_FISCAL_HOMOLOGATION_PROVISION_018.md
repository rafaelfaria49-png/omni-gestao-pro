# CONTADOR-018 — Provisionamento Postgres local + seed HOMOLOGACAO (estratégia B)

| Campo | Valor |
|---|---|
| Status | GOAL 018 **implementado e aberto** — `GOAL_018_OPENED=true` · `GOAL_018_STATUS=RUNNING` · `FISCAL_RUNTIME_VALIDATABLE=true` |
| Data | 2026-08-20 |
| Autorização | Rafael: homologação **B** + reader **A**; merge PR **#92**; implementação 018 sem Production, sem SEFAZ, sem schema |
| Auditoria | [`CONTADOR_HUB_FISCAL_HOMOLOGATION_READINESS_AUDIT_018.md`](./CONTADOR_HUB_FISCAL_HOMOLOGATION_READINESS_AUDIT_018.md) |
| ADR | ADR-CONTADOR-007 **Accepted** |
| Schema Prisma | **não alterado** (`prisma db push` só no DSN local) |

## Addendum — prova runtime do GOAL 018

O provisionamento B permanece. O GOAL 018 implementou o reader A e o fluxo completo no runtime local:

```
HOMOLOGATION_STRATEGY_SELECTED=B
PURE_READER_STRATEGY_SELECTED=A
GOAL_018_OPENED=true
SEFAZ_NETWORK_REQUIRED=false
PRODUCTION_REQUIRED=false
PRE_OPEN_NON_PRODUCTION_RUNTIME_REQUIRED=true
NON_PRODUCTION_RUNTIME_AVAILABLE=true
FISCAL_RUNTIME_VALIDATABLE=true
FISCAL_RUNTIME_VALIDATABLE_IS_ACCEPTANCE_GATE=true
PRODUCTION_XML_ELIGIBLE=false
SCHEMA_CHANGED=false
```

Fluxo comprovado (massa `homolog-contador-a` / competência `2026-07`):

Prisma → `lerNotasFiscais` (Opção A) → predicado ADR-007 → checklist (sinal fiscal) → `montarConteudoPacote` → `manifest.json` sha256 → `05-XML/{chave}.xml` (UTF-8 = `xmlAutorizado` persistido).

Resultado feliz: 1 AUTORIZADA/HOMOLOGACAO entregável; 1 REJEITADA (sinal); 1 CANCELADA (sinal, fora de 05-XML); PRODUCAO não entregável; loja B não vaza. FiscalLog=0. EventoFiscal=0. `MAX_ARQUIVOS_PACOTE=15` preservado (1 XML cabe; 3 XMLs falham sem truncar).

Flag `CONTADOR_FISCAL_READER` default off; allowlist `CONTADOR_FISCAL_READER_STORE_ALLOWLIST` env-only.

**Não fechar/ratificar o GOAL nesta entrega** — revisão independente pendente.

---

Este documento descreve o provisionamento da estratégia **B**. O reader A, o predicado, o checklist, o `05-XML` e o AEP `import`/`open` do 018 estão nesta mesma entrega (GOAL 018).

O bloco abaixo é o **estado histórico do provisionamento pré-018** (mantido para auditoria). O estado vigente está no addendum.

```
# histórico pré-018
GOAL_018_OPENED=false
FISCAL_RUNTIME_VALIDATABLE=false
FISCAL_RUNTIME_VALIDATABLE_IS_ACCEPTANCE_GATE=true
```

`FISCAL_RUNTIME_VALIDATABLE=true` passou a ser o aceite do GOAL 018 após a prova runtime (addendum). Continuam proibidos: `fiscalXmlReader.readAuthorizedDocument` as-is, alterações em `lib/fiscal/**` só para servir o Contador, e qualquer `FiscalLog` gerado pelo reader A.

---

## 1. Isolamento

| Proibido | Como o provisionamento recusa |
|---|---|
| Production / `DATABASE_URL` do app | Fonte **única**: `CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL` (default loopback). `resolveHomologationDatabaseUrl` **não lê** `DATABASE_URL`. |
| Host remoto (Supabase, Neon, Vercel, AWS/Azure/GCP, pooler) | só `127.0.0.1` / `localhost` / `::1` |
| Porta 6543 | recusada mesmo em localhost |
| Porta fora de `{54329, 5432}` | 54329 = Docker dedicado; 5432 = fallback nativo |
| Database local diferente de `omni_contador_fiscal_homolog` | recusado (inclui `postgres` / db de dev) |
| Role diferente de `omni_homolog` | recusado (inclui `postgres`) |
| SEFAZ / certificado A1 / emissão | seed grava texto de fixture; zero transporte |
| `fiscalXmlReader.readAuthorizedDocument` | módulo de homologação **não importa** `xml-storage-reader` |
| `FiscalLog` | seed não cria; prova SELECT exige `count = 0` |
| `EventoFiscal` sintético | política da auditoria §5 caso #5 — **não** fabricar |
| Abrir GOAL 018 | `GOAL_018_OPENED=false` nesta execução |

Lojas sintéticas: `homolog-contador-a` e `homolog-contador-b`. Não são loja de Production.

---

## 2. Como subir o Postgres

### Docker (preferido — efêmero, porta 54329)

```bash
npm run contador:fiscal-homolog:up
npm run contador:fiscal-homolog:provision
CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL=postgresql://omni_homolog:omni_homolog_local_only@127.0.0.1:54329/omni_contador_fiscal_homolog \
  npm run contador:fiscal-homolog:test
npm run contador:fiscal-homolog:down
```

Compose: [`docker-compose.contador-fiscal-homolog.yml`](../../docker-compose.contador-fiscal-homolog.yml) — bind `127.0.0.1:54329`, dados em **tmpfs**.

### Fallback nativo (sem Docker)

```bash
bash scripts/contador/ensure-local-postgres.sh
export CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL='postgresql://omni_homolog:omni_homolog_local_only@127.0.0.1:5432/omni_contador_fiscal_homolog'
npm run contador:fiscal-homolog:provision
npm run contador:fiscal-homolog:test
```

A senha `omni_homolog_local_only` é **só localhost**. Não reutilizar em Production.

---

## 3. O que o provisionamento faz

1. Recusa DSN remoto, database local que não seja `omni_contador_fiscal_homolog`, role ≠ `omni_homolog` e portas fora de `{54329, 5432}`.
2. Injeta `DATABASE_URL` **e** `DIRECT_URL` iguais ao DSN homolog **somente no subprocesso** de `prisma db push --skip-generate` (schema do repo inalterado).
3. Roda `scripts/contador/seed-fiscal-homolog.ts` com o mesmo DSN.
4. Seed idempotente: apaga notas/vendas/stores `homolog-contador-*` e recria 2 stores + 7 vendas + 7 `NotaFiscal`.

Código: [`lib/contador/homologation/`](../../lib/contador/homologation/).

---

## 4. Massa persistida (7 casos)

Competência de referência: `2026-07`. XML derivado de `VALID_NFCE_XML` (corpus XSD sintético, `tpAmb=2`). Persistido **como texto de coluna** — o Contador não reconstrói XML na leitura.

| Caso | `storeId` | Status / ambiente | `05-XML` futuro |
|---|---|---|---|
| `autorizada_homologacao_vigente_dhemi_ok` | A | AUTORIZADA / HOMOLOGACAO, `dhEmi` 2026-07-14 | **sim** (único entregável) |
| `autorizada_fora_competencia` | A | AUTORIZADA, `dhEmi` junho | não |
| `autorizada_dhemi_invalido` | A | AUTORIZADA, `dhEmi` ilegível | não |
| `rejeitada` | A | REJEITADA, XML sintético com 1 `dhEmi` + offset em 2026-07 (sem data fiscal válida o sinal não entra na competência; a prova exige `REJECTED_COUNT=1`) | não |
| `cancelada_sintetica_politica_negativa` | A | CANCELADA + XML histórico; **sem** `EventoFiscal` | não |
| `outra_storeId` | B | clone do entregável | não no reader da loja A |
| `producao_caso_negativo` | A | `ambiente=PRODUCAO` (coluna; XML de fixture `tpAmb=2`) | não nesta fase |

A linha PRODUCAO existe **só** como teste negativo (`PRODUCTION_XML_ELIGIBLE=false`). Não é documento de produção real.

A fixture `rejeitada` passou a carregar XML sintético HOMOLOGACAO com exatamente 1 `dhEmi` `2026-07-14T12:00:00-03:00` porque, após o fail-closed por competência, nota sem data fiscal válida **não** é atribuída ao mês consultado. Sem esse XML a prova `REJECTED_COUNT=1` quebraria. Não é Production; o reader **não** ganhou fallback para `dataAutorizacao`/`createdAt`.

---

## 5. Prova SELECT (opt-in)

[`lib/contador/homologation/provision.integration.test.ts`](../../lib/contador/homologation/provision.integration.test.ts) usa `describe.skip` sem a env. Com a env:

- 7 rows, isolamento A/B, `xmlAutorizado` byte-igual ao seed
- `FiscalLog` = 0 para essas lojas/notas
- `EventoFiscal` = 0
- não importa `xml-storage-reader`

Testes **sem banco** (`guard-url.test.ts`, `massa.test.ts`) rodam no `npm test` padrão.

---

## 6. Gate do GOAL 018 — o que falta vs o que já basta para import/open

Pre-open (já satisfeito depois deste provisionamento):

```
PRE_OPEN_NON_PRODUCTION_RUNTIME_REQUIRED=true
NON_PRODUCTION_RUNTIME_AVAILABLE=true
GOAL_018_OPENED=false
```

Aceite do 018 (ainda **false**; só o próprio GOAL implementa):

```
FISCAL_RUNTIME_VALIDATABLE=false
FISCAL_RUNTIME_VALIDATABLE_IS_ACCEPTANCE_GATE=true
```

Caminho ainda incompleto:

1. `lib/contador/readers/fiscal.ts` (Opção **A**, SELECT sem `FiscalLog`) — **GOAL 018**
2. Predicado ADR-007 no Contador
3. Checklist + package builder + `05-XML` com um XML no lugar de `LEIA-ME.md`
4. Flag `CONTADOR_FISCAL_READER` default off

Teto `MAX_ARQUIVOS_PACOTE=15` **não** foi alterado. Um XML no lugar do placeholder cabe; `relacao.csv` ou N XMLs não.

```
REMAINING_BLOCKERS=AEP_import_open_ainda_negado; teto_15_arquivos_antes_do_slice_N_xml_ou_relacao_csv; reader_predicado_checklist_05xml_sao_GOAL_018
```

---

## 7. Relatório desta execução

```
HOMOLOGATION_STRATEGY_SELECTED=B
PURE_READER_STRATEGY_SELECTED=A
PRE_OPEN_NON_PRODUCTION_RUNTIME_REQUIRED=true
NON_PRODUCTION_RUNTIME_AVAILABLE=true
FISCAL_RUNTIME_VALIDATABLE=false
FISCAL_RUNTIME_VALIDATABLE_IS_ACCEPTANCE_GATE=true
GOAL_018_OPENED=false
SEFAZ_NETWORK_REQUIRED=false
PRODUCTION_REQUIRED=false
SCHEMA_CHANGED=false
CODE_CHANGED=true
HOMOLOG_DB_NAME_GUARD=true
HOMOLOG_DB_ROLE_GUARD=true
```

**Fim do provisionamento. GOAL 018 permanece não importado / não aberto.**
