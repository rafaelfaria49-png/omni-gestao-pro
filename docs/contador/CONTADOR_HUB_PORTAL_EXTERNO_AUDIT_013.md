# CONTADOR HUB — AUDITORIA DO PORTAL EXTERNO (GOAL 013)

| Campo | Valor |
|---|---|
| GOAL | CONTADOR-HUB-PORTAL-EXTERNO-AUDIT-013 |
| Data | 2026-07-31 |
| Executor | Kimi K3 (auditoria read-only de produto, arquitetura e segurança) |
| Base factual | `origin/main = 958698c6b5d9e4c08d31c8a35cb501462c899a9c` (`aep(contador): fecha 012G apos publicacao`) |
| Worktree/branch | `C:/Projetos/contador-013-portal-audit` · `audit/contador-portal-externo-013` |
| Documentos irmãos | `CONTADOR_HUB_PORTAL_EXTERNO_ROADMAP_014_019.md` (roadmap técnico) · `docs/ai-execution/_evidence/CONTADOR-HUB-PORTAL-EXTERNO-AUDIT-013.md` (evidência AEP) |
| Status | **Concluída — pronta para o gate humano G3** |
| Natureza | Documentação pura. Zero código, zero schema, zero migration, zero config alterados. Não é parecer jurídico. |

---

## 1. Resumo executivo

O Contador HUB tem hoje — após os GOALs 002–012G — um **núcleo interno sólido e comprovado**: contrato de competência, readers read-only com escopo por `storeId`, documentos com upload imutável em Cloudflare R2, máquina de status/comentários/timeline e fechamento com snapshot canônico + pacote versionado. As 15 rotas de `app/api/contador/**` são fail-closed e passam por um único gate (`requireContadorScope`), com IDOR bem mitigado por lookup composto `(id, storeId)`, intent HMAC e FKs compostas no banco.

O que **não existe** é o Portal Externo: não há usuário externo, convite, vínculo contador↔empresa, sessão externa, telas externas, nem trilha de acesso externo. O único precedente — o portal legado `/contador` — é um PIN global compartilhado com sessão opaca de 12h sem identidade, sem loja e sem revogação, acoplado ao selo de assinatura da loja no `proxy.ts`. Ele não autoriza nenhuma API de dados e **não pode servir de fundação** para o portal.

**Decisão desta auditoria (única, conforme o GOAL): CRIAR IDENTIDADE EXTERNA SEPARADA.**
Nem reutilizar a identidade atual (NextAuth interno, JWT stateless sem revogação, papéis operacionais da loja), nem modelo híbrido. A sessão externa será um mecanismo dedicado e revogável, plugado como **segundo caminho** do `requireContadorScope()` que o masterplan já prevê (§6) e para o qual o schema já reservou `atorTipo "externo"`. Esta é exatamente a opção C da ADR-CONTADOR-008 (Proposed, aguardando G3) — agora confirmada por evidência direta do código.

**Recomendação de rota (insumo para G3):** portal v2 em **caminho novo e dedicado** (`/contador-externo` + APIs em `/api/contador-externo`), porque `/portal/*` já é o portal do cliente final (`proxy.ts:63-66`) e `/contador` permanece do legado até o G4. O destino final do caminho `/contador` (redirect ou remoção) fica para o GOAL 019/G4.

**Bloqueadores P0 para qualquer exposição externa (todos resolvidos pelo GOAL 014):** inexistência de identidade externa atribuível; inexistência de vínculo contador↔loja verificado no servidor; impossibilidade de revogação imediata de sessão externa. Nenhum exige schema novo além da migration 2 já prevista no masterplan (`ContadorUsuario`, `ContadorConvite`, `ContadorAcesso`).

A trilha está pronta para o **G3**: ADRs 002 e 008 podem ser decididas com este material e o roadmap 014–019 está registrado no documento irmão.

---

## 2. Arquitetura atual comprovada

Tudo nesta seção foi verificado em código sobre a base `958698c`. Citações no formato `arquivo:linha`.

### 2.1 As três superfícies existentes

| Superfície | Rota | Guarda | Dados |
|---|---|---|---|
| Preview interno realificado | `/dashboard/contador` | NextAuth + assinatura de loja (`proxy.ts:77-81`, `92-118`) | Readers reais (GOAL 006), fechamento/pacote/documentos reais (010–012) |
| Portal legado | `/contador`, `/login-contador` | Cookie HMAC `assistec_contador_session` após selo de assinatura (`proxy.ts:156-169`) | Agregação **client-side** via providers do ERP (`components/dashboard/contador/area-contador-pro.tsx:48,79-88`) |
| APIs do HUB | `/api/contador/**` (15 rotas) | **Nenhuma guarda no proxy** (`proxy.ts:33` libera todo `/api`); defesa 100% nos handlers via `requireContadorScope()` (`lib/contador/scope.ts:21-28`) | Domínio persistido (migration 0014) |

### 2.2 Os três mecanismos de sessão (paralelos e independentes)

1. **NextAuth interno** — Auth.js `v5.0.0-beta.31`, provider Credentials apenas (`auth.ts:13-16`), **JWT stateless** (`auth.config.ts:9`), sem revogação server-side possível. Usuário: model `AdminUser` (`prisma/schema.prisma:2099-2111`) com `role`, `lojaId`, `active`; multi-loja via `AdminUserStore` (`schema.prisma:2083-2094`); papéis `SUPER_ADMIN/ADMIN/GERENTE/OPERADOR/CAIXA/TECNICO/VENDEDOR` (`schema.prisma:2069-2077`). Hash bcrypt custo 12. Payload JWT: `role`, `lojaId`, `storeAccess`, `allowedStoreIdsJson` (`auth.config.ts:12-29`). Sem rate limit no login; resposta antecipada para e-mail inexistente cria **oráculo de timing** (`auth.ts:28` vs `:31`).
2. **Sessão legada do contador** — PIN único global via env `CONTADOR_PIN` (`app/api/auth/contador/route.ts:24-29`), comparação SHA-256 + `timingSafeEqual` (`:31-36`), fail-closed sem env (`:66-70`). Token HMAC-SHA256 cujo payload carrega **apenas** `{issuedAt, expiresAt, nonce}` — **sem identidade, sem loja, sem papel** (`lib/contador/auth/legacy-session.ts:42-54`). Cookie `assistec_contador_session`, `httpOnly`, `sameSite:lax`, 12h (`:8-9,109-119`). **Sem revogação, sem rotação, sem sliding expiration** (`:94`). Rate limit **em memória** 5/15min por hash de IP (`lib/contador/auth/rate-limit.ts:8-13,21-27`), chaveado por `x-forwarded-for` falsificável (`legacy-session.ts:149-158`). Kill-switch `CONTADOR_LEGACY_PORTAL` com **default ligado** (`:133-137`). Logs estruturados com `ipHash`, sem PIN/IP bruto (`:160-185`).
3. **Sessão admin legada** — cookie `assistec_admin_session` com **id cru não assinado** (`app/api/auth/admin/route.ts:39-47`) e model `User` com PIN em texto puro (`schema.prisma:1557-1576`). Precedente perigoso, fora do caminho do portal, registrado para não ser replicado.

### 2.3 Gate de escopo das APIs do HUB

