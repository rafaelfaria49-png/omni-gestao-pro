# PDV-PEDIDO-ID-NUMERACAO-SERVER-SAFE-AUDIT-002A

## 1. Identificação, escopo e veredito

| Item | Valor |
|---|---|
| Natureza | Auditoria arquitetural exclusivamente read-only |
| Base Git | `origin/main` em `3bcaf83cd2bae6c462e05d59fd1c1e16d9960cb8` |
| Commit de proteção presente | `3bcaf83 fix(vendas): bloquear colisao de pedido entre lojas` |
| Branch | `audit/pdv-pedido-id-numeracao-server-safe-002a` |
| Worktree | `C:\tmp\omni-gestao-pdv-numbering-audit` |
| Schema/migration/código/dados | Não alterados |
| Produção/Neon/Vercel/navegadores | Não acessados |

**Veredito:** o problema estrutural só termina quando o servidor atribuir o número
comercial em uma transação de banco. A arquitetura recomendada é **D + B**:

- `Venda.id` continua sendo o identificador técnico imutável;
- `clientSaleId` passa a ser a chave imutável de idempotência da tentativa lógica;
- `pedidoId` continua sendo o identificador comercial exibido, mas nasce somente no
  servidor;
- a sequência é anual e independente por loja;
- um prefixo estável e imutável da loja mantém `pedidoId` globalmente único e permite
  preservar as rotas e integrações que hoje recebem somente esse valor;
- o terminal é apenas dimensão de auditoria, nunca parte do contador.

Formato proposto:

```text
VDA-{CODIGO_LOJA}-{ANO}-{SEQUENCIA_6}

VDA-L001-2026-000001
VDA-L002-2026-000001
```

Não se recomenda remover a unicidade global de `Venda.pedidoId` durante esta evolução.
Também não se recomenda criar um novo campo textual duplicado chamado `numeroVenda`: o
campo existente `pedidoId` deve passar a ter uma única responsabilidade, a de número
comercial. A separação ocorre com `Venda.id` e `clientSaleId`.

## 2. Método e limites

Foram lidos antes da análise:

- `docs/ai/START_HERE.md`;
- `docs/ai/CURRENT_STATUS.md`;
- `docs/memory/OMNIGESTAO_MASTER_MEMORY.md`;
- `docs/skills/INDEX.md`;
- `docs/skills/rules/CORE_RULES.md`;
- `docs/governance/GOVERNANCA.md`;
- `docs/governance/AUDIT_PROTOCOL.md`;
- `docs/skills/rules/DELIVERY_CHECKLIST.md`;
- `docs/roadmaps/ROADMAP_PDV.md`.

A auditoria usou somente código, schema, testes e histórico Git versionados. Não foram
executados Prisma Studio, SQL, `prisma db push`, migrations, scripts de auditoria ou
qualquer conexão com banco. As cinco vendas ausentes e quaisquer danos históricos
possíveis estão deliberadamente fora deste escopo.

### Contagem do inventário

A busca literal por `VDA-`, `nextSaleId` e `pedidoId` encontrou:

| Categoria | Arquivos | Linhas com match |
|---|---:|---:|
| Runtime | 41 | 218 |
| Testes/fixtures | 31 | 169 |
| Schema/manual de schema | 2 | 5 |
| Scripts/importadores | 4 | 17 |
| Documentação versionada | 17 | 48 |
| **Total literal** | **95** | **457** |

Além disso, foram identificados 14 arquivos com dependência implícita por
`SaleRecord.id`, `saleId` ou número de impressão, sem conter os três termos da busca
literal. Portanto, há **109 arquivos com dependência direta ou implícita**, sendo 457
ocorrências literais em 95 deles. A unidade “ocorrência” neste relatório é uma linha
retornada pela busca; a matriz consolida linhas do mesmo arquivo em um único registro.

Não foi encontrada ordenação textual por `pedidoId`, nem `split`, `substring` ou
`slice` aplicado a `pedidoId`. As listas produtivas auditadas ordenam por data. Os
únicos parsers produtivos do formato `VDA` são os dois geradores locais baseados em
regex, em `lib/operations-store.tsx` e
`components/dashboard/vendas/trocas-devolucao.tsx`.

## 3. Estado atual

### 3.1 Modelo de dados

`Venda` está em `prisma/schema.prisma:1373`:

- `id String @id @default(cuid())`: já existe uma chave técnica adequada;
- `storeId String @default("loja-1")`: obrigatório, mas ainda com default perigoso;
- `pedidoId String @unique`: unicidade global, usado como chave de negócio;
- `payload Json?`: contém o `SaleRecord`, inclusive o mesmo id comercial;
- `terminalId String?`: dimensão de auditoria;
- índices por `storeId`, status, cliente, título, terminal e estado fiscal;
- não existe `clientSaleId`, hash de idempotência, componente numérico, ano de
  numeração ou relação com contador comercial.

`ItemVenda` referencia corretamente `Venda.id` por FK. Em contraste, os satélites
operacionais ainda tratam `pedidoId` como FK lógica:

- `MovimentacaoEstoque.documento`;
- `MovimentacaoFinanceira.referenciaId`;
- `ContaReceberTitulo.localKey` com `pdv-aprazo-{pedidoId}[-n]`;
- `UsoCreditoCliente.vendaId`, que apesar do nome guarda o `pedidoId`;
- `DevolucaoVenda.vendaLocalId`;
- payloads, recibos, logs e relatórios.

Constraints atuais relevantes:

| Modelo | Constraint | Efeito |
|---|---|---|
| `Venda` | `pedidoId @unique` | Uma string global para todas as lojas |
| `ItemVenda` | FK `vendaId -> Venda.id` | Relação técnica correta |
| `ContaReceberTitulo` | `@@unique([storeId, localKey])` | Idempotência forte dos títulos |
| `DevolucaoVenda` | `@@unique([storeId, localId])` | Idempotência da devolução por loja |
| `MovimentacaoEstoque` | somente índices | Guard de retry é apenas `findFirst` |
| `MovimentacaoFinanceira` | somente índices | Guard de retry é apenas `findFirst` |
| `UsoCreditoCliente` | somente índices | Não há proteção de replay por venda/crédito |
| `NotaFiscal` | uniques de número fiscal e `localKey` | Proteção forte no domínio fiscal |
| `FiscalEmissaoJob` | `@@unique([storeId, dedupeKey])` | Fila fiscal idempotente |

### 3.2 Infraestruturas equivalentes

| Domínio | Situação encontrada | Reuso para vendas |
|---|---|---|
| O.S. | `numero` é apenas indexado; `nextCodigo()` usa `count + 1` | Não é seguro nem reutilizável |
| Orçamento | Vive principalmente no agregado/payload da O.S.; sem contador documental próprio | Não |
| Venda originada de O.S. | `VND-{ano}-{count+1}` em `app/actions/operacoes.ts:1152-1205` | Deve migrar para o serviço único |
| Caixa | IDs técnicos; operações sem contador comercial e sem unique de local id | Não |
| Financeiro | `localKey` composta em contas a pagar/receber | Padrão de idempotência reaproveitável |
| Devolução | `localId` gerado no cliente, unique por loja | Mostra o padrão de chave de tentativa, não de numeração |
| Fiscal | `SerieFiscal.proximoNumero`, incremento atômico, CAS e constraints | **Sim, como padrão arquitetural** |
| Recibos | Recebem número como string opaca | Compatíveis após aguardar resposta do servidor |

O fiscal oferece o melhor precedente:

- `SerieFiscal` é única por `(storeId, modelo, serie, ambiente)`;
- o adapter executa um único `UPDATE ... increment: 1`, que o PostgreSQL serializa
  na linha do contador;
- `NotaFiscal` tem unique contextual do número;
- a alocação é idempotente e trata `P2002`, `P2025` e retries;
- a nota usa `Venda.id` técnico internamente.

O código fiscal deve ser usado como **referência de desenho e testes**, não como a
mesma tabela ou sequência. Numeração fiscal tem regras de lacuna e ciclo legal próprios.
A sequência comercial precisa de modelo, portas e política separados.

### 3.3 Fluxo atual de venda PDV

1. `nextSaleId` usa o ano do relógio do navegador.
2. Varre apenas as vendas presentes naquele `localStorage`.
3. Reconhece somente `/^VDA-(\d{4})-(\d+)$/`.
4. Calcula `max + 1` e cria `VDA-YYYY-NNNN`.
5. O mesmo callback já reduz estoque, caixa, crédito e ledger locais.
6. Persiste `SaleRecord.id = saleId`, com `syncPending: true`.
7. Retorna `saleId` sincronicamente aos quatro PDVs, que já o usam em cupom,
   Contas a Receber local, auditoria e pós-venda.
8. Só depois dispara `POST /api/ops/venda-persist` em fire-and-forget.
9. A API responde apenas `{ ok: true }`; não há id/número autoritativo no retorno.

Cada navegador e cada aba mantém sua própria fotografia. A troca de Chrome para Edge
apenas cria outra fotografia e não cria coordenação.

### 3.4 Escritas de venda fora do fluxo principal

Há quatro classes de writer:

1. PDV ao vivo: `/api/ops/venda-persist` ->
   `upsertVendaInTransaction`;
2. replay legado: `/api/ops/sync-legacy-vendas` -> o mesmo upsert, sem os gates
   completos de estoque/caixa do fluxo ao vivo;
3. faturamento de O.S.: `criarVendaDeOSAction`, que gera
   `VND-{ano}-{count+1}` e chama `prisma.venda.create` diretamente;
4. importadores (`importar_backup.mjs` e
   `lib/importador-avancado/persistidor.ts`), que preservam ids externos e fazem
   upsert por `pedidoId`.

Uma implementação que altere somente `nextSaleId` deixa writers concorrentes fora da
autoridade. O serviço de criação/numerador precisa ser a única porta para **novas
vendas operacionais**. Importação histórica deve permanecer um modo separado,
explicitamente marcado e fail-closed em colisão.

## 4. Achados e severidade

| ID | Severidade | Achado | Evidência/efeito |
|---|---|---|---|
| F-01 | Crítica | Numeração local colide entre lojas, terminais, navegadores e abas | `nextSaleId`, `pedidoId @unique` global |
| F-02 | Crítica | O guard publicado tem janela TOCTOU para duas lojas criarem simultaneamente o mesmo id ainda inexistente | `findUnique` ocorre antes do `upsert`; o `update` não revalida a loja |
| F-03 | Crítica | Mesmo `pedidoId` na mesma loja é sempre tratado como replay, mesmo se representar outra venda | O upsert pode sobrescrever payload/total/data e recriar itens |
| F-04 | Crítica | Retry de venda com vale pode debitar `ClienteCredito` novamente | `UsoCreditoCliente.create` não tem guard nem unique por venda/crédito |
| F-05 | Alta | Estoque e financeiro usam `findFirst` sem constraint de banco | A correção depende da serialização incidental da linha de `Venda` |
| F-06 | Alta | Faturamento de O.S. tem outro gerador inseguro (`count + 1`) | Concorrência ou exclusões podem produzir colisão |
| F-07 | Alta | Troca prediz a próxima venda antes de `finalizeSaleTransaction` | O payload pode apontar para um número diferente no modelo server-side |
| F-08 | Alta | `SaleRecord.id` concentra chave local, número comercial, merge e retry | Impede atribuir número após a confirmação sem migrar o contrato |
| F-09 | Alta | Auto-retry repete 4xx após cooldown em memória e pode rodar em várias abas | Não há líder de sync nem classificação persistida |
| F-10 | Alta | Descarte consulta o servidor por `pedidoId`; 404 pode apagar uma venda local bloqueada por colisão | A ausência na loja não prova que a transação local é descartável |
| F-11 | Média | Ano e sequência dependem do relógio e do cache do cliente | Virada de ano, clock incorreto e cache parcial alteram o número |
| F-12 | Média | Defaults/helpers ainda podem cair em `loja-1` | `Venda.storeId @default`, `opsLojaIdFromStorageKey` |
| F-13 | Média | A API não devolve identidade definitiva nem indica replay | `{ ok: true }` não permite reconciliação autoritativa |
| F-14 | Média | Recibos e caches são produzidos antes da confirmação | Podem materializar um número que o servidor rejeita |

