# DEPLOY-PRODUCTION-MIGRATION-GOVERNANCE-AUDIT-001

## 1. Veredito executivo

| Item | Resultado |
|---|---|
| Veredito | **NÃO APTO** para atribuir autoridade de migration ou iniciar o GOAL 002C |
| Classificação | **Classe C** |
| Base auditada | `origin/main@6a0d141520d10d66c0e7fbf741439d90f38beb5a` |
| Projetos Production | `omni-gestao-pro` e `omni-gestao` |
| Relação entre os bancos | **DIFFERENT_DATABASES** |
| Projeto canônico formal | **UNKNOWN — decisão humana pendente** |
| Candidato mais forte | `omni-gestao-pro`, sem promoção automática a autoridade |
| Banco canônico formal | **UNKNOWN — decisão humana pendente** |
| Migration incidente | `0016_add_sale_numbering_infrastructure`, aplicada nos dois bancos |
| Dano funcional comprovado | **Nenhum**; ausência de dano não equivale a integridade física/dados verificados |
| Escritas operacionais desta auditoria | **Zero** |

As evidências convergem fortemente para `omni-gestao-pro` como aplicação usada pelos
operadores: o domínio aparece como Production na documentação, foi usado nos smokes
operacionais comprovados e recebeu tráfego recente de vendas e terminal. Isso não é
suficiente para declarar autoridade. O segundo projeto continua conectado ao mesmo
repositório e à mesma branch `main`, recebe deployments Production, usa outro banco e
não tem finalidade vigente documentada. O critério vinculante do GOAL determina
**Classe C** quando o propósito do segundo projeto é desconhecido ou quando projeto e
banco canônicos exigem decisão humana.

Nenhuma opção de guard foi implementada. A recomendação técnica é o contrato
**variável explícita + correspondência exata do project ID**, mas sua configuração
depende primeiro da ratificação humana do projeto e do banco canônicos.

## 2. Escopo, método e limites

A auditoria foi conduzida na branch
`audit/deploy-production-migration-governance`, em worktree isolada, a partir da
`origin/main` atual. O commit documental anterior `7fc2608` foi reaplicado sem
conflito como `2fe5902`; a worktree original
`C:\tmp\omni-gestao-pdv-numbering-002b-prod-audit` foi preservada sem novas
alterações.

Foram usados somente:

- código, documentação, configuração e histórico Git versionados;
- metadados read-only do repositório e do PR #34;
- configurações, histórico de deployments, logs de build e janela observável de
  tráfego dos dois projetos Vercel;
- nomes e escopos de variáveis, sem revelar valores;
- a relação sanitizada de identidade de banco já comprovada pela auditoria anterior.

Não foram executados SQL, Prisma contra Production, deploy, rollback, alteração de
variável, alteração de projeto Vercel, escrita no GitHub, push, PR ou etapa do GOAL
002C. Nenhum ID completo de projeto, host, porta, nome de banco, connection string,
token ou valor de variável foi persistido.

A observabilidade de tráfego disponível no plano Hobby ficou limitada à última hora.
Assim, a ausência de request do segundo alias nessa janela não prova ausência
histórica de tráfego. Também não houve acesso SQL aos bancos: catálogo,
`_prisma_migrations` e contagens continuam fora do escopo deste GOAL.

### 2.1 Identificadores sanitizados

| Alias deste relatório | Projeto | Fingerprint SHA-256 do project ID |
|---|---|---|
| `PROJECT_A` | `omni-gestao-pro` | `2cfcc0a76da7` |
| `PROJECT_B` | `omni-gestao` | `02bf338b1365` |
| `DATABASE_A` | datasource Production de `PROJECT_A` | identidade não registrada |
| `DATABASE_B` | datasource Production de `PROJECT_B` | identidade não registrada |

Resultado já comprovado por comparação normalizada e descartável de
`host + porta + database`: **`DIFFERENT_DATABASES`**.

## 3. Inventário dos projetos Vercel

