# OPERAÇÃO DO CONTADOR HUB — runbook de produção (GOAL 019)

> Documento operacional. Descreve o que **existe hoje** e o que o operador deve fazer.
> Não antecipa funcionalidade e não cria fundamento legal novo: todo apoio jurídico
> abaixo é referência ao material já aprovado no projeto (auditoria 013, masterplan
> §21/§22, `docs/fiscal/FISCAL_XML_RETENTION_POLICY_001.md`).

- Trilha AEP: `contador` · GOAL `CONTADOR-HUB-PRODUCTION-HARDENING-019`
- Decisões humanas de referência: Rafael, 2026-08-20, publicadas em
  [`CONTADOR_HUB_PORTAL_EXTERNO_ROADMAP_014_019.md`](./CONTADOR_HUB_PORTAL_EXTERNO_ROADMAP_014_019.md)
- Estado nesta entrega: **retenção implementada e validada em dry-run**.
  Nenhum descarte real foi executado. `CONTADOR_RETENCAO_APPLY` **não está definida
  em nenhum ambiente**.

---

## 1. Políticas de retenção aprovadas

| Alvo | Política | Contador de tempo |
|---|---|---|
| Documento `FISCAL` | **Sem purga automática** (`PURGE_DISABLED`) | — |
| Documento `JURIDICO` | **Sem purga automática** (`PURGE_DISABLED`) | — |
| Documento `FOLHA` | **Sem purga automática** (`PURGE_DISABLED`) | — |
| Documento `FINANCEIRO` | **5 anos** | o mais recente entre fim da competência e `createdAt` |
| Documento `OUTRO` | **5 anos** | idem |
| Artefato ZIP de pacote de fechamento | **12 meses** | `ContadorPacote.geradoEm` |
| Blob de documento soft-deletado | **90 dias** | `ContadorDocumento.excluidoEm` |

Fonte única no código: `lib/contador/retencao/politica.ts`. Nenhum outro ponto do HUB
recalcula prazo.

### Detalhes que mudam a leitura do relatório

- **Bordas.** Janelas de idade (5 anos, 12 meses) são **exclusivas**: item exatamente
  na borda fica **protegido**. A janela de soft-delete é **inclusiva**, porque a
  decisão aprovada é literal — `excluidoEm + 90 dias <= agora`.
- **Calendário civil.** "5 anos" é a mesma data cinco anos antes, com clamp de fim de
  mês (29/02 → 28/02). Não é múltiplo de 365 dias, então anos bissextos não produzem
  deriva.
- **Referência conservadora.** Um documento de competência antiga anexado ontem **não**
  fica elegível: a referência é o **mais recente** entre fim da competência e
  `createdAt`. Na dúvida, o item permanece.
- **Soft-delete vale para todas as categorias — inclusive as `PURGE_DISABLED`.**
  Ler com atenção: um documento `FISCAL` **excluído por um humano com motivo** tem o
  blob elegível 90 dias depois. Isso não contradiz o "sem purga automática", que trata
  de **idade**; aqui houve ato humano explícito de exclusão. O registro, o motivo e o
  evento `documento_excluido` permanecem para sempre. Se essa consequência não for
  desejada para `FISCAL`, **decida antes de ligar o APPLY** (§5).

---

## 2. O job de retenção

### 2.1 Dry-run (padrão, seguro)

```bash
npx tsx scripts/contador/retencao-dry-run.ts --sintetico
```

Massa fictícia em memória — sem Prisma, sem storage, sem `.env`. É o comando para
aprender a ler o relatório e para verificar o comportamento em CI.

```bash
npx tsx scripts/contador/retencao-dry-run.ts
npx tsx scripts/contador/retencao-dry-run.ts --loja=loja-1
npx tsx scripts/contador/retencao-dry-run.ts --json
```

Contra dados reais, o dry-run só **lê**. Em dry-run a porta de escrita **nem é
construída**, então a execução não exige credencial de storage — se ela falhar por
credencial, algo está errado no comando, não no ambiente.

