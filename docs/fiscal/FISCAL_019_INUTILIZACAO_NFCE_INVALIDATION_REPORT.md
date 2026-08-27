# FISCAL-NFCE-INVALIDATION-019 — Relatório de fechamento interno

## Identificação

- GOAL: `FISCAL-NFCE-INVALIDATION-019`
- Branch: `goal/fiscal-019-nfce-inutilizacao`
- Worktree: `C:/Projetos/omni-gestao-fiscal-019-inutilizacao`
- Trilha AEP: `fiscal` (ativada com `scripts/track.mjs init` + `import` + `open`)
- Base: `origin/main` (`a2bf6b0179b1b4f1468fd0f023ce569326d30dfe`)

## Doutrina fechada

Número fiscal consumido ou descartado por política **nunca volta ao pool**. A inutilização é o
contraponto da numeração atômica do GOAL 010.

Fluxo pós-rejeição definitiva:

1. nota/número anterior permanece histórico (`vigente=false`, status `REJEITADA`);
2. número vai para inutilização (`mark=A_INUTILIZAR` no job `INUTILIZACAO`);
3. reemissão da venda usa novo número e nova `NotaFiscal` vigente.

A marca local `A_INUTILIZAR` só é baixada (`INUTILIZADO`) após `cStat 102` com protocolo válido.
Falha/rejeição do pedido de inutilização **preserva** a marca.

## Regras oficiais SP (NFC-e)

Fonte já consolidada no repositório: `docs/fiscal/FISCAL_SEFAZ_DOSSIE_UF_001.md` Q-05
(Portaria CAT 12/2015 art. 15). Sem delta:

| Campo | Valor |
|---|---|
| Serviço | `NFeInutilizacao4` |
| Sucesso | `cStat 102` + protocolo |
| Justificativa | 15–255 caracteres |
| Faixa | `nNFIni` ≤ `nNFFin`; teto 10.000 números |
| Prazo legal | até o 10º dia do mês subsequente (operação interna não calendário) |
| 241 | número da faixa já utilizado |
| 256/563 | faixa já inutilizada / pedido duplicado |

## Integração (sem segunda arquitetura)

- Numeração: lacunas `requerInutilizacao=true` geram job via `recordLacunasParaInutilizacao`.
- Reconciliador `REJEITADA` + `requiresInutilizacao` enfileira o mesmo job.
- Worker da fila passa a executar `INUTILIZACAO` (antes: `tipo_nao_suportado`).
- Adapter `SefazDiretoProvider.inutilizar` monta `inutNFe`, envelopa SOAP e usa o transporte injetado.
- Stub/homologação simulada continua o double dos GOALs 010–013.
- Admin: `POST /api/fiscal/inutilizacao` e ação interna `inutilizar` na fila.

## G-C7

Avaliação contra o estado real:

| GOAL | Contrato | Testes |
|---|---|---|
| 010 numeração | alocação atômica, lacuna, nunca reutiliza | verdes |
| 011 job/outbox | fila idempotente, lock, admin reprocess | verdes |
| 012 estado incerto | REJEITADA + matriz `requiresInutilizacao` | verdes |
| 013 XML/protocolo | persistência de protocolo/XML autorizado | verdes (pré-existente) |
| 019 inutilização | marca, job, protocolo, reemissão, adapter | verdes |

**G_C7_STATUS = FECHAVEL_INTERNO** — contratos e testes internos sustentam a doutrina. **Não** é
N6/N7: não houve inutilização real na SEFAZ nesta execução.

## Homologação externa

H-9/H-10 e autorização de transmissão real **não** estavam vigentes nesta worktree. Ciclo interno
coberto por testes (rejeição → inutilizar → protocolo stub 102 → reemitir → novo número).

`HOMOLOGATION_STATUS=internal-only`
`REMAINING_EXTERNAL_GATE=SEFAZ homologação ao vivo (017/H9-H10 + auth A1)`

## Closeout da execução final (2026-08-27)

Revisão independente final por outra família sobre o head `8b6a581` + correções na mesma branch:

| Achado | Classe | Correção |
|---|---|---|
| Atalho "EventoFiscal AUTORIZADO" baixava faixa sem vínculo com a nota/número do job (protocolo de outra faixa podia baixar sem transmissão) | P0 | `execute.ts` exige `nota.serie/numero === payload (faixa de 1)` antes de baixar; sem vínculo, transmite |
| Freio GOAL-011 reescrevia resultado real de INUTILIZACAO como `provider_real_bloqueado` (falso `lock_perdido` na drenagem; cStat real mascarado) | P1 | `queue-worker.ts`: `INUTILIZACAO` isenta do freio; EMISSAO/CONSULTA continuam freados |
| `createInutilizacaoXmlSigner` tipada como `string \| Promise<string>` quebrava o tsc do CI (6 erros TS) | P1 | factory tipada como síncrona `(xml: string) => string` |
| EventoFiscal persistido a partir de resposta simulada | P2 | evento só nasce de transmissão real |
| Lacunas da alocação na reemissão não eram inutilizadas | P2 | `reissue.ts` enfileira job `lacuna_numeracao` (idempotente por dedupe) |
| `SignedInfo` aceitava mais de uma `Reference` | P2 | validação estrutural exige exatamente uma |
| Enqueue de lacunas da emissão podia abortar o pipeline | P2 | try/catch + log de compensação (`fiscal.inutilizacao.enqueue_failed_after_gap`) |

G-C7 reavaliado com o estado final: mantém **FECHAVEL_INTERNO** — os contratos internos de
010/011/012/013/019 e suas suítes sustentam a doutrina sem reutilização de número. O que resta é
exclusivamente o gate externo de homologação SEFAZ ao vivo (H-9/H-10 + A1), que não impede o
merge da implementação interna.