`requireContadorScope()` (`lib/contador/scope.ts:21-28`) = sessão NextAuth + cookie de loja ativa `assistec-active-store` + `canAccessStore(session, storeId)` + permissão `hubs.contador` (`lib/contador/scope-core.ts:36-53`). Falhas mapeadas: `nao_autenticado`→401, `loja_ausente`→400, `sem_acesso_loja`→403, `sem_permissao`→403 (`lib/contador/documentos/http.ts:20-40`).

- `storeId` **nunca** vem do cliente: query/body com `storeId, lojaId, papel, role, userId, atorId, autorId, competenciaId` → 400 antes de qualquer lógica (`lib/contador/fechamento/rotas.ts:16-25` e análogos).
- `canAccessStore` só restringe usuários `storeAccess:"restricted"`; para `"all"` (admins/gerentes) aceita qualquer loja (`lib/auth/enterprise-permissions.ts:223-228`). `hubs.contador` existe como permissão dedicada e hoje vale para admin e gerente (`:117-123`).
- Competência: regex estrito `^(\d{4})-(0[1-9]|1[0-2])$` (`lib/contador/competencia.ts:58`), período UTC semiaberto em `America/Sao_Paulo` (`:173-179`), sem restrição temporal além de ano 2000–2100 na camada DB (`lib/contador/db/competencia.ts:24-25`).
- `podeConferir` = `hubs.contador && (admin.masterConsole || financeiro.edit)` (`lib/contador/status/permissoes.ts:27-34`) — exigido para fechar/reabrir competência e conferir/resolver documentos.

### 2.4 Domínio persistido (migration 0014 — GOAL 009)

Seis models (`prisma/schema.prisma:2576-2824`): `ContadorCompetencia` (status `ABERTA|ENVIADA|COM_PENDENCIA|FECHADA`, `versao`, `snapshot JsonB`, `snapshotHash`), `ContadorDocumento`, `ContadorPacote` + `ContadorPacoteItem` (`@@unique([competenciaId, versao])`), `ContadorComentario` (visibilidade `interna|compartilhada`), `ContadorEvento` (append-only; colunas `ip`/`userAgent` existentes mas **nunca populadas** — `schema.prisma:2815-2816`, `lib/contador/fechamento/repo-prisma.ts:70-82`). FKs compostas `(competenciaId, storeId)` impedem vínculo cruzado no banco (`schema.prisma:2656-2658, 2800-2802`). **O schema já reserva o ator externo**: `enviadoPorTipo`/`autorTipo`/`atorTipo` aceitam `"externo"` (`schema.prisma:2675-2676, 2772-2773, 2805`), hoje nunca escrito — todos os serviços hardcoded `"interno"` (ex.: `lib/contador/comentarios/service.ts:32`).

### 2.5 Documentos e storage R2

- Porta `StorageDocumentosPort` com adapters R2 (oficial) e Supabase (deprecado); seleção **fail-closed** por `CONTADOR_STORAGE_PROVIDER="r2"`, sem fallback (`lib/contador/documentos/storage.ts:28-38`, `config.ts:35-62`).
- Chaves: `contador/{storeId}/{AAAA-MM}/{documentoId}/{nomeSanitizado}` (`lib/contador/documentos/validacao.ts:275-291`); pacotes content-addressed `…/pacotes/v{N}/{manifestoHash}.zip` (`storage-r2.ts:30`). `documentoId = doc-<uuid>` gerado no servidor (`service.ts:216-218`).
- Upload em duas fases com presigned PUT de criação exclusiva (`If-None-Match: *`, `storage-r2.ts:152-183`) + intent HMAC de 600s que vincula storeId/userId/sessão (`lib/contador/documentos/intent.ts:38,123-135`; reconferido em `service.ts:383-385`). Validações no complete: extensão por allowlist, MIME, ≤25 MB, magic bytes, UTF-8 estrito, sha256 recalculado server-side (`validacao.ts:120-252`; `service.ts:461-473`). **Sem antivírus e sem inspeção de ZIP** (`validacao.ts:5-6`).
- Download: somente POST, posse por `acharDocumentoDaLoja(id, storeId)` (`repo-prisma.ts:117-124`; out-of-store → **404**, não 403), `HeadObject`, presigned GET com **TTL capado em 300s** (`config.ts:20`; `storage-r2.ts:249-264`), `Content-Disposition: attachment` sanitizado, resposta da API com `Cache-Control: private, no-store` (`download/route.ts:39-42`). Cada autorização grava evento `documento_download_autorizado` (`service.ts:623-633`) — registra a **autorização**, não a efetivação.
- Config R2: `R2_ACCOUNT_ID` validado por regex anti-redirecionamento de host (`config.ts:212-221`), `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`, TTL opcional sempre minado contra o teto (`storage-r2.ts:99-104`), guarda anti-segredo em `NEXT_PUBLIC_*` (`config.ts:127-137`). Privacidade do bucket **assumida por provisioning, não verificável via S3 API** (`storage-r2.ts:115-133`). **Nenhuma configuração de CORS do bucket no repositório** — dependência manual para o PUT direto do navegador.

### 2.6 Fechamento, snapshot e pacote

- Fechamento oficial: transação única (status FECHADA + snapshot + pacote + itens + evento) com trava otimista (`lib/contador/fechamento/repo-prisma.ts:166-221`); exige `podeConferir` (`service.ts:401`), confirmação textual do código da competência (`:711-714`) e assunção de todas as pendências (`:734-746`). Reabrir: motivo obrigatório, `versao+1`, snapshot/pacotes anteriores preservados (`service.ts:553-622`).
- Snapshot `omni.contador.fechamento.snapshot/v2`: só agregados (20 totais), checklist e contagens; **sem PII, sem storageRef**; responsável pseudonimizado `u_<sha256[:16]>` (`lib/contador/fechamento/snapshot.ts:17-22,51,78-95`; `canonico.ts:124-126`); JSON canônico + sha256 (`canonico.ts:47-97`).
- Pacote: 14–15 arquivos (CSVs linha a linha de vendas/itens/devoluções/financeiro/títulos/caixa + resumo + pendências + `manifest.json` `omni.contador.pacote.manifest/v1` com sha256/bytes por arquivo; `storeId` só no manifesto, `geradoPor` pseudonimizado — `lib/contador/pacote/manifest.ts:36-38,77-113`). Guardas: limites 50k registros/fonte, 25 MB descompactado, 10 MB ZIP, 15 arquivos, 30s; anti-injeção de planilha; sentinelas anti-vazamento (`storeId` fora do manifesto, `Authorization`, `Bearer`, `sessionToken`, `stack`, `payload`) fail-closed (`lib/contador/pacote/seguranca.ts:20-168`). Downloads de pacote: POST com presigned URL 300s + evento `pacote_baixado` (`lib/contador/pacote/versoes.ts:50-99`).
- Readers: `Venda`, `DevolucaoVenda`, `MovimentacaoFinanceira`, `ContaReceberTitulo`, `ContaPagarTitulo`, `SessaoCaixa`, `CaixaOperacao` — só `findMany` com `select` estreito, escopo `storeId` + período; falha isolada vira `indisponivel`, nunca zero silencioso (`lib/contador/readers/index.ts:244-313`). Fiscal permanentemente `indisponivel` atrás de `CONTADOR_FISCAL_READER` (`:244-248`).
- Timeline/comentários: contexto `compartilhado` filtra visibilidade `interna` **no SQL** + defesa em profundidade na projeção (`lib/contador/comentarios/service.ts:241-254`; `lib/contador/timeline/projecao.ts:114-117`); metadata de eventos por allowlist de 15 chaves + regex de chaves proibidas (`projecao.ts:79-97`); visibilidade desconhecida → coagida a `interna` (fail-closed, `comentarios/service.ts:295-298`). Ressalva: `atorId` (userId interno cru) aparece nos DTOs de comentário/timeline (`projecao.ts:143`).