### 2.2 Como interpretar o relatório

```
alvo                  candidatos    bytes  protegidos  descartados  ja_ausentes  falhas
  documentos                  2  3200000          21            0            0       0
  blobs_soft_deletados        1  1200000           2            0            0       0
  pacotes                     1  3500000          11            0            0       0
```

| Coluna | Significado |
|---|---|
| `candidatos` | itens que a política selecionaria. Em dry-run é só isso: uma seleção. |
| `bytes` | soma dos bytes dos candidatos — liberação **estimada**, nunca confirmada. |
| `protegidos` | itens dentro da janela (ou de categoria sem purga). Deve ser alto. |
| `descartados` | blobs efetivamente removidos. **Sempre 0 em dry-run.** |
| `ja_ausentes` | blob que já não existia: idempotência, não erro. |
| `falhas` | erro isolado de leitura/storage/evento. Cada um aparece em `erros` com rótulo técnico curto. |

Cabeçalho `cortes vigentes`: `PURGE_DISABLED` significa que **não existe data de
corte** para aquela categoria — não é uma data muito antiga, é a ausência da data.

**Contagem de candidatos não diminui depois do apply — e isso é esperado.** Não há
coluna no schema marcando "blob já descartado" (o 019 é `SCHEMA_CHANGED=false`), então
o dry-run continua listando o item como candidato pela política. Quem distingue é o
apply: na segunda passada ele responde `descartados = 0` e `ja_ausentes = N`. Para
saber o que sobrou de verdade, compare `descartados` × `ja_ausentes` do apply, não a
contagem de candidatos do dry-run.

Sinais de que algo está errado:

- `descartados > 0` num relatório que deveria ser dry-run → pare e investigue;
- `candidatos` de `FISCAL`, `JURIDICO` ou `FOLHA` por idade → impossível pelo desenho;
  se aparecer, é bug e o APPLY **não** pode ser ligado;
- `falhas` alto e concentrado num alvo → provável indisponibilidade de storage;
  repita o dry-run antes de qualquer conclusão.

### 2.3 Como habilitar o APPLY

O modo apply exige **duas** condições independentes:

1. a flag de ambiente, com o valor exato:

   ```bash
   CONTADOR_RETENCAO_APPLY=on
   ```

2. a flag `--apply` no comando:

   ```bash
   CONTADOR_RETENCAO_APPLY=on npx tsx scripts/contador/retencao-dry-run.ts --apply --loja=loja-1
   ```

Sem a flag exata, o job **recusa** com `RetencaoApplyBloqueadoError`. Ele **não** cai
em dry-run silencioso: pedir apply e não receber nada seria a pior falha possível aqui.
`true`, `1`, `yes`, vazio e qualquer outro valor **não** destravam.

**Nesta entrega a flag não foi definida em nenhum ambiente.** Ligá-la é decisão humana,
depois do checklist da §5.

### 2.4 O que o apply faz — e o que ele nunca faz

Faz: remove o **blob** do storage e anexa **um** evento
(`documento_blob_descartado` / `pacote_artefato_descartado`) à trilha, com
`atorTipo="sistema"`, `atorId="sistema:retencao"`.

Nunca faz, e não tem como fazer — a porta de escrita não expõe o método:

- `DELETE` em `ContadorDocumento`, `ContadorPacote`, `ContadorPacoteItem`;
- `DELETE` ou `UPDATE` em `ContadorEvento` (a trilha é append-only);
- qualquer escrita em `ContadorCompetencia.snapshot`.

### 2.5 Idempotência

O marcador de "já descartado" é o **próprio storage**. Antes de remover, o job
pergunta se o blob existe:

- **existe** → remove + 1 evento;
- **não existe** → conta em `ja_ausentes`, **sem** evento e **sem** escrita.

Executar o apply duas vezes sobre a mesma massa é seguro: a segunda execução mostra
`descartados = 0` e `ja_ausentes = N`. Blob que nunca existiu recebe o mesmo
tratamento — não vira erro fatal.

