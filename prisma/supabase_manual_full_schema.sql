-- =============================================================================
-- OmniGestão Pro — schema alinhado a prisma/schema.prisma
-- Cole no SQL Editor do Supabase (PostgreSQL) para criar/atualizar tabelas.
-- Uso: banco vazio OU rode com cuidado em banco existente (usa IF NOT EXISTS).
-- App em IPv4: use no .env o Transaction Pooler :6543 com ?pgbouncer=true
-- =============================================================================

-- Extensão útil para gen_random_uuid() se quiser trocar IDs no futuro (opcional)
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- logs_auditoria
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- ledger_snapshots
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ledger_snapshots" (
    "date" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_snapshots_pkey" PRIMARY KEY ("date")
);

-- -----------------------------------------------------------------------------
-- whatsapp_pending_actions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "whatsapp_pending_actions" (
    "id" TEXT NOT NULL,
    "phoneKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "whatsapp_pending_actions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_pending_actions_phoneKey_key" ON "whatsapp_pending_actions"("phoneKey");

-- -----------------------------------------------------------------------------
-- estoque_produtos (PDV / gestão)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "estoque_produtos" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL DEFAULT 'loja-1',
    "name" TEXT NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL DEFAULT '',
    "vendaPorPeso" BOOLEAN NOT NULL DEFAULT false,
    "precoPorKg" DOUBLE PRECISION,
    "atributos" JSONB,
    "nameNorm" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "estoque_produtos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "estoque_produtos_lojaId_idx" ON "estoque_produtos"("lojaId");
CREATE INDEX IF NOT EXISTS "estoque_produtos_lojaId_nameNorm_idx" ON "estoque_produtos"("lojaId", "nameNorm");

-- -----------------------------------------------------------------------------
-- clientes_importados (importação / dedupe por loja)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "clientes_importados" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nomeNorm" TEXT NOT NULL,
    "docDigits" TEXT,
    "cpf" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "endereco" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "clientes_importados_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "clientes_importados_lojaId_nomeNorm_key" ON "clientes_importados"("lojaId", "nomeNorm");
CREATE UNIQUE INDEX IF NOT EXISTS "clientes_importados_lojaId_docDigits_key" ON "clientes_importados"("lojaId", "docDigits");
CREATE INDEX IF NOT EXISTS "clientes_importados_lojaId_idx" ON "clientes_importados"("lojaId");

-- Bancos já criados antes de `cpf` / opcionais: alinhar ao Prisma.
ALTER TABLE "clientes_importados" ADD COLUMN IF NOT EXISTS "cpf" TEXT;
ALTER TABLE "clientes_importados" ALTER COLUMN "telefone" DROP NOT NULL;
ALTER TABLE "clientes_importados" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "clientes_importados" ALTER COLUMN "telefone" DROP DEFAULT;
ALTER TABLE "clientes_importados" ALTER COLUMN "email" DROP DEFAULT;

-- -----------------------------------------------------------------------------
-- ordens_servico
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ordens_servico" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL DEFAULT 'loja-1',
    "numero" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ordens_servico_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ordens_servico_lojaId_numero_key" ON "ordens_servico"("lojaId", "numero");
CREATE INDEX IF NOT EXISTS "ordens_servico_lojaId_idx" ON "ordens_servico"("lojaId");

-- -----------------------------------------------------------------------------
-- app_loja_settings (uma linha id = default)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app_loja_settings" (
    "id" TEXT NOT NULL,
    "perfilLoja" TEXT NOT NULL DEFAULT 'assistencia',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "app_loja_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "app_loja_settings" ("id", "perfilLoja", "updatedAt")
VALUES ('default', 'assistencia', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- -----------------------------------------------------------------------------
-- contas_receber_titulos, vendas, venda_itens (relação opcional servidor ↔ PDV)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "contas_receber_titulos" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "descricao" TEXT NOT NULL DEFAULT '',
    "cliente" TEXT NOT NULL DEFAULT '',
    "valor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vencimento" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contas_receber_titulos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "contas_receber_titulos_storeId_idx" ON "contas_receber_titulos"("storeId");
CREATE INDEX IF NOT EXISTS "contas_receber_titulos_cliente_idx" ON "contas_receber_titulos"("cliente");

CREATE TABLE IF NOT EXISTS "vendas" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "pedidoId" TEXT NOT NULL,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clienteNome" TEXT,
    "contaReceberTituloId" TEXT,
    CONSTRAINT "vendas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vendas_pedidoId_key" UNIQUE ("pedidoId"),
    CONSTRAINT "vendas_contaReceberTituloId_fkey" FOREIGN KEY ("contaReceberTituloId") REFERENCES "contas_receber_titulos"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "vendas_storeId_idx" ON "vendas"("storeId");
CREATE INDEX IF NOT EXISTS "vendas_contaReceberTituloId_idx" ON "vendas"("contaReceberTituloId");

CREATE TABLE IF NOT EXISTS "venda_itens" (
    "id" TEXT NOT NULL,
    "vendaId" TEXT NOT NULL,
    "inventoryId" TEXT,
    "nome" TEXT NOT NULL DEFAULT '',
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "precoUnitario" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "venda_itens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "venda_itens_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "vendas"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "venda_itens_vendaId_idx" ON "venda_itens"("vendaId");

-- -----------------------------------------------------------------------------
-- Colunas adicionadas depois (Prisma / recuperação local ↔ servidor)
-- -----------------------------------------------------------------------------
ALTER TABLE "contas_receber_titulos" ADD COLUMN IF NOT EXISTS "localKey" TEXT;
ALTER TABLE "contas_receber_titulos" ADD COLUMN IF NOT EXISTS "payload" JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS "contas_receber_titulos_localKey_key" ON "contas_receber_titulos"("localKey");

ALTER TABLE "vendas" ADD COLUMN IF NOT EXISTS "payload" JSONB;

-- =============================================================================
-- Fim. Depois rode: npx prisma generate (o client espera estas tabelas/colunas).
-- =============================================================================
