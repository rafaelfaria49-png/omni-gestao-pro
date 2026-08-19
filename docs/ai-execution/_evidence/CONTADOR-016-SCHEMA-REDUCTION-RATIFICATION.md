# CONTADOR-016 — ratificação de reduções de schema

GOAL: `CONTADOR-HUB-OBRIGACOES-GUIAS-016`
Task: `CONTADOR-016-INDEPENDENT-REVIEW-FIXES-002`

`SCHEMA_REDUCTION_RATIFICATION_REQUIRED=true`

Comparação do schema implementado (Prisma + migration 0017) contra COMMANDS 16/19 e masterplan §11. PLAN REV2 não existe como arquivo nomeado no repositório; a implementação vigente (tipo enumerado, dia 1..31, `criadoPorTipo`/`criadoPorId`, `origem` da guia, `descricao` opcional em template/obrigação) é o contrato efetivo autorizado pelo gate G-DADOS-SCHEMA.

Roadmap mínimo (não negociável): agenda manual, guia informada, valor/vencimento, PDF/comprovante, pagamento, zero cálculo fiscal.

## Classificação

| Diferença | Classe | Decisão |
|---|---|---|
| Obrigação: `responsavel` ausente | B | Autoria = `criadoPorTipo`/`criadoPorId`. Microcopy não exige coluna. |
| Obrigação: `observacao` ausente | B | `descricao` opcional cobre nota livre. |
| Guia: `descricao` ausente | B | Título + valor + vencimento satisfazem guia informada. |
| Guia: `tipoInformado` ausente | B | Evita domínio fiscal. Tipo operacional na obrigação; `origem` na guia. |
| `informadoPor*` vs `criadoPor*` | B | Mesma semântica; nomenclatura unificada. |

Nenhuma diferença é classe A (necessária ao roadmap) nem C (esquecimento). Schema **não** foi ampliado nesta correção.

Campos do masterplan fora do mínimo (`lembrete`, `dataRealizada`, documento associado na obrigação, recorrência `trimestral`/`anual`) também são classe B e permanecem fora.
