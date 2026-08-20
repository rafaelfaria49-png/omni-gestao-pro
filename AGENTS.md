<!-- AEP:BEGIN -->
## Protocolo de execução — AEP/1.0-R2

Antes de qualquer tarefa neste repositório, leia `docs/ai-execution/ENTRYPOINT.md`.

- início: `node scripts/track.mjs status <trilha>` e depois `node scripts/track.mjs open <trilha>`
- término: `node scripts/track.mjs close <trilha>`
- regra 1: escreva apenas dentro da allowlist impressa pelo `open`.
- regra 2: adicione por caminho explícito — nunca `git add .`, `git add -A` ou `git commit -a`.
- regra 3: gate não liberado no GOAL = pare e peça autorização humana.

O protocolo é OPT-IN: sem `.aep-active` nesta worktree, nada aqui se aplica.
Este bloco é GERADO. A governança completa NÃO está aqui — está em `docs/ai-execution/`.
Adaptador: AGENTS.md — executor genérico (qualquer agente que leia AGENTS.md).
<!-- AEP:END -->

## Cursor Cloud specific instructions

Durable notes for future Cloud Agents. The VM boots from a snapshot with dependencies
already installed (the startup update script runs `npm ci`), a local PostgreSQL 16 with
the schema/seed data, and a gitignored `.env` already present. Standard dev commands live
in `CLAUDE.md` (the `## Commands` section) and `package.json` scripts — use those; the
notes below only cover non-obvious, environment-specific gotchas.

### Node runtime
- The effective runtime is the environment's default **Node v22.14.0** (from `/exec-daemon`,
  which precedes nvm in `PATH` for every shell). `package.json` declares `engines.node: 20.x`,
  but there is no `engine-strict`/`.npmrc`, so npm only warns. Everything (Next 16, React 19,
  Prisma 6, lint, typecheck, the full test suite) works on v22.14.0. Don't fight `PATH` to
  force Node 20 — the `/exec-daemon` node always wins in non-login shells.

### PostgreSQL (must be started each session)
- The app needs a reachable Postgres; it does **not** meaningfully boot without one (Prisma is
  imported directly across core routes). A local PostgreSQL 16 cluster holds the dev data.
- Postgres does **not** auto-start in this container. Start it at the beginning of a session:
  `sudo pg_ctlcluster 16 main start` (idempotent; ignore "already running").
- Connection: DB `omnigestao`, user `postgres`, password `postgres`, host `localhost:5432`.
- The schema, seeded admin, a `loja-1` store, and demo customers persist in the snapshot. To
  (re)create the schema on a fresh DB use `npm run db:push`; verify with `npm run db:smoke`.

### `.env` (gitignored — present in snapshot, not in the repo)
- `.env` is not tracked. If it is ever missing, recreate it with at least:
  `DATABASE_URL` and `DIRECT_URL` pointing at `postgresql://postgres:postgres@localhost:5432/omnigestao`
  (local Postgres has no pgbouncer, so omit `?pgbouncer=true`), plus `AUTH_SECRET`
  (any 32-byte base64url string), `NEXTAUTH_URL=http://localhost:3000`, and
  `ADMIN_DEFAULT_PASSWORD` for the admin seed. All the Stripe/WhatsApp/AI/R2 vars in
  `CLAUDE.md` are optional and only needed to develop those specific modules.

### Store context is required for core write flows
- Core create flows (e.g. creating a customer) fail with a `..._storeId_fkey` foreign-key
  error unless a `Store` row exists. The admin seed (`npm run db:seed-admin`) creates the
  `AdminUser` but **not** a store. A `loja-1` store is already seeded in the snapshot; on a
  fresh DB, the `/dashboard` onboarding wizard ("configure your store") creates one, or insert
  a `Store` row with id `loja-1` directly.

### Login & running the app
- Dev server: `npm run dev` (Next.js on `0.0.0.0:3000`; use `npm run dev:clean` to free the port first).
- Log in at `/login` with `admin@rafacell.com.br` / the `ADMIN_DEFAULT_PASSWORD` from `.env`
  (currently `admin123`).

### Test suite & Java 17
- `npm run test` (Vitest) is fully green. The 5 fiscal integrity-proof tests in
  `tools/fiscal-dry-run-integrity-proof/proof.test.ts` require the **`java` runtime to report
  exactly v17** (they compare against a golden manifest with `externalJava17: true`). OpenJDK 17
  is installed and set as the default `java`/`javac` via `update-alternatives`. If those tests
  ever fail with `externalJava17: false`, check `java -version` is 17 (the VM also has Java 21).

### Lint
- `npm run lint` runs but currently reports pre-existing errors/warnings in the repo's own code
  (unrelated to environment setup). `npm run typecheck` (4 GB heap, already in the script) is clean.
