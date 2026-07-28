# Backlog de GOALs Iniciais — 001

**GOAL:** `CATALOGO-SAAS-MASTER-PLAN-001`
**Data:** 22 de Julho de 2026
**Status:** PROPOSTA — 26 GOALs executáveis cobrindo Fase 0 e Fase 1 do
[ROADMAP](ROADMAP_IMPLEMENTACAO_001.md). Nenhum GOAL está autorizado a executar antes dos
gates do Grupo A de [OPEN_QUESTIONS](OPEN_QUESTIONS_GATES_HUMANOS_001.md).

Convenções: IDs `G-01`…`G-26` (no repo novo ganharão prefixo do produto). Cada GOAL fecha
com CI verde e o relatório padrão ([MATRIZ_IAS §4](MATRIZ_IAS_POR_ETAPA_001.md)).
"IA" = executor/revisor conforme [MATRIZ_IAS §2](MATRIZ_IAS_POR_ETAPA_001.md).

---

## Fase 0 — Fundação

### G-01 — Fundação do repositório e infraestrutura
**Objetivo:** repo novo deployando vazio em produção.
**Entregas:** Next.js + TS strict + Tailwind/shadcn; projetos Vercel/Neon PostgreSQL novos, Auth.js e Cloudflare R2;
envs dev/preview/prod; CI (typecheck, lint, test, build); headers de segurança.
**Aceite:** deploy de produção acessível; CI bloqueia merge em falha; zero referência ao
OmniGestão em código/env ([ADR-001/002](ADR_DECISOES_ARQUITETURA_001.md)).
**Dep:** gates de marca (codinome neutro aceito). **IA:** Sonnet/Fable.

### G-02 — Design tokens e shell PWA
**Objetivo:** fundação visual com tokens de confiança e PWA instalável.
**Entregas:** tokens semânticos + `confidence-*`; dark mode; componentes base
(`ConfidenceBadge`, `SearchBox` esqueleto — [UX §2](UX_DESIGN_SYSTEM_LANDING_001.md));
manifest/ícones/splash; cache de shell apenas ([ADR-010](ADR_DECISOES_ARQUITETURA_001.md)).
**Aceite:** PWA instala em Android/iOS; zero cor hardcoded; WCAG AA nos componentes base.
**Dep:** G-01. **IA:** Sonnet/humano.

## Fase 1 — Dados e busca

### G-03 — Modelo de dados e migrations iniciais
**Objetivo:** schema Prisma das entidades do MVP ([MODELO_DADOS](MODELO_DADOS_CONCEITUAL_001.md)).
**Entregas:** migrations versionadas desde o dia 1; `citext`/`pg_trgm` habilitados; RLS
baseline; seeds mínimos de dev (NUNCA dados de assinantes).
**Aceite:** `prisma migrate` limpo em banco vazio; índices/uniques conforme doc;
constraint de capinha inativa (`AccessoryType` único ativo = `pelicula_tela`).
**Dep:** G-01. **IA:** Fable/humano.

### G-04 — Importador ETL: verificação, staging e validação
**Objetivo:** pipeline até o dry-run ([IMPORTACAO §1–5](IMPORTACAO_DADOS_EXISTENTES_001.md)).
**Entregas:** snapshot dos CSVs + manifesto SHA-256; staging; transformações e
mapeamentos; validação de invariantes; relatório de dry-run.
**Aceite:** tabela de paridade do [IMPORTACAO §5](IMPORTACAO_DADOS_EXISTENTES_001.md)
100% verde (935 pares derivados, 136/34/765 de visibilidade, 0 capinhas, 0 bancada);
hash divergente aborta; suíte na CI.
**Dep:** G-03. **IA:** Fable/humano.

### G-05 — Publicação de catálogo, CatalogVersion e rollback
**Objetivo:** publicação atômica com versão e rollback de 1 clique
([IMPORTACAO §6](IMPORTACAO_DADOS_EXISTENTES_001.md)).
**Entregas:** `CatalogVersion` + stats + manifesto; transação de publicação; rollback;
AuditLog das operações.
**Aceite:** publicar/rollback < 1 min em teste; reexecução idempotente; hard gates de
política ativos (grupo > 25 aborta).
**Dep:** G-04. **IA:** Fable/humano.

