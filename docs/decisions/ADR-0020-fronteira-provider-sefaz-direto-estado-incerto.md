---
title: ADR-0020 · Fronteira do Provider SEFAZ Direto e Estado Incerto
status: aceita
data: 2026-08-04
autor: Grok (GOAL-016D-ADR-PROVIDER-BOUNDARY-001)
revisores: [Rafael Faria]
hub: cross
tags: [fiscal, nfce, sefaz, provider, uncertain-state, homologacao, p2, registry]
superado_por:
substitui:
---

# ADR-0020 · Fronteira do Provider SEFAZ Direto e Estado Incerto

> **Status:** aceita
> **Decisão em uma frase:** a transmissão de documento fiscal real ocorre **exclusivamente** por
> `UncertainStateFiscalProvider.transmit` (P2); `SEFAZ_DIRETO` **nunca** entra no `REGISTRY` de
> `FiscalProvider` (P1); `PROCESSING` e `THROTTLED` formalizam desfechos de estado incerto sem
> retransmissão cega; e esta ADR **não** autoriza rede, homologação executada, produção ou segredo.

---

## 0. FU-1b — Numeração canônica (evidência)

Inventário **somente** dos ADRs versionados em `origin/main` no momento desta decisão
(`892f47e0320dfb799fe4413efc98ba8d8ba2ba20`, merge do PR #35):

| # | Arquivo versionado | Status |
|---|--------------------|--------|
| 0001 (legado) | `OS_ROUTE_OFICIAL.md` | decidido |
| 0002 | `ADR-0002-skill-front-matter-v1.md` | aceita |
| 0003 | `ADR-0003-eliminar-fallback-legacy-primary-store-id.md` | aceita |
| 0004 | `ADR-0004-safe-lite-modo-padrao.md` | aceita |
| 0005 | *draft* (`drafts/ADR_PROPOSAL_0005_…`) — **não** versionado como ADR final | proposta |
| 0006–0019 | `ADR-0006` … `ADR-0019` | aceitas, **sem duplicata de número** |

- **Índice canônico:** `docs/decisions/INDEX.md` em `origin/main`.
- **Maior número efetivamente ocupado (versionado):** **ADR-0019**.
- **Duplicidades versionadas:** **nenhuma**.
- **WIPs untracked de outras worktrees:** **não** são reserva de número e **não** foram lidos,
  copiados, renumerados nem excluídos por este GOAL.
- **Número escolhido:** **ADR-0020** (próximo livre após 0019).

---

## 1. Contexto

A ADR-0015 fechou o Gate G-F5 adotando integração **direta** com a SEFAZ em homologação, atrás de
um contrato provider-agnóstico. Seu §2.2 nomeia o método `emitir` de `FiscalProvider` (P1) como
destino do envelope assinado/validado.

A auditoria do GOAL-016D (PR #35) demonstrou que o repositório já tem **duas** superfícies:

| Superfície | Contrato | Papel real |
|---|---|---|
| **P1** | `FiscalProvider` (`lib/fiscal/provider/*`) | Configuração, snapshot, `statusServico`; emissão **simulada**/STUB |
| **P2** | `UncertainStateFiscalProvider` (`lib/fiscal/emission/uncertain-state*`) | **Única** superfície do caminho seguro de transmissão (ADR-0017) — bytes exatos + hash |

Registrar `SEFAZ_DIRETO` no `REGISTRY` de P1 — mesmo com `emitir` inerte — **não** isola o provider
real: o pipeline de emissão P1 consome numeração e grava `fiscalStatus` **antes** de chegar a
`emitir`. Além disso, o rótulo `simulado` é **declaratório**, não barreira mecânica.

O plano 016D (D11–D13) exige uma **ADR própria** antes de qualquer slice 016D-A0/016D-A, sem
reescrever a ADR-0015.

**Restrições obrigatórias desta ADR:**

- Somente documentação. **Zero código**, zero schema/migration, zero rede SEFAZ, zero segredo,
  zero certificado, zero CSC, zero `fiscalEnabled`, zero produção.
- Não alterar retroativamente a ADR-0015 (nem 0014, 0017, 0018).
- Não iniciar 016D-A0, 016D-A nem qualquer implementação de adapter.

**Estado atual relevante:**

- `REGISTRY` de P1 contém apenas `STUB_HOMOLOGACAO`; `resolveFiscalProvider(SEFAZ_DIRETO)` falha
  fechado com `provider_nao_implementado`.
- Coordenador ADR-0017 transmite via P2 com bytes persistidos e SHA-256.
- Union de incerteza atual: `TIMEOUT | CONNECTION_LOST | UNKNOWN` — sem `PROCESSING`/`THROTTLED`.

---

## 2. Decisão

Formalizar a **fronteira de execução** do provider SEFAZ direto e dos desfechos de estado incerto
associados, com as doze regras abaixo.

### 2.1 Transmissão real exclusivamente por P2

A transmissão de documento fiscal real ocorre **exclusivamente** por
`UncertainStateFiscalProvider.transmit`.

- Entrada: documento de identidade + `exactBytes` + `bytesSha256` (bytes **já** persistidos e
  conferidos pelo coordenador ADR-0017).
- O adapter **traduz e transporta**. Proibido no adapter: gerar/alterar XML, assinar, calcular
  tributo, alocar numeração, calcular chave, ler `Produto`/`Venda` vivos ou escrever no banco.

Isto **esclarece e restringe** a forma de execução da ADR-0015 §2.2: a **intenção** (envelope
imutável assinado/validado com hash e correlação) permanece; o **método nomeado** deixa de ser
`FiscalProvider.emitir` e passa a ser `UncertainStateFiscalProvider.transmit`.

### 2.2 `SEFAZ_DIRETO` fora do `REGISTRY` de P1

`SEFAZ_DIRETO` **nunca** será registrado no `REGISTRY` de `FiscalProvider` / P1
(`lib/fiscal/provider/resolver.ts`), em nenhum slice do 016D nem em evolução posterior sem **nova
ADR** que reabra explicitamente esta fronteira.

### 2.3 `resolveFiscalProvider` continua fail-closed para `SEFAZ_DIRETO`

`resolveFiscalProvider` permanece fail-closed para `SEFAZ_DIRETO` (`provider_nao_implementado`).
O provider real é **inalcançável** pelo pipeline de emissão P1 **por construção**.

### 2.4 Operações controladas por instanciação server-side direta

`statusServico` e demais operações controladas/administrativas usam **instanciação server-side
direta e dedicada** do adapter (import da classe + construção no módulo autorizado).

- Sem passar por `resolveFiscalProvider`.
- Sem mutar `ConfiguracaoFiscalLoja.provider` como efeito colateral de “ligar” o provider.
- Sem consumir numeração fiscal, sem alterar venda, sem gravar `fiscalStatus` de emissão.

### 2.5 Nenhum caminho P1 alcança o provider real com efeitos de emissão

Nenhum caminho P1 pode, para alcançar o provider real:

- consumir numeração (`allocateNumero` / série fiscal de NFC-e);
- alterar `Venda`;
- gravar `fiscalStatus` de emissão / transmissão.

A proteção primária é a **ausência no REGISTRY** (§2.2–2.3), não a inércia de `emitir`.

### 2.6 Envelope de identidade: `uf` e `correlationId` aditivos

`uf` e `correlationId` serão adicionados ao envelope de identidade documental
(`FiscalDocumentIdentity` ou equivalente) de forma **aditiva**, sem:

- reconstruir XML;
- recalcular chave de acesso;
- recalcular hash;
- alterar bytes persistidos.

### 2.7 `PROCESSING` = cStat 103/105

`PROCESSING` representa **cStat 103/105** (lote recebido / em processamento):

- **não** é rejeição, **não** é timeout genérico, **não** é falha definitiva;
- ação: **consulta do mesmo recibo/lote**, respeitando intervalos mínimos oficiais aplicáveis;
- ⛔ **sem retransmissão** — o lote já está com a SEFAZ;
- nota permanece `TRANSMITINDO`;
- preserva os mesmos bytes, a mesma chave e o mesmo hash.

### 2.8 `THROTTLED` = cStat 656

`THROTTLED` representa **cStat 656** (consumo indevido):

- nota permanece `TRANSMITINDO` (desfecho do documento continua desconhecido);
- ⛔ **pausa por loja/CNPJ**;
- ⛔ **sem retry** automático (fila, adapter ou backoff);
- ⛔ **sem consulta automática** que agrave o looping;
- ⛔ **sem reprocess direto** do job enquanto a pausa estiver ativa;
- retomada **somente** por ação humana explícita após diagnóstico;
- proibido mapear 656 como erro transitório (`transient`), `uncertain` genérico que agenda
  consulta, ou `terminal` reprocessável sem diagnóstico.

### 2.9 `simulado` não é controle de segurança

O campo `simulado` (P1 ou P2) é **rótulo de trilha / auditoria**. Nenhuma decisão de bloqueio de
segurança desta ADR se apoia nele. Um provider que se declare `simulado: true` e transmita de
verdade **não** é “seguro por tipo”.

### 2.10 Auditoria reflete o desfecho real

`simulado` e `externalTransmissionAttempted` (e equivalentes de trilha de execução) **devem
refletir o desfecho real da execução**, nunca valores literais fixos independentes do provider ou
do resultado.

### 2.11 Imutabilidade de bytes, chave e hash

Bytes assinados, chave de acesso e hash persistidos **permanecem imutáveis** em:

- consulta;
- estado incerto (`PROCESSING`, `THROTTLED`, `TIMEOUT`, etc.);
- eventual retransmissão **autorizada** (somente dos **mesmos** bytes, conforme ADR-0017).

Nenhuma reconstrução de XML durante retry.

### 2.12 Fora de escopo (permanecem fora desta ADR)

Produção, `tpAmb=1`, ativação de `fiscalEnabled`, QR Code, DANFCE, cancelamento, inutilização e
contingência **permanecem fora** desta ADR. Homologação **executada** (chamada real à SEFAZ) **não**
é autorizada aqui — apenas a fronteira documental para slices futuros.

### 2.13 Relação com ADRs existentes (sem reescrita)

| ADR | Relação |
|---|---|
| **ADR-0015** | **Não alterada.** Esta ADR **esclarece e restringe** a forma de execução do §2.2 (envelope via P2 `transmit`, não via P1 `emitir` + REGISTRY). |
| **ADR-0017** | **Preservada.** Estado incerto, consulta antes de retransmitir, bytes exatos. `PROCESSING`/`THROTTLED` **refinam** desfechos sem contradizer a máquina. |
| **ADR-0018** | **Preservada.** XML legal imutável; colunas primárias; sem purga. |
| **ADR-0014** | **Preservada.** Custódia de segredos / KMS; esta ADR não toca Vault, A1, CSC nem plaintext. |
| **ADR-0008 / 0009** | Continua a arquitetura satélite e o cofre por referência; sem mudança. |

**O que esta decisão NÃO inclui:**

- implementação de `SefazDiretoProvider`, transporte SOAP/TLS, catálogo de endpoints em código;
- alteração de TypeScript, Prisma, filas, workers ou rotas;
- chamada a Web Service, handshake, `?wsdl` ou qualquer rede SEFAZ;
- credenciamento, certificado real, CSC, senha ou env de produção;
- afrouxamento de T4 / fila de emissão;
- merge na `main` ou início de 016D-A0/A/B/C/D/E.

---

## 3. Alternativas consideradas

| Alternativa | Prós | Contras | Decisão |
|---|---|---|---|
| **A) P2-only + REGISTRY sem `SEFAZ_DIRETO` + instanciação direta para ops controladas** | Provider real inalcançável pelo pipeline P1; preserva ADR-0017/0018; fail-closed honesto | Exige caminho admin dedicado; `statusServico` não passa pelo resolver | **Escolhida** |
| B) Registrar `SEFAZ_DIRETO` no P1 com `emitir` inerte | Reutiliza resolver existente | Pipeline P1 ainda consome numeração/`fiscalStatus` antes de `emitir`; falsa sensação de isolamento | **Rejeitada** |
| C) Confiar em `simulado: true` como barreira | Zero mudança de registry | Tipo literal/boolean é declaratório; provider real compila e transmite se mentir o rótulo | **Rejeitada** |
| D) Reconstruir XML durante retry | “Corrige” documento rejeitado | Viola ADR-0017/0018; muda chave/hash; risco de duplicidade | **Rejeitada** |
| E) Mapear cStat 656 como erro transitório | Reaproveita backoff da fila | Agrava looping de consumo indevido; contradiz parada dura | **Rejeitada** |
| F) Fila administrativa em lote na primeira homologação | Opera várias notas de uma vez | Amplifica blast radius; mistura drenagem de lote com primeiro contato controlado | **Rejeitada** |

