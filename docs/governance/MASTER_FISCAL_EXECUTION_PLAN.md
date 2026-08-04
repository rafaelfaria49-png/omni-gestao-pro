# MASTER FISCAL EXECUTION PLAN

> **Documento de governança** da frente Fiscal do OmniGestão Pro.
> **Data:** 2026-07-23 · **Versão:** 1.5 · **Estado:** Fase 1 (Arquitetura oficial) consolidada ·
> G-C5 criado e fechado (ADR-0015 ratificada) · execução F5 aberta
> **Citado por:** `prisma/schema.prisma:2077` (este é o doc que governa o schema fiscal).
> **Base factual:** `docs/audits/AUDITORIA_PRE_FISCAL_READINESS_v01.md` +
> `docs/audits/AUDITORIA_FISCAL_GAPS_v01.md`.
> **Arquitetura oficial (Fase 1):** `docs/decisions/ADR-0008-fiscal-architecture.md` (princípios) +
> `docs/architecture/FISCAL_SCHEMA_DESIGN.md` + `NFCE_ARCHITECTURE.md` + `FISCAL_EVENTS.md` +
> `FISCAL_SECURITY.md` + `FISCAL_DRY_RUN.md`.

---

## 1. Propósito e princípios

Este plano governa a evolução da frente fiscal **do scaffold dormente atual até a emissão
de NFC-e em produção**, sem quebrar uma única venda real no caminho.

**Princípios inegociáveis (herdados do `CORE_RULES.md` + natureza fiscal):**

1. **Satélite, nunca no caminho crítico.** Fiscal é pós-commit da venda. O balcão nunca
   espera a SEFAZ. Emissão é **assíncrona** via `FiscalEmissaoJob`.
2. **Default-off por loja.** `ConfiguracaoFiscalLoja.fiscalEnabled = false`. Nada emite até
   uma loja ser explicitamente habilitada.
3. **Aditivo e dormente até o gate de ativação.** Cada fase entra desligada; só "liga" no
   final, loja a loja, em homologação primeiro.
4. **Provider-agnóstico.** Toda integração externa passa pelo contrato `FiscalProvider`.
   Trocar SEFAZ-direto por gateway (ou vice-versa) não toca o pipeline.
5. **Segredo só por referência.** Certificado/CSC/token nunca em coluna em claro nem no
   bundle do cliente. Cofre definido por ADR **antes** de qualquer `.pfx`.
6. **Multi-loja estrito.** Todo dado fiscal escopado por `storeId`. Sem fallback `loja-1`.
7. **XML é registro legal.** Uma vez autorizado, é imutável; alterações só por evento fiscal.

---

## 2. Estado atual (reconciliação de 2026-07-16)

