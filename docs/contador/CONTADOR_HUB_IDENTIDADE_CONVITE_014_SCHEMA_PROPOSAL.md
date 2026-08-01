# CONTADOR HUB — PROPOSTA DE SCHEMA: IDENTIDADE EXTERNA, VÍNCULO, CONVITE E SESSÃO (GOAL 014)

| Campo | Valor |
|---|---|
| GOAL | CONTADOR-HUB-IDENTIDADE-CONVITE-014 |
| Data | 2026-07-31 |
| Executor | Kimi K3 |
| Base factual | `origin/main = 950cc18b192baa5599f93ce1d4e11e16662a86ac` (`aep(contador): fecha auditoria do portal externo 013`) |
| Worktree/branch | `C:/Projetos/contador-014-identidade-convite` · `feat/contador-identidade-convite-014` |
| Documentos canônicos | `CONTADOR_HUB_PORTAL_EXTERNO_AUDIT_013.md` (§5, §6, §7, §11) · `CONTADOR_HUB_PORTAL_EXTERNO_ROADMAP_014_019.md` (014) · ADR-CONTADOR-002/008 (Proposed → G3) |
| Status | **Proposta para o gate humano G3 — NENHUMA migration criada, NENHUM código alterado** |
| Natureza | Documento de proposta. A migration e a implementação só começam após a frase exata de autorização do G3. |

---

## 0. Decisões já tomadas (insumos do G3)

1. **Identidade externa separada** — decisão única do GOAL 013 (§11.1), confirmando ADR-008 opção C. Nada de `AdminUser`, sessão NextAuth, PIN global ou gate interno como identidade do contador.
2. **Rota oficial** — `/contador-externo` (+ APIs em `/api/contador-externo`), conforme decisão do GOAL e recomendação (c) da auditoria §8.1. ADR-002 → Accepted com emenda de rota no branch deste GOAL.
3. **Convite por link copiável** — não existe infra de e-mail no repo (verificado: nenhum transporte SMTP/provider em `package.json`, `lib/`, `app/`; `nodemailer` é apenas peer opcional do `next-auth`). O token é exibido **uma única vez** ao administrador autorizado; envio automático fica **não implementado** (registrado, sem envio falso).
4. **Sessão externa persistida e revogável** — o GOAL 014 exige sessão persistida (§4.D/§7.E do comando); a auditoria §6.4 define cookie HMAC ≤12h rotativo com `tokenVersion`. Esta proposta **combina os dois**: cookie HMAC com `sid` + linha persistida por sessão (`ContadorSessaoExterna`), verificada a cada request. É o único acréscimo estrutural ao §6.3 da auditoria (que previa 3 models) e é exigência explícita do comando do GOAL — detalhado em §D e apresentado no G3.
5. **Papel padrão do convite** — `leitura`; `conferencia` só por escolha explícita do administrador (D-5).
6. **Sem dados contábeis nesta entrega** — o único conteúdo autenticado do portal no 014 é a **lista de lojas vinculadas** (prova de identidade/escopo). Competências, documentos, pacotes e dashboard são GOAL 015.

---

## A. Identidade externa — `ContadorUsuario`

Identidade dedicada, **sem nenhuma relação com `AdminUser`/`AdminUserStore`** e sem permissões internas implícitas.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `String @id @default(cuid())` | ID técnico; é o `atorId` dos eventos (nunca e-mail/nome) |
| `email` | `String @unique` | Normalizado na aplicação (trim + lowercase) antes de qualquer leitura/escrita |
| `nome` | `String` | Informado no aceite do convite |
| `senhaHash` | `String` | bcrypt custo 12 via `bcryptjs@^3.0.3` (já dependência; mesmo algoritmo/custo do admin interno — `auth.ts:6,31`, `scripts/seed-admin.ts:33`) |
| `status` | `ContadorUsuarioStatus @default(ATIVO)` | enum Prisma `ativo`/`suspenso` (convenção do núcleo: enum com `@map` minúsculo para ciclo de vida) |
| `tokenVersion` | `Int @default(1)` | `++` em suspensão → derruba todas as sessões (G-8/G-10); verificado a cada request |
| `ultimoLoginEm` | `DateTime?` | Último login bem-sucedido |
| `createdAt` / `updatedAt` | `DateTime` | Padrão do núcleo |

- `@@map("contador_usuarios")`.
- **Ausências deliberadas**: sem `role`, sem `lojaId`, sem `storeAccess`, sem FK para `AdminUser`, sem qualquer permissão do ERP. A identidade externa não autentica nenhuma rota interna por construção (cookie e verificador distintos).
- Relações inversas: `acessos ContadorAcesso[]`, `sessoes ContadorSessaoExterna[]`.

