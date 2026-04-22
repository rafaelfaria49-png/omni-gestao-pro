-- Contatos por unidade: evita vazar WhatsApp/E-mail da loja-1 para outras lojas.
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "contactEmail" TEXT NOT NULL DEFAULT '';

ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "contactWhatsapp" TEXT NOT NULL DEFAULT '';

ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "contactWhatsappDono" TEXT NOT NULL DEFAULT '';