### 2.7 Público e produto — o que existe hoje para o "contador"

**Não existe nenhum modelo de usuário externo.** Verificado por inspeção direta do schema (§2.4: seis models de domínio, nenhum de identidade) e por varredura `convite|invite|ContadorUsuario|ContadorConvite|ContadorAcesso|usuario externo` em `app/`, `lib/`, `prisma/` — zero ocorrências relevantes. Concretamente:

- Quem é o "usuário externo" hoje: **qualquer pessoa com o PIN global** — sem distinção entre contador individual, escritório contábil ou auxiliar.
- Relação contador↔empresa/loja: **inexistente**. Uma empresa com vários contadores e um contador com várias empresas não são representáveis.
- Convite, aceite, suspensão, revogação, recuperação de acesso, troca de responsável contábil: **nada implementado** (masterplan §14 e ADR-008 os definem como trabalho futuro — GOAL 014).
- O cookie legado protege apenas a página `/contador`; **não autoriza nenhuma API de dados** (§2.1–2.2). A página legada ainda exige o selo de assinatura da loja no browser (`proxy.ts:92-118` antes de `:156`) e lê estado client-side do ERP — ou seja, pressupõe o navegador do lojista.
- Telemetria de uso do portal legado: existem logs estruturados de autenticação (`contador_auth_*`, `legacy-session.ts:160-185`), mas **nenhuma telemetria persistida de acesso/uso** — ausência registrada como insumo para o prazo de retirada (G4).

---

## 3. Lacunas (auditoria A–G)

Mapeamento completo no apêndice de rastreabilidade (§15). Resumo das lacunas que bloqueiam ou condicionam o portal:

**A. Público e produto**
1. Inexistência de entidade para contador individual, escritório contábil e auxiliar (um único login deve atender N empresas; uma empresa deve admitir N contadores com papéis).
2. Inexistência de convite, aceite, suspensão, revogação e recuperação de acesso.
3. Inexistência de fluxo de troca de responsável contábil (revogar vínculo antigo + conceder novo com trilha).

**B. Identidade e autenticação**
4. Nenhuma identidade externa atribuível (PIN compartilhado; sessão sem principal — `legacy-session.ts:42`).
5. Sessão legada sem revogação/rotação/expiração deslizante; rate limit em memória com IP falsificável; ineficaz em serverless (`rate-limit.ts:1-13`).
6. Acoplamento do portal ao selo de assinatura da loja (`proxy.ts:92-118`) — inviável para acesso externo real.
7. MFA: inexistente (evolução prevista para o GOAL 019, ADR-008 "Não decidido").
8. Proteção contra enumeração de contas a construir no login/aceite externos (hoje há oráculo de timing no login interno — `auth.ts:28-32`).

**C. Autorização**
9. `requireContadorScope()` só conhece o caminho interno (NextAuth + permissão interna). Falta o ramo externo: sessão externa + `ContadorAcesso` ativo + papel.
10. Não há distinção leitura×escrita para terceiros: hoje quem tem `hubs.contador` pode tudo, inclusive excluir documentos (papel único de fato).
11. Proibição de escrita financeira/fiscal/operacional para o externo precisa ser estrutural (rotas do portal só chamam serviços de leitura + o conjunto mínimo de ações permitidas), não apenas convenção.

**D. Dados e LGPD**
12. `ContadorEvento.ip`/`userAgent` nunca populados — trilha sem origem de rede, insuficiente para prova de acesso externo.
13. Evento de download registra autorização, não efetivação — limitação honesta a documentar e mitigar (janela TTL curta já existente).
14. Política de retenção/descarte por categoria indefinida (adiada por design para o GOAL 019; números exigem decisão de Rafael).
15. Base legal e registro de operações (ROPA) do tratamento pelo portal a documentar no runbook do GOAL 019.
16. Ausência de fluxo de exportação/eliminação de dados do titular (o próprio contador, titular de conta externa).

**E. Arquitetura**
17. Rotas, APIs, layout e contratos de sessão do portal: inexistentes.
18. CORS do bucket R2 não provisionado em código — passo manual obrigatório a incluir no checklist do GOAL 014/015 (sem ele, upload externo não funciona; permissivo demais, abre PUT a origens arbitrárias).
19. Observabilidade de acessos externos (login, downloads, bloqueios cross-store) inexistente — masterplan §22 a cumprir no 019.
20. Tabelas necessárias: somente as três da migration 2 (`ContadorUsuario`, `ContadorConvite`, `ContadorAcesso`) — exigem autorização explícita de schema (gate G-DADOS-SCHEMA + janela coordenada).

**F. UX**
21. Todas as telas externas inexistem (login, seleção de empresa, dashboard de competências, documentos, pacotes, fechamento, solicitações, estados vazio/indisponível/revogado).

**G. Segurança adversarial**
22. Todos os vetores do threat model (§5) dependem da identidade/vínculo inexistentes; nenhum é mitigável por configuração.

---

## 4. Riscos P0–P3

### P0 — bloqueiam qualquer exposição externa

| # | Risco | Evidência |
|---|---|---|
| P0-1 | **Identidade externa inexistente**: PIN global compartilhado, sessão sem principal, sem atribuição de ações, sem revogação individual | `app/api/auth/contador/route.ts:24-29`; `lib/contador/auth/legacy-session.ts:42,94` |
| P0-2 | **Vínculo contador↔loja inexistente**: nenhuma tabela/contrato de acesso por empresa; expor `/api/contador/**` a terceiros hoje seria cross-tenant por construção | §2.4 (schema sem identidade); §2.7 |
| P0-3 | **Sessão externa irrevogável**: token stateless de 12h; nem troca de PIN nem logout invalidam; só rotacionar `CONTADOR_SESSION_SECRET` (global) | `legacy-session.ts:44-54,94`; `route.ts:105-111` |
| P0-4 | **Herança estrutural de IDOR se o gate interno for reutilizado para externos**: `storeId` vem de cookie gravável pelo cliente e `canAccessStore` retorna `true` para qualquer loja quando `storeAccess:"all"` | `lib/contador/scope.ts:23`; `lib/loja-ativa.tsx:31`; `lib/auth/enterprise-permissions.ts:223-228` |

### P1 — corrigir no desenho do portal (014/015), não expor sem tratar