## B. Vínculo contador ↔ empresa/loja — `ContadorAcesso`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `String @id @default(cuid())` | |
| `usuarioId` | `String` + FK → `ContadorUsuario.id` | `onDelete: Restrict` (trilha preservada; ninguém é apagado no MVP) |
| `storeId` | `String` + FK → `Store.id` | `onDelete: Restrict` (mesma política das FKs do núcleo — `migration.sql:246-251` da 0014) |
| `papel` | `ContadorPapelExterno` | enum `leitura`/`conferencia` — papel externo mínimo, **nenhum papel "all"** |
| `status` | `ContadorAcessoStatus @default(ATIVO)` | enum `ativo`/`suspenso`/`revogado` |
| `concedidoPorId` | `String` | `AdminUser.id` técnico de quem concedeu |
| `concedidoEm` | `DateTime @default(now())` | Ativação = criação/reconcessão do vínculo |
| `suspensoEm` / `suspensoPorId` | `DateTime?` / `String?` | Suspensão temporária (reversível) |
| `revogadoEm` / `revogadoPorId` | `DateTime?` / `String?` | Revogação (terminal; nova concessão reativa a **mesma linha**) |
| `createdAt` / `updatedAt` | `DateTime` | |

- `@@unique([usuarioId, storeId])` — um vínculo por par usuário↔loja (canônico, §6.3 da auditoria). Reconcessão após revogação **atualiza a linha existente** (status → `ativo`, novo `papel`, `concedidoPorId/Em` renovados, campos de suspensão/revogação limpos); a trilha fica nos eventos.
- `@@index([storeId, status])` (listagem admin por loja) · `@@index([usuarioId, status])` (lojas do escopo do contador).
- `@@map("contador_acessos")`.
- Suspensão do vínculo: acesso àquela loja bloqueado **na próxima request** (checagem por request), demais lojas intactas. Revogação: idem, terminal.

## C. Convite — `ContadorConvite`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `String @id @default(cuid())` | |
| `email` | `String` | Normalizado (trim + lowercase); o aceite vincula a conta a **este** e-mail, resolvido no servidor |
| `storeId` | `String` + FK → `Store.id` | `Restrict`. Convite é de **uma** loja: aceite cria vínculo somente com o `storeId` do convite (teste loja A × loja B) |
| `papel` | `ContadorPapelExterno @default(LEITURA)` | Papel que o vínculo receberá no aceite |
| `tokenHash` | `String @unique` | **sha256 hex do token** — o token bruto (32 bytes, `crypto.randomBytes`, base64url) é retornado **uma vez** na criação e **nunca** persistido nem logado |
| `expiraEm` | `DateTime` | Criação + **72h** (G-2) |
| `usadoEm` | `DateTime?` | Uso único: preenchido na transação de aceite |
| `revogadoEm` / `revogadoPorId` | `DateTime?` / `String?` | Revogação administrativa |
| `criadoPorId` | `String` | `AdminUser.id` do emissor |
| `createdAt` / `updatedAt` | `DateTime` | |

- `@@index([email, storeId])` (canônico) · `@@index([storeId, createdAt])` (listagem admin).
- **Índice parcial único (SQL direto, fora da expressividade do Prisma — mesmo estilo hand-written da 0014):**
  `CREATE UNIQUE INDEX … ON contador_convites ("email","storeId") WHERE "usadoEm" IS NULL AND "revogadoEm" IS NULL` — garante fisicamente **no máximo 1 convite aberto por (e-mail, loja)**; criar novo convite revoga/expira o anterior na mesma transação (aplicação) e o índice veda corrida.
- `@@map("contador_convites")`.
- Aceite transacional (anti-replay e anti-corrida): `UPDATE … SET usadoEm=now() WHERE id=? AND usadoEm IS NULL AND revogadoEm IS NULL AND expiraEm > now()` → `count == 1` é a única vitória possível; o perdedor recebe falha honesta ("convite já utilizado").

## D. Sessão externa revogável — `ContadorSessaoExterna`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `String @id @default(cuid())` | É o `sid` do cookie |
| `usuarioId` | `String` + FK → `ContadorUsuario.id` | `Restrict` |
| `expiraEm` | `DateTime` | ≤12h da criação; estendida na rotação (sliding) |
| `revogadoEm` | `DateTime?` | Logout, revogação administrativa, suspensão da identidade (revogação em massa) |
| `ultimoUsoEm` | `DateTime?` | Atualizado por request autenticada (best-effort) |
| `ipHash` | `String?` | **Minimizado**: sha256 salgado truncado (16 hex), precedente `legacy-session.ts:140-146` — IP bruto nunca |
| `userAgentResumo` | `String?` | **Minimizado**: UA truncado (≤200 chars) |
| `createdAt` / `updatedAt` | `DateTime` | `createdAt` = instante do login (trilha durável de acessos) |

