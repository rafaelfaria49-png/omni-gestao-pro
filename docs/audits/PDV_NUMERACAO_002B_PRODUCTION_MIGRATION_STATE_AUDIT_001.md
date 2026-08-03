# PDV-PEDIDO-ID-NUMERACAO-002B-PRODUCTION-MIGRATION-STATE-AUDIT-001

## 1. Veredito executivo

| Item | Resultado |
|---|---|
| Veredito | **NÃO APTO** para iniciar o GOAL 002C |
| Classificação | **Classe C** |
| Relação entre os bancos | **DIFFERENT_DATABASES** |
| Migration | `0016_add_sale_numbering_infrastructure` |
| Merge auditado | `6a0d141520d10d66c0e7fbf741439d90f38beb5a` |
| Projetos Production | `omni-gestao-pro` e `omni-gestao` |
| Escritas desta auditoria em Production | **Zero** |
| Rollback, correção ou novo deploy | **Nenhum** |

Os logs dos dois deployments Production mostram que cada projeto executou
`prisma migrate deploy` e aplicou a migration `0016` com sucesso. A comparação
local, sem registrar as identidades, determinou que os destinos eram bancos
distintos. Isso satisfaz diretamente o critério de **Classe C** definido para esta
auditoria e acionou o ponto de parada.

Não houve tentativa de corrigir, reverter, resolver ou reaplicar a migration. A
estrutura física e as contagens agregadas não foram declaradas como verificadas:
o acesso read-only aos dois bancos exatos não estava disponível e, uma vez
comprovada a Classe C, a investigação Production foi interrompida como exigido.

## 2. Escopo, método e limites

A auditoria foi conduzida em worktree isolada, a partir de
`origin/main@6a0d141520d10d66c0e7fbf741439d90f38beb5a`, na branch
`audit/pdv-numbering-002b-production-migration-state`.

Foram usados apenas:

- código, migrations, testes, documentação e histórico Git versionados;
- metadados do PR integrado;
- metadados e logs de build dos dois deployments Production;
- comparação local efêmera das identidades normalizadas de banco, reportando
  somente a relação entre elas;
- buscas estáticas de call sites e dos campos novos.

Não foram executados comandos Prisma contra Production, SQL, DDL, DML, rollback,
revert, deploy, limpeza/reenvio de pendências ou qualquer etapa do GOAL 002C.
Nenhuma URL, senha, token, connection string ou identidade de banco foi gravada
neste relatório.

As variáveis Production observáveis pelo provedor estavam marcadas como sensíveis
e não forneciam seus valores para uma conexão de auditoria. As conexões disponíveis
localmente não correspondiam aos dois destinos identificados nos deployments.
Consequentemente, não foi possível abrir transações `READ ONLY` nos bancos exatos.
Não se tentou contornar essa restrição por outra superfície.

## 3. Auditoria do pipeline

### 3.1 Comando efetivo

O caminho versionado é:

1. `vercel.json:4` configura `node scripts/vercel-build.mjs`;
2. `scripts/vercel-build.mjs:33` habilita a etapa de migration somente quando
   `VERCEL_ENV === "production"`;
3. `scripts/vercel-build.mjs:23` executa `npx prisma migrate deploy`;
4. depois da migration, o script prossegue para geração do Prisma Client e build.

Preview e Development não executam a migration. Esse desvio está expresso no
script e coberto por `scripts/vercel-build.test.mjs:22-39`.

Os logs de ambos os projetos mostram o mesmo comando efetivo,
`node scripts/vercel-build.mjs`. Portanto, os dois deployments usaram o mesmo
fluxo versionado e ambos satisfizeram a condição Production.

### 3.2 Linha do tempo

Horários em `America/Sao_Paulo`:

| Evento | Projeto | Horário |
|---|---|---|
| Merge do PR #34 | GitHub | 03/08/2026 17:17:00 |
| Início aproximado do deployment | `omni-gestao-pro` | 03/08/2026 17:18:38 |
| Início do script de build | `omni-gestao-pro` | 03/08/2026 17:19:01.419 |
| Aplicação da `0016` | `omni-gestao-pro` | 03/08/2026 17:19:07.151 |
| Deployment concluído/Ready | `omni-gestao-pro` | 03/08/2026 17:22:28 |
| Início aproximado do deployment | `omni-gestao` | 03/08/2026 17:22:29 |
| Início do script de build | `omni-gestao` | 03/08/2026 17:22:43.134 |
| Aplicação da `0016` | `omni-gestao` | 03/08/2026 17:22:49.280 |
| Deployment concluído/Ready | `omni-gestao` | 03/08/2026 17:26:10 |

O primeiro deployment responsável foi o de `omni-gestao-pro`; depois,
`omni-gestao` aplicou a mesma migration em outro banco.

Em ambos os logs:

- o comando de migration iniciou;
- o Prisma identificou 16 migrations;
- a `0016_add_sale_numbering_infrastructure` foi anunciada como aplicada;
- as etapas seguintes do build foram executadas;
- o deployment terminou em estado Ready.

O processo não imprimiu uma linha literal com o número do exit code. A continuidade
do script e o estado Ready comprovam operacionalmente uma saída de sucesso; o código
`0` é inferido, não reproduzido como uma linha explícita do log.

## 4. Identidade dos bancos

A identidade normalizada de cada datasource foi comparada localmente como
`host + porta + database`. Nenhum desses componentes, nem seu fingerprint, foi
persistido no repositório.

**Resultado: `DIFFERENT_DATABASES`.**

Assim, os dois projetos chamados Production não compartilham o mesmo banco. Cada
deployment aplicou a `0016` em seu próprio destino. Pelo critério vinculante do
GOAL, essa divergência determina **Classe C**, independentemente de a estrutura
aditiva estar correta em cada banco.

## 5. Estado da migration e do schema

### 5.1 `_prisma_migrations`

Foi comprovado pelos logs do executor que a `0016` foi aplicada nos dois bancos nos
horários da seção 3.2. O primeiro deployment também registrou que as migrations
anteriores estavam sem trabalho pendente antes da aplicação nova.

Não houve `SELECT` direto em `_prisma_migrations`. Por isso, os seguintes valores
permanecem **não verificados diretamente** em cada banco:

- registro e timestamps exatos de `0015_contador_identidade_externa`;
- `started_at` e `finished_at` persistidos da `0016`;
- `applied_steps_count`;
- `rolled_back_at`;
- `checksum`;
- conteúdo de `logs`.

O SHA-256 do arquivo local da migration é
`3C12D8AB5580A6C94D45B111674B4C1BC438E8CE39ADB130E0A66682FBA29613`.
Ele não foi comparado com a linha de Production e não é apresentado como prova de
checksum remoto.

### 5.2 Estrutura física

O arquivo versionado da `0016` prevê:

- `Store.codigoNumeracaoVenda`;
- tabela `series_venda`;
- oito colunas nullable novas em `Venda`;
- uniques por loja/chave idempotente e por série/número;
- índices auxiliares;
- FK de série para loja e FK composta entre `Venda` e a série da mesma loja;
- checks de formato, faixa e coerência entre os campos.

A execução bem-sucedida do `migrate deploy` é evidência de que o SQL versionado foi
aceito nos dois destinos. Entretanto, sem consultas a `pg_catalog` e
`information_schema`, a existência e definição física atual de tabelas, colunas,
índices, uniques, FKs, checks, nulabilidade e defaults são **não verificadas
independentemente**. Não se classifica a estrutura como completa.

### 5.3 Contagens agregadas

Por causa da parada Classe C e da indisponibilidade de conexão read-only para os
destinos exatos, nenhuma contagem Production foi executada:

| Medida | Resultado |
|---|---|
| Total de registros em `SerieVenda` | **UNKNOWN — não consultado** |
| Registros por loja/ano | **UNKNOWN — não consultado** |
| Vendas com `serieVendaId` não nulo | **UNKNOWN — não consultado** |
| Vendas com `numeroSequencial` não nulo | **UNKNOWN — não consultado** |
| Vendas com qualquer campo novo preenchido | **UNKNOWN — não consultado** |
| `pedidoId` no novo formato | **UNKNOWN — não consultado** |

Não há base para afirmar que a infraestrutura está vazia ou que nenhum campo novo
foi preenchido em Production.

