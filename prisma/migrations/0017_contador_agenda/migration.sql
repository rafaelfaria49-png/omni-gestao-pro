-- CONTADOR-HUB-OBRIGACOES-GUIAS-016 — obrigacoes e guias manuais do Contador HUB.
-- Gate G-DADOS-SCHEMA autorizado exclusivamente para o GOAL 016 (PLAN REV2).
-- Desenho: 3 ENUMs + 3 tabelas novas. Sem `vencido` persistido. Sem calculo fiscal.
-- Sem cron, trigger, backfill, seed por loja ou dado default.
--
-- AJUSTE OBRIGATORIO: migration ADITIVA e DETERMINISTICA — DDL direto, executado
-- UMA vez pelo fluxo oficial de migrate. Propositalmente SEM "DO $$", SEM
-- "IF NOT EXISTS" e sem qualquer logica que esconda drift: se o banco divergir
-- do esperado, o comando FALHA em vez de silenciar.
-- Aplicacao via fluxo oficial (`prisma migrate deploy` em producao; NUNCA
-- `prisma db push`). Esta entrega NAO aplica a migration em Production.
--
-- ADITIVO e NAO-QUEBRANTE: cria 3 ENUMs + 3 tabelas novas. NAO altera/dropa/
-- renomeia nenhuma tabela, coluna, tipo ou constraint existente. As tabelas
-- "stores", "contador_competencias" e "contador_documentos" aparecem SOMENTE
-- como alvo de FOREIGN KEY — nenhum ALTER TABLE nessas tabelas nesta migration
-- (as relacoes inversas adicionadas em `model Store` / Competencia / Documento
-- nao geram coluna fisica).
--
-- INTEGRIDADE COMPOSTA:
--   * obrigacao: FK (competenciaId, storeId) -> competencia(id, storeId)
--   * obrigacao: FK opcional (templateId, storeId) -> template(id, storeId)
--     (MATCH SIMPLE: templateId nulo desliga a checagem)
--   * UNIQUE (templateId, competenciaId) SEM predicado parcial — Postgres
--     permite varios NULL (obrigacoes manuais); idempotencia so para template.
--   * guia: FK (competenciaId, storeId) -> competencia(id, storeId)
--   * guia: FK opcional (obrigacaoId, competenciaId, storeId) -> obrigacao
--   * guia PDF / comprovante: FKs compostas nomeadas para contador_documentos
--     (id, competenciaId, storeId) — documento da MESMA competencia e loja.
--
-- CHECKs (Prisma nao emite; escritos a mao):
--   * diaVencimento IS NULL OR (1..31)
--   * recorrencia <> 'mensal' OR diaVencimento IS NOT NULL
--   * valorCentavos >= 0
--
-- Operacoes desta migration: SOMENTE CREATE TYPE / CREATE TABLE / CREATE INDEX /
-- ADD CONSTRAINT (FK + CHECK). Zero DROP, RENAME, ALTER destrutivo, TRUNCATE,
-- DELETE, UPDATE, INSERT, backfill, seed ou trigger.
--
-- Rollback seguro (nada existente foi tocado) — somente em banco descartavel/dev;
-- em producao a correcao se faz por migration aditiva posterior:
--   DROP TABLE IF EXISTS "contador_guias";
--   DROP TABLE IF EXISTS "contador_obrigacoes";
--   DROP TABLE IF EXISTS "contador_obrigacao_templates";
--   DROP TYPE  IF EXISTS "ContadorGuiaOrigem";
--   DROP TYPE  IF EXISTS "ContadorObrigacaoRecorrencia";
--   DROP TYPE  IF EXISTS "ContadorObrigacaoTipo";

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) ENUMs. Valores fisicos em minusculo, mapeados no Prisma por @map (padrao 0014).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE "ContadorObrigacaoTipo" AS ENUM (
  'envio_documento',
  'pagamento_guia',
  'conferencia',
  'declaracao',
  'entrega_arquivo',
  'fechamento',
  'tarefa'
);
CREATE TYPE "ContadorObrigacaoRecorrencia" AS ENUM ('mensal','nenhuma');
CREATE TYPE "ContadorGuiaOrigem" AS ENUM ('manual','contador');

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Template de obrigacao da loja. Sem competencia. Sem `vencido`.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "contador_obrigacao_templates" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "tipo" "ContadorObrigacaoTipo" NOT NULL,
    "diaVencimento" INTEGER,
    "recorrencia" "ContadorObrigacaoRecorrencia" NOT NULL DEFAULT 'mensal',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoPorTipo" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contador_obrigacao_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contador_obrigacao_templates_id_storeId_key"
  ON "contador_obrigacao_templates"("id", "storeId");
CREATE INDEX "contador_obrigacao_templates_storeId_ativo_idx"
  ON "contador_obrigacao_templates"("storeId", "ativo");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Obrigacao da competencia. Status = ContadorItemStatus (GOAL 011).