- `@@index([usuarioId])` (revogação em massa / listagem) · `@@index([expiraEm])` (higiene/expiração).
- `@@map("contador_sessoes_externas")`.
- **Sem `acessoId`/`storeId` de propósito**: a loja é parâmetro de rota **validado a cada request** contra `ContadorAcesso` ativo (G-1/G-3, auditoria §7.1) — a sessão identifica a pessoa, não autoriza loja alguma.

### D.1 Formato do cookie (Edge-safe, espelha `legacy-session.ts` e `intent.ts`)

- Nome: **`assistec_contador_ext_session`** (distinto do interno NextAuth, do legado `assistec_contador_session` e do admin `assistec_admin_session`).
- Valor: `base64url(payload) + "." + base64url(assinatura)`, payload `{ v: 1, sid, iat, exp }`:
  - assinatura HMAC-SHA256 com **Web Crypto** (o gate de páginas do GOAL 015 rodará no proxy/Edge — `legacy-session.ts:4`);
  - chave derivada com separação de domínio (padrão `intent.ts:98-102`): `HMAC(CONTADOR_EXTERNO_SESSION_SECRET, "omni.contador.externo.session/v1")`;
  - **segredo dedicado, sem fallback**: `CONTADOR_EXTERNO_SESSION_SECRET` ausente → rotas de auth externa respondem 503 `unavailable` (fail-closed, como `route.ts:66-70`; **proibido** o anti-padrão de fallback de `proxy.ts:26-27`).
- Flags: `httpOnly: true`, `secure` em produção, `sameSite: "lax"`, `path: "/"` — desvio documentado e inevitável: os handlers vivem em `/api/contador-externo/**` e as páginas em `/contador-externo/**`; o único prefixo comum é `/` (mesmo padrão do legado, `legacy-session.ts:119`). O nome exclusivo isola o escopo; handlers internos nunca leem este cookie e vice-versa (teste cruzado G-7).
- **Validação por request** (falha fechada em qualquer etapa): formato → assinatura (tempo constante, `crypto.subtle.verify`) → `exp` do payload → lookup da sessão por `sid` → `revogadoEm IS NULL` → `expiraEm > now()` → `usuario.status = ATIVO` e `usuario.tokenVersion` coerente → (rotas de loja) `ContadorAcesso` `ativo` para a loja.
- **Rotação**: após 50% da vida, nova emissão (novo `iat`/`exp` no cookie + `expiraEm` na linha), mesmo `sid`.
- **Encerramento**: logout revoga a linha; suspensão da identidade revoga **todas** as linhas do usuário + `tokenVersion++`; suspensão/revogação de vínculo bloqueia a loja na request seguinte (checagem por request).

## E. Auditoria — eventos mínimos

Dois canais, conforme a natureza do evento (decisão de desenho justificada abaixo):

**E.1 `ContadorEvento` (DB, append-only) — eventos com loja.** `competenciaId` é `NULL` (coluna opcional desde a 0014, `schema.prisma:2799` — "evento sem competência exige apenas storeId válido"); `atorTipo` usa os valores já reservados `"interno"|"externo"` (`schema.prisma:2805`); `ip`/`userAgent` passam a ser preenchidos **no caminho externo** com valores minimizados (ipHash / UA resumido) — correção planejada de P1-3; metadata por allowlist, **nunca** com token, e-mail ou segredo.

| Evento | Quando | `atorTipo` |
|---|---|---|
| `convite_criado` | Admin cria convite (sem URL/token em metadata) | `interno` |
| `convite_revogado` | Admin revoga | `interno` |
| `convite_expirado` | Tentativa de uso de convite expirado (deduplicado por convite) | `externo` |
| `convite_aceito` | Aceite concluído | `externo` |
| `acesso_concedido` | Vínculo criado/reativado (inclui troca de responsável — G-10) | `interno` |
| `acesso_suspenso` / `acesso_reativado` | Suspensão / reversão do vínculo | `interno` |
| `acesso_revogado` | Revogação do vínculo | `interno` |
| `usuario_suspenso` / `usuario_reativado` | Suspensão/reativação da identidade (com `storeId` de origem da ação) | `interno` |
| `sessao_revogada` | Revogação administrativa vinculada a uma loja | `interno` |

