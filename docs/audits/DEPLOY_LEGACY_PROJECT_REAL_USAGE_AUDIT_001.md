# DEPLOY-LEGACY-PROJECT-REAL-USAGE-AUDIT-001

## 1. Veredito executivo

| Item | Resultado |
|---|---|
| Veredito | **NÃO APTO** para desligamento imediato do projeto legado |
| Classificação | **Classe B** — indício de acesso humano/PWA ou sessão tentativa, sem evidência de operação autenticada bem-sucedida |
| Base local | `origin/main@9cef9112811c1d743ca6dff98576dbc1b058304a` |
| Projeto canônico declarado pelo proprietário | `omni-gestao-pro` (`omni-gestao-pro.vercel.app`) |
| Projeto legado auditado | `omni-gestao` (`omni-gestao-pi.vercel.app`) |
| Escritas em Vercel, banco ou aplicação | **Zero** |

O legado não apresentou, na janela disponível, rota de dashboard, API operacional,
webhook, cron, nem função de negócio. A composição é predominantemente de assets
Next.js/PWA e visitas públicas. Contudo, houve chamadas à rota de autenticação e um
conjunto coerente de manifest, service worker, ícones, fontes e chunks. Essa
combinação é compatível com uma visita humana ou uma instalação PWA antiga, embora
não prove identidade, sessão autenticada ou operação de negócio. Pelo critério
conservador de desativação, isso é **Classe B**, e não autoriza desconexão de Git ou
remoção de Production sem uma transição monitorada.

Não há evidência de Classe C nesta amostra: nenhuma rota `/api/ops/**`, dashboard,
mutação, webhook ou integração operacional apareceu no legado. A ausência é limitada
à retenção e às superfícies read-only disponíveis; não é uma prova histórica
absoluta.

## 2. Escopo, método e limites

A auditoria ocorreu em worktree isolada na branch
`audit/deploy-legacy-project-real-usage-001`. Foram usados apenas:

- configuração e busca estática do repositório versionado;
- telas read-only da Vercel para os dois projetos, em Production;
- métricas agregadas de Edge Requests e Functions;
- logs read-only na última hora, sem abrir payload, headers, cookies, IPs, tokens,
  e-mails ou qualquer identificador pessoal.

Não foram executados SQL, Prisma, deploy, alteração de domínio, redirect, variável,
integração, projeto Vercel, pipeline, Git remoto, push ou PR. Os dois bancos continuam
conhecidos apenas como diferentes pela auditoria anterior; a disponibilidade de acesso
read-only aos bancos exatos não foi fornecida nem testada neste GOAL.

Web Analytics estava desabilitado no legado. Portanto, visitantes, referers,
países/regiões e categorias de user-agent não puderam ser determinados de forma
confiável. O plano Hobby também exibiu aviso de retenção/Observability Plus; as
tentativas read-only para 24 horas, 7 dias e 30 dias não retornaram uma série agregada
utilizável de Edge Requests. A análise conclusiva abaixo é da janela de 6 horas, e os
demais períodos ficam **UNKNOWN por limitação da superfície**, não como zero tráfego.

## 3. Comparação de tráfego disponível

| Janela solicitada | `omni-gestao-pro` | `omni-gestao` | Situação |
|---|---:|---:|---|
| 6 horas | aproximadamente `2K` Edge Requests | `562` Edge Requests | leitura agregada disponível |
| 24 horas | UNKNOWN | UNKNOWN | série não disponibilizada pela superfície/plano |
| 7 dias | UNKNOWN | UNKNOWN | série não disponibilizada pela superfície/plano |
| 30 dias | UNKNOWN | UNKNOWN | retenção ampliada indicada como recurso Observability Plus |

Os totais são amostras de uma janela móvel e não reconstituem a captura anterior de
`106` requests no legado. Na leitura atual, o gráfico concentrou quase todo o volume
do legado em um único pico; uma segunda leitura de uma hora mostrava `561` requests.
Essa variação reforça que são contagens temporais, não uma medição de usuários únicos.

