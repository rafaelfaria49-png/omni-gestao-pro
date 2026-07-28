# Segurança e Proteção da Base — 001

**GOAL:** `CATALOGO-SAAS-MASTER-PLAN-001`
**Data:** 22 de Julho de 2026
**Status:** PROPOSTA TÉCNICA — nenhuma medida promete impedimento absoluto; o objetivo é
tornar a cópia da base cara, lenta, detectável e juridicamente arriscada.

---

## 1. O ativo e o modelo de ameaças

O ativo do negócio não é o código — é a **base curada** (429 modelos, 1.751 aliases,
116 grupos, 935 pares em curadoria com classificação de confiança) e o **processo de
curadoria** que a mantém viva. O código é reconstruível em semanas; a base custou meses.

| Ameaça | Vetor | Impacto |
| :--- | :--- | :--- |
| A1 — Concorrente copia a base | Conta trial/paga + automação de consultas | Perda do diferencial; guerra de preço |
| A2 — Assinante redistribui | Exportações, PDFs repassados, prints em grupos | Erosão de receita ("um assina, dez usam") |
| A3 — Credential stuffing | Senhas vazadas de outros serviços | Acesso indevido; dano de reputação |
| A4 — Abuso de trial | Contas descartáveis em série | Consulta grátis perpétua; scraping distribuído |
| A5 — Erro administrativo | Edição errada de catálogo | Envenenamento de resultados (tratado em [PAINEL_ADMIN §3](PAINEL_ADMIN_MODERACAO_001.md)) |
| A6 — Vazamento de infraestrutura | Env/secret exposto, banco aberto | Cópia integral da base |

## 2. Princípios

1. **Defesa em camadas** — nenhuma camada é suficiente sozinha; todas juntas mudam a
   economia do ataque.
2. **Fail-closed** — em dúvida, não expor: pares `hidden` nunca saem por rota nenhuma;
   limite estourado nega e explica.
3. **Sem punição silenciosa** — usuário legítimo nunca é bloqueado sem aviso e caminho de
   recurso ([PLANOS §7.1](PLANOS_ASSINATURAS_PAGAMENTOS_001.md)).
4. **Detectar > impedir** — scraping determinado não é 100% bloqueável; é detectável
   (telemetria) e rastreável (watermark, honeytokens).
5. **Honestidade** — nenhum material promete "base 100% protegida".

## 3. Identidade, RBAC e sessões

Papéis (definidos em [MODELO_DADOS — User/OrganizationMember](MODELO_DADOS_CONCEITUAL_001.md)):

| Escopo | Papel | Alcance |
| :--- | :--- | :--- |
| Organização | `OWNER` | Cobrança, membros, dispositivos, dados da org |
| Organização | `MEMBER` | Consulta, favoritos, listas — nada de cobrança |
| Plataforma | `CURATOR` | Catálogo em rascunho, moderação ([PAINEL_ADMIN §1](PAINEL_ADMIN_MODERACAO_001.md)) |
| Plataforma | `PLATFORM_ADMIN` | Publicação, import, assinaturas (ações auditadas) |

Regras:

- **Autenticação:** NextAuth v5, e-mail + senha bcrypt (custo ≥ 12), verificação de
  e-mail obrigatória antes do trial contar consulta.
- **Anti-enumeração:** login e recuperação nunca revelam se o e-mail existe
  (copy da tela 3.3 do [UX](UX_DESIGN_SYSTEM_LANDING_001.md)).
- **Recuperação de senha:** token de uso único, expiração 30 min, invalida sessões ativas.
- **Sessões:** JWT de vida curta amarrado a `DeviceSession` server-side — revogar o
  dispositivo mata a sessão mesmo com JWT ainda válido no relógio.
- **Limite de dispositivos:** aplicado NO SERVIDOR pela contagem de `DeviceSession`
  ativa ([PLANOS §7.1](PLANOS_ASSINATURAS_PAGAMENTOS_001.md)); fingerprint leve
  (hash de UA + hints), nunca identificador invasivo.
- **Toda ação administrativa** → `AuditLog` com ator, diff e motivo.

## 4. Rate limiting e anti-scraping

Camadas, na ordem em que um scraper as encontra:

1. **Não existe endpoint de exportação total.** Nem para admin via API pública — export
   administrativo é operação de banco fora do app. A rota de consulta responde no máximo
   10 itens paginados ([BUSCA §6](BUSCA_E_COMPATIBILIDADE_001.md)); detalhe de
   compatibilidade só por modelo consultado individualmente.
2. **Demo pública contida:** allowlist estática de ~30 modelos populares, 5 consultas por
   sessão (hash de IP), sem fuzzy, sem códigos técnicos. A demo não toca a base completa.
