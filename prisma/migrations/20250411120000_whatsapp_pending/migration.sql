-- CreateTable
CREATE TABLE "whatsapp_pending_actions" (
    "id" TEXT NOT NULL,
    "phoneKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_pending_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_pending_actions_phoneKey_key" ON "whatsapp_pending_actions"("phoneKey");
