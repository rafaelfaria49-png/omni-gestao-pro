# CONTADOR HUB — GOAL 012 · FECHAMENTO, SNAPSHOT E PACOTE VERSIONADO

| Campo | Valor |
|---|---|
| GOAL | `CONTADOR-HUB-FECHAMENTO-SNAPSHOT-012` |
| Data | 2026-07-28 |
| Base | `origin/main = e8946c2` |
| Branch | `goal/contador-012-fechamento-snapshot` |
| Worktree | `C:\Projetos\omni-gestao-contador-012` |
| Schema | **não alterado** (usa a migration 0014 do GOAL 009) |
| Banco acessado | **nenhum** — validação por testes in-memory e storage fake |
| Depende de | GOAL 008 (builder do pacote) · GOAL 009 (núcleo) · GOAL 010 (storage) · GOAL 011 (status/comentários) |

---

## 1. O que passou a ser real

| Área | Antes (GOAL 011) | Agora |
|---|---|---|
| Fechar competência | CTA desabilitado apontando "GOAL 012" | Fechamento transacional com snapshot + pacote versionado |
| Snapshot | inexistente | JSON canônico imutável + `snapshotHash` SHA-256 |
| Pacote | gerado sob demanda e descartado | `ContadorPacote` + `ContadorPacoteItem` persistidos, versão imutável em storage privado |
| Congelamento | só transição de status recusava | upload, substituição, exclusão, status **e comentário** recusam com 409 |
| Reabertura | inexistente | transição auditada com motivo obrigatório e incremento de versão |
| Alteração pós-fechamento | inexistente | diff determinístico + `diffHash` + evento idempotente |
| Comparar versões | inexistente | diff de manifestos por `sha256`, sem baixar ZIP |

## 2. Formato do snapshot

`lib/contador/fechamento/snapshot.ts` — schema `omni.contador.fechamento.snapshot/v1`.

```
schemaVersion · competencia{storeId,ano,mes,codigo} · versao · fechadaEm
responsavel{tipo,id}        ← pseudônimo (sha256 do userId, 16 hex)
totais{...}                 ← 21 métricas agregadas {valor, disponibilidade}
checklist{contagem, itens[{id,estado}]}   ← ordenado por id
pendenciasAssumidas[]       ← ordenado e deduplicado
documentos{total, porCategoria{}, porStatus{}}
pacote{versao, manifestoHash, bytes, arquivos}
```

**Nunca entra:** linha operacional (venda/item/título/movimento), PII, `storageRef`, URL
assinada, token, secret, nem coleção cuja ordem dependa do banco.

`snapshotHash` = SHA-256 do JSON **canônico** (`lib/contador/fechamento/canonico.ts`):
chaves ordenadas lexicograficamente, `undefined` omitido em objeto e `null` em array,
`Date` → ISO, `-0` → `0`, decimais normalizados em 2 casas e **recusa tipada** para
`NaN`/`Infinity`/`Date` inválida — um dado corrompido não vira hash "válido".

## 3. Regra de versão

- Competência nasce em `versao = 1`; o **primeiro fechamento grava o pacote v1**.
- **Reabertura incrementa** a versão (v1 → v2) e preserva pacote, snapshot e eventos.
- O fechamento seguinte grava **v2**, depois **v3**, etc.
- `@@unique([competenciaId, versao])` no schema garante uma única linha por versão.
- Versões antigas continuam baixáveis e **nunca** são apagadas ou sobrescritas.

## 4. Fluxo storage × transação

Storage externo **não participa** da transação PostgreSQL. Ordem adotada:

1. gerar ZIP + manifesto + hashes **em memória** (builder do GOAL 008);
2. subir para path **determinístico e endereçado por conteúdo**:
   `contador/{storeId}/{AAAA-MM}/pacotes/v{N}/{manifestoHash}.zip`;
3. executar a transação (competência + pacote + itens + evento);
4. o pacote só é exposto por `ContadorPacote` **commitado**.

Consequências desenhadas de propósito:

- **Falha após o upload** deixa um blob órfão, mas **inalcançável**: a aplicação só
  resolve `storageRef` a partir de linha commitada. Nunca existe competência FECHADA
  apontando para pacote inexistente, porque o upload é confirmado **antes** da transação.
- **Retry é idempotente**: o mesmo conteúdo produz o mesmo `manifestoHash`, logo o mesmo
  path — reescrever é reescrever bytes idênticos (`upsert` habilitado só aqui).