3. **Rate limits em múltiplas janelas** (aplicados por conta + dispositivo + IP):

   | Janela | Limite | Fonte da regra |
   | :--- | :--- | :--- |
   | Por minuto / dispositivo | 60 buscas | [BUSCA §6](BUSCA_E_COMPATIBILIDADE_001.md) |
   | Por minuto / IP (burst) | 120 buscas | proteção contra distribuição por contas |
   | Por dia / organização Essencial | 300 consultas | limite de plano ([PLANOS §2](PLANOS_ASSINATURAS_PAGAMENTOS_001.md)) |
   | Por dia / organização Pro | 1.000 consultas | idem |
   | Por dia / conta trial | 30 pesquisas (limite total do trial) | [PLANOS §6](PLANOS_ASSINATURAS_PAGAMENTOS_001.md) |

   Implementação MVP: janela deslizante em memória por instância + contadores diários no
   banco (`SearchHistory` agregado). Redis/Upstash só se o modelo em memória se provar
   insuficiente ([ARQUITETURA §8](ARQUITETURA_CATALOGO_SAAS_001.md)).
4. **CAPTCHA progressivo:** disparado ao exceder limites repetidamente — nunca no fluxo
   normal do balcão.
5. **Anti-trial-farming:** 1 trial por e-mail verificado + por fingerprint de dispositivo;
   e-mails descartáveis conhecidos bloqueados; PDF de trial com watermark "AVALIAÇÃO".
6. **Honeytokens:** ~5 registros sintéticos plausíveis (aliases que nunca aparecem em
   sugestão nem demo, só em varredura exaustiva). Aparição de um honeytoken em base de
   terceiro é prova técnica de cópia — insumo para ação jurídica.
7. **Telemetria total:** 100% das consultas em `SearchHistory` com dispositivo, latência
   e seleção — a matéria-prima do §5.

## 5. Sinais de abuso e resposta gradual

Sinais monitorados (dashboard no admin — [PAINEL_ADMIN §2](PAINEL_ADMIN_MODERACAO_001.md)):

| Sinal | Heurística inicial (calibrar no beta) |
| :--- | :--- |
| Varredura sequencial | consultas seguindo ordem de catálogo/alfabética, cobertura anômala de modelos distintos |
| Volume fora do perfil | consultas/dia > p99 das organizações do mesmo plano |
| Coleta sem uso | alta taxa de consulta com `selectedModelId` nulo e zero favoritos/listas |
| Rotação de dispositivos | > 4 ativações/revogações em 24h ([MODELO_DADOS — DeviceSession](MODELO_DADOS_CONCEITUAL_001.md)) |
| Multi-conta | mesmo fingerprint/IP-hash em várias organizações trial |
| Automação | cadência regular de requisições, user-agent de ferramenta, horários contínuos |

**Escada de resposta (gradual, auditada, nunca silenciosa):**

1. Aviso in-app ("detectamos uso fora do padrão");
2. CAPTCHA nas próximas consultas;
3. Redução temporária de limite diário;
4. Suspensão temporária de consulta (conta preservada) + e-mail com canal de recurso;
5. Suspensão da conta com revisão manual obrigatória ([PAINEL_ADMIN §2](PAINEL_ADMIN_MODERACAO_001.md)).

Falso positivo é tratado como bug de produto: cada ação da escada registra o sinal que a
disparou, e a revisão manual pode isentar a organização (allowlist auditada).

## 6. SEO público × proteção da base

Equilíbrio (referenciado por [UX §4.3](UX_DESIGN_SYSTEM_LANDING_001.md)):