### 3.1 Configuração comparada

| Propriedade | `PROJECT_A` — `omni-gestao-pro` | `PROJECT_B` — `omni-gestao` |
|---|---|---|
| Team proprietário | `rafaelfaria49-4373's projects` — Hobby | o mesmo team — Hobby |
| Repositório Git | `rafaelfaria49-png/omni-gestao-pro-pdv-claude` | o mesmo repositório |
| Production branch | `main` | `main` |
| Root directory | raiz do repositório (`./`), sem override | raiz do repositório (`./`), sem override |
| Build command efetivo | `node scripts/vercel-build.mjs`, vindo de `vercel.json` | o mesmo comando |
| Install command | sem override específico observado; default da plataforma | sem override específico observado; default da plataforma |
| Output configuration | Next.js detectado, sem output override específico observado | Next.js detectado, sem output override específico observado |
| Node no projeto | `20.x` | `24.x` via override do projeto |
| Domínio Production | `omni-gestao-pro.vercel.app` | `omni-gestao-pi.vercel.app` |
| Custom domains | nenhum | nenhum |
| Aliases Production observados | somente o alias Vercel acima | somente o alias Vercel acima |
| Redirect/alias entre projetos | nenhum comprovado | nenhum comprovado |
| Deployment atual | Ready | Ready |
| Commit implantado | `6a0d141520d10d66c0e7fbf741439d90f38beb5a` | o mesmo commit |
| Origem de Production | push/merge em `main` pela integração GitHub | a mesma origem |
| Origem de Preview | branches do mesmo repositório | branches do mesmo repositório |
| Deploy hooks | nenhum observado | nenhum observado |
| Fila de builds | máximo de um build simultâneo por projeto | máximo de um build simultâneo por projeto |

Os históricos dos dois projetos repetem a mesma cadência de commits: merges em
`main` geram Production e branches de trabalho geram Preview em ambos. A fila é
por projeto e não serializa `PROJECT_A` contra `PROJECT_B`; portanto, não é um lock
entre os dois executores.

A diferença de Node (`20.x` versus `24.x`) e os conjuntos distintos de variáveis
confirmam que são projetos configurados independentemente, apesar de compartilharem
fonte, branch e runner. Essa deriva não explica nem legitima, por si só, a existência
de duas autoridades Production.

### 3.2 Integração GitHub e gatilhos

O PR #34 foi integrado em `main` no commit `6a0d141` em 03/08/2026 às
17:17 BRT. Os dois projetos estavam conectados ao mesmo repositório e à mesma branch
Production. Como consequência, o merge iniciou os dois pipelines:

| Projeto | Aplicação observada da `0016` |
|---|---|
| `PROJECT_A` | 03/08/2026 17:19:07 BRT |
| `PROJECT_B` | 03/08/2026 17:22:49 BRT |

`scripts/merge-to-main.sh` também documenta que o push de `main` dispara Vercel. Na
topologia atual, esse push alcança ambos os projetos, não somente um.

### 3.3 Variáveis que influenciam o build

Nos dois projetos, a tela read-only de variáveis vinculadas lista `DATABASE_URL` e
`DIRECT_URL` como sensíveis no escopo Production. Os valores não foram revelados. A
comparação anterior registrou somente a relação `DIFFERENT_DATABASES`.

As System Environment Variables da Vercel estão habilitadas, disponibilizando ao
runner metadados como ambiente e project ID. Em nenhum dos projetos foi encontrada
variável com semântica de autoridade de migration, allowlist de project ID ou lock
externo. Outras variáveis de aplicação existem e diferem entre os projetos, mas não
foram necessárias para decidir a governança e seus valores não foram lidos.

### 3.4 Proteção de Production

As telas de Deployment Protection não mostraram uma regra específica capaz de eleger
autoridade de migration. Trusted Sources e proteção de acesso HTTP são controles de
acesso a deployments, não controles sobre a execução do build.