- **Limpeza de órfãos** fica registrada como pendência operacional: um job varreria
  `contador/**/pacotes/**` sem linha correspondente. **Não implementado neste GOAL**
  (job está fora do escopo declarado).

## 5. Congelamento

Com a competência `FECHADA`, recusam com **409 `COMPETENCIA_FECHADA`**:

| Operação | Onde |
|---|---|
| upload de documento | `documentos/service.ts` (já existia) |
| substituição | `documentos/service.ts` (já existia) |
| **exclusão lógica** | `documentos/service.ts` — **novo** |
| alteração de status | `status/service.ts` (já existia) |
| **criação de comentário** | `comentarios/service.ts` — **novo** |

**Leitura e download continuam permitidos** conforme a ACL: congelar é impedir escrita,
não esconder informação.

> A regra do comentário **substitui** a hipótese do GOAL 011 (que permitia comentar em
> competência fechada). A revisão do 011 apontou a inconsistência; ela é fechada aqui.

## 6. Contrato de reabertura

Exige papel elevado + competência `FECHADA` + **motivo não vazio** + confirmação textual
(digitar `AAAA-MM`) + trava otimista por `(status, versao)`.

Numa única transação: status → `ABERTA`, `versao + 1`, `reabertaEm`/`reabertaPorId`/
`reabertaMotivo`, **comentário interno imutável** com o motivo e `ContadorEvento
competencia_reaberta` com `{ versaoAnterior, versao, motivoComentarioId, motivoLen }` —
**nunca o texto livre na metadata** (G2-05, precedente do GOAL 011).

## 7. Detecção de alteração pós-fechamento

`compararTotais(snapshot.totais, totaisVivos)` sobre o **mesmo** subconjunto de métricas
que o snapshot gravou (`extrairTotais` é fonte única dos dois lados). Produz itens
ordenados por chave, `natureza` (`valor`/`disponibilidade`/`ambos`), `delta` e um
`diffHash` estável. Tolerância de meio centavo evita que ruído de ponto flutuante vire
"alteração operacional".

- **`GET` não grava** — a UI mostra o alerta a cada render sem efeito colateral.
- **`POST` explícito** persiste `alteracao_pos_fechamento`, com dedupe por
  `(competenciaId, versao, diffHash)`: repetir o POST **não** cria segundo evento.
- Aviso único: *"Dados operacionais mudaram após o fechamento. Considere reabrir a competência."*

## 8. APIs

| Rota | Verbo | Função |
|---|---|---|
| `/api/contador/fechamento` | GET | estado + versões do pacote |
| `/api/contador/fechamento` | POST | fecha (confirmação + pendências) |
| `/api/contador/fechamento/reabrir` | POST | reabre (confirmação + motivo) |
| `/api/contador/fechamento/divergencia` | GET | avalia (read-only) |
| `/api/contador/fechamento/divergencia` | POST | persiste evento (idempotente) |
| `/api/contador/pacote/versoes` | GET | lista versões persistidas |
| `/api/contador/pacote/download` | POST | autoriza download + audita |
| `/api/contador/pacote/comparar` | GET | diff de manifestos |

Todas: `requireContadorScope()` + `auth()`; recusam com **400** as chaves
`storeId`/`lojaId`/`papel`/`role`/`userId`/`atorId`/`autorId`/`competenciaId` vindas do
cliente. A lista é **única** (`fechamento/rotas.ts`) — corrige a divergência entre rotas
apontada na revisão do GOAL 011.

## 9. Interface

**Fechamento** deixou de ser preview: botão real (habilitado só com `podeFechar` vindo do
servidor), modal com pendências marcáveis uma a uma + confirmação textual, selo
`Competência fechada — oficial vN`, botão Reabrir com motivo obrigatório, alerta de
divergência com ação explícita de registro, e histórico de versões com download e
comparação. Estados de carregando/erro/vazio honestos.

**Ainda em preview:** Obrigações · Dossiês/Radar CNPJ · Folha & DP · Portal do contador ·
Permissões · Configurações · cartões ilustrativos da Visão Geral.

## 10. Testes

