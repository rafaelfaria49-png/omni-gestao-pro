<!-- AEP:TRACK
{
  "completion_when_empty": "PAUSED"
}
-->

# Trilha `fiscal`

Trilha AEP da frente Fiscal NFC-e (SEFAZ-SP, homologação). Criada para executar o GOAL 019
(`FISCAL-NFCE-INVALIDATION-019`) sem misturar com a trilha `contador`.

## Objetivo

Fechar a inutilização fiscal de número/faixa consumida e a doutrina
**número consumido nunca é reutilizado**, reusando os contratos de numeração (010),
fila/outbox (011), estado incerto (012) e XML/protocolo (013).

## Escopo — paths_base (gramática limitada: "a/b/c/arquivo.ext" ou "a/b/c/**")

- lib/fiscal/**
- app/api/fiscal/**
- app/api/internal/fiscal/**
- scripts/fiscal/**
- docs/fiscal/**
- docs/ai/CURRENT_STATUS.md
- docs/ai-execution/_evidence/**
- docs/execution-tracks/fiscal/**

## Fora de escopo

- Merge na main.
- Schema/migration (`prisma/schema.prisma`, `prisma/migrations/**`).
- Auth/proxy.
- GOAL 018 (cancelamento) em branch paralela.
- Produção / `tpAmb=1` / `fiscalEnabled` de loja-piloto.
- Cancelamento de NFC-e autorizada, DANFCE, contingência, multi-UF.

## Comando de teste da trilha

```
npx vitest run lib/fiscal/inutilizacao lib/fiscal/numbering/numbering.test.ts lib/fiscal/queue/prisma-queue-worker.test.ts lib/fiscal/queue/queue-admin.test.ts lib/fiscal/reconciliation/uncertain-reconciler.test.ts lib/fiscal/provider/sefaz/sefaz-direto-provider.test.ts
```

## Gates extras exigidos por esta trilha

- sefaz_homologacao (externo; H-9/H-10)
- schema (não liberado neste GOAL)
- production (não liberado)

## Branch e worktree

- padrão de branch: `goal/fiscal-<nnn>-<slug>`
- padrão de worktree: `C:/Projetos/omni-gestao-fiscal-<nnn>`

## Plano de origem

- plan_ref: `FISCAL-FABLE5-CANONICAL-ROADMAP`
- plan_rev: 1

## Estado

O estado ratificado vive em `state.json` (derivado) e `LEDGER.jsonl` (append-only).
Não edite nenhum dos dois à mão: `node scripts/track.mjs verify` detecta a divergência.
