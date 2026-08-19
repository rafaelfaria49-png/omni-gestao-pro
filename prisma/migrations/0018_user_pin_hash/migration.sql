-- OMNIGESTAO-PIN-HASH-MIGRATION-FIX-014
-- Migration ADITIVA e DETERMINISTICA: uma coluna nullable em "users".
-- NAO toca "users"."pin". Sem DROP, RENAME, UPDATE, INSERT, backfill, seed
-- ou conversao in-place. Sem "DO $$" e sem "IF NOT EXISTS": se o banco
-- divergir do esperado, o comando FALHA.
--
-- Aplicacao via fluxo oficial (`prisma migrate deploy`). Esta entrega NAO
-- aplica a migration em Production.

ALTER TABLE "users" ADD COLUMN "pinHash" TEXT;