| Categoria | Onde | Resultado |
|---|---|---|
| 1. Fechamento (snapshot, hash, pacote v1, itens = manifesto, evento, 403 sem escrita) | `fechamento-service.test.ts` | ✅ |
| 2. Atomicidade (falha de pacote/upload/evento; corrida; versão única) | `fechamento-service.test.ts` | ✅ |
| 3. Congelamento (5 mutações bloqueadas; leitura/download livres) | `fechamento-congelamento.test.ts` | ✅ 11 testes |
| 4. Reabertura (sem motivo, motivo imutável, versão, preservação, concorrência) | `fechamento-service.test.ts` | ✅ |
| 5. Refechamento (v2, novo snapshot, v1 intacta, diff) | `fechamento-service.test.ts` | ✅ |
| 6. Divergência (iguais, diffHash, GET não grava, POST idempotente) | `fechamento-service.test.ts` · `fechamento-snapshot.test.ts` | ✅ |
| 7. Segurança (cross-store, forjar escopo, DTO sem storageRef, download audita) | `fechamento-service.test.ts` | ✅ |
| 8. Snapshot (PII, ordenação, normalização, hash sensível/insensível) | `fechamento-snapshot.test.ts` | ✅ |

Os testes exercitam o **repositório Prisma real** contra um cliente in-memory cujo
`$transaction` faz rollback de verdade **e serializa transações** — modelando o row lock
que o Postgres aplicaria; sem isso, o rollback da transação perdedora apagaria escrita já
commitada pela vencedora, cenário que o banco jamais produz.

## 11. Fronteiras respeitadas

- `prisma/schema.prisma` e `prisma/migrations/**` — **não tocados**; nenhum `db push`,
  `migrate dev` ou `migrate deploy`.
- **Nenhum banco acessado** — nem `omnigestao_prod`, nem `omnigestao_prod_candidate`.
- Fiscal, PDV, Caixa, Estoque, Operações, portal externo, Supabase Auth, Vercel — intocados.
- `lib/auth/enterprise-permissions.ts` e `lib/contador/scope.ts` — **não alterados**.

### Desvios da allowlist (declarados)

1. **`lib/contador/documentos/repo-prisma.ts`** — adicionado `acharCompetenciaPorId`
   (leitura, 9 linhas). O congelamento da exclusão exige o status da competência dona do
   documento, e ali só existe `competenciaId`; sem esse método o requisito não é
   implementável.
2. **`lib/contador/documentos/storage-types.ts` + `storage-supabase.ts`** — adicionado
   `enviarConteudoPrivado` (upload server-side). Coberto por "alterações mínimas no
   adapter do GOAL 010 para integração": o port só sabia criar upload assinado para o
   navegador, e o ZIP oficial nasce no servidor.
3. **`lib/contador/pacote/tipos.ts` + `builder.ts`** — `PacoteContador` passou a expor
   `dados` e `checklist` da mesma carga. Coberto por "alterações mínimas no builder do
   GOAL 008": sem isso o snapshot exigiria uma segunda rodada completa de queries e
   descreveria um instante diferente do pacote.
4. **`lib/contador/__tests__/documentos-service.test.ts`** — dois fakes ganharam os
   métodos novos das interfaces ampliadas (compilação).

## 12. Pendências

1. **Snapshots de versões superadas não são retidos em JSON.** `competencia.snapshot`
   guarda o snapshot da versão vigente; ao refechar, ele é substituído. O que resta da
   versão anterior é o `snapshotHash` no evento `competencia_fechada` e o **pacote
   imutável** (com todos os CSVs e o manifesto). Isso permite *verificar* um snapshot
   apresentado, mas não *reconstruí-lo*. Reter o histórico completo exigiria coluna nova
   ou tabela de snapshots — **schema está fora do escopo deste GOAL**.
2. **Dedupe do evento de divergência é best-effort sob concorrência.** A checagem
   "existe evento com este `diffHash`?" roda dentro da transação, mas sem índice único
   dois POSTs simultâneos podem criar dois eventos. Um `@@unique` parcial resolveria —
   novamente, schema fora do escopo.
3. **Limpeza de blobs órfãos** (upload bem-sucedido + transação falha) não tem job.
   Estratégia registrada em §4; implementação é trabalho de infraestrutura.
4. **`FECHAR_COMPETENCIA_TITLE`** (`contador-fechamento-checklist.tsx`) ficou exportado
   sem consumidor após a realificação. Remoção é limpeza trivial, deixada fora para não
   misturar com o escopo.
5. **Congelamento cobre o domínio contábil, não o operacional.** Vendas, caixa e
   financeiro continuam livres após o fechamento — é exatamente por isso que existe a
   detecção de divergência (§7).

## 13. Classificação final

**Classe A — pronto para revisão humana.** Escopo fechado, sem alteração de schema, sem
acesso a banco, congelamento completo, atomicidade provada contra o repositório real com
rollback e serialização, e trilha append-only preservada.
