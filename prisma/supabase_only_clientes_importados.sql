-- Execute no SQL Editor do Supabase se o erro for: relation "public.clientes_importados" does not exist
CREATE TABLE IF NOT EXISTS public.clientes_importados (
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
    CONSTRAINT clientes_importados_pkey PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS clientes_importados_lojaId_nomeNorm_key ON public.clientes_importados ("lojaId", "nomeNorm");
CREATE UNIQUE INDEX IF NOT EXISTS clientes_importados_lojaId_docDigits_key ON public.clientes_importados ("lojaId", "docDigits");
CREATE INDEX IF NOT EXISTS clientes_importados_lojaId_idx ON public.clientes_importados ("lojaId");
ALTER TABLE public.clientes_importados DISABLE ROW LEVEL SECURITY;

-- Tabela já existente (versão antiga): alinhar colunas ao Prisma.
ALTER TABLE public.clientes_importados ADD COLUMN IF NOT EXISTS "cpf" TEXT;
ALTER TABLE public.clientes_importados ALTER COLUMN "telefone" DROP NOT NULL;
ALTER TABLE public.clientes_importados ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE public.clientes_importados ALTER COLUMN "telefone" DROP DEFAULT;
ALTER TABLE public.clientes_importados ALTER COLUMN "email" DROP DEFAULT;