| # | Risco | Evidência |
|---|---|---|
| P1-1 | Portal legado acoplado ao selo de assinatura da loja (browser do lojista) e `SUBSCRIPTION_SECRET` com fallback default em código | `proxy.ts:26-27,92-118,156-169` |
| P1-2 | Rate limit de login em memória por instância, chaveado em XFF falsificável; login interno sem rate limit e com oráculo de timing por e-mail | `rate-limit.ts:1-13`; `legacy-session.ts:149-158`; `auth.ts:28-32` |
| P1-3 | Trilha de acesso insuficiente para prova: eventos sem IP/userAgent; download registra autorização, não efetivação | `schema.prisma:2815-2816`; `repo-prisma.ts:70-82`; `service.ts:605-607,623-633` |
| P1-4 | CORS do bucket R2 fora do código: passo manual crítico e bidimensional (ausente quebra upload; permissivo demais expõe PUT) | §2.5 (ausência verificada em `next.config.mjs`, `workers/`, 012B §6) |
| P1-5 | `resolveLegacyPortalEnabled` default **ON** (portal legado habilitado salvo `CONTADOR_LEGACY_PORTAL=off`) | `legacy-session.ts:133-137` |

### P2 — tratar no hardening/rollout

| # | Risco | Evidência |
|---|---|---|
| P2-1 | Presigned GET é bearer token: reutilizável dentro do TTL (≤300s), sem vínculo de sessão/IP; sobrevive a soft-delete até expirar | `storage-r2.ts:256-265`; `service.ts:640` |
| P2-2 | `atorId` interno cru exposto em DTOs de comentário/timeline (contexto compartilhado) | `timeline/projecao.ts:143,159` |
| P2-3 | `storageRef` devolvido ao cliente interno no upload-intent (DTO de listagem omite; portal não deve herdar) | `upload-intent/route.ts:64`; `service.ts:535-557` |
| P2-4 | Sem rate limiting nas rotas de download (geração ilimitada de presigned URLs + linhas de evento por usuário autenticado) | `service.ts:623-633` |
| P2-5 | Credencial R2 única por bucket para todas as lojas: isolamento multi-tenant 100% em aplicação | `storage-r2.ts:60-80` |

### P3 — registrar e corrigir oportunamente

| # | Risco | Evidência |
|---|---|---|
| P3-1 | Divergências doc×código: path sem segmento `documentos/`; `R2_ENDPOINT` previsto e não implementado; bucket único vs dois previstos | `validacao.ts:290` vs 012B §5/§13 |
| P3-2 | `pacote/route.ts` valida competência antes do scope (400×401 — oráculo de validação, sem dados) | `app/api/contador/pacote/route.ts:67-83` |
| P3-3 | `ResponseCacheControl` não fixado no presigned GET do R2 | `storage-r2.ts:258-262` |
| P3-4 | `GET /api/auth/contador` expõe `portalEnabled` (disclosure menor de configuração) | `route.ts:43-55` |
| P3-5 | Byte não-UTF8 isolado em `CONTADOR_HUB_FABLE5_MASTERPLAN_001.md` (0xA9 em "Métricas", §22) — impede leitores estritos; arquivo original não tocado nesta auditoria | verificado por varredura de bytes |

---

## 5. Threat model (segurança adversarial)

Cenários do GOAL, com o controle atual e o controle exigido no portal v2. "—" = inexistente hoje.

| # | Cenário | Controle atual | Controle exigido (GOAL) |
|---|---|---|---|
| G-1 | Contador alterando `storeId` (URL/cookie/header) | APIs rejeitam `storeId` do cliente (400); loja vem de cookie + ACL interna (`rotas.ts:16-25`; `scope.ts:23`) | Escopo externo: `storeId` resolvido **somente** por `ContadorAcesso` ativo no servidor; seleção de loja validada a cada request; testes cross-store obrigatórios (014/015) |
| G-2 | Reutilização de convite (replay) | — | Token de 32 bytes, **apenas hash persistido**, uso único, expiração 72h, revogável; aceite exige e-mail correspondente ao convite (014) |
| G-3 | Contador acessando empresa desvinculada | — | `requireContadorScope` externo exige acesso ativo (não revogado) para a loja; 403 sem confirmar existência; evento `acesso_negado` (014/015) |
| G-4 | URL assinada reutilizada/forwarded | TTL ≤300s capado; evento por emissão; nunca persistida (`storage-r2.ts:249-265`) | Manter TTL curto + evento com IP/UA; aceitar janela residual documentada; avaliar streaming proxy no hardening (019) |
| G-5 | Competência manipulada (futura/arbitrária) | Regex estrito + 422; competência resolvida por `(storeId, ano, mes)` no servidor (`competencia.ts:58`) | Mesmo contrato no portal; competência fora do escopo da loja → 404/403; leitura de fechada serve **snapshot**, não dado vivo (015) |
| G-6 | Download por ID previsível | IDs `doc-<uuid>` server-side; lookup composto `(id, storeId)` → 404 sem confirmar existência alheia | Idem no portal; FK composta no banco como segunda linha (já existente) |
| G-7 | Sessão interna usada no portal externo (ou vice-versa) | Cookies/gates separados por construção, mas APIs só aceitam NextAuth | Cookie externo distinto (nome/path), rotas externas aceitam **somente** sessão externa; teste cruzado obrigatório: cookie interno não autentica `/api/contador-externo/**` e vice-versa (014) |
| G-8 | Conta suspensa mantendo sessão | — | `tokenVersion++` em suspensão/revogação derruba todas as sessões; verificação por request (ou cache ≤60s documentado); próxima request → 401 (014) |
| G-9 | Dados em cache compartilhado (CDN/proxy) | APIs do HUB respondem `Cache-Control: private, no-store` (`download/route.ts:39-42`) | Mesmo contrato em 100% das rotas/páginas do portal; nenhum dado autenticado em resposta cacheável; R2 sem URL pública (015) |
| G-10 | Acesso residual após troca de contador | — | Troca = revogar `ContadorAcesso` antigo (+`tokenVersion++`) e conceder novo; eventos `permissao_concedida/revogada`; sessões antigas caem imediatamente (014) |
| G-11 | Força bruta no login externo | Rate limit in-memory falsificável (legado) | Rate limit distribuído ou persistido, chaveado por e-mail+IP com XFF confiável; 429 + `Retry-After`; erro genérico anti-enumeração; alerta de pico (014/019) |
| G-12 | Convite roubado em trânsito (link copiável) | — | Expiração curta + uso único + aceite vinculado ao e-mail do convite; token nunca em log nem em URL de acesso pós-aceite (014; decisão G3 sobre e-mail) |

---

## 6. Proposta de identidade (decisão: identidade externa separada)

### 6.1 Por que não reutilizar a identidade atual

1. **JWT stateless sem revogação**: a sessão NextAuth interna não pode ser invalidada no servidor (`auth.config.ts:9`). Suspender um contador exigiria esperar a expiração do JWT — inaceitável para acesso externo (G-8/G-10).
2. **Tabela e papéis errados**: `AdminUser` é o cadastro de equipe da loja, com papéis operacionais (`CAIXA`, `VENDEDOR`… `schema.prisma:2069-2077`) e permissões derivadas que incluem escrita financeira (`lib/auth/enterprise-permissions.ts`). Criar "contador" como papel ali mistura planos de autorização e arrasta navegação do ERP.
3. **Escopo por cookie**: o gate interno resolve a loja por cookie gravável e `canAccessStore` é permissivo para `"all"` (P0-4) — modelo legítimo para equipe interna multi-loja, inaceitável como fronteira externa.
4. **Conta N:N impossível**: um contador com várias empresas e uma empresa com vários contadores exigem entidade própria com vínculo (`ContadorAcesso`), não `lojaId`/`AdminUserStore`.
5. **E o legado é pior**: PIN global sem principal (P0-1/P0-3).

