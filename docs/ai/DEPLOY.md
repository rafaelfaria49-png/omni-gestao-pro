# OmniGestão Pro — Guia de Deploy

---

## 1. Checklist Pré-Deploy

Execute na ordem antes de qualquer push:

```bash
# 1. Verificar tipos TypeScript
npx tsc --noEmit

# 2. Verificar se o build passa
npm run build

# 3. Teste visual manual (ver seção abaixo)
```

### Teste visual obrigatório

- [ ] Abrir `/dashboard` — painel carrega sem erros
- [ ] Testar troca de temas (Light / Soft Ice / Midnight / Black Edition)
- [ ] Abrir `/dashboard/whatsapp` — hub carrega, sem scroll interno, sem barra lateral
- [ ] Abrir `/dashboard/operacoes-v2` — hub carrega, Kanban em grid, sem barra lateral
- [ ] Testar `/dashboard/os` — lista de OS legado funciona
- [ ] Abrir PDV e testar caixa
- [ ] Verificar que não existe scrollbar horizontal em nenhuma página
- [ ] Testar em mobile (responsividade básica)

---

## 2. Deploy via Git

```bash
git add <caminhos explícitos>
git commit -m "feat: descrição da mudança"
git push origin main
```

**Branch principal:** `main`
**Deploy automático:** Vercel detecta push e faz deploy automaticamente.

---

## 3. Banco de Dados (Prisma)

Quando houver mudanças no schema:

```bash
# Gerar migration
npx prisma migrate dev --name "nome_da_migration"

# Atualizar cliente Prisma
npx prisma generate

# Verificar migrations localmente sem aplicar em Production
npx prisma migrate status
```

> ⚠️ Não execute `prisma migrate deploy` manualmente em Production. O único
> executor automático autorizado é `scripts/vercel-build.mjs`, protegido pelo
> contrato fail-closed abaixo.

### Autoridade de migrations na Vercel

O projeto Production canônico é `omni-gestao-pro`. O projeto
`omni-gestao`/`omni-gestao-pi.vercel.app` é legado, permanece ativo por causa de
tráfego residual e não possui autoridade de migration.

O runner exige simultaneamente:

1. `VERCEL_ENV === "production"`;
2. `MIGRATION_AUTHORITY_ENABLED === "true"`;
3. `VERCEL_PROJECT_ID` igual à constante server-only versionada em
   `scripts/migration-authority-guard.mjs`;
4. decisão interna reconhecida pelo guard.

Nome e domínio não concedem autoridade. `VERCEL_PROJECT_PRODUCTION_URL` é
metadado informativo e não participa da autorização.

| Ambiente/identidade | Resultado |
|---|---|
| local, Development ou Preview | `MIGRATION_SKIPPED`; build continua |
| Production canônico sem flag | `MIGRATION_SKIPPED`; build continua |
| Production canônico com flag exata | `MIGRATION_RUN`; baseline e `migrate deploy` executam uma vez |
| Production legado ou terceiro projeto | `MIGRATION_SKIPPED`; build continua, mesmo com flag |
| tentativa explícita com project ID ausente ou ambiente/flag inválidos | `MIGRATION_GUARD_BLOCKED`; build falha fechado |

Os únicos eventos emitidos pelo runner para migrations são
`MIGRATION_RUN`, `MIGRATION_SKIPPED`, `MIGRATION_GUARD_BLOCKED`,
`MIGRATION_SUCCEEDED` e `MIGRATION_FAILED`. Nenhum project ID, secret,
datasource ou domínio é incluído nesses logs.

`MIGRATION_AUTHORITY_ENABLED` está **configurada na Vercel desde 04/08/2026**,
somente no projeto canônico `omni-gestao-pro`, escopo **Production**, no nível do
projeto (não é Shared Environment Variable). O projeto legado e os demais
projetos do time seguem sem a flag.

O contrato foi comprovado em deployments controlados do mesmo commit: o canônico
emitiu `MIGRATION_RUN` → `MIGRATION_SUCCEEDED` com um único `migrate deploy`, e o
legado emitiu `MIGRATION_SKIPPED` sem baseline e sem `migrate deploy`. Evidência:
`docs/audits/DEPLOY_PRODUCTION_MIGRATION_AUTHORITY_ACTIVATION_006.md`.

Consequência operacional: todo deployment Production do canônico passa a executar
`prisma migrate deploy` automaticamente. Migrations só devem chegar à `main` já
revisadas.

---

## 4. Variáveis de Ambiente

Arquivo `.env.local` (não commitado):

```
DATABASE_URL=          # Supabase PostgreSQL
DIRECT_URL=            # Supabase direct connection
NEXTAUTH_SECRET=       # Secret para sessão
NEXTAUTH_URL=          # URL da aplicação
```

Em produção, configurar no painel da Vercel (Settings → Environment Variables).

As System Environment Variables precisam permanecer habilitadas para disponibilizar
`VERCEL_ENV`, `VERCEL_PROJECT_ID` e `VERCEL_PROJECT_PRODUCTION_URL` ao build.
Não copie valores de banco ou project IDs para documentação/logs.

---

## 5. Solução de Problemas Comuns

| Problema | Solução |
|----------|---------|
| `tsc` com erros após integrar hub Lovable | Adicionar pastas problemáticas ao `exclude` do `tsconfig.json` |
| Erro `EPERM` no `prisma generate` | Fechar processos que bloqueiam a pasta `.prisma` e retentar |
| Build falha com módulo não encontrado | Verificar path aliases no `tsconfig.json` |
| Hub não carrega (hydration error) | Garantir `dynamic(..., { ssr: false })` no `page.tsx` do hub |
| Tema não sincroniza | Verificar se `applyGlobalTheme()` atualiza `data-studio-theme` e `localStorage` |
