-- CONTADOR-HUB-IDENTIDADE-CONVITE-014 — identidade externa, vinculo, convite e sessao.
-- Gate G3 aprovado por Rafael em 2026-07-31 ("AUTORIZO A MIGRATION ADITIVA E A
-- IMPLEMENTACAO LOCAL DO GOAL 014"; ADR-CONTADOR-002/008 Accepted com emendas).
-- Desenho aprovado: docs/contador/CONTADOR_HUB_IDENTIDADE_CONVITE_014_SCHEMA_PROPOSAL.md
--
-- AJUSTE OBRIGATORIO G3 #3 (migration deterministica): esta migration e ADITIVA e
-- DETERMINISTICA — DDL direto, executado UMA vez pelo fluxo oficial de migrate.
-- Propositalmente SEM "DO $$", SEM "IF NOT EXISTS" e sem qualquer logica que
-- esconda drift: se o banco divergir do esperado, o comando FALHA em vez de
-- silenciar. Convites expirados e concorrencia sao tratados por constraints
-- estaveis + logica transacional server-side (aceite = update condicional
-- atomico). Aplicacao via fluxo oficial (`prisma migrate deploy` em producao;
-- NUNCA `prisma db push`).
--
-- ADITIVO e NAO-QUEBRANTE: cria 3 ENUMs + 4 tabelas novas. NAO altera/dropa/renomeia
-- nenhuma tabela, coluna, tipo ou constraint existente. A tabela "stores" aparece
-- SOMENTE como alvo de FOREIGN KEY — nenhum ALTER TABLE "stores" nesta migration
-- (as relacoes inversas adicionadas em `model Store` nao geram coluna fisica).
--
-- IDENTIDADE EXTERNA SEPARADA (ADR-008 opcao C, decisao do GOAL 013 §11.1):
--   * "contador_usuarios" NAO tem nenhuma FK para AdminUser/AdminUserStore e nenhum
--     papel interno — nao autentica nenhuma rota interna por construcao.
--   * Convite guarda SOMENTE o hash sha256 do token — o token bruto nunca e persistido.
--   * Sessao externa persistida e revogavel, verificada a cada request; a loja NUNCA
--     vem da sessao nem do cliente — e validada por request contra "contador_acessos".
--   * "concedidoPorId"/"criadoPorId"/"revogadoPorId" sao IDs tecnicos de AdminUser,
--     guardados como TEXTO (sem FK) — a trilha sobrevive mesmo a manutencao de admins.
--
-- UNICIDADE DE CONVITE ABERTO: indice parcial "contador_convites_aberto_uk"
--   UNIQUE (email, storeId) WHERE "usadoEm" IS NULL AND "revogadoEm" IS NULL
-- garante fisicamente no maximo 1 convite aberto por (e-mail, loja). O predicado e
-- ESTAVEL (estado da linha, nao NOW()): criar novo convite revoga o anterior na
-- mesma transacao (aplicacao) e o indice veda corrida.
--
-- Operacoes desta migration: SOMENTE CREATE TYPE / CREATE TABLE / CREATE INDEX /
-- ADD CONSTRAINT (FK). Zero DROP, RENAME, ALTER destrutivo, TRUNCATE, DELETE,
-- UPDATE, INSERT, backfill, seed ou trigger.
--
-- Rollback seguro (nada existente foi tocado) — somente em banco descartavel/dev;
-- em producao a correcao se faz por migration aditiva posterior:
--   1) desligar o fluxo externo removendo CONTADOR_EXTERNO_SESSION_SECRET
--      (rotas de auth externa morrem fail-closed 503);
--   DROP TABLE IF EXISTS "contador_sessoes_externas";
--   DROP TABLE IF EXISTS "contador_acessos";
--   DROP TABLE IF EXISTS "contador_convites";
--   DROP TABLE IF EXISTS "contador_usuarios";
--   DROP TYPE  IF EXISTS "ContadorAcessoStatus";
--   DROP TYPE  IF EXISTS "ContadorPapelExterno";
--   DROP TYPE  IF EXISTS "ContadorUsuarioStatus";

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) ENUMs. Valores fisicos em minusculo, mapeados no Prisma por @map (padrao 0014).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE "ContadorUsuarioStatus" AS ENUM ('ativo','suspenso');
CREATE TYPE "ContadorPapelExterno" AS ENUM ('leitura','conferencia');
CREATE TYPE "ContadorAcessoStatus" AS ENUM ('ativo','suspenso','revogado');

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Identidade externa do contador. Sem role, sem lojaId, sem storeAccess,
--    sem FK para AdminUser. email unico (normalizado na aplicacao).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "contador_usuarios" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "status" "ContadorUsuarioStatus" NOT NULL DEFAULT 'ativo',
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "ultimoLoginEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contador_usuarios_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contador_usuarios_email_key"
  ON "contador_usuarios"("email");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Convite de UMA loja. Persiste somente o hash do token. Uso unico