### 4.1 Detalhe da janela concorrente do guard atual

O commit `3bcaf83` impede corretamente que uma requisição encontre e altere um
`pedidoId` que **já** pertence a outra loja. Porém, este interleaving ainda é possível:

1. Loja A consulta `pedidoId=X`: ausente.
2. Loja B consulta `pedidoId=X`: ausente.
3. Loja A cria `X`.
4. Loja B executa o upsert por `X`.

Como `storeId` foi removido do bloco `update`, a linha não troca de loja, o que é uma
defesa importante. Ainda assim, a segunda chamada pode atualizar payload, total, data
e itens da venda vencedora e executar efeitos usando a loja perdedora. Uma constraint
global protege a string, mas não expressa a identidade da tentativa lógica. O desenho
novo não pode depender de um “check then act”; a idempotência e a numeração precisam
ser decididas sob constraints na mesma transação.

## 5. Inventário completo de dependências

Legenda:

- **A** exibição;
- **B** parsing/formato;
- **C** ordenação;
- **D** idempotência;
- **E** financeiro/Contas a Receber;
- **F** estoque;
- **G** fiscal;
- **H** sincronização/localStorage;
- **I** teste/fixture;
- **J** legado/depreciado/documentação operacional.

“Aceita novo” indica se o local aceita uma string opaca com prefixo sem alteração.
Mesmo quando “sim”, a separação entre chave técnica, `clientSaleId` e `pedidoId` pode
exigir ajuste de contrato.

### 5.1 Runtime, schema, scripts e importadores — matches literais

| arquivo | linha | tipo_de_dependencia | aceita_formato_novo | risco | ajuste_necessario |
|---|---|---|---|---|---|
| `app/actions/operacoes.ts` | 1137,1161,1184,1205 | A/B/J, writer O.S. | Não no writer | Crítico: `count+1` | Chamar serviço server-side; idempotência determinística da O.S. |
| `app/actions/vendas-enterprise.ts` | 15,47,48,56 | A/D | Sim, como string | Usa comercial para localizar | Preferir `Venda.id`; manter adapter por `pedidoId`. |
| `app/api/dashboard/elite/route.ts` | 131 | A | Sim | Baixo | Exibir qualquer formato; incluir id técnico se necessário. |
| `app/api/financeiro/relatorios/exportar/route.ts` | 239,248 | A/E | Sim | Baixo | Preservar coluna comercial e adicionar id técnico opcional. |
| `app/api/ops/caixa/sessao-detalhe/route.ts` | 198,226 | A/E | Sim | Baixo | Continuar exibindo `pedidoId`; relações internas por `Venda.id`. |
| `app/api/ops/devolucao/route.ts` | 195 | D/F | Sim no formato; não na separação | FK lógica | Adicionar `vendaId` técnico; manter `vendaLocalId` legado. |
| `app/api/ops/venda-persist/route.ts` | 51,52,88,98,113,124,133,145,166 | D/H, writer | Não | Crítico | Contrato v2 recebe `clientSaleId`, retorna número; adapter v1 isolado. |
| `app/api/ops/vendas-list/route.ts` | 42 | A/H | Sim | Merge perde identidades | Retornar `id`, `clientSaleId` e `pedidoId` separados. |
| `app/api/vendas/[id]/cancelar/route.ts` | 39,56,81,108,207,234,235,245,250,270,272,281,291,322 | D/E/F | Sim no formato | Alto: FK lógica e guards sem unique | Resolver uma vez para `Venda.id`; satélites com chave técnica/idempotencyKey. |
| `app/api/vendas/[id]/corrigir/route.ts` | 19,100,102,139,257,278,311,313,336,346,365,371,388,403,426,456,461,516,547,623,641 | D/E | Sim no formato | Alto: muitas chaves derivadas | Migrar efeitos para `Venda.id`; manter leitura de localKeys antigos. |
| `app/api/vendas/[id]/corrigir-item-meta/route.ts` | 52,53,78,157 | A/D | Sim | Médio | Resolver por rota legada, operar por id técnico. |
| `app/api/vendas/[id]/corrigir-itens/route.ts` | 72,73,99,255,256,284,286,294,355 | D/E/F | Sim no formato | Alto | Chaves de efeito por `Venda.id`; constraints de ledger. |
| `app/api/vendas/[id]/corrigir-parcelas/route.ts` | 9,10,48,49,70,98,130,167,168,183,230 | D/E | Sim no formato | Alto | Novos títulos por FK/índice de parcela; compatibilidade `startsWith` legado. |
| `app/api/vendas/[id]/corrigir-titulo/route.ts` | 44,45,74,86,88,181 | D/E | Sim | Médio | Validar vínculo técnico; aceitar localKey histórica. |
| `app/api/vendas/[id]/route.ts` | 70,75,83,95,108,112,173,181,235 | A/D/E/F | Sim no formato | Alto: agregação por chaves lógicas | Manter rota por comercial e criar acesso por id/clientSaleId. |
| `app/api/vendas/[id]/solicitar-emissao/route.ts` | 52,54,55,67,83 | A/G | Sim | Baixo/médio | Rota pode resolver comercial; fiscal já usa `Venda.id`. |
| `app/api/vendas/historico/route.ts` | 8,97,166,184,186 | A/H | Sim | Baixo | Busca textual já aceita ambos; retornar identidades separadas. |
| `app/dashboard/clientes/ClientesPageClient.tsx` | 1896 | A | Sim | Baixo | Nenhum parser; apenas rotular. |
| `components/dashboard/vendas/cupom-nao-fiscal.tsx` | 32 | A | Sim | Médio se chamado antes do ACK | Imprimir definitivo só após resposta; provisório claramente marcado. |
| `components/dashboard/vendas/pdv-venda-completa-enterprise.tsx` | 557 | D/A | Sim no formato | Usa resultado síncrono | Aguardar resposta e usar `pedidoId` retornado. |
| `components/dashboard/vendas/trocas-devolucao.tsx` | 378,381,693 | B/D/H | **Não** | Crítico: prediz próximo id | Remover regex/predição; ligar por `clientSaleId`/`Venda.id`. |
| `components/dashboard/vendas/venda-completa-enterprise.tsx` | 701 | D/A | Sim no formato | Usa resultado síncrono | Aguardar retorno autoritativo. |
| `components/dashboard/vendas/workspace-correcao-venda.tsx` | 669 | E | Sim | Médio | Plano recebe id técnico ou resolve no servidor. |
| `components/whatsapp/use-whatsapp-cliente-context.ts` | 22,95 | A | Sim | Baixo | Tratar como string opaca. |
| `components/whatsapp/WhatsAppContextPanel.tsx` | 249,703 | A | Sim | Baixo | Tratar como string opaca. |
| `importar_backup.mjs` | 289,312,328,348,349,367,370 | D/J, writer | Sim como legado | Alto em colisão | Modo importação explícito, namespace/chave externa e quarentena. |
| `lib/contador/pacote/carregar-fontes.ts` | 130,400,616,619 | A/E/F | Sim no formato | Médio: join com devolução | Preferir `Venda.id`; fallback por comercial histórico. |
| `lib/contas-receber-types.ts` | 31 | E | Sim | Baixo | Acrescentar `vendaId` técnico e manter campos legados. |
| `lib/escpos.ts` | 94 | A | Sim | Médio se pré-ACK | Aceitar string; imprimir definitivo após ACK. |
| `lib/financeiro/contracts/local-key.ts` | 19,29,48,49,64,68,91,120 | D/E | Sintaticamente sim | Alto: comercial é idempotency key | Nova chave por `Venda.id`; parser legado permanece. |
| `lib/financeiro/contracts/payload.ts` | 14 | E | Sim | Baixo | Adicionar `vendaId`; manter `pedidoId` para exibição. |
| `lib/fiscal/queue/queue-producer.ts` | 43,78,113,126,128,133,146,147,288 | A/G | Sim | Baixo | Entrada pode resolver comercial; dedupe já usa id técnico. |
| `lib/fiscal/venda-fiscal-snapshot.ts` | 89,173,548 | A/G | Sim | Baixo | Snapshot preserva o número comercial como texto. |
| `lib/fiscal/venda-fiscal-snapshot-runtime.ts` | 38,67,72,76,77,82,88,176 | A/G | Sim | Baixo | Manter adapter por comercial; núcleo por `Venda.id`. |
| `lib/fiscal/venda-fiscal-snapshot-service.ts` | 108,226 | A/G | Sim | Baixo | Já opera por `Venda.id`; nenhuma mudança estrutural. |
| `lib/fiscal/xml/nfce-xml-builder.ts` | 433 | A/G | Sim | Baixo | Texto complementar aceita formato opaco. |
| `lib/importador-avancado/persistidor.ts` | 434,435,455,477,480,494 | D/J, writer | Sim como legado | Alto em colisão | Não usar serviço de venda viva; origem/import key e quarentena. |
| `lib/operations-store.tsx` | 132,136,139,1397 | B/D/H, writer client | **Não** | Crítico | Remover `nextSaleId`; persistir `clientSaleId` antes do POST. |
| `lib/ops-upsert-venda.ts` | 92,94,95,96,104,114,115,117,122,234,244,260,261,263,271,272,275,292,308,399,402,412,518,532,534,585,586,600,617,619,653,663,670,698,704,710,711,725 | D/E/F/H | Não na semântica | Crítico | Serviço v2 com unique de idempotência e número transacional. |
| `lib/vendas/correcao-parcelamento-plan.ts` | 8,11,57,65,97 | D/E | Sim no formato | Médio | Nova chave por técnico; função legada preservada. |
| `lib/vendas/sale-from-db-row.ts` | 28,48,65 | A/H | Sim no formato | Alto: mapeia comercial para `id` local | Mapear campos separados; aceitar payload legado. |
| `lib/whatsapp/ai-conversation-analysis.ts` | 218,248,321,351 | A | Sim | Baixo | Tratar como string opaca. |
| `prisma/schema.prisma` | 1378,1380,1541 | D/E | Não na arquitetura | Crítico | Alteração aditiva futura conforme seção 9; nenhuma neste GOAL. |
| `prisma/supabase_manual_full_schema.sql` | 150,156 | J | Não | Artefato manual pode divergir | Atualizar apenas no GOAL de schema conforme governança. |
| `scripts/caixa-test.mjs` | 72,115 | A/J | Sim | Baixo | Atualizar fixture/diagnóstico; não usar para produção. |
| `scripts/diag-sessoes-detalhe.mjs` | 17,20,26,28,42,44 | A/J | Sim | Baixo | Apenas exibição diagnóstica. |
| `scripts/diag-sessoes-presas.mjs` | 51,63 | A/J | Sim | Baixo | Apenas exibição diagnóstica. |
### 5.2 Testes e fixtures — matches literais

