-- GOAL 002B — INFRAESTRUTURA DORMENTE DA NUMERACAO SERVER-SIDE DE VENDA.
-- Decisao: docs/decisions/ADR-0019-numeracao-server-side-vendas.md.
-- Auditoria: docs/audits/PDV_PEDIDO_ID_NUMERACAO_SERVER_SAFE_AUDIT_002A.md.
--
-- Migration exclusivamente ADITIVA:
--   * 1 enum, 1 tabela nova, 1 coluna NULLABLE em stores;
--   * 8 colunas NULLABLE em vendas;
--   * indices, uniques, checks e FKs novos.
-- Nao ha DROP, RENAME, TRUNCATE, DELETE, UPDATE, INSERT, backfill ou renumeracao.
-- Nenhuma coluna nova de vendas e obrigatoria; o historico permanece com NULL.
-- pedidoId continua globalmente unico e o writer v1 continua escolhendo seu valor.
--
-- A tabela series_venda guarda o PROXIMO numero emitivel por (storeId, ano). O adapter
-- incrementa essa linha dentro da transacao futura da venda. Rollback do chamador reverte
-- o contador; cancelamento posterior nunca decrementa nem reutiliza numero.
--
-- Apply:
--   * prisma migrate deploy aplica o arquivo inteiro apos a migration 0015 atual;
--   * db push cria o shape Prisma, mas NAO cria os CHECKs abaixo.
-- A cadeia historica de migrations nao e bootstrap-complete em banco vazio (falha
-- preexistente na 0005); por isso o teste local deve partir de schema-base descartavel
-- ou de banco baselinado. Nunca executar esta migration diretamente em producao neste GOAL.

-- 1) Origem opcional da numeracao. NULL preserva historico/writer v1 sem backfill.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VendaNumeracaoOrigem') THEN
    CREATE TYPE "VendaNumeracaoOrigem" AS ENUM ('LEGACY_CLIENT', 'SERVER_V1', 'IMPORTED');
  END IF;
END $$;

-- 2) Codigo estavel por loja. Nenhuma loja e configurada automaticamente.
ALTER TABLE "stores"
  ADD COLUMN IF NOT EXISTS "codigoNumeracaoVenda" VARCHAR(8);

CREATE UNIQUE INDEX IF NOT EXISTS "stores_codigoNumeracaoVenda_key"
  ON "stores"("codigoNumeracaoVenda");

-- 3) Serie/contador por loja e ano.
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

CREATE UNIQUE INDEX IF NOT EXISTS "series_venda_storeId_ano_key"
  ON "series_venda"("storeId", "ano");

CREATE UNIQUE INDEX IF NOT EXISTS "series_venda_prefixo_ano_key"
  ON "series_venda"("prefixo", "ano");

-- Alvo da FK composta de vendas: trava storeId junto com a serie.
CREATE UNIQUE INDEX IF NOT EXISTS "series_venda_id_storeId_key"
  ON "series_venda"("id", "storeId");

CREATE INDEX IF NOT EXISTS "series_venda_storeId_ativo_idx"
  ON "series_venda"("storeId", "ativo");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'series_venda_storeId_fkey'
  ) THEN
    ALTER TABLE "series_venda"
      ADD CONSTRAINT "series_venda_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "stores"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 4) Metadados opcionais de idempotencia/numeracao em vendas.
ALTER TABLE "vendas" ADD COLUMN IF NOT EXISTS "clientSaleId" VARCHAR(128);
ALTER TABLE "vendas" ADD COLUMN IF NOT EXISTS "idempotencyHash" CHAR(64);
ALTER TABLE "vendas" ADD COLUMN IF NOT EXISTS "idempotencyHashVersion" INTEGER;
ALTER TABLE "vendas" ADD COLUMN IF NOT EXISTS "serieVendaId" TEXT;
ALTER TABLE "vendas" ADD COLUMN IF NOT EXISTS "anoNumero" INTEGER;
ALTER TABLE "vendas" ADD COLUMN IF NOT EXISTS "numeroSequencial" INTEGER;
ALTER TABLE "vendas" ADD COLUMN IF NOT EXISTS "numeradaEm" TIMESTAMP(3);
ALTER TABLE "vendas" ADD COLUMN IF NOT EXISTS "numeracaoOrigem" "VendaNumeracaoOrigem";

-- Uma chave de tentativa por loja; multiplos NULL preservam o historico.
CREATE UNIQUE INDEX IF NOT EXISTS "vendas_storeId_clientSaleId_key"
  ON "vendas"("storeId", "clientSaleId");

-- Um componente numerico por serie; multiplos (NULL, NULL) sao permitidos.
CREATE UNIQUE INDEX IF NOT EXISTS "vendas_serieVendaId_numeroSequencial_key"
  ON "vendas"("serieVendaId", "numeroSequencial");

CREATE INDEX IF NOT EXISTS "vendas_storeId_anoNumero_numeroSequencial_idx"
  ON "vendas"("storeId", "anoNumero", "numeroSequencial");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendas_serieVendaId_storeId_fkey'
  ) THEN
    ALTER TABLE "vendas"
      ADD CONSTRAINT "vendas_serieVendaId_storeId_fkey"
      FOREIGN KEY ("serieVendaId", "storeId")
      REFERENCES "series_venda"("id", "storeId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 5) Checks fisicos. NULL satisfaz os checks de vendas e nao invalida o historico.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stores_codigoNumeracaoVenda_formato_check'
  ) THEN
    ALTER TABLE "stores"
      ADD CONSTRAINT "stores_codigoNumeracaoVenda_formato_check"
      CHECK (
        "codigoNumeracaoVenda" IS NULL
        OR "codigoNumeracaoVenda" ~ '^[A-Z0-9]{2,8}$'
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'series_venda_ano_faixa_check'
  ) THEN
    ALTER TABLE "series_venda"
      ADD CONSTRAINT "series_venda_ano_faixa_check"
      CHECK ("ano" BETWEEN 2000 AND 9999);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'series_venda_prefixo_formato_check'
  ) THEN
    ALTER TABLE "series_venda"
      ADD CONSTRAINT "series_venda_prefixo_formato_check"
      CHECK ("prefixo" ~ '^[A-Z0-9]{2,8}$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'series_venda_proximoNumero_faixa_check'
  ) THEN
    ALTER TABLE "series_venda"
      ADD CONSTRAINT "series_venda_proximoNumero_faixa_check"
      CHECK ("proximoNumero" BETWEEN 1 AND 1000000);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendas_anoNumero_faixa_check'
  ) THEN
    ALTER TABLE "vendas"
      ADD CONSTRAINT "vendas_anoNumero_faixa_check"
      CHECK ("anoNumero" IS NULL OR "anoNumero" BETWEEN 2000 AND 9999);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendas_numeroSequencial_faixa_check'
  ) THEN
    ALTER TABLE "vendas"
      ADD CONSTRAINT "vendas_numeroSequencial_faixa_check"
      CHECK (
        "numeroSequencial" IS NULL
        OR "numeroSequencial" BETWEEN 1 AND 999999
      );
  END IF;
END $$;