**E.2 Log estruturado JSON de 1 linha (padrão `legacy-session.ts:175-185`) — eventos de identidade sem loja natural.** `ContadorEvento.storeId` é `NOT NULL`; login/logout/falha são da identidade, não de uma loja. Canal: `console.*` JSON com `ipHash`, **sem e-mail, sem token, sem cookie**: `login_externo_sucesso`, `login_externo_falha` (genérico, anti-enumeração), `logout_externo`, `sessao_externa_expirada`, `rate_limit_externo`. A **trilha durável** de login é a própria linha `ContadorSessaoExterna` (`createdAt`, `ipHash`, `userAgentResumo`, `revogadoEm`) — prova de acesso persistida no banco, não só em log.

---

## 1. Modelos (resumo)

3 enums novos (`ContadorUsuarioStatus`, `ContadorPapelExterno`, `ContadorAcessoStatus`) + 4 models novos (`ContadorUsuario`, `ContadorConvite`, `ContadorAcesso`, `ContadorSessaoExterna`) + 2 campos de relação virtual em `Store` (`contadorConvites`, `contadorAcessos` — sem SQL, mesmo precedente da 0014 em `schema.prisma:117-120`). **Zero alteração** em models/tabelas existentes.

## 2–4. Campos, tipos e relações

Ver §A–§D. Bloco Prisma proposto (anexo ao final de `prisma/schema.prisma`, após `ContadorEvento`):

```prisma
enum ContadorUsuarioStatus {
  ATIVO    @map("ativo")
  SUSPENSO @map("suspenso")
}

enum ContadorPapelExterno {
  LEITURA     @map("leitura")
  CONFERENCIA @map("conferencia")
}

enum ContadorAcessoStatus {
  ATIVO    @map("ativo")
  SUSPENSO @map("suspenso")
  REVOGADO @map("revogado")
}

model ContadorUsuario {
  id            String                @id @default(cuid())
  email         String                @unique
  nome          String
  senhaHash     String
  status        ContadorUsuarioStatus @default(ATIVO)
  tokenVersion  Int                   @default(1)
  ultimoLoginEm DateTime?
  createdAt     DateTime              @default(now())
  updatedAt     DateTime              @updatedAt
  acessos       ContadorAcesso[]
  sessoes       ContadorSessaoExterna[]

  @@map("contador_usuarios")
}

model ContadorConvite {
  id            String               @id @default(cuid())
  email         String
  storeId       String
  store         Store                @relation(fields: [storeId], references: [id], onDelete: Restrict)
  papel         ContadorPapelExterno @default(LEITURA)
  tokenHash     String               @unique
  expiraEm      DateTime
  usadoEm       DateTime?
  revogadoEm    DateTime?
  revogadoPorId String?
  criadoPorId   String
  createdAt     DateTime             @default(now())
  updatedAt     DateTime             @updatedAt

  @@index([email, storeId])
  @@index([storeId, createdAt])
  @@map("contador_convites")
}

model ContadorAcesso {
  id             String               @id @default(cuid())
  usuarioId      String
  usuario        ContadorUsuario      @relation(fields: [usuarioId], references: [id], onDelete: Restrict)
  storeId        String
  store          Store                @relation(fields: [storeId], references: [id], onDelete: Restrict)
  papel          ContadorPapelExterno
  status         ContadorAcessoStatus @default(ATIVO)
  concedidoPorId String
  concedidoEm    DateTime             @default(now())
  suspensoEm     DateTime?
  suspensoPorId  String?
  revogadoEm     DateTime?
  revogadoPorId  String?
  createdAt      DateTime             @default(now())
  updatedAt      DateTime             @updatedAt

  @@unique([usuarioId, storeId])
  @@index([storeId, status])
  @@index([usuarioId, status])
  @@map("contador_acessos")
}

model ContadorSessaoExterna {
  id              String          @id @default(cuid())
  usuarioId       String
  usuario         ContadorUsuario @relation(fields: [usuarioId], references: [id], onDelete: Restrict)
  expiraEm        DateTime
  revogadoEm      DateTime?
  ultimoUsoEm     DateTime?
  ipHash          String?
  userAgentResumo String?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  @@index([usuarioId])
  @@index([expiraEm])
  @@map("contador_sessoes_externas")
}
```

## 5. Índices

`contador_usuarios_email_key` (unique) · `contador_convites_tokenHash_key` (unique) · `contador_convites_aberto_uk` (**unique parcial** `WHERE usadoEm IS NULL AND revogadoEm IS NULL`, SQL direto) · `(email, storeId)` · `(storeId, createdAt)` em convites · `contador_acessos_usuarioId_storeId_key` (unique) · `(storeId, status)` · `(usuarioId, status)` em acessos · `(usuarioId)` · `(expiraEm)` em sessões.

## 6. Unique constraints

