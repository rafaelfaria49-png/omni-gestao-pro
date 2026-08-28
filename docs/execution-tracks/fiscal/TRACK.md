<!-- AEP:TRACK
{
  "completion_when_empty": "PAUSED"
}
-->

# Trilha `fiscal`

Trilha de execução fiscal NFC-e (SEFAZ-SP, modelo 65, homologação). Distinta da trilha `contador`.

## Objetivo

Fechar o ciclo fiscal da NFC-e em homologação: emissão, consulta, eventos (cancelamento),
numeração/inutilização, DANFCE e operação segura — sem produção (`tpAmb=1`) e sem SAT.

## Escopo — paths_base (gramática limitada: "a/b/c/arquivo.ext" ou "a/b/c/**")

- lib/fiscal/**
- app/api/fiscal/**
- docs/fiscal/**
- docs/architecture/FISCAL_EVENTS.md
- docs/architecture/NFCE_ARCHITECTURE.md
- docs/decisions/**

## Fora de escopo

- Inutilização, CC-e, contingência, DANFCE, produção e SAT neste GOAL 018.
- Contador HUB (trilha `contador`).
- Auth, `proxy.ts`, `prisma/schema.prisma` e migrations.
- Financeiro/Caixa como efeito colateral de evento fiscal.

## Comando de teste da trilha

```
npx vitest run lib/fiscal/events lib/fiscal/provider/sefaz/sefaz-cstat-matrix.test.ts lib/fiscal/provider/sefaz/sefaz-direto-provider.test.ts lib/fiscal/provider/provider.test.ts lib/fiscal/venda-fiscal-state-machine.test.ts app/api/fiscal --reporter=dot
```

## Gates extras exigidos por esta trilha

- G-F5 (provider) — já decidido (SEFAZ direto).
- G-F7 (ativação loja-piloto homologação) — não é deste GOAL.
- G-F12 (produção) — proibido.

## Branch e worktree

- padrão de branch: `goal/fiscal-NNN-<slug>`
- padrão de worktree: `C:/Projetos/omni-gestao-fiscal-NNN-<slug>`

## Plano de origem

- plan_ref: FISCAL-FABLE5-CONTINUATION-MASTERPLAN-001
- plan_rev: 1

## Estado

O estado ratificado vive em `state.json` (derivado) e `LEDGER.jsonl` (append-only).
Não edite nenhum dos dois à mão: `node scripts/track.mjs verify` detecta a divergência.