| arquivo | linha | tipo_de_dependencia | aceita_formato_novo | risco | ajuste_necessario |
|---|---|---|---|---|---|
| `app/api/ops/caixa/sessao-detalhe/route.test.ts` | 153,158,166,228,233,245,249,254 | A/I | Sim | Fixture antiga | Cobrir formato misto e id técnico. |
| `lib/contador/pacote/correcoes-008c.test.ts` | 200,265,314,323 | A/I | Sim | Fixture antiga | Adicionar novo formato sem remover histórico. |
| `lib/contador/pacote/correcoes-008d.test.ts` | 47,57,316,322,351,353 | A/I | Sim | Fixture antiga | Cobrir join técnico e fallback legado. |
| `lib/contador/pacote/pacote.test.ts` | 62,74,86,178,180,185 | A/I | Sim | Fixture antiga | Cobrir relatório misto. |
| `lib/contador/pacote/zip.test.ts` | 44,48 | A/I | Sim | Baixo | Atualizar fixture se necessário. |
| `lib/fiscal/dry-run/dry-run-fixtures.ts` | 93 | G/I | Sim | Baixo | Preservar cenário histórico e acrescentar novo. |
| `lib/fiscal/dry-run/dry-run-gate-fixtures.ts` | 103 | G/I | Sim | Baixo | Preservar cenário histórico e acrescentar novo. |
| `lib/fiscal/emission/emission.test.ts` | 97 | G/I | Sim | Baixo | Confirmar número comercial opaco. |
| `lib/fiscal/provider/provider.test.ts` | 74 | G/I | Sim | Baixo | Confirmar número comercial opaco. |
| `lib/fiscal/queue/queue-producer.test.ts` | 9,26,102,127,152,171 | G/I | Sim | Contrato de entrada | Testar lookup comercial novo e dedupe por técnico. |
| `lib/fiscal/signing/dry-sign-from-vault.test.ts` | 49 | G/I | Sim | Baixo | Fixture somente. |
| `lib/fiscal/signing/nfce-signer.test.ts` | 60 | G/I | Sim | Baixo | Fixture somente. |
| `lib/fiscal/venda-fiscal-snapshot.test.ts` | 79 | G/I | Sim | Baixo | Cobrir novo formato no snapshot. |
| `lib/fiscal/venda-fiscal-snapshot-hash.test.ts` | 85,239,252 | G/I | Sim | Hash muda com snapshot | Fixar casos antigo/novo. |
| `lib/fiscal/venda-fiscal-snapshot-runtime.test.ts` | 129,150,170,192,216,233,251,276,301,326,347,365,393,419,437,463,475,542,561 | G/I | Sim | Muitos fixtures legados | Manter regressões e adicionar lookup novo. |
| `lib/fiscal/venda-fiscal-snapshot-service.test.ts` | 57 | G/I | Sim | Baixo | Confirmar uso de id técnico. |
| `lib/fiscal/venda-fiscal-snapshot-tax.test.ts` | 65 | G/I | Sim | Baixo | Fixture somente. |
| `lib/fiscal/xml/nfce-xml-builder.test.ts` | 70 | G/I | Sim | Baixo | Cobrir texto com prefixo. |
| `lib/operations-sales-merge.test.ts` | 28,29,35,36,43,44,52,58,69,71,72,75,79,80,95,102,108,110,118,119,127,128,130,136 | H/I | Não na separação | Alto | Reescrever merge por `clientSaleId`/id técnico. |
| `lib/ops-upsert-venda.test.ts` | 51 | D/F/I | Não na separação | Alto | Matriz concorrente com constraints reais. |
| `lib/ops-upsert-venda-accessory-selection.test.ts` | 45 | D/I | Não na separação | Médio | Enviar `clientSaleId`, verificar replay. |
| `lib/ops-upsert-venda-aprazo.test.ts` | 31 | D/E/I | Não na separação | Alto | Testar título uma vez por venda técnica/parcela. |
| `lib/ops-upsert-venda-caixa-original-fechado.test.ts` | 4,47,48,51,57,92,95,107 | D/E/I | Não na separação | Alto | Retry gerencial deve conservar chave e número. |
| `lib/ops-upsert-venda-colisao-loja.test.ts` | 4,5,10,12,15,31,39,41,61,62,65,75,77,167,171,173,189,201,202,207,211,218,221,232,247,277,291,307,323,340,361 | D/H/I | Não | Crítico | Substituir foco por concorrência real e legado em quarentena. |
| `lib/ops-upsert-venda-pix-aprazo-resync.test.ts` | 19,41,56,57,60,63,135,138,151,177,183,196 | D/E/F/I | Não na separação | Alto | Reenvio deve retornar a mesma venda/número. |
| `lib/ops-upsert-venda-safety.test.ts` | 68 | D/E/F/I | Não na separação | Alto | Preservar gates dentro da transação v2. |
| `lib/ops-upsert-venda-vale.test.ts` | 39 | D/E/I | Não | Crítico: falta replay de vale | Adicionar caso que prova um único débito por venda/crédito. |
| `lib/purchase-planning.test.ts` | 16,37 | A/I | Sim | Baixo | Fixture mista. |
| `lib/vendas/correcao-parcelamento-plan.test.ts` | 20,23,29,37,41,48,55,61,67,73,74,78 | D/E/I | Sim no legado | Médio | Testar adapter histórico e chave técnica nova. |
| `lib/vendas/sale-from-db-row.test.ts` | 17,33,66,84,87,88,96,98,104 | A/H/I | Não na separação | Alto | Cobrir shape v2, legado e reconciliação. |
| `tools/fiscal-dry-run-integrity-proof/fixtures.ts` | 68,84 | G/I | Sim | Baixo | Já listado no runtime de ferramenta; manter fixture mista. |

### 5.3 Documentação versionada — matches literais

Esses arquivos não executam lógica, mas perpetuam o contrato antigo e deverão ser
atualizados somente no GOAL de implementação correspondente.

| arquivo | linha | tipo_de_dependencia | aceita_formato_novo | risco | ajuste_necessario |
|---|---|---|---|---|---|
| `docs/ai/CLIENTES_HUB_GOAL_REPORT.md` | 115,174 | A/J | Sim | Baixo | Registrar novo contrato quando ativo. |
| `docs/ai/CURRENT_STATUS.md` | 1915,1929,2065,2178,2551,2572,2574,2652,2664,2711,2883,2890 | D/H/J | Parcial | Alto como memória operacional | Atualizar após cada fase, sem apagar histórico. |
| `docs/ai/ESTOQUE_PDV_GOAL_REPORT.md` | 31,46,109,128,264 | D/F/J | Parcial | Médio | Documentar chave técnica/constraint nova. |
| `docs/ai/FINANCEIRO_CAIXA_GOAL_REPORT.md` | 37,41,103,105,272 | D/E/J | Parcial | Médio | Documentar vínculo técnico/idempotencyKey. |
| `docs/ai/OPERACOES_HUB_GOAL_REPORT.md` | 62 | A/J | Sim | Baixo | Atualização terminológica. |
| `docs/ai/PDV_CAIXA_GOAL_REPORT.md` | 34 | A/J | Sim | Baixo | Atualização terminológica. |
| `docs/ai/PDV_ITEM_AVULSO_INSERT_GOAL_REPORT.md` | 186,189 | A/J | Sim | Baixo | Atualização terminológica. |
| `docs/ai/PDV_MULTI_TERMINAIS_ARCHITECTURE_PLAN.md` | 471 | H/J | Parcial | Médio | Registrar que terminal não participa da sequência. |
| `docs/ai/VENDAS_HUB_CORRECAO_OPERACIONAL_REPORT.md` | 56 | A/J | Sim | Baixo | Exemplo de formato misto. |
| `docs/architecture/estoque/BL07_FASE0_ARQUITETURA.md` | 117,429 | D/F/J | Parcial | Médio | Substituir guard lógico pela constraint planejada. |
| `docs/auditoria/COMPRAS_FORNECEDORES_PLANO_TECNICO.md` | 317 | J | Sim | Baixo | Não confundir pedido de compra com venda. |
| `docs/audits/AUDITORIA_WORKSPACE_CORRECAO_VENDA_v01.md` | 69,76,193,265,270,372 | D/E/F/J | Parcial | Médio | Registrar resolução comercial -> técnica. |
| `docs/fiscal/FISCAL_SNAPSHOT_RUNTIME_INTEGRATION_005.md` | 55,80 | A/G/J | Sim | Baixo | Explicitar que snapshot usa id técnico. |
| `docs/modules/reports/FINANCEIRO_ANALISE_MASTER.md` | 222 | E/J | Parcial | Médio | Atualizar contrato da venda. |
| `docs/modules/reports/FINANCEIRO_CONTRACTS_STATUS_BASE.md` | 94,98,111 | D/E/J | Parcial | Médio | Versionar localKeys novas sem quebrar parser antigo. |
| `docs/modules/reports/FINANCEIRO_V2_REAL_CHECKIN.md` | 89,219 | D/E/J | Parcial | Médio | Atualizar constraints e auditoria. |
| `docs/modules/reports/OPERACOES_HUB_V2_FATURAMENTO_CHECKIN.md` | 139 | D/J | Parcial | Médio | Remover premissa de `pedidoId` como chave técnica. |

### 5.4 Dependências implícitas fora da busca literal