Há evidência histórica no repositório de que `omni-gestao` esteve sob SSO de
deployment durante um smoke, mas isso não define sua finalidade atual e não impede o
build Production de executar migrations. `omni-gestao-pro` atende requests públicos
operacionais. Logo, proteção HTTP não mitiga o incidente.

## 4. Domínios, tráfego e uso operacional

### 4.1 Evidência a favor de `PROJECT_A`

- `CLAUDE.md` descreve `NEXTAUTH_URL` com
  `https://omni-gestao-pro.vercel.app`;
- o webhook Production do WhatsApp é documentado e validado contra esse domínio;
- auditorias operacionais apontam as telas de vendas nesse domínio;
- evidências recentes de Production usam o alias para `/api/version` e smokes do
  portal do contador;
- na janela atual observável, o alias recebeu requests `200` recorrentes de
  `/api/ops/vendas-list`, `/api/ops/terminal/heartbeat` e `/api/version`.

Esse conjunto prova uso operacional real e torna `PROJECT_A` o **candidato mais
forte** a projeto canônico.

### 4.2 Evidência sobre `PROJECT_B`

- o repositório não contém referência ao alias
  `https://omni-gestao-pi.vercel.app`;
- não há custom domain, redirect ou alias que encaminhe o domínio de `PROJECT_B`
  para `PROJECT_A`, ou vice-versa;
- na janela observável, apareceram apenas requests estáticos a hosts efêmeros de
  Preview (`/`, manifest e ícones), sem request operacional ou request ao alias
  Production de `PROJECT_B`;
- os históricos de deployment mostram, ainda assim, que `PROJECT_B` recebe cada
  mudança de `main` como Production e mantém `DATABASE_B` próprio.

Isso não prova que `PROJECT_B` esteja sem usuários, nem permite chamá-lo de legado,
staging ou descartável. Seu propósito e seu proprietário operacional não estão
documentados. A resposta factual à pergunta “por que existem dois projetos
Production?” é **UNKNOWN**.

### 4.3 Decisão de canonicalidade

Nome, tráfego de uma hora e referências históricas não substituem uma decisão de
arquitetura/negócio. Declarar `PROJECT_A` e `DATABASE_A` como autoridade faria uma
escolha operacional não autorizada e poderia abandonar um ambiente independente.
Portanto:

- projeto Production canônico: **não determinável nesta auditoria**;
- banco canônico: **não determinável nesta auditoria**;
- candidato baseado em evidência: `PROJECT_A` associado a `DATABASE_A`;
- decisão necessária: ratificar ou rejeitar esse par e definir a disposição de
  `PROJECT_B`/`DATABASE_B`.

## 5. Mapa completo dos executores de migration encontrados

| Caminho | Tipo | Capacidade/condição |
|---|---|---|
| `vercel.json` → `scripts/vercel-build.mjs` | automático | build efetivo dos dois projetos |
| `scripts/vercel-build.mjs` | automático | se `VERCEL_ENV === "production"`, executa baseline e `npx prisma migrate deploy` antes de generate/build |
| `scripts/prisma-baseline.mjs` | automático em Production | consulta o ledger e, se ausente, pode executar `prisma migrate resolve --applied` para `0001..0014` antes do deploy |
| `package.json` — `build` | manual/CI/Vercel | chama o mesmo runner; com `VERCEL_ENV=production`, também habilita migrations |
| `package.json` — `db:migrate` | manual | `prisma migrate dev`; não deve ser procedimento Production |
| `package.json` — `db:push` | manual | `prisma db push` |
| `package.json` — `db:push:node` | manual | wrapper `scripts/run-prisma-db-push.mjs` para `prisma db push` |
| `arrumar_banco.bat` | manual | `prisma db push --accept-data-loss`; caminho de maior risco |
| `docs/ai/DEPLOY.md` | manual documentado | instrui `npx prisma migrate deploy` sem autoridade de projeto/banco |
| `package.json` — `db:migrate-loja` e `db:migrate-legacy-financeiro` | manual, dados | scripts Prisma de migração/backfill de dados; não aplicam o ledger de schema, mas exigem o mesmo governo de credencial e aprovação |
| `scripts/merge-to-main.sh` | gatilho indireto | faz push de `main`, disparando Production nos dois projetos conectados |

