# CONTADOR HUB — GOAL 012B · DECISÃO DE PROVIDER DE STORAGE PRIVADO

| Campo | Valor |
|---|---|
| GOAL | `CONTADOR-HUB-STORAGE-PROVIDER-DECISION-012B` |
| Data | 2026-07-28 |
| Tipo | Decisão / **DOCUMENTAL — zero código** |
| Base | `origin/main = 3bcaf83` (mesma base declarada do GOAL 012A) |
| Branch | `docs/contador-012b-storage-provider-decision` |
| Worktree | `C:\Projetos\omni-gestao-contador-012b` |
| Banco acessado | **nenhum** (nenhum acesso ao Neon, ao Supabase ou a qualquer outro serviço externo) |
| Código alterado | **nenhum** |
| Secrets lidos/escritos | **nenhum** — somente nomes de variáveis de ambiente |
| Supabase/Cloudflare/Vercel alterados | **nenhum** (zero buckets, zero secrets, zero deploys, zero registros) |
| Branches do GOAL 012A tocadas | **nenhuma** (`goal/contador-012a-fechamento-closure` permanece intacta, commits não publicados) |
| Push para `main` | não realizado (somente push da branch declarada) |
| PR aberta/mesclada | nenhuma |
| Próximo GOAL (implementação) | `CONTADOR-HUB-STORAGE-R2-ADAPTER-013` (proposto) |

> Este documento é **somente decisão**. Não contém código, não provisiona nada, não
> altera credenciais. é o gate antes do GOAL de implementação do adapter R2.

---

## 1. Estado atual

### 1.1 Banco operacional
- **Neon** é o banco operacional oficial.
- **Supabase** está **congelado como contingência / plataforma opcional** — não é
  mais o alvo de dados vivos, e nenhuma credencial operacional do app指向 ele hoje.

### 1.2 Contrato (porta) de storage do Contador
Local: `lib/contador/documentos/storage-types.ts` (somente no branch do GOAL 012A —
não existe em `origin/main`).

A porta `StorageDocumentosPort` expõe **8 métodos**:

| Método | Papel |
|---|---|
| `verificarBucket()` | Verifica existência e visibilidade do bucket — **nunca cria** |
| `criarUploadAssinado(storageRef, expiresInSec?)` | Devolve URL assinada para **PUT direto do navegador** |
| `enviarConteudoPrivado(storageRef, conteudo, mime)` | **Upload server-side** (novo no GOAL 012 — usado só pelo ZIP oficial) |
| `obterMetadata(storageRef)` | Tamanho/MIME do objeto |
| `abrirConteudoPrivado(storageRef)` | Baixa o conteúdo para validação/hash server-side |
| `criarDownloadAssinado(storageRef, nomeArquivo, expiresInSec?)` | URL assinada de download (attachment, ≤ 300s) |
| `removerObjeto(storageRef)` | Remoção (limpeza pós-validação inválida) |
| `verificarExistencia(storageRef)` | `true`/`false` derivado de `obterMetadata` |

**Regra de ouro do contrato:** nenhum método devolve URL pública permanente —
upload e download usam URLs assinadas de curta duração; `storageRef` é sempre o
path privado. Esse contrato é **provider-agnostic**: não cita Supabase nas
assinaturas de método (somente em JSDoc e no `token` do `UploadAssinado`).

Limites aprovados (GOAL 010B), em `lib/contador/documentos/config.ts`:

| Constante | Valor | Semântica |
|---|---|---|
| `MAX_BYTES_DOCUMENTO` | 25 MB (25 × 1024 × 1024) | Teto por documento |
| `DOWNLOAD_EXPIRACAO_SEG` | 300 s | Teto de validade do download assinado |
| `UPLOAD_EXPIRACAO_SEG` | 120 s | Validade da autorização de upload do navegador |

Allowlist de extensão/MIME: `pdf`, `xml`, `csv`, `xlsx`, `png`, `jpg`, `ofx`,
`txt`, `zip` — com validação de **magic bytes** server-side no passo `complete`
(`lib/contador/documentos/validacao.ts`).

### 1.3 Adapter vigente (Supabase Storage)
Local: `lib/contador/documentos/storage-supabase.ts`.

- Usa `@supabase/supabase-js` `createClient(url, serviceRoleKey)` server-only,
  sem sessão persistida (`auth: { persistSession: false, autoRefreshToken: false }`).
- `verificarBucket` → `getBucket`, **nunca cria**.
- `criarUploadAssinado` → `createSignedUploadUrl` com `upsert: false`.
- `enviarConteudoPrivado` → `upload(..., { contentType, upsert: true })` — permitido
  aqui porque o path é endereçado por conteúdo (`.../{manifestoHash}.zip`):
  reescrever é reescrever bytes idênticos (retry idempotente, nunca sobrescrita
  silenciosa).
- `obterMetadata` → `list(dir, { search })` + `find` — implementação frágil, depende
  de inferência por listing.
- `criarDownloadAssinado` → capado em `DOWNLOAD_EXPIRACAO_SEG = 300 s`.
- Fail-closed: erros externos → `StorageError` (mensagem segura genérica, nunca
  token/URL).
- Memoiza o cliente (singleton por processo).

