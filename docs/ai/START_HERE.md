# START HERE — OmniGestão Pro (entrada obrigatória para chats e agentes de IA)

> Documento curto. Não duplica regras — só aponta para onde elas vivem.

## Leitura obrigatória antes de qualquer trabalho

1. **`docs/ai/START_HERE.md`** (este arquivo).
2. **`docs/ai/CURRENT_STATUS.md`** — estado real atual de cada módulo.
3. **`docs/memory/OMNIGESTAO_MASTER_MEMORY.md`** — memória viva consolidada.

Além destes três, siga a governança detalhada em [`docs/skills/INDEX.md`](../skills/INDEX.md)
e as regras inegociáveis em [`docs/skills/rules/CORE_RULES.md`](../skills/rules/CORE_RULES.md).

## Regras gerais

- Todo chat relacionado ao OmniGestão Pro deve permanecer dentro do projeto OmniGestão Pro.
- Antes de analisar, planejar ou executar, ler os três documentos obrigatórios acima.
- Respeitar o escopo exclusivo do módulo ou GOAL atual.
- Não investigar, incorporar, descartar ou modificar trabalhos paralelos (outras branches/worktrees).
- Não alterar produção, Git, banco ou infraestrutura sem autorização expressa do usuário.

## Política curta do Neon

- `omnigestao_prod` é o banco oficial de produção.
- Apenas a Vercel Production pode usar `omnigestao_prod`.
- Preview, desenvolvimento, worktrees e agentes devem usar `omnigestao_prod_candidate`.
- Padrão: **não consultar o banco** quando análise de código, documentação, mocks ou testes
  locais forem suficientes.
- Produção só pode ser consultada quando o GOAL autorizar expressamente.
- Escrita em produção exige gate humano explícito.
- Proibido executar `prisma db push` em produção.
- Proibido executar `migrate deploy`, migrations ou scripts destrutivos sem GOAL específico.
- Evitar `SELECT *`, consultas repetidas, polling, dumps e auditorias completas sem necessidade.
- Todo relatório deve informar se acessou banco, qual ambiente e por qual motivo.

## Modelo curto para abrir novo chat

Use exatamente este modelo ao abrir um novo chat ou agente:

```
Este chat pertence ao projeto OmniGestão Pro.

Antes de iniciar, leia:
- docs/ai/START_HERE.md
- docs/ai/CURRENT_STATUS.md
- docs/memory/OMNIGESTAO_MASTER_MEMORY.md

Siga as políticas e bloqueios indicados nesses documentos.
Não acesse o banco Neon sem necessidade expressa do GOAL.

Neste chat trataremos exclusivamente de: [INFORMAR MÓDULO OU ASSUNTO].
```
