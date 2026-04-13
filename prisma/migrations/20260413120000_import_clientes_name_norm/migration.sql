-- AlterTable
ALTER TABLE "estoque_produtos" ADD COLUMN IF NOT EXISTS "nameNorm" TEXT NOT NULL DEFAULT '';

UPDATE "estoque_produtos"
SET "nameNorm" = lower(trim(regexp_replace(name, '\s+', ' ', 'g')))
WHERE "nameNorm" = '';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "estoque_produtos_lojaId_nameNorm_idx" ON "estoque_produtos"("lojaId", "nameNorm");

-- CreateTable
CREATE TABLE IF NOT EXISTS "clientes_importados" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nomeNorm" TEXT NOT NULL,
    "docDigits" TEXT,
    "telefone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "endereco" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clientes_importados_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "clientes_importados_lojaId_nomeNorm_key" ON "clientes_importados"("lojaId", "nomeNorm");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "clientes_importados_lojaId_docDigits_key" ON "clientes_importados"("lojaId", "docDigits");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "clientes_importados_lojaId_idx" ON "clientes_importados"("lojaId");