| arquivo | linha | tipo_de_dependencia | aceita_formato_novo | risco | ajuste_necessario |
|---|---|---|---|---|---|
| `app/api/ops/sync-legacy-vendas/route.ts` | 4,45,52-57 | D/H/J | Não na separação | Alto | Congelar como adapter v1; impedir novas vendas após cutover. |
| `lib/operations-sale-types.ts` | 52-86 | D/H | Não | Crítico | Separar `clientSaleId`, `pedidoId?` e `serverId?`. |
| `lib/operations-sales-merge.ts` | 20-46 | D/H | Não | Crítico | Identidade de merge por `clientSaleId`/server id, nunca por número previsto. |
| `lib/pdv-append-conta-receber.ts` | 13-88 | D/E/H | Sintaticamente sim | Alto | Executar após ACK ou usar id técnico; manter cache legado. |
| `lib/pdv-print-runtime.ts` | 123 | A | Sim | Médio | Não imprimir número definitivo antes do ACK. |
| `lib/pdv-hold.ts` | 76-77 | D/H | Não na separação | Médio | Dedupe de espera por chave local própria, não comercial. |
| `components/dashboard/vendas/venda-espera-modal.tsx` | 77,121 | D/H | Não na separação | Médio | Operar pela chave de espera/clientSaleId. |
| `components/dashboard/vendas/pdv-classic.tsx` | 1942,1952,1983,1992 | A/D/E/H | Não no fluxo síncrono | Alto | Tornar finalização assíncrona e reconciliar resposta. |
| `components/dashboard/vendas/pdv-supermercado.tsx` | 1450,1455,1470,1490 | A/D/E/H | Não no fluxo síncrono | Alto | Tornar finalização assíncrona e reconciliar resposta. |
| `components/dashboard/vendas/pdv-assistencia-enterprise.tsx` | 1926,1931,1946,1977 | A/D/E/H | Não no fluxo síncrono | Alto | Tornar finalização assíncrona e reconciliar resposta. |
| `components/dashboard/vendas/vendas-arquivo-geral.tsx` | 265-285,484-557,728,772,796,819,864 | A/D/H | Não na separação | Alto | Distinguir pendente local de venda confirmada; lookup por client key. |
| `lib/dashboard-360-compute.ts` | 400-406 | A | Sim | Baixo | Exibir `pedidoId ?? referência provisória`. |
| `lib/contador-aggregates.ts` | 86-90 | A | Sim | Baixo | Referência comercial; vínculo interno técnico. |
| `components/dashboard/caixa/conferencia-caixa.tsx` | 94-106 | A/H/J | Sim no formato | Médio | Fallback legado; shape v2 explícito. |

Os arquivos `pdv-venda-completa-enterprise.tsx`,
`venda-completa-enterprise.tsx` e `trocas-devolucao.tsx` já aparecem na matriz
literal, mas também têm dependências implícitas adicionais de `result.saleId` e
`sale.id` para cupom, auditoria, fila de produto, devolução e nova venda. Isso não
altera a contagem de arquivos únicos.

## 6. Idempotência atual

### 6.1 O que ocorre no reenvio

| Entidade/efeito | Mecanismo atual | Mesmo payload, envio sequencial | Limite |
|---|---|---|---|
| `Venda` | `upsert` por `pedidoId @unique` | Uma linha, mas campos são regravados | Não distingue replay de nova venda |
| `ItemVenda` | `deleteMany` + recriação | Não acumula linhas | Pode substituir os itens de outra venda lógica |
| Estoque | `findFirst(storeId, documento=pedidoId, produtoId, origem=pdv)` | Em geral não baixa duas vezes | Não há unique; check-then-create |
| Financeiro à vista | `findFirst(storeId, referenciaId=pedidoId, origem=venda, tipo=entrada)` | Em geral não lança duas vezes | Não há unique; valor anterior não é validado |
| Contas a Receber | `upsert` por `(storeId, localKey)` | Proteção forte contra duplicação | Retry diferente pode sobrescrever valor/payload |
| Crédito/vale | criação de `UsoCreditoCliente` para cada débito | **Pode debitar novamente** | Sem guard, unique ou hash da venda |
| Fiscal | `Venda.id`, `NotaFiscal.localKey`, dedupe de job | Converge corretamente | Entrada externa ainda começa por `pedidoId` |

O comportamento “idempotente” atual só é seguro quando se assume, sem prova, que o
mesmo `pedidoId` significa a mesma venda e que o payload não mudou. Essa premissa é
falsa em ambiente concorrente.

### 6.2 Mesmo `pedidoId`, payload diferente

Na mesma loja, o guard de colisão não dispara. O reenvio:

- atualiza total, data, cliente, operador, terminal e payload;
- apaga e recria `ItemVenda`;
- preserva movimentos antigos de produtos que continuam cobertos pelo guard;
- pode baixar produtos novos que não constavam da primeira versão;
- preserva a entrada financeira antiga, mesmo que o novo total seja diferente;
- pode alterar títulos a prazo existentes;
- pode debitar vale outra vez.

O resultado pode ser uma linha de `Venda` com itens novos, ledger antigo, caixa antigo,
título alterado e crédito debitado duas vezes. Portanto, `pedidoId` **não pode
continuar simultaneamente como número visível e chave de idempotência**.

### 6.3 Contrato recomendado

| Campo | Autor | Mutabilidade | Função |
|---|---|---|---|
| `Venda.id` | Servidor/Prisma | Imutável | PK e FK técnica |
| `clientSaleId` | Cliente uma única vez; serviços internos usam chave determinística | Imutável | Idempotência da venda lógica, escopada por loja |
| `idempotencyHash` | Servidor | Imutável | Detecta reutilização da chave com fatos diferentes |
| `pedidoId` | Servidor | Imutável após commit | Número comercial definitivo |
| `terminalId` | Cliente validado pelo servidor | Imutável para a venda | Auditoria; não participa do contador |

`clientSaleId` é um valor opaco de até 128 caracteres:

- navegador: `crypto.randomUUID()` antes de qualquer tentativa;
- faturamento de O.S.: chave determinística versionada, por exemplo
  `os:{osId}:faturamento:v1`, escopada por loja;
- nunca deve ser regenerado por retry, refresh, troca de aba ou timeout.

A criação da venda não precisa de um quarto identificador persistido:
`clientSaleId` é também o valor do header `Idempotency-Key`. `localSaleId` pode ser
um alias transitório no adapter de UI, mas não deve criar outra identidade. Já os
efeitos downstream possuem `idempotencyKey` próprias derivadas de `Venda.id`, porque
uma venda gera vários efeitos.

A unique recomendada é `(storeId, clientSaleId)`. O hash é calculado de uma
representação canônica dos fatos da venda: horário de ocorrência, sessão, terminal,
cliente referenciado, linhas saneadas, totais, pagamentos, descontos e vínculo de
O.S. Excluem-se campos de transporte/controle como `syncPending`,
`syncBlockedCode`, `allowClosedOriginalSession`, número comercial e operador
resolvido da sessão.

Regras:

1. chave ausente em venda v2: `400 CLIENT_SALE_ID_REQUIRED`;
2. chave existente e mesmo hash: `200`, retorna a venda existente com
   `replayed: true`;
3. chave existente e hash diferente: `409 IDEMPOTENCY_KEY_REUSED`;
4. validação que falha antes do commit não consome a chave nem o número;
5. venda confirmada nunca recebe outro número, mesmo se o cliente repetir a chamada
   indefinidamente.

### 6.4 Recuperação após resposta perdida

| Situação | Recuperação segura |
|---|---|
| Commit ocorreu, resposta HTTP não chegou | Retry com o mesmo `clientSaleId`; servidor devolve a mesma `Venda`/`pedidoId`. |
| Timeout ocorreu antes do commit | Retry com a mesma chave cria uma única venda; não há número consumido. |
| Aba fechou | A chave e o payload devem ter sido gravados localmente **antes** do POST; na reabertura, o outbox reenvia. |
| Várias abas | Todas podem reenviar a mesma chave; a unique no servidor faz convergir. Um líder local reduz ruído. |
| Operador troca de navegador, mas conhece a chave | `GET /api/ops/vendas/by-client-sale-id/{clientSaleId}` ou novo POST idempotente recupera. |
| Operador troca de navegador sem a chave | Não é possível reconstruir uma tentativa local de modo confiável. Se o commit ocorreu, a venda aparece no histórico; se não ocorreu, exige exportação/transferência do outbox ou recuperação gerencial. Nunca criar outra chave por suposição. |

O servidor deve oferecer lookup escopado pela loja e autorizado. A resposta não deve
revelar se a mesma chave existe em outra loja.

## 7. Concorrência multi-loja e multi-terminal

Abaixo, “unique de tentativa” significa `@@unique([storeId, clientSaleId])`;
“unique de número” significa `pedidoId @unique` mais
`@@unique([serieVendaId, numeroSequencial])`.

| # | Cenário | Comportamento esperado | Proteção/constraint | Transação | Lacuna | Duplicação/deadlock | Recuperação |
|---:|---|---|---|---|---|---|---|
| 1 | Loja 1 PDV1 e PDV2 simultâneos, chaves distintas | Recebem `n` e `n+1` na ordem de lock/commit | Linha `SerieVenda(loja,ano)` + uniques | Uma por venda, incremento junto dos efeitos | Não em rollback | Sem duplicação; contenção curta no contador | Retry transitório preserva a chave |
| 2 | Loja 1 e Loja 2 simultâneas | Contadores independentes; ambos podem usar sequência 1 com prefixos diferentes | Unique de código da loja e linhas de série distintas | Transações independentes | Não | Sem lock compartilhado | Retry isolado por loja |
| 3 | Dois navegadores enviam o mesmo `clientSaleId` e mesmo hash | Uma venda; ambos recebem o mesmo número | Unique de tentativa | Vencedor comita; perdedor resolve P2002 como replay | Não | Sem duplicação; espera curta | Buscar vencedor e responder 200 |
| 4 | Mesmo `clientSaleId`, payloads diferentes | Um comita; outro recebe 409 | Unique + `idempotencyHash` | Nenhum efeito da requisição conflitante | Não adicional | Sem duplicação; não sobrescreve | Quarentena/ação explícita, nunca novo número |
| 5 | Duas requisições pedem próximo número na mesma loja | `UPDATE increment` serializa | Unique de série e número | Reserva dentro da transação | Não em rollback | Hotspot controlado; sem deadlock se ordem fixa | Retry P2034/P2028 com jitter |
| 6 | Falha após incrementar, antes do commit | Venda, efeitos e incremento revertem | Incremento transacional | Tudo na mesma transação | Não | Sem duplicação | Reenvio usa a mesma chave |
| 7 | Commit concluído, número não chega ao cliente | Número permanece atribuído | Unique de tentativa | Já concluída | Não | Risco zero de segunda venda | Retry/lookup retorna a mesma venda |
| 8 | Reenvio após timeout | Replay ou criação única, conforme commit anterior | Unique + hash | Nova transação curta | Não | Sem duplicação | Resposta contém `replayed` |
| 9 | Venda offline enviada dias depois | Número usa ano/data de aceitação no servidor; `occurredAt` preserva o momento original | Ano derivado de relógio do servidor | Transação no dia do sync | Não por atraso | Sem duplicação; ordem comercial é de aceite, não cronológica | UI mostra ocorrência e numeração separadas |
| 10 | Virada de ano durante a venda | Uma única data efetiva, obtida no início da transação; série do ano correspondente | Unique `(storeId, ano)` | Timestamp transacional | Não | Corrida de criação da série tratada por upsert | Releitura e retry limitado da série |
| 11 | Loja renomeada ou desativada | Números antigos não mudam; prefixo não deriva do nome | Código de numeração write-once; prefixo snapshot | Desativação não altera venda | Não | Sem duplicação | Reativação mantém código; mudança exige GOAL administrado |
| 12 | Terminal removido | Vendas e sequência permanecem; `terminalId` histórico nullable/restrito conforme política | Terminal fora da chave de série | Nenhuma transação de renumeração | Não | Nenhum impacto | Exibir snapshot/código histórico |
| 13 | Auto-retry em várias abas | Requisições convergem para uma venda | Unique de tentativa; `BroadcastChannel`/`navigator.locks` são otimização | Servidor continua autoritativo | Não | Sem duplicação; carga repetida limitada | Backoff persistido e líder local |
| 14 | Estoque acaba entre validação e baixa | Uma venda vence; outra falha integralmente | `UPDATE ... stock >= qty`; ordem de produto estável | Baixa e número na mesma transação | Não, pois rollback do contador | Sem estoque negativo; baixo risco de deadlock | Corrigir estoque/carrinho e reenviar mesma chave |
| 15 | Prefixo ausente ou loja não autorizada | Falha antes da alocação; nunca usa `loja-1` | Store explícita + configuração obrigatória | Nenhum write | Não | Sem duplicação | `SALE_NUMBERING_NOT_CONFIGURED`/403 |
| 16 | `P2002` no `pedidoId` ou número, sem vencedor pela client key | Invariante quebrada; falha fechada | Duas uniques de número | Rollback integral | Não nessa tentativa | Não duplica; retry cego repetiria o erro | Alerta e reparo técnico; não pular silenciosamente |
| 17 | Cliente v1 envia `VDA` que já pertence a outra loja | Guard legado mantém 409/quarentena | `pedidoId @unique` + adapter v1 | Nenhum efeito | Não | Não duplica | Recuperação administrada futura |
| 18 | Cliente cai após gravar localmente e antes de enviar | Outbox permanece sem número comercial | Persistência local por `clientSaleId` | Nenhuma no servidor ainda | Não | Sem duplicação | Próxima abertura envia a mesma chave |