As GitHub Actions versionadas não executam `migrate`, `db push` ou `migrate deploy`;
há somente `prisma generate` em workflows fiscais. `postinstall` também executa
somente `prisma generate`.

O runner confirma estaticamente:

- Production executa baseline + `prisma migrate deploy`;
- Preview, Development, local e ambiente sem `VERCEL_ENV` não executam migration;
- ambos os projetos usam o mesmo runner;
- a única autorização atual é `VERCEL_ENV === "production"`;
- não existe comparação com `VERCEL_PROJECT_ID`;
- não existe variável explícita de autoridade;
- não existe lock externo entre projetos.

## 6. Causa e falhas comprovadas

### F-01 — [P0] Dois projetos possuem autoridade Production implícita

O mesmo merge em `main` executou o mesmo runner em dois projetos e aplicou a mesma
migration em `DATABASE_A` e `DATABASE_B`.

**Impacto comprovado:** uma mudança de schema foi propagada automaticamente a dois
bancos distintos sem uma decisão explícita de autoridade.

### F-02 — [P0] Projeto e banco canônicos não possuem decisão registrada

`PROJECT_A` tem a evidência operacional mais forte, mas a finalidade vigente de
`PROJECT_B` não é documentada. Não há ADR, owner operacional ou política de
desativação/retenção que permita classificar o segundo ambiente.

**Impacto comprovado:** nenhum project ID ou datasource pode ser configurado como
autoridade sem decisão humana adicional; o GOAL 002C continua bloqueado.

### F-03 — [P1] O runner não contém guard fail-closed de autoridade

`VERCEL_ENV=production` é suficiente para entrar no baseline e no migrate. Não há
flag explícita, allowlist, comparação de project ID ou coordenação entre projetos.

**Impacto comprovado:** um terceiro projeto conectado como Production também
executaria migrations contra o datasource que recebesse.

### F-04 — [P1] Existem caminhos manuais fora de uma autoridade única

O repositório mantém instrução manual de `migrate deploy`, wrappers de `db push` e
um batch com `--accept-data-loss`. Nenhum deles exige registro de aprovação ou prova
de que aponta para o banco canônico.

**Impacto comprovado:** mesmo após um futuro guard no build, a governança permanecerá
contornável se esses procedimentos não forem bloqueados ou explicitamente governados.

### F-05 — [P1] A premissa operacional do PR #34 divergiu do deploy real

O PR registrou que não aplicaria migration em Production, mas o runner já fazia isso
automaticamente e os dois logs comprovaram a aplicação.

**Impacto comprovado:** a revisão do merge ocorreu com uma premissa incompatível com
o mecanismo efetivo.

### F-06 — [P2] Configurações dos projetos já apresentam deriva

Os projetos usam versões de Node e conjuntos de variáveis diferentes, embora
implantem o mesmo código e branch.

**Impacto comprovado:** a duplicidade cria superfícies independentes de configuração
e pode produzir comportamentos distintos sem revisão no repositório.

## 7. Avaliação dos modelos de governança

| Opção | Vantagens | Limitações | Decisão |
|---|---|---|---|
| 1. Booleano isolado | simples; baixo esforço | pode ser copiado ou habilitado no projeto errado; não vincula identidade | **Rejeitar como autoridade única** |
| 2. Allowlist por `VERCEL_PROJECT_ID` | vincula a execução a uma identidade; terceiro projeto falha fechado | configuração isolada pode ficar inconsistente; não registra intenção separadamente | aceitável, mas incompleto |
| 3. Flag explícita + project ID | intenção e identidade precisam coincidir; projetos secundários e terceiros pulam migration | ainda acopla schema ao build Vercel; exige ratificação e disciplina de variáveis | **Recomendado como primeiro guard** |
| 4. Pipeline GitHub dedicado | separa migration do build; permite environment protegido, aprovação e evidência únicas | exige segredo/credencial adicional, ordenação migration→deploy e mais operação | alvo de maturidade, não primeira mudança |

