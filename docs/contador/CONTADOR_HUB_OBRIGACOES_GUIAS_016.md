# Contador HUB · Obrigações e Guias (GOAL 016)

Implementação local da agenda **100% manual/informada**.

- Schema aditivo: `ContadorObrigacaoTemplate`, `ContadorObrigacao`, `ContadorGuia` + 3 enums.
- Migration: `prisma/migrations/0017_contador_agenda` (em `main` no merge do PR #80, commit `abf21166`; apply Production pelo `prisma migrate deploy` do build canônico `omni-gestao-pro`, evidência em `docs/ai-execution/_evidence/CONTADOR-016-PRODUCTION-MIGRATION.md`).
- Recorrência: `mensal` ativo entra em «Gerar deste mês»; `nenhuma` só por seleção explícita.
- Sem cálculo fiscal, sem cron, sem `vencido` persistido, sem backfill.
- Status da obrigação reutiliza a matriz 011. Guia paga = `pagaEm`.
- Documentos 010 apenas referenciados (mesma loja + competência).
- Escrita de templates (POST/PATCH/DELETE): capacidade `podeConferir` (financeiro/admin). GET de templates: escopo normal do HUB.

Microcopy permanente: **informado pelo responsável**.

## Ratificação de reduções de schema (revisão independente)

`SCHEMA_REDUCTION_RATIFICATION_REQUIRED=true`

O roadmap mínimo exigido permanece: agenda manual, guia informada, valor/vencimento, PDF/comprovante, pagamento e zero cálculo fiscal. O schema atual cobre esse mínimo. Nenhum campo abaixo foi adicionado; nenhum amplia domínio fiscal.

| Diferença vs COMMANDS / masterplan §11 | Classe | Motivo |
|---|---|---|
| `ContadorObrigacao.responsavel` | B | Autoria tipada já existe (`criadoPorTipo`/`criadoPorId`). O rótulo «informado pelo responsável» é microcopy, não coluna. |
| `ContadorObrigacao.observacao` | B | Coberto por `descricao` opcional. |
| `ContadorGuia.descricao` / observação | B | Guia informada exige título + valor + vencimento; descrição extra não é critério. |
| `ContadorGuia.tipoInformado` | B | Classificação fiscal implícita. Tipo operacional vive na obrigação; `origem` já registra `manual`/`contador`. |
| `informadoPorTipo`/`informadoPorId` vs `criadoPorTipo`/`criadoPorId` | B | Nomenclatura. Semântica idêntica; `criadoPor*` é consistente nos três models. |

Classe A = necessário ao roadmap mínimo. Classe B = opcional, removido formalmente do desenho. Classe C = campo necessário esquecido.

Nenhuma diferença é classe A ou C. Schema e migration 0017 permanecem como estão.
