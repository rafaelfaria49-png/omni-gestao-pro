# CONTADOR HUB — GOAL 011 · STATUS, COMENTÁRIOS E TIMELINE REAIS

| Campo | Valor |
|---|---|
| GOAL | `CONTADOR-HUB-STATUS-COMENTARIOS-011` |
| Data | 2026-07-28 |
| Base | `origin/main = a6491b6` |
| Branch | `goal/contador-011-status-comentarios` |
| Worktree | `C:\Projetos\omni-gestao-contador-011` |
| Schema | **não alterado** (usa a migration 0014 do GOAL 009) |
| Banco acessado | `omnigestao_prod_candidate` (validação manual) — `omnigestao_prod` **não acessado** |
| Depende de | GOAL 009 (núcleo persistente) · GOAL 010 (documentos reais) |

---

## 1. O que passou a ser real

| Área | Antes (GOAL 010) | Agora |
|---|---|---|
| Status do documento | `ENVIADO` fixo na criação; sem transição | Máquina persistida com 5 transições, permissão por papel e evento por transição |
| Rejeição | inexistente | `enviado`/`conferido` → `pendente` com motivo **obrigatório** materializado em comentário interno |
| `vencido` | inexistente | Flag **derivada** no servidor, exposta no DTO; nunca persistida |
| Comentários | "Conversa com o contador" mockada | `ContadorComentario` real, `interna` × `compartilhada`, por competência e por documento |
| Timeline | array estático `TIMELINE_ITEMS` | Projeção read-only de `ContadorEvento` + `ContadorComentario` |

## 2. Matriz final de transições

Fonte única: `lib/contador/status/matriz.ts`. Ausência da matriz = recusa (fail-closed).

| # | De | Para | Ação | Motivo obrigatório | Papel elevado |
|---|---|---|---|---|---|
| 1 | `PENDENTE` | `ENVIADO` | `enviar` | não | não |
| 2 | `ENVIADO` | `CONFERIDO` | `conferir` | não | **sim** |
| 3 | `CONFERIDO` | `RESOLVIDO` | `resolver` | não | **sim** |
| 4 | `ENVIADO` | `PENDENTE` | `rejeitar` | **sim** | não |
| 5 | `CONFERIDO` | `PENDENTE` | `rejeitar` | **sim** | não |

As **11 combinações restantes** das 16 possíveis (4×4) falham com `TransicaoInvalidaError` (409) — incluindo transição de um estado para ele mesmo e qualquer saída de `RESOLVIDO` (estado terminal).

`vencido` **não é estado**: não existe em `ContadorItemStatus`, não é gravado e não aparece na matriz.

## 3. Papéis e permissões

Pendência que a **ADR-CONTADOR-005 deixou explicitamente para este GOAL** ("quem pode marcar `conferido` internamente") — decidida assim:

| Capacidade | Regra | Traduzido em `lib/contador/status/permissoes.ts` |
|---|---|---|
| Acessar o HUB | permissão dedicada do GOAL 010 | `hubs.contador` |
| Conferir / resolver | **papel financeiro ou administrador** | `admin.masterConsole \|\| financeiro.edit` |
| Enviar / rejeitar | qualquer papel com acesso ao HUB | — |

Na matriz enterprise atual isso significa: **admin** e **gerente** conferem; **caixa**, **técnico** e **vendedor** não chegam nem ao HUB (`sem_permissao`, 403). Nenhuma permissão nova foi criada e `lib/auth/enterprise-permissions.ts` **não foi tocado**.

Duas barreiras independentes, ambas server-side:

1. `requireContadorScope()` (GOAL 006/010) — sessão NextAuth + cookie de loja ativa + `canAccessStore` + `hubs.contador`;
2. `resolverCapacidadesContador(await auth())` — capacidade da transição.

Papel, loja e usuário **nunca** vêm do cliente: as rotas recusam `storeId`, `lojaId`, `papel`, `role`, `userId` e `atorId` no corpo ou na query com **400**, antes de qualquer leitura.

## 4. Atomicidade adotada

Uma transição é **uma** transação (`repo-prisma.ts → $transaction`):

```
updateMany({ where: { id, storeId, status: <estado esperado>, excluidoEm: null } })
  → count !== 1  ⇒ TransicaoConcorrenteError  (aborta ANTES de qualquer evento)
  → count === 1  ⇒ [comentário do motivo, se rejeição] + ContadorEvento
```

