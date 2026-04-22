-- Fornecedores e contas a pagar por unidade (storeId em todas as linhas).

CREATE TABLE "fornecedores" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL DEFAULT 'loja-1',
    "name" TEXT NOT NULL,
    "document" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fornecedores_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fornecedores_storeId_idx" ON "fornecedores"("storeId");
CREATE INDEX "fornecedores_name_idx" ON "fornecedores"("name");

ALTER TABLE "fornecedores" ADD CONSTRAINT "fornecedores_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "contas_pagar_titulos" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL DEFAULT 'loja-1',
    "fornecedorId" TEXT,
    "localKey" TEXT,
    "payload" JSONB,
    "descricao" TEXT NOT NULL DEFAULT '',
    "valor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vencimento" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "numeroDocumento" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_pagar_titulos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contas_pagar_titulos_storeId_idx" ON "contas_pagar_titulos"("storeId");
CREATE INDEX "contas_pagar_titulos_fornecedorId_idx" ON "contas_pagar_titulos"("fornecedorId");
CREATE INDEX "contas_pagar_titulos_status_idx" ON "contas_pagar_titulos"("status");

CREATE UNIQUE INDEX "contas_pagar_titulos_storeId_localKey_key" ON "contas_pagar_titulos"("storeId", "localKey");

ALTER TABLE "contas_pagar_titulos" ADD CONSTRAINT "contas_pagar_titulos_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contas_pagar_titulos" ADD CONSTRAINT "contas_pagar_titulos_fornecedorId_fkey"
  FOREIGN KEY ("fornecedorId") REFERENCES "fornecedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