### G-06 — Motor de busca vendorizado (cascata + normalização)
**Objetivo:** engine em memória lendo do banco ([BUSCA §2–3](BUSCA_E_COMPATIBILIDADE_001.md)).
**Entregas:** cópia vendorizada do engine puro; índice por `catalogVersion`; cascata
exato→prefixo→contém; ranking com códigos técnicos no topo.
**Aceite:** testes portados (`peliculas`/`catalogo-aparelhos`) verdes; benchmark p95
< 300 ms nas 100 queries mais comuns.
**Dep:** G-05. **IA:** Fable/Sonnet.

### G-07 — Fuzzy `pg_trgm` e guard de ambiguidade
**Objetivo:** fallback fuzzy controlado + trava de marca.
**Entregas:** fuzzy só com < 3 resultados, limiar 0.35, nunca p/ query ≤ 3 chars,
marcado "aproximado"; chips de marca p/ ambíguos; `?brand=` desambigua.
**Aceite:** as 21 strings colidentes exigem marca; 328 aliases ambíguos nunca resolvem
sem contexto; fuzzy nunca mascara match direto.
**Dep:** G-06. **IA:** Fable/Sonnet.

### G-08 — API de consulta com política de visibilidade
**Objetivo:** rotas GET cacheáveis servindo busca e detalhe ([BUSCA §5.3](BUSCA_E_COMPATIBILIDADE_001.md)).
**Entregas:** endpoints de busca/detalhe (≤ 10 itens, paginado); agregação sem promoção
(pior status); avisos fixos de domínio; telemetria assíncrona em `SearchHistory`.
**Aceite:** nenhum caminho retorna item `hidden`; contrato de resposta documentado;
cache `private, max-age=60` + chave por versão.
**Dep:** G-06. **IA:** Fable/humano.

### G-09 — Golden set e teste de vazamento
**Objetivo:** rede de segurança permanente da busca.
**Entregas:** golden set ~200 queries reais com resultado esperado; teste varrendo rotas
públicas com a matriz de pares como oráculo ([BUSCA §7](BUSCA_E_COMPATIBILIDADE_001.md)).
**Aceite:** ambos na CI bloqueando merge; cobertura das categorias de entrada do
[BUSCA §1](BUSCA_E_COMPATIBILIDADE_001.md).
**Dep:** G-07, G-08. **IA:** Sonnet/Fable.

## Fase 1 — Identidade e cobrança

### G-10 — Autenticação (NextAuth v5)
**Objetivo:** cadastro/login/verificação/recuperação ([ADR-004](ADR_DECISOES_ARQUITETURA_001.md)).
**Entregas:** e-mail+senha bcrypt (custo ≥ 12); verificação obrigatória; recuperação com
token de 30 min; anti-enumeração; e-mails via Resend.
**Aceite:** fluxos das telas 3.3/3.4 ([UX](UX_DESIGN_SYSTEM_LANDING_001.md)) completos;
teste de anti-enumeração.
**Dep:** G-02, G-03. **IA:** Sonnet/Fable.

### G-11 — Organizações, membros e RBAC
**Objetivo:** multi-tenant com papéis ([SEGURANCA §3](SEGURANCA_PROTECAO_BASE_001.md)).
**Entregas:** Organization/OrganizationMember; OWNER/MEMBER; platformRole; guard
`organizationId` em toda query; AuditLog de ações sensíveis.
**Aceite:** teste provando isolamento entre organizações; 1 OWNER ativo por org.
**Dep:** G-10. **IA:** Sonnet/Fable.

### G-12 — DeviceSession e limite de dispositivos
**Objetivo:** o limite por plano como regra de servidor.
**Entregas:** registro/heartbeat/revogação; tela 3.16; troca self-service ao exceder;
detecção de rotação (> 4/24h → sinal).
**Aceite:** limite inviolável por API; revogar mata sessão ativa; UX sem punição
silenciosa ([PLANOS §7.1](PLANOS_ASSINATURAS_PAGAMENTOS_001.md)).
**Dep:** G-11. **IA:** Sonnet/Fable.