`ContadorUsuario.email` · `ContadorConvite.tokenHash` · `ContadorConvite (email, storeId)` **parcial, somente convites abertos** · `ContadorAcesso (usuarioId, storeId)`.

## 7. Cascatas

Todas as FKs `ON DELETE RESTRICT / ON UPDATE CASCADE` (política do núcleo: nada é apagado; trilha preservada). **Nenhum `Cascade`** novo — o único Cascade do domínio permanece o de `ContadorPacoteItem`.

## 8. Política de exclusão

Sem hard delete no MVP: identidade se encerra por `status`/`tokenVersion`; vínculo por `status`/`revogadoEm`; convite por `usadoEm`/`revogadoEm`/expiração; sessão por `revogadoEm`/expiração. Eliminação LGPD do titular-contador = anonimização (e-mail/nome) com trilha preservada — fluxo administrativo documentado no GOAL 019 (auditoria §10.3), **não** nesta entrega.

## 9. Compatibilidade multi-loja

- `storeId` com FK real a `stores` em convite e vínculo; a loja **nunca** vem do cliente: admin opera sobre a loja ativa autenticada (`requireContadorScope` + cookie de loja interno, `scope.ts:21-28`); rotas externas resolvem a loja somente via `ContadorAcesso` ativo (G-1).
- Um contador ↔ N lojas; uma loja ↔ N contadores (N:N via `ContadorAcesso`).
- Body/query com `storeId, lojaId, papel, role, userId, atorId, autorId, usuarioId` → 400 (padrão `rotas.ts:16-41`, lista própria do módulo externo).
- Convite da loja A nunca cria vínculo com loja B: `storeId` sai da linha do convite no servidor; teste dedicado.

## 10. Migration SQL esperada

Arquivo: `prisma/migrations/0015_contador_identidade_externa/migration.sql` (sequência verificada: última é `0014_contador_hub_nucleo`). Estilo idempotente da 0014: cabeçalho de governança + rollback comentado, guards `DO $$`, `IF NOT EXISTS` em tudo. Esqueleto:

```sql
-- Enums (guard pg_type, padrão 0014)
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContadorUsuarioStatus')
  THEN CREATE TYPE "ContadorUsuarioStatus" AS ENUM ('ativo','suspenso'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContadorPapelExterno')
  THEN CREATE TYPE "ContadorPapelExterno" AS ENUM ('leitura','conferencia'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContadorAcessoStatus')
  THEN CREATE TYPE "ContadorAcessoStatus" AS ENUM ('ativo','suspenso','revogado'); END IF; END $$;

CREATE TABLE IF NOT EXISTS "contador_usuarios" (
  "id" TEXT NOT NULL, "email" TEXT NOT NULL, "nome" TEXT NOT NULL,
  "senhaHash" TEXT NOT NULL,
  "status" "ContadorUsuarioStatus" NOT NULL DEFAULT 'ativo',
  "tokenVersion" INTEGER NOT NULL DEFAULT 1,
  "ultimoLoginEm" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contador_usuarios_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX IF NOT EXISTS "contador_usuarios_email_key" ON "contador_usuarios"("email");

CREATE TABLE IF NOT EXISTS "contador_convites" (
  "id" TEXT NOT NULL, "email" TEXT NOT NULL, "storeId" TEXT NOT NULL,
  "papel" "ContadorPapelExterno" NOT NULL DEFAULT 'leitura',
  "tokenHash" TEXT NOT NULL, "expiraEm" TIMESTAMP(3) NOT NULL,
  "usadoEm" TIMESTAMP(3), "revogadoEm" TIMESTAMP(3), "revogadoPorId" TEXT,
  "criadoPorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contador_convites_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX IF NOT EXISTS "contador_convites_tokenHash_key" ON "contador_convites"("tokenHash");
CREATE INDEX IF NOT EXISTS "contador_convites_email_storeId_idx" ON "contador_convites"("email","storeId");
CREATE INDEX IF NOT EXISTS "contador_convites_storeId_createdAt_idx" ON "contador_convites"("storeId","createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "contador_convites_aberto_uk"
  ON "contador_convites"("email","storeId") WHERE "usadoEm" IS NULL AND "revogadoEm" IS NULL;

CREATE TABLE IF NOT EXISTS "contador_acessos" (
  "id" TEXT NOT NULL, "usuarioId" TEXT NOT NULL, "storeId" TEXT NOT NULL,
  "papel" "ContadorPapelExterno" NOT NULL,
  "status" "ContadorAcessoStatus" NOT NULL DEFAULT 'ativo',
  "concedidoPorId" TEXT NOT NULL,
  "concedidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "suspensoEm" TIMESTAMP(3), "suspensoPorId" TEXT,
  "revogadoEm" TIMESTAMP(3), "revogadoPorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contador_acessos_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX IF NOT EXISTS "contador_acessos_usuarioId_storeId_key"
  ON "contador_acessos"("usuarioId","storeId");
CREATE INDEX IF NOT EXISTS "contador_acessos_storeId_status_idx" ON "contador_acessos"("storeId","status");
CREATE INDEX IF NOT EXISTS "contador_acessos_usuarioId_status_idx" ON "contador_acessos"("usuarioId","status");

CREATE TABLE IF NOT EXISTS "contador_sessoes_externas" (
  "id" TEXT NOT NULL, "usuarioId" TEXT NOT NULL,
  "expiraEm" TIMESTAMP(3) NOT NULL, "revogadoEm" TIMESTAMP(3),
  "ultimoUsoEm" TIMESTAMP(3), "ipHash" TEXT, "userAgentResumo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contador_sessoes_externas_pkey" PRIMARY KEY ("id"));
CREATE INDEX IF NOT EXISTS "contador_sessoes_externas_usuarioId_idx" ON "contador_sessoes_externas"("usuarioId");
CREATE INDEX IF NOT EXISTS "contador_sessoes_externas_expiraEm_idx" ON "contador_sessoes_externas"("expiraEm");

-- FKs via guard DO $$ pg_constraint (padrão 0014), todas ON DELETE RESTRICT ON UPDATE CASCADE:
--   contador_convites.storeId        → stores.id
--   contador_acessos.usuarioId       → contador_usuarios.id
--   contador_acessos.storeId         → stores.id
--   contador_sessoes_externas.usuarioId → contador_usuarios.id
```

