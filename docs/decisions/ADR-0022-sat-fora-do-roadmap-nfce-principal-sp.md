---
title: ADR-0022 · NFC-e como trilha principal em SP; SAT/CF-e-SAT fora do roadmap ativo
status: aceita
data: 2026-08-19
autor: Grok (FISCAL-029-SAT-SP-REGULATORY-DECISION-070)
revisores: [revisão independente de outra família — ver dossiê]
hub: cross
tags: [fiscal, nfce, sat, sefaz-sp, roadmap, SAT_LOCAL]
superado_por:
substitui:
---

# ADR-0022 · NFC-e como trilha principal em SP; SAT fora do roadmap ativo

> **Status:** aceita
> **Decisão em uma frase:** para o OmniGestão Pro no Estado de São Paulo, a trilha fiscal de
> varejo é **NFC-e modelo 65**; **SAT/CF-e-SAT fica fora do roadmap ativo**; o enum
> `SAT_LOCAL` permanece no schema como valor **reservado/descartável**, **sem implementação**.

---

## 0. Numeração canônica (evidência)

Inventário dos ADRs versionados em `origin/main` no momento desta decisão
(`789c791327decd031fcbf2b185199762ea8b5489`):

| # | Situação |
|---|---|
| 0001 (legado) | `OS_ROUTE_OFICIAL.md` |
| 0002–0004, 0006–**0021** | arquivos `ADR-00xx-*.md` em `docs/decisions/` |
| 0005 | draft CoWork; **não** ocupa 0022 |
| **0022 / 0023** | **inexistentes** como ADR versionada |

O rótulo histórico **ADR-P14** em `docs/fiscal/FISCAL_CONTINUATION_ADRS_PROPOSTOS_001.md`
(tabela de 2026-07) aponta para “ativação controlada por loja / G-F7” e sugeria o número
0023. As linhas históricas **ADR-Pxx** desse mapa **não** reservam número canônico em
`docs/decisions/` (o draft 0005, este sim, ocupa o número no índice). Esta ADR **não** é a
proposta de ativação/G-F7. O GOAL FISCAL-029 usou “ADR-P14” só como identificação provisória
da **decisão SAT × NFC-e**.

**Número real:** **ADR-0022** (próximo livre após 0021).

---

## 1. Contexto

A frente Fiscal do OmniGestão já escolheu SEFAZ direta em homologação (ADR-0015) e o piloto
**Matriz RafaCell Assistec, Taguaí/SP, NFC-e modelo 65, `tpAmb=2`** (ADR-0016). O schema
ainda prevê `ModeloFiscal.SAT` e `FiscalProviderTipo.SAT_LOCAL`, e o roadmap listava
“NF-e 55 e SAT (SP)” como funcionalidade futura. O enum existe; **a implementação SAT não**.

A trilha NFC-e avança à parte. H-9/H-10 e o PR **#73** permanecem estacionados por
credencial/runtime — **intocados**. Sem decisão regulatória, o próximo GOAL poderia
interpretar `SAT_LOCAL` como débito de implementação.

Em 2026-08-19 as fontes oficiais da SEFAZ-SP, da SRE e do CONFAZ (dossiê
[`FISCAL_SAT_NFCE_SP_REGULATORY_DOSSIER_029.md`](../fiscal/FISCAL_SAT_NFCE_SP_REGULATORY_DOSSIER_029.md))
mostram que a **emissão do CF-e-SAT está vedada desde 01/01/2026** e que a NFC-e é o
documento de varejo paulista.

**Restrições desta ADR:**

- Somente documentação. **Zero código**, zero schema/migration, zero rede SEFAZ, zero
  segredo, zero H-9/H-10, zero #73.
- Não reabre ADR-0008, 0015, 0016, 0020.
- Não autoriza produção, `fiscalEnabled`, contingência implementada nem NF-e 55.

**Estado atual relevante:**