### 7.1 Ordem de locks e deadlock

A linha de série por loja serializa a seção crítica das vendas daquela loja. Para
reduzir tempo de lock:

- autenticação, validação de shape, canonicalização/hash e resolução de configuração
  ocorrem antes da transação;
- consultas de negócio sem efeito podem preceder o incremento;
- dentro da transação, produtos são processados em ordem estável de `Produto.id`;
- créditos são consumidos em ordem estável `(createdAt, id)`;
- nenhuma chamada de rede, impressão ou emissão fiscal ocorre dentro da transação;
- retries de `P2034`/`P2028` são limitados (por exemplo, 3 tentativas com jitter).

O contador é um hotspot por loja, não global. Para o volume típico de PDV isso é uma
troca aceitável pela ausência de lacunas em rollback e pela simplicidade verificável.
Se métricas futuras demonstrarem saturação, a estratégia pode ser reavaliada sem
mudar o contrato de idempotência.

## 8. Comparação das alternativas

Escala: 1 = desfavorável, 5 = favorável. Em “complexidade”, 5 significa mais simples;
em “risco de migration”, 5 significa menor risco.

| Critério | A — global | B — por loja + prefixo | C — por loja sem prefixo | D — identidades separadas |
|---|---:|---:|---:|---:|
| Segurança | 4 | 5 | 3 | 5 |
| Simplicidade | 4 | 4 | 3 | 2 |
| Baixo risco de migration | 4 | 4 | 2 | 3 |
| Baixo impacto em código | 4 | 4 | 2 | 2 |
| Compatibilidade histórica | 5 | 5 | 2 | 4 |
| Concorrência | 2 | 5 | 5 | 5 |
| Idempotência | 2 | 2 | 2 | 5 |
| Legibilidade operacional | 3 | 5 | 3 | 5 |
| Impacto fiscal favorável | 4 | 5 | 3 | 5 |
| Impacto financeiro favorável | 3 | 4 | 2 | 5 |
| Recuperação | 2 | 3 | 2 | 5 |
| Rollback | 4 | 4 | 2 | 3 |

### 8.1 Alternativa A — sequência global

Exemplo: `VDA-2026-000521`.

Vantagens:

- preserva quase integralmente o formato e a unique global;
- um único contador elimina colisões de texto;
- rollout relativamente curto.

Desvantagens:

- todas as lojas disputam a mesma linha;
- a loja não consegue interpretar sua própria sequência;
- uma loja afeta a numeração e disponibilidade de todas;
- não resolve a sobrecarga semântica de `pedidoId` como idempotency key;
- recuperação de timeout continua frágil sem `clientSaleId`.

É um patch server-side possível, mas não o desenho definitivo.

### 8.2 Alternativa B — sequência por loja com prefixo

Exemplo: `VDA-L001-2026-000521`.

Vantagens:

- contenção isolada por loja;
- `pedidoId` permanece globalmente único;
- rotas antigas que recebem somente `pedidoId` continuam não ambíguas;
- leitura operacional mostra a unidade emissora;
- histórico antigo continua sendo uma string válida.

Desvantagens:

- exige um código estável, configurado e não derivado do nome;
- parsers locais precisam ser removidos;
- sozinha, não resolve idempotência.

É o escopo de numeração recomendado.

### 8.3 Alternativa C — número por loja sem prefixo e unique composta

Exemplo: `VDA-2026-000506`, com `@@unique([storeId, pedidoId])`.

Vantagens:

- sequência local limpa;
- contenção isolada.

Desvantagens:

- quebra a premissa atual de unicidade global;
- toda URL, lookup, importador, fiscal, correção, cancelamento e integração deve passar
  `storeId` corretamente;
- dados históricos e payloads externos que contêm apenas `pedidoId` ficam ambíguos;
- o risco de IDOR e de relação cruzada aumenta;
- rollback é difícil após dois documentos iguais existirem.

Não recomendada para a base atual.

### 8.4 Alternativa D — chave técnica, chave de tentativa e número separados

Vantagens:

- define idempotência independentemente do número visível;
- resolve resposta perdida, retry, várias abas e payload divergente;
- permite relações reais com `Venda.id`;
- o número comercial pode evoluir sem mudar a identidade.

Desvantagens:

- exige atualizar o shape local e os consumidores síncronos;
- requer rollout aditivo e compatibilidade dupla.

D é uma separação de responsabilidades, não uma política concorrente à B. Por isso a
decisão é **D + B**: D para identidade/idempotência e B para numeração comercial.

## 9. Arquitetura recomendada

### 9.1 Invariantes

1. Nenhum cliente v2 escolhe `pedidoId`.
2. Toda venda nova tem `clientSaleId` persistido antes da primeira requisição.
3. Uma chave confirmada identifica exatamente um hash de payload e um `pedidoId`.
4. `pedidoId` é globalmente único e imutável.
5. O componente numérico é único dentro da série `(loja, ano)`.
6. `storeId` vem da sessão/ACL e da seleção explícita; body, cookie ou default não
   autorizam.
7. Loja sem código de numeração configurado falha fechada.
8. Nome da loja, terminal e navegador não participam da sequência.
9. Incremento, venda, itens, estoque, financeiro, vale e títulos comitam ou revertem
   juntos.
10. Número confirmado nunca é apagado, renumerado nem reutilizado por cancelamento.

### 9.2 Formato e políticas

| Aspecto | Decisão |
|---|---|
| Formato | `VDA-{CODIGO_LOJA}-{ANO}-{NNNNNN}` |
| Código da loja | 2–8 caracteres `A-Z0-9`, único, explícito e write-once após a primeira emissão |
| Fonte do código | Configuração dedicada; nunca `Store.name` |
| Ano | Ano civil de aceitação no servidor, timezone `America/Sao_Paulo` |
| Timestamp | Um timestamp transacional fixa o ano; `occurredAt` do cliente é guardado à parte |
| Padding | 6 dígitos; capacidade de 999.999 por loja/ano |
| Overflow | Falha fechada `SALE_SEQUENCE_EXHAUSTED`; nenhuma expansão silenciosa |
| Escopo | Uma série por `(storeId, ano)` na primeira versão |
| Terminal | Campo auditável, fora da chave e do prefixo |
| Loja desativada | Mantém número/código históricos; novas vendas bloqueadas pela regra de negócio |
| Loja renomeada | Nenhum efeito |

O código pode começar como `L001`/`L002`, mas a atribuição deve ser explícita e
auditada. Não se deve inferir automaticamente de `loja-1`, CNPJ ou nome durante o
deploy. Uma loja não entra no flag v2 enquanto o código não estiver configurado.

### 9.3 Política de lacunas

- falha de validação ou rollback não deixa lacuna porque o incremento é transacional;
- commit bem-sucedido seguido de timeout usa o número, e o retry o recupera;
- venda cancelada conserva o número;
- número confirmado nunca é reutilizado;
- reparo manual ou corrupção pode produzir lacuna, que deve ser auditada;
- não se promete sequência legalmente “sem lacunas”; promete-se não criar lacunas por
  falha ordinária da transação.

Essa política difere do fiscal, onde a reserva pode ser deliberadamente queimada.

### 9.4 Schema Prisma proposto — não aplicado

O trecho é um desenho para um próximo GOAL. Nomes finais e migration precisam de
revisão Prisma, mas as constraints são parte da recomendação.

```prisma
enum VendaNumeracaoOrigem {
  LEGACY_CLIENT
  SERVER_V1
  IMPORTED
}

model Store {
  // campos atuais...
  codigoNumeracaoVenda String? @unique @map("codigoNumeracaoVenda")
  seriesVenda          SerieVenda[]
}

model SerieVenda {
  id            String   @id @default(cuid())
  storeId       String   @map("storeId")
  store         Store    @relation(fields: [storeId], references: [id], onDelete: Restrict)
  ano           Int      @map("ano")
  prefixo       String   @map("prefixo") @db.VarChar(8)
  proximoNumero Int      @default(1) @map("proximoNumero")
  ativo         Boolean  @default(true) @map("ativo")
  createdAt     DateTime @default(now()) @map("createdAt")
  updatedAt     DateTime @updatedAt @map("updatedAt")
  vendas        Venda[]

  @@unique([storeId, ano])
  @@unique([prefixo, ano])
  @@unique([id, storeId])
  @@index([storeId, ativo])
  @@map("series_venda")
}

model Venda {
  id                     String                 @id @default(cuid())
  storeId                String                 @map("storeId") // sem default
  store                  Store                  @relation(fields: [storeId], references: [id], onDelete: Restrict)

  clientSaleId           String?                @map("clientSaleId") @db.VarChar(128)
  idempotencyHash        String?                @map("idempotencyHash") @db.Char(64)
  idempotencyHashVersion Int?                   @map("idempotencyHashVersion")

  pedidoId               String                 @unique @map("pedidoId")
  serieVendaId           String?                @map("serieVendaId")
  serieVenda             SerieVenda?            @relation(fields: [serieVendaId, storeId], references: [id, storeId], onDelete: Restrict)
  anoNumero              Int?                   @map("anoNumero")
  numeroSequencial       Int?                   @map("numeroSequencial")
  numeradaEm             DateTime?              @map("numeradaEm")
  numeracaoOrigem        VendaNumeracaoOrigem   @default(LEGACY_CLIENT) @map("numeracaoOrigem")

  // demais campos e relações atuais...

  @@unique([storeId, clientSaleId])
  @@unique([serieVendaId, numeroSequencial])
  @@index([storeId, anoNumero, numeroSequencial])
}
```

Como `clientSaleId`, `serieVendaId`, `anoNumero` e `numeroSequencial` começam
nullable, várias linhas históricas podem permanecer sem backfill. PostgreSQL permite
múltiplos `NULL` sob essas uniques. Vendas v2 passam a exigir os campos no serviço
antes de uma eventual fase futura de `NOT NULL`.

