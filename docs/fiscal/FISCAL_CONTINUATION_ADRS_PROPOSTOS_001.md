# Mapeamento de ADRs fiscais propostas — reconstrução reconciliada

> **Proveniência:** reconstrução do pacote Fable 5 ausente. A tabela original propunha numeração e
> não criava ou aceitava ADRs. Em 14/07/2026, o checkpoint humano
> `FISCAL-XSD-ADR-P01-DECISION-002A` formalizou a primeira decisão desse conjunto como ADR-0010.
> ADR-0003, ADR-0008 e ADR-0009 permanecem aceitas e intocadas.

Na base histórica, o maior número aceito era ADR-0009. A nova ADR-0010 foi escolhida após busca em
`origin/main` e em todas as branches remotas em 14/07/2026; nenhuma ADR-0010 ou superior existia.
Propostas não reservam números globais: cada criação futura deve recalcular o próximo número livre.

| Proposta | Número real reservado | Tema | Estado |
|---|---:|---|---|
| ADR-P01 (histórico reconstruído) | — | autoridade e matriz tributária do mix piloto | proposta preservada, sem número real após a ocupação legítima da ADR-0010; remapear em GOAL próprio |
| ADR-P01 (checkpoint GOAL-002) | **ADR-0010** | validação XSD fiscal em worker containerizado com `xmllint` provisionado | **aceita por Rafael em 14/07/2026**; [`ADR-0010`](../decisions/ADR-0010-validacao-xsd-worker-containerizado-xmllint-provisionado.md) |
| ADR-P02 | ADR-0011 (provisório) | proveniência/versionamento de XSD fiscal | proposta; parte do escopo foi incorporada à ADR-0010, reavaliar antes de criar |
| ADR-P03 | ADR-0012 | biblioteca/estratégia C14N e XMLDSig | proposta |
| ADR-P04 | ADR-0013 | critério normativo de dry-run verde | proposta |
| ADR-P05 | ADR-0014 | escolha SEFAZ direto × gateway | proposta; gate G-F5 |
| ADR-P06 | ADR-0015 | custódia do A1 quando o provider hospeda certificado | proposta; compatível com ADR-0009 |
| ADR-P07 | ADR-0016 | persistência e retenção de XML autorizado | proposta |
| ADR-P08 | ADR-0017 | estado incerto e reconciliação por chave | proposta |
| ADR-P09 | ADR-0018 | política de retry, backoff e dead-letter fiscal | proposta |
| ADR-P10 | ADR-0019 | cancelamento, inutilização e consumo de numeração | proposta |
| ADR-P11 | ADR-0020 | contingência offline | proposta |
| ADR-P12 | ADR-0021 | DANFCE, impressão e reimpressão | proposta |
| ADR-P13 | ADR-0022 | observabilidade, auditoria e retenção de logs | proposta |
| ADR-P14 | ADR-0023 | ativação controlada por loja e rollback | proposta; gate G-F7 |

**Nota 2026-08-19 (FISCAL-029):** o GOAL SAT×NFC-e usou o rótulo provisório “ADR-P14” para a
**decisão regulatória SAT × NFC-e em SP**. Esse tema **não** é a linha ADR-P14 desta tabela
(ativação/G-F7). As linhas históricas **ADR-Pxx** desta tabela **não** reservam número
canônico em `docs/decisions/`. A decisão SAT×NFC-e recebeu o próximo
livre real: **ADR-0022**
([`ADR-0022-sat-fora-do-roadmap-nfce-principal-sp.md`](../decisions/ADR-0022-sat-fora-do-roadmap-nfce-principal-sp.md),
status **proposta**). A linha ADR-P14/ativação acima permanece proposta, ainda sem arquivo ADR.
**Zero código.**

## Reconciliação do identificador ADR-P01

O pacote reconstruído de 13/07/2026 usava ADR-P01 para autoridade tributária e ADR-P02 para XSD.
O checkpoint posterior do GOAL-002 também nomeou sua decisão de validador como ADR-P01 e aprovou
expressamente B2. Para não apagar nenhuma evidência:

- o rótulo histórico tributário continua visível, mas sem número global reservado;
- o rótulo ADR-P01 **escopado ao checkpoint XSD** recebe o próximo número real livre, ADR-0010;
- ADR-P02 continua apenas provisória e deve ser revista porque a ADR-0010 já cobre proveniência,
  hashes e atualização do motor/schemas;
- não há duas ADRs reais com o mesmo número e nenhuma decisão aceita anterior foi alterada.

Antes de criar cada nova ADR, repetir a busca de colisão na `origin/main` atual e nas branches
remotas relevantes. Não reservar número por branch futura e não reabrir decisões já aceitas.
