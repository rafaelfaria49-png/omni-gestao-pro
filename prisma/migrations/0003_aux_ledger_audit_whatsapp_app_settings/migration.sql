-- Ledger, app settings, audit, WhatsApp pending, categorias (alinhado a schema.prisma)

CREATE TABLE IF NOT EXISTS "ledger_snapshots" (
    "date" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_snapshots_pkey" PRIMARY KEY ("date")
);

CREATE TABLE IF NOT EXISTS "app_loja_settings" (
    "id" TEXT NOT NULL,
    "perfilLoja" TEXT NOT NULL DEFAULT 'assistencia',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "app_loja_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "app_loja_settings" ("id", "perfilLoja", "updatedAt")
VALUES ('default', 'assistencia', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "logs_auditoria" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "userLabel" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "metadata" TEXT,
    "source" TEXT NOT NULL DEFAULT 'dashboard',
    CONSTRAINT "logs_auditoria_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "logs_auditoria_createdAt_idx" ON "logs_auditoria"("createdAt");
CREATE INDEX IF NOT EXISTS "logs_auditoria_action_idx" ON "logs_auditoria"("action");

CREATE TABLE IF NOT EXISTS "whatsapp_pending_actions" (
    "id" TEXT NOT NULL,
    "phoneKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "whatsapp_pending_actions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_pending_actions_phoneKey_key" ON "whatsapp_pending_actions"("phoneKey");

CREATE TABLE IF NOT EXISTS "categorias_produto" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    CONSTRAINT "categorias_produto_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "categorias_produto_lojaId_slug_key" ON "categorias_produto"("lojaId", "slug");
CREATE INDEX IF NOT EXISTS "categorias_produto_lojaId_idx" ON "categorias_produto"("lojaId");