- O `status` no `where` é **trava otimista**: se outra sessão mudou o documento entre a leitura e a escrita, nada é gravado — sem evento órfão.
- Falha ao criar o evento (ou o comentário do motivo) **desfaz** a mudança de status.
- Toda recusa (matriz, motivo, permissão, competência fechada, documento inexistente) acontece **antes** da primeira escrita — `transacoes = 0` nos testes.
- Comentário avulso + evento `comentario_criado` também nascem numa única transação.

Os testes exercitam o **repositório real** contra um cliente in-memory que implementa `$transaction` com rollback de verdade — a atomicidade verificada é a do código que vai para produção, não a de um mock do serviço.

## 5. Contrato de comentários

`POST /api/contador/comentarios` — `{ competencia: "AAAA-MM", documentoId?, texto, visibilidade }`

- `competenciaId` resolvido no servidor a partir de `AAAA-MM` + loja ativa (reusa `getOrCreateCompetencia` do GOAL 009);
- `documentoId` opcional; quando informado precisa ser da **mesma loja e mesma competência** (senão 404 — não confirma existência alheia);
- `texto` obrigatório, 1–4000 caracteres (vazio/espaço → 422);
- `visibilidade` ∈ `interna | compartilhada`;
- autor (`autorTipo="interno"`, `autorId`) vem do escopo;
- evento `comentario_criado` com metadata **saneada**: `{ visibilidade, textoLen, competencia, documentoId? }` — o texto **nunca** entra na metadata (ajuste G2-05).

`GET /api/contador/comentarios?c=AAAA-MM[&documentoId=][&contexto=interno|compartilhado]`

- `contexto=compartilhado` filtra `visibilidade="compartilhada"` **na consulta** e novamente na projeção (defesa em profundidade);
- visibilidade desconhecida é tratada como `interna` (fail-closed);
- append-only: **não existe** PUT, PATCH nem DELETE de comentário neste GOAL.

## 6. Contrato da timeline

`GET /api/contador/timeline?c=AAAA-MM[&contexto=][&limite=]` — somente leitura, não cria competência.

- Combina `ContadorEvento` (incluindo os já auditados pelo GOAL 010: `documento_enviado`, `documento_substituido`, `documento_download_autorizado`, `documento_excluido`) com `ContadorComentario`.
- **Ordem determinística:** `em` DESC, desempate estável pelo id composto (`evento:<id>` / `comentario:<id>`) — a mesma entrada em qualquer ordem produz a mesma saída.
- **DTO seguro:** `metadata` passa por **allowlist** de chaves + filtro de chave suspeita (`url|token|secret|senha|signed|path|ref|stack|cookie|storage`) + só primitivos. `ip` e `userAgent` do evento **não são nem selecionados** na consulta.
- Nunca sai: `storageRef`, URL assinada ou permanente, token, secret, hash, stack, dado de outra loja.
- Competência inexistente → lista vazia com `competenciaId: null`, **não** erro.

Isolamento: `ContadorEvento` filtra por `competenciaId` **e** `storeId`; `ContadorComentario` (que não tem `storeId` próprio) filtra por `competenciaId` **e** `competencia: { storeId }`.

## 7. Arquivos

**Novos — domínio**
- `lib/contador/status/matriz.ts` · `vencido.ts` · `permissoes.ts` · `service.ts` · `repo-prisma.ts` · `http.ts`
- `lib/contador/comentarios/service.ts` · `repo-prisma.ts`
- `lib/contador/timeline/projecao.ts` · `service.ts` · `repo-prisma.ts`

**Novos — rotas**
- `app/api/contador/status/route.ts` (GET capacidades+matriz · POST transição)
- `app/api/contador/comentarios/route.ts` (GET · POST)
- `app/api/contador/timeline/route.ts` (GET)

**Novos — UI**
- `components/dashboard/contador/contador-ui.tsx` (primitivas compartilhadas)
- `components/dashboard/contador/timeline/contador-timeline-real.tsx`
- `components/dashboard/contador/timeline/contador-comentarios.tsx`

**Novos — testes**
- `lib/contador/__tests__/status-matriz.test.ts` · `status-service.test.ts` · `comentarios-service.test.ts` · `timeline-projecao.test.ts`

