-- GOAL 002B — INFRAESTRUTURA DA NUMERACAO SERVER-SIDE DE VENDA (DORMENTE).
-- Desenho aprovado: docs/audits/PDV_PEDIDO_ID_NUMERACAO_SERVER_SAFE_AUDIT_002A.md (secao 9).
--
-- ADITIVO e NAO-QUEBRANTE: cria 1 ENUM + 1 tabela nova ("series_venda"), 1 coluna nova em
-- "stores" e 8 colunas novas em "vendas" (todas NULLABLE, exceto "numeracaoOrigem", que nasce
-- NOT NULL DEFAULT 'LEGACY_CLIENT' — o default preenche o historico sem UPDATE de tabela).
-- NAO altera/dropa/renomeia nenhuma coluna existente; o DEFAULT 'loja-1' de "vendas"."storeId"
-- permanece intacto (divida registrada para o GOAL da API v2).
--
-- Operacoes: SOMENTE CREATE TYPE / CREATE TABLE / ADD COLUMN / CREATE INDEX / ADD CONSTRAINT.
-- Zero DROP, RENAME, ALTER destrutivo, TRUNCATE, DELETE, UPDATE ou renumeracao.
--
-- DORMENTE: nenhum writer produtivo grava estas colunas. "pedidoId" continua @unique global e
-- continua vindo do cliente no writer v1. Nenhuma loja recebe "codigoNumeracaoVenda" aqui —
-- a configuracao real e um gate administrado posterior.
--
-- Apply de fato via `npm run db:push` (Opcao A — mesmo padrao das migracoes 0009..0014).
-- ATENCAO: `db:push` NAO cria os CHECKs da secao 5 (constraints CHECK nao sao declaraveis em
-- schema.prisma, mesmo caso do indice parcial da migration 0011). Aplique a secao 5 manualmente
-- no ambiente onde a trava estrutural for desejada; a garantia primaria e o adapter
-- `lib/vendas/server-sale-numbering.ts` (faixa revalidada dentro do proprio UPDATE atomico).
--
-- Opcao B (medida no GOAL 002B readiness, PostgreSQL 17.10 local): `prisma migrate deploy`
-- aplica este arquivo INTEIRO — os 4 CHECKs incluidos — e depois `migrate diff` acusa
-- "No difference detected" nos dois sentidos. Exige o banco baselinado antes
-- (`prisma migrate resolve --applied 0001..0014`), porque a cadeia de `prisma/migrations`
-- NAO e bootstrap-complete: em banco vazio ela quebra na 0005, divida PREEXISTENTE a esta
-- migration. Enquanto o baseline nao existir no ambiente alvo, a Opcao A segue valendo.
--
-- Rollback logico (nada existente foi tocado; so remove o que esta migration criou):
--   ALTER TABLE "vendas" DROP CONSTRAINT IF EXISTS "vendas_serieVendaId_storeId_fkey";
--   ALTER TABLE "vendas" DROP CONSTRAINT IF EXISTS "vendas_numeroSequencial_faixa_check";
--   DROP INDEX IF EXISTS "vendas_serieVendaId_numeroSequencial_key";
--   DROP INDEX IF EXISTS "vendas_storeId_clientSaleId_key";
--   DROP INDEX IF EXISTS "vendas_storeId_anoNumero_numeroSequencial_idx";
--   ALTER TABLE "vendas" DROP COLUMN IF EXISTS "serieVendaId", DROP COLUMN IF EXISTS "anoNumero",
--     DROP COLUMN IF EXISTS "numeroSequencial", DROP COLUMN IF EXISTS "numeradaEm",
--     DROP COLUMN IF EXISTS "numeracaoOrigem", DROP COLUMN IF EXISTS "clientSaleId",
--     DROP COLUMN IF EXISTS "idempotencyHash", DROP COLUMN IF EXISTS "idempotencyHashVersion";
--   DROP TABLE IF EXISTS "series_venda";
--   ALTER TABLE "stores" DROP CONSTRAINT IF EXISTS "stores_codigoNumeracaoVenda_formato_check";
--   DROP INDEX IF EXISTS "stores_codigoNumeracaoVenda_key";
--   ALTER TABLE "stores" DROP COLUMN IF EXISTS "codigoNumeracaoVenda";
--   DROP TYPE IF EXISTS "VendaNumeracaoOrigem";
-- O rollback so e seguro enquanto nenhuma venda tiver sido numerada pelo servidor.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) ENUM da origem do numero (CREATE TYPE nao suporta IF NOT EXISTS → guard via pg_type)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VendaNumeracaoOrigem') THEN
  CREATE TYPE "VendaNumeracaoOrigem" AS ENUM ('LEGACY_CLIENT','SERVER_V1','IMPORTED');
END IF; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Codigo estavel de numeracao por loja (NULL = loja sem numeracao server-side)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "codigoNumeracaoVenda" VARCHAR(8);

CREATE UNIQUE INDEX IF NOT EXISTS "stores_codigoNumeracaoVenda_key"
  ON "stores"("codigoNumeracaoVenda");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Serie + contador atomico por (loja, ano)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "series_venda" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "prefixo" VARCHAR(8) NOT NULL,
    "proximoNumero" INTEGER NOT NULL DEFAULT 1,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "series_venda_pkey" PRIMARY KEY ("id")
);

