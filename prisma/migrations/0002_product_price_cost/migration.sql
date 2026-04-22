-- Custo unitário. Se no Supabase a coluna já existir como "price_cost", renomeie ou ajuste @map no schema.prisma.
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "cost" DOUBLE PRECISION NOT NULL DEFAULT 0;
