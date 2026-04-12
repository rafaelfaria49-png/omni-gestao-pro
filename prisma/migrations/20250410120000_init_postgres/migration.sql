-- CreateTable
CREATE TABLE "logs_auditoria" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "userLabel" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "metadata" TEXT,
    "source" TEXT NOT NULL DEFAULT 'dashboard',

    CONSTRAINT "logs_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_snapshots" (
    "date" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_snapshots_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE INDEX "logs_auditoria_createdAt_idx" ON "logs_auditoria"("createdAt");

-- CreateIndex
CREATE INDEX "logs_auditoria_action_idx" ON "logs_auditoria"("action");
