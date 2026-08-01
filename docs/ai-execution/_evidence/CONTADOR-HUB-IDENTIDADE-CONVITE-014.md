# CONTADOR-HUB-IDENTIDADE-CONVITE-014 — evidência de implementação local (pré-push)

- protocolo: AEP/1.0-R2 · trilha: `contador` · GOAL: `CONTADOR-HUB-IDENTIDADE-CONVITE-014` (tentativa 1/3)
- executor: Kimi (continuação da sessão anterior; WIP da proposta de schema preservado)
- data: 2026-08-01 (UTC)
- worktree/branch: `C:/Projetos/contador-014-identidade-convite` · `feat/contador-identidade-convite-014`
- base: `origin/main = 950cc18b192baa5599f93ce1d4e11e16662a86ac` (conforme proposta)
- autorização G3 (humano, nesta sessão): **"AUTORIZO A MIGRATION ADITIVA E A IMPLEMENTACAO LOCAL DO GOAL 014"**
- natureza: implementação LOCAL completa (schema aditivo + domínio + rotas + páginas + UI interna + docs). **Sem push, sem commit, sem `close`** — parada no gate `READY_TO_PUSH_014` (não definido).

## 1. Continuação a partir do WIP

- `git status --short` na abertura da sessão: único WIP = `docs/contador/CONTADOR_HUB_IDENTIDADE_CONVITE_014_SCHEMA_PROPOSAL.md` (untracked, proposta G3) — **preservado integralmente**.
- Nenhum `reset/restore/checkout/stash` em WIP alheio. Único `git checkout -- prisma/schema.prisma` executado reverteu **exclusivamente** churn de formatação global causado por `npx prisma format` rodado pelo próprio executor minutos antes (arquivo sem WIP de terceiros); as adições do GOAL foram reaplicadas em seguida com diff mínimo (+144 linhas).
- Fontes canônicas lidas: GOAL ativo, proposta de schema (411 linhas), `CONTADOR_HUB_PORTAL_EXTERNO_ROADMAP_014_019.md` (comando 014), `import/contador/MANIFEST.json` (os arquivos `COMANDOS.md`/`MASTERPLAN.md`/`RESUMO.md`/`reports/` não existem nesta worktree — só o MANIFEST; o comando do 014 consta no roadmap registrado pelo 013).

## 2. Entregue (tudo dentro da allowlist)

**Schema/migration:**
- `prisma/schema.prisma` (+144): 3 enums (`ContadorUsuarioStatus`, `ContadorPapelExterno`, `ContadorAcessoStatus`) + 4 models (`ContadorUsuario`, `ContadorConvite`, `ContadorAcesso`, `ContadorSessaoExterna`) ao final + 2 relações virtuais em `Store` (`contadorConvites`, `contadorAcessos`). Zero alteração em models existentes.
- `prisma/migrations/0015_contador_identidade_externa/migration.sql` (novo): estilo idempotente da 0014 — cabeçalho de governança, rollback comentado, guards `DO $$`/`IF NOT EXISTS`, índice parcial único `contador_convites_aberto_uk` (≤1 convite aberto por e-mail+loja), FKs só `RESTRICT`.

**Domínio — `lib/contador/auth-externa/` (novo, 10 módulos + fakes + 8 arquivos de teste):**
`tipos.ts` · `usuarios.ts` (e-mail normalizado, bcrypt custo 12, suspensão = `tokenVersion++` + revogação em massa transacional) · `convites.ts` (token 32B retornado 1×, só sha256 persistido, aceite com update condicional atômico anti-corrida, vínculo sempre com e-mail/storeId DA LINHA) · `sessao.ts` (cookie `assistec_contador_ext_session`, HMAC Web Crypto com derivação de domínio, payload `{v,sid,tv,iat,exp}`, validação por request em cadeia fail-closed, rotação após 50% da vida, sem segredo → indisponível sem fallback) · `acessos.ts` · `escopo-externo.ts` (escopo nominal externo, vínculo ATIVO checado por request) · `rate-limit.ts` (chave e-mail+IP) · `eventos.ts` (E.1 via `ContadorEvento` com ip/UA minimizados + E.2 log JSON sem e-mail/token) · `repo-prisma.ts` (porta injetável, espelha `FechamentoTxClient`) · `http.ts` (falhas → HTTP seguro, chaves proibidas próprias).
- `lib/contador/status/permissoes.ts`: `podeGerenciarAcessoExterno` = `hubs.contador && (admin.masterConsole || financeiro.edit)` (opcional/não-enumerável no tipo para não quebrar fixtures/testes existentes — ver desvio 2 de §4).