### 2.6 Rollback operacional

O descarte de blob é **irreversível**: o objeto sai do storage. Não existe "desfazer".
O que existe:

- **antes de aplicar**: o dry-run é o rollback — ele mostra exatamente o conjunto que
  seria atingido, sem tocar em nada. Rode, leia, e só então decida;
- **durante**: remover a flag `CONTADOR_RETENCAO_APPLY` interrompe qualquer execução
  futura na hora. Uma execução já em curso termina o lote corrente;
- **depois**: o registro, os metadados (`bytes`, `sha256`, `categoria`, competência) e
  a trilha permanecem, então a auditoria continua possível — o que se perde é o
  conteúdo binário;
- **pacotes**: o ZIP descartado é **regenerável** (§3). Este é o único alvo com
  rollback real de conteúdo.

Por isso a ordem recomendada para o primeiro apply de verdade: `--loja=<uma loja>`,
começando pelo alvo de menor risco (pacotes), lendo o relatório entre cada passo.

---

## 3. Pacotes ZIP — 12 meses, com regeneração preservada

O artefato ZIP é **derivado**. O que sustenta a janela de 12 meses é que tudo o que o
reproduz continua no banco depois do descarte:

| Preservado | Onde |
|---|---|
| Competência (ano, mês, versão, status) | `ContadorCompetencia` |
| Snapshot congelado do fechamento | `ContadorCompetencia.snapshot` + `snapshotHash` |
| Versão e hash do manifesto | `ContadorPacote.versao`, `ContadorPacote.manifestoHash` |
| Manifesto item a item (caminho, bytes, sha256, fonte) | `ContadorPacoteItem` |
| Trilha de geração e download | `ContadorEvento` |

**O snapshot congelado nunca é alvo desta política.** Regenerar usa o fluxo já
existente: `GET /api/contador/pacote?c=AAAA-MM`, que monta o pacote sob demanda a
partir das mesmas fontes, sem persistir nada. O `manifestoHash` preservado permite
conferir a integridade do que for regenerado.

---

## 4. Soft delete — 90 dias

Documento excluído (soft) mantém a linha, `excluidoEm`, `excluidoPorId`,
`excluidoMotivo` e o evento `documento_excluido`. Passados 90 dias de `excluidoEm`, o
**blob** vira candidato. Antes disso está protegido. Vale para todas as categorias —
ver a ressalva da §1.

---

## 5. Antes de ligar o APPLY em produção — pendências abertas

Duas decisões humanas ainda **não** foram tomadas. Elas **não** bloqueiam a
implementação nem o dry-run, mas bloqueiam o apply real:

1. **Processo pendente em `FINANCEIRO` / `OUTRO`.** O roadmap registra o ponto em
   aberto: decidir se algum documento `FINANCEIRO` pode ser objeto de processo
   pendente antes de o job sair de dry-run para descarte real. Como `FISCAL` e
   `JURIDICO` ficaram **sem purga**, a regra de processo pendente do RICMS/SP art. 202
   (ver [`../fiscal/FISCAL_XML_RETENTION_POLICY_001.md`](../fiscal/FISCAL_XML_RETENTION_POLICY_001.md) §3)
   segue automaticamente satisfeita para eles — e por isso o 019 **não** precisou de
   marcador de processo pendente no schema. Para `FINANCEIRO`/`OUTRO` a pergunta
   continua aberta. O piso legal de 5 anos analisado naquele documento trata do XML da
   NFC-e (coluna Postgres), **não** do blob `ContadorDocumento`.
2. **Soft-delete de documento `FISCAL`.** Confirmar que descartar o blob 90 dias após
   uma exclusão humana explícita é aceitável também para `FISCAL` (§1).

---

## 6. Limites e quotas

Inventário fechado e auditável: `lib/contador/retencao/limites.ts`.
**Nenhum limite foi criado, elevado ou reduzido no GOAL 019.**