**Alterados**
- `lib/contador/documentos/service.ts` — `toDto` passa a expor `vencido` derivado (integração mínima; nenhuma refatoração)
- `components/dashboard/contador/documentos/contador-documentos-real.tsx` — controles de status, modal de rejeição, chip `vencido`, comentários por documento; primitivas locais movidas para `contador-ui.tsx`
- `components/dashboard/contador/contador-hub-preview.tsx` — Timeline agora renderiza o componente real
- `components/dashboard/contador/contador-preview-data.ts` — `TIMELINE_ITEMS` removido
- `components/dashboard/contador/contador-hub-honesty.test.ts` — garantias de honestidade do GOAL 011
- `docs/status/MOCKS_TRACKING.md` — MOCK-09 atualizado

## 8. Decisão registrada: o motivo da rejeição

O GOAL pede que o evento registre "motivo, quando aplicável". O motivo é **texto livre digitado por humano** — vetor clássico de PII, e o ajuste **G2-05** (ADR-006) determina que `ContadorEvento.metadata` seja saneada.

Adotado: o motivo é gravado como **`ContadorComentario` interno** (campo `texto @db.Text`, append-only, mesma trilha), e o evento carrega apenas `motivoComentarioId` + `motivoLen`. Isso:

- cumpre a ADR-005 ao pé da letra ("rejeição volta a pendente **com comentário obrigatório**");
- mantém a metadata do evento livre de texto livre, seguindo o precedente do GOAL 010 (`documento_excluido` grava `motivoLen`, não o motivo);
- torna o motivo visível na timeline como comentário, sem duplicar o conteúdo em dois lugares.

## 9. Testes

| Exigência do GOAL | Onde | Resultado |
|---|---|---|
| 1. Matriz exaustiva (todas as combinações) | `status-matriz.test.ts` — 16 pares | ✅ 5 passam, 11 falham com erro tipado |
| 2. Rejeição sem comentário | `status-service.test.ts` | ✅ recusa; status intacto; 0 eventos; 0 transações |
| 3. Permissões (403, sem escrita parcial) | `status-service.test.ts` · `status-matriz.test.ts` | ✅ |
| 4. Isolamento (loja A × loja B) | `status-service.test.ts` · `comentarios-service.test.ts` · `timeline-projecao.test.ts` | ✅ 404 sem confirmar existência alheia |
| 5. Atomicidade (rollback nos dois sentidos) | `status-service.test.ts` (repo real + tx com rollback) | ✅ |
| 6. `vencido` antes / no dia / depois; resolvido nunca | `status-matriz.test.ts` | ✅ |
| 7. Comentários (interno não vaza, vazio recusado) | `comentarios-service.test.ts` | ✅ |
| 8. Timeline (ordem determinística, DTO sem dado privado) | `timeline-projecao.test.ts` | ✅ |

Execução:

- **Suíte do Contador:** `npx vitest run lib/contador components/dashboard/contador` → **24 arquivos, 478 testes, 100% verdes** (+51 do arquivo de honestidade).
- **Suíte completa:** 3.368 testes verdes. Falha intermitente **pré-existente e alheia ao GOAL** em `lib/whatsapp-legacy-quarantine.test.ts` (varredura síncrona de `app/`+`components/`+`lib/` estoura o timeout de 5 s sob carga paralela; passa em 507 ms isolada com `--testTimeout`; o arquivo não foi tocado e nenhum arquivo do GOAL contém `openCaixaIfClosed`).
- `npx tsc --noEmit` → **limpo**.
- `npx eslint` nos caminhos alterados → **limpo**.
- `npm run build` → **sucesso**; as três rotas novas registradas como `ƒ` (dinâmicas).
- `git diff --check` → **limpo**.

## 10. Validação manual

Executada contra **`omnigestao_prod_candidate`** (nunca produção) com os **serviços e repositórios Prisma reais**, sem mock, em competência de teste **2099-12** e documentos com título prefixado `[TESTE GOAL-011]`.

Roteiro do GOAL, todos os 9 passos: anexar → enviar → conferir → rejeitar outro com motivo → reenviar → resolver → comentário interno → comentário compartilhado → timeline completa. **30 verificações OK, 0 falhas**, mais 6 verificações de `vencido` (antes / no dia / depois / muito depois / resolvido / nenhum status `VENCIDO` persistido) — todas OK.