O canônico, por contraste, exibiu rotas operacionais recorrentes na mesma janela,
incluindo `/api/ops/vendas-list` e `/api/ops/terminal/heartbeat`. Elas não apareceram
na listagem agregada do legado.

### 3.1 Rotas que explicam o tráfego do legado

As rotas mais frequentes no recorte de 6 horas foram:

| Categoria | Evidência agregada |
|---|---|
| Autenticação | `/api/auth/[...nextauth]`: 10 Edge Requests; painel de Functions mostrou 6 invocações, todas `5XX`, taxa de erro 100%, timeout 0% |
| Visita pública | `/`: 9 requests; `/meu-plano`: 4 requests |
| PWA | `/manifest.webmanifest`: 5; `/sw.js`: 5; `/workbox-*.js`: 5; worker auxiliar: 4 |
| Assets | ícone PWA: 8; fontes, CSS e chunks `/_next/static/**`: predominantemente 2–6 por rota |
| Operação/integracão | nenhuma rota `/api/ops/**`, webhook, cron ou API externa observada |

Os métodos HTTP não são expostos pela tabela agregada e os Logs da última hora não
tinham entradas consultáveis. Logo, não se afirma que mutações nunca ocorreram; apenas
que não houve mutação identificada nas rotas e invocações disponíveis. Também não se
persistem status individuais: o único agregado relevante foi a falha de autenticação
acima.

As telas read-only de External APIs não retornaram resultados no período. A
configuração versionada contém `"crons": []` em `vercel.json`; não há cron Vercel
configurado por esse arquivo. Não foi vista evidência de webhook/WhatsApp/fiscal no
tráfego legado.

## 4. Configuração comparada

| Propriedade | `omni-gestao-pro` | `omni-gestao` |
|---|---|---|
| Integração Git | conectada | conectada |
| Production Branch | `main` | `main` |
| Deploy automático de `main` | sim, conforme a integração e a auditoria de governança publicada | sim, conforme a integração e a auditoria de governança publicada |
| Domínio Vercel observado | `omni-gestao-pro.vercel.app` | `omni-gestao-pi.vercel.app` |
| Custom domain observado | nenhum | nenhum |
| Redirect entre os dois projetos | nenhum observado | nenhum observado |
| Build versionado | `node scripts/vercel-build.mjs` | o mesmo `vercel.json`/repositório |
| Cron versionado | `[]` | `[]` |
| System Environment Variables | habilitadas na UI | habilitadas na UI |

Os projetos permanecem independentes em Vercel, ainda que apontem para a mesma
branch. A auditoria não leu valores de variáveis. A auditoria de governança publicada
registra que ambos têm variáveis de banco/integracão e bancos Production distintos;
isso é motivo adicional para não desconectar ou despromover o legado de forma direta.

## 5. Referências ao domínio e hipótese PWA

A busca estática por `omni-gestao-pi.vercel.app` e `omni-gestao.vercel.app` encontrou
somente a menção histórica em
`docs/audits/DEPLOY_PRODUCTION_MIGRATION_GOVERNANCE_AUDIT_001.md`. Não há referência
ativa do alias legado em código, documentação operacional, exemplos, callback OAuth,
webhook, CORS, script ou arquivo batch. Em contrapartida, as referências explícitas de
produção encontradas no repositório apontam para `omni-gestao-pro.vercel.app`, inclusive
na verificação de WhatsApp.

O app é PWA: `next.config.mjs` configura o plugin PWA e reescreve
`/manifest.json` para `/manifest.webmanifest`; `app/manifest.ts` usa
`start_url: "/login"` e `scope: "/"`. Como os caminhos são relativos, uma instalação
feita anteriormente no host legado pode continuar solicitando o próprio host. Os assets
PWA observados são consistentes com essa hipótese, mas não provam que exista instalação
ativa, loja específica, favorito persistente ou usuário identificado.