| Escopo | Limite | Valor | Fonte |
|---|---|---|---|
| arquivo | `documento.bytes_max` | 25 MB | `lib/contador/documentos/config.ts` |
| arquivo | `documento.upload_url_ttl` | 120 s | idem |
| arquivo | `documento.download_url_ttl` | 300 s | idem |
| categoria | `categoria.documentos_max` | **sem número canônico** | — |
| competência | `competencia.documentos_max` | **sem número canônico** | — |
| pacote | `pacote.registros_por_fonte_max` | 50 000 | `lib/contador/pacote/seguranca.ts` |
| pacote | `pacote.bytes_descompactados_max` | 25 MB | idem |
| pacote | `pacote.bytes_zip_max` | 10 MB | idem |
| pacote | `pacote.arquivos_max` | 15 | idem |
| pacote | `pacote.timeout_logico` | 30 000 ms | idem |

**"Sem número canônico" não é "ilimitado".** Não existe, no repositório, teto aceito
por categoria nem por competência, e o 019 **não inventou um**. O comportamento atual
foi preservado: todo arquivo continua limitado por `documento.bytes_max`, e o pacote da
competência recusa (413) acima de `pacote.registros_por_fonte_max` e de
`pacote.bytes_descompactados_max`. Nenhum caminho de upload ficou sem teto. Definir
quota por categoria/competência exige decisão humana e um GOAL próprio.

---

## 7. Portal legado — encerrado (gate G4)

Decisão G4 aprovada: **redirect**, não remoção. Nada foi apagado do repositório.

| Rota | Comportamento a partir do 019 |
|---|---|
| `/contador`, `/contador/**` | redirect 307 → `/contador-externo/login` |
| `/login-contador`, `/login-contador/**` | redirect 307 → `/contador-externo/login` |
| `POST /api/auth/contador` | **503** `portal_disabled` |
| `GET /api/auth/contador` | `{ authenticated: false, portalEnabled: false }` |
| `/contador-externo/**` (portal v2) | **inalterado** |
| `/dashboard/contador` (HUB interno) | **inalterado** |

Mecanismo: `CONTADOR_LEGACY_PORTAL` teve o **default invertido para `off`**. Só o valor
exato `on` reabre o legado.

Por que o alvo é `/contador-externo/login` e não `/contador-externo`: o login é a única
entrada do v2 que **não** depende de `CONTADOR_PORTAL_V2`. As páginas de dados do
portal respondem 404 com essa flag desligada; o login responde sempre e reencaminha
para `/contador-externo` quem já tem sessão válida. Assim o redirect funciona mesmo
antes de o rollout do v2 estar concluído.

**Atenção no rollout:** `CONTADOR_PORTAL_V2` é `off` por padrão e, no momento desta
entrega, não estava definida em Production. Com ela desligada o contador chega ao login
do v2 e consegue autenticar, mas as páginas de dados (`/contador-externo/lojas/**`)
respondem 404. Ligue `CONTADOR_PORTAL_V2=on` no mesmo movimento em que comunicar o
encerramento do legado.

### Rollback do G4

```bash
CONTADOR_LEGACY_PORTAL=on
```

Devolve exatamente o comportamento anterior ao 019, incluindo o gate de sessão HMAC
original em `proxy.ts` — que foi preservado intacto justamente para isso. Nenhum guard
foi afrouxado: com o kill-switch na posição padrão, o cookie
`assistec_contador_session` deixa de abrir qualquer porta.

---

## 8. LGPD

### 8.1 Minimização (decisão aprovada: manter a atual)

- **PII de cliente continua fora dos CSVs do pacote**, conforme o ajuste G2-05 da
  auditoria 013. Nenhuma inclusão de PII nesta fase.
- `storeId` só pode aparecer dentro de `manifest.json`; a guarda
  `assertPacoteSeguro` recusa o pacote se ele vazar para CSV, Markdown ou placeholder.
- Sentinelas proibidas em qualquer arquivo do pacote: `"payload"`, `"stack"`,
  `"sessionToken"`, `Authorization:`, `Bearer `.