Determinística, aditiva, zero escrita em tabelas/dados existentes. SQL final revisado por Rafael antes do push (gate G-DADOS-SCHEMA).

## 11. Rollback lógico

Documentado no cabeçalho da migration (comentado, padrão 0014): (1) desligar o fluxo externo removendo `CONTADOR_EXTERNO_SESSION_SECRET` (rotas morrem fail-closed 503); (2) `DROP TABLE IF EXISTS contador_sessoes_externas, contador_acessos, contador_convites, contador_usuarios` (ordem das FKs); (3) `DROP TYPE IF EXISTS` dos 3 enums. Nenhuma tabela pré-existente é tocada pelo rollback; nenhum dado anterior ao GOAL é afetado. Aplicação segue o processo oficial do projeto (0014: `npm run db:push` em homologação; produção via fluxo oficial de `prisma migrate deploy`, janela coordenada — **nunca** `db push` em produção).

## 12. Riscos

| # | Risco | Mitigação |
|---|---|---|
| R-1 | Vazamento de token de convite em log/URL | Token exibido 1× ao admin; só hash no banco; logs estruturados sem path/token; página de aceite não loga; `Cache-Control: private, no-store` |
| R-2 | Enumeração de e-mail (login/aceite) | Erro genérico; `bcrypt.compare` **sempre** executado (hash dummy quando usuário inexistente — corrige o padrão `auth.ts:28-32` no código novo); mensagens idênticas; rate limit |
| R-3 | Rate limit em memória ineficaz em serverless (P1-2) | Mesmo shape do util do GOAL 003 endurecido (chave e-mail+IP, XFF confiável, `Retry-After`); limitação documentada; alerta de pico fica para o 019 |
| R-4 | Cookie interno aceito em rota externa (G-7) | Nome/verificador/segredo distintos; teste cruzado obrigatório nas duas direções |
| R-5 | Sessão sem revogação efetiva | Linha persistida verificada por request + `tokenVersion++` + revogação em massa na suspensão |
| R-6 | Corrida no aceite (replay concorrente) | Update condicional atômico (`usadoEm IS NULL…`) dentro de `$transaction`; índice parcial único de convite aberto |
| R-7 | Admin da loja A suspende identidade que atende loja B | Ação elevada + evento com `storeId` de origem; reativação igualmente auditada; revisão no hardening (019) |
| R-8 | `path:"/"` do cookie externo | Nome exclusivo + handlers internos nunca leem; SameSite lax; documentado (D.1) |
| R-9 | Env ausente em produção | Fail-closed 503 nas rotas de auth externa; portal simplesmente inerte; `.env.example` documenta sem valor |

## 13. Arquivos a alterar (previsão completa)

**Schema/migration:** `prisma/schema.prisma` (blocos novos ao final + 2 relações virtuais em `Store`) · `prisma/migrations/0015_contador_identidade_externa/migration.sql` (novo).