### 1.4 Configuração de ambiente esperada
`lib/contador/documentos/config.ts` exige **3 variáveis** server-side:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`

Proteções:
- `storageConfigDisponivel()` — `true` quando as 3 existem.
- `lerStorageConfig()` lança `StorageConfigError` (exibe APENAS os nomes das vars
  faltantes, nunca os valores).
- **Hard guard:** se qualquer var com prefixo `NEXT_PUBLIC_` casa `/SERVICE_ROLE/i`,
  rejeita com erro explícito de segurança — service role nunca é pública.

### 1.5 Variáveis existentes na Vercel — verificação de nomes
O doc do GOAL 012 (`docs/contador/CONTADOR_HUB_FECHAMENTO_SNAPSHOT_012.md §12.1`)
registra, com verificação instrumental, que **as 3 vars Supabase Storage
(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`) NÃO
existem em nenhum ambiente Vercel** (Preview ou Production).

Esta rodada de auditoria **não reexecutou** `vercel env ls` — o CLI local
reportou ausência de credenciais (`No existing credentials found`) e exigiria
`vercel login` (token), o que escaparia ao escopo deste GOAL. A afirmação acima
se apoia na verificação instrumental prévia (mesma verificação da equipe que
abriu este GOAL, persistida no doc 012 §12.1) e na evidência de código (CLAUDE.md
documenta apenas `DATABASE_URL`/`DIRECT_URL`, nenhuma var Supabase Storage).

**Nenhum valor de secret foi lido, impresso ou armazenado em qualquer artefato
deste GOAL.** Apenas nomes de variáveis são referidos.

### 1.6 Pontos de consumo do adapter (produção)
Quatro sítios importam diretamente `storageSupabase`:

| Sítio | Linha | Como usa |
|---|---|---|
| `app/api/contador/documentos/upload-intent/route.ts` | 15 | `criarUploadIntent(deps = { storage, repo })` |
| `app/api/contador/documentos/complete/route.ts` | 15 | `completarUpload(deps = { storage, repo })` |
| `app/api/contador/documentos/[id]/download/route.ts` | 15 | `autorizarDownload(deps = { storage, repo })` |
| `lib/contador/fechamento/portas.ts` | 12 (import) + 24/25/27 (delegates) | `StoragePacotePort` production (envia/verifica/download do ZIP) |

A regra de orquestração está em **services puros** — só enxergam a porta
inyetada (`StorageDocumentosPort` para documentos; `StoragePacotePort` wrapper
para o ZIP). Não importam `storage-supabase.ts` diretamente:

- `lib/contador/documentos/service.ts` — upload intent / complete / download /
  soft-delete / **congelamento de competência fechada**.
- `lib/contador/fechamento/service.ts` — fechar/reabrir / listar versões /
  autorizar download do pacote, com **atomicidade storage × transação**
  (upload ANTES da tx; blob órfão fica inalcançável, pois só é resolvível por
  linha `ContadorPacote` commitada).

**Conclusão de swap:** trocar o adapter concreto é **cirúrgico** — 4 imports +
1 novo arquivo de adapter + 1 companion de config. Service, regras, validação,
congelamento, snapshot, lock `FOR UPDATE` e **todos os testes** (que usam fakes
inyetáveis, provider-agnostic) **não mudam**.

### 1.7 Frontend — PUT cru (impacto do swap no navegador)
`components/dashboard/contador/documentos/contador-documentos-real.tsx` (em ~438):

```ts
const intent = (await intentRes.json()) as {
  documentoId: string
  storageRef: string
  signedUrl: string     // ← o único campo de storage usado
}
await putComProgresso(intent.signedUrl, file, mime, setProgresso)  // PUT cru
```

- O frontend **não usa** o SDK Supabase.
- O frontend **não lê** o campo `token` retornado pela rota (descartado no
  parse do tipo).
- Faz **PUT cru** à `signedUrl` com o binário e `Content-Type`.

**Implicação decisiva:** um URL presigned de R2 (S3-compatible) é drop-in para o
frontend — o navegador PUT ao R2 funciona exatamente igual ao PUT ao Supabase,
sem mudar uma linha frontend. **O swap é 100% backend.**

### 1.8 Dependências de storage instaladas no projeto
- `package.json` da `main`: **nenhuma** — sem `@supabase/supabase-js`, sem
  `@aws-sdk/*`, sem `@cloudflare/*`, sem Vercel Blob, sem Uploadthing.
- `node_modules` (main): confirmado ausência de `@aws-sdk`, `@supabase/supabase-js`
  e `@cloudflare`.
- O branch do GOAL 012A **adiciona** `@supabase/supabase-js": "^2.110.7"` (não
  está em `main`).