A FK composta da série impede no banco que uma `Venda` da Loja 2 aponte para o
contador da Loja 1. A migration futura deve validar a forma exata suportada pela
versão de Prisma do repositório antes de aplicar.

Além do schema Prisma, a migration futura deve considerar checks de banco:

- `proximoNumero BETWEEN 1 AND 1000000`;
- `numeroSequencial BETWEEN 1 AND 999999`;
- formato/case do prefixo;
- imutabilidade do código após emissão, imposta pelo serviço e auditada.

### 9.5 Hardening recomendado dos efeitos

Não é obrigatório concluir toda a migração de FKs no primeiro deploy, mas o desenho
definitivo deve convergir para:

| Modelo | Adição proposta | Constraint/idempotência |
|---|---|---|
| `MovimentacaoEstoque` | `vendaId String?` FK e/ou `idempotencyKey` | Unique por efeito de venda/produto/origem |
| `MovimentacaoFinanceira` | `vendaId String?` e `idempotencyKey` | Unique da entrada original da venda |
| `ContaReceberTitulo` | `vendaId String?`, `numeroParcela Int?` | Unique `(vendaId, numeroParcela)`; localKey antiga preservada |
| `UsoCreditoCliente` | `vendaTechnicalId String?` | Unique `(vendaTechnicalId, creditoId)` |
| `DevolucaoVenda` | `vendaId String?` FK | `vendaLocalId` continua para histórico |

Novas chaves devem derivar de `Venda.id`, por exemplo
`venda:{vendaId}:financeiro:entrada` e
`venda:{vendaId}:estoque:{produtoId}:saida`. Não se deve reescrever localKeys
históricas.

### 9.6 Incremento atômico

O adapter comercial replica o princípio do fiscal:

```ts
const updated = await tx.serieVenda.update({
  where: {
    id: serie.id,
    storeId,
    ano,
    ativo: true,
    proximoNumero: { gte: 1, lte: 999_999 },
  },
  data: { proximoNumero: { increment: 1 } },
  select: { id: true, prefixo: true, proximoNumero: true },
})

const numero = updated.proximoNumero - 1
const pedidoId = `VDA-${updated.prefixo}-${ano}-${String(numero).padStart(6, "0")}`
```

O `UPDATE` adquire lock na linha de `(storeId, ano)` e o mantém até o commit. A linha
do novo ano pode ser provisionada antes do réveillon e também obtida por upsert
idempotente no primeiro uso. A configuração do prefixo precisa existir antes dessa
operação.

### 9.7 Tratamento de conflitos

Após uma falha `P2002`, o servidor classifica o alvo:

1. existe `(storeId, clientSaleId)` com mesmo hash: vencedor concorrente; retornar
   replay;
2. existe com hash diferente: `409 IDEMPOTENCY_KEY_REUSED`;
3. conflito ao criar a linha anual: reler a série e repetir uma vez;
4. conflito em `pedidoId` ou `(serieVendaId, numeroSequencial)` sem vencedor da chave:
   invariante quebrada; rollback, alerta e
   `503 SALE_NUMBERING_INVARIANT_BROKEN`;
5. nunca executar loop de “pegar max + 1”;
6. nunca pular automaticamente um número em `P2002`, pois isso pode esconder prefixo
   duplicado ou contador mal inicializado.

`P2034`/`P2028` e erros de serialização/deadlock permitem retry da transação inteira,
limitado e sempre com o mesmo `clientSaleId`.

## 10. Contrato de API proposto

### 10.1 Criação v2

```http
POST /api/ops/vendas
Content-Type: application/json
x-assistec-loja-id: loja-2
Idempotency-Key: 6c4a5fa6-42ff-4f7d-a62e-3159be2f1568
```

```json
{
  "contractVersion": 2,
  "sale": {
    "clientSaleId": "6c4a5fa6-42ff-4f7d-a62e-3159be2f1568",
    "occurredAt": "2026-07-28T14:10:00.000Z",
    "sessaoId": "sessao-cuid",
    "terminalId": "terminal-cuid",
    "clienteId": "cliente-cuid",
    "customerName": "Cliente",
    "lines": [
      {
        "inventoryId": "produto-ou-sku",
        "quantity": 1,
        "unitPrice": 63.99
      }
    ],
    "total": 63.99,
    "paymentBreakdown": {
      "pix": 63.99
    }
  }
}
```

Regras do request:

- header e body devem conter a mesma chave, ou apenas o header é canônico e o body é
  validado contra ele;
- `pedidoId` não é aceito no contrato v2;
- `storeId` do body, se presente por compatibilidade, não autoriza e deve coincidir
  com a loja resolvida;
- número temporário opcional é apenas `provisionalRef`, nunca usado em unique, lookup
  ou efeito financeiro;
- o servidor saneia linhas antes de calcular o hash.

Primeira criação:

```http
HTTP/1.1 201 Created
```

```json
{
  "ok": true,
  "replayed": false,
  "venda": {
    "id": "cm...",
    "storeId": "loja-2",
    "clientSaleId": "6c4a5fa6-42ff-4f7d-a62e-3159be2f1568",
    "pedidoId": "VDA-L002-2026-000506",
    "occurredAt": "2026-07-28T14:10:00.000Z",
    "numberedAt": "2026-07-28T14:10:02.123Z",
    "status": "concluida"
  }
}
```

Replay:

```http
HTTP/1.1 200 OK
```

com a mesma estrutura e `"replayed": true`.

### 10.2 Lookup de recuperação

```http
GET /api/ops/vendas/by-client-sale-id/{clientSaleId}
x-assistec-loja-id: loja-2
```

Retorna 200 para a loja autorizada ou 404 genérico. Nunca informa que a chave pertence
a outra loja.

### 10.3 Erros

| HTTP | code | Classe | Retry automático |
|---:|---|---|---|
| 400 | `CLIENT_SALE_ID_REQUIRED`, `INVALID_SALE` | Permanente até corrigir payload | Não |
| 401 | `AUTH_REQUIRED` | Sessão | Só após reautenticar |
| 403 | `STORE_ACCESS_DENIED` | Permanente/permissão | Não |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Permanente/técnico | Não; quarentena |
| 409 | `CAIXA_FECHADO` | Exige operador | Não até abrir caixa |
| 409 | `CAIXA_ORIGINAL_FECHADO` | Exige gerente | Somente ação explícita |
| 409 | `ESTOQUE_INSUFICIENTE` | Exige correção operacional | Não |
| 409 | `PRODUTO_NAO_RESOLVIDO` | Catálogo/técnico | Não |
| 423/409 | `SALE_NUMBERING_NOT_CONFIGURED` | Configuração técnica | Não |
| 429 | `RATE_LIMITED` | Transitório | Sim, com `Retry-After` |
| 503 | `SALE_NUMBERING_INVARIANT_BROKEN` | Técnico | Não; alerta |
| 503/504 | `TRANSIENT_DATABASE_ERROR` | Transitório | Sim, backoff/jitter |

O adapter v1 mantém os códigos atuais, inclusive
`PEDIDO_ID_DE_OUTRA_LOJA`, durante a janela de compatibilidade.

## 11. Fluxo transacional definitivo

### 11.1 Antes da transação

1. Autenticar a sessão.
2. Resolver `storeId` explicitamente e verificar ACL/assinatura.
3. Recusar loja ausente; nenhuma função v2 usa `LEGACY_PRIMARY_STORE_ID`.
4. Validar versão do contrato e `clientSaleId`.
5. Normalizar pagamentos, datas e linhas; sanear acessórios.
6. Resolver a configuração de numeração da loja e verificar flag/código.
7. Calcular o hash canônico.
8. Fazer lookup rápido por `(storeId, clientSaleId)`:
   - igual: responder replay;
   - hash diferente: 409;
   - ausente: iniciar transação.

O lookup externo é uma otimização. A unique e o tratamento após `P2002` continuam
sendo a autoridade contra corrida.

### 11.2 Dentro da mesma transação

1. Repetir o lookup idempotente.
2. Validar a sessão de caixa da loja/terminal, incluindo o caminho gerencial
   retroativo.
3. Resolver cliente e produtos dentro da loja.
4. Validar totais, pagamentos, crédito e configuração a prazo.
5. Obter um timestamp transacional e derivar o ano em
   `America/Sao_Paulo`.
6. Obter/criar a `SerieVenda(storeId, ano)` configurada.
7. Incrementar `proximoNumero` atomicamente e construir `pedidoId`.
8. Criar `Venda` com `clientSaleId`, hash, série, número e origem.
   Essa criação ocorre **antes dos efeitos**; uma corrida da chave falha aqui e reverte
   também o incremento.
9. Criar `ItemVenda`.
10. Baixar produtos em ordem estável com `stock >= quantidade`.
11. Criar os ledgers de estoque com unique/idempotencyKey.
12. Criar a entrada financeira com unique/idempotencyKey.
13. Consumir créditos e criar `UsoCreditoCliente` com proteção por venda/crédito.
14. Criar títulos/parcelas com FK técnica e unique de parcela.
15. Vincular o primeiro título legado, quando ainda necessário.
16. Commit.

O incremento do contador, `Venda`, itens, estoque, financeiro, vale e títulos ficam na
**mesma transação**. Emissão fiscal, impressão, WhatsApp, analytics, eventos externos e
qualquer job pós-venda ficam fora; usam outbox/job idempotente após o commit.

### 11.3 Após a transação

1. Retornar `Venda.id`, `clientSaleId`, `pedidoId`, timestamps e `replayed`.
2. O cliente localiza o registro por `clientSaleId`; não troca a chave estável do
   array.
3. Preenche `serverId` e `pedidoId`, limpa `syncPending` e preserva o payload local
   necessário.
4. Só então habilita cupom definitivo, correção, cancelamento, devolução, fiscal e
   links por id.
5. Eventos externos recebem `Venda.id` como referência e `pedidoId` apenas para
   exibição.

## 12. Estado local, offline e auto-retry

### 12.0 Comportamento auditado hoje

- `syncPending` e `syncBlockedCode` vivem no `SaleRecord` salvo em `localStorage`;
- `flushPendingSales` reenvia todas as pendentes;
- o flush é acordado no ciclo automático de 30 segundos e pelos eventos
  `online`/`visibilitychange`, além do ciclo de montagem;
- 4xx cria apenas um hold de cinco minutos em `Map` na memória da aba;
- ao expirar o hold, o erro permanente volta a ser enviado;
- outra aba não conhece o hold e pode enviar imediatamente;
- `retrySyncSale` manual ignora o hold;
- `retrySyncSaleRetroactive` é separado e acrescenta autorização explícita para a
  sessão original fechada;
- sucesso limpa os marcadores; erro mantém a venda local;
- descarte e bulk discard consultam `/api/vendas/{saleId}` por número comercial.

O mecanismo preserva tentativas offline, mas não oferece uma chave independente do
número, eleição multiaba, backoff persistido ou quarentena contra descarte.

### 12.1 Shape local futuro

```ts
type LocalSaleRecord = {
  clientSaleId: string
  serverId?: string
  pedidoId?: string
  provisionalRef: string
  syncStatus: "pending" | "syncing" | "confirmed" | "blocked" | "quarantined"
  syncErrorCode?: string
  retryClass?: "transient" | "operator" | "manager" | "technical" | "permanent"
  nextAttemptAt?: string
  // fatos da venda...
}
```