**Domínio (`lib/contador/auth-externa/**`, novo, + testes colocalizados):** `usuarios.ts` (criar/ativar/suspender/reativar, e-mail normalizado, hash bcrypt), `convites.ts` (criar/listar/revogar/aceitar — aceite transacional), `sessao.ts` (cookie Web Crypto, criar/validar/rotacionar/revogar/logout), `escopo-externo.ts` (variante nominal `ContadorScopeExterno` com `unique symbol`, espelhando `scope-core.ts`), `rate-limit.ts` (shape do GOAL 003, chave e-mail+IP), `eventos.ts` (append `ContadorEvento` com ip/UA minimizados), `repo-prisma.ts` (porta injetável estilo `FechamentoTxClient`), `http.ts` (mapeamento de falhas, espelha `documentos/http.ts`).
**Pequenos acréscimos em `lib/contador/` existentes:** `status/permissoes.ts` (`podeGerenciarAcessoExterno` = `hubs.contador && (admin.masterConsole || financeiro.edit)`, mesmo critério de `podeConferir` — **sem** criar permissão nova no catálogo).

**APIs (`app/api/contador-externo/**`, novo):**
- Externas (sessão externa): `auth/login` POST · `auth/logout` POST · `auth/sessao` GET · `lojas` GET (só as lojas do escopo — **nenhum dado contábil**).
- Públicas: `convite/[token]` GET (estado honesto: válido/expirado/revogado/utilizado — sem enumeração; e-mail exibido mascarado) · `convite/aceitar` POST (transacional).
- Internas (admin ERP autenticado + `podeGerenciarAcessoExterno`, loja = loja ativa da sessão interna): `convites` POST (retorna URL+token **uma única vez**) · `convites` GET (pendentes/expirados/usados/revogados, **sem** tokenHash) · `convites/[id]/revogar` POST · `acessos` GET · `acessos/[id]/suspender` · `acessos/[id]/reativar` · `acessos/[id]/revogar` POST · `usuarios/[id]/suspender` · `usuarios/[id]/reativar` POST.

**Páginas (`app/contador-externo/**`, novo — layout próprio, zero providers do ERP):** `login/page.tsx` · `convite/[token]/page.tsx` (todos os estados de convite) · `page.tsx` (lista de lojas do escopo — mínima autenticada) · `sessao-expirada/page.tsx` · mensagens de conta suspensa/acesso revogado **sem** confirmar existência.

**UI interna (`components/dashboard/contador/**`):** realizar a seção Permissões já existente como preview (`contador-hub-preview.tsx:916-960`) → novo `permissoes/contador-permissoes-real.tsx` (gerar convite com loja+papel+e-mail; listar convites com revogar; listar acessos com suspender/reativar/revogar) + chamada no `SECTION_RENDERERS`.

**Infra/config:** `proxy.ts` — **trecho mínimo e novo**: liberar o segmento `/contador-externo/**` do selo de assinatura (hoje cairia no redirect `/meu-plano`, `proxy.ts:103-112`); páginas/handlers se autoprotegem; o gate de sessão externa **no proxy** é GOAL 015 (gate G-AUTH). ⚠️ `proxy.ts` está **fora** da allowlist atual — ampliação da allowlist é ato humano, incluída neste pedido de G3. · `.env.example` (`CONTADOR_EXTERNO_SESSION_SECRET`, sem valor) · `docs/status/MOCKS_TRACKING.md` (MOCK-09: seção Permissões deixa de ser UI-mock) · `docs/contador/CONTADOR_HUB_ADRS_PROPOSTOS_001.md` (ADR-002/008 → Accepted com emendas do G3) · evidência final em `docs/ai-execution/_evidence/`.

**Não serão tocados:** `auth.ts`, `auth.config.ts`, `app/api/auth/**`, portal legado (`/contador`, `/login-contador`), NextAuth, PDV, Caixa, Financeiro, Fiscal, WhatsApp, Marketplace, Operações, `package*.json` (zero dependências novas — `bcryptjs` e Web Crypto já existem).

## 14. Testes (os 24 do comando → arquivos)

`lib/contador/auth-externa/*.test.ts` e `app/api/contador-externo/**/route.test.ts`, padrão vitest com fakes in-memory (sem banco real, sem `vi.mock("@/lib/prisma")` — convenção `vitest.config.ts:13-15`):