### 1.9 Outros providers de storage já disponíveis no projeto
Busca direta em `lib/`, `app/`, `components/`, `package.json` por
`BLOB_READ_WRITE_TOKEN`, `vercel/blob`, `uploadthing`, `cloudinary`,
`S3_ENDPOINT`, `R2_`, `@aws-sdk/client-s3`, `presigned`, `putObject`,
`createPresignedUrl`, `MINIO_`, `cloudfront` — **nenhuma ocorrência em código
vivo**. A única menção é um TODO em
`docs/auditoria/CADASTROS_FLUXOS_UNIFICACAO.md:147` ("Upload de imagem: integrar
com Supabase Storage ou S3").

**Conclusão:** o Contador é **greenfield** quanto a storage — não há provider
legado do qual pendurar. A "opção de reusar provider já disponível no projeto"
não existe materialmente.

### 1.10 Bolha / atomicidade / limpeza — como está hoje
- Storage **não participa** da transação PostgreSQL.
- A ordem vigente (GOAL 012 §4) é: gerar ZIP + manifesto + hashes em memória →
  `enviarConteudoPrivado` (upload) → **só depois** a transação (`competência` +
  `pacote` + `itens` + `evento`).
- Falha após o upload deixa um **blob órfão**, porém **inalcançável**: a app só
  resolve `storageRef` a partir de `ContadorPacote` commitada.
- A **limpeza de órfãos** (job que varreria `contador/**/pacotes/**` sem linha
  correspondente) está registrada como pendência operacional, **fora do escopo**
  do 012A.

### 1.11 Impacto nos GOALs 010 / 012 / 012A
| GOAL | Impacto de trocar provider |
|---|---|
| **010** (documentos/ACL) | Contrato + regra fail-closed + 25 MB + MIME/magic bytes + soft-delete + signed-URL-only — **todos provider-agnostic desde o desenho**. Trocar adapter não reabre 010. |
| **012** (fechamento + snapshot) | `SNAPSHOT_CAMINHO_PACOTE = "00-FECHAMENTO/snapshot.json"` e o path `contador/{storeId}/{AAAA-MM}/pacotes/v{N}/{manifestoHash}.zip` são agnósticos. R2 aceita chaves com `/`. `enviarConteudoPrivado` no R2 (PutObject, upsert implícito) **preserva** o retry idempotente por path content-addressed. |
| **012A** (closure + smoke) | Os dois fechamentos técnicos (snapshot v2 e `FOR UPDATE` no `contador_competencias`) **não tocam storage**. O smoke só precisa da credencial; o custo do swap é pago no próximo GOAL (`013`). |

---

## 2. Matriz objetiva de comparação

| Critério | **Cloudflare R2** | Supabase Storage (reativado) | "Provider já disponível no projeto" |
|---|---|---|---|
| Provider já provisionado | Não — greenfield, setup ~10 min | Não — env não existe; plataforma congelada | **Inexistente** |
| Compatibilidade S3 | **Nativa** (S3 API + presigned URLs) | API própria (SDK Supabase); não S3 | n/a |
| URL privada assinada | **Sim** — `getSignedUrl` S3 | Sim — `createSignedUrl` | n/a |
| Upload direto navegador (signed PUT) | **Sim** — `getSignedUrl(PutObject)` | Sim — `createSignedUploadUrl` | n/a |
| Upload server-side | **Sim** — `PutObject` | Sim — `upload` | n/a |
| `obterMetadata` | **Direto** — `HeadObject` (mais robusto) | Hoje: `list+find` (frágil) | n/a |
| Fail-closed com env ausente | **Mesmo desenho** `StorageConfigError` (nomes só) | Já implementado | n/a |
| Token com escopo **por bucket** | **Sim** — R2 API token bucket-scoped (`Object Read & Write`) | **Não** — `service_role` é project-wide e **bypassa RLS** | n/a |
| Egress | **GRATUITO** (egress → internet = $0) | Pago acima da cota do plano (Pro: 8 GB/mês grátis, depois cobrado) | n/a |
| Custo previsível | ~$0.015/GB/mês · Class A $4.50/M · Class B $0.36/M · egress $0 | Reativar Supabase Pro ~ $25/mês + egress | n/a |
| Volume esperado Contador (~50–200 MB/ano de ZIPs+PDFs por loja) | **<< $1/mês** | ~$25/mês (plano Pro completo reativado) | n/a |
| Isolamento Preview × Production | **Buckets separados** (`...-preview`, `...-prod`) + vars por ambiente | Mesmo bucket único (`SUPABASE_STORAGE_BUCKET`) com prefixo de path | n/a |
| Lifecycle / TTL (descarte de órfãos) | **Nativo** — R2 Object Lifecycle Rules via painel | Apenas via job custom | n/a |
| Integração com Vercel | Env vars + `@aws-sdk/client-s3` server-side | SDK Supabase server-side | n/a |
| Bundle adicionado | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (~250 KB server-only) | `@supabase/supabase-js` (já no branch 012A) | n/a |
| Frontend muda? | **Não** — PUT cru à `signedUrl` funciona idêntico | Não | n/a |
| Testes mudam? | **Não** — fakes inyetáveis, provider-agnostic | Não | n/a |
| Mantém `StorageDocumentosPort` intocado? | **Sim** | Sim | n/a |
| Rollback (reverter provider) | 1 adapter + 4 imports — ~10 min, sem schema, sem DB | ( rollback = "voltar ao Supabase" ) | n/a |
| Risco de teardown futuro | **Baixo** — R2 é produto maturity, Cloudflare estável | **Médio/alto** — Supabase é "contingência congelada"; pode ser re-desativado | n/a |
| Reabre GOAL 010 / 012 / 012A? | **Não** (apenas adapter concreto) | Não | n/a |

---

## 3. Decisão recomendada

### PROVIDER OFICIAL RECOMENDADO: **Cloudflare R2** (S3-compatible)

#### Motivo único
A decisão arquitetural vigente declarou Supabase como **contingência congelada**.
Reativar Supabase Storage para o módulo **mais sensível** do projeto (documentos
contábeis/fiscais sob `service_role` project-wide) **recriaria exatamente o risco
operacional** que motivou o congelamento:

1. **Dependência de plataforma em standby** — Supabase não é mais o alvo de
   dados vivos; mantê-lo como storage de documentos regulados transfere
   risco de teardown/faturamento a um serviço fora do radar operacional.
2. **Token de alto privilégio** — `service_role` Supabase é project-wide e **bypassa
   RLS**. Não há como emitir credencial escopada a um único bucket. Vazamento =
   acesso a tudo do projeto Supabase.
3. **Baixo isolamento Preview × Production** — um único
   `SUPABASE_STORAGE_BUCKET` compartilharia prefixo entre ambientes — qualquer
   bug cruza dados de ambiente.
4. **Custo injustificável** — reativar Supabase Pro para ~100 MB/ano de documentos
   contábeis é ~$25/mês de plano completo + egress pago — orders of magnitude
   acima do custo marginal real.

Não existe um caminho "reativar sem recriar o risco" — pois a única credencial
real (`service_role`) é estruturalmente project-wide, e nenhum bucket é nativamente
isolável por variável por ambiente do jeito que R2 permite. Logo, **reativar
Supabase Storage é a opção descartada**.

#### Por que R2 fecha o critério
- **Compatibilidade S3** → swap cirúrgico do adapter, **sem tocar** contrato /
  service / testes / frontend.
- **Token bucket-scoped** → blast-radius mínimo se a credencial vazar (em
  contraste direto com a `service_role` project-wide).
- **Egress gratuito** → fit perfeito para "snapshot read-back (validar hash
  server-side no `complete`) + download de múltiplas versões do ZIP" — operações
  de I/O que no Supabase pagariam egress.
