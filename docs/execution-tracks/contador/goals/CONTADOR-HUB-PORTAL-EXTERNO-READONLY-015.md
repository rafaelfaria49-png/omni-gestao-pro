<!-- AEP:META
{
  "aep": "1.0-R2",
  "id": "CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015",
  "track": "contador",
  "title": "Portal externo read-only do contador",
  "status": "READY",
  "class": "C2",
  "risk_tier": "ALTO",
  "branch": "goal/contador-015-portal-externo-readonly-recovery",
  "worktree": "C:/Projetos/contador-015-portal-externo-readonly",
  "test_command": "npm run typecheck",
  "allowlist": [
    "app/contador-externo/**",
    "app/api/contador-externo/**",
    "components/contador-externo/**",
    "lib/contador/portal/**",
    "lib/contador/scope-core.ts",
    "proxy.ts",
    ".env.example",
    "docs/contador/**",
    "docs/status/MOCKS_TRACKING.md",
    "docs/ai-execution/_evidence/**"
  ],
  "gates_liberados": [],
  "read_budget": 60,
  "plan_ref": "CONTADOR-HUB-FABLE5-MASTERPLAN-001",
  "plan_rev": 1,
  "familia_executor": null,
  "revisao_independente": false,
  "reversibilidade": null,
  "gates_extra": [
    {
      "id": "main",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "schema",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "migration",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "auth_externa",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "storage_r2_preview",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "storage_r2_production",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "fiscal_readonly",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "portal_legado",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "dados_destrutivos",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "secrets",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "deploy",
      "status": "pendente",
      "dependencias": []
    }
  ]
}
-->

# CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 — Portal externo read-only do contador

- trilha: `contador`
- classe: C2 · status: READY
- plano: `CONTADOR-HUB-FABLE5-MASTERPLAN-001` (plan_rev 1)
- branch: `goal/contador-015-portal-externo-readonly`
- teste: `npm run typecheck`

## Fontes (documentos de origem — o importador NÃO reimplementa nada)

- `comandos`: `import/contador/COMANDOS.md`
- `masterplan`: `import/contador/MASTERPLAN.md`
- `relatorios`: `import/contador/reports/`
- `resumo_canonico`: `import/contador/RESUMO.md`

## Allowlist

- `app/contador-externo/**`
- `app/api/contador-externo/**`
- `components/contador-externo/**`
- `lib/contador/portal/**`
- `lib/contador/scope-core.ts`
- `proxy.ts`
- `.env.example`
- `docs/contador/**`
- `docs/status/MOCKS_TRACKING.md`
- `docs/ai-execution/_evidence/**`

## Recuperação da tentativa (mesma tentativa, não um GOAL novo)

A primeira execução parou por esgotamento de cota durante a fase 3 e a worktree
`C:/Projetos/contador-014-identidade-convite` foi removida do disco antes de o
código ser commitado. O WIP das fases 1 e 2 foi recuperado do transcript da
sessão do executor (42 arquivos reconstruídos por replay das chamadas de escrita,
zero falha de replay) e reaplicado sobre `origin/main` `9068263` em worktree e
branch novos — sem reset, sem force e sem apagar a branch anterior, que segue
intacta em `goal/contador-015-portal-externo-readonly`.

## Critério de pronto

1. Portal externo disponível apenas atrás de `CONTADOR_PORTAL_V2`.
2. Flag default off.
3. Flag off torna páginas e APIs de dados do portal inacessíveis.
4. Autenticação exclusivamente pela sessão externa criada no GOAL 014.
5. Cookie interno, legado ou NextAuth não autentica o portal externo.
6. Layout totalmente separado do ERP.
7. Nenhum provider do dashboard/ERP importado.
8. Usuário externo vê somente lojas vinculadas em `ContadorAcesso`.
9. Acesso autorizado a duas lojas e bloqueio completo a uma terceira, tanto em
   página quanto em API.
10. Competências listadas somente dentro do escopo autorizado.
11. Página de competência apresenta documentos, pacotes, timeline e comentários
    compartilhados.
12. Documentos podem ser baixados por autorização curta e auditada.
13. `storageRef` nunca aparece nas respostas externas.
14. `atorId` interno é pseudonimizado ou omitido.
15. Pacotes são listados por versão.
16. Confirmação de recebimento é idempotente.
17. Comentário externo grava `atorTipo` "externo".
18. Marcar conferido respeita o papel externo.
19. Papel leitura não visualiza nem executa ações de escrita.
20. Revogação de acesso derruba a próxima request.
21. Todas as respostas usam `Cache-Control: private, no-store`.
22. Downloads, comentários, confirmações, conferências e acessos negados
    registram eventos com ator externo e IP/UA minimizados.
23. Estados vazio, indisponível, sessão expirada e acesso revogado são honestos.
24. Portal legado permanece intocado e funcional em paralelo.
25. Nenhuma funcionalidade dos GOALs 016–019 é antecipada.
26. Nenhuma alteração de schema ou migration.
27. Testes cross-store cobrem todas as rotas e ações.
28. Teste estático impede imports de `operations-store`, `loja-ativa` e providers
    do dashboard.
29. Testes focados, TypeScript, ESLint, build, AEP verify e diff check passam.
30. Evidência completa do GOAL 015 é produzida.