## 6. Respostas obrigatórias

1. **Os dois projetos implantam automaticamente `main`?** Sim. Ambos estão conectados
   ao Git e têm `main` como Production Branch; a auditoria de governança já comprovou
   que merges em `main` disparam os dois.
2. **O legado recebe usuários reais?** Não é possível provar por usuário único porque
   Web Analytics está desabilitado. O padrão PWA/página pública é compatível com uso
   humano, portanto não deve ser tratado como somente bot sem monitoramento adicional.
3. **Há sessões autenticadas no legado?** Nenhuma sessão autenticada bem-sucedida foi
   comprovada. A única função observada foi NextAuth e suas 6 invocações foram `5XX`.
4. **Há mutações ou webhooks no legado?** Nenhum foi observado na janela disponível.
   Isso não prova ausência histórica fora da retenção acessível.
5. **Quais rotas explicam as 106 solicitações da captura anterior?** A captura atual
   não reconstitui exatamente aquelas 106 por ser uma janela móvel; a composição
   observada explica esse perfil por home/página pública, autenticação falha e cadeia
   PWA/assets (`manifest`, workers, ícones, fontes e chunks), não por rotas de negócio.
6. **Há código ou integração apontando ao domínio antigo?** Não. Só existe menção
   histórica na auditoria de governança; as referências explícitas de produção usam o
   domínio canônico.
7. **É seguro redirecionar o domínio antigo?** Não como alteração imediata. É candidato
   a redirect monitorado e reversível, precedido de período adicional de telemetria e
   validação de login/PWA; esta auditoria não aplica o redirect.
8. **É seguro desconectar o Git do projeto antigo?** Não ainda. O projeto continua
   Production, ligado a banco distinto e pode atender um PWA/cliente legado.
9. **É seguro retirar o status Production?** Não imediatamente, pelas mesmas razões e
   pela ausência de histórico confiável de 7/30 dias.
10. **Qual sequência evita perda de acesso ou dados?** Decisão humana de retenção →
    ampliar/registrar telemetria agregada por período suficiente → validar que nenhum
    login/PWA/integração usa o legado → aplicar redirect reversível e monitorar → só
    então avaliar desconexão de Git e retirada de Production, preservando o banco até
    haver decisão explícita de retenção. Cada etapa requer GOAL/autoridade própria.

## 7. Falhas e recomendações

### F-01 — [P1] O legado ainda recebe tráfego de autenticação/PWA sem finalidade operacional confirmada

**Evidência:** requests de assets PWA, páginas públicas e NextAuth; as invocações
NextAuth disponíveis falharam, mas não identificam quem iniciou o fluxo.

**Impacto:** desativação direta pode retirar acesso de um navegador/PWA antigo sem
telemetria suficiente para detectar a perda antes da mudança.

**Recomendação:** tratar o legado como Classe B até uma janela observável mais longa e
uma transição humana/monitorada. Não implementar essa recomendação neste GOAL.

### F-02 — [P1] Observabilidade não permite atribuir tráfego a usuários ou cobrir o histórico solicitado

**Evidência:** Web Analytics desabilitado e aviso de retenção Observability Plus;
24h/7d/30d não produziram séries utilizáveis nesta auditoria.

**Impacto:** não há base para afirmar Classe A de forma histórica, nem para aprovar
desativação imediata.

**Recomendação:** antes de qualquer mudança futura, obter telemetria agregada e
sanitizada por período suficiente, sem coletar PII ou payloads.

## 8. Encerramento e invariantes

Este relatório não altera a decisão já necessária sobre os dois bancos Production e
não desbloqueia o GOAL 002C. A decisão de retenção/desativação e qualquer escolha
operacional permanece humana.

Foram confirmados: zero SQL, zero acesso de escrita, zero mudança de Vercel, zero
deploy, zero mudança de domínio, zero mudança de código/pipeline/schema/migration e
zero exposição de segredos ou dados pessoais.