Recusas confirmadas no banco real: rejeição sem motivo (`MOTIVO_OBRIGATORIO`, status intacto), transição fora da matriz (`TRANSICAO_INVALIDA`), papel básico conferindo (`PERMISSAO_TRANSICAO`), loja B alterando documento da loja A (`DOCUMENTO_NAO_ENCONTRADO`), comentário vazio (`COMENTARIO_INVALIDO`).

> Uma checagem do primeiro roteiro acusou "documento deveria estar vencido" — era **erro do roteiro**, não do código: o vencimento fixado (2099-12-01) estava no futuro. Refeito com datas relativas a hoje, o comportamento é o correto.

**Escrito no candidate** (dados de teste, deixados no lugar de propósito — eventos e comentários são append-only por contrato deste GOAL):

| Tabela | Linhas | Identificação |
|---|---|---|
| `contador_competencias` | 2 | ano 2099, mês 12 (`loja-1`, `loja-2`) |
| `contador_documentos` | 7 | título começa com `[TESTE GOAL-011]`; ids `doc-teste011-*` |
| `contador_comentarios` | 3 | vinculados às competências 2099-12 |
| `contador_eventos` | 17 | 13 `status_alterado`, 2 `comentario_criado`, 2 `competencia_criada` |

Nenhuma linha de competência real foi tocada — antes do teste o domínio Contador estava **vazio** no candidate (0/0/0/0).

## 11. Fronteiras respeitadas

- `prisma/schema.prisma` e `prisma/migrations/**` — **não tocados**; nenhum `db push`, `migrate dev` ou `migrate deploy` executado.
- `omnigestao_prod` — **não acessado** (o script recusa qualquer banco que não seja o candidate).
- Portal legado `/contador`, `login-contador`, identidade externa, Fiscal, PDV, Caixa, Financeiro, Operações, Estoque, Supabase, Vercel — **intocados**.
- `lib/auth/enterprise-permissions.ts` e `lib/contador/scope.ts` — **não alterados**; o GOAL reusa `avaliarAcessoContador` em vez de duplicá-lo.
- Fora do commit: `lib/fiscal/tax-engine/__snapshots__/calculator.test.ts.snap` aparece como modificado no working tree — é apenas reescrita de fim de linha (LF→CRLF) pelo Vitest, **diff de conteúdo vazio**. Arquivo alheio ao GOAL, deliberadamente **não commitado**.

## 12. Áreas realificadas × ainda em preview

**Realificadas (sem badge de preview):** Documentos (GOAL 010) + status/comentários por documento · **Timeline / atividade** · Visão Geral e Relatórios básicos (GOAL 006) · Fechamento — checklist derivado read-only (GOAL 007) · Pacote do Contador (GOAL 008).

**Ainda em preview, honestamente rotuladas:** Obrigações & vencimentos · Dossiês / Radar CNPJ · Folha & DP · Portal do contador · Permissões · Configurações · cartões ilustrativos da Visão Geral (`ProgressRing`, "3 de 9").

## 13. Pendências

1. **Portal externo (GOAL 014/015).** Comentários `compartilhada` estão prontos e isolados, mas **não há consumidor externo** — a UI diz isso explicitamente em vez de prometer.
2. **Ator externo.** `atorTipo`/`autorTipo` aceitam `"externo"` no schema, mas todo caminho deste GOAL grava `"interno"` — só o portal criará atores externos.
3. **Obrigações e guias (GOAL 016).** A máquina de status vale hoje só para `ContadorDocumento`; `ALVO_DOCUMENTO` está isolado para receber novos alvos sem mexer na matriz.
4. **Fechamento (GOAL 012).** Competência `FECHADA` já bloqueia transição com 409; congelar documentos, snapshot e reabertura versionada continuam no GOAL 012.
5. **Paginação da timeline.** Limite de 200 (máx. 500) por competência, sem cursor. Suficiente para o volume mensal esperado; revisar se alguma loja passar disso.
6. **ADR-005.** A pendência "quem marca `conferido`" está resolvida aqui (§3). A outra — critério de "enviar" a competência inteira — continua aberta e pertence ao GOAL 012.

## 14. Classificação final

**Classe A — pronto para revisão humana e fast-forward.** Escopo fechado, sem alteração de schema, sem acesso a produção, verificações completas (TS, ESLint, build, 478 testes do Contador, validação manual em banco não produtivo) e trilha append-only preservada.
