# FISCAL-NFCE-CONTINGENCY-020 — H-9/H-10 acquire-contain pre-flight (131)

Trilha `fiscal` · GOAL 020 (continuação) · operação FISCAL-020-H9H10-ACQUIRE-CONTAIN-131.
Data: 2026-08-29 · Zero rede externa nesta fase (nenhum GET SEFAZ, nenhuma chamada de aplicação).

- BASE: `origin/main = c19e220dd63331006913a06ecf4ca6555a9b6d1c` (exato, sem drift)
- Branch oficial `goal/fiscal-020-contingency-offline-nfce` reancorada por fast-forward
  (`1afb9ad → c19e220`); merge apenas trouxe o próprio merge-commit do PR #126 e docs de PDV —
  nenhum runtime Fiscal novo após a base esperada.

## Itens verdes (confirmados por evidência)

1. **Gate H-9/H-10 DORMENTE** — `WSDL_EPHEMERAL_EXECUTION_WINDOW = {activationId: null,
   notBeforeUtc: null, expiresAtUtc: null}` (`wsdl-ephemeral-execution-window.ts`, congelado),
   presente no commit `c19e220` deployado em Production. Janela máxima validada: 15 min
   (`WSDL_EXECUTION_MAX_WINDOW_MS`); proposta de 10 min cabe.
2. **Exatamente 6 alvos** — `SEFAZ_WSDL_ACQUISITION_TARGETS` projetado do catálogo fechado
   (`HOMOLOGACAO/SP/permitido/íntegro`), `WSDL_EXECUTION_EXPECTED_TARGETS = 6`,
   `canonicalTargetKeys()` recusa catálogo ≠ 6. GET fixo `?wsdl`; caller não controla
   URL/host/path/porta/serviço/quantidade/retry (testes adversariais na suíte).
3. **Superfície canônica Production-only** — host `omni-gestao-pro.vercel.app` +
   `VERCEL_ENV=production` + `VERCEL_PROJECT_ID` canônico (`prj_wjkH…`, reexportado do guard de
   migrations). Alias canônico confirmado apontando para o deployment Production READY
   `dpl_BVbTH4CGKz76ZtSXk3dFwkv9NsB3` (2026-08-29 18:36 BRT = merge `c19e220`).
4. **One-shot global** — consumo transacional com `pg_advisory_xact_lock` + recusa global por
   `dedupeKey = fiscal:wsdl:h9-h10:v1:<sha256(activationId)>`; unique `(storeId, dedupeKey)`
   como retaguarda. Nova activation ainda não existe ⇒ hash inédito ⇒ 0 consumos por construção.
5. **Ledger** — 0 jobs `dedupeKey LIKE 'fiscal:wsdl:h9-h10:v1:%'` e 0 logs
   `fiscal.wsdl.h9_h10.activation_consumed` no banco acessível por leitura
   (`omnigestao_prod_candidate` — ver nota de ambiente abaixo).
6. **Nenhum deployment ON executável** — todos os deployments atuais derivam de main dormente
   (`null/null/null`). Os únicos commits ON já existentes (janela `wsdl-h9h10-20260824-1800z-*`,
   `b9fc7dc`/PR #108) expiraram em 2026-08-24T18:10Z: qualquer deployment dessa era é
   estruturalmente inerte (config em código com `expiresAtUtc` no passado ⇒ 404 antes de ACL,
   Prisma, cofre e socket). Inventário completo pós-execução segue obrigatório no containment.
7. **A1 provisionado no runtime Production** — envs `FISCAL_A1_PFX_B64_LOJA_1` e
   `FISCAL_A1_SENHA_LOJA_1` existentes no ambiente Production do projeto canônico (backend
   `env-piloto`, valores criptografados; nomes lidos via `vercel env ls` — nenhum valor exposto).
8. **Ordem fail-closed dos guards na rota** — janela → superfície canônica → ACL ADMIN → request
   fechada → pilot store → config (HOMOLOGACAO/NFCE/SEFAZ_DIRETO/fiscalEnabled=true/cert) →
   certificado ativo → A1 SecureContext → consumo one-shot → batch ≤ 6 GET. Falhas de pre-flight
   NÃO consomem a activation e NÃO abrem rede.
9. **Testes focados** — vitest `lib/fiscal/provider/sefaz/wsdl` + `app/api/fiscal/wsdl` +
   `lib/fiscal/homologation`: **173/173**; `lib/fiscal/contingencia` +
   `app/api/fiscal/contingencia`: **67/67**. Zero rede (transportes injetados/loopback).

## GAP (único item não verde — externo ao agente)

**Estado do banco de PRODUÇÃO (`omnigestao_prod`) não verificável por este executor.**

- O `DATABASE_URL` do runtime Production é env SENSÍVEL da Vercel (não legível nem via
  `vercel env pull` — retorna placeholder `[SENSITIVE]`) e não há credencial Neon local.
- O `.env` local aponta para `omnigestao_prod_candidate` (banco de dev/preview conforme
  `docs/ai/START_HERE.md`), onde foi feita a leitura read-only deste pre-flight:
  - 1 linha `ConfiguracaoFiscalLoja` (`loja-1`): `HOMOLOGACAO` ✓, `NFCE` ✓,
    **`provider=STUB_HOMOLOGACAO` ✗**, **`fiscalEnabled=false` ✗**, `certificadoAtivoId` presente ✓;
  - **0 linhas `CertificadoDigital`** ⇒ A1 não resolvível neste banco ✗;
  - divergência ESPERADA para banco de dev (a política separa prod de candidate), mas
    **insuficiente como evidência de produção**.
- A resolução da pilot store no runtime Production é dinâmica e fail-closed (ADR-0016): se o
  banco de produção não satisfizer os critérios (exatamente 1 candidata
  HOMOLOGACAO+NFCE+SEFAZ_DIRETO+cert; `fiscalEnabled=true`; cert ATIVO/vigente com refs), a
  chamada administrativa responde 409 **antes** do consumo one-shot e **antes** de qualquer
  rede — falha segura, mas desperdiçaria a janela autorizada.

## Evidência de não-rede desta fase

- Nenhuma chamada SEFAZ/WSDL/DNS/TLS externa; nenhuma função da aplicação invocada.
- Consultas: leitura Prisma read-only em `omnigestao_prod_candidate` (sem escrita);
  metadata Vercel (`vercel ls/inspect/env ls` — sem valores de env; `env pull` de produção
  retornou placeholders e o arquivo temporário foi apagado sem uso).
- SEFAZ_SOAP_POST_COUNT=0 · WSDL_EXTERNAL_GET_COUNT=0 · SEFAZ_PRODUCTION_REQUEST_COUNT=0

## Classificação

**B-PREFLIGHT-GAP** — pre-flight 9/10 verde; 1 item externo pendente de confirmação humana
(estado fiscal da pilot store no banco de produção). Gate humano NÃO solicitado nesta condição,
conforme a regra "somente se o pre-flight estiver totalmente verde". Zero rede executada.
