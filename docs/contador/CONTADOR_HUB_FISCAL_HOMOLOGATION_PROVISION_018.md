# CONTADOR-018 — Provisionamento Postgres local + seed HOMOLOGACAO (estratégia B)

| Campo | Valor |
|---|---|
| Status | Runtime **não-Production** provisionável — `GOAL_018_OPENED=false` · `GOAL_018_STATUS=DRAFT_NOT_IMPORTED` |
| Data | 2026-08-20 |
| Autorização | Rafael: homologação **B** + reader **A**; merge PR **#92**; **sem** Production, **sem** SEFAZ, **sem** abrir GOAL 018 |
| Auditoria | [`CONTADOR_HUB_FISCAL_HOMOLOGATION_READINESS_AUDIT_018.md`](./CONTADOR_HUB_FISCAL_HOMOLOGATION_READINESS_AUDIT_018.md) |
| ADR | ADR-CONTADOR-007 **Accepted** |
| Schema Prisma | **não alterado** (`prisma db push` só no DSN local) |

Este documento descreve o provisionamento da estratégia **B**. Não implementa `lib/contador/readers/fiscal.ts`, predicado, checklist, `05-XML` nem AEP `import`/`open`.

```
HOMOLOGATION_STRATEGY_SELECTED=B
PURE_READER_STRATEGY_SELECTED=A
GOAL_018_OPENED=false
SEFAZ_NETWORK_REQUIRED=false
PRODUCTION_REQUIRED=false
FISCAL_RUNTIME_VALIDATABLE=false
```

`FISCAL_RUNTIME_VALIDATABLE` permanece **false**: o caminho Prisma → `NotaFiscal` persistida existe, mas o reader Contador, o predicado ADR-007, o checklist e o slice `05-XML` **ainda não** existem. Fixtures unitárias continuam obrigatórias e **não** contam como validação de runtime.

`NON_PRODUCTION_RUNTIME_AVAILABLE=true` depois que o seed das 7 linhas for aplicado num Postgres **local** e o SELECT opt-in passar.

---

## 1. Isolamento

| Proibido | Como o provisionamento recusa |
|---|---|
| Production / `DATABASE_URL` do app | Fonte **única**: `CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL` (default loopback). `resolveHomologationDatabaseUrl` **não lê** `DATABASE_URL`. |
| Host remoto (Supabase, Neon, Vercel, pooler) | `assertLocalHomologationDatabaseUrl` — só `127.0.0.1` / `localhost` / `::1` |
| Porta 6543 | recusada mesmo em localhost |
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

1. Recusa DSN remoto.
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
| `rejeitada` | A | REJEITADA, sem `xmlAutorizado` | não |
| `cancelada_sintetica_politica_negativa` | A | CANCELADA + XML histórico; **sem** `EventoFiscal` | não |
| `outra_storeId` | B | clone do entregável | não no reader da loja A |
| `producao_caso_negativo` | A | `ambiente=PRODUCAO` (coluna; XML de fixture `tpAmb=2`) | não nesta fase |

A linha PRODUCAO existe **só** como teste negativo (`PRODUCTION_XML_ELIGIBLE=false`). Não é documento de produção real.

---

## 5. Prova SELECT (opt-in)

[`lib/contador/homologation/provision.integration.test.ts`](../../lib/contador/homologation/provision.integration.test.ts) usa `describe.skip` sem a env. Com a env:

- 7 rows, isolamento A/B, `xmlAutorizado` byte-igual ao seed
- `FiscalLog` = 0 para essas lojas/notas
- `EventoFiscal` = 0
- não importa `xml-storage-reader`

Testes **sem banco** (`guard-url.test.ts`, `massa.test.ts`) rodam no `npm test` padrão.

---

## 6. O que ainda falta para `FISCAL_RUNTIME_VALIDATABLE=true`

Caminho da auditoria §3.1, ainda incompleto:

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
NON_PRODUCTION_RUNTIME_AVAILABLE=true
FISCAL_RUNTIME_VALIDATABLE=false
GOAL_018_OPENED=false
SEFAZ_NETWORK_REQUIRED=false
PRODUCTION_REQUIRED=false
SCHEMA_CHANGED=false
CODE_CHANGED=true
```

**Fim do provisionamento. GOAL 018 permanece não importado / não aberto.**
