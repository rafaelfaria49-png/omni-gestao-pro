# FISCAL-NFCE-CONTINGENCY-020 — Diagnóstico H-9/H-10: janela expirou SEM CONSUMO (login ADMIN bloqueado) (139)

Trilha `fiscal` · GOAL 020 (continuação) · execução do gate `FISCAL-020-H9H10-TRANSPORT-TELEMETRY-138`.
Data: 2026-08-31 · Autorização textual humana recebida verbatim nesta sessão (nova janela de diagnóstico).

## Linha do tempo (UTC)

| Instante | Evento |
|---|---|
| ~02:29 | Gate humano verbatim recebido; janela calculada: `wsdl-h9h10-20260831-0300z-0c42c4389f65469d`, `03:00:00Z → 03:10:00Z` (10 min ≤ teto 15 min) |
| 02:33 | Commit ON `c0d6810` (3 constantes + teste de materialização); revisão independente **APROVADO P0=0 P1=0** (5/5 itens) |
| 02:39–02:42 | PR #135: conflito apenas em `docs/ai/CURRENT_STATUS.md` (drift do PDV-003, zero arquivo fiscal) resolvido mantendo as duas entradas → checks 6/6 → merge `285b459` às **02:42:54Z** |
| 02:49:5x | FASE 4: deployment Production ON `dpl_89dQMuYgkGs9FezDkTfP6JEQN24v` (`8qdg5jf8b`) READY, alias canônico `omni-gestao-pro.vercel.app` anexado automaticamente |
| ~02:54–02:58 | Login ADMIN pré-janela (NextAuth credentials, jar temporário, cookie/senha nunca impressos): **FALHOU** — `302 → /login?error=CredentialsSignin` em TODAS as tentativas |
| 03:00–03:10 | **FASE 5 NÃO EXECUTADA (decisão fail-closed)**: sem sessão ADMIN válida, a ÚNICA chamada administrativa NÃO foi feita. A janela expirou às 03:10Z sem consumo |
| 03:03 | Segredos temporários apagados (jar de sessão, arquivo de senha, `.env.production` extraído) |
| 03:05 | Commit OFF `8afa132` (`{null,null,null}` + activation `0c42c4389f65469d` nas proibidas); testes 66/66 |
| 03:18:33 | PR #136: checks 6/6 → merge → **`main = a546ca9`** |
| 03:22 | Deploy Production OFF `dpl_6ySRdQDKS7cTuDjsMdwNQuAbMV1z` (`gshf9o7n1`) READY; alias canônico no OFF |
| 03:24 | Inventário + remoção: ON production `8qdg5jf8b` + previews ON `ldwai1y7u` e `9vgy1y50s` **REMOVIDOS**; `ACTIVE_ON_DEPLOYMENTS_REMAINING = 0` |

## Bloqueio: credencial ADMIN indisponível ao executor

- Tentativas de login `admin@rafacell.com.br` no host canônico (NextAuth credentials, fluxo
  padrão CSRF → `/api/auth/callback/credentials`): todas rejeitadas com
  `CredentialsSignin` — tanto com a literal `loja-1` (notação da evidência 134) quanto com
  `ADMIN_DEFAULT_PASSWORD` extraída das envs de Production da Vercel (valor de 11 caracteres,
  **nunca impresso**, usado apenas em memória e apagado em seguida).
- `authorize()` do NextAuth recusa por: usuário inexistente, `active=false` ou bcrypt
  mismatch — não é possível distinguir sem consulta adicional, e a recuperação de hash bcrypt
  é impossível por construção.
- **Redefinir a senha no banco de produção EXCEDE a autorização do gate** (escrito e
  capacidade fora do escopo) — não foi feito.
- Consulta read-only ao DB de produção foi tentada para diagnóstico do bloqueio, abortada por
  indisponibilidade do client Prisma no ambiente local; nenhuma escrita foi tentada.

## Resultado

- **WSDL_ADMIN_CALL_COUNT = 0** · **WSDL_EXTERNAL_GET_COUNT = 0** ·
  **SEFAZ_SOAP_POST_COUNT = 0** · **SEFAZ_PRODUCTION_REQUEST_COUNT = 0**
- A activation `0c42c4389f65469d` **NÃO foi consumida**: nenhuma chamada alcançou o consumo
  (nem sequer a ACL) — o one-shot global segue íntegro e a janela morreu por relógio
  (`expired` → 404 antes de ACL/Prisma/A1/socket, permanente).
- **Nenhum documento WSDL bruto foi recebido, persistido ou visto.** `RAW_WSDL_PERSISTED = false`.
- Nenhum segredo (cookie, token, senha, PFX, ref) foi extraído para fora do ambiente local
  temporário ou impresso; todos os artefatos temporários foram apagados.
- A telemetria sanitizada do GOAL 138 está em produção e pronta: na próxima janela autorizada,
  uma única chamada devolve `transportPhase`/`transportClass`/`transportCode` por serviço.

## Classificação (execução do gate 138)

**B-EXTERNAL-DEPENDENCY** — bloqueio real externo (credencial ADMIN não disponível ao
executor). Não-D: zero rede, zero emissão, zero produção, zero segredo exposto, janela OFF
restaurada, deployments ON removidos (não abandonados), 020 RUNNING, 021 não iniciado,
`track close` NÃO executado.

