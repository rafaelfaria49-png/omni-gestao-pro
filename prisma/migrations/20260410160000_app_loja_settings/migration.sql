-- CreateTable
CREATE TABLE "app_loja_settings" (
    "id" TEXT NOT NULL,
    "perfilLoja" TEXT NOT NULL DEFAULT 'assistencia',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_loja_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "app_loja_settings" ("id", "perfilLoja", "updatedAt") VALUES ('default', 'assistencia', CURRENT_TIMESTAMP);