1. Identidade separada: nenhuma relação/FK com `AdminUser` (assert de schema/tipo + verificador externo rejeita payload NextAuth). 2. E-mail normalizado (`"  A@B.COM "` → `a@b.com` em criar/login/convite). 3. Convite persiste somente hash (linha tem `tokenHash`, não o token). 4. Token bruto ausente de qualquer campo/serialização. 5. Expiração (72h) falha honestamente. 6. Revogado falha. 7. Segundo uso falha. 8. Dois aceites concorrentes → exatamente um sucesso (update condicional). 9. Convite da loja A nunca cria vínculo com loja B. 10. Interno sem `podeGerenciarAcessoExterno` → 403 ao convidar. 11. `storeId` forjado em body/query → 400/escopo ignorado. 12. Cookie interno (NextAuth/legado) não autentica rotas externas. 13. Sessão externa não autentica rotas internas (`requireContadorScope` intacto). 14. Revogação de sessão derruba a request seguinte. 15. Logout revoga (linha `revogadoEm` + cookie limpo). 16. Identidade suspensa perde acesso (sessões revogadas + 401). 17. Vínculo suspenso perde acesso à loja (403) e mantém as demais. 18. Vínculo revogado: loja some da lista; URL direta → tela genérica. 19. Sessão expirada → 401/tela `sessao-expirada`. 20. Token/URL nunca em logs (assert sobre o logger). 21. Isolamento entre duas lojas (cross-store em todas as rotas externas). 22. Login/aceite não revelam existência de e-mail (mensagens/timing idênticos). 23. Sem `CONTADOR_EXTERNO_SESSION_SECRET` → 503 fail-closed. 24. Nenhuma rota de dados contábeis existe no namespace externo (varredura programática dos handlers + 404 em rotas do 015).

Mais os correlatos: `npm test` (suíte), `npm run typecheck`, ESLint dos arquivos alterados, `npx prisma format && npx prisma validate`, build, `node scripts/track.mjs verify --all`, `git diff --check`.

## 15. Dados que NUNCA serão armazenados

Token de convite em texto puro (nem em banco, log, evento ou resposta após a criação) · senha em claro · token/cookie de sessão completo (banco guarda `sid` + metadados; o segredo HMAC fica em env) · IP bruto (somente hash salgado truncado) · e-mail/nome em `ContadorEvento`/metadata/logs (ator = ID técnico) · PIN global · qualquer dado contábil/fiscal/financeiro do domínio nesta entrega · `storageRef` ou segredos em qualquer resposta externa.

## 16. Impacto em produção

- **Banco**: +4 tabelas, +3 enums, +FKs novas apontando para `stores`/`contador_usuarios`. Zero alteração em tabelas existentes, zero alteração de dados, zero backfill. Migration aditiva e reversível (§11).
- **Aplicação**: sem env `CONTADOR_EXTERNO_SESSION_SECRET`, as rotas externas respondem 503 e nada mais muda — rollout inerte por padrão. Legado (`/contador`, PIN), NextAuth e ERP intocados.
- **Operação**: convite entregue por link copiável (sem provider de e-mail); recuperação de acesso **administrativa** (revogar + novo convite) — recomendação desta proposta para a pergunta §11.3-3 da auditoria; self-service adiado.
- **Pendências fora de código**: configurar `CONTADOR_EXTERNO_SESSION_SECRET` no ambiente (segredo novo, provisionado pelo processo oficial — nunca commitado); CORS do bucket R2 **não** é necessário no 014 (sem upload externo — D-6).
- **GOAL 015 não é implementado**: nenhum dashboard, documento, competência, download ou fechamento no namespace externo; portal de dados só no 015.

---

## Requisitos de segurança (checklist do comando)

- [x] Token de convite com entropia criptográfica (`crypto.randomBytes(32)`, base64url)
- [x] Persistência somente do hash (sha256 hex, `tokenHash @unique`)
- [x] Comparação resistente a timing (HMAC via `crypto.subtle.verify`; senha via `bcrypt.compare` sempre executada; hash lookup por índice único — segredo não é comparado em claro)
- [x] Convite vinculado ao e-mail e ao vínculo correto (conta criada com o e-mail **da linha do convite**, no servidor; vínculo com o `storeId` da linha)
- [x] Convite de uma empresa não aceita vínculo de outra (§9; teste 9)
- [x] Uso único (update condicional atômico + `usadoEm`) · expiração obrigatória (72h) · revogação (`revogadoEm`)
- [x] Sessão revogável persistida (`ContadorSessaoExterna` verificada por request)
- [x] Cookie externo diferente do interno (nome/segredo/verificador) · HttpOnly · Secure em produção · SameSite `lax`
- [x] Nenhuma autorização baseada apenas em cookie `storeId` (loja só via `ContadorAcesso` ativo, por request)
- [x] Nenhuma permissão `all` (papéis `leitura`/`conferencia`; admin de convites exige permissão interna elevada existente)
- [x] Falha fechada (sem env → 503; qualquer etapa de validação falha → 401/403 genérico)

— Fim da proposta GOAL 014 (aguardando G3).