- Páginas públicas programáticas **somente por MODELO** ("Consulte películas compatíveis
  com {modelo}") — conteúdo raso, SEM a resposta de compatibilidade. A resposta fica
  atrás do login, sempre.
- **Nunca** páginas públicas por par, por grupo físico ou com listas de equivalência —
  seria servir a base ao Google (e a quem raspa o Google).
- Sitemap lista apenas landing, planos, FAQ e páginas de modelo aprovadas.
- Decisão de ativar o SEO programático é **gate humano da Fase 2**
  ([OPEN_QUESTIONS](OPEN_QUESTIONS_GATES_HUMANOS_001.md)) — só depois de medir se a demo
  limitada já cumpre o papel de aquisição.

## 7. Responsabilidade sobre o dado, termos e LGPD

**Responsabilidade de compatibilidade** (resposta à questão 18 do
[MASTER_PLAN §6](CATALOGO_SAAS_MASTER_PLAN_001.md)):

- Nenhum material promete "garantia de encaixe" (linguagem proibida —
  [PRD §8](PRD_CATALOGO_SAAS_MVP_001.md)).
- Todo resultado carrega selo de confiança; selos beta exibem aviso obrigatório
  ("teste antes da aplicação" — [BUSCA §5.4](BUSCA_E_COMPATIBILIDADE_001.md)).
- Termos de uso: o serviço é **informação de referência profissional**; a conferência
  física é responsabilidade do lojista quando o selo pedir; limitação de responsabilidade
  ao valor pago (texto final = gate jurídico humano).
- **Canal de contestação:** `CompatibilityReport` — o 2º relato independente de "não
  serviu" rebaixa a visibilidade automaticamente para `beta`, o 3º oculta até resolução
  ([MODELO_DADOS](MODELO_DADOS_CONCEITUAL_001.md)). O sistema erra para o lado seguro.
- Licença de uso da base nos termos: consulta para operação interna da loja; proibida
  extração, reprodução, redistribuição ou uso para construir base concorrente.

**LGPD:**

| Tema | Definição |
| :--- | :--- |
| Minimização | Só nome, e-mail, senha (hash), loja, WhatsApp opcional. Sem CPF/CNPJ no MVP ([MODELO_DADOS](MODELO_DADOS_CONCEITUAL_001.md)) |
| Bases legais | Execução de contrato (conta/assinatura); legítimo interesse (telemetria antiabuso, com IP em hash) |
| Consentimento | Explícito no cadastro (tela 3.4 do [UX](UX_DESIGN_SYSTEM_LANDING_001.md)); marketing opt-in separado |
| Direitos do titular | Exportar meus dados, corrigir, excluir conta — self-service na tela Conta (3.15) |
| Exclusão | Anonimização irreversível do e-mail; trilhas financeiras mantidas 5 anos (obrigação fiscal) |
| Operadores | Vercel, Neon PostgreSQL, Cloudflare R2, PaymentProvider, Resend, Sentry — todos com DPA; inventário mantido na doc do repo |
| Encarregado | O proprietário, no MVP (formalizar no gate jurídico) |
| Incidente | Playbook: conter → avaliar dados afetados → comunicar ANPD/titulares quando exigível → post-mortem no AuditLog |
| Retenções | Conforme [MODELO_DADOS](MODELO_DADOS_CONCEITUAL_001.md) (SearchHistory 6 meses, AuditLog 24 meses/5 anos financeiro, org cancelada 12 meses) |

## 8. Watermark e rastreio de vazamento

- Todo PDF nasce com **watermark visível** (nome da loja + usuário + data) e
  **`watermarkFingerprint` único** ([MODELO_DADOS — PurchaseOrder](MODELO_DADOS_CONCEITUAL_001.md))
  impresso no rodapé e registrado no banco — um PDF vazado identifica a assinatura de origem.
- Trial: marca d'água diagonal "AVALIAÇÃO" em toda página.
- Compartilhamento WhatsApp envia texto/link, nunca dump da base.
- Vazamento confirmado → escada do §5 a partir do degrau 4 + registro para eventual medida
  jurídica (os termos do §7 existem para isso).

## 9. Segurança de aplicação

- **OWASP Top-10:** validação Zod em toda entrada; Prisma parametrizado (o único SQL bruto
  é o `pg_trgm`, parametrizado); autorização por `organizationId` em TODA query
  (multi-tenant — [ARQUITETURA §4](ARQUITETURA_CATALOGO_SAAS_001.md)); rotas de admin
  exigem `platformRole` verificado no servidor; sem IDs sequenciais expostos (cuid).
- **Headers:** CSP estrita, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy` — padrão já operado no OmniGestão via `next.config`.
- **Secrets:** nunca `NEXT_PUBLIC_` para segredo (lição registrada); env por ambiente;
  rotação ao menor sinal de exposição.
- **Webhooks de pagamento:** contrato inegociável do
  [PLANOS §7.3](PLANOS_ASSINATURAS_PAGAMENTOS_001.md) (assinatura verificada, timestamp,
  idempotência, gravação antes de processar).
- **RLS (defesa em profundidade):** o app acessa via Prisma (role da aplicação), mas RLS
  fica ATIVA nas tabelas com policies por organização para as roles públicas do Supabase —
  um vazamento de `anon key` não expõe nada. RLS complementa, não substitui, o filtro por
  `organizationId` na aplicação ([ADR-002](ADR_DECISOES_ARQUITETURA_001.md)).
- **Dependências:** lockfile fixo, `npm audit` em CI, atualização mensal deliberada.

## 10. Checklist de segurança do lançamento (gate do beta)

1. Teste automatizado de vazamento: nenhuma rota expõe os 765 pares `hidden`
   ([BUSCA §7.4](BUSCA_E_COMPATIBILIDADE_001.md)).
2. Rate limits do §4 ativos e testados (incluindo trial e demo).
3. Watermark + fingerprint presentes em 100% dos PDFs gerados.
4. Headers de segurança verificados em produção.
5. Webhook: replay/assinatura inválida/evento duplicado rejeitados em teste de contrato.
6. RLS ativa; `anon key` sem acesso a dado algum.
7. Fluxos LGPD (exportar/excluir) funcionais.
8. Honeytokens semeados e documentados em local privado (fora do repo).
9. Termos de uso e privacidade publicados (gate jurídico humano cumprido).
10. `AuditLog` cobrindo: login admin, mutação de catálogo, publicação, ações de assinatura.