### G-13 — Planos e checkout via PaymentProvider
**Objetivo:** dinheiro entrando com segurança ([ADR-005](ADR_DECISOES_ARQUITETURA_001.md)).
**Entregas:** seed de `Plan` (preços do gate); checkout cartão + Payment Link PIX
tri/anual; portal do assinante; telas 3.5/3.6.
**Aceite:** checkout test-mode completo; retorno visual NUNCA ativa acesso (polling do
estado real).
**Dep:** G-11; gate de preços. **IA:** Fable/humano.

### G-14 — Webhooks, PaymentEvent e ciclo de vida
**Objetivo:** máquina de estados da assinatura ([PLANOS §4](PLANOS_ASSINATURAS_PAGAMENTOS_001.md)).
**Entregas:** endpoint com assinatura verificada; `PaymentEvent` idempotente; transições
`trialing→active→past_due→grace→suspended→canceled`; cron de expiração; conciliação
diária que alerta e nunca auto-corrige.
**Aceite:** testes de contrato com payloads reais (replay/duplicado/inválido rejeitados);
todos os eventos mínimos tratados.
**Dep:** G-13. **IA:** Fable/humano.

### G-15 — Trial e paywall
**Objetivo:** 7 dias sem cartão com limites antiabuso.
**Entregas:** trial no cadastro verificado; limites (7 dias ou 30 pesquisas contabilizadas no backend, 1 dispositivo,
PDF "AVALIAÇÃO"); 1 trial por e-mail/fingerprint; paywall suave; banners de estado.
**Aceite:** limites aplicados no servidor; expiração correta via cron; UX de conversão
sem dark pattern.
**Dep:** G-12, G-14. **IA:** Sonnet/Fable.

## Fase 1 — Produto de consulta

### G-16 — UI de busca e resultado
**Objetivo:** o coração do produto no ar (telas 3.7–3.9 — [UX](UX_DESIGN_SYSTEM_LANDING_001.md)).
**Entregas:** dashboard com SearchBox dominante; busca incremental com chips de marca;
resultado com selos, variantes 4G/5G explícitas, avisos, estados vazio/erro honestos.
**Aceite:** percepção < 1 s em 4G (debounce 250 ms); selos sempre ícone+texto;
combobox ARIA correto; zero-results com CTA de solicitação.
**Dep:** G-08, G-15. **IA:** Sonnet/humano.

### G-17 — Favoritos e histórico
**Objetivo:** hábito e recorrência.
**Entregas:** favoritar modelo/grupo; histórico com repetição de consulta; badge de
mudança de selo em favorito (telas 3.12/3.13).
**Aceite:** limites por plano (histórico 30 dias/12 meses); isolamento por organização.
**Dep:** G-16. **IA:** Sonnet/Sonnet.

