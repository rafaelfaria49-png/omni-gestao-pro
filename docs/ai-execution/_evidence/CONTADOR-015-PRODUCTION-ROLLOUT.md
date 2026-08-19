# CONTADOR-015 — Aceite funcional e rollout em Production

Fechamento operacional do GOAL `CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015`.
Documento estritamente factual: sem segredos, sem tokens, sem senhas, sem CNPJ,
sem dados de cliente ou valores financeiros.

## 1. SHA e deployment

- `origin/main` no momento desta evidência: `3af80be9358410bd2779117f34df6d218d082fb6`.
- Código do portal 015 já era ancestral de `main` (`4fe53af`, `1ed3259`).
- Deployment Production observado no aceite: `omni-gestao-6fmavj29j`
  (`dpl_J4oMMNziWV76aBTSAUqmkWQceEfk`) — Ready.
- Alias canônico: `https://omni-gestao-pro.vercel.app`.
- `/api/version`: `buildId` `3af80be93584`, `buildTime` `2026-08-19T00:38:35.436Z`.
- Projeto Vercel canônico: `omni-gestao-pro`.

## 2. Flag e sessão externa

- `CONTADOR_PORTAL_V2` presente em Production (valor lógico **ON**).
- `CONTADOR_EXTERNO_SESSION_SECRET` presente (Encrypted). Valor não lido.
- Nenhuma outra variável de ambiente foi alterada nesta evidência.
- Decisão humana do aceite: a flag permanece **ON** após o fechamento do GOAL.

## 3. Identidade e lojas (Production, comprovado por humano)

- E-mail de teste: `emiliaarloque49@gmail.com`.
- Papel: `CONFERENCIA`.
- Convite `LEITURA` anterior: revogado.
- Convite `CONFERENCIA`: aceito/usado.
- Loja autorizada: `loja-2` — RAFA BRINQUEDOS E VARIEDADES — página abriu e listou competências.
- Loja deliberadamente sem vínculo: `loja-1` — RAFACELL ASSISTEC — **404** na mesma sessão autenticada.
- Nenhuma terceira loja foi inventada.
- Nenhum acesso adicional foi concedido só para completar checklist.

## 4. Smoke Production (sem mutação comercial)

### Sem sessão (revalidado neste fechamento)

| Verificação | Resultado |
|---|---|
| `GET /contador-externo/login` | 200 |
| `GET /contador-externo/convite` | 200 |
| `GET /contador-externo/lojas/loja-2` | 307 → `/contador-externo/login` |
| `GET /api/contador-externo/lojas/loja-2/competencias` | 401 `nao_autenticado` |
| `GET /login-contador` (legado) | 200 |
| Respostas 500 | nenhuma |

### Autenticado (humano, janela do portal — não sessão ERP)

| Critério | Resultado | Natureza |
|---|---|---|
| Login externo | PASS | Production |
| `loja-2` autorizada | PASS | Production |
| `loja-1` 404 | PASS | Production |
| Isolamento multi-loja | PASS | Production |
| Lista de competências (13 meses) | PASS | Production |
| `loja-2 / 2026-08` vazia (em andamento; 0 docs; 0 pacotes; 0 andamento; 0 comentários) | PASS | Production |

Nenhuma escrita (comentário, download, conferência, confirmação, fechamento, upload)
foi executada em dados comerciais.

## 5. Fixture e classificação

- Não existe fixture/store de teste comprovada em Production.
- `loja-2 / 2026-08` não é massa de teste.
- Comentário no portal sobre competência inexistente não materializa linha (404).
- Comentários são append-only; não há delete oficial.
- Classificação: `SAFE_FIXTURE_OPTION=D`.
- Autorização humana explícita: não criar massa sintética em loja comercial.

## 6. Critérios do charter — origem da prova

Não mascarar: o que segue é o mapeamento honesto.

### Provados em Production

1–5 (flag ON, default off já publicado, superfícies 014, sessão externa), 8 (só loja vinculada), 10 (competências no escopo), 23 (estado vazio honesto em 2026-08), 24 (legado 200).

Isolamento: 1 loja autorizada + 1 loja sem vínculo = 404.

### Provados por Vitest (99 testes / 18 arquivos, 2026-08-19)

Suíte focada: `lib/contador/portal/__tests__/**`, `app/contador-externo/isolamento.test.ts`,
`portal-pagina.test.ts`, `portal-acesso.test.ts`, `portal-comentarios-timeline.test.ts`,
`auth/auth.test.ts`, `internas.test.ts`, `convite/convite.test.ts`, `namespace.test.ts`.

Cobre: flag OFF/ON, cross-store, `storageRef` ausente, LEITURA sem escrita, CONFERENCIA,
comentário externo compartilhado, download + evento antes da URL, confirmação de pacote
idempotente, conferir `ENVIADO→CONFERIDO`, competência inexistente 404, revogação com
efeito na request seguinte, sessão externa separada da interna.

### Adaptado por aceite humano (não é o teste original 2+1 executado)

- Roadmap/charter critério 9: “duas lojas autorizadas e bloqueio de uma terceira”.
- Executado: **1 autorizada (`loja-2`) + 1 bloqueada (`loja-1`)**.
- Rafael ratificou esta adaptação. Não deve ser lido como “2+1 original PASS”.

### Sem evidência Production (aceitos via Vitest + decisão humana D)

Download auditado ao vivo, comentário ao vivo, confirmação de pacote ao vivo,
marcar conferido ao vivo, papel LEITURA em Production, revogação desta identidade.

### Sem schema/migration

Nenhuma alteração de `prisma/schema.prisma` nem migration neste GOAL.

## 7. Aceite humano

Mensagem de Rafael em 2026-08-19 (`CONTADOR-015-FINAL-ACCEPTANCE-AND-CLOSE-007`):

- não criar massa sintética em loja comercial;
- aceitar testes automatizados para comportamentos mutáveis sem fixture segura;
- manter evidência Production real listada na §4;
- adaptar 2+1 para 1+1 operacional;
- não inventar terceira loja;
- não conceder acesso extra só para checklist;
- deixar `CONTADOR_PORTAL_V2=on` após o close.

## 8. Ausências

- Nenhum segredo impresso.
- Nenhuma massa comercial contaminada.
- GOAL 016 não iniciado.
- `SERVER_SIDE_PRECHECK` de banco canônico permanece não executável (env Encrypted);
  a prova funcional humana não foi invalidada por isso.

## 9. Estado

```
CONTADOR_PORTAL_V2_PRODUCTION=ON
SAFE_FIXTURE_OPTION=D
CONTADOR_015_PRODUCTION_SMOKE=PASS
CONTADOR_015_AUTOMATED_MUTATION_TESTS=PASS
ROADMAP_2PLUS1_ADAPTED_TO_1PLUS1_BY_HUMAN=true
GOAL_015_STATUS=DONE (após close AEP)
```