### 6.2 Por que não híbrido

Híbrido (externo como usuário NextAuth com sessão separada, ou catraca dupla) mantém o acoplamento ao JWT interno e à tabela de equipe sem ganhar nada: os dois pontos de contato reais — o gate `requireContadorScope()` e os serviços de domínio — já são agnósticos de mecanismo de login porque consomem um **objeto de escopo tipado** (`ContadorScopeInterno` é brand type produzido só pelo gate, `scope-core.ts:8-17`). A fronteira correta de integração é o escopo, não a sessão.

### 6.3 Modelo proposto (migration 2 — aditiva, gate de schema)

Fiel à ADR-008 (opção C) e ao COMANDO 14/19, confirmados por esta auditoria:

- **`ContadorUsuario`**: `id`, `email @unique`, `nome`, `senhaHash` (bcrypt custo ≥12 — util `bcryptjs` já presente no repo, mesmo algoritmo do admin interno), `status (ativo|suspenso)`, `tokenVersion Int @default(1)`, `ultimoLoginEm?`, timestamps.
- **`ContadorConvite`**: `id`, `email`, `storeId`, `papel (leitura|conferencia)`, `tokenHash @unique` (token nunca persistido em claro nem logado), `expiraEm` (72h), `usadoEm?`, `revogadoEm?`, `criadoPorId`, `criadoEm`; índice `[email, storeId]`.
- **`ContadorAcesso`**: `id`, `usuarioId` (FK), `storeId`, `papel`, `concedidoPorId`, `concedidoEm`, `revogadoEm?`, `revogadoPorId?`; `@@unique([usuarioId, storeId])`; índice `[storeId]`.

Papel cobre os três perfis de público sem modelar hierarquia de escritório no MVP: contador individual e titular de escritório recebem `conferencia`; auxiliar recebe `leitura`. Escritório como entidade (agrupador) fica fora do MVP — decisão já adiada por ADR/masterplan (§27-5: seguir por `storeId`).

### 6.4 Fluxos

- **Convite** (admin interno, permissão elevada): token `crypto.randomBytes(32)` → salva-se só `sha256(token)`; link exibido **uma vez** para cópia (MVP sem provider de e-mail — pendência G3); evento `convite_criado/revogado`.
- **Aceite** (página pública com token): valida hash/expiração/uso → formulário nome+senha (mín. 10 caracteres) → cria/vincula `ContadorUsuario` pelo e-mail + `ContadorAcesso` + marca convite usado + eventos.
- **Login**: e-mail+senha → verifica hash + `status=ativo` → cookie próprio (`assistec_contador_ext_session` ou nome equivalente, distinto do interno e do legado), HMAC com `{usuarioId, tokenVersion, iat, exp ≤ 12h}`, `httpOnly`, `secure` em produção, `sameSite:lax`, `path` restrito ao portal; **rotação** após 50% da vida; logout limpa; revogação/suspensão → `tokenVersion++` derruba todas as sessões.
- **Recuperação de acesso**: fluxo mínimo no 014 (token de reset hasheado com expiração curta, mesma mecânica do convite) **ou** adiamento registrado — pergunta aberta para G3 (ADR-008 "Não decidido"). Sem recuperação self-service, a recuperação é administrativa (revogar + novo convite).
- **Suspensão/revogação/troca de responsável**: suspender usuário (`status`) ou revogar acesso (`revogadoEm`) com eventos; troca de contador = revogar acesso antigo + novo convite (G-10).
- **Anti-enumeração**: login e aceite respondem genérico (mesmo status e mensagem para e-mail inexistente e senha errada); comparação de senha sempre executada (sem early-return — corrigir o padrão observado em `auth.ts:28-32`); rate limit por e-mail+IP, 429 + `Retry-After`.
- **MFA**: fora do MVP; evolução no GOAL 019 (ADR-008). O desenho do cookie/sessão não deve impedir um segundo fator futuro.

---

## 7. Proposta de autorização

### 7.1 Ramo externo do `requireContadorScope()`

O masterplan (§6) já prevê: "sessão interna (…) OU sessão externa (`ContadorUsuario` + `ContadorAcesso` ativo). Retorna `{ atorTipo, atorId, lojasPermitidas }`". Implementação como **segundo caminho do mesmo helper** (nunca um helper paralelo — regra "um único helper de escopo"):

```
requireContadorScope()
  ├─ caminho interno (atual): NextAuth + cookie de loja + canAccessStore + hubs.contador
  └─ caminho externo (novo): sessão externa válida (assinatura + exp + tokenVersion == DB)
        + loja solicitada ∈ ContadorAcesso ativo (revogadoEm IS NULL)
        → { atorTipo: "externo", atorId: usuarioId, storeId, papel: leitura|conferencia }
```

- A loja no portal é **parâmetro de rota validado**, nunca cookie solto: `/contador-externo/[loja]/...` só prossegue se `[loja] ∈ lojasPermitidas`; caso contrário 403 sem confirmar existência (G-1/G-3).
- Readers e serviços existentes **não mudam de assinatura**: continuam recebendo `storeId` + competência já validados; o que muda é quem produz o escopo. O brand type existente (`scope-core.ts:8-17`) deve ganhar variante externa nominal, impedindo que código interno fabrique escopo externo.
- `atorTipo: "externo"` passa a ser escrito nos eventos/comentários originados do portal — valor já reservado no schema (`schema.prisma:2805`), hoje nunca usado.

### 7.2 Matriz de permissões do portal (derivada da §15 do masterplan)

| Ação | Papel `leitura` | Papel `conferencia` | Proibido a ambos |
|---|---|---|---|
| Listar competências da loja | ✔ | ✔ | — |
| Ver resumo/checklist (vivo se aberta, snapshot se fechada) | ✔ | ✔ | — |
| Listar documentos da competência | ✔ | ✔ | — |
| Baixar documento (evento + presigned 300s) | ✔ | ✔ | — |
| Baixar pacote por versão (evento) | ✔ | ✔ | — |
| Confirmar recebimento de pacote (idempotente) | ✔ | ✔ | — |
| Comentar (visibilidade `compartilhada` fixa) | ✔ | ✔ | — |
| Marcar documento `conferido` | — | ✔ | — |
| Upload de documento (guias/retornos) | — | condicional¹ | — |
| Ver timeline compartilhada | ✔ | ✔ | — |
| Fechar/reabrir competência | — | — | ✔ (só interno `podeConferir`) |
| Excluir documento | — | — | ✔ |
| Status `resolvido`, rejeições | — | — | ✔ (interno) |
| Qualquer escrita financeira/fiscal/operacional | — | — | ✔ estrutural (nenhuma rota do portal chama esses serviços) |
| Gerar/regenerar pacote | — | — | ✔ (interno) |
| Convidar/revogar contadores | — | — | ✔ (interno, permissão elevada) |

¹ Upload externo: masterplan §15 prevê "Anexar documento ✔ (guias/retornos)" para o contador; COMANDO 15/19 condiciona a "papel=conferencia **e** decisão G3". Recomendação desta auditoria: **MVP sem upload externo** (reduz superfície; CORS do R2 é dependência manual P1-4) — decisão registrada em §11.

### 7.3 Garantias estruturais anti-IDOR (herdadas e novas)