---

## 4. Consequências

### 4.1 Positivas

- Decisão **impossível de contornar pelo P1** enquanto o REGISTRY permanecer sem `SEFAZ_DIRETO`.
- Alinha o plano 016D (D11–D13) a uma ADR imutável sem reescrever a ADR-0015.
- Separa claramente: transmissão documental (P2) × status/config controlados (instanciação direta).
- Formaliza `PROCESSING` e `THROTTLED` sem autorizar rede ou homologação executada.

### 4.2 Negativas / Custos

- `statusServico` e smoke controlado exigem wiring admin dedicado (mais um caminho a auditar).
- Slices 016D-A0/A/B precisam implementar tipos aditivos e ramos de fila antes de qualquer prova
  externa.
- Documentação viva (`NFCE_ARCHITECTURE.md` §3.1) ainda pode descrever evolução em termos de P1 —
  follow-up de alinhamento, **fora** do escopo mínimo desta ADR se não for indispensável ao PR.

### 4.3 Riscos introduzidos

- **Wiring admin mal guardado** · mitigação: escopo fail-closed antes de qualquer efeito; zero
  `allocateNumero` / escrita em venda no caminho de status.
- **Confundir esta ADR com autorização de rede** · mitigação: §2.12 e esta seção — zero SEFAZ.
- **Mapear THROTTLED no kind errado da fila** · mitigação: proibições explícitas em §2.8; dono de
  implementação = slice 016D-B (futuro), não este GOAL.

