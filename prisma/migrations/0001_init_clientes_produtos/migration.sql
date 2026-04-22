-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "cliente" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "name" TEXT NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cliente_storeId_idx" ON "cliente"("storeId");

-- CreateIndex
CREATE INDEX "product_storeId_idx" ON "product"("storeId");