- Herdadas (já comprovadas): lookup composto `(id, storeId)` → 404 (`documentos/repo-prisma.ts:117-124`); FK composta no banco; pacote endereçado por `(competenciaId, versao)` derivado de lookup escopado; `assertPacoteSeguro` fail-closed.
- Novas (014/015): toda rota/ação do portal nasce com teste cross-store (loja A autorizada, loja B → 403); `storageRef` nunca serializado em resposta do portal; `atorId` interno **pseudonimizado** na timeline compartilhada (corrigir P2-2 no caminho externo); presigned URL emitida só após evento gravado com IP/UA (corrigir P1-3 no caminho externo).

---

## 8. Proposta de rotas e APIs

### 8.1 Decisão de rota (insumo para G3)

| Opção | Prós | Contras |
|---|---|---|
| (a) `/portal/contador` | Agrupa "portais externos" | **`/portal/*` já é o portal do cliente final** (login CPF/pagamentos, `proxy.ts:63-66`) — mistura dois públicos e dois mecanismos de sessão no mesmo segmento e no mesmo trecho do proxy |
| (b) Reutilizar `/contador` após retirada do legado | URL já conhecida; sem links órfãos | Convivência impossível durante rollout; exige big-bang de migração; retirada do legado só no G4 |
| (c) **Caminho novo dedicado `/contador-externo` (recomendada)** | Isolamento total de proxy/sessão desde o dia 1; convive com o legado; migração gradual por loja; redirect `/contador`→novo caminho decidido no G4 | Links novos para comunicar; dois caminhos vivos durante a transição |

**Recomendação: (c)**, com APIs em `/api/contador-externo/**` (mesmo nome do COMANDO 14/19), pelo isolamento estrutural e pela convivência segura até o G4. O `proxy.ts` ganha um trecho próprio e mínimo para o novo segmento (gate de sessão externa para páginas; APIs seguem autoprotegidas como hoje), **sem** o selo de assinatura da loja (P1-1) e sem tocar o trecho do legado antes do G4.

### 8.2 Mapa de rotas do portal (proposta)

Páginas (segmento `app/contador-externo/**`, layout próprio, zero providers do ERP, atrás de flag `CONTADOR_PORTAL_V2` default off):

| Rota | Conteúdo |
|---|---|
| `/contador-externo/login` | Login externo (público) |
| `/contador-externo/convite/[token]` | Aceite de convite (público) |
| `/contador-externo/recuperar` | Recuperação de acesso (se aprovada no G3) |
| `/contador-externo` | Seleção de empresa (lista de `ContadorAcesso` ativos) |
| `/contador-externo/[loja]` | Dashboard da empresa: competências com status/selo oficial |
| `/contador-externo/[loja]/[c]` | Competência: resumo, checklist, documentos, pacotes, comentários |
| `/contador-externo/[loja]/[c]/documentos` | Documentos (tabela + download) |
| `/contador-externo/[loja]/[c]/pacotes` | Versões do pacote + download + confirmar recebimento |
| `/contador-externo/sessao-expirada`, `/contador-externo/acesso-revogado` | Estados terminais honestos |

APIs (`app/api/contador-externo/**`, todas com escopo externo + `Cache-Control: private, no-store`):

| Rota | Método | Função |
|---|---|---|
| `/api/contador-externo/auth/login` · `/logout` · `/sessao` | POST/GET | Sessão externa |
| `/api/contador-externo/convite/aceitar` | POST | Aceite |
| `/api/contador-externo/convites` (interno admin) | POST/GET/DELETE | Gestão de convites e acessos (seção Permissões do ERP) |
| `/api/contador-externo/lojas` | GET | Lojas do escopo |
| `/api/contador-externo/lojas/[loja]/competencias` | GET | Lista |
| `/api/contador-externo/lojas/[loja]/competencias/[c]/resumo` · `/checklist` · `/documentos` · `/pacotes` · `/timeline` | GET | Leituras (serviços existentes) |
| `/api/contador-externo/documentos/[id]/download` | POST | Presigned 300s + evento com IP/UA |
| `/api/contador-externo/pacotes/download` | POST | Idem pacote |
| `/api/contador-externo/pacotes/confirmar` | POST | Confirmação idempotente (evento) |
| `/api/contador-externo/comentarios` | POST | Comentário `compartilhado` fixo |
| `/api/contador-externo/documentos/[id]/conferir` | POST | Só papel `conferencia` |

Nenhuma rota de fechar/reabrir/excluir/status-interno/upload é criada no namespace externo — a proibição de escrita é **estrutural** (§7.2).

### 8.3 Mudanças que exigirão autorização explícita

- **Schema/migration** (gate G-DADOS-SCHEMA): somente a migration 2 aditiva (`ContadorUsuario`, `ContadorConvite`, `ContadorAcesso`) no GOAL 014 — SQL revisado por Rafael antes do push, janela coordenada.
- **`proxy.ts` (gate G-AUTH)**: trecho novo e mínimo para `/contador-externo` no GOAL 015 (páginas); nenhum trecho existente alterado antes do G4.
- **`auth.ts`/`auth.config.ts` (gate G-AUTH)**: **não tocar** — identidade externa é independente do NextAuth.
- **`.env.example`**: novos nomes (`CONTADOR_EXTERNO_SESSION_SECRET`, `CONTADOR_PORTAL_V2`) — sem valores.
- **Provisioning manual (fora de código)**: CORS do bucket R2; credenciais R2 de produção (já pendente do 012G); e-mail provider se o G3 escolher envio automático.

---

## 9. Proposta de UX

Princípios: linguagem de **somente leitura por padrão** (toda ação disponível é explícita); estados de primeira classe (`vazio`, `indisponivel`, `revogado`); competência sempre visível no topo (`AAAA-MM` + timezone); selo "oficial vN" quando o dado vem de snapshot vs rótulo "dados vivos" quando aberta; desktop-first com mobile responsivo (tabelas→cards). Wireframes textuais:

**T1 — Login.** Logo/nome do produto + "Portal do Contador". Formulário e-mail/senha. Erro genérico ("e-mail ou senha inválidos"). Link "recebi um convite" → instruções. Sem qualquer link/menu do ERP. Rodapé: "acesso monitorado e registrado".

**T2 — Seleção de empresa (pós-login).** Lista de empresas autorizadas (nome da loja + papel: leitura/conferência). Estado vazio: "nenhuma empresa vinculada — peça um convite ao responsável". Estado revogado: empresa aparece como indisponível? **Não** — empresa revogada **some** da lista e acesso direto por URL → T8.

**T3 — Dashboard da empresa (competências).** Header: empresa selecionada (troca explícita), usuário, sair. Lista de competências descendentes com status (`aberta/enviada/com_pendência/fechada`), selo "oficial vN" nas fechadas, atalhos: documentos pendentes, pacotes disponíveis. Estado vazio: "nenhuma competência disponível ainda".

**T4 — Competência.** Abas: Resumo | Documentos | Pacotes | Comentários. Resumo: totais + checklist read-only (itens `ok/atenção/não_disponível` com explicações; "não disponível" é estado honesto, não erro). Se aberta: rótulo "dados vivos — sujeitos a alteração até o fechamento". Se fechada: "fechada em <data> — versão oficial vN".

**T5 — Documentos.** Tabela (categoria, título, enviado por, data, status) + ação baixar (gera link temporário de 5 min — texto explicativo). Papel `conferencia`: ação "marcar conferido". Sem excluir/substituir. Estado vazio: "nenhum documento enviado nesta competência".