`provisionalRef` pode ser a parte final do UUID e deve aparecer como “referência
local”, nunca como “Venda VDA”. `SaleRecord.id` não deve continuar carregando dois
significados. Durante a migração, um adapter pode expor `id = pedidoId` para registros
confirmados e `id = clientSaleId` somente em componentes explicitamente marcados como
legados, mas novos fluxos operam pelos campos nomeados.

### 12.2 Persistência e reconciliação

- gerar `clientSaleId` uma vez;
- gravar outbox e fatos em `localStorage`/storage transacional antes do fetch;
- não recalcular a chave ao editar estado de UI;
- resposta v2 reconcilia pelo `clientSaleId`;
- `mergeSalesById` vira merge por `serverId`, com fallback por `clientSaleId`; não por
  texto comercial;
- venda remota confirmada remove flags client-only;
- lista e histórico aceitam formato antigo e novo sem regex;
- imprimir um comprovante provisório offline só é permitido se estiver claramente
  marcado “PENDENTE — SEM NÚMERO COMERCIAL/FISCAL”; a opção conservadora é não imprimir
  até o ACK.

### 12.3 Coordenação entre abas

A correção obrigatória é server-side. Como otimização:

- `BroadcastChannel` anuncia que uma chave está em sync;
- `navigator.locks` elege uma aba para o outbox quando suportado;
- `syncStatus`, tentativa e `nextAttemptAt` ficam persistidos;
- backoff exponencial com jitter substitui o intervalo fixo agressivo;
- `online`/`visibilitychange` acordam apenas o líder;
- a unique do servidor continua protegendo mesmo se todos esses mecanismos falharem.

### 12.4 Classificação operacional

| Classe | Exemplos | Ação |
|---|---|---|
| Transitório | rede, 408, 429, 5xx, P2034/P2028 após retries internos | Auto-retry com backoff/jitter |
| Permanente de payload | chave reutilizada com hash diferente, payload inválido | Bloquear e colocar em quarentena |
| Exige operador | caixa fechado, estoque insuficiente após revisão do carrinho | Parar auto-retry; botão após correção |
| Exige gerente | sessão original fechada, autorização retroativa | Ação explícita e auditada |
| Exige recuperação técnica | `PEDIDO_ID_DE_OUTRA_LOJA`, sequência inconsistente/esgotada, importação ambígua | Quarentena; nenhuma tentativa automática |

`PEDIDO_ID_DE_OUTRA_LOJA` existe somente para pendências v1. Essas vendas podem ser
convertidas em um GOAL administrado futuro, após prova de ausência e com uma nova
chave de idempotência. A conversão nunca deve ser automática.

### 12.5 Descarte seguro

O futuro descarte:

1. consulta por `(storeId, clientSaleId)`, não por `pedidoId` previsto;
2. se existe, reconcilia;
3. se não existe e a classe é transitória, não descarta;
4. se está em quarentena técnica, proíbe descarte simples e bulk;
5. exige ação gerencial, motivo e exportação/snapshot recuperável para remover uma
   tentativa local sem commit;
6. nunca remove estoque/financeiro server-side como efeito de “limpar pendência”.

O 404 por `pedidoId` atual não é prova suficiente para apagar uma pendência com
`PEDIDO_ID_DE_OUTRA_LOJA`.

## 13. Compatibilidade histórica e APIs antigas

1. Nenhuma venda histórica é renumerada.
2. `VDA-2026-0001`, `VND-2026-00001`, `GC-*` e outros valores importados continuam
   válidos como strings comerciais.
3. `pedidoId @unique` permanece, evitando ambiguidade global.
4. `/api/vendas/[id]` continua resolvendo `(storeId, pedidoId)` para leitores e
   integrações antigas.
5. Novas rotas internas aceitam `Venda.id`; lookup por `clientSaleId` serve à
   reconciliação.
6. Busca usa `contains`, sem parser; recibos exibem string opaca.
7. Ordenação permanece por `at`; onde ordem documental for necessária, usa
   `(anoNumero, numeroSequencial)`, nunca ordenação lexicográfica mista.
8. `saleFromDbRow` aceita payload legado e shape v2, mas o row do banco é autoridade
   para `serverId`, `clientSaleId`, `pedidoId`, status e terminal.
9. localKeys antigas continuam legíveis pelos parsers atuais; novos efeitos usam
   `Venda.id`.
10. fiscal continua congelando o `pedidoId` visível no snapshot, enquanto relações,
    dedupe e jobs usam `Venda.id`.

### 13.1 Regra de clientes v1 no cutover

Compatibilidade dupla irrestrita é insegura: depois que uma loja entra no v2, um
cliente antigo ainda poderia criar um `VDA` local e voltar a colidir. A ativação por
loja exige:

- todos os terminais atualizados;
- outboxes v1 drenados ou classificados;
- versão mínima do cliente conhecida;
- endpoint v1 autorizado somente para retries controlados durante a janela;
- depois do cutover, novas criações v1 recebem
  `426 SALE_CLIENT_UPGRADE_REQUIRED`;
- recuperação de pendência v1 passa por endpoint/ação administrada, não pelo writer
  v2 normal.

O backend v2 deve chegar antes do frontend. O frontend novo pode permanecer com o flag
desligado. O flag só é ligado após código da loja, schema e métricas estarem prontos.

## 14. Rollout

### Fase 0 — guard P0 já publicado

- manter `3bcaf83` e o código `PEDIDO_ID_DE_OUTRA_LOJA`;
- não afrouxar `pedidoId @unique`;
- pendências bloqueadas permanecem em quarentena;
- não recuperar as cinco vendas neste trabalho.

Critério de saída: proteção atual preservada e monitorada.

### Fase 1 — schema e infraestrutura dormente

- adicionar código estável de numeração da loja;
- criar `SerieVenda`;
- adicionar campos nullable de idempotência/numeração em `Venda`;
- criar constraints e adapter de incremento;
- seed/configuração explícita de cada loja, sem habilitar emissão;
- testar concorrência contra PostgreSQL real de teste.

Critério de saída: infra dormente, nenhum writer produtivo usando-a.

### Fase 2 — API v2 sob feature flag

- criar serviço único de venda;
- contrato de `clientSaleId`/hash/replay;
- resposta autoritativa com `pedidoId`;
- endurecer o adapter v1: criar/resolver o vencedor sob constraint, sem
  `findUnique` seguido de upsert que possa atualizar outra loja na janela TOCTOU;
- integrar writer de O.S. ao mesmo serviço;
- manter v1 intacto e instrumentado;
- flag sugerida: `saleNumberingV2` por loja e kill switch global.

Critério de saída: API v2 testada, flag off em produção, readers compatíveis.

### Fase 3 — atualização dos PDVs

- migrar `SaleRecord`/outbox;
- tornar finalização assíncrona;
- atualizar PDV clássico, supermercado, assistência e enterprise;
- persistir chave antes do POST;
- não imprimir/compor Contas a Receber definitiva antes do ACK;
- coordenar várias abas.

Critério de saída: todos os terminais da loja reportam versão v2; pendências v1
inventariadas.

### Fase 4 — recibos, buscas, relatórios e satélites

- shape de listas/detalhes com três identidades;
- recibos e ESC/POS com string opaca;
- cancelamento/correção/devolução por id técnico;
- financeiro/estoque/CR com idempotency keys técnicas;
- fiscal e contador validados com histórico misto;
- exportações mantêm número comercial.

Critério de saída: matriz de regressão verde para formatos antigo e novo.

### Fase 5 — desativação de `nextSaleId`

- ativar v2 loja por loja;
- bloquear criação v1 nos clientes/lojas cortados;
- remover o gerador de `operations-store` e a predição da troca;
- impedir deploy de cliente antigo pelo version gate.

Critério de saída: métrica de novas vendas v1 igual a zero na loja.

### Fase 6 — pendências antigas

- classificar v1 por erro;
- drenar as comprovadamente seguras;
- manter `PEDIDO_ID_DE_OUTRA_LOJA` em quarentena;
- criar fluxo administrado separado, auditado e reversível;
- nenhum bulk discard por 404 de número.

Critério de saída: nenhuma pendência v1 desconhecida.

### Fase 7 — recuperação das cinco vendas comprovadas

GOAL independente, com autorização explícita, evidência e plano financeiro/estoque.
Não faz parte desta auditoria nem deve ser acoplado ao rollout de numeração.

### 14.1 Métricas, logs e alertas

Métricas propostas:

- `sales_numbering_requests_total{storeId,version,result}`;
- `sales_numbering_replays_total{storeId}`;
- `sales_idempotency_mismatch_total{storeId}`;
- `sales_numbering_allocation_duration_ms{storeId}`;
- `sales_numbering_transaction_retries_total{storeId,code}`;
- `sales_numbering_invariant_failures_total{storeId}`;
- `sales_v1_create_requests_total{storeId,clientVersion}`;
- idade/quantidade de outbox pendente por loja/terminal;
- quantidade de quarentenas por classe;
- `proximoNumero` e capacidade restante por loja/ano.

Logs estruturados:

- `storeId`, `terminalId`, versão do contrato;
- `clientSaleId` íntegro apenas onde política permitir, ou hash seguro para
  correlação;
- `Venda.id`, `pedidoId` após alocação;
- resultado `created/replayed/rejected`;
- tentativa transacional e código Prisma;
- nunca registrar payload completo, documento do cliente ou segredo.

Alertas:

- qualquer `SALE_NUMBERING_INVARIANT_BROKEN`;
- mismatch de idempotência acima de zero;
- cliente v1 após cutover;
- sequência próxima do limite;
- aumento de retries/deadlocks/latência;
- pendência/quarentena acima de idade definida;
- loja ativa sem configuração de numeração.

## 15. Rollback

### Antes de emitir a primeira venda v2 na loja

- desligar o flag;
- manter schema aditivo dormente;
- frontend continua no v1;
- nenhuma sequência é revertida ou excluída.

### Depois de existirem vendas v2

O rollback é “forward-compatible”:

1. pausar novas iniciações v2 se necessário;
2. manter o endpoint v2 disponível para replay/reconciliação das chaves já emitidas;
3. não reativar criação v1 irrestrita;
4. readers continuam aceitando novo formato;
5. não remover campos/constraints/tabelas;
6. não decrementar `proximoNumero`;
7. não renumerar nem apagar vendas;
8. se a segurança não puder ser garantida, falhar fechado e acumular outbox local.

Reverter o binário para uma versão que desconhece `clientSaleId` depois do cutover
pode duplicar vendas. Portanto, a unidade de rollback deve preservar o adapter v2 e o
version gate, mesmo que a UI de nova venda seja temporariamente desabilitada.

## 16. Matriz de testes necessária

Os testes puros continuam úteis, mas concorrência/unique/rollback exigem uma suíte de
integração com PostgreSQL. Fakes de `TransactionClient` não provam locks nem `P2002`.