- `docs/ai/CURRENT_STATUS.md`: frente Fiscal com N6=0, N7=0; emissão dormente.
- `docs/roadmaps/ROADMAP_FISCAL.md`: NFC-e primeiro; item 5 ainda citava SAT como futuro.
- Q-10 do GOAL-015 (2026-07-23) já descrevia a vedação; este GOAL **revalida** em 2026-08-19
  e corrige a contingência (CAT 12/2015 revogada pela SRE 40/2024).

---

## 2. Decisão

Adota-se a **opção A** do GOAL FISCAL-029:

1. **NFC-e modelo 65** permanece a trilha principal do piloto SP para PDV a consumidor
   (substituição do SAT também admite NF-e 55 quando a operação o exigir; isso não reabre SAT).
2. **SAT / CF-e-SAT / `SAT_LOCAL` saem do roadmap ativo.** Nenhum GOAL futuro implementa
   adapter SAT, hardware SAT, AC SAT ou emissão modelo 59 sem **nova** ADR fundada em ato
   oficial posterior.
3. **`SAT_LOCAL` fica classificado como reservado/descartável:** o valor pode continuar no
   enum Prisma; **não** se implementa; **não** se seleciona para o piloto; remoção do enum
   exige autorização explícita de schema (área protegida).
4. Contingência do piloto, quando existir, é **contingência NFC-e** (Ajuste SINIEF 19/16,
   cláusula 11, via Portaria SRE 40/2024) — **não** SAT.

**Detalhamento operacional:**

- Resolver de provider que receba `SAT_LOCAL` continua falhando fechado
  (`provider_nao_implementado`) — comportamento já existente; este ADR não pede código.
- `ModeloFiscal.SAT` segue a mesma disciplina: valor de schema, não autorização de uso.
- NF-e modelo 55 permanece evolução **separada** (B2B), não substituta de SAT no PDV.

**O que esta decisão NÃO inclui:**

- Implementação de NFC-e, contingência, DANFCE, fila, provider SEFAZ.
- Declaração do método atual de emissão da RafaCell (H-5).
- Dispensa MEI / produtor rural (fora do piloto).

---

## 3. Alternativas consideradas

| Alternativa | Prós | Contras | Por que não escolhida |
|---|---|---|---|
| A) NFC-e principal; SAT fora do roadmap ativo **(escolhida)** | Alinhada ao art. 34-D, ao Comunicado SRE 06/2025, às RC 2025/2026 e ao portal SAT (erro 1001); evita trabalho inábil | Enum `SAT_LOCAL` permanece até limpeza de schema | — |
| B) NFC-e principal; SAT “legado” para compatibilidade futura | Preservaria um gancho de produto | Não há legado SAT no sistema; “futuro” em SP exigiria revogar o 34-D; o gancho vira convite a implementar o ilegal | Evidência oficial não descreve regime legado de emissão |
| C) Implementar SAT | Útil só se a lei obrigasse | Cupom inválido (erro 1001); documento inábil (RC 33856/2026); hardware e AC sem efeito jurídico | Contraria as fontes oficiais |
| D) Evidência insuficiente | Evitaria decidir cedo | Fontes oficiais de 2024–2026 convergem, inclusive atos **posteriores** ao corte | Lacuna não constatada |

Não se escolheu por preferência de produto. A opção A é a única compatível com o dossiê.

---

## 4. Consequências

### 4.1 Positivas

- Fecha o risco de um GOAL futuro gastar ciclo em SAT_LOCAL.
- Confirma ADR-0016 (NFC-e 65 / SEFAZ-SP) como **trilha principal escolhida para o piloto**,
  alinhada à obrigatoriedade de substituição do SAT no varejo paulista.
- Contingência deixa de ser argumento para hardware SAT.

### 4.2 Negativas / custos

- Loja que ainda tenha SAT físico não ganha integração no OmniGestão — e **não deve** emitir
  por ele (regularização, se houver emissão 2026, é SIPET/contador, não software).
- Enum órfão no schema até limpeza autorizada.