- **`HeadObject` nativo** → troca o frágil `list+find` atual por uma operação
  direta de metadata (qualidade superior a adapter vigente).
- **Custo previsível ≈ gratuito** na escala do Contador ($0.015/GB/mês × ~1 GB).
- **Buckets separados** Preview × Production → isolamento físico real.
- **R2 Object Lifecycle Rules** → ferramenta nativa (sem código) que pode
  substituir ou complementar o job de limpeza de órfãos pendente (GOAL 019).
- **Não reabre** nenhum GOAL prévio (010, 012, 012A) — só substitui o adapter
  concreto.
- **100% backend** — frontend, contrato, services e testes não mudam.

#### Riscos da escolha
1. **Setup único humano** — criar conta Cloudflare (se inexistente), habilitar
   R2 (cartão requerido para ativar, mas sem cobrança até uso real), criar 2
   buckets, emitir 1 token bucket-scoped, cadastrar ~5 vars na Vercel. Fora do
   escopo desta IA — instruído na §6.
2. **2 deps novas server-only** (`@aws-sdk/client-s3` +
   `@aws-sdk/s3-request-presigner`) — ~250 KB no bundle server, nenhum impacto
   client/PWA.
3. **`UploadAssinado.token` (string)** no contrato hoje carrega Supabase
   semantics. Para R2 não há token separado — o URL presigned é auto-contido.
   Decisão de implementação recomendada: devolver `token: ""` (string vazia) e
   atualizar o JSDoc para descrever `token` como "compatibilidade de retorno;
   vazio para providers S3-compatible". **Mantém o contrato intocado** — frontend
   já descarta esse campo.
4. **Smoke pós-implementação obrigatório** — validação manual mínima após o
   próximo GOAL, prevista no roteiro §8.

#### Custo operacional esperado
| Item | R2 (Preço Cloudflare público 2026) | Estimativa Contador |
|---|---|---|
| Storage | $0.015 / GB-mês | 1–10 GB total → ~$0.02–$0.15/mês |
| Class A (writes / list / put) | $4.50 / 1 M ops | centenas/mês → negligible |
| Class B (reads / get / head) | $0.36 / 1 M ops | milhares/mês → negligible |
| Egress (R2 → internet) | **$0** | $0 |
| **Total plageável** | **< $1/mês** em qualquer projeção realista |

#### Impacto no código (a ser feito no próximo GOAL, **não agora**)
- **NOVO** `lib/contador/documentos/storage-r2.ts` — implementa
  `StorageDocumentosPort` via `@aws-sdk/client-s3` +
  `@aws-sdk/s3-request-presigner`.
- **NOVO companion** `lib/contador/documentos/storage-r2-config.ts` (ou extensão
  de `config.ts`) — `ENV_KEYS` R2 + `lerStorageR2Config` + hard guard
  `NEXT_PUBLIC_*` rejeição.
- **EDITAR 4 imports** (de `storage-supabase` para `storage-r2`):
  - `app/api/contador/documentos/upload-intent/route.ts`
  - `app/api/contador/documentos/complete/route.ts`
  - `app/api/contador/documentos/[id]/download/route.ts`
  - `lib/contador/fechamento/portas.ts` (import + delegates das 3 chamadas)
- **MANTER (morto/legacy)** `lib/contador/documentos/storage-supabase.ts` —
  marcado `@deprecated` em JSDoc, **não removido** (é o caminho de rollback).
- **INTACTOS**: contrato (`storage-types.ts`), services (`documentos/service.ts`
  + `fechamento/service.ts`), validação, MIME/tamanho, congelamento, snapshot,
  lock `FOR UPDATE`, atomicidade, todos os testes (fakes inyetáveis), frontend.
- **`package.json`**: adicionar 2 deps server-only.

#### Impacto no smoke do GOAL 012A
O smoke continua **bloqueado por credencial** até o próximo GOAL empurrar o
adapter R2 (ou, alternativamente, o humano cadastrar credenciais Supabase —
caminho rejeitado pela presente decisão por recriar o risco operacional).