- Eventos (`ContadorEvento.metadata`) trafegam apenas dados saneados por allowlist;
  atores são IDs técnicos, nunca nome ou e-mail.
- Logs estruturados nunca contêm conteúdo de documento nem URL assinada.

### 8.2 Bases legais

Sem fundamento novo. Valem as bases já documentadas no projeto: obrigação legal e
regulatória para a guarda de documentos contábeis e fiscais (masterplan §21, e o
recorte fiscal em `docs/fiscal/FISCAL_XML_RETENTION_POLICY_001.md`), e execução de
contrato para o acesso do contador ao portal. As janelas da §1 são a materialização do
ciclo de vida previsto em §21 ("retenção e descarte definidos por categoria").

### 8.3 Direitos do titular-contador

O titular aqui é o **contador** (pessoa física com identidade externa própria), não o
cliente final da loja.

| Direito | Como é atendido hoje |
|---|---|
| Acesso / confirmação | portal v2: o contador vê as lojas vinculadas e o próprio vínculo |
| Retificação | dados de conta são mantidos pela loja que emitiu o convite |
| Revogação de acesso | imediata: `tokenVersion++` derruba todas as sessões do usuário |
| Suspensão / reativação | `ContadorAcesso` por loja, com evento em cada transição |
| Oposição / eliminação | eliminação da conta não apaga a **trilha de auditoria**, que é obrigação legal e permanece com IDs técnicos |
| Portabilidade | pacote do contador (`GET /api/contador/pacote?c=AAAA-MM`) |

### 8.4 Incidente de segurança (art. 48)

Fluxo previsto pela auditoria 013 (§10). Passos operacionais:

1. conter — revogar sessões (`tokenVersion++`), suspender acessos afetados, se
   necessário desligar o portal (`CONTADOR_PORTAL_V2=off`);
2. registrar — a trilha `ContadorEvento` é append-only e é a fonte primária;
3. avaliar risco aos titulares e a extensão (quais lojas, quais competências);
4. comunicar ANPD e titulares em prazo razoável, conforme o art. 48;
5. corrigir e registrar a lição em ADR ou no roadmap.

### 8.5 ROPA do portal (registro de operações)

| Item | Conteúdo |
|---|---|
| Operação | disponibilizar documentos e relatórios contábeis a contador externo |
| Titulares | contadores externos (identidade própria); dados de loja e agregados contábeis |
| Dados | e-mail e senha (hash) do contador, vínculo loja↔contador, papel, sessões, trilha de acesso |
| Não tratados | PII de cliente final nos CSVs (excluída por minimização) |
| Finalidade | cumprimento de obrigação contábil/fiscal da loja |
| Compartilhamento | nenhum com terceiros; storage privado (Cloudflare R2), sem URL pública |
| Retenção | §1 deste documento |
| Segurança | escopo por sessão, ACL por vínculo ativo a cada request, testes cross-store, URLs assinadas de curta duração, storage privado segregado por `storeId` |

---

## 9. Métricas e alertas

Módulo: `lib/contador/observabilidade.ts`. Emissão: uma linha JSON em `console.info`
(`{"evento":"metrica","metrica":...,"valor":...,"labels":{...}}`), o mesmo padrão de
log estruturado já usado no HUB. Sem agente novo, sem dependência nova.

| Métrica | O que mede |
|---|---|
| `retention_dry_run_total` | execuções do job em dry-run |
| `retention_candidates_total` | candidatos por alvo |
| `retention_apply_total` | execuções em apply |
| `retention_failures_total` | falhas do job por alvo |
| `retention_bytes_candidate` | bytes estimados dos candidatos |
| `package_generation_duration_ms` | duração da geração do pacote |
| `package_generation_failures_total` | falhas na geração do pacote |
| `contador_portal_access_denied_total` | acessos negados no portal v2 |

### Privacidade das labels

Duas defesas independentes: **allowlist de chaves** (`alvo`, `modo`, `categoria`,
`resultado`, `motivo`, `loja`, `politica`, `origem`) e **formato de valor** — slug
curto que **começa por letra**, alfabeto `[A-Za-z0-9_-]`, máximo 40 caracteres. Valor
fora do formato é **descartado, nunca truncado**.

