-- Opção A: SKU/Barcode por loja (unicidade = storeId + sku). Sem reset, sem perda de dados.

-- 1) Coluna sku (nullable) em estoque_produtos
ALTER TABLE "estoque_produtos"
ADD COLUMN IF NOT EXISTS "sku" TEXT;

-- 2) Backfill seguro: para dados legados, use sku = id (mantém o comportamento anterior no PDV)
UPDATE "estoque_produtos"
SET "sku" = "id"
WHERE ("sku" IS NULL OR "sku" = '') AND "id" IS NOT NULL;

-- 3) Índice/constraint única composta (storeId, sku) — permite repetir sku entre lojas diferentes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'estoque_produtos_storeId_sku_key'
  ) THEN
    ALTER TABLE "estoque_produtos"
      ADD CONSTRAINT "estoque_produtos_storeId_sku_key" UNIQUE ("storeId", "sku");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "estoque_produtos_storeId_sku_idx" ON "estoque_produtos" ("storeId", "sku");