### 4.3 Riscos introduzidos

- Interpretação “enum existe ⇒ implementar” · mitigação: esta ADR + dossiê + roadmap.
- Ato oficial futuro reabre SAT · mitigação: §8 (reabertura explícita).

### 4.4 O que muda imediatamente

- Arquivos: este ADR; dossiê `docs/fiscal/FISCAL_SAT_NFCE_SP_REGULATORY_DOSSIER_029.md`;
  ponteiros em `docs/decisions/INDEX.md`, `docs/roadmaps/ROADMAP_FISCAL.md`,
  `docs/architecture/FISCAL_SCHEMA_DESIGN.md`.
- Código: **nada**.
- Outras decisões: ADR-0008/0015/0016/0020 **intocadas**.

### 4.5 O que muda no longo prazo

- Roadmap Fiscal deixa de listar SAT (SP) como entrega. NF-e 55 permanece candidata B2B.
- Eventual `DROP` do valor de enum só após ADR de schema + autorização humana.

---

## 5. Plano de implementação

**Esta decisão é só decisão — implementação SAT não haverá no roadmap ativo.**

- Sprint SAT: **nenhuma**.
- Owner humano: Rafael Faria (aceite da ADR).
- Pré-requisito: leitura do dossiê 029 e deste ADR.
- Critério de pronto da “implementação”: **não implementar SAT**; manter a trilha NFC-e
  já em curso, sem desviar para H-9/H-10/#73.

---

## 6. Validação / como saberemos que deu certo

- Nenhum GOAL posterior a esta ADR inicia adapter `SAT_LOCAL` sem citar ato oficial novo.
- Roadmap Fiscal deixa de tratar SAT como item 5 ativo.
- `git diff` deste GOAL permanece só em `docs/**`.
- Janela: permanente, até ato da §8.

---

## 7. Referências

- Dossiê: `docs/fiscal/FISCAL_SAT_NFCE_SP_REGULATORY_DOSSIER_029.md`
- ADRs: ADR-0008, ADR-0015, ADR-0016, ADR-0020
- Q-10 histórica (superada neste ponto pela revalidação 2026-08-19):
  `docs/fiscal/FISCAL_SEFAZ_DOSSIE_UF_001.md` §5
- Fontes oficiais principais: Portaria SRE 79/2024; Portaria SRE 92/2024; Comunicado SRE
  06/2025; RC 32089/2025; RC 33856/2026; Portaria SRE 40/2024; Ajuste SINIEF 19/16;
  portal NFC-e SP; portal SAT SP (avisos 2026)

---

## 8. Condições para reabrir

Reabrir **somente** se, depois de 2026-08-19, existir ato oficial que:

1. revogue ou suspenda o art. 34-D da Portaria CAT 147/2012; **ou**
2. autorize SAT como contingência NFC-e **utilizável em SP** apesar do 34-D; **ou**
3. imponha SAT ao perfil do piloto (varejo paulista de assistência técnica).

UF distinta (ex.: MFE/CE) = ADR nova. Importação somente leitura de XML SAT de terceiro =
ADR nova, **não** implementação de `SAT_LOCAL` emissor.

---

## 9. Notas / discussão

- Art. 34-C (vedação de **novos** SAT) foi revogado em dez/2024. Isso **não** reabre emissão.
  Ativar equipamento em 2026 continua inútil: o autorizador devolve erro 1001.
- Manter o equipamento vinculado **sem desativar** (aviso SEFAZ 23/03/2026) ≠ permissão de
  emitir.
- A cláusula 11, II, do Ajuste SINIEF 19/16 ainda menciona SAT “a critério da UF”. O critério
  paulista vigente é o 34-D: emissão vedada. Não se implementa o inciso II em SP.
- Status `aceita`: o GOAL 070 fechou a Opção A; o GOAL 071 registrou o aceite humano
  sem alterar fundamentos, fontes, alternativas ou a decisão técnica.