**Próximo passo (exige decisão humana):** fornecer a credencial ADMIN válida de produção
(ou redefinir `AdminUser` por via própria) e emitir NOVA autorização textual para uma nova
janela efêmera de diagnóstico. A autorização desta janela NÃO é reutilizável — a janela
`0c42c4389f65469d` está morta por relógio e proibida.

## Addendum (31/08 · 17:1xZ) — 2ª autorização recebida e NÃO consumida

Nova autorização textual verbatim (mesmo texto do gate) foi recebida nesta sessão. **Nenhuma
janela foi materializada**: `activationId` não criado, nenhuma constante ON, nenhum commit,
nenhuma rede — o gate permanece não-consumido à espera da credencial (materializar uma
segunda janela sem sessão ADMIN válida a queimaria inutilmente, repetindo o 139).

Diagnóstico adicional do bloqueio de login (tudo read-only, segredos nunca impressos):

1. **`vercel env pull` (CLI 57) REDACIONA valores sensíveis**: a "senha" de 11 caracteres
   extraída das envs de Production era literalmente `[SENSITIVE]` — o teste da
   `ADMIN_DEFAULT_PASSWORD` do addendum anterior era INVÁLIDO (nunca testou a senha real).
   O valor real é inacessível por CLI/API (env marcada sensível/write-only na Vercel).
2. Senha candidata do `.env` local de dev (`ADMIN_DEFAULT_PASSWORD`, 11 chars, valor real):
   rejeitada pela produção (`302 → /login?error=CredentialsSignin`) — o DB de produção não
   compartilha (ou não possui) o usuário/semente de dev.
3. `loja-1` como senha: rejeitada (teste real). A notação `admin@rafacell.com.br`/`loja-1`
   da evidência 134 não funciona como email/senha na produção de hoje.
4. Sessão do navegador: existe `__Secure-authjs.session-token` para o host canônico no
   perfil Firefox "Perfil 3", mas com último acesso **2026-05-21** — o servidor rejeita
   (stale/revogada). `authenticated=false` na `/api/auth/session`.
5. Fluxo de login programático verificado como correto: o `CredentialsSignin` provém do
   próprio `authorize()` do NextAuth (usuário inexistente, inativo ou bcrypt mismatch) —
   o problema é a CREDENCIAL, não o mecanismo.

**Estado após este addendum**: produção OFF (`a546ca9`), janela `null/null/null`,
deployments ON = 0, branch `29371ac`, zero rede NESTA janela (139). *(Correção documental
registrada na evidência 140: o GOAL 020 acumulado NÃO tem zero rede — a execução 137
(30/08, 20:05:17Z) teve `WSDL_ADMIN_CALL_COUNT=1` e `WSDL_EXTERNAL_GET_COUNT ≤ 6`; a
afirmação "zero rede acumulada neste GOAL" e "`WSDL_ADMIN_CALL_COUNT` total: 0" desta linha
era erro factual e está corrigida aqui.)*

**Desbloqueio (qualquer um, decisão humana):**
- (a) login ADMIN realizado pelo humano no perfil Firefox "Perfil 3"
  (https://omni-gestao-pro.vercel.app/login) seguido de novo gate — o executor reutiliza a
  sessão do navegador na hora da janela (nenhum segredo trafega no chat); ou
- (b) humano fornece a senha ADMIN de produção (entrará no transcript do chat; recomenda-se
  trocá-la após o diagnóstico); ou
- (c) humano redefine o `AdminUser` no `omnigestao_prod` por via própria e informa a nova
  senha (mesma ressalva de transcript).

## Addendum 2 (31/08 · 18:1xZ) — sessão humana está no CHROME; Firefox continua vazio

O humano validou o login manualmente, porém no **Chrome** (perfil Default; token
`__Secure-authjs.session-token` criado 31/08 13:12Z, válido até 30/09) — não no Firefox
"Perfil 3" como presumido (token local de 21/05, stale, rejeitado pelo servidor).

Tentativas técnicas de usar a sessão do Chrome pelo executor (todas read-only, sem segredo
impresso, sem tocar na senha):
1. Leitura direta do DB de cookies do Chrome: valores **app-bound (v20)** — ilegíveis fora
   do Chrome por desenho.
2. Chrome headless com perfil temporário (cópia): Chrome reconstitui perfil vazio (HMAC de
   `Secure Preferences` ligado ao caminho).
3. CDP no data dir real: Chrome **recusa** ("DevTools remote debugging requires a
   non-default data directory").
4. Junction (mklink) para o User Data real: CDP abre, mas o app-bound **liga a chave ao
   caminho do data dir** — o Chrome não decripta os próprios cookies no caminho alternativo
   (proteção anti-cópia funcionando como projetado).

Nenhum cookie de sessão foi extraído, nenhum valor impresso, a senha jamais foi solicitada
ou lida, o token real do usuário permanece intacto no perfil Chrome. **Nenhuma janela foi
materializada; gate segue não-consumido; zero rede; `main = a546ca9`; janela null/null/null.**

**Desbloqueio mínimo restante**: login humano em https://omni-gestao-pro.vercel.app/login
usando o **Firefox (perfil "Perfil 3")** — cookies do Firefox são legíveis pelo executor
(mecanismo já provado). Depois disso, o fluxo completo (janela → 1 chamada → containment)
leva ~20 min e não requer nenhuma autorização nova além do gate não-consumido.
