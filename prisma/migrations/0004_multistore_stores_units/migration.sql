-- Multi-Lojas SaaS: tabela stores + settings e vínculo por storeId (Unidade 1 = loja-1)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StoreProfile') THEN
    CREATE TYPE "StoreProfile" AS ENUM ('ASSISTENCIA', 'VARIEDADES', 'SUPERMERCADO');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "stores" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT '',
  "cnpj" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "logoUrl" TEXT NOT NULL DEFAULT '',
  "address" JSONB,
  "profile" "StoreProfile" NOT NULL DEFAULT 'ASSISTENCIA',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "stores_profile_idx" ON "stores"("profile");

CREATE TABLE IF NOT EXISTS "store_settings" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "receiptFooter" TEXT NOT NULL DEFAULT '',
  "printerConfig" JSONB,
  "cardFees" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "store_settings_storeId_key" ON "store_settings"("storeId");

-- Unidade 1 padrão: todos os dados atuais da Rafacell são atribuídos aqui
INSERT INTO "stores" ("id", "name", "cnpj", "phone", "logoUrl", "address", "profile", "createdAt", "updatedAt")
VALUES (
  'loja-1',
  'Unidade 1',
  '',
  '',
  '',
  NULL,
  'ASSISTENCIA',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

-- storeId NOT NULL + default para loja-1 nas tabelas existentes
DO $$
BEGIN
  -- clientes_importados
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='clientes_importados') THEN
    UPDATE "clientes_importados" SET "storeId"='loja-1' WHERE "storeId" IS NULL;
    ALTER TABLE "clientes_importados" ALTER COLUMN "storeId" SET DEFAULT 'loja-1';
    ALTER TABLE "clientes_importados" ALTER COLUMN "storeId" SET NOT NULL;
    ALTER TABLE "clientes_importados"
      ADD CONSTRAINT "clientes_importados_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN
  -- constraint já existe
END $$;

DO $$
BEGIN
  -- estoque_produtos
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='estoque_produtos') THEN
    UPDATE "estoque_produtos" SET "storeId"='loja-1' WHERE "storeId" IS NULL;
    ALTER TABLE "estoque_produtos" ALTER COLUMN "storeId" SET DEFAULT 'loja-1';
    ALTER TABLE "estoque_produtos" ALTER COLUMN "storeId" SET NOT NULL;
    ALTER TABLE "estoque_produtos"
      ADD CONSTRAINT "estoque_produtos_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN
END $$;

DO $$
BEGIN
  -- ordens_servico
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ordens_servico') THEN
    UPDATE "ordens_servico" SET "storeId"='loja-1' WHERE "storeId" IS NULL;
    ALTER TABLE "ordens_servico" ALTER COLUMN "storeId" SET DEFAULT 'loja-1';
    ALTER TABLE "ordens_servico" ALTER COLUMN "storeId" SET NOT NULL;
    ALTER TABLE "ordens_servico"
      ADD CONSTRAINT "ordens_servico_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN
END $$;

DO $$
BEGIN
  -- contas_receber_titulos
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='contas_receber_titulos') THEN
    UPDATE "contas_receber_titulos" SET "storeId"='loja-1' WHERE "storeId" IS NULL;
    ALTER TABLE "contas_receber_titulos" ALTER COLUMN "storeId" SET DEFAULT 'loja-1';
    ALTER TABLE "contas_receber_titulos" ALTER COLUMN "storeId" SET NOT NULL;
    ALTER TABLE "contas_receber_titulos"
      ADD CONSTRAINT "contas_receber_titulos_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN
END $$;

DO $$
BEGIN
  -- vendas
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='vendas') THEN
    UPDATE "vendas" SET "storeId"='loja-1' WHERE "storeId" IS NULL;
    ALTER TABLE "vendas" ALTER COLUMN "storeId" SET DEFAULT 'loja-1';
    ALTER TABLE "vendas" ALTER COLUMN "storeId" SET NOT NULL;
    ALTER TABLE "vendas"
      ADD CONSTRAINT "vendas_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN
END $$;

DO $$
BEGIN
  -- categorias_produto: usa lojaId (agora storeId via @map)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='categorias_produto') THEN
    ALTER TABLE "categorias_produto" ALTER COLUMN "lojaId" SET DEFAULT 'loja-1';
    ALTER TABLE "categorias_produto"
      ADD CONSTRAINT "categorias_produto_lojaId_fkey"
      FOREIGN KEY ("lojaId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN
END $$;

DO $$
BEGIN
  ALTER TABLE "store_settings"
    ADD CONSTRAINT "store_settings_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN
END $$;