--    UNIQUE (templateId, competenciaId) permite varios NULL (manuais).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "contador_obrigacoes" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "competenciaId" TEXT NOT NULL,
    "templateId" TEXT,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "tipo" "ContadorObrigacaoTipo" NOT NULL,
    "vencimento" TIMESTAMP(3),
    "status" "ContadorItemStatus" NOT NULL DEFAULT 'pendente',
    "criadoPorTipo" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contador_obrigacoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contador_obrigacoes_templateId_competenciaId_key"
  ON "contador_obrigacoes"("templateId", "competenciaId");
CREATE UNIQUE INDEX "contador_obrigacoes_id_storeId_key"
  ON "contador_obrigacoes"("id", "storeId");
CREATE UNIQUE INDEX "contador_obrigacoes_id_competenciaId_storeId_key"
  ON "contador_obrigacoes"("id", "competenciaId", "storeId");
CREATE INDEX "contador_obrigacoes_competenciaId_status_idx"
  ON "contador_obrigacoes"("competenciaId", "status");
CREATE INDEX "contador_obrigacoes_storeId_status_idx"
  ON "contador_obrigacoes"("storeId", "status");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Guia informada. Sem maquina 011: paga = pagaEm NOT NULL. Sem `vencido`.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "contador_guias" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "competenciaId" TEXT NOT NULL,
    "obrigacaoId" TEXT,
    "titulo" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "origem" "ContadorGuiaOrigem" NOT NULL,
    "pdfDocumentoId" TEXT,
    "comprovanteDocumentoId" TEXT,
    "pagaEm" TIMESTAMP(3),
    "criadoPorTipo" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contador_guias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contador_guias_id_storeId_key"
  ON "contador_guias"("id", "storeId");
CREATE INDEX "contador_guias_competenciaId_vencimento_idx"
  ON "contador_guias"("competenciaId", "vencimento");
CREATE INDEX "contador_guias_storeId_vencimento_idx"
  ON "contador_guias"("storeId", "vencimento");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) FOREIGN KEYS. ALTER TABLE somente nas 3 tabelas NOVAS. Tabelas existentes
--    aparecem apenas como REFERENCIADAS. onDelete RESTRICT (trilha preservada).
--    onUpdate CASCADE = padrao do Prisma.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "contador_obrigacao_templates" ADD CONSTRAINT "contador_obrigacao_templates_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contador_obrigacoes" ADD CONSTRAINT "contador_obrigacoes_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contador_obrigacoes" ADD CONSTRAINT "contador_obrigacoes_competenciaId_storeId_fkey"
  FOREIGN KEY ("competenciaId", "storeId") REFERENCES "contador_competencias"("id", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contador_obrigacoes" ADD CONSTRAINT "contador_obrigacoes_templateId_storeId_fkey"
  FOREIGN KEY ("templateId", "storeId") REFERENCES "contador_obrigacao_templates"("id", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contador_guias" ADD CONSTRAINT "contador_guias_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contador_guias" ADD CONSTRAINT "contador_guias_competenciaId_storeId_fkey"
  FOREIGN KEY ("competenciaId", "storeId") REFERENCES "contador_competencias"("id", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contador_guias" ADD CONSTRAINT "contador_guias_obrigacaoId_competenciaId_storeId_fkey"
  FOREIGN KEY ("obrigacaoId", "competenciaId", "storeId") REFERENCES "contador_obrigacoes"("id", "competenciaId", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contador_guias" ADD CONSTRAINT "contador_guias_pdfDocumentoId_competenciaId_storeId_fkey"
  FOREIGN KEY ("pdfDocumentoId", "competenciaId", "storeId") REFERENCES "contador_documentos"("id", "competenciaId", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nome truncado a 63 chars (limite PG) — Prisma gera exatamente este identificador.
ALTER TABLE "contador_guias" ADD CONSTRAINT "contador_guias_comprovanteDocumentoId_competenciaId_storeI_fkey"
  FOREIGN KEY ("comprovanteDocumentoId", "competenciaId", "storeId") REFERENCES "contador_documentos"("id", "competenciaId", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) CHECKs aprovados no PLAN REV2 (Prisma nao emite).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "contador_obrigacao_templates" ADD CONSTRAINT "contador_obrigacao_templates_diaVencimento_chk"
  CHECK ("diaVencimento" IS NULL OR ("diaVencimento" >= 1 AND "diaVencimento" <= 31));

ALTER TABLE "contador_obrigacao_templates" ADD CONSTRAINT "contador_obrigacao_templates_recorrencia_dia_chk"
  CHECK ("recorrencia" <> 'mensal' OR "diaVencimento" IS NOT NULL);

ALTER TABLE "contador_guias" ADD CONSTRAINT "contador_guias_valorCentavos_chk"
  CHECK ("valorCentavos" >= 0);