## 6. Dormência funcional

No commit publicado, a busca estática confirmou:

- zero call sites Production de `allocateSaleNumber`;
- o writer V1 não importa o helper;
- nenhuma rota importa o helper;
- nenhum componente de UI usa os oito campos novos;
- nenhuma automação versionada chama a sequência.

Resultado consolidado das buscas: `NO_PRODUCTION_CALL_SITES` e
`NO_UI_NEW_FIELDS`.

Portanto, o **código publicado permanece funcionalmente dormente**. Isso não
substitui as contagens de banco: sem o SELECT agregado não é possível excluir dados
criados manualmente, por outro artefato ou por estado não versionado.

## 7. Falhas e impacto comprovados

### F-01 — [P0] Dois projetos Production migraram bancos diferentes

O mesmo merge iniciou dois pipelines Production, e cada pipeline aplicou a migration
em um banco diferente. Essa topologia satisfaz a condição explícita de Classe C e
impede tratar o primeiro sucesso como prova do estado do segundo banco.

**Impacto comprovado:** o schema de numeração foi executado fisicamente em dois
destinos Production distintos. A alteração ocorreu antes desta auditoria, pelos
deployments do merge, e não por uma ação deste trabalho.

### F-02 — [P1] Estado físico e dados não são auditáveis com a credencial disponível

Não havia conexão read-only acessível que correspondesse aos dois bancos identificados.
Logo, integridade física, linhas de `_prisma_migrations` e contagens agregadas não
puderam ser verificadas de forma independente.

**Impacto comprovado:** não é possível elevar o estado a Classe B nem afirmar ausência
de ativação de dados.

### F-03 — [P1] O pipeline Production aplica migrations em todo projeto que o executa

O build não elege um único projeto responsável pela migration. A condição é apenas
`VERCEL_ENV === "production"`, e os dois projetos executaram o mesmo caminho.

**Impacto comprovado:** um merge de aplicação também atua como mecanismo de alteração
de schema em cada datasource Production associado ao build.

### F-04 — [P1] A expectativa documentada no PR divergiu do pipeline real

A descrição operacional do PR #34 registrava que não haveria aplicação de migration
em Production. O `vercel.json`, o script de build e os dois logs Production
demonstram o contrário.

**Impacto comprovado:** a decisão de integração foi documentada com uma premissa
incompatível com o mecanismo efetivo de deploy.

## 8. Respostas operacionais

1. **A migration foi aplicada?** Sim, segundo os logs, nos dois bancos.
2. **Em qual deployment?** Primeiro em `omni-gestao-pro`, às 17:19:07.151; depois
   em `omni-gestao`, às 17:22:49.280, ambos decorrentes do merge `6a0d141`.
3. **Os projetos compartilham banco?** Não. Resultado: `DIFFERENT_DATABASES`.
4. **A estrutura física está completa?** Não determinável sem consulta direta;
   o sucesso da migration não foi substituído por uma inspeção de catálogo.
5. **Existe dado criado pela infraestrutura?** `UNKNOWN`; as contagens não foram
   executadas.
6. **O sistema permanece funcionalmente dormente?** Sim no código publicado, com
   zero call sites e zero uso na UI; o estado dos dados permanece desconhecido.
7. **Manter ou planejar rollback?** É mais seguro **manter a migration aplicada por
   enquanto**. Um rollback automático acrescentaria divergência entre schema e
   `_prisma_migrations` e alcançaria dois bancos cujo estado físico/dados ainda não
   foi medido. Qualquer decisão de reversão exige incidente e plano separados.

## 9. Decisão e ponto de parada

Esta auditoria decide:

- não alterar Production;
- não executar rollback apenas porque a migration foi aplicada;
- bloquear o GOAL 002C;
- recomendar o GOAL separado
  `DEPLOY-PRODUCTION-MIGRATION-GOVERNANCE-AUDIT-001`;
- nesse trabalho separado, providenciar acesso estritamente read-only aos dois
  destinos, verificar catálogo/migration ledger/contagens e definir um único
  responsável por migrations no pipeline.

**Veredito final: NÃO APTO — Classe C.**