### 4.4 O que muda imediatamente

- Surge **ADR-0020** versionada; índice canônico ganha a linha 0020.
- O plano `FISCAL_GOAL_016D_SEFAZ_ADAPTER_PLAN.md` referencia o número canônico e encerra o
  bloqueio documental D13 / FU-1b **deste** GOAL.
- **Nenhum** código, schema, segredo ou endpoint muda.

### 4.5 O que muda no longo prazo

- 016D-A0/A/B/C/D/E implementam sob esta fronteira (GOALs/sprints próprios, com gates humanos).
- Produção e G-F12 continuam bloqueados por ADRs e gates anteriores.

---

## 5. Plano de implementação

**Esta decisão é só arquitetura — implementação NÃO começa neste GOAL.**

| Item | Valor |
|---|---|
| Sprint / slices futuros | 016D-A0 → 016D-A → 016D-B → … (plano 016D) |
| Owner humano | Rafael Faria |
| Pré-requisito documental | **Este ADR (0020)** — satisfeito ao ser aceito/mergado |
| Pré-requisitos de execução | Gates humanos do plano 016D (credenciamento, CSC, IE, etc.) — **não** deste PR |
| Critério de pronto **deste** GOAL | ADR versionada · índice atualizado · PR documental aberto · zero código |

---