| Caso | Nível | Resultado obrigatório |
|---|---|---|
| Duas lojas, primeira venda do ano | Integração | Ambas recebem sequência 1, prefixos distintos |
| Uma loja, três terminais simultâneos | Integração concorrente | Três números únicos e consecutivos |
| 50 vendas simultâneas na mesma loja | Carga/integração | Zero duplicatas; conjunto numérico completo |
| Mesma chave, mesmo payload, 20 chamadas | Integração concorrente | Uma venda/efeitos; todas retornam mesmo número |
| Mesma chave, payload diferente | Integração | Um commit; demais 409; nenhum overwrite |
| Timeout simulado após commit | Integração/API | Retry retorna replay e mesmo número |
| Timeout/erro antes do commit | Integração/API | Retry cria uma venda; contador sem lacuna |
| Falha após incremento e antes da venda | Integração | Rollback do contador |
| `P2034`/deadlock injetado | Integração | Retry limitado, mesma chave |
| `P2002` da client key | Integração | Recupera vencedor |
| `P2002` do número sem vencedor | Integração | Falha fechada/alerta; sem skip |
| Caixa fechado | Integração/API | Sem venda, número, estoque ou financeiro |
| Sessão original fechada sem flag | Integração | 409 gerencial; nenhuma alocação confirmada |
| Retry retroativo autorizado | Integração | Uma venda/número na sessão original |
| Estoque insuficiente | Integração | Rollback completo, stock não negativo |
| Dois caixas disputando último item | Integração concorrente | Uma venda; outra falha e não consome número |
| Produto não resolvido | Integração | Rollback completo |
| Pagamento imediato | Integração | Uma entrada financeira por `Venda.id` |
| Venda 100% a prazo | Integração | Sem entrada de caixa; parcelas únicas |
| Crédito-vale | Integração | Um débito por venda/crédito |
| Retry de crédito-vale | Integração | Saldo e `UsoCreditoCliente` não mudam duas vezes |
| Acessório válido/inválido | Unitário/integração | Saneamento preservado; hash canônico estável |
| Venda avulsa | Integração | Sem estoque; demais efeitos uma vez |
| Venda vinculada a O.S. | Integração | Chave determinística da O.S.; uma venda |
| Duas chamadas de faturamento da mesma O.S. | Concorrente | Mesmo número/venda |
| Troca com nova venda | E2E | Vínculo pela chave/id real, sem número previsto |
| Devolução | Integração | FK técnica e fallback histórico corretos |
| Cancelamento | Integração | Número preservado; estornos uma vez |
| Correção de itens/pagamento/parcela | Integração | Efeitos idempotentes e vínculo técnico |
| Fiscal | Integração | Snapshot mostra novo número; dedupe por `Venda.id` |
| Virada de ano no timezone oficial | Unitário/integração com clock | Séries distintas, sem ambiguidade |
| Lacuna por rollback | Integração | Nenhuma lacuna |
| Lacuna manual simulada | Unitário/integração | Não reutiliza; alerta/auditoria |
| Loja renomeada | Integração | Prefixo e histórico inalterados |
| Loja desativada | Integração | Leitura funciona; nova venda bloqueada |
| Terminal removido | Integração | Venda histórica legível; sequência intacta |
| Histórico `VDA-YYYY-NNNN` | API/E2E | Busca, detalhe, cupom e exportação funcionam |
| Histórico `VND-*`/`GC-*` | API/E2E | Continua legível sem parser |
| Busca por formato novo | API/E2E | Encontra por `contains` |
| Relatório misto | Integração/snapshot | Antigo e novo, ordenados por data/número estruturado |
| Importação com id repetido | Integração | Quarentena/falha; nenhuma venda viva sobrescrita |
| Isolamento por `storeId` | Segurança/integração | 403/404 sem vazamento |
| Loja ausente | API | 400; nenhum fallback |
| Storage key legada | Unitário/E2E | Pode ler histórico; não autoriza criação v2 em `loja-1` |
| Muitas abas/online/visibility | E2E | Um líder preferencial; servidor mantém uma venda |
| Reload/aba fechada antes do POST | E2E | Outbox conserva a mesma chave |
| Resposta perdida e outro navegador | E2E/manual | Histórico/lookup recupera se chave conhecida; sem duplicar |
| Feature flag off/on por loja | Integração/E2E | Comportamento isolado e observável |
| Front novo/backend antigo | Contract test | Front não ativa v2; erro explícito |
| Front antigo/backend pós-cutover | Contract test | 426 em nova criação; nenhum fallback v1 |

## 17. Riscos remanescentes e decisões

| Risco | Probabilidade/impacto | Mitigação |
|---|---|---|
| Lock do contador aumenta latência | Média/baixa no volume atual | Contador por loja, transação curta, métricas |
| Código de loja incorreto/duplicado | Baixa/crítica | Configuração explícita, uniques, flag só após validação |
| Deploy front/back dessíncrono | Média/alta | Backend primeiro, contract version, version gate |
| Pendências v1 confundidas com v2 | Alta/alta | Shapes/filas separados, quarentena, fase 6 |
| Retry com payload não canônico | Média/alta | Canonicalizador versionado e testes de hash |
| Relações lógicas antigas continuam frágeis | Alta/média | Migração gradual para `Venda.id` e constraints |
| Importadores contornam o serviço | Média/alta | Modo importação separado, revisão de writers |
| Writer de O.S. continua `count+1` | Média/alta | Integrá-lo antes do cutover |
| Vale duplicado antes do hardening | Média/crítica | Unique técnica e teste obrigatório |
| Cliente offline imprime número provisório como definitivo | Média/alta | UI/ESC-POS bloqueado ou marca d'água explícita |
| Ano de aceite difere da ocorrência offline | Esperada/operacional | Mostrar ambos os timestamps; política documentada |
| Rollback para cliente antigo | Baixa/crítica | Forward rollback e 426 no v1 |
| Mudança de prefixo após uso | Baixa/alta | Write-once; GOAL administrado excepcional |
| Sequência chega ao limite | Baixa/alta | Padding 6, gauge e alertas antecipados |

Decisões que não devem ser adiadas para a implementação:

- ano é o de aceitação server-side, não do relógio do cliente;
- `pedidoId` globalmente único permanece;
- prefixo não vem do nome;
- terminal não participa da sequência;
- uma transação inclui contador e efeitos;
- `P2002` de número é falha de invariante, não convite para `max + 1`;
- após cutover, cliente v1 não pode criar venda nova;
- nenhum fallback silencioso para `loja-1`.

## 18. Arquivos previstos para implementação

### Schema/infra

- `prisma/schema.prisma`;
- nova migration aditiva de `SerieVenda`, campos/constraints e configuração de loja;
- `lib/vendas/server-sale-numbering.ts` (novo);
- `lib/vendas/sale-idempotency.ts` (novo);
- adapters/ports e testes de integração PostgreSQL.

### Serviço e APIs

- `lib/ops-upsert-venda.ts` ou substituto v2;
- `app/api/ops/venda-persist/route.ts` como adapter v1;
- `app/api/ops/vendas/route.ts` (novo contrato v2);
- rota de lookup por `clientSaleId`;
- `app/api/ops/sync-legacy-vendas/route.ts`;
- `app/actions/operacoes.ts`;
- `app/actions/vendas-enterprise.ts`;
- importadores, com fluxo histórico separado.

### Cliente/outbox

- `lib/operations-sale-types.ts`;
- `lib/operations-store.tsx`;
- `lib/operations-sales-merge.ts`;
- `lib/vendas/sale-from-db-row.ts`;
- `lib/pdv-hold.ts`;
- componentes PDV clássico, supermercado, assistência e enterprise;
- `components/dashboard/vendas/trocas-devolucao.tsx`;
- `components/dashboard/vendas/vendas-arquivo-geral.tsx`.

### Consumidores

- recibos `lib/escpos.ts`, `lib/pdv-print-runtime.ts` e
  `components/dashboard/vendas/cupom-nao-fiscal.tsx`;
- `app/api/vendas/**`;
- caixa, financeiro, Contas a Receber, estoque, devoluções/correções;
- fiscal/contador/relatórios/exportações;
- testes e documentação listados no inventário.

Essa lista é previsão, não autorização para alterar todos os arquivos em um único
GOAL.

## 19. Divisão em GOALs implementáveis

| GOAL sugerido | Escopo | Condição de aceite |
|---|---|---|
| `002B-SCHEMA-INFRA` | Schema aditivo, `SerieVenda`, código da loja, adapter atômico dormente | Migration revisada, locks/uniques provados em PostgreSQL, flag off |
| `002C-IDEMPOTENCY-API` | Canonical hash, unique da tentativa, serviço transacional e API v2 | Concorrência/replay/timeout verdes; resposta autoritativa |
| `002D-OS-WRITER` | Migrar faturamento de O.S. e impedir `count+1` | Duas chamadas da mesma O.S. produzem uma venda |
| `002E-PDV-OUTBOX` | Shape local, `clientSaleId`, sync multiaba, quatro PDVs | Nenhum `nextSaleId` usado sob flag v2; ACK reconcilia |
| `002F-CONSUMIDORES` | Cupom, venda hub, caixa, CR, estoque, correções, devoluções, fiscal e relatórios | Matriz antiga/nova verde |
| `002G-HARDEN-EFFECTS` | FKs/idempotency keys técnicas em estoque, financeiro, CR e vale | Replays concorrentes não duplicam nenhum efeito |
| `002H-ROLLOUT` | Flags, version gate, métricas, alertas, cutover por loja | v1 bloqueado após drenagem, rollback exercitado |
| `002I-PENDENCIAS-LEGACY` | Fluxo administrado para quarentena v1 | Sem descarte acidental, trilha completa |
| `RECOVERY-5-VENDAS` | Recuperar apenas as cinco vendas comprovadas | GOAL independente e autorizado; fora de 002A |
| `DANOS-HISTORICOS-AUDIT` | Auditoria read-only de hipóteses históricas adicionais | Sem mistura com recuperação; fora de 002A |

Cada GOAL deve preservar o guard P0 até que o version gate torne impossível criar uma
nova venda v1 na loja.

## 20. Conclusão

O repositório já possui os dois ingredientes corretos, mas desconectados:

- `Venda.id` é uma chave técnica adequada;
- o fiscal demonstra incremento atômico, CAS, unique e retry controlado.

O PDV, contudo, ainda usa `pedidoId` para número, identidade local, idempotência,
financeiro, estoque, devolução e impressão. A solução definitiva não é apenas mover
`max + 1` para uma API: é estabelecer `clientSaleId` como identidade da tentativa,
alocar o número por loja/ano na mesma transação da venda e fazer os efeitos convergirem
por `Venda.id`.

A recomendação **D + B** preserva compatibilidade histórica e a unique global, isola
lojas, elimina o contador do navegador e permite recuperar timeouts sem emitir uma
segunda venda. O custo é um rollout aditivo e disciplinado, especialmente porque os
PDVs hoje consomem `saleId` sincronicamente antes da resposta.

**Banco não acessado. Nenhuma conexão com Neon foi necessária.**

Também não houve acesso à Vercel, Chrome, Edge ou produção; nenhuma venda foi
recuperada; nenhuma migration, alteração de schema, alteração de código ou modificação
de dados foi realizada por esta auditoria.