**Rotas — `app/api/contador-externo/` (novo, 14 handlers + `_shared.ts` + 5 arquivos de teste):**
públicas `convite/[token]` GET, `convite/aceitar` POST · externas `auth/login`, `auth/logout`, `auth/sessao` GET, `lojas` GET · internas (admin ERP + `podeGerenciarAcessoExterno`, loja = loja ativa da sessão interna) `convites` POST/GET, `convites/[id]/revogar`, `acessos` GET, `acessos/[id]/suspender|reativar|revogar`, `usuarios/[id]/suspender|reativar`. Todas com `Cache-Control: private, no-store`, `force-dynamic`, chaves proibidas → 400, rate limit 429 + `Retry-After`, 503 fail-closed sem segredo.

**Páginas — `app/contador-externo/` (novo, 9 arquivos):** layout próprio zero providers do ERP · `login` · `convite/[token]` (todos os estados, e-mail mascarado) · portal autoprotegido (validação server-side por request; redirect login/sessao-expirada) listando só as lojas vinculadas · `sessao-expirada`. Nenhum dado contábil (GOAL 015 não implementado).

**UI interna:** `components/dashboard/contador/permissoes/contador-permissoes-real.tsx` (novo) — gerar convite (token exibido 1× com copiar), listar/revogar convites, listar/suspender/reativar/revogar acessos, suspensão de identidade com confirmação elevada; 403 → banner somente-leitura. Diff mínimo em `contador-hub-preview.tsx` (renderer da seção Permissões trocado).

**Docs/config:** `.env.example` (`CONTADOR_EXTERNO_SESSION_SECRET`, sem valor, fail-closed documentado) · `docs/status/MOCKS_TRACKING.md` (MOCK-09: Permissões saiu do preview) · `docs/contador/CONTADOR_HUB_ADRS_PROPOSTOS_001.md` (ADR-002/008 → **Accepted** com emendas do G3, datado 2026-07-31).

## 3. Verificação

```
$ npx prisma validate                          → schema válido (com DATABASE_URL/DIRECT_URL dummy; P1012 sem elas é pré-existente)
$ npx prisma generate                          → client regenerado com os 4 models novos
$ npm run typecheck                            → zero erros
$ npx vitest run lib/contador app/api/contador-externo components/dashboard/contador
                                               → 794/794 verdes (45 arquivos)
$ npm test (suíte completa)                    → 4012 passed · 1 arquivo falhou:
    tools/fiscal-dry-run-integrity-proof/proof.test.ts — prova fiscal que exige
    runtime Java externo (verifySignedXmlExternalJava), FORA da allowlist e sem
    qualquer interseção com o diff deste GOAL → falha ambiental pré-existente.
$ npx eslint <todos os caminhos alterados>     → limpo
$ git diff --check                             → OK
$ node scripts/track.mjs verify --all          → sem divergências
$ git status --short                           → 13 caminhos, todos dentro da allowlist
```

Cobertura dos 24 testes do comando (§14 da proposta): cenários de domínio e HTTP implementados (86 testes de domínio + 38 de rota), incluindo aceites concorrentes → 1 sucesso, cross-store em todas as rotas, teste cruzado de cookies nas duas direções, anti-enumeração, token nunca em logs, 503 sem segredo e varredura programática do namespace (sem rotas de dados contábeis).

## 4. Desvios registrados (todos justificados nos módulos)

1. Payload do cookie inclui `tv` (tokenVersion) além de `{v,sid,iat,exp}` — única forma de a checagem "tokenVersion coerente" existir de fato; protegido pelo HMAC.
2. `podeGerenciarAcessoExterno` opcional/não-enumerável no tipo `CapacidadesContador` — campo obrigatório quebraria fixtures e `status-matriz.test.ts` (fora da allowlist de escrita). Follow-up: torná-lo obrigatório quando o teste puder ser ajustado.
3. `papel` aceito no POST interno de convites (escolha explícita do admin, D-5) — a proibição da §9 vale para o caminho externo; a rota interna usa lista própria (§9 menos `papel`).
4. Aceite com conta reutilizada: senha original preservada; rota devolve `sessaoCriada: false` quando a senha do aceite não é a atual (sem revelar nada além do que o portador do convite já provou).
5. Sonda de disponibilidade no aceite falha 503 ANTES de consumir o convite.
6. Helpers HTTP das rotas em `app/api/contador-externo/_shared.ts` (regra de escopo da etapa); domínio permanece em lib.
7. Rotação do cookie ocorre nas APIs; server components não regravam cookie (sessão segue válida até o `exp` original).
8. Nome da loja no portal via `prisma.store` em helper server-only da página (porta injetável cobre só os 5 models do domínio).
9. Evento extra `convite_revogado` com motivo `substituido_por_novo_convite` (trilha honesta da revogação automática da §C).
10. Arquivos de domínio além dos 8 previstos: `tipos.ts`, `acessos.ts`, `fakes.ts` (separação de tipos, vínculos e fake compartilhado, padrão do fechamento).