Após o swap (próximo GOAL), os **13 passos do smoke 012A rodam inteiros** sem
mudança de código de domínio: snapshot v2 dentro do ZIP, pacote v1, upload via
`PutObject` idempotente, download assinado ≤300s attachment, validação hash
server-side, soft delete, reabertura auditada, pacote v2, comparação.

O fluxo de atomicidade (upload-antes-da-tx; blob-órfão-inalcançável) é idêntico
no R2 — PutObject sobrescreve (o "upsert:true" do desenho 012) e o path é
content-addressed (`manifestoHash`), então retry idempotente.

---

## 4. Arquitetura-alvo

```
                  Rotas API (`/api/contador/documentos/*` | `/api/contador/fechamento` | …)
                                      │  (1 import só)
                                      ▼
                          storage-r2.ts  — CAMINHO NOVO  (S3-compatible)
                          implements StorageDocumentosPort
                                      │
                                      ▼
              ┌──────────────────────────────────────────────┐
              │  documentos/service.ts            (puro)     │
              │  fechamento/portas.ts             (wiring)   │  ← inalterados
              │  fechamento/service.ts            (puro)     │
              └──────────────────────────────────────────────┘
                                      │
       ┌──────────────────────────────┴───────────────────────────────┐
       ▼                                                             ▼
   R2 bucket privado (Preview)                          R2 bucket privado (Production)
   `omni-contador-documentos-<...>-preview`            `omni-contador-documentos-<...>-prod`
   Token R2 escopado SÓ a este bucket                  Token R2 escopado SÓ a este bucket
   (Access Key ID + Secret — Object Read & Write)      (Access Key ID + Secret — Object Read & Write)
```

### 4.1 Regras-chave da arquitetura-alvo
1. **Bucket único por ambiente** — Preview e Production fisicamente isolados
   por buckets distintos. A var de bucket aponta para nomes diferentes em cada
   Vercel environment.
2. **Token bucket-scoped** — credencial só consegue ler/escrever naquele(s)
   bucket(s). Sem `service_role` project-wide.
3. **Sem bucket público** — nunca habilitar `public_access`. Nenhuma rota expõe
   `getPublicUrl` ou URL permanente (mantido do desenho 010).
4. **Política de prefixos (chaves)** mantida do 012:
   - Documentos: `contador/{storeId}/{AAAA-MM}/documentos/{documentoId}/{nomeSanitizado}`
   - Pacotes: `contador/{storeId}/{AAAA-MM}/pacotes/v{N}/{manifestoHash}.zip`
5. **Política de acesso privado** — todos os downloads via URL assinada
   (≤300s). Todos os PUT diretos (navegador) via presigned URL (≤120s). Todos os
   PUT server-side (ZIP) via `PutObject` (upsert implícito, idempotente por path
   content-addressed).
6. **Assinatura de download** — `getSignedUrl(GetObjectCommand, { expiresIn,
   ResponseContentDisposition: "attachment; filename=\"" + nomeArquivo + "\"" })`.
   Cap 300s preservado. O `ResponseContentDisposition` força o
   `Content-Disposition: attachment` — download, não inline (mantém o
   comportamento atual do adapter Supabase).
7. **Estratégia de rollback** — `storage-supabase.ts` permanece no tree como
   adapter `@deprecated`. Reverter = refazer os 4 imports em ~10 min (1 commit
   `revert`), sem schema, sem DB, sem alterar a linha `ContadorPacote` /
   `ContadorDocumento` (são provider-agnostic). Notar: "voltar ao Supabase"
   implicaria também cadastrar as 3 vars Supabase Storage hoje inexistentes
   (alis, additional friction) — ou seja, em cenário real de rollback o custo
   do lado humano também é pago; o caminho de rollback é técnico-rápido mas
   assume provisionamento reverso.
8. **Destino do adapter Supabase existente** — `lib/contador/documentos/storage-supabase.ts`
   **não é removido**. Marcado `@deprecated` via JSDoc + referenciado neste
   documento como caminho de rollback. Justificativa: o CORE_RULES §3 pede
   mudanças cirúrgicas (remover o arquivo ultrapassaria o escopo do próximo
   GOAL e quebraria o caminho de rollback trivial). Nenhum outro consumidor
   importa o adapter legado além dos 4 sítios listados (ver §1.6).

---

## 5. Secrets necessários (somente pelos nomes)

> **Nenhum valor de secret foi lido, impresso ou armazenado.** Apenas nomes.

Server-side only (**NENHUM** com prefixo `NEXT_PUBLIC_` — hard guard permanece):

| Nome | Ambiente Vercel | Propósito |
|---|---|---|
| `R2_ACCOUNT_ID` | Preview + Production | Compor endpoint R2 (`https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`) |
| `R2_ACCESS_KEY_ID` | Preview + Production | Access Key ID do token bucket-scoped |
| `R2_SECRET_ACCESS_KEY` | Preview + Production | Secret do token bucket-scoped |
| `R2_BUCKET_DOCUMENTOS` | Preview + Production | Nome do bucket — **valor diferente por ambiente** (`...-preview` / `...-prod`) |
| `R2_BUCKET_PACOTES` | Preview + Production | (opcional — default: reusar `R2_BUCKET_DOCUMENTOS` com prefixo `pacotes/`) — segundo bucket separado para pacotes oficiais |
| `R2_ENDPOINT` | Preview + Production | (opcional — default derivável de `R2_ACCOUNT_ID`) override de endpoint |

Variáveis Supabase Storage existentes hoje: **nenhuma**. Logo, **cleanup não é
necessário** — nada a remover do histórico de secrets.

Variáveis que **continuam sendo usadas** pelo `lib/contador/documentos/config.ts`
atual (apenas enquanto `storage-supabase.ts` existir como `@deprecated` e não for
removido):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` —
  **podem ser descontinuadas** no futuro próximo (ou este arquivo pode ser
  removido quando o rollback de R2 deixar de ser uma vantagem). Decisão de
  cleanup deferida ao fim da janela de rollback (sugestão: 30 dias pós-smoke).

---

## 6. Passos humanos de provisionamento

> Tudo fora desta sessão. **Não foi executado nada aqui.**

a. **Conta Cloudflare** — criar ou reusar; habilitar R2 (cartão é requerido
   pela Cloudflare para ativar R2, mas não há cobrança até uso real — manter
   Free Tier é cômodo).

b. **Buckets**:
   - Criar `omni-contador-documentos-preview` — `public_access = OFF`.
   - Criar `omni-contador-documentos-prod` — `public_access = OFF`.
   - Opcionalmente `omni-contador-pacotes-preview` e `omni-contador-pacotes-prod`
     (ou reusar o bucket de documentos com o prefixo `pacotes/` — decisão de
     operação, não de código; o desenho foi pensado para ambos).

c. **API Token R2** (Cloudflare → R2 → Manage R2 API Tokens → Create):
   - Permissions: **Object Read & Write** (não Admin). Sem Account Admin.
   - Bucket scope: **only** the two buckets above (ou um token separado por
     ambiente — ainda mais seguro). Essa restrição é o que torna o blast radius
     mínimo se a credencial vazar.
   - Anotar `R2_ACCOUNT_ID` (visto no painel), o `Access Key ID`, o `Secret
     Access Key` (este **não** se recupera depois — guardar em secrets manager).

d. **Vercel** (Project → Settings → Environment Variables):
   - Para `Preview`: cadastrar `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
     `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_DOCUMENTOS = omni-contador-documentos-preview`
     (e `R2_BUCKET_PACOTES` se aplicável).
   - Para `Production`: idem, com bucket `omni-contador-documentos-prod`.
   - **Não copiar nada do Supabase** — nada existe para ser copiado. Zero
     histórico de secrets para limpar.
   - Não cadastrar nenhuma var com prefixo `NEXT_PUBLIC_` — todo storage é
     server-only (`runtime = "nodejs"`, `dynamic = "force-dynamic"`).

e. **R2 Object Lifecycle Rules** (opcional, sem código):
   - Em cada bucket: Settings → Object Lifecycle Rules → Create rule.
   - Hoje o desenho **não produz** prefixo "órfão" explícito (órfãos são
     armazenados no mesmo path de pacotes válidos; ainda impossível de distinguir
     por prompt sem linha correspondente). Recomendação futura (não obriga para
     o smoke): a próxima IA pode **introduzir um prefixo** `tmp/` para uploads
     staged contornável pelo frontend (cenário não-desenhado), e então lifecycle
     regra auto-expira `tmp/` em 1 dia. **Decisão deferida** — fica como
     ferramenta disponível no R2, não bloqueia o smoke.

f. **Smoke opcional pós-provisionamento** (sem código):
   - Com qualquer cliente S3 (`aws` CLI com `--endpoint-url`, `rclone`, MinIO
     client), PUT um objeto de teste no bucket preview → confirmar leitura com
     GET → confirmar que a Vercel Preview consegue ler/escrever via `@aws-sdk/client-s3`
     (pode-se adicionar uma rota de diagnóstico /api/contador/storage/health
     no próximo GOAL — fora de escopo deste).
   - Essa validação é opcional: o próximo GOAL inclui o smoke funcional dos 13
     passos do 012A contra o R2 (§8).

---

## 7. Próximo GOAL de implementação

**Sugerido: `CONTADOR-HUB-STORAGE-R2-ADAPTER-013`** (nome negociável).

### 7.1 Pré-requisitos
O adapter Supabase e todo o code do Contador HUB **só existem no branch
`goal/contador-012a-fechamento-closure`** (ainda não mesclado). Logo, o GOAL 013
deve escolher uma das duas vias:
- **(A) Empilhar** — branch do 013 sai de `goal/contador-012a-fechamento-closure`.
  Rápido, sem esperar validação. Requer revisão dupla (012A + 013) no momento
  do merge ao `main`.
- **(B) Pós-merge** — esperar o 012A ser aprovado/mesclado ao `main` e então
  give birth ao 013 over `main`. Mais limpo; o R2 entra como commit único no
  fluxo principal.

Recomendação: via **A** (empilhar) é a mais célere para destravar o smoke;
via **B** é mais hygiene. A escolha é decisória humana.

### 7.2 Escopo do próximo GOAL
1. `npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner` (server-only).
2. Implementar `lib/contador/documentos/storage-r2.ts` cumprindo
   `StorageDocumentosPort`:
   - `verificarBucket` → `HeadBucketCommand`.
   - `criarUploadAssinado` → `getSignedUrl(PutObjectCommand, { expiresIn: UPLOAD_EXPIRACAO_SEG })`.
     - Devolver `token: ""` (string vazia) — frontend já descarta o campo.
     - Atualizar JSDoc do `UploadAssinado.token` para descrever "compat
       field; vazio em providers S3-compatible" — **não quebrar o contrato**.
   - `enviarConteudoPrivado` → `PutObjectCommand` (`Bucket`, `Key=storageRef`,
     `Body=Buffer`, `ContentType=mime`). PutObject **sempre sobrescreve** —
     equivalente ao `upsert: true` do desenho 012 §4 (idempotente por path
     content-addressed).
   - `obterMetadata` → `HeadObjectCommand` — **melhoria** vs Supabase (hoje
     `list+find`, frágil). Retorna `ContentLength` + `ContentType`.
   - `abrirConteudoPrivado` → `GetObjectCommand` → `transformToByteArray` → `Buffer.from`.
   - `criarDownloadAssinado` → `getSignedUrl(GetObjectCommand, { expiresIn,
     ResponseContentDisposition: "attachment; filename=\"" + nomeArquivo + "\"" })`.
     Cap 300s mantido (Math.min já no adapter hoje).
   - `removerObjeto` → `DeleteObjectCommand`.
   - `verificarExistencia` → `HeadObjectCommand` retornando existência.
3. Implementar companion `lib/contador/documentos/storage-r2-config.ts` (ou
   estender `config.ts` com branches provider-specific — avaliar trade-off):
   - `ENV_KEYS_R2 = { accountId: "R2_ACCOUNT_ID", accessKeyId: "R2_ACCESS_KEY_ID",
     secretAccessKey: "R2_SECRET_ACCESS_KEY", bucketDocumentos: "R2_BUCKET_DOCUMENTOS",
     bucketPacotes: "R2_BUCKET_PACOTES", endpoint: "R2_ENDPOINT" }`.
   - Hard guard `NEXT_PUBLIC_*` (mesmo padrão — reject se casar com R2 secret).
   - `storageR2ConfigDisponivel()` + `lerStorageR2Config()`.
4. Trocar 4 imports (de `storage-supabase` para `storage-r2`):
   - `app/api/contador/documentos/upload-intent/route.ts:15`
   - `app/api/contador/documentos/complete/route.ts:15`
   - `app/api/contador/documentos/[id]/download/route.ts:15`
   - `lib/contador/fechamento/portas.ts:12`
5. `lib/contador/fechamento/portas.ts`: `storagePacotePortProducao.enviarPacote`
   passa a delegar a `storageR2.enviarConteudoPrivado(storageRef, bytes, MIME_PACOTE)`.
6. Marcar `storage-supabase.ts` como `@deprecated` via JSDoc (referenciar este
   doc como rationale de rollback).
7. Testes:
   - Os testes existentes usam **fakes inyetáveis** (`storageFake` em
     `documentos-service.test.ts`, `fechamento-service.test.ts`,
     `fechamento-closure-012a.test.ts`, etc.) — **continuam passando sem
     modificação** (provider-agnostic).
   - Adicional opcional: um teste de smoke do adapter R2 contra
     LocalStack ou MinIO (não obrigatório se o smoke manual §8 passar). Avaliar.
8. Documentação: adicionar `ADR-0013-cloudflare-r2-contador-storage.md` sob
   `docs/decisions/` formalizando a decisão persistida neste GOAL 012B (boa
   prática do projeto; não bloquear a implementação).
9. Smoke manual Vercel Preview: rodar os 13 passos do 012A contra o R2
   provisionado (ver §8).
10. Ao smoke passar: atualizar este doc (marcação "approved in production") e
    `docs/ai/CURRENT_STATUS.md` (status real do módulo Contador HUB).

### 7.3 Fora do escopo do próximo GOAL (013)
- Congelamento, snapshot v2, lock `FOR UPDATE`, atomicidade da tx (fechados no 012A).
- `/api/contador/*` fora dos 3 imports listados.
- `prisma/schema.prisma` e quais migrations — intocados.
- Qualquer outro módulo (PDV, Financeiro, Operações, WhatsApp, Fiscal, auth, proxy).
- Job de limpeza de órfãos (deferido ao GOAL 019 ou lifecycle do R2 — ver §6e).
- Remoção do `storage-supabase.ts` (manter por rollback).

---

## 8. Roteiro para destravar o smoke do 012A

Após aprovação humana desta decisão, a sequência esperada é:

1. **(Humano)** Provisionar R2 (conta, buckets, token bucket-scoped, vars na
   Vercel) — ver §6.
2. **(Próximo GOAL 013)** Implementar adapter R2 + trocar 4 imports — ver §7.
3. **Markers de pronto do 013**:
   - `npx tsc --noEmit` ✅ 0 erros.
   - `npx vitest run lib/contador` ✅ todos existentes passam.
   - `npm run build` ✅ compilação limpa.
4. **Deploy automático** ao pushar a branch → Vercel Preview.
5. Abrir o Contador HUB em Preview (rota real do HUB).
6. Executar os **13 passos do smoke 012A**, listados em
   `docs/contador/CONTADOR_HUB_FECHAMENTO_SNAPSHOT_012.md §12.1`:

   | # | Passo | Antes (sem storage) | Depois (com R2) |
   |---|---|---|---|
   | 1–2 | Listar / abrir competência | ✅ ( já rodavam ) | ✅ |
   | 3 | Fechar e gerar pacote v1 | **❌ `STORAGE_CONFIG_INDISPONIVEL` 503** | ✅ PutObject idempotente → `ContadorPacote` commitado |
   | 4 | Listar versões persistidas | ❌ ( nível 0 ) | ✅ |
   | 5 | Download do pacote (signed attachment) | ❌ | ✅ `getSignedUrl` ≤300s |
   | 6 | Comparar manifestos | ✅ ( read-only ) | ✅ |
   | 7 | Upload documento (PUT cru browser) | ❌ | ✅ presigned PUT navegador → R2 |
   | 8 | Complete (HEAD/GET round-trip, magic bytes, hash) | ❌ | ✅ `HeadObject` + `GetObject` server-side |
   | 9 | Listar documento | ✅ | ✅ |
   | 10 | Download documento (signed attachment) | ❌ | ✅ `getSignedUrl` ≤300s |
   | 11 | Soft delete documento | ✅ | ✅ (blob mantido, retenção) |
   | 12 | Reabrir competência → gerar pacote v2 | bloqueado por §3 | ✅ snapshot v2 reconstruível, `manifestoHash` novo |
   | 13 | Comparar versões 1×2 | ✅ ( read-only ) | ✅ |

7. **Se os 13 passos passarem**: o GOAL 012A **atinge Classe A** (sem ressalva
   residual), e o GOAL 012B é considerado concretizado em produção (decisión
   validada artefatualmente).

8. **Se algum passo falhar**:
   - Causa credencial/permissão (403/404 R2, token scope errado, endpoint errado)
     → ajustar no painel Cloudflare/Vercel (humano, sem código).
   - Causa implementação do adapter → abrir bug no GOAL 013 (não reabrir 012A
     nem 012B). Não reverter para Supabase (camino rejeitado por present decisión).

---

## 9. Escopo respeitado nesta rodada (checkpoint final)

| Confirmação | Estado |
|---|---|
| `git diff --check` (whitespace) | ✅ (verificado pós-stage, ver relatório de commit) |
| Somente o documento **`docs/contador/CONTADOR_HUB_STORAGE_PROVIDER_DECISION_012B.md`** foi criado | ✅ |
| Zero código alterado | ✅ (nenhum `.ts`/`.tsx` tocado; `package.json` intocado) |
| Zero acesso ao Neon | ✅ |
| Zero alteração em Supabase / Cloudflare / Vercel | ✅ |
| Nenhum valor de secret lido ou impresso | ✅ (somente nomes das vars) |
| Commits do GOAL 012A **não** publicados | ✅ (branch `goal/contador-012a-fechamento-closure` intacta) |
| Push exclusivo para `docs/contador-012b-storage-provider-decision` | ✅ |
| Push para `main` | ✅ não realizado |
| PR aberta/mesclada | ✅ nenhuma |
| Acessos a trabalhos paralelos | ✅ worktree primária (`C:\Projetos\omni-gestao`) intacta; branch `publish/pdv-acessorios-modelo-cor-audit` inalterada |

---

## 10. O que este GOAL NÃO decidiu (fora de escopo)

- Não implementou linha de código R2.
- Não cadastrou, não criou, não provisionou nada em nenhum serviço externo.
- Não escolheu nomes finais de buckets (sugestão `...-preview`/`...-prod` —
  humano decide ao provisionar).
- Não definiu se haverá buckets separados para documentos × pacotes (decisão de
  operação do próximo GOAL; o desenho suporta ambos).
- Não definiu a via do próximo GOAL (empilhar vs pós-merge) — decisão humana.
- Não alterou `CORE_RULES.md`, `DELIVERY_CHECKLIST.md`,
  `docs/ai/CURRENT_STATUS.md`, `docs/decisions/INDEX.md`.
- Não criou ADR formal — esta é uma decisión procedimental cuja ADR cabe ao
  próximo GOAL formalizar (`ADR-0013-cloudflare-r2-contador-storage.md`).

---

## 11. Referências

- `docs/contador/CONTADOR_HUB_FECHAMENTO_SNAPSHOT_012.md` — §4 fluxo storage ×
  transação; §12.1 verificação de env Supabase Storage não provisionado; §11.2
  desvios da allowlist do 012A (que criou `enviarConteudoPrivado` no port).
- `lib/contador/documentos/storage-types.ts` — contrato `StorageDocumentosPort`
  e `UploadAssinado` (campo `token`).
- `lib/contador/documentos/storage-supabase.ts` — adapter legado (mantido
  para rollback como `@deprecated` no próximo GOAL).
- `lib/contador/documentos/config.ts` — `ENV_KEYS`, limites (25MB / 300s /
  120s), `StorageConfigError` seguro, hard guard `NEXT_PUBLIC_*`.
- `lib/contador/documentos/service.ts` — regra pura de upload intent /
  complete / download / soft-delete / congelamento.
- `lib/contador/fechamento/portas.ts` — wiring de produção (`StoragePacotePort`
  → adapter concreto).
- `lib/contador/fechamento/service.ts` — atomicidade tx × upload; path do ZIP.
- `components/dashboard/contador/documentos/contador-documentos-real.tsx`
  (em ~438) — frontend PUT cru, descarta `token`, swap 100% backend.
- Cloudflare R2 (docs públicas — sem dados locais): S3 API compatibility,
  presigned URLs, IAM tokens bucket-scoped, Object Lifecycle Rules, pricing
  (egress gratuito), supabase-vs-r2 comparison.
- AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) — tipos
  de comandos citados em §7.2.

---

## 12. Classificação final do GOAL

**DOCUMENTAL — decisão emitida, sem código.**

Recomendação única e oficial: **Cloudflare R2** (S3-compatible).
Próximo GOAL (implementação): `CONTADOR-HUB-STORAGE-R2-ADAPTER-013`.
Próximo ponto de parada: **aprovação humana desta decisão** antes de qualquer
linha de implementação.