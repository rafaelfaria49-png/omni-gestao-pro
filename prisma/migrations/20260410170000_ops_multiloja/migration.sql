-- Multiloja: escopo por unidade em estoque e OS.
ALTER TABLE "estoque_produtos" ADD COLUMN "lojaId" TEXT NOT NULL DEFAULT 'loja-1';
CREATE INDEX "estoque_produtos_lojaId_idx" ON "estoque_produtos"("lojaId");

ALTER TABLE "ordens_servico" ADD COLUMN "lojaId" TEXT NOT NULL DEFAULT 'loja-1';
DROP INDEX IF EXISTS "ordens_servico_numero_key";
CREATE UNIQUE INDEX "ordens_servico_lojaId_numero_key" ON "ordens_servico"("lojaId", "numero");
CREATE INDEX "ordens_servico_lojaId_idx" ON "ordens_servico"("lojaId");