> **Nota de reconciliação:** seção de status atualizada por extensão pelo
> `FISCAL-STATUS-RECONCILE-001`, pelo fechamento do `FISCAL-XSD-OFFICIAL-VALIDATION-002` (G-C2),
> pelo fechamento do `FISCAL-XML-C14N-EXTERNAL-PROOF-003` (PR #6) e, em 16/07/2026, pelo
> fechamento documental do `FISCAL-PRODUTO-UPSERT-PARITY-004` (PR #8).
> **Arquitetura, decisões, sequência, princípios e histórico das demais seções permanecem
> vigentes** — alteração somente de status / linha de evidência. Fontes:
> `docs/fiscal/FISCAL_RECONCILE_REPORT_001.md` ·
> `docs/fiscal/FISCAL_XSD_GOAL_002_CLOSURE_REPORT.md` ·
> `docs/fiscal/FISCAL_XML_C14N_GOAL_003_CLOSURE_REPORT.md` ·
> `docs/fiscal/FISCAL_PRODUTO_UPSERT_PARITY_004_CLOSURE_REPORT.md`.

| Fase | Estado factual | Evidência / bloqueio |
|---|---|---|
| F0 | governança vigente e reconciliada | plano, roadmap, ADR-0008 e relatório |
| F1 | decisão aceita; implementação interna parcial N3 | ADR-0009 + EnvVault; KMS ausente |
| F2 | código/testes N3, sem caller | `ba0cc12`; sem ST/CSOSN 500 |
| F3 | XML + **XSD oficial real (N4 no eixo)**; sem caller de venda | merge `82c219c` · worker B2 · G-C2 **fechado** · sem SEFAZ |
| F4 | signer RSA-SHA1/C14N 1.0 **integrado e dormente** | merge `e52d16b` (PR #6) · **N4 no eixo C14N/XMLDSig** · prova Java/JSR 105 · **sem caller de venda** · sem certificado real |
| Cadastro produto | **paridade `upsertProduto` FECHADA (N3)** | merge `b307337` (PR #8) · `metadata.fiscal` canônica · P-04 resolvido no eixo V2 · sem emissão |
| F5 | contrato/stub N1 | **decisão** resolvida (ADR-0015, ratificada 2026-07-23); **execução aberta** — `SefazDiretoProvider` ainda não existe (`REGISTRY` só tem `STUB_HOMOLOGACAO`) |
| F6 | N0 | QR-Code/CSC operacional ausente |
| F7 | contrato de fila N1; guards em seis rotas | 0 jobs; sem produtor/worker; G-F7 aberto |
| F8 | N0 | DANFCE ausente |
| F9 | schema/stub N1 | 0 eventos; serviço real ausente |
| F10 | N0 | contingência ausente |
| F11 | N0 | zero prova SEFAZ em homologação |
| F12 | N0 | zero produção; G-F12 aberto |

XSD: no-op removido; validação real fail-closed; pacote `PL_010e_v1.02`; G-C2 fechado (PR #4).
**Critério técnico C14N/XMLDSig do gate F4→F5 = FECHADO** (GOAL-003, PR #6, run `29450960130`,
artefato `8357457694`). **GOAL-004 / P-04 (paridade `upsertProduto`):** **FECHADO** na `main`
(PR #8, merge `b307337`, implementação `3f8928c`); N3 no eixo cadastro; `metadata.fiscalRegime`
não canônico; schema/migration intocados; signer dormente; callers produtivos = 0.
Gate Fiscal **global** permanece **ABERTO** — dry-run completo ainda não é N4 pleno por lacunas
restantes (ST, casos-alvo, provider, dry-run integral). N6=0 e N7=0. Prova externa e cadastro
canônico **não** são homologação SEFAZ. **Não reimplementar F2–F4 do zero:** fechar lacunas
internas remanescentes, tornar o dry-run auferível de ponta a ponta e somente então avançar para F5.

**Reconciliação do GOAL-005 (16/07/2026, `FISCAL-GOAL-005-SCOPE-RECONCILIATION`):** após a auditoria
formal (classe **G**, branch `audit/fiscal-goal-005-formal-evaluation`, commit `f6d6f2a…`), o slot
nomeado 005 foi **definido documentalmente** como **`FISCAL-DRY-RUN-INTEGRITY-PROOF-005`** — “Prova
de Integridade do Dry-Run Fiscal” (rótulo provisório equivalente: `FISCAL-DRY-RUN-INTEGRITY-005`),
**NÃO iniciado**. Colisão “005” separada e preservada: XSD histórico **cumprido** (GOAL nomeado 002);
rótulo de código `GOAL_005` snapshot **dormente** (componente/pré-requisito, não GOAL a iniciar);
Contador HUB competência = **trilho distinto** read-only. **Limites do futuro GOAL-005:** offline,
fixtures sintéticas, sem caller produtivo, sem PDV/venda, sem SEFAZ/homologação/produção, sem
certificado/CSC/idToken, sem regra tributária, sem schema/migration, sem tocar Contador HUB; nível
inicial N3, máximo N4 só no eixo integridade do dry-run; N6=0; N7=0; **nenhum gate fechado** pela
reconciliação. Fonte:
[`FISCAL_GOAL_005_SCOPE_RECONCILIATION.md`](../fiscal/FISCAL_GOAL_005_SCOPE_RECONCILIATION.md).
**GOAL-005 técnico não iniciado.**

**Reconciliação de 2026-08-03 (GOAL-016D).** `origin/main` = `0de82ab` — **GOAL-016C integrado**
(PR #33): custódia A1 e Secret Provider server-only na linha principal, com EnvVault **somente
leitura** e provisionamento **manual**. **GOAL-016D produziu apenas planejamento** e está
**NÃO INICIADO**. O estado das fases **não mudou**: F5 continua N1 (contrato + stub), F6–F12 em N0,
`fiscalEnabled = false`, banco fiscal vazio, **zero transmissão SEFAZ**, **zero homologação**,
**zero produção**, N6=0 e N7=0. Gate Fiscal global permanece **ABERTO**. Novos rótulos criados por
este GOAL: gates **G-F5.2** e **G-F5.3** (§4), decisões **D11/D12/D13** e pendências
**H-9/H-10/H-11** — todos **nascem abertos**, sem histórico retroativo. A revisão independente
encontrou três lacunas reais, corrigidas dentro deste GOAL: a rota P1 direta
(`emitirNotaFiscalVenda`) **não** tem barreira de tipo equivalente à de P2 ⇒ **D11**; `cStat 656`
não tinha mecanismo de parada e o contrato atual **agendaria outra consulta** ⇒ **D12**; e a
divergência contra a ADR-0015 §2.2 (que nomeia `emitir`) exige **ADR própria antes de 016D-A** ⇒
**D13**. Fonte:
[`FISCAL_GOAL_016D_SEFAZ_ADAPTER_PLAN.md`](../fiscal/FISCAL_GOAL_016D_SEFAZ_ADAPTER_PLAN.md).

**Revisão cruzada de outra família (mesma data) — parecer B.** Read-only, com verificação
`arquivo:linha` (16/16) e revalidação das fontes oficiais **em fonte primária**. Dez achados
(**F-1…F-10**) foram incorporados ao plano. Três alteram a leitura de segurança e **corrigem
afirmações desta seção**:

- ⚠️ **F-1 — `readonly simulado: true` NÃO é barreira de compilador.** Um provider real que declare
  `simulado = true` **compila e transmite**, e por isso as travas `if (!provider.simulado)` também
  passam. **`simulado` é rótulo de trilha e não pode ser tratado como controle de segurança.** As
  proteções **mecânicas** reais são: **T4** (compara o `provider` persistido na configuração da
  loja), o **`REGISTRY` sem `SEFAZ_DIRETO`** e a **ausência de cliente HTTP** em `lib/fiscal/**`.
- ⚠️ **F-2 — a trava T5 está inerte** no caminho `payload.version >= 2`:
  `uncertain-state-job-executor.ts` devolve `simulado: true` e `externalTransmissionAttempted: false`
  **literais** em todos os retornos. Sem correção, a trilha de auditoria registraria `false` **depois
  de uma transmissão real**. Corrigir a derivação virou **critério de aceite** de 016D-A/016D-B.
- ⚠️ **F-3 — inércia do `emitir` não basta:** o pipeline P1 **consome numeração** e grava
  `fiscalStatus=EMITINDO` **antes** de chamar `provider.emitir`, e não há gate de `fiscalEnabled`
  nessa rota. ⛔ **Decisão endurecida: `SEFAZ_DIRETO` NUNCA será registrado no `REGISTRY` de
  `FiscalProvider`/P1.** O adapter real é alcançado por instanciação server-side direta. Isso
  elimina a rota de transmissão acidental **por construção**.

**Também criados pela revisão cruzada:** slice **016D-A0** (resolver do certificado A1, isolado do
adapter), gates humanos **G-H1…G-H6** (§4) e pendência **H-12** (limite quantitativo do `cStat 656`
não confirmado em fonte primária).

---

## 3. Fases de execução (ordem exata)

Cada fase é uma sprint pequena, com Gate humano antes de começar e antes de mergear
(modelo `docs/execution/HUMAN_GATES.md`). Tamanho-alvo: ≤ 500 linhas de diff por skill.

### FASE 0 — Plano Mestre (este documento) ✅
- **Entregáveis:** readiness, gaps, plano mestre, roadmap. **Só documentação.**
- **DoD:** 4 docs criados; `tsc` limpo; nenhum código tocado.

### FASE 0.1 — Arquitetura oficial (Fiscal Fase 1) ✅
- **Entregáveis:** `ADR-0008-fiscal-architecture.md` (7 princípios) + 5 docs de arquitetura
  (`FISCAL_SCHEMA_DESIGN.md`, `NFCE_ARCHITECTURE.md`, `FISCAL_EVENTS.md`, `FISCAL_SECURITY.md`,
  `FISCAL_DRY_RUN.md`). **Só documentação** — nenhum código produtivo tocado.
- **DoD:** ADR + 5 docs criados; índices (`architecture`, `decisions`) atualizados; diagramas
  Mermaid; nada do `prisma/schema.prisma` nem de `lib/fiscal/**` alterado.
- **Nota:** a numeração de fases do plano (F1–F12) **não muda** — a arquitetura é fundação
  transversal a todas elas.

### FASE F1 — ADR do cofre de segredo `[GATE HUMANO OBRIGATÓRIO]` ✅
- **Objetivo:** decidir onde mora o `.pfx` A1, a senha e o token CSC (Supabase Vault × KMS × env por loja).
- **Entregue:** `ADR-0009` (contrato/piloto) + `ADR-0014` (backend de produção), ambas aceitas.
  **Decisão:** port único `FiscalSecretVault`; **EnvVault** por loja no piloto/homologação e
  **SupabaseVaultStorageVault** em produção, com envelope encryption, uma DEK por segredo/versão,
  AAD vinculando loja/certificado/versão/finalidade e bucket privado exclusivo do Fiscal. Chave
  mestra gerenciada pelo Supabase fora da aplicação; acesso somente pelo serviço fiscal server-side.
- **Não fazer:** subir qualquer certificado real antes da implementação do vault (F4).
- **DoD:** ADRs aprovadas pelo humano; sem código/provisionamento. **Gate G-F1 resolvido** → F4 destravada.

### FASE F2 — Motor de tributos NFC-e (Simples Nacional primeiro)
- **Objetivo:** calcular CSOSN/CST, base, alíquota, total de tributos por item.
- **Arquivos prováveis:** `lib/fiscal/tributos/*` (puro, testável), consumido pelo snapshot.
- **Escopo fechado:** **só** NFC-e B2C Simples Nacional (menor matriz). Regime Normal = fase posterior.
- **Não fazer:** generalizar para todos os regimes "de brinde".
- **DoD:** função pura + testes cobrindo CSOSN 102/500, origem 0–8; `tsc` limpo.

### FASE F3 — Geração de XML NFC-e + chave de acesso
- **Objetivo:** serializar `infNFe` 4.00 a partir do snapshot + tributos; calcular chave (44 díg + DV).
- **Arquivos prováveis:** `lib/fiscal/xml/*` (builder puro), novo método no provider real.
- **Não fazer:** assinar/transmitir ainda. Só gerar e validar contra XSD.
- **DoD:** XML válido contra schema XSD oficial (homologação); testes de chave/DV.

### FASE F4 — Assinatura digital A1 (XMLDSig) `[GATE: depende de F1]`
- **Objetivo:** carregar A1 do cofre (F1) e assinar `infNFe`.
- **Arquivos prováveis:** `lib/fiscal/assinatura/*`, adapter de cofre.
- **Não fazer:** logar segredo; expor `.pfx`/senha; rodar no client.
- **DoD:** XML assinado verificável; segredo nunca em log/trace/client; isolamento por `storeId` e
  fail-closed comprovados; `tsc` limpo. O adapter de produção continua bloqueado até GOAL próprio.

### GATE TÉCNICO — Dry-Run (entre F4 e F5) `[critério de entrada da F5]`
- **Objetivo:** rodar a esteira inteira (snapshot→tributos→XML→assinatura simulada→validação XSD)
  **sem transmitir** e **descartar o XML**, produzindo relatório de prontidão.
- **Arquitetura:** `docs/architecture/FISCAL_DRY_RUN.md`. Útil também em CI (golden cases).
- **Não fazer:** transmitir à SEFAZ; persistir documento legal; consumir numeração de produção;
  usar A1 real (certificado de teste).
- **DoD / critério de bloqueio:** **não se inicia a F5 sem Dry-Run verde** para os casos-alvo.
  Não recebe número próprio (evita renumerar F5–F12).

### FASE F5 — Provider real + transmissão SEFAZ `[DECISÃO RESOLVIDA · EXECUÇÃO ABERTA]`

> **Estado em 2026-07-23:** a **decisão** de transporte está resolvida (ADR-0015, ratificada — §4.1)
> e a **execução está formalmente aberta**, mas **não implementada**. Não existe
> `SefazDiretoProvider`; o `REGISTRY` de `lib/fiscal/provider/resolver.ts` tem uma única fábrica
> (`STUB_HOMOLOGACAO`). **Esta fase não pode ser marcada como concluída** enquanto não houver
> documento autorizado em homologação.
>
> **Atualização em 2026-08-03 (GOAL-016D — planejamento).** A F5 ganhou **plano técnico executável**
> em [`FISCAL_GOAL_016D_SEFAZ_ADAPTER_PLAN.md`](../fiscal/FISCAL_GOAL_016D_SEFAZ_ADAPTER_PLAN.md),
> reconciliado com o código de `origin/main` = `0de82ab` e com fontes oficiais revalidadas na data.
> **Nada foi implementado**: continua sem `SefazDiretoProvider`, sem transmissão e sem homologação.
> A execução fica dividida em **6 slices** — `016D-A0` resolver do certificado A1 (offline, sem
> contato com segredo) · `016D-A` contrato/adapter offline · `016D-B` fixtures SOAP, parser e matriz
> de `cStat` · `016D-C` `statusServico` real · `016D-D` autorização de uma NFC-e sintética ·
> `016D-E` consulta e reconciliação. **016D-A0, 016D-A e 016D-B não dependem de nenhum insumo
> humano**; o A1 passa a ser obrigatório em 016D-C e todos os insumos em 016D-D.
>
> A auditoria do GOAL-016D registrou que o **envelope de XML assinado exigido pelo §2.2 da ADR-0015
> já existe** no repositório: é o contrato `UncertainStateFiscalProvider` (ADR-0017), que transporta
> `exactBytes` + `bytesSha256`. Portanto o `SefazDiretoProvider` implementa **esse** contrato, e
> `FiscalProvider` permanece como superfície de configuração/status. Faltam apenas dois campos
> aditivos (`uf` e `correlationId`) — **sem schema, sem migration**.
>
> ⛔ **Endurecimento da revisão cruzada (F-3):** `SEFAZ_DIRETO` **nunca** será registrado no
> `REGISTRY` de `lib/fiscal/provider/resolver.ts`. `resolveFiscalProvider` continua devolvendo
> `provider_nao_implementado` para esse tipo, e `statusServico` é alcançado por **instanciação
> server-side direta e dedicada**. Consequência: a rota `emitirNotaFiscalVenda → provider.emitir`
> **não consegue** instanciar o provider real — o risco deixa de ser mitigado por teste e passa a ser
> impossível por construção.

- **Objetivo:** implementar `SefazDiretoProvider` atrás do contrato `FiscalProvider` e transmitir
  exclusivamente aos Web Services oficiais de homologação (ADR-0015).
- **Escopo obrigatório da abertura (2026-07-23), fail-closed antes da rede:**

  | Restrição | Valor |
  |---|---|
  | Autorizador | **somente SEFAZ-SP** |
  | Modelo | **somente NFC-e modelo 65** |
  | Ambiente | **somente homologação** |
  | `tpAmb` | **somente 2** |
  | Loja | **somente Matriz RafaCell** |
  | Entrada do provider | **XML previamente assinado e validado** |
  | Produção | **zero** |
  | `tpAmb=1` | **zero** |
  | Ativação automática de `fiscalEnabled` | **zero** |
- **Escopo inicial:** exclusivamente o registro `Store` real da Matriz RafaCell Assistec em
  Taguaí/SP, SEFAZ-SP, NFC-e modelo 65, `HOMOLOGACAO` e `tpAmb=2` (ADR-0016). Nenhum `storeId`
  literal/fallback; nenhuma herança para outra loja.
- **Arquivos prováveis:** adapter provider, resolver de endpoint por UF/ambiente/serviço/versão e
  transporte SOAP/TLS server-side, sem detalhes de protocolo no domínio.
- **Responsabilidade:** o OmniGestão executa snapshot, tributos, numeração, XML, XSD, assinatura,
  transmissão, reconciliação e persistência do protocolo/XML autorizado. O provider recebe o XML
  já assinado e validado; não recalcula domínio.
- **Não fazer:** usar gateway/PAA, fallback automático ou endpoint de produção. **Só HOMOLOGAÇÃO**.
- **Preflight:** antes da rede, validar por `storeId` real CNPJ, IE, razão social, endereço/IBGE/UF,
  CRT/regime, série, CSC de homologação, A1 ativo/compatível e pipeline XML/XSD/assinatura. Qualquer
  ausência/divergência é fail-closed; valores reais nunca entram em docs/logs/fixtures.
- **DoD:** documento autorizado em homologação (`cStat = 100`) com protocolo e XML autorizado
  imutável persistidos; resultado incerto reconciliado antes de retry; produção bloqueada antes da rede.

### FASE F6 — QR-Code NFC-e + URL de consulta (CSC)
- **Objetivo:** gerar QR-Code conforme CSC e URL por UF/ambiente.
- **Arquivos prováveis:** `lib/fiscal/qrcode/*`.
- **DoD:** QR-Code validado no portal da SEFAZ de homologação.

### FASE F7 — Ativação gated por fila `[GATE HUMANO: a manobra crítica]`
- **Objetivo:** ligar a emissão **assíncrona** para 1 loja-piloto em homologação.
- **Arquivos prováveis:** produtor pós-commit (enfileira em `FiscalEmissaoJob`), worker
  (drena fila → `emitirNotaFiscalVenda`), reflexo de status no PDV/recibo.
- **Não fazer (CRÍTICO):** emitir **inline** na transação de venda. Venda **commita primeiro**,
  fila emite depois. Falha fiscal **nunca** desfaz a venda.
- **DoD:** venda real (homologação) gera job → autoriza → status reflete; PDV não trava;
  rollback testado (desabilitar loja = parar de enfileirar, sem perder vendas).

### FASE F8 — DANFCE unificado (Roadmap #9)
- DANFCE com QR-Code sobre o **XML autorizado** (não sobre o carrinho).

### FASE F9 — Eventos fiscais (Roadmap #10)
- Cancelamento (janela legal), inutilização, CC-e → grava `EventoFiscal`, transmite,
  atualiza `NotaFiscal.status` + `Venda.fiscalStatus`.

### FASE F10 — Contingência (Roadmap #11 parte 1)
- Entrada/saída de contingência offline + reprocessamento da fila.

### FASE F11 — Homologação ampla (Roadmap #11)
- Bateria de casos contra SEFAZ homologação (todas as UFs-alvo, rejeições, denegação).

### FASE F12 — Produção `[GATE HUMANO FINAL]` (Roadmap #12)
- Antes da virada, implementar e validar o `SupabaseVaultStorageVault` conforme ADR-0014: DEK por
  segredo/versão, AAD, bucket Fiscal exclusivo, separação do Contador HUB, auditoria, recuperação,
  remoção segura e testes fail-closed/cross-store. Só então virar `ambiente` para `PRODUCAO`
  **por loja**, com checklist e rollback imediato.

---

## 3.1 Matriz consolidada de fases (gate · pronto · bloqueio · rollback)

> Visão única e oficial das fases F0–F12. **Gate** = exige aprovação humana antes de iniciar/
> mergear. **Critério de pronto (DoD)** = condição objetiva para encerrar. **Critério de bloqueio**
> = condição que **impede** iniciar/avançar. **Rollback** = como reverter com segurança.

| Fase | Gate | Critério de pronto (DoD) | Critério de bloqueio | Rollback |
|---|---|---|---|---|
| **F0** Plano Mestre | — | 4 docs Fase 0 + `tsc` limpo; código intocado | — | `git revert` (só docs) |
| **F0.1** Arquitetura oficial | — | ADR-0008 + 5 docs arquitetura + índices; sem código | — | `git revert` (só docs) |
| **F1** ADR cofre ✅ | 🔒 G-F1 ✅ | **ADR-0009 + ADR-0014 aceitas** (EnvVault piloto / Supabase Vault + Storage produção) | — (resolvido) | `git revert` (só docs) |
| **F2** Tributos | — | Função pura + testes (CSOSN 102/500, origem 0–8); `tsc` | Regime fora do escopo (só SN B2C) | `git revert` (aditivo) |
| **F3** XML | — | XML válido no XSD homologação; testes de chave/DV | Sem tributos (F2) | `git revert` (aditivo) |
| **F4** Assinatura | 🔒 depende G-F1 | XML assinado verificável; **segredo nunca logado** | Cofre indefinido (F1); segredo em log/bundle | `git revert` (aditivo) |
| **Dry-Run** | técnico | Relatório de prontidão **verde** p/ casos-alvo | XSD inválido / pendência tributária | n/a (não transmite/persiste) |
| **F5** SEFAZ direta SP | 🔒 G-F5 ✅ | Matriz real + preflight apto; protocolo/XML autorizado persistidos em homologação (`cStat=100`); reconciliação idempotente | Dry-Run não-verde; preflight/credenciamento incompleto; store/UF/modelo/ambiente divergente; qualquer produção | resolver→STUB; interromper chamadas externas |
| **F6** QR-Code | — | QR validado no portal SEFAZ homologação | Sem autorizado (F5) | `git revert` (aditivo) |
| **F7** Ativação por fila | 🔒 G-F7 | Venda real (homolog.) → job → autoriza; **PDV não trava**; rollback testado | **Emissão inline** (proibido); F2–F6 incompletos | `fiscalEnabled=false` (para de enfileirar) |
| **F8** DANFCE | — | DANFCE com QR sobre **XML autorizado** | Sem autorizado (F5) | `git revert` (aditivo) |
| **F9** Eventos | — | Evento autorizado + status refletido | Sem nota AUTORIZADA (F5) | `git revert` + evento não-emitido |
| **F10** Contingência | — | Entra/sai de contingência; fila reprocessa | Sem F5 + política de retry | `git revert`; jobs reprocessam |
| **F11** Homologação ampla | — | Casos felizes + rejeição/denegação verdes (por UF) | Qualquer caso-alvo falhando | manter em homologação |
| **F12** Produção | 🔒 G-F12 | Cofre ADR-0014 validado + NFC-e autorizada em produção na loja-piloto | F11 incompleta; cofre sem recuperação/isolamento/fail-closed; sem checklist/rollback | `ambiente=HOMOLOGACAO` + kill-switch |

> **Invariante transversal:** falha fiscal **nunca** desfaz a venda; XML autorizado **nunca** é
> apagado (correção é por evento). Detalhe por princípio em `ADR-0008 §2` (P1–P7).

---

## 4. Gates humanos obrigatórios

| Gate | Antes de | Decisão do humano |
|---|---|---|
| G-F1 ✅ | Qualquer manuseio de certificado | Aprovar contrato e backend do cofre → **resolvido: ADR-0009 + ADR-0014** |
| **G-C5** ✅ | **Estratégia do provider e transporte fiscal** | **SEFAZ direta ratificada** em 2026-07-23 → ADR-0015 + [`FISCAL_PROVIDER_DOSSIE_001.md`](../fiscal/FISCAL_PROVIDER_DOSSIE_001.md). ⚠️ Rótulo **criado pelo GOAL-014**; ver nota abaixo |
| G-F5 ✅ | Integração externa (**decisão**) | **SEFAZ direta na homologação inicial**, atrás de `FiscalProvider` → ADR-0015, **ratificada** em 2026-07-23. **Decisão ≠ execução** — a fase F5 está aberta e não implementada |
| G-F5.1 ✅ | Escopo da primeira homologação | **Matriz RafaCell Assistec/Taguaí, SP, SEFAZ-SP, NFC-e 65, `tpAmb=2`** → ADR-0016 |
| **G-F5.2** 🔒 | **Primeira chamada externa** (slice 016D-C) | Autorizar o **primeiro pacote de rede da história do projeto** — `NFeStatusServico4` em homologação. Não cria documento, não consome numeração. ⚠️ Rótulo **criado pelo GOAL-016D** em 2026-08-03, **nasce aberto**, sem histórico retroativo |
| **G-F5.3** 🔒 | **Primeira transmissão de documento** (slice 016D-D) | Autorizar a transmissão de **uma** NFC-e sintética de homologação. ⚠️ Rótulo **criado pelo GOAL-016D** em 2026-08-03, **nasce aberto**, sem histórico retroativo. Distinto do G-F5 (decisão de provider), do G-F5.2 (primeira chamada externa) e do G-F7 (ligar a emissão) |
| **G-H1** 🔒 | **Origem autorizada da primeira chamada externa** (016D-C) | Quem dispara, com qual identidade e sob qual autorização nominal |
| **G-H2** 🔒 | **Infraestrutura exata de saída do pacote** (016D-C) | Declarar se o primeiro pacote parte de **estação controlada** ou de **deploy de produção**. Chamada à SEFAZ saindo da infra produtiva **com o A1 da empresa** é risco materialmente distinto |
| **G-H3** 🔒 | **Teto de tentativas e janela temporal** (016D-C) | Máximo de chamadas a `NFeStatusServico4` e janela em que podem ocorrer — o `656` pune loop e o limite quantitativo é **H-12** |
| **G-H4** 🔒 | **Posse do `FISCAL_QUEUE_INTERNAL_SECRET`** (016D-D) | Quem detém o segredo da rota administrativa de fila (`app/api/internal/fiscal/queue`) durante o 016D e sob que condições pode acioná-la |
| **G-H5** 🔒 | **Teto de transmissões** (016D-D) | Quantos documentos podem ser transmitidos no total. O alvo é **um**; qualquer número acima exige autorização nova |
| **G-H6** 🔒 | **Autorização por repetição após falha** (016D-C/D/E) | ⛔ Uma rejeição **não** autoriza a tentativa seguinte. Cada repetição exige **nova** autorização humana, com diagnóstico registrado |
| G-F7 | Ligar emissão | Aprovar ativação na loja-piloto (homologação) |
| G-F12 | Produção | Aprovar virada `HOMOLOGACAO → PRODUCAO` por loja |

> ⚠️ **G-H1…G-H6 são rótulos criados pela revisão cruzada do GOAL-016D** em 2026-08-03. Todos
> **nascem abertos**, sem histórico retroativo. `G-F5.2` autoriza *a existência* da primeira chamada
> externa; `G-H1`–`G-H3` autorizam *as condições* dela — nenhum substitui o outro.

Nenhuma fase com `[GATE]` inicia sem aprovação explícita registrada.

> ⚠️ **Nota de honestidade sobre o G-C5.** O rótulo `G-C5` **não existia** em nenhum documento do
> projeto antes do GOAL-014 — a numeração de gates de construção ia de G-C1 a G-C4 e G-C6, sem
> G-C5. Ele foi **criado pelo GOAL-014** para nomear a decisão estratégica de provider/transporte e
> **nasce fechado** em 2026-07-23. **Nenhum histórico anterior lhe é atribuído**: não houve período
> em que estivesse "aberto", e nenhum documento retroativo o menciona.

### 4.1 Ratificação da ADR-0015 e gatilhos de reavaliação (2026-07-23)

A ADR-0015 foi **ratificada** por Rafael Faria no checkpoint do GOAL-014, com base no
[`FISCAL_PROVIDER_DOSSIE_001.md`](../fiscal/FISCAL_PROVIDER_DOSSIE_001.md) (matriz A/B/C em 15
dimensões, preços públicos e churn da NT 2025.002). **Nenhuma ADR nova foi criada e o texto
histórico da ADR-0015 permanece inalterado.**

A ratificação vale enquanto nenhum destes gatilhos ocorrer:

| # | Gatilho de reavaliação |
|---|---|
| **T1** | Piloto **não atingir `cStat=100`** em até **dois ciclos de correção** por problemas de NT, layout ou transporte |
| **T2** | Manutenção de NT consumir **>~20% do esforço de engenharia fiscal** por **dois meses consecutivos** |
| **T3** | Entrada de **segunda UF** ou de **NFS-e** no roadmap |
| **T4** | Produção exigir **contingência** que o OmniGestão não consiga operar com segurança |

Ao disparar qualquer gatilho, **reavaliar o cenário C** (domínio fiscal próprio + `FiscalProvider`
agnóstico + adapter de gateway). **A reavaliação não autoriza mudança automática de provider** —
trocar de transporte continua exigindo decisão humana explícita e ADR própria (ADR-0015 §2.6).

**Custódia do A1 — ADR-0014 preservada integralmente e sem flexibilização:** custódia na
infraestrutura própria, **nenhuma entrega automática do A1 a gateway**, assinatura local, envelope
encryption, isolamento por loja e acesso somente server-side. **Qualquer gateway futuro que exija
custódia externa do certificado depende de nova decisão humana e arquitetura formal** — não decorre
de nenhum gatilho T1–T4.

---

## 5. Critérios de pronto (DoD transversal)

Toda fase fiscal só encerra com:

- [ ] `npx tsc --noEmit` limpo.
- [ ] Testes da camada (puro primeiro) verdes; `npm run build` quando tocar rota/Server Action/Prisma.
- [ ] Nenhuma área protegida tocada sem autorização (`CORE_RULES §5`).
- [ ] Segredo nunca em log/bundle/coluna em claro.
- [ ] `fiscalEnabled` permanece `false` exceto na loja-piloto explicitamente habilitada.
- [ ] Relatório final (`DELIVERY_CHECKLIST §4`) + ADR quando houver decisão arquitetural.

---

## 6. O que NÃO fazer (proibições permanentes)

- ❌ **Reimplementar** GOALs 001B–008 (já entregues).
- ❌ Emitir **inline** na transação de venda (sempre fila pós-commit).
- ❌ Deixar falha fiscal **desfazer/bloquear** a venda.
- ❌ Subir `.pfx`/senha antes do ADR do cofre (F1).
- ❌ Apontar para **produção** sem passar por homologação ampla (F11) e Gate G-F12.
- ❌ Ligar emissão para **todas** as lojas de uma vez (sempre loja-a-loja).
- ❌ Hardcode de UF/CSC/credencial no código (sempre por `ConfiguracaoFiscalLoja` + cofre).
- ❌ Tocar `auth`/`proxy`/`lib/prisma.ts`/`next.config` a pretexto fiscal.

---

## 7. Estratégia de homologação

1. **Provider STUB → `SefazDiretoProvider` (homologação)**: o resolver troca a implementação por
   `storeId.provider`; o STUB continua disponível para CI/testes. SOAP/UF ficam no adapter e no
   resolver de endpoints, nunca no domínio.
2. **Ambiente HOMOLOGACAO** fixo em `ConfiguracaoFiscalLoja.ambiente` até F12.
3. **Loja-piloto única** habilitada (`fiscalEnabled = true`, ambiente homologação).
   A loja é a Matriz RafaCell Assistec em Taguaí/SP e é identificada exclusivamente pelo
   `Store.id` real propagado nas relações; nunca por constante, posição, nome ou fallback.
4. Bateria de casos: autorização feliz, rejeição (cStat ≠ 100), denegação, timeout →
   contingência, cancelamento dentro/fora da janela, inutilização.
5. Timeout/resultado incerto exige consulta por chave/recibo antes de retransmissão.
6. Gateway/PAA não participam da primeira homologação; são alternativas futuras por nova ADR.
7. Só após F11 verde, abre-se o Gate de produção.
8. Outras lojas/UFs só entram em etapa futura, uma a uma, após homologação completa da Matriz/SP.

---

## 8. Estratégia para não quebrar vendas reais

- **Pós-commit, sempre.** Venda persiste e fecha o caixa **antes** de qualquer ato fiscal.
- **Fila desacoplada** (`FiscalEmissaoJob`) com lock/retry/dedupe; o PDV só **enfileira**.
- **Default-off**: lojas não habilitadas não enfileiram nada → comportamento idêntico ao atual.
- **State machine no-op**: enquanto `NAO_FISCAL`, as rotas `corrigir*`/`cancelar` operam como hoje.
- **Kill-switch por loja**: `fiscalEnabled = false` para de enfileirar imediatamente, sem
  afetar vendas em andamento nem histórico.

---

## 9. Estratégia multi-loja

- Toda tabela fiscal já é escopada por `storeId` (sem `@default("loja-1")`, ADR-0003).
- Identidade, certificado, série, CSC e provider são **por loja** (`ConfiguracaoFiscalLoja`).
- Cofre de produção valida `storeId` na autorização, metadados, policy/path e AAD; DEKs nunca são
  compartilhadas entre lojas, segredos ou versões.
- No piloto, `Store.id` deve coincidir em configuração fiscal, certificado, série, nota, job e
  contexto. Um valor com aparência legada lido do registro real não se transforma em fallback.
- Nenhuma loja herda configuração fiscal, CSC, certificado, série, provider ou ambiente da Matriz.
- Habilitação é **por loja**: piloto → ondas. Uma loja em produção não afeta as demais.
- Numeração é por `(storeId, modelo, serie, ambiente)` — sem colisão entre lojas.

---

## 10. Estratégia de rollback

| Situação | Rollback |
|---|---|
| Fase em código quebra algo | `git revert` da fase (aditiva/dormente — baixo risco). |
| Emissão piloto com problema | `fiscalEnabled = false` na loja → para de enfileirar. Jobs pendentes ficam para reprocessar/cancelar. |
| Provider real instável | `resolver` volta para STUB ou entra em contingência. |
| Produção com incidente | `ambiente = HOMOLOGACAO` na loja + kill-switch; documentos já autorizados são imutáveis (tratar por evento, não por delete). |
| Schema (só se inevitável) | Migração **aditiva** reversível; ver checklist §11. |

> XML autorizado **nunca** é apagado para "desfazer" — correção fiscal é por evento.

---

## 11. Checklist ANTES de tocar no Prisma

A fundação fiscal já existe; novas fases devem **evitar** mexer no schema. Se for inevitável:

- [ ] A mudança é **aditiva** (nova coluna nullable / nova tabela)? Alteração destrutiva exige ADR.
- [ ] Autorização **explícita** do usuário (CORE_RULES §5 — schema é área protegida).
- [ ] Não quebra os `@@unique` fiscais existentes (`localKey`, série, chave de acesso).
- [ ] Mantém segredo por referência (sem coluna de `.pfx`/senha/token em claro).
- [ ] Mantém multi-loja estrito (sem `@default("loja-1")`).
- [ ] Plano de migração com `DIRECT_URL` (porta 5432) e janela; `db push` só em dev.
- [ ] Rollback da migração descrito.
- [ ] `prisma generate` + `npm run build` validados.
- [ ] ADR registrado se muda contrato entre módulos.

---

## 12. Referências

- Auditorias: `docs/audits/AUDITORIA_PRE_FISCAL_READINESS_v01.md`,
  `docs/audits/AUDITORIA_FISCAL_GAPS_v01.md`.
- Roadmap: `docs/roadmaps/ROADMAP_FISCAL.md`.
- Governança: `docs/skills/rules/CORE_RULES.md`, `docs/execution/HUMAN_GATES.md`,
  `docs/decisions/INDEX.md` (ADRs).
- Código vivo: `lib/fiscal/**`, `prisma/schema.prisma` (bloco fiscal ~L2075+),
  `app/api/fiscal/**`, `components/configuracoes-v3/.../FiscalSection.tsx`.
- Arquitetura oficial (Fase 1, criada): `docs/decisions/ADR-0008-fiscal-architecture.md`,
  `docs/architecture/FISCAL_SCHEMA_DESIGN.md`, `docs/architecture/NFCE_ARCHITECTURE.md`,
  `docs/architecture/FISCAL_EVENTS.md`, `docs/architecture/FISCAL_SECURITY.md`,
  `docs/architecture/FISCAL_DRY_RUN.md`.
- Cofre de segredos (F1, decidido): `docs/decisions/ADR-0009-fiscal-secret-vault.md`.
- Backend KMS de produção (D3, decidido): `docs/decisions/ADR-0014-supabase-vault-backend-kms-fiscal.md`.
- Provider inicial (G-F5, decidido): `docs/decisions/ADR-0015-sefaz-direta-homologacao-inicial.md`
  — **ratificado em 2026-07-23** (G-C5), sem ADR nova e sem alteração do histórico.
- Estratégia do provider (G-C5, decidido): `docs/fiscal/FISCAL_PROVIDER_DOSSIE_001.md` — matriz
  A/B/C em 15 dimensões, custos públicos, gatilhos T1–T4 e insumos humanos pendentes.
- Escopo do piloto (G-F5.1, decidido): `docs/decisions/ADR-0016-piloto-homologacao-sp-matriz-rafacell.md`.
- Parâmetros oficiais da SEFAZ-SP (G-C8): `docs/fiscal/FISCAL_SEFAZ_DOSSIE_UF_001.md`.
- **Plano da F5 (GOAL-016D, planejado — não iniciado):**
  `docs/fiscal/FISCAL_GOAL_016D_SEFAZ_ADAPTER_PLAN.md` — auditoria do código, revalidação oficial,
  10 decisões técnicas, gates/insumos e divisão em **6 slices** (`016D-A0`…`016D-E`), já com as
  correções **F-1…F-10** da revisão cruzada incorporadas.
  - **Nota de nomenclatura:** o comentário `schema.prisma:2077` cita `FISCAL_SCHEMA_DESIGN_v01.md`
    e `venda-fiscal-state-machine.ts:13` cita `NFCE_ARCHITECTURE §17/§18`. Os docs oficiais foram
    criados **sem sufixo `_v01`** (versionamento via git/ADR, padrão do projeto). Os comentários
    de código apontam à versão histórica; **não foram alterados** (schema/código são área protegida).
    `NFCE_ARCHITECTURE.md` mapeia §17/§18 → §6/§7.

---

*Documento vivo de governança. Mudanças estruturais de plano exigem ADR.*