## 5. Pendências humanas (bloqueiam push/close)

1. **`READY_TO_PUSH_014=true` não definido** → parada neste gate, conforme instrução. Nada foi commitado nem empurrado.
2. **Revisão do SQL da 0015 por Rafael** antes do push (gate G-DADOS-SCHEMA).
3. **Critério de pronto do GOAL file ainda `<PREENCHER>`** — preenchimento é ato humano; o `close`/`check` depende dele.
4. **Provisionar `CONTADOR_EXTERNO_SESSION_SECRET`** nos ambientes pelo processo oficial (nunca commitado).
5. GOAL 015 **não** implementado, conforme instrução.

## 6. Como fechar (quando o humano liberar)

1. Revisar SQL da 0015 + preencher critério de pronto no GOAL + (opcional) ampliar allowlist com `proxy.ts`.
2. Definir `READY_TO_PUSH_014=true`.
3. `git add` por caminho explícito (nunca `git add .`) → commit `goal(contador-014): ...` → `node scripts/track.mjs close contador`.

---

# CONTINUAÇÃO 2026-08-01 — ajustes obrigatórios de segurança do G3 (comando humano)

Comando de continuação (mesmo GOAL, NEW_SESSION, sem reabrir AEP): quatro ajustes
obrigatórios de segurança + bateria de validações + readiness para push.
A autorização G3 ("AUTORIZO A MIGRATION ADITIVA E A IMPLEMENTACAO LOCAL DO GOAL 014")
foi reafirmada com os quatro ajustes como condição.

## 7. Pré-flight da continuação

- Branch/HEAD corretos: `feat/contador-identidade-convite-014` @ `3556e00`
  (`aep(contador): import 6` — commit de ativação citado pelo comando).
- WIP da sessão anterior íntegro e classificado: toda alteração = implementação
  válida do GOAL 014, EXCETO `M lib/fiscal/tax-engine/__snapshots__/calculator.test.ts.snap`
  — `git diff --numstat` VAZIO (zero mudança de conteúdo; ruído de line-ending
  tocado por processo externo). Não descartado, NÃO será staged (stage por caminho).
- Dependências: `node_modules/.package-lock.json` presente, `package.json`/
  `package-lock.json` limpos no git, nenhum processo npm travado, typecheck/testes
  executam — `npm ci` anterior concluído; reinstalação desnecessária.
- `node scripts/track.mjs verify --all` → sem divergências; GOAL 014 ABERTO (tentativa 1/3).

## 8. Ajuste 1 — permissão específica `contador.manageExternalAccess` (sem financeiro.edit)

- `lib/auth/enterprise-permissions.ts` (adaptação mínima autorizada pelo comando):
  nova seção `contador: { manageExternalAccess: boolean }` na matriz — admin (FULL)
  e gerente → `true`; caixa/técnico/vendedor → `false` explícito (o merge usa FULL
  como base; sem o `false` explícito herdariam `true` por acidente — coberto por teste).
- `lib/contador/status/permissoes.ts`: `podeGerenciarAcessoExterno` agora é campo
  OBRIGATÓRIO e enumerável, com predicado
  `acessaHub && (contador.manageExternalAccess || admin.masterConsole)` —
  ZERO referência a `financeiro.edit` (que permanece legitimamente em `podeConferir`,
  GOAL 011). Fixtures dos testes de fechamento/status atualizadas (+1 campo cada).
- TESTE 26 (`lib/contador/auth-externa/permissoes-acesso-externo.test.ts`): matriz por
  papel; admin/gerente podem, caixa/técnico/vendedor não; campo obrigatório/enumerável;
  assert estático de que a expressão do predicado não cita `financeiro`.

## 9. Ajuste 2 — token de convite SOMENTE no fragmento