--    (usadoEm), expiracao obrigatoria (expiraEm), revogacao administrativa.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "contador_convites" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "papel" "ContadorPapelExterno" NOT NULL DEFAULT 'leitura',
    "tokenHash" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),
    "revogadoEm" TIMESTAMP(3),
    "revogadoPorId" TEXT,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contador_convites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contador_convites_tokenHash_key"
  ON "contador_convites"("tokenHash");
CREATE INDEX "contador_convites_email_storeId_idx"
  ON "contador_convites"("email", "storeId");
CREATE INDEX "contador_convites_storeId_createdAt_idx"
  ON "contador_convites"("storeId", "createdAt");
-- Indice parcial ESTAVEL (predicado sobre estado da linha, nao sobre NOW()):
-- no maximo 1 convite ABERTO por (email, storeId).
CREATE UNIQUE INDEX "contador_convites_aberto_uk"
  ON "contador_convites"("email", "storeId")
  WHERE "usadoEm" IS NULL AND "revogadoEm" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Vinculo contador↔loja (N:N). Um vinculo por par (usuarioId, storeId).
--    Reconcessao apos revogacao ATUALIZA a mesma linha; a trilha fica nos eventos.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "contador_acessos" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "papel" "ContadorPapelExterno" NOT NULL,
    "status" "ContadorAcessoStatus" NOT NULL DEFAULT 'ativo',
    "concedidoPorId" TEXT NOT NULL,
    "concedidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspensoEm" TIMESTAMP(3),
    "suspensoPorId" TEXT,
    "revogadoEm" TIMESTAMP(3),
    "revogadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contador_acessos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contador_acessos_usuarioId_storeId_key"
  ON "contador_acessos"("usuarioId", "storeId");
CREATE INDEX "contador_acessos_storeId_status_idx"
  ON "contador_acessos"("storeId", "status");
CREATE INDEX "contador_acessos_usuarioId_status_idx"
  ON "contador_acessos"("usuarioId", "status");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Sessao externa persistida e revogavel. id = sid do cookie HMAC.
--    SEM storeId de proposito: a sessao identifica a pessoa, nao autoriza loja.
--    ipHash = sha256 salgado truncado (IP bruto NUNCA); UA resumido <= 200 chars.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "contador_sessoes_externas" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "revogadoEm" TIMESTAMP(3),
    "ultimoUsoEm" TIMESTAMP(3),
    "ipHash" TEXT,
    "userAgentResumo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contador_sessoes_externas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contador_sessoes_externas_usuarioId_idx"
  ON "contador_sessoes_externas"("usuarioId");
CREATE INDEX "contador_sessoes_externas_expiraEm_idx"
  ON "contador_sessoes_externas"("expiraEm");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) FOREIGN KEYS. Todos os ALTER TABLE abaixo tem como alvo SOMENTE tabelas
--    novas do GOAL 014. "stores" e "contador_usuarios" aparecem apenas como
--    tabelas REFERENCIADAS — "stores" nunca alterada.
--
--    Politica de onDelete: SOMENTE RESTRICT (padrao do nucleo — trilha preservada;
--    ninguem e apagado no MVP). Nenhum CASCADE novo: o unico Cascade do dominio
--    permanece o de ContadorPacoteItem (0014).
--    onUpdate CASCADE = padrao do Prisma (id nunca muda; inofensivo).
-- ─────────────────────────────────────────────────────────────────────────────

-- Convite -> Store (simples; convite e de UMA loja).
ALTER TABLE "contador_convites" ADD CONSTRAINT "contador_convites_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Acesso -> ContadorUsuario (simples).
ALTER TABLE "contador_acessos" ADD CONSTRAINT "contador_acessos_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "contador_usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Acesso -> Store (simples).
ALTER TABLE "contador_acessos" ADD CONSTRAINT "contador_acessos_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SessaoExterna -> ContadorUsuario (simples).
ALTER TABLE "contador_sessoes_externas" ADD CONSTRAINT "contador_sessoes_externas_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "contador_usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