## 6. Validação / como saberemos que deu certo

- Diff do PR: **somente** arquivos sob `docs/` (decisions + plano fiscal indispensável).
- Número **0020** único no índice e no filesystem versionado.
- Texto declara explicitamente: zero código, zero segredo, zero SEFAZ, zero homologação executada.
- Referências a ADR-0014/0015/0017/0018 sem reescrita desses arquivos.
- `PROCESSING` ≠ retransmissão; `THROTTLED` ≠ transient/consulta automática.
- Links relativos do índice e do plano resolvem para o arquivo criado.

---

## 7. Referências

- ADRs relacionadas: ADR-0008, ADR-0009, ADR-0014, ADR-0015, ADR-0016, ADR-0017, ADR-0018, ADR-0019.
- Plano: [`docs/fiscal/FISCAL_GOAL_016D_SEFAZ_ADAPTER_PLAN.md`](../fiscal/FISCAL_GOAL_016D_SEFAZ_ADAPTER_PLAN.md) (D11, D12, D13).
- Índice: [`docs/decisions/INDEX.md`](./INDEX.md).
- Template: [`docs/decisions/TEMPLATE_ADR.md`](./TEMPLATE_ADR.md).
- **Não** reabre: produção, `tpAmb=1`, DANFCE, cancelamento, inutilização, contingência.

---

## 8. Notas / discussão

- A “divergência” com ADR-0015 §2.2 é de **método de entrega do envelope**, não de intenção
  semântica. Reescrever 0015 quebraria imutabilidade de ADR aceita; a disciplina correta é ADR nova.
- FU-1b: WIPs `ADR-0010/0011/0012` untracked na worktree primária **não** reservam número — os
  canônicos 0010–0012 já existem versionados com outros temas; os untracked são sombra local e
  permanecem intocados.
- Esta ADR **não** afirma que homologação foi realizada, que certificado foi provisionado, ou que
  qualquer Web Service foi contactado.