-- Um contador por loja/ano.
CREATE UNIQUE INDEX IF NOT EXISTS "series_venda_storeId_ano_key"
  ON "series_venda"("storeId", "ano");

-- Duas lojas nao podem compartilhar o mesmo prefixo no mesmo ano.
CREATE UNIQUE INDEX IF NOT EXISTS "series_venda_prefixo_ano_key"
  ON "series_venda"("prefixo", "ano");

-- Alvo da FK composta de "vendas" (id + storeId) — impede serie de outra loja.
CREATE UNIQUE INDEX IF NOT EXISTS "series_venda_id_storeId_key"
  ON "series_venda"("id", "storeId");

CREATE INDEX IF NOT EXISTS "series_venda_storeId_ativo_idx"
  ON "series_venda"("storeId", "ativo");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'series_venda_storeId_fkey') THEN
    ALTER TABLE "series_venda"
      ADD CONSTRAINT "series_venda_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "stores"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Idempotencia e numeracao em "vendas" — todas as colunas novas aceitam NULL
--    (historico permanece valido e sem backfill)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "vendas" ADD COLUMN IF NOT EXISTS "clientSaleId" VARCHAR(128);
ALTER TABLE "vendas" ADD COLUMN IF NOT EXISTS "idempotencyHash" CHAR(64);
ALTER TABLE "vendas" ADD COLUMN IF NOT EXISTS "idempotencyHashVersion" INTEGER;
ALTER TABLE "vendas" ADD COLUMN IF NOT EXISTS "serieVendaId" TEXT;
ALTER TABLE "vendas" ADD COLUMN IF NOT EXISTS "anoNumero" INTEGER;
ALTER TABLE "vendas" ADD COLUMN IF NOT EXISTS "numeroSequencial" INTEGER;
ALTER TABLE "vendas" ADD COLUMN IF NOT EXISTS "numeradaEm" TIMESTAMP(3);
-- NOT NULL com DEFAULT: PostgreSQL 11+ grava o default no catalogo, sem reescrever a tabela.
ALTER TABLE "vendas" ADD COLUMN IF NOT EXISTS "numeracaoOrigem" "VendaNumeracaoOrigem"
  NOT NULL DEFAULT 'LEGACY_CLIENT';

-- Idempotencia da TENTATIVA por loja. NULLs multiplos sao permitidos pelo PostgreSQL, entao
-- todo o historico (clientSaleId NULL) continua valido; a mesma chave pode existir em lojas
-- diferentes.
CREATE UNIQUE INDEX IF NOT EXISTS "vendas_storeId_clientSaleId_key"
  ON "vendas"("storeId", "clientSaleId");

-- Um numero por serie. Idem: historico com (NULL, NULL) nao colide.
CREATE UNIQUE INDEX IF NOT EXISTS "vendas_serieVendaId_numeroSequencial_key"
  ON "vendas"("serieVendaId", "numeroSequencial");

CREATE INDEX IF NOT EXISTS "vendas_storeId_anoNumero_numeroSequencial_idx"
  ON "vendas"("storeId", "anoNumero", "numeroSequencial");

-- FK COMPOSTA (serieVendaId, storeId) → (id, storeId): trava estrutural que impede uma venda
-- da Loja 2 de apontar para o contador da Loja 1. MATCH SIMPLE (padrao): com serieVendaId NULL
-- a FK nao e checada, preservando o historico.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendas_serieVendaId_storeId_fkey') THEN
    ALTER TABLE "vendas"
      ADD CONSTRAINT "vendas_serieVendaId_storeId_fkey"
      FOREIGN KEY ("serieVendaId", "storeId") REFERENCES "series_venda"("id", "storeId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) CHECKs de faixa e formato — NAO gerenciados por `db:push` (ver cabecalho)
--    NULL satisfaz CHECK, entao nenhuma linha historica e invalidada.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'series_venda_proximoNumero_faixa_check') THEN
    -- 1..1000000: 1000000 e o estado "serie esgotada" (ultimo numero emitivel e 999999).
    ALTER TABLE "series_venda"
      ADD CONSTRAINT "series_venda_proximoNumero_faixa_check"
      CHECK ("proximoNumero" >= 1 AND "proximoNumero" <= 1000000);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'series_venda_prefixo_formato_check') THEN
    ALTER TABLE "series_venda"
      ADD CONSTRAINT "series_venda_prefixo_formato_check"
      CHECK ("prefixo" ~ '^[A-Z0-9]{2,8}$');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_codigoNumeracaoVenda_formato_check') THEN
    ALTER TABLE "stores"
      ADD CONSTRAINT "stores_codigoNumeracaoVenda_formato_check"
      CHECK ("codigoNumeracaoVenda" IS NULL OR "codigoNumeracaoVenda" ~ '^[A-Z0-9]{2,8}$');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendas_numeroSequencial_faixa_check') THEN
    ALTER TABLE "vendas"
      ADD CONSTRAINT "vendas_numeroSequencial_faixa_check"
      CHECK ("numeroSequencial" IS NULL OR ("numeroSequencial" >= 1 AND "numeroSequencial" <= 999999));
  END IF;
END $$;
