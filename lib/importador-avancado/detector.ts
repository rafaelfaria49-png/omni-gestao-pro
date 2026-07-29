// ============================================================
// lib/importador-avancado/detector.ts
// Detecta o domínio de uma planilha pelos headers + nome do arquivo
// Suporta GestaoClick, Bling, Tiny, D360 e planilhas manuais
// ============================================================

import type { DominioImport } from "./types"

// ── Normalização ─────────────────────────────────────────────

function norm(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

// ── Dicionário semântico completo ────────────────────────────
// Mapeia qualquer header que qualquer sistema possa exportar
// para um campo semântico interno canônico.

export const DICIONARIO_SEMANTICO: Record<string, string> = {
  // ── Identificadores de OS ──
  "no da os": "os.numero",
  "nº da os": "os.numero",
  "num da os": "os.numero",
  "numero da os": "os.numero",
  "numero os": "os.numero",
  "n os": "os.numero",
  "ordem de servico": "os.numero",
  "ordem servico": "os.numero",
  "os": "os.numero",
  "cod os": "os.numero",
  "codigo os": "os.numero",

  // ── Identificadores de Pedido/Venda ──
  "no do pedido": "venda.numero",
  "nº do pedido": "venda.numero",
  "num pedido": "venda.numero",
  "numero pedido": "venda.numero",
  "numero do pedido": "venda.numero",
  "pedido": "venda.numero",
  "id pedido": "venda.numero",
  "cod venda": "venda.numero",
  "numero venda": "venda.numero",
  "nf": "venda.numero",
  "nota fiscal": "venda.numero",

  // ── Cliente ──
  "cliente": "cliente.nome",
  "nome": "cliente.nome",
  "nome cliente": "cliente.nome",
  "razao social": "cliente.razaoSocial",
  "nome social": "cliente.nomeSocial",
  "nome fantasia": "cliente.nomeFantasia",
  "responsavel": "cliente.nome",
  "sacado": "cliente.nome",
  "devedor": "cliente.nome",
  "destinatario": "cliente.nome",

  // ── Documento ──
  "cpf": "cliente.cpf",
  "cnpj": "cliente.cnpj",
  "cpf cnpj": "cliente.documento",
  "cpf/cnpj": "cliente.documento",
  "documento": "cliente.documento",
  "documento cliente": "cliente.documento",
  "rg": "cliente.rg",
  "ie": "cliente.inscricaoEstadual",
  "inscricao estadual": "cliente.inscricaoEstadual",
  "inscricao municipal": "cliente.inscricaoMunicipal",

  // ── Contato ──
  "telefone": "cliente.telefone",
  "celular": "cliente.celular",
  "telefone fixo": "cliente.telefoneFixo",
  "whatsapp": "cliente.celular",
  "fone": "cliente.telefone",
  "e mail": "cliente.email",
  "email": "cliente.email",

  // ── Endereço ──
  "cep": "endereco.cep",
  "logradouro": "endereco.logradouro",
  "rua": "endereco.logradouro",
  "numero": "endereco.numero",
  "complemento": "endereco.complemento",
  "bairro": "endereco.bairro",
  "cidade": "endereco.cidade",
  "uf": "endereco.uf",
  "estado": "endereco.uf",
  "municipio": "endereco.cidade",
  "pais": "endereco.pais",

  // ── Equipamento / Aparelho ──
  "equipamento": "equipamento.tipo",
  "aparelho": "equipamento.tipo",
  "tipo equipamento": "equipamento.tipo",
  "marca": "equipamento.marca",
  "fabricante": "equipamento.marca",
  "modelo": "equipamento.modelo",
  "serie": "equipamento.serie",
  "imei": "equipamento.imei",
  "imei serie": "equipamento.imei",
  "condicoes": "equipamento.condicoes",
  "condicao": "equipamento.condicoes",
  "estado do aparelho": "equipamento.condicoes",
  "acessorios": "equipamento.acessorios",
  "defeitos": "equipamento.defeito",
  "defeito": "equipamento.defeito",
  "problema": "equipamento.defeito",
  "relato": "equipamento.defeito",
  "solucao": "equipamento.solucao",
  "solucao tecnica": "equipamento.solucao",
  "laudo tecnico": "equipamento.laudoTecnico",
  "laudo": "equipamento.laudoTecnico",
  "termos de garantia": "equipamento.termoGarantia",
  "termo garantia": "equipamento.termoGarantia",
  "garantia": "equipamento.termoGarantia",

  // ── Produto ──
  "produto": "produto.nome",
  "descricao": "produto.nome",
  "descricao produto": "produto.nome",
  "nome produto": "produto.nome",
  "sku": "produto.sku",
  "codigo": "cliente.codigo",
  "cod": "produto.sku",
  "referencia": "produto.sku",
  "codigo de barra": "produto.barcode",
  "codigo barras": "produto.barcode",
  "ean": "produto.barcode",
  "gtin": "produto.barcode",
  "grupo": "produto.categoria",
  "categoria": "produto.categoria",
  "tipo": "produto.tipo",
  "unidade de saida": "produto.unidade",
  "unidade": "produto.unidade",
  "peso": "produto.peso",
  "codigo ncm": "produto.ncm",
  "ncm": "produto.ncm",
  "ativo": "cliente.ativo",

  // ── Serviço catálogo ──
  "servico": "servico.nome",
  "nome servico": "servico.nome",
  "codigo interno": "servico.sku",

  // ── Valores ──
  "total do pedido": "financeiro.valorTotal",
  "valor total": "financeiro.valorTotal",
  "valor": "financeiro.valor",
  "valor da parcela": "financeiro.valorParcela",
  "valor unitario": "financeiro.valorUnitario",
  "preco": "financeiro.valorUnitario",
  "preco venda": "financeiro.precoVenda",
  "valor varejo": "financeiro.precoVenda",
  "preco de venda": "financeiro.precoVenda",
  "valor de custo": "financeiro.custo",
  "preco de custo": "financeiro.custo",
  "custo": "financeiro.custo",
  "valor frete": "financeiro.frete",
  "frete": "financeiro.frete",
  "desconto valor": "financeiro.desconto",
  "desconto": "financeiro.desconto",
  "juros": "financeiro.juros",
  "taxa do banco": "financeiro.taxaBanco",
  "taxa da operadora": "financeiro.taxaOperadora",
  "comissao": "financeiro.comissao",

  // ── Pagamento ──
  "forma de pagamento": "pagamento.forma",
  "forma pagamento": "pagamento.forma",
  "pagamento": "pagamento.forma",
  "conta bancaria": "pagamento.contaBancaria",
  "vencimento": "pagamento.vencimento",
  "data de vencimento": "pagamento.vencimento",
  "data vencimento": "pagamento.vencimento",
  "data de confirmacao": "pagamento.dataConfirmacao",
  "data confirmacao": "pagamento.dataConfirmacao",
  "confirmado em": "pagamento.dataConfirmacao",

  // ── Datas ──
  "data": "data.data",
  "data da os": "data.abertura",
  "data abertura": "data.abertura",
  "cadastrado em": "data.criacao",
  "criado em": "data.criacao",
  "modificado em": "data.atualizacao",
  "prazo de entrega": "data.prazoEntrega",
  "prazo entrega": "data.prazoEntrega",
  "data de entrega": "data.prazoEntrega",
  "data de competencia": "data.competencia",
  "data competencia": "data.competencia",

  // ── Status ──
  "situacao": "status.situacao",
  "status": "status.situacao",
  "estado da venda": "status.situacao",
  "situacao da venda": "status.situacao",

  // ── Financeiro estruturado ──
  "plano de contas": "financeiro.categoria",
  "categoria financeira": "financeiro.categoria",
  "centro de custo": "financeiro.centroCusto",
  "descricao do recebimento": "financeiro.descricao",
  "descricao do pagamento": "financeiro.descricao",
  "historico": "financeiro.descricao",
  "observacao": "financeiro.observacao",
  "observacoes": "financeiro.observacao",
  "observacoes interna": "financeiro.observacaoInterna",
  "entidade": "financeiro.entidadeTipo",
  "entidade nome": "financeiro.entidadeNome",

  // ── Outros ──
  "vendedor": "meta.vendedor",
  "funcionario": "meta.funcionario",
  "canal de venda": "meta.canal",
  "cadastrado por": "meta.cadastradoPor",
  "quantidade": "item.quantidade",
  "qtd": "item.quantidade",
  "tipo de pessoa": "cliente.tipoPessoa",
  "estoque atual": "produto.estoque",
  "estoque minimo": "produto.estoqueMinimo",
  "estoque maximo": "produto.estoqueMaximo",
  "tipo de fornecedor": "fornecedor.tipo",

  // ── GestaoClick — Identificadores ──
  "n° da os": "os.numero",
  "n. da os": "os.numero",
  "n da os": "os.numero",
  "nº da venda": "venda.numero",
  "n° da venda": "venda.numero",
  "numero da venda": "venda.numero",
  "n do pedido": "venda.numero",
  "n da venda": "venda.numero",
  "código": "cliente.codigo",

  // ── GestaoClick — Cliente (cabeçalhos curtos sem prefixo) ──
  "razão social": "cliente.razaoSocial",
  "data de nascimento": "cliente.dataNascimento",
  "data nascimento": "cliente.dataNascimento",
  "inscrição estadual": "cliente.inscricaoEstadual",
  "inscrição municipal": "cliente.inscricaoMunicipal",
  "e-mail": "cliente.email",

  // ── GestaoClick — Campos específicos de OS/Venda ──
  "aos cuidados de": "meta.aosCuidadosDe",
  "validade da proposta": "data.validadeProposta",
  "introducao": "meta.introducao",
  "introdução": "meta.introducao",

  // ── GestaoClick — Vencimento/Confirmação variações ──
  "data do vencimento": "pagamento.vencimento",
  "data da confirmacao": "pagamento.dataConfirmacao",
  "valor pago": "financeiro.valorPago",
  "valor recebido": "financeiro.valorPago",
  "numero do documento": "financeiro.numeroDocumento",
  "n do documento": "financeiro.numeroDocumento",
  "entidade tipo": "financeiro.entidadeTipo",
}

// ── Dicionário do domínio PRODUTOS (sobrepõe o genérico) ──────
// O dicionário genérico foi calibrado para OS/clientes: "Código" resolve como
// código de CLIENTE e "Marca" como marca de EQUIPAMENTO. Em planilha de produtos
// (NF-e de fornecedor, catálogo, backup de ERP) isso descarta identidade real —
// foi assim que os 13 itens da NF-e Martins 5.380.135 entraram sem barcode, sem
// fornecedor e com a categoria copiada para a marca.
//
// A resolução semântica passa a considerar o domínio: este mapa só vale quando a
// planilha foi detectada como `produtos`.
export const DICIONARIO_PRODUTOS: Record<string, string> = {
  // ── Identificação ──
  "codigo": "produto.sku",
  "código": "produto.sku",
  "cod": "produto.sku",
  "sku": "produto.sku",
  "referencia": "produto.sku",
  "codigo interno": "produto.sku",
  "codigo do produto": "produto.sku",
  "codigo produto": "produto.sku",

  // ── Código de barras / GTIN ──
  "codigo de barras": "produto.barcode",
  "codigo de barra": "produto.barcode",
  "codigo barras": "produto.barcode",
  "codigo barra": "produto.barcode",
  "cod barras": "produto.barcode",
  "cod de barras": "produto.barcode",
  "barras": "produto.barcode",
  "ean": "produto.barcode",
  "gtin": "produto.barcode",
  "gtin ean": "produto.barcode",
  "ean gtin": "produto.barcode",
  "codigo usado na importacao": "produto.barcode",
  "ean comercial": "produto.gtinComercial",
  "gtin comercial": "produto.gtinComercial",
  "ean tributavel": "produto.gtinTributavel",
  "gtin tributavel": "produto.gtinTributavel",

  // ── Descrição / classificação ──
  "produto": "produto.nome",
  "descricao": "produto.nome",
  "descricao do produto": "produto.nome",
  "descricao produto": "produto.nome",
  "nome": "produto.nome",
  "nome do produto": "produto.nome",
  "nome produto": "produto.nome",
  "categoria": "produto.categoria",
  "grupo": "produto.categoria",
  "marca": "produto.marca",
  "fabricante": "produto.marca",

  // ── Fornecedor ──
  "fornecedor": "produto.fornecedor",
  "nome do fornecedor": "produto.fornecedor",
  "razao social do fornecedor": "produto.fornecedor",
  "codigo do fornecedor": "produto.codigoFornecedor",
  "cod do fornecedor": "produto.codigoFornecedor",
  "referencia do fornecedor": "produto.codigoFornecedor",
  "referencia fornecedor": "produto.codigoFornecedor",

  // ── Fiscal ──
  "ncm": "produto.ncm",
  "codigo ncm": "produto.ncm",
  "ncm sh": "produto.ncm",
  "cest": "produto.cest",
  "codigo cest": "produto.cest",

  // ── Unidades ──
  "unidade": "produto.unidadeComercial",
  "un": "produto.unidadeComercial",
  "unidade comercial": "produto.unidadeComercial",
  "unidade de venda": "produto.unidadeComercial",
  "unidade de saida": "produto.unidadeComercial",
  "unidade de compra": "produto.unidadeComercial",
  "unidade tributavel": "produto.unidadeTributavel",
  "unidade tributaria": "produto.unidadeTributavel",

  // ── Valores / estoque ──
  "custo": "financeiro.custo",
  "valor de custo": "financeiro.custo",
  "preco de custo": "financeiro.custo",
  "custo unitario": "financeiro.custo",
  "valor unitario": "financeiro.custo",
  "preco": "financeiro.precoVenda",
  "preco de venda": "financeiro.precoVenda",
  "preco venda": "financeiro.precoVenda",
  "valor de venda": "financeiro.precoVenda",
  "valor varejo": "financeiro.precoVenda",
  "estoque": "produto.estoque",
  "estoque atual": "produto.estoque",
  "quantidade": "produto.estoque",
  "qtd": "produto.estoque",
  "garantia": "produto.garantiaDias",
  "garantia dias": "produto.garantiaDias",
  "dias de garantia": "produto.garantiaDias",
}

// ── GestaoClick — Mapa explícito filename → domínio ───────────
// Aplicado ANTES do scoring semântico. Resolve o caso em que
// a planilha tem "Código" (não "Nº da OS") como coluna chave, fazendo
// o scoring semântico falhar mesmo com nome de arquivo óbvio.
//
// Chave: substring normalizada do basename (case/diacritic-insensitive)
// Ordem importa: mais específicos PRIMEIRO. O primeiro match vence.
const MAPA_NOME_ARQUIVO_DOMINIO: Array<{ pattern: string; dominio: DominioImport }> = [
  // OS — sub-planilhas (devem vir ANTES de "ordens_servicos" genérico)
  { pattern: "ordens_servicos_equipamentos", dominio: "os_equipamentos" },
  { pattern: "ordens_servico_equipamentos", dominio: "os_equipamentos" },
  { pattern: "ordens_servicos_pagamentos", dominio: "os_pagamentos" },
  { pattern: "ordens_servico_pagamentos", dominio: "os_pagamentos" },
  { pattern: "ordens_servicos_servicos", dominio: "os_servicos" },
  { pattern: "ordens_servico_servicos", dominio: "os_servicos" },
  { pattern: "ordens_servicos_historicos", dominio: "os_situacoes" },
  { pattern: "ordens_servicos_situacoes", dominio: "os_situacoes" },
  // OS — principal
  { pattern: "ordens_servicos", dominio: "ordens_servicos" },
  { pattern: "ordens_servico", dominio: "ordens_servicos" },
  // Vendas — sub-planilhas
  { pattern: "vendas_pagamentos", dominio: "vendas_pagamentos" },
  { pattern: "venda_pagamento", dominio: "vendas_pagamentos" },
  { pattern: "vendas_produtos", dominio: "vendas_produtos" },
  { pattern: "venda_produto", dominio: "vendas_produtos" },
  { pattern: "vendas_historicos", dominio: "vendas_historicos" },
  { pattern: "venda_historico", dominio: "vendas_historicos" },
  // Vendas — principal
  { pattern: "vendas", dominio: "vendas" },
  // Clientes / Fornecedores
  { pattern: "clientes_enderecos", dominio: "clientes_enderecos" },
  { pattern: "cliente_endereco", dominio: "clientes_enderecos" },
  { pattern: "clientes", dominio: "clientes" },
  { pattern: "fornecedores_enderecos", dominio: "fornecedores_enderecos" },
  { pattern: "fornecedor_endereco", dominio: "fornecedores_enderecos" },
  { pattern: "fornecedores", dominio: "fornecedores" },
  // Produtos / Serviços
  { pattern: "produtos", dominio: "produtos" },
  { pattern: "servicos_catalogo", dominio: "servicos_catalogo" },
  { pattern: "servicos", dominio: "servicos_catalogo" },
  // Financeiro
  { pattern: "contas_receber", dominio: "contas_receber" },
  { pattern: "conta_receber", dominio: "contas_receber" },
  { pattern: "contas_pagar", dominio: "contas_pagar" },
  { pattern: "conta_pagar", dominio: "contas_pagar" },
]

/** Casa nome de arquivo (basename) contra o mapa GestaoClick. Retorna null se nenhum casar. */
function dominioPorNomeArquivo(nomeArquivo: string): DominioImport | null {
  const baseRaw = nomeArquivo.split(/[\\/]/).pop() ?? nomeArquivo
  const base = norm(baseRaw.replace(/\.[a-z0-9]+$/i, "")) // remove extensão
  for (const { pattern, dominio } of MAPA_NOME_ARQUIVO_DOMINIO) {
    if (base.includes(norm(pattern))) return dominio
  }
  return null
}

// ── Assinaturas de domínio ───────────────────────────────────
// Cada domínio tem campos obrigatórios e opcionais.
// Score = (obrigatoriosPresentes / obrigatoriosTotal) * peso +
//         (opcionaisPresentes / opcionaisTotal) * (1 - peso)

type AssinaturaDominio = {
  dominio: DominioImport
  label: string
  obrigatorios: string[] // campos semânticos que DEVEM estar presentes
  opcionais: string[] // campos que reforçam a detecção
  nomesArquivo: string[] // substrings no nome do arquivo
}

const ASSINATURAS: AssinaturaDominio[] = [
  {
    dominio: "os_equipamentos",
    label: "OS — Equipamentos",
    obrigatorios: ["os.numero", "equipamento.marca"],
    opcionais: ["equipamento.modelo", "equipamento.defeito", "equipamento.laudoTecnico"],
    nomesArquivo: ["equipamento", "equip"],
  },
  {
    dominio: "os_pagamentos",
    label: "OS — Pagamentos",
    obrigatorios: ["os.numero", "pagamento.forma"],
    opcionais: ["financeiro.valorParcela", "pagamento.vencimento"],
    nomesArquivo: ["pagamento", "pagar", "pgto"],
  },
  {
    dominio: "os_servicos",
    label: "OS — Serviços",
    obrigatorios: ["os.numero", "servico.nome"],
    opcionais: ["financeiro.valorUnitario", "item.quantidade"],
    nomesArquivo: ["servico", "servicos"],
  },
  {
    dominio: "os_situacoes",
    label: "OS — Situações / Histórico",
    obrigatorios: ["os.numero", "status.situacao"],
    opcionais: ["meta.funcionario", "data.data"],
    nomesArquivo: ["situac", "historico", "status"],
  },
  {
    dominio: "ordens_servicos",
    label: "Ordens de Serviço",
    obrigatorios: ["os.numero"],
    opcionais: ["cliente.nome", "financeiro.valorTotal", "data.prazoEntrega", "data.abertura", "data.data", "meta.vendedor"],
    nomesArquivo: ["ordem", "ordens_servico", "ordens_servicos", "os"],
  },
  {
    dominio: "vendas_pagamentos",
    label: "Vendas — Pagamentos",
    obrigatorios: ["venda.numero"],
    opcionais: ["pagamento.forma", "financeiro.valorParcela", "pagamento.vencimento"],
    nomesArquivo: ["vendas_pagamento", "venda_pagamento", "vendas_pagamentos"],
  },
  {
    dominio: "vendas_produtos",
    label: "Vendas — Produtos/Itens",
    obrigatorios: ["venda.numero"],
    opcionais: ["produto.nome", "item.quantidade", "financeiro.valorUnitario"],
    nomesArquivo: ["vendas_produto", "venda_produto", "vendas_produtos", "itens_venda"],
  },
  {
    dominio: "vendas_historicos",
    label: "Vendas — Histórico",
    obrigatorios: ["venda.numero"],
    opcionais: ["status.situacao", "meta.funcionario", "data.data"],
    nomesArquivo: ["vendas_historico", "historico_venda", "vendas_historicos"],
  },
  {
    dominio: "vendas",
    label: "Vendas",
    obrigatorios: ["venda.numero", "cliente.nome"],
    opcionais: ["financeiro.valorTotal", "data.data"],
    nomesArquivo: ["venda", "vendas", "pedido", "pedidos"],
  },
  {
    dominio: "fornecedores_enderecos",
    label: "Fornecedores — Endereços",
    obrigatorios: ["endereco.cep"],
    opcionais: ["endereco.logradouro", "endereco.cidade", "endereco.bairro"],
    nomesArquivo: ["fornecedor_endereco", "fornecedores_endereco", "fornecedores_enderecos"],
  },
  {
    dominio: "fornecedores",
    label: "Fornecedores",
    obrigatorios: ["fornecedor.tipo"],
    opcionais: ["cliente.nome", "cliente.email", "cliente.celular"],
    nomesArquivo: ["fornecedor", "fornecedores", "supplier"],
  },
  {
    dominio: "clientes_enderecos",
    label: "Clientes — Endereços",
    obrigatorios: ["endereco.cep", "endereco.cidade"],
    opcionais: ["endereco.logradouro", "endereco.bairro"],
    nomesArquivo: ["clientes_endereco", "clientes_enderecos"],
  },
  {
    dominio: "clientes",
    label: "Clientes",
    obrigatorios: ["cliente.nome", "cliente.tipoPessoa"],
    opcionais: ["cliente.codigo", "cliente.cpf", "cliente.cnpj", "cliente.celular", "cliente.telefone", "cliente.email", "cliente.rg"],
    nomesArquivo: ["cliente", "clientes"],
  },
  {
    dominio: "servicos_catalogo",
    label: "Catálogo de Serviços",
    obrigatorios: ["servico.nome", "financeiro.valorUnitario"],
    opcionais: ["servico.sku", "meta.cadastradoPor"],
    nomesArquivo: ["servico", "servicos", "catalogo_servico"],
  },
  {
    dominio: "produtos",
    label: "Produtos / Estoque",
    obrigatorios: ["produto.nome"],
    opcionais: [
      "produto.sku",
      "produto.barcode",
      "produto.ncm",
      "financeiro.precoVenda",
      "financeiro.custo",
      "produto.estoque",
    ],
    nomesArquivo: ["produto", "produtos", "estoque", "catalogo"],
  },
  {
    dominio: "contas_pagar",
    label: "Contas a Pagar",
    obrigatorios: ["financeiro.descricao", "pagamento.vencimento"],
    opcionais: ["financeiro.entidadeNome", "financeiro.valorTotal", "status.situacao"],
    nomesArquivo: ["contas_pagar", "conta_pagar", "pagar", "despesa"],
  },
  {
    dominio: "contas_receber",
    label: "Contas a Receber",
    obrigatorios: ["financeiro.descricao", "pagamento.vencimento"],
    opcionais: ["financeiro.entidadeNome", "financeiro.valorTotal", "status.situacao"],
    nomesArquivo: ["contas_receber", "conta_receber", "receber", "receita"],
  },
]

// ── API pública ───────────────────────────────────────────────

/** Normaliza um header bruto para chave do dicionário semântico */
export function normHeader(h: unknown): string {
  return norm(h)
}

/**
 * Resolve um header para o campo semântico canônico.
 *
 * `dominio` é opcional para preservar o comportamento de todos os callers antigos
 * (OS, vendas, clientes, financeiro). Quando vale `"produtos"`, o dicionário de
 * produtos tem precedência: é o que impede "Código" de virar código de cliente e
 * "Marca" de virar marca de equipamento numa planilha de catálogo.
 */
export function resolverCampoSemantico(header: string, dominio?: DominioImport): string | null {
  const n = norm(header)
  if (dominio === "produtos") {
    const especifico = DICIONARIO_PRODUTOS[n]
    if (especifico) return especifico
  }
  return DICIONARIO_SEMANTICO[n] ?? null
}

/** Mapeia todos os headers de uma planilha para campos semânticos */
export function mapearHeaders(headers: string[], dominio?: DominioImport): Record<string, string> {
  const mapa: Record<string, string> = {}
  for (const h of headers) {
    const campo = resolverCampoSemantico(h, dominio)
    if (campo) mapa[h] = campo
  }
  return mapa
}

/** Detecta o domínio de uma planilha com score de confiança */
export function detectarDominio(
  headers: string[],
  nomeArquivo: string
): { dominio: DominioImport; confianca: number; chaveJoin: string | null } {
  const nomeNorm = norm(nomeArquivo)

  // ── Curto-circuito GestaoClick: match exato por basename ──
  // Backups GestaoClick usam nomes canônicos (ordens_servicos.xlsx, contas_receber.xlsx, …)
  // e nem sempre conseguem fechar score semântico (ex.: coluna "Código" não vira "os.numero").
  // Quando o filename casa, confiamos 100% e deixamos o merger usar a chaveJoin contextual.
  const dominioPorNome = dominioPorNomeArquivo(nomeArquivo)
  if (dominioPorNome) {
    return {
      dominio: dominioPorNome,
      confianca: 1,
      chaveJoin: determinarChaveJoin(dominioPorNome, headers),
    }
  }

  const camposSemanticos = new Set(headers.map((h) => resolverCampoSemantico(h)).filter(Boolean) as string[])
  // Segundo conjunto, resolvido com o dicionário de produtos. Usado APENAS para
  // pontuar a assinatura `produtos` — as demais continuam vendo o mapa genérico,
  // então nenhuma planilha de OS/venda/cliente muda de classificação.
  const camposProdutos = new Set(
    headers.map((h) => resolverCampoSemantico(h, "produtos")).filter(Boolean) as string[],
  )

  let melhorScore = 0
  let melhorDominio: DominioImport = "desconhecido"

  for (const sig of ASSINATURAS) {
    const campos = sig.dominio === "produtos" ? camposProdutos : camposSemanticos

    // Bônus por nome de arquivo
    const bonusNome = sig.nomesArquivo.some((n) => nomeNorm.includes(norm(n))) ? 0.2 : 0

    // Score por campos obrigatórios
    const obrigPresentes = sig.obrigatorios.filter((c) => campos.has(c)).length
    const obrigTotal = sig.obrigatorios.length
    const scoreObrig = obrigTotal > 0 ? obrigPresentes / obrigTotal : 0

    // Score por campos opcionais
    const opcionaisPresentes = sig.opcionais.filter((c) => campos.has(c)).length
    const opcionaisTotal = sig.opcionais.length
    const scoreOpcional = opcionaisTotal > 0 ? opcionaisPresentes / opcionaisTotal : 0

    // Score final ponderado
    const score = scoreObrig * 0.6 + scoreOpcional * 0.2 + bonusNome

    if (score > melhorScore) {
      melhorScore = score
      melhorDominio = sig.dominio
    }
  }

  // Determina a chave de join principal
  const chaveJoin = determinarChaveJoin(melhorDominio, headers)

  return {
    dominio: melhorScore >= 0.3 ? melhorDominio : "desconhecido",
    confianca: Math.min(melhorScore, 1),
    chaveJoin,
  }
}

/** Retorna a coluna original (header real) que corresponde à chave de join */
function determinarChaveJoin(dominio: DominioImport, headers: string[]): string | null {
  const chavesPorDominio: Record<string, string[]> = {
    ordens_servicos: ["os.numero"],
    os_equipamentos: ["os.numero"],
    os_pagamentos: ["os.numero"],
    os_servicos: ["os.numero"],
    os_situacoes: ["os.numero"],
    vendas: ["venda.numero"],
    vendas_historicos: ["venda.numero"],
    vendas_pagamentos: ["venda.numero"],
    vendas_produtos: ["venda.numero"],
    clientes: ["cliente.codigo", "cliente.cpf", "cliente.cnpj", "cliente.documento", "cliente.nome"],
    clientes_enderecos: ["cliente.codigo", "cliente.cpf", "cliente.documento"],
    fornecedores: ["cliente.nome"],
    fornecedores_enderecos: ["cliente.nome"],
    // Produtos: o código de barras é a chave mais estável de uma NF-e/catálogo.
    produtos: ["produto.barcode", "produto.sku", "produto.nome"],
    servicos_catalogo: ["servico.nome", "servico.sku"],
    contas_pagar: ["financeiro.descricao"],
    contas_receber: ["financeiro.descricao"],
  }

  const camposChave = chavesPorDominio[dominio] ?? []
  for (const campoChave of camposChave) {
    for (const h of headers) {
      if (resolverCampoSemantico(h, dominio) === campoChave) return h
    }
  }

  // ── Fallback GestaoClick: backups usam "Código" como ID em quase tudo ──
  // (OS, Vendas, Produtos, Clientes…). Quando o resolver semântico não encontra
  // a chave canônica, procuramos por nomes brutos comuns ANTES de cair em headers[0].
  const dominiosBuscamCodigo: DominioImport[] = [
    "ordens_servicos", "os_equipamentos", "os_pagamentos", "os_servicos", "os_situacoes",
    "vendas", "vendas_historicos", "vendas_pagamentos", "vendas_produtos",
    "clientes", "clientes_enderecos", "fornecedores", "fornecedores_enderecos",
    "produtos", "servicos_catalogo",
  ]
  if (dominiosBuscamCodigo.includes(dominio)) {
    const candidatos = ["codigo", "código", "numero", "número", "n da os", "nº da os", "n da venda", "nº da venda", "id"]
    for (const h of headers) {
      const n = norm(h)
      if (candidatos.some((c) => n === norm(c) || n.startsWith(norm(c) + " "))) return h
    }
  }

  return headers[0] ?? null
}

/** Retorna o label legível de um domínio */
export function labelDominio(dominio: DominioImport): string {
  return ASSINATURAS.find((s) => s.dominio === dominio)?.label ?? dominio
}
