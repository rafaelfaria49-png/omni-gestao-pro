-- Add barcode (EAN/GTIN) field to products table.

ALTER TABLE "estoque_produtos"
ADD COLUMN IF NOT EXISTS "barcode" TEXT;

-- Unique per store (allows multiple NULLs).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'estoque_produtos_storeId_barcode_key'
  ) THEN
    ALTER TABLE "estoque_produtos"
      ADD CONSTRAINT "estoque_produtos_storeId_barcode_key" UNIQUE ("storeId", "barcode");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "estoque_produtos_storeId_barcode_idx"
  ON "estoque_produtos" ("storeId", "barcode");

