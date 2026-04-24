# Sidebar e rotas (mapeamento)

Navegação principal em `components/dashboard/sidebar.tsx` e `components/dashboard/mobile-nav.tsx`. Regra: se existir `externalPath`, o clique usa `window.location.href` (navegação completa). Caso contrário, chama `onNavigate(page)` → `goToPage` em `app/page.tsx`, que atualiza `/?page=...` (SPA na home).

| Página (rótulo no menu) | `page` (query) | Rota / URL efetiva | Observação |
| --- | --- | --- | --- |
| IA Mestre | — | `/dashboard/ia-mestre` | Só `externalPath`. |
| Painel inicial | `dashboard-omni` | `/dashboard` | `externalPath` tem prioridade; `?page=dashboard-omni` redireciona para `/dashboard`. |
| Orçamentos | `orcamentos` | `/?page=orcamentos` | SPA. |
| PDV / Caixa | `vendas` | `/?page=vendas` | SPA. |
| Histórico de Vendas | `vendas-arquivo` | `/?page=vendas-arquivo` | SPA. |
| Controle de Consumo (mesas) | `controle-consumo` | `/?page=controle-consumo` | SPA; pode sumir do menu se módulo desligado. |
| Trocas e devolução | `trocas` | `/?page=trocas` | SPA. |
| Painel integrado (O.S.) | `os` | `/dashboard/os` | `externalPath` tem prioridade. |
| Produtos | `produtos` | `/?page=produtos` | SPA. |
| Serviços | `servicos` | `/?page=servicos` | SPA. |
| Planejamento de Compras | `planejamento-compras` | `/?page=planejamento-compras` | SPA. |
| Carteiras | `carteiras` | `/?page=carteiras` | SPA. |
| Fluxo de Caixa | `fluxo-caixa` | `/?page=fluxo-caixa` | SPA. |
| Contas a Pagar | `contas-pagar` | `/?page=contas-pagar` | SPA. |
| Contas a Receber | `contas-receber` | `/?page=contas-receber` | SPA. |
| Relatórios Financeiros | `relatorios-financeiros` | `/?page=relatorios-financeiros` | SPA. |
| Área do Contador | — | `/contador` | Só `externalPath`. |
| Gestão de Clientes | `clientes-gestao` | `/dashboard/clientes` | `externalPath` tem prioridade; `?page=clientes-gestao` redireciona. |
| Cadastro de Clientes | `clientes` | `/?page=clientes` | SPA. |
| Consulta de Crédito | `credito` | `/?page=credito` | Oculto no plano Bronze. |
| Relatórios gerenciais | `relatorios` | `/?page=relatorios` | SPA. |
| Dashboard 360 | `dashboard-360` | `/?page=dashboard-360` | SPA. |
| Gestão de Unidades | `config-multilojas` | `/?page=config-multilojas` | SPA; filtrado no Bronze. |
| Dados da Empresa | `config-empresa` | `/?page=config-empresa` | SPA. |
| Ajustes | `config-ajustes` | `/?page=config-ajustes` | SPA. |
| Financeiro (cartões) | `config-pdv` | `/?page=config-pdv` | SPA. |
| Marca/Logo | `config-marca` | `/?page=config-marca` | SPA. |
| Certificado Digital | `config-certificado` | `/?page=config-certificado` | SPA. |
| Termos de Garantia | `config-garantia` | `/?page=config-garantia` | SPA. |
| Backup | `config-backup` | `/?page=config-backup` | SPA. |
| Conexão WhatsApp | `whatsapp` | `/?page=whatsapp` | SPA. |
| Logs do Sistema | `logs-sistema` | `/logs-sistema` | `goToPage` redireciona. |
| Meu Plano | `plano` | `/meu-plano` | `goToPage` redireciona. |
| Suporte | `suporte` | `/suporte` | `goToPage` redireciona. |

Itens **Ordens de Serviço** inteiros somem do menu em perfil `variedades` / `supermercado` (`hideOsMenus`).