**T6 — Pacotes.** Lista de versões (vN, gerado em, tamanho) + baixar + "confirmar recebimento" (com confirmação e estado "recebido em <data>"). Sem versões: "o pacote é gerado no fechamento da competência".

**T7 — Comentários.** Linha do tempo compartilhada (eventos + comentários) + caixa de comentário ("visível para a equipe da loja"). Sem editar/apagar.

**T8 — Estados terminais.** Sessão expirada → "entre novamente"; acesso revogado → "seu acesso a esta empresa foi revogado — fale com o responsável"; empresa inexistente/no escopo → mesma tela de revogado (não confirmar existência). Portal fora do ar (flag off) → página estática "em breve".

Mobile: mesmas informações, tabelas viram cartões; download via link temporário funciona no navegador do celular; sem PWA no MVP.

---

## 10. LGPD e auditoria

Escopo: análise de engenharia com referências oficiais; **não é parecer jurídico**. Fonte oficial registrada: [Lei nº 13.709/2018 (LGPD), texto no Planalto](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm) (acesso em 2026-07-31).

### 10.1 Mapa de dados pessoais no portal

| Dado | Onde | Titular | Sensível (art. 11)? |
|---|---|---|---|
| E-mail, nome, hash de senha | `ContadorUsuario` | Contador (profissional) | Não |
| Eventos de acesso (login, downloads, IP/UA) | `ContadorEvento` | Contador | Não |
| Dados do negócio (vendas, financeiro, caixa, títulos) | readers → telas/pacote | A empresa (dados empresariais); pessoais apenas incidentais | Não por padrão — PII de clientes **já excluída por padrão** (ajuste G2-05, ADR-006) |
| Comentários e motivos (texto livre) | `ContadorComentario`, `ContadorCompetencia.reabertaMotivo` | Misto — pode conter PII por input | Potencialmente (conteúdo livre) |
| Documentos enviados (extratos, folha, docs de funcionário) | `ContadorDocumento`/R2 | Misto; **folha/funcionários são sensíveis por natureza** (masterplan §20–21) | Depende do conteúdo |
| IDs técnicos (userId interno) | DTOs de timeline/comentário | Equipe da loja | Não, mas identificável — pseudonimizar no caminho externo (P2-2) |

### 10.2 Bases legais prováveis (a confirmar pelo responsável/jurídico no GOAL 019)

- Cadastro e acesso do contador: **execução de contrato** (art. 7, V — contrato de prestação de serviços contábeis entre lojista e contador) e **legítimo interesse** (art. 7, IX; art. 10, §1º — somente o estritamente necessário).
- Trilha de acesso/downloads (segurança e prova): **legítimo interesse** (art. 7, IX) combinado com **segurança** (art. 6, VII) e **responsabilização e prestação de contas** (art. 6, X); logs de autenticação enquadrados também na hipótese de prevenção à fraude (art. 11, II, "g", quando houver autenticação de cadastro).
- Documentos contábeis/fiscais: **cumprimento de obrigação legal ou regulatória** (art. 7, II) pelo controlador (o lojista), com a plataforma como operadora (art. 5, VII).
- Consentimento: **não é a base default** deste desenho; quando aplicável (ex.: funcionalidades futuras fora do contrato), seguir arts. 8º e 9º.

### 10.3 Princípios e deveres mapeados para controles

- **Necessidade/minimização (art. 6, III):** já estrutural — snapshot só agregados; pacote sem PII de cliente por padrão; portal sem acesso a dados operacionais além dos relatórios do domínio. Manter: portal nunca expõe `storageRef`, segredos, ou campos internos.
- **Segurança (art. 6, VII; art. 46):** controles das §§5–8 (identidade, escopo, TTLs, fail-closed). Lacuna P1-3 (IP/UA nos eventos) deve ser corrigida no caminho externo.
- **Registro das operações (art. 37):** `ContadorEvento` (append-only) + logs estruturados; documentar o ROPA do portal no runbook do GOAL 019.
- **Direitos do titular (art. 18):** o titular-contador deve poder obter confirmação/acesso aos próprios dados de cadastro e pedir eliminação — fluxo administrativo documentado no runbook (019); eliminação de conta preserva trilha anonimizada (eventos mantêm ator pseudonimizado, como já ocorre no snapshot/manifesto).
- **Término e eliminação (arts. 15–16):** retenção por categoria a definir no GOAL 019 com números decididos por Rafael (masterplan §19/§22 adia por design; prazos legais de guarda contábil/fiscal são insumo jurídico a confirmar — fora do escopo desta auditoria).
- **Incidente (art. 48):** runbook do 019 deve incluir fluxo de comunicação à ANPD/titulares; alertas de segurança (pico de `acesso_negado`, estouro de rate limit) já previstos no masterplan §22.
- **Transferência/operadores:** R2 (Cloudflare) como operador de storage; bucket privado; URLs assinadas curtas; nenhuma URL pública persistida (já garantido em código, §2.5).
- **Exposição em logs/cache/analytics:** proibido logar token de convite, URL assinada, conteúdo de documento ou PIN (padrão já existente em `legacy-session.ts:174-185` e `service.ts:710-719` — manter no caminho externo); respostas do portal com `no-store`; nenhum dado autenticado em analytics de terceiros no segmento do portal.

---

## 11. Decisões

### 11.1 Decisão única exigida pelo GOAL

> **CRIAR IDENTIDADE EXTERNA SEPARADA.**

Fundamentos (evidência → conclusão): JWT interno irrevogável (`auth.config.ts:9`) → não atende revogação imediata (G-8/G-10); `AdminUser` é equipe da loja com permissões operacionais (`schema.prisma:2099-2111`) → plano de autorização errado; escopo por cookie + ACL `"all"` (P0-4) → fronteira externa inválida; N:N contador↔empresa → exige entidade própria; PIN legado sem principal (P0-1/P0-3) → inutilizável como fundação; `requireContadorScope` e o schema já foram **projetados** para o segundo caminho (masterplan §6; `schema.prisma:2805`) → a identidade separada é a continuação natural, não uma ruptura. Confirma a opção C da **ADR-CONTADOR-008** (pronta para Accepted no G3).

### 11.2 Decisões derivadas desta auditoria (recomendações para G3)

| # | Decisão | Recomendação |
|---|---|---|
| D-1 | Identidade | Externa separada (§6) — ADR-008 → Accepted |
| D-2 | Rota do portal v2 | Caminho novo `/contador-externo` (§8.1) — ADR-002 → Accepted com emenda de rota |
| D-3 | Sessão externa | Cookie próprio HMAC ≤12h, rotativo, `tokenVersion` (§6.4) |
| D-4 | Convite | Link copiável no MVP (sem provider de e-mail) — confirma ADR-008 |
| D-5 | Papel padrão do convite | `leitura`; `conferencia` concedido explicitamente |
| D-6 | Upload externo | **Fora do MVP** (recomendação); reavaliar pós-CORS R2 provisionado |
| D-7 | Legado | Intocado até G4; kill-switch permanece disponível; critério objetivo de desligamento: portal v2 estável em produção + zero acessos ao legado por janela definida por Rafael (telemetria hoje ausente — §2.7) |

### 11.3 Perguntas abertas para Rafael (G3)