### G-18 — Lista de compras com consolidação por grupo
**Objetivo:** transformar consulta em compra (tela 3.10).
**Entregas:** adicionar da busca/resultado; agrupamento por grupo físico ("1 molde
atende N modelos"); quantidades; limites por plano (1 ativa / ilimitadas).
**Aceite:** consolidação correta validada contra grupos reais; otimista com rollback.
**Dep:** G-16. **IA:** Sonnet/Sonnet.

### G-19 — Pedido em PDF com watermark + WhatsApp
**Objetivo:** o documento que vai ao fornecedor (tela 3.11).
**Entregas:** `@react-pdf/renderer` server-side; watermark (org+usuário+data) +
`watermarkFingerprint` único; compartilhar WhatsApp (texto/link); fallback copiar texto.
**Aceite:** 100% dos PDFs com watermark+fingerprint ([SEGURANCA §8](SEGURANCA_PROTECAO_BASE_001.md));
geração < 3 s; PDF com texto real (não imagem).
**Dep:** G-18. **IA:** Sonnet/Fable.

### G-20 — Solicitação de modelo e notificações
**Objetivo:** o motor de crescimento da base (tela 3.14).
**Entregas:** CTA em zero-results pré-preenchido; dedupe por `requestersCount`;
`Notification` in-app + e-mail p/ `model_added`; visão "minhas solicitações".
**Aceite:** solicitações duplicadas incrementam (não duplicam); notificação chega a
TODAS as orgs solicitantes.
**Dep:** G-16. **IA:** Sonnet/Sonnet.

## Fase 1 — Admin, segurança e lançamento

### G-21 — Admin: CRUD de catálogo com rascunho→publicar
**Objetivo:** curadoria operável com safeguards ([PAINEL_ADMIN §3/§7](PAINEL_ADMIN_MODERACAO_001.md)).
**Entregas:** CRUD modelos/aliases/grupos/relações em changeset; detector de colisão de
alias; simulação de impacto; publicação com confirmação; integração com G-05.
**Aceite:** mutação nunca vai direto ao ar; invariantes hard-gate bloqueiam; tudo no
AuditLog com diff.
**Dep:** G-05, G-11. **IA:** Sonnet/Fable.

### G-22 — Admin: evidências, rebaixamento e AuditLog viewer
**Objetivo:** gestão de evidência fail-closed (tela 3.20).
**Entregas:** anexar/retratar evidência; derivação automática de status
([BUSCA §5.2](BUSCA_E_COMPATIBILIDADE_001.md)); rebaixamento manual com motivo; fila de
solicitações; viewer do AuditLog com filtros.
**Aceite:** impossível promover status sem evidência (teste); `confirmado_bancada`
inatingível sem BenchTest.
**Dep:** G-21. **IA:** Sonnet/Fable.

### G-23 — Rate limiting, sinais de abuso e headers
**Objetivo:** proteção ligada antes de estranhos entrarem
([SEGURANCA §4–5](SEGURANCA_PROTECAO_BASE_001.md)).
**Entregas:** limites por janela/plano/trial; CAPTCHA progressivo; sinais + escada de
resposta com AuditLog; honeytokens; headers verificados.
**Aceite:** testes de limite (conta/dispositivo/IP); demo contida (allowlist, 5
consultas); dashboard mínimo de sinais no admin.
**Dep:** G-08, G-12. **IA:** Fable/humano.

### G-24 — Landing page + demo limitada + SEO técnico
**Objetivo:** vender o que existe ([UX §4](UX_DESIGN_SYSTEM_LANDING_001.md)).
**Entregas:** as 16 seções; widget demo (allowlist ~30 modelos, 5 consultas); FAQ com
texto de capinhas aprovado; SSG, meta/OG, sitemap, schema.org; Core Web Vitals verdes.
**Aceite:** checklist de claims 100% [PRD §7](PRD_CATALOGO_SAAS_MVP_001.md) (aprovação
humana); landing < 100 KB JS; demo não toca a base completa.
**Dep:** G-08; gates de marca/preço/texto. **IA:** Sonnet/humano.

### G-25 — LGPD: conta, exportação e exclusão
**Objetivo:** direitos do titular self-service ([SEGURANCA §7](SEGURANCA_PROTECAO_BASE_001.md)).
**Entregas:** tela Conta (3.15); exportar meus dados; exclusão com anonimização
irreversível (trilhas financeiras 5 anos); consentimento no cadastro; páginas de termos/
privacidade (texto do gate jurídico).
**Aceite:** exclusão testada de ponta a ponta; retenções conforme
[MODELO_DADOS](MODELO_DADOS_CONCEITUAL_001.md).
**Dep:** G-10. **IA:** Fable/humano.

### G-26 — Operação do beta fechado
**Objetivo:** beta rodando com lojas reais ([ROADMAP §3](ROADMAP_IMPLEMENTACAO_001.md)).
**Entregas:** contas de cortesia auditadas p/ 15–30 lojas (gate de seleção); canal de
feedback; painel de métricas do beta ([METRICAS §3](METRICAS_E_ANALYTICS_001.md));
rotina de curadoria semanal guiada por zero-results.
**Aceite:** 7 critérios do [PRD §4](PRD_CATALOGO_SAAS_MVP_001.md) + checklist
[SEGURANCA §10](SEGURANCA_PROTECAO_BASE_001.md) verificados ANTES do 1º convite; ritual
semanal de métricas ativo.
**Dep:** todos os anteriores. **IA:** Sonnet/humano.

---

## Fora deste backlog (Fase 2+)

Moderação de contribuições, magic link, SEO programático (gate), dashboard de abuso
avançado, multi-loja Pro, Mercado Pago, bancada digital e capinhas (Fase 4, por
evidência) — sequenciados no [ROADMAP §3–6](ROADMAP_IMPLEMENTACAO_001.md) e planejados
em GOALs próprios quando a fase abrir.