- Removidos `app/api/contador-externo/convite/[token]/route.ts` (GET com token no
  path) e `app/contador-externo/convite/[token]/` (página dinâmica).
- Novo `POST /api/contador-externo/convite/consultar` — token SOMENTE no body;
  resposta com `Cache-Control: private, no-store` + `Referrer-Policy: no-referrer`
  (o aceitar também ganhou `Referrer-Policy`).
- Nova página ESTÁTICA `app/contador-externo/convite/page.tsx` (`force-static`) +
  `convite-aceite.tsx` (client): lê `#token=` UMA vez, limpa o fragmento com
  `history.replaceState` no mesmo instante, consulta/aceita por POST no body;
  estados honestos sem enumeração; token nunca em log/estado global/URL nova.
- URL gerada pelo POST interno de convites agora é
  `<origin>/contador-externo/convite#token=<token>` (assert no `internas.test.ts`).
- Varredura: nenhuma referência restante a token de convite em path/query.

## 10. Ajuste 3 — migration 0015 determinística

`prisma/migrations/0015_contador_identidade_externa/migration.sql` REESCRITA:
DDL direto, sem `DO $$`, sem `IF NOT EXISTS`, sem lógica de esconder drift —
divergência do banco FALHA em vez de silenciar. Índice parcial
`contador_convites_aberto_uk` mantido: predicado ESTÁVEL sobre estado da linha
(`usadoEm/revogadoEm IS NULL`), não sobre `NOW()`. Expiração/concorrência seguem
na lógica transacional server-side (update condicional atômico). Rollback segue
documentado no cabeçalho. Aplicação: fluxo oficial de migrate — NUNCA `db push`.

## 11. Ajuste 4 — proxy com rotas públicas EXATAS

- Novo módulo puro `lib/contador/auth-externa/proxy-publico.ts`:
  `CONTADOR_EXTERNO_ROTAS_PUBLICAS` = EXATAMENTE `/contador-externo/login`,
  `/contador-externo/convite`, `/contador-externo/sessao-expirada` (match exato,
  sem prefixo) + `isSegmentoContadorExterno`/`isRotaPublicaContadorExterno`.
- `proxy.ts` (trecho mínimo autorizado pelo comando, ajuste 4): antes do selo de
  assinatura, o segmento `/contador-externo/**` passa SEM selo (não é ERP) e com
  `Referrer-Policy: no-referrer`. Nenhuma verificação de sessão externa no proxy
  (GOAL 015); rotas autenticadas se autoprotegem no servidor (fail-closed).
- TESTE 25 (`proxy-publico.test.ts`): lista pública é exatamente as 3 rotas;
  match exato rejeita subpaths/variantes (`/contador-externo/convite/abc`,
  `/contador-externox`, `/contador`); rotas autenticadas não constam como públicas.

## 12. Validações da continuação

```
$ npm run typecheck                            → zero erros
$ npx vitest run lib/contador app/api/contador-externo components/dashboard/contador lib/auth
                                               → 837/837 verdes (48 arquivos)
$ npx prisma validate                          → schema válido
$ npx prisma format (sobre CÓPIA em /tmp)      → executado; NÃO aplicado ao arquivo
    real porque o schema do repo é pré-existente NÃO formatado — aplicar reescreveria
    ~2.800 linhas alheias ao GOAL (churn revertido na sessão anterior). O bloco do
    GOAL 014 é semanticamente idêntico ao formato prisma (diferem só estilo de
    doc-comment e alinhamento de coluna, iguais ao estilo do restante do arquivo).
$ npx eslint <caminhos alterados + proxy.ts>   → limpo (exit 0)
$ git diff --check                             → OK
$ node scripts/track.mjs verify --all          → sem divergências
$ git fetch --prune origin                     → origin/main = 950cc18 (== base do GOAL)
    main NÃO avançou → zero interseção; push será fast-forward sobre a base.
$ npm run build                                → SUCESSO (prisma generate + next build --webpack)
$ npm test (suíte completa, timeout default 5s)→ 4020 passed, 2 failed:
    os 2 failed são os testes-guarda estáticos (ops-inventory-sync-safety e
    whatsapp-legacy-quarantine) por TIMEOUT marginal de 5000ms na varredura
    recursiva do repo sob paralelismo de workers — NÃO asserts quebrados.
    Comprovação exigida pelo comando: (a) isolados → 10/10 VERDES (4.56s);
    (b) suíte completa com --testTimeout=20000 → 4022 passed, 0 failed
    (inclusive a prova fiscal/Java, que falha só sob contenção de máquina).
    Na sessão anterior a suíte default também os teve verdes. Conclusão:
    falha ambiental transitória fora do escopo, comprovada em nova execução.
```