### 7.1 Contrato recomendado, sem implementação

Após a decisão humana de canonicalidade, o runner deverá cumprir contrato equivalente
a:

1. Production só considera migration se a flag explícita de autoridade estiver no
   valor exato aprovado.
2. O `VERCEL_PROJECT_ID` fornecido pela plataforma deve coincidir exatamente com o
   project ID autorizado configurado; nenhum dos valores é impresso.
3. Ausência, vazio ou divergência executa **zero** baseline e **zero** migrate.
4. Preview, Development e local permanecem sem migration.
5. O log de decisão contém somente `MIGRATION_RUN` ou `MIGRATION_SKIPPED`.
6. Projetos não autorizados continuam em generate/build e não falham apenas por não
   possuírem autoridade.
7. Um terceiro projeto é `MIGRATION_SKIPPED` por default, mesmo que seja Production.
8. A falha de baseline/migrate interrompe somente o deployment autorizado.
9. Testes puros cobrem produção autorizada, flag ausente, ID ausente, ID divergente,
   terceiro projeto, Preview, Development, local e propagação de exit code.
10. Execução manual usa somente a credencial canônica, requer change record e não
    admite `db push --accept-data-loss` como procedimento Production.

Não se deve registrar o project ID completo no código ou nos logs. A referência
esperada deve ser uma variável server-side sensível ou um mecanismo equivalente do
provedor, e o relatório operacional guarda somente fingerprint.

### 7.2 Concorrência e lock

O limite de um build simultâneo por projeto não coordena projetos distintos. O guard
de identidade elimina essa concorrência porque somente uma identidade pode entrar no
executor. Um lock de banco adicional não resolve o incidente atual: `DATABASE_A` e
`DATABASE_B` são bancos diferentes e não compartilham lock.

Para o primeiro guard, não é necessário criar um lock externo adicional se houver um
único executor autorizado e os caminhos manuais forem governados. O comportamento de
locking do próprio executor de migration deve continuar sendo preservado e testado
para concorrência no mesmo banco. Se futuramente coexistirem pipeline dedicado e
execução manual, ambos deverão compartilhar uma exclusão operacional única; nesse
cenário, environment protegido/serialização do orquestrador é preferível a inventar
um lock distribuído dentro de dois bancos.

### 7.3 Aprovação de migrations irreversíveis

Uma migration destrutiva ou irreversível deverá exigir, no mínimo:

- aprovação do owner do repositório/release;
- aprovação distinta do owner de Production/dados;
- identificação explícita de projeto e `DATABASE_A` ou `DATABASE_B` por fingerprint;
- backup/restore ou plano de roll-forward testado;
- janela, impacto, query/DDL revisado e evidência pós-execução;
- registro em change record ou GitHub Environment protegido.

O autor da migration não deve ser o único aprovador.

## 8. Respostas às questões obrigatórias

1. **Qual projeto é canônico?** Não determinável formalmente. `omni-gestao-pro` é o
   candidato mais forte por documentação, smokes e tráfego operacional, mas precisa
   de ratificação humana.
2. **Qual banco é canônico?** Não determinável. `DATABASE_A` é candidato somente por
   associação ao projeto candidato; não é declarado autoridade.
3. **O segundo projeto ainda é necessário?** **UNKNOWN.** Não há finalidade vigente,
   owner ou dependência documentada que prove necessidade ou descarte seguro.
4. **Ele deve continuar recebendo deployments Production?** Não há autorização para
   decidir nesta auditoria. A decisão humana deve escolher entre remover a integração
   Production, reclassificar como Preview/staging com política própria ou mantê-lo
   como ambiente independente formal. Até lá, não alterar.