1. Rota final: confirmar `/contador-externo` (ou decidir outro nome; `/portal/contador` descartado por colisão com o portal do cliente final).
2. Convite: link copiável permanece definitivo ou e-mail automático entra no roadmap (provider?).
3. Recuperação de acesso: fluxo self-service mínimo no 014 ou recuperação administrativa (revogar+novo convite) até o 019?
4. Upload externo (guias/retornos): confirma exclusão do MVP?
5. Prazo/critério de desligamento do legado (insumo do G4).
6. Prazo de retenção por categoria (antecipável; senão fica para o 019 como previsto).

---

## 12. Roadmap 014–019

Detalhamento completo (objetivo, escopo, arquivos/módulos prováveis, schema, riscos, testes, critérios de aceite, dependências, gate humano) no documento irmão: **`docs/contador/CONTADOR_HUB_PORTAL_EXTERNO_ROADMAP_014_019.md`**. Síntese:

| GOAL | Linha única | Schema | Gate humano |
|---|---|---|---|
| 014 — Identidade, vínculo e convite | `ContadorUsuario/Convite/Acesso` + sessão externa revogável + página mínima de escopo | **sim** (migration 2 aditiva) | **G3 prévio** + revisão do SQL + gate G-DADOS-SCHEMA |
| 015 — Portal externo read-only | Segmento isolado atrás de flag com leituras, downloads auditados, confirmação, comentários, conferido | não | Aceite funcional de Rafael; gate G-AUTH (trecho novo no proxy) |
| 016 — Obrigações e guias | Agenda manual (templates/obrigações/guias) com "informado pelo responsável" | **sim** (migration 3 aditiva) | Janela de migration coordenada; gate G-DADOS-SCHEMA |
| 017 — Integração Omni Agent | Alertas/rascunhos sobre `ContadorEvento`, envio sempre confirmado por humano | não (se precisar, PARAR e propor) | Aprovação de canal externo antes de qualquer envio |
| 018 — Integração Fiscal | `fiscalReader` read-only por flag; XML autorizado no pacote | não | ADR-007 Accepted + predicado "entregável" aprovado (Passo 0) |
| 019 — Hardening de produção | Retenção/LGPD, observabilidade, carga, e retirada do legado | não | **G4** para retirar o legado; números de retenção aprovados |

Dependências: 013→014 (G3) →015; 012+014→015; 011→016; 012+016→017; 012+fiscal ativo→018; 015→019. Nada da Fase 3 inicia sem G3; GOAL 014 não foi iniciado por esta auditoria.

---

## 13. Critérios de aceite

### 13.1 Deste GOAL 013 (auto-verificação)

- [x] Auditoria read-only completa das frentes A–G com evidência `arquivo:linha` (§§2–5, apêndice §15).
- [x] Conclusão única de identidade justificada por código real (§11.1).
- [x] GOALs 014–019 definidos sem implementação e sem funcionalidades fora do masterplan (§12 + documento irmão).
- [x] Zero alteração em `app/**`, `components/**`, `lib/**`, `prisma/**`, `package*.json`, `proxy.ts`, `auth*`, `.env*`, `scripts/track.*`.
- [x] Diff restrito aos três documentos autorizados + artefatos AEP oficiais de ativação.
- [x] Nenhum push sem a frase exata de autorização humana.

### 13.2 Do programa do portal (macro, herdados do masterplan §25 e especializados por esta auditoria)

1. Contador convidado só lista lojas autorizadas, mesmo forjando `storeId` por URL/header/cookie (teste automatizado em todas as rotas do portal).
2. Sessão externa com principal identificável, expiração, revogação imediata (`tokenVersion`), rate limit e evento de login.
3. Todo reader/ação do portal aplica o escopo externo antes de qualquer select; cookie interno e cookie legado não autenticam rotas externas (teste cruzado).
4. Todo download gera evento **antes** da emissão da URL, com IP/UA; TTL ≤300s; nenhuma URL pública persistida.
5. Revogação de acesso derruba sessão ativa na próxima request; conta suspensa idem.
6. Timeline/comentários no portal exibem apenas contexto `compartilhado`, com `atorId` pseudonimizado.
7. Nenhuma escrita financeira/fiscal/operacional alcançável pelo portal (ausência estrutural de rotas, verificada em revisão de código e teste).
8. Nenhum import de providers do ERP no segmento do portal (teste programático de imports).
9. Flag `CONTADOR_PORTAL_V2` default off; segmento responde "em breve" quando off.
10. Eventos com `atorTipo:"externo"` gravados para login, acesso negado, downloads, comentários, confirmações e conferências.

---

## 14. Recomendação final

1. **Aprovar o G3** com as decisões D-1 a D-7 (§11.2) e as respostas às perguntas §11.3; marcar ADR-002 e ADR-008 como Accepted (com a emenda de rota D-2) no branch do GOAL 014.
2. **Iniciar o GOAL 014 somente após o G3**, com revisão dupla de segurança e revisão do SQL da migration 2 antes do push.
3. **Manter o legado intocado e monitorado** até o G4; considerar `CONTADOR_LEGACY_PORTAL=off` por ambiente quando o v2 estiver estável (decisão de Rafael).
4. **Não antecipar** upload externo, MFA, e-mail automático ou agrupamento por Empresa/CNPJ — todos têm gatilhos próprios já registrados.
5. Corrigir no caminho externo, sem GOAL corretivo novo: IP/UA nos eventos (P1-3), pseudonimização de `atorId` (P2-2), omissão de `storageRef` (P2-3) — são requisitos de aceite do 014/015 (§13.2), não melhorias opcionais.

A auditoria está concluída e a trilha pode seguir para o gate humano.

---

## 15. Apêndice — rastreabilidade A–G da auditoria

| Frente do GOAL | Onde está respondida |
|---|---|
| A. Público e produto (usuário externo, N:N, convite/aceite/suspensão/revogação, recuperação, troca de responsável) | §2.7, §3-A, §6.3–6.4, §7.1 |
| B. Identidade e autenticação (reuso vs separada, isolamento, sessão/cookies/expiração/revogação, MFA, enumeração, convite roubado, replay/vínculo errado) | §2.2, §3-B, §5 (G-2, G-7, G-8, G-11, G-12), §6 |
| C. Autorização (permissões por rota, escopo storeId, competência, documentos visíveis, fechamento/snapshots/pacotes, visualizar×baixar×comentar×solicitar, proibição de escrita, IDOR) | §2.3, §3-C, §5 (G-1, G-3, G-5, G-6), §7 |
| D. Dados e LGPD (pessoais, minimização, logs, retenção, revogação, exportação, consentimento, documentos contábeis, URLs assinadas, R2 privado, logs/cache/analytics) | §2.5–2.6, §3-D, §10 |
| E. Arquitetura (rotas, APIs, componentes, contratos de sessão, autorização, tabelas, gates de schema, convite, vínculo, trilha, rate limit, storage/downloads, fail-closed, observabilidade) | §2, §3-E, §6–8 |
| F. UX (login, seleção de empresa, dashboard, competências, documentos, pacotes, fechamento, solicitações, estados, desktop/mobile, linguagem read-only) | §9 |
| G. Segurança adversarial (todos os cenários listados no GOAL) | §5 (G-1 a G-12) |

— Fim da auditoria GOAL 013.