Isso exclui estruturalmente `storageRef` (tem `/`), URL assinada, e-mail (tem `@`),
nome de cliente (tem espaço), conteúdo de documento (longo demais) e CPF/CNPJ/telefone
**com e sem máscara** (começam por dígito). `loja` carrega o `storeId` — escopo do
tenant, não PII de cliente, e já presente em `ContadorEvento.storeId`.

### Alertas mínimos sugeridos

| Alerta | Condição |
|---|---|
| Falha de geração de pacote | `package_generation_failures_total` > 0 na janela |
| Geração lenta | `package_generation_duration_ms` acima do observado + folga (§10) |
| Pico de acesso negado | `contador_portal_access_denied_total` acima da linha de base |
| Falha de retenção | `retention_failures_total` > 0 |
| Apply inesperado | **qualquer** `retention_apply_total` > 0 enquanto a decisão for "não aplicar" |

O último é o mais importante hoje: enquanto `CONTADOR_RETENCAO_APPLY` não for uma
decisão tomada, qualquer amostra de `retention_apply_total` é um incidente.

---

## 10. Carga medida

Medição sintética (sem banco, sem Production) — 20 000 vendas / 40 091 itens:

| Métrica | Observado |
|---|---|
| Duração total da geração | **635 ms** |
| Carga das fontes | 121 ms |
| Montagem do conteúdo | 145 ms |
| Compactação | 366 ms |
| Queries lógicas | 65 |
| Arquivos no pacote | 14 |
| Bytes descompactados | 5 764 793 |
| Bytes do ZIP | 1 210 900 |
| Memória | heap 62,3 MB · RSS 231,7 MB |
| Falhas | 0 |

Reproduzir: `npx tsx scripts/contador/carga-sintetica-pacote.mjs --vendas=20000 --json`
(massa determinística — a mesma semente produz a mesma massa).

**Não existe SLA numérico canônico** para a geração do pacote no masterplan nem no
roadmap. O número acima é registro do observado, não um limite de aprovação. O único
teto comparado é `TIMEOUT_LOGICO_MS` (30 000 ms), que já existia no código — a geração
ficou em ~2 % dele.

---

## 11. Checklist de produção

Marcar em ordem. Nada abaixo foi executado nesta entrega.

**Portal e legado**

- [ ] `CONTADOR_PORTAL_V2=on` em Production (senão as páginas de dados do v2 dão 404)
- [ ] `CONTADOR_EXTERNO_SESSION_SECRET` definida
- [ ] `/contador` e `/login-contador` redirecionam para `/contador-externo/login`
- [ ] `POST /api/auth/contador` responde 503
- [ ] `/dashboard/contador` e demais rotas do ERP intactas
- [ ] contadores comunicados da nova URL

**Storage**

- [ ] `CONTADOR_STORAGE_PROVIDER=r2` e as quatro variáveis `R2_*` definidas
- [ ] bucket privado confirmado (`node --env-file=.env scripts/contador/setup-storage.mjs --check`)

**Retenção**

- [ ] `CONTADOR_RETENCAO_APPLY` **ausente** (estado desejado hoje)
- [ ] dry-run executado por loja e relatório revisado por Rafael
- [ ] `candidatos` de `FISCAL`/`JURIDICO`/`FOLHA` por idade = 0 no relatório
- [ ] pendência de processo pendente (§5.1) decidida
- [ ] soft-delete de `FISCAL` (§5.2) decidido
- [ ] primeiro apply, se houver, restrito a uma loja e ao alvo `pacotes`

**Observabilidade**

- [ ] as oito métricas visíveis no coletor
- [ ] alerta de `retention_apply_total` > 0 configurado
- [ ] amostragem de labels conferida: sem PII, sem `storageRef`, sem URL

**Assinatura**

- [ ] revisado e aprovado por: ______________________  data: ____________