5. **Qual projeto será autorizado a executar migrations?** Nenhum pode ser nomeado
   agora. Após ratificação, somente o projeto canônico — provavelmente `PROJECT_A` —
   poderá receber a autoridade.
6. **Como o projeto não autorizado deverá se comportar?** Emitir apenas
   `MIGRATION_SKIPPED`, não executar baseline/migrate e continuar generate/build.
7. **Como impedir execução acidental em um terceiro projeto?** Exigir simultaneamente
   flag explícita e correspondência exata do `VERCEL_PROJECT_ID`; ausência ou
   divergência sempre pula migration.
8. **Como lidar com deployments concorrentes?** Uma única identidade autorizada
   elimina concorrência entre projetos; serializar os builds do autorizado e manter
   os demais sem migration. Não contar com filas por projeto como coordenação global.
9. **É necessário lock adicional no banco?** Não para resolver a duplicidade entre
   bancos. Primeiro eleger uma única autoridade. Lock/orquestração adicional só é
   necessário se mais de um executor autorizado continuar possível no mesmo banco.
10. **Quem deverá aprovar migrations irreversíveis?** Owner de release/repositório e
    owner de Production/dados, em aprovações distintas e registradas.
11. **A `0016` deve permanecer aplicada nos dois bancos?** **Sim, provisoriamente.**
    Não há dano comprovado e o rollback sem catálogo, ledger e contagens poderia
    criar dano ou divergência. A decisão não autoriza novas escritas.
12. **O que bloqueia o GOAL 002C?** A decisão humana sobre projeto/banco canônicos, a
    finalidade de `PROJECT_B`, a ausência do guard de autoridade e a verificação
    read-only ainda pendente do estado físico/dados nos dois bancos.

## 9. Decisão sobre a migration `0016`

Os logs provam aplicação bem-sucedida em ambos os bancos. Não foi comprovado dano,
backfill funcional ou ativação do helper; o código publicado continua dormente. Sem
SQL read-only, também não foi comprovada a estrutura física atual, o ledger completo
ou ausência de dados nos campos novos.

Decisão provisória:

- manter a `0016` aplicada em `DATABASE_A` e `DATABASE_B`;
- não executar rollback, resolve, reaplicação ou correção;
- não usar essa permanência como declaração de canonicalidade;
- obter decisão humana e, em GOAL separado, acesso estritamente read-only antes de
  qualquer plano de reversão ou ativação.

## 10. Próximos GOALs e ponto de parada

Por ser Classe C, o próximo passo imediato não é implementação. Deve existir uma
decisão humana específica que registre:

- projeto Production canônico;
- banco autoridade de migration;
- owner operacional de cada ambiente;
- finalidade e destino de `PROJECT_B`/`DATABASE_B`;
- domínio oficial e política de Production/Preview.

Nome sugerido: `DEPLOY-PRODUCTION-CANONICAL-AUTHORITY-DECISION-002A`.

Somente depois de uma decisão aprovada poderá iniciar
`DEPLOY-PRODUCTION-MIGRATION-GOVERNANCE-GUARD-002`, com escopo limitado ao guard
flag + project ID, testes, atualização dos procedimentos manuais e prova de que
projeto secundário/terceiro executa build sem migration.

O GOAL 002C permanece bloqueado. Esta auditoria para sem alterar pipeline,
variáveis, projetos, bancos ou integrações.

## 11. Validações documentais

O commit desta auditoria deve ser validado com:

- `git diff --check`;
- busca de padrões de segredo somente no diff documental;
- lista de arquivos alterados exclusivamente em `docs/`;
- diff vazio para `vercel.json` e `scripts/vercel-build.mjs`;
- worktree limpa depois do commit;
- zero build e zero suíte completa, por ser mudança exclusivamente documental;
- zero ambiente Vercel alterado, zero deployment, zero SQL, zero push e zero PR.

**Veredito final: NÃO APTO — Classe C.**
