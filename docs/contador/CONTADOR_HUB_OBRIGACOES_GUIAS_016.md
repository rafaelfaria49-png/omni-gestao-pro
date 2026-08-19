# Contador HUB · Obrigações e Guias (GOAL 016)

Implementação local da agenda **100% manual/informada**.

- Schema aditivo: `ContadorObrigacaoTemplate`, `ContadorObrigacao`, `ContadorGuia` + 3 enums.
- Migration: `prisma/migrations/0017_contador_agenda` (não aplicada em Production nesta entrega).
- Recorrência: `mensal` ativo entra em «Gerar deste mês»; `nenhuma` só por seleção explícita.
- Sem cálculo fiscal, sem cron, sem `vencido` persistido, sem backfill.
- Status da obrigação reutiliza a matriz 011. Guia paga = `pagaEm`.
- Documentos 010 apenas referenciados (mesma loja + competência).

Microcopy permanente: **informado pelo responsável**.
