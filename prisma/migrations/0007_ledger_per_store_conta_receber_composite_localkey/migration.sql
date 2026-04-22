-- Ledger: uma linha por (loja, dia). Dados legados viram loja-1.
ALTER TABLE "ledger_snapshots" ADD COLUMN IF NOT EXISTS "storeId" TEXT NOT NULL DEFAULT 'loja-1';

ALTER TABLE "ledger_snapshots" DROP CONSTRAINT IF EXISTS "ledger_snapshots_pkey";

ALTER TABLE "ledger_snapshots" ADD CONSTRAINT "ledger_snapshots_pkey" PRIMARY KEY ("storeId", "date");

ALTER TABLE "ledger_snapshots" ALTER COLUMN "storeId" DROP DEFAULT;

-- Contas a receber: chave de upsert por unidade (antes localKey era único global).
DROP INDEX IF EXISTS "contas_receber_titulos_localKey_key";

CREATE UNIQUE INDEX "contas_receber_titulos_storeId_localKey_key" ON "contas_receber_titulos"("storeId", "localKey");
