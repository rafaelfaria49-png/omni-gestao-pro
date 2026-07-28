# Resumo Executivo — OmniCompat (SaaS de Consulta de Películas Compatíveis) — 001

**GOAL:** `CATALOGO-SAAS-MASTER-PLAN-001`
**Data:** 22 de Julho de 2026
**Status:** SÍNTESE do planejamento mestre (18 documentos em
`docs/planning/catalogo-saas-master-001/`) — nenhum código implementado; decisões
críticas aguardam gates humanos.

---

## O produto

O **OmniCompat** (slogan: *"A compatibilidade certa em segundos."*) é um SaaS operacional por assinatura, **independente do OmniGestão Pro**, para lojas de celulares, assistências técnicas e vendedores de acessórios. Busca por nome, apelido ou código técnico; variantes 4G/5G e
Pro/Max nunca misturadas; lista de compras e pedido em PDF para o fornecedor; PWA
instalável. **Capinhas ficam fora do lançamento** (0 dados físicos validados) — menção
honesta apenas em FAQ, sem data prometida.

## Por que é viável

- **Dor real e paga:** o concorrente líder cobra R$ 22/mês por um produto inferior (sem
  níveis de confiança, UX datada). Nossa vantagem não é preço — é honestidade da
  informação + UX de balcão + pedido integrado.
- **Base auditada e reconciliada** (números canônicos — os únicos permitidos):

| O que temos | Valor |
| :--- | ---: |
| Modelos canônicos / com cobertura | 429 / 419 |
| Aliases pesquisáveis (328 ambíguos protegidos) | 1.751 |
| Grupos físicos válidos | 116 |
| Pares cruzados únicos em curadoria | 935 |
| **Pares publicáveis no MVP** (+ beta com aviso) | **136** (+ 34) |
| Pares ocultos até haver evidência | 765 |
| Confirmações de bancada / dados de capinha | **0 / 0** |

  O número 86.738 da auditoria antiga é **falso e proibido** (cross-join corrigido na
  reconciliação P0). O ativo vendável do MVP é a busca canônica + 417 coberturas
  próprias + 136 pares confirmados + classificação honesta — não "quantidade de pares".
- **Custo de operar é minúsculo:** infra ~R$ 250–310/mês; break-even com ~15 assinantes.
  O custo real é curadoria — que também é o fosso competitivo.

## Decisões-chave (detalhe no [MASTER_PLAN §3](CATALOGO_SAAS_MASTER_PLAN_001.md))

- **MVP:** apenas películas; beta fechado (15–30 lojas) antes de cobrar de estranhos;
  lançamento aberto com preço fundador.
- **Preços aprovados:** Essencial R$ 19,90/mês · R$ 44,90/tri · R$ 119,90/ano (1 loja, 2 us, 3 disp); Loja Pro R$ 29,90/mês · R$ 59,90/tri · R$ 159,90/ano (até 3 lojas, 5 us, 8 disp). Trial oficial: 7 dias sem cartão ou 30 pesquisas contabilizadas.
- **Stack:** Next.js + TS + Prisma + Neon PostgreSQL (projeto NOVO e isolado) + Auth.js + Cloudflare R2 + Vercel + Resend + Sentry + PWA. Gateway de pagamentos em aberto via interface PaymentProvider. CNPJ mantido como gate futuro. Monolito modular; motor de busca em memória (engine já
  auditado, vendorizado) + `pg_trgm`. Repo e banco 100% separados do OmniGestão.
- **Confiança fail-closed:** status derivado de evidência, nunca promovido
  automaticamente; pares ocultos jamais expostos; "confirmado em bancada" só existirá
  com bancada real.
- **Proteção da base:** sem export total, rate limit em camadas, watermark rastreável em
  PDF, honeytokens, detecção de scraping com resposta gradual.

## Roadmap ([detalhe](ROADMAP_IMPLEMENTACAO_001.md))

| Fase | Conteúdo | Duração-hipótese |
| :--- | :--- | :--- |
| 0 | Fundação (repo, infra, CI, tokens) | ~1 semana |
| 1 | MVP completo → gate do beta | ~6–9 semanas |
| 2 | Beta fechado → lançamento fundador | ~4–6 semanas |
| 3 | Pro completo (multi-loja, equipe; PIX/MP se dados pedirem) | ~3–5 semanas |
| 4 | Capinhas por evidência de bancada | **sem data — por gate** |
| 5 | API pública e integrações | por demanda |

26 GOALs executáveis prontos no [BACKLOG](BACKLOG_GOALS_INICIAIS_001.md). Divisão de
IAs: Fable ≈ 20–25% (dados, busca, billing, segurança), Sonnet ≈ 50% (implementação),
baratos ≈ 25% (conteúdo/curadoria) — [MATRIZ_IAS](MATRIZ_IAS_POR_ETAPA_001.md).

## Riscos principais ([registro completo — 20](REGISTRO_RISCOS_001.md))

1. **Cobertura percebida insuficiente** (R-01) — o beta existe para medir isso antes de
   cobrar; curadoria guiada por zero-results.
2. **Cópia da base** (R-02) — defesa em camadas + watermark + honeytokens + termos.
3. **Erro de compatibilidade com prejuízo** (R-03) — fail-closed + rebaixamento
   automático por contestação + termos.
4. **Bus factor da curadoria** (R-07) — protocolo documentado + admin operável por
   terceiros + IA em lote com aprovação humana.
5. **Sobrecarga do proprietário** (R-20) — fases com gate; cortar escopo, nunca
   qualidade.

## O que só o proprietário pode decidir ([lista completa](OPEN_QUESTIONS_GATES_HUMANOS_001.md))

Nome/marca/domínio · CNPJ que fatura · preços finais e coorte fundador · gateway (taxas
vigentes) · termos jurídicos (uso/privacidade/reembolso) · texto da FAQ de capinhas ·
claims da landing · seleção do grupo de beta · formato final do trial · limites por
plano.

## Próximo passo recomendado

1. Decidir os gates do **Grupo A** (OQ-01 a OQ-10) — meio dia de decisões com material
   pronto neste plano;
2. abrir o repositório novo e executar **G-01/G-02** (fundação, ~1 semana);
3. seguir a ordem do backlog — dados → busca → dinheiro → UI → proteção → landing →
   beta.

O plano inteiro foi construído para uma verdade só: **vender exatamente o que a base
aguenta entregar, e crescer a base com evidência — nunca o contrário.**