## 13. Readiness (final da continuação)

- **Base**: `origin/main = 950cc18b192baa5599f93ce1d4e11e16662a86ac` — fetch feito;
  main NÃO avançou (0 commits novos) → zero interseção, push fast-forward possível.
- **HEAD**: `3556e00` (`aep(contador): import 6`, ativação) + entrega do GOAL 014
  completa no working tree (21 caminhos, todos classificados).
- **Migration**: `0015_contador_identidade_externa` — aditiva, determinística
  (sem DO $$/IF NOT EXISTS/NOW()), 3 enums + 4 tabelas + FKs RESTRICT; rollback
  documentado; revisão humana do SQL pendente (G-DADOS-SCHEMA).
- **Modelos**: `ContadorUsuario`, `ContadorConvite`, `ContadorAcesso`,
  `ContadorSessaoExterna` + 2 relações virtuais em `Store`. Zero alteração em
  models existentes.
- **Endpoints** (14, todos `/api/contador-externo/**`): públicos `convite/consultar`
  POST, `convite/aceitar` POST · externos `auth/login`, `auth/logout`,
  `auth/sessao` GET, `lojas` GET · internos (admin + `contador.manageExternalAccess`)
  `convites` POST/GET, `convites/[id]/revogar`, `acessos` GET,
  `acessos/[id]/suspender|reativar|revogar`, `usuarios/[id]/suspender|reativar`.
- **Páginas** (`/contador-externo/**`): `login`, `convite` (ESTÁTICA, token só no
  fragmento), `sessao-expirada` (públicas exatas no proxy) + portal home
  autoprotegido (lista de lojas; zero dado contábil).
- **Permissão específica**: `contador.manageExternalAccess` (matriz enterprise;
  admin/gerente). `admin.masterConsole` também administra. ZERO fallback para
  `financeiro.edit` (teste 26).
- **Convite**: token 32B base64url retornado 1×, só sha256 no banco, uso único
  (update condicional atômico), expiração 72h, revogação, índice parcial único de
  convite aberto, link `/contador-externo/convite#token=<token>` + `Referrer-Policy:
  no-referrer`, envio por link copiável (sem SMTP; envio automático não implementado).
- **Sessão**: cookie exclusivo `assistec_contador_ext_session` (HttpOnly, Secure
  em produção, SameSite lax), segredo dedicado `CONTADOR_EXTERNO_SESSION_SECRET`
  sem fallback (ausente → 503 fail-closed), linha persistida verificada por
  request, rotação após 50% da vida, logout/suspensão/revogação efetivos,
  `tokenVersion++` derruba tudo, cookie interno nunca autentica o externo (e
  vice-versa — teste cruzado).
- **Testes**: 837/837 no escopo do GOAL (48 arquivos), incluindo os 26 obrigatórios;
  suíte completa 4022 passed/0 failed (timeout 20s; ver §12 para a marginalidade
  dos 2 guardas no timeout default).
- **TypeScript**: `npm run typecheck` zero erros. **Prisma**: validate OK, generate
  OK, format executado sobre cópia (não aplicado ao arquivo — repo pré-existente
  não formatado; bloco 014 semanticamente idêntico ao formato). **Build**: sucesso.
- **AEP**: `verify --all` sem divergências; GOAL 014 aberto (tentativa 1/3).
- **Segurança**: §15 da proposta honrado (nada de token/senha/IP bruto/e-mail em
  banco, logs ou eventos); chaves proibidas → 400; anti-enumeração; rate limit
  e-mail+IP com `Retry-After`; `Cache-Control: private, no-store` em tudo.
- **Fast-forward**: possível (main == base).
- **Ações necessárias em produção** (humanas): revisar SQL da 0015 (G-DADOS-SCHEMA);
  aplicar migration pelo fluxo oficial `prisma migrate deploy` (NUNCA db push);
  provisionar `CONTADOR_EXTERNO_SESSION_SECRET`; preencher critério de pronto do
  GOAL file; ampliar allowlist formal com `lib/auth/enterprise-permissions*.ts` e
  `proxy.ts` (arquivos tocados sob autorização explícita do comando de
  continuação); NÃO stagear `lib/fiscal/tax-engine/__snapshots__/calculator.test.ts.snap`
  (ruído de line-ending externo, numstat vazio).

