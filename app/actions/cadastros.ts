"use server";

import { Prisma, StatusOrdemServico } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { withPrismaSafe } from "@/lib/prisma";
import {
  mergeProdutoMetadataTwoLevels,
  normalizeProdutoIdentifier,
  produtoStockPatch,
} from "@/lib/cadastros/produto-upsert-metadata";
import {
  mergeProdutoAcessoriosIntoMetadata,
  produtoAcessoriosInputFromBody,
} from "@/lib/acessorios/metadata";
import { fiscalInputFromBody } from "@/lib/produto-fiscal";
import { canonicalizeProdutoFiscalMetadata } from "@/lib/produtos/produto-fiscal-upsert";
import {
  duplicateProductDetails,
  PRODUTO_DUP_SELECT,
  type ExistingProdutoLite,
} from "@/lib/produtos/duplicate-product";
import { validarGtin, type GtinFormato } from "@/lib/cadastros/gtin";
import { requireCadastrosStoreAccess } from "@/lib/cadastros/cadastros-action-access";
import {
  consultarProdutosSql,
  MENSAGEM_ERRO_FILTROS_PRODUTOS,
  normalizarFiltroImportacao,
  resolverUltimoBatchProdutos,
  type ErroFiltrosProdutos,
  type ProdutosListagemFiltros,
} from "@/lib/cadastros/produtos-listagem-sql";
import {
  avaliarAptidaoAtivacao,
  estadoConferencia,
  getImportacaoMetadata,
  isSyntheticImportSku,
  marcarLoteRevisado,
  MENSAGEM_PRECO_OBRIGATORIO,
  type EstadoConferencia,
  type ProdutoImportMatch,
} from "@/lib/cadastros/importacao-produtos";
import { getProdutoFiscal } from "@/lib/produto-fiscal";
import {
  classificarBarcode,
  fabricaProvedorPadrao,
  lerEnvBarcode,
  memoLookupGlobal,
  resolverCodigoBarrasCore,
  type ProdutoNormalizado,
  type ProvedorId,
  type ResultadoCadeia,
  type TentativaLookup,
} from "@/lib/barcode-lookup";

export type CadastrosKpiIcon =
  | "Users"
  | "Package"
  | "Wrench"
  | "Truck"
  | "HardHat"
  | "Smartphone"
  | "AlertTriangle"
  | "RefreshCw";

export type CadastrosKpi = {
  label: string;
  value: number;
  delta: string;
  icon: CadastrosKpiIcon;
};

export type CadastrosSaudeItem = { label: string; value: number };

export type CadastrosProdutoAlerts = {
  estoqueBaixo: number;
  semPreco: number;
  semFornecedor: number;
  margemBaixa: number;
  prontosMarketplace: number;
};

export type CadastrosIaStats = {
  produtosProntosMarketplace: number;
  cadastrosGeradosPorIa: number; // ainda sem modelo (0)
  produtosSemImagem: number;
  anunciosPendentes: number;
  duplicadosEncontrados: number;
  camposFiscaisFaltando: number; // ainda sem campos fiscais formais no Produto (0)
};

export type CadastrosDashboardStats = {
  kpis: CadastrosKpi[];
  saude: CadastrosSaudeItem[];
  produtoAlerts: CadastrosProdutoAlerts;
  ia: CadastrosIaStats;
};

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  const v = Math.round((part / total) * 100);
  return Math.max(0, Math.min(100, v));
}

/**
 * Estatísticas do dashboard do Cadastros HUB.
 * Importante: se alguma tabela/model não existir no banco em produção, `withPrismaSafe` retorna 0 sem quebrar UI.
 */
export async function getCadastrosDashboardStats(storeId: string): Promise<CadastrosDashboardStats> {
  const now = new Date();
  const monthStart = startOfMonth(now);

  const [
    totalClientes,
    clientesComTelefone,
    clientesAtualizadosMes,
    totalProdutos,
    produtosAtivos,
    produtosAtualizadosMes,
    produtosSemPreco,
    produtosSemSku,
    produtosSemFornecedor,
    produtosEstoqueBaixo,
    totalServicos,
    servicosAtualizadosMes,
    servicosComGarantia,
    fornecedoresAtivos,
    categoriasAtivas,
    marcasAtivas,
    tecnicosAtivos,
    equipamentosModelosAtivos,
  ] = await Promise.all([
    withPrismaSafe((db) => db.cliente.count({ where: { storeId } }), 0),
    withPrismaSafe((db) => db.cliente.count({ where: { storeId, phone: { not: null } } }), 0),
    withPrismaSafe((db) => db.cliente.count({ where: { storeId, updatedAt: { gte: monthStart } } }), 0),

    withPrismaSafe((db) => db.produto.count({ where: { storeId } }), 0),
    withPrismaSafe((db) => db.produto.count({ where: { storeId, active: true } }), 0),
    withPrismaSafe((db) => db.produto.count({ where: { storeId, updatedAt: { gte: monthStart } } }), 0),
    withPrismaSafe((db) => db.produto.count({ where: { storeId, price: { lte: 0 } } }), 0),
    withPrismaSafe((db) => db.produto.count({ where: { storeId, OR: [{ sku: null }, { sku: "" }] } }), 0),
    withPrismaSafe((db) => db.produto.count({ where: { storeId, supplierName: "" } }), 0),
    withPrismaSafe((db) => db.produto.count({ where: { storeId, stock: { gt: 0, lt: 6 } } }), 0),

    withPrismaSafe((db) => db.servico.count({ where: { storeId } }), 0),
    withPrismaSafe((db) => db.servico.count({ where: { storeId, updatedAt: { gte: monthStart } } }), 0),
    withPrismaSafe((db) => db.servico.count({ where: { storeId, warrantyDays: { gt: 0 } } }), 0),

    withPrismaSafe((db) => db.fornecedor.count({ where: { storeId, active: true } }), 0),
    withPrismaSafe((db) => db.categoriaCadastro.count({ where: { storeId, active: true } }), 0),
    withPrismaSafe((db) => db.marcaCadastro.count({ where: { storeId, active: true } }), 0),
    withPrismaSafe((db) => db.tecnico.count({ where: { storeId, active: true } }), 0),
    withPrismaSafe((db) => db.equipamentoModelo.count({ where: { storeId, active: true } }), 0),
  ]);

  // margem baixa: depende de custo/preço; filtra no app (não dá pra fazer com index simples aqui).
  const margemBaixa = await withPrismaSafe(async (db) => {
    const rows = await db.produto.findMany({
      where: { storeId, price: { gt: 0 } },
      select: { price: true, precoCusto: true },
      take: 5000,
    });
    let low = 0;
    for (const r of rows) {
      const preco = Number(r.price ?? 0);
      const custo = Number(r.precoCusto ?? 0);
      if (preco <= 0) continue;
      const margin = ((preco - custo) / preco) * 100;
      if (Number.isFinite(margin) && margin > 0 && margin < 20) low++;
    }
    return low;
  }, 0);

  // "Prontos p/ Marketplace": heurística mínima (sem inventar features).
  const prontosMarketplace = await withPrismaSafe(
    (db) =>
      db.produto.count({
        where: {
          storeId,
          active: true,
          price: { gt: 0 },
          stock: { gt: 0 },
          category: { not: null },
        },
      }),
    0
  );

  const produtosSemImagem = await withPrismaSafe(
    async (db) => {
      const total = await db.produto.count({ where: { storeId } });
      if (total <= 0) return 0;
      const withAnyMedia = await db.productMedia.count({
        where: { storeId },
      });
      // count de mídia não é count de produtos; calculo correto via distinct productId.
      const distinct = await db.productMedia.findMany({
        where: { storeId },
        select: { productId: true },
        distinct: ["productId"],
      });
      const productsWithMedia = distinct.length;
      return Math.max(0, total - productsWithMedia);
    },
    0
  );

  const anunciosPendentes = await withPrismaSafe(
    (db) =>
      db.marketplaceListing.count({
        where: {
          storeId,
          status: { in: ["draft", "pending", "error"] },
        },
      }),
    0
  );

  const duplicadosEncontrados = await withPrismaSafe(
    async (db) => {
      // Heurística mínima: documentos de cliente duplicados (não vazio) + SKU duplicado (não vazio)
      const [dupDocs, dupSkus] = await Promise.all([
        db.cliente.groupBy({
          by: ["document"],
          where: { storeId, document: { not: "" } },
          _count: { _all: true },
          having: { document: { _count: { gt: 1 } } },
        }),
        db.produto.groupBy({
          by: ["sku"],
          where: { storeId, sku: { not: null } },
          _count: { _all: true },
          having: { sku: { _count: { gt: 1 } } },
        }),
      ]);
      const docsExtra = dupDocs.reduce((acc, g) => acc + Math.max(0, (g._count?._all ?? 0) - 1), 0);
      const skusExtra = dupSkus.reduce((acc, g) => acc + Math.max(0, (g._count?._all ?? 0) - 1), 0);
      return docsExtra + skusExtra;
    },
    0
  );

  const equipamentosComPecasCompativeisPct = await withPrismaSafe(
    async (db) => {
      const total = await db.equipamentoModelo.count({ where: { storeId } });
      if (total <= 0) return 0;
      // JsonB: `count` com not null pode conflitar com tipos; faz via findMany + filtro.
      const rows = await db.equipamentoModelo.findMany({
        where: { storeId },
        select: { compatibleParts: true },
        take: 5000,
      });
      const withParts = rows.filter((r) => Array.isArray(r.compatibleParts) && r.compatibleParts.length > 0).length;
      return pct(withParts, total);
    },
    0
  );

  // incompletos: produtos com preço<=0 ou sem categoria/sku + serviços sem categoria ou preço<=0 + clientes sem telefone
  const cadastrosIncompletos = produtosSemPreco + produtosSemSku + produtosSemFornecedor;

  const atualizadosEsteMes = clientesAtualizadosMes + produtosAtualizadosMes + servicosAtualizadosMes;

  const kpis: CadastrosKpi[] = [
    { label: "Clientes cadastrados", value: totalClientes, delta: "+0", icon: "Users" },
    { label: "Produtos ativos", value: produtosAtivos, delta: "+0", icon: "Package" },
    { label: "Serviços cadastrados", value: totalServicos, delta: "+0", icon: "Wrench" },
    { label: "Fornecedores ativos", value: fornecedoresAtivos, delta: "+0", icon: "Truck" },
    { label: "Técnicos cadastrados", value: tecnicosAtivos, delta: "+0", icon: "HardHat" },
    { label: "Equipamentos / modelos", value: equipamentosModelosAtivos, delta: "+0", icon: "Smartphone" },
    { label: "Cadastros incompletos", value: cadastrosIncompletos, delta: "+0", icon: "AlertTriangle" },
    { label: "Atualizados este mês", value: atualizadosEsteMes, delta: "+0", icon: "RefreshCw" },
  ];

  const saude: CadastrosSaudeItem[] = [
    { label: "Clientes com telefone", value: pct(clientesComTelefone, totalClientes) },
    { label: "Produtos com SKU", value: pct(totalProdutos - produtosSemSku, totalProdutos) },
    { label: "Produtos com preço", value: pct(totalProdutos - produtosSemPreco, totalProdutos) },
    { label: "Serviços com garantia", value: pct(servicosComGarantia, totalServicos) },
    // Fornecedor com CNPJ (model existe, mas “document” é livre; usamos document != "")
    {
      label: "Fornecedores com CNPJ",
      value: await withPrismaSafe(
        async (db) => {
          const total = await db.fornecedor.count({ where: { storeId } });
          const withDoc = await db.fornecedor.count({ where: { storeId, document: { not: "" } } });
          return pct(withDoc, total);
        },
        0
      ),
    },
    { label: "Equipamentos com peças compatíveis", value: equipamentosComPecasCompativeisPct },
  ];

  const produtoAlerts: CadastrosProdutoAlerts = {
    estoqueBaixo: produtosEstoqueBaixo,
    semPreco: produtosSemPreco,
    semFornecedor: produtosSemFornecedor,
    margemBaixa,
    prontosMarketplace,
  };

  const ia: CadastrosIaStats = {
    produtosProntosMarketplace: prontosMarketplace,
    cadastrosGeradosPorIa: 0,
    produtosSemImagem,
    anunciosPendentes,
    duplicadosEncontrados,
    camposFiscaisFaltando: 0,
  };

  return { kpis, saude, produtoAlerts, ia };
}

export type FornecedorDTO = {
  id: string;
  nome: string;
  razaoSocial: string;
  cnpj: string;
  contato: string;
  whatsapp: string;
  email: string;
  endereco: string;
  produtos: string;
  prazo: string;
  pagamento: string;
  observacoes: string;
  ultima: string;
  status: "Ativo" | "Inativo";
};

export async function listFornecedores(storeId: string): Promise<FornecedorDTO[]> {
  const rows = await prisma.fornecedor.findMany({
    where: { storeId },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  return rows.map((f) => ({
    id: f.id,
    nome: f.name,
    razaoSocial: f.legalName,
    cnpj: f.document || "—",
    contato: f.contactName || "—",
    whatsapp: f.whatsapp || "—",
    email: f.email || "—",
    endereco: f.address || "",
    produtos: f.productsProvided || "",
    prazo: f.avgLeadTime || "—",
    pagamento: f.paymentTerms || "—",
    observacoes: f.notes ?? "",
    ultima: fmtDateISO(f.updatedAt),
    status: f.active ? "Ativo" : "Inativo",
  }));
}

export async function upsertFornecedor(
  storeId: string,
  input: {
    id?: string;
    nome: string;
    razaoSocial?: string;
    cnpj?: string;
    contato?: string;
    whatsapp?: string;
    email?: string;
    endereco?: string;
    produtos?: string;
    prazo?: string;
    pagamento?: string;
    observacoes?: string;
    active?: boolean;
  }
): Promise<{ id: string }> {
  const nome = input.nome.trim();
  if (!nome) throw new Error("Nome obrigatório");

  const common = {
    name: nome,
    legalName: (input.razaoSocial ?? "").trim(),
    contactName: (input.contato ?? "").trim(),
    document: (input.cnpj ?? "").trim(),
    phone: "", // UI atual não tem campo telefone separado do whatsapp; manter vazio por enquanto
    whatsapp: (input.whatsapp ?? "").trim(),
    email: (input.email ?? "").trim(),
    address: (input.endereco ?? "").trim(),
    productsProvided: (input.produtos ?? "").trim(),
    avgLeadTime: (input.prazo ?? "").trim(),
    paymentTerms: (input.pagamento ?? "").trim(),
    notes: (input.observacoes ?? "").trim() || null,
    active: input.active ?? true,
  } as const;

  if (input.id) {
    const existing = await prisma.fornecedor.findFirst({ where: { id: input.id, storeId }, select: { id: true } });
    if (!existing) throw new Error("Fornecedor não encontrado");
    const updated = await prisma.fornecedor.update({ where: { id: input.id }, data: common, select: { id: true } });
    revalidatePath("/dashboard/cadastros-v2");
    return updated;
  }

  const created = await prisma.fornecedor.create({ data: { ...common, storeId }, select: { id: true } });
  revalidatePath("/dashboard/cadastros-v2");
  return created;
}

export type CategoriaCadastroType = "produto" | "servico" | "equipamento" | "geral";

export type CategoriaCadastroDTO = {
  id: string;
  name: string;
  type: CategoriaCadastroType;
  active: boolean;
};

export async function listCategorias(storeId: string): Promise<CategoriaCadastroDTO[]> {
  const sid = await requireCadastrosStoreAccess(storeId);
  const rows = await prisma.categoriaCadastro.findMany({
    where: { storeId: sid },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    take: 1000,
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    type: (c.type as CategoriaCadastroType) || "geral",
    active: c.active,
  }));
}

export async function upsertCategoria(
  storeId: string,
  input: { id?: string; name: string; type: CategoriaCadastroType; active?: boolean }
): Promise<{ id: string; name: string }> {
  const sid = await requireCadastrosStoreAccess(storeId);
  const name = input.name.trim();
  if (!name) throw new Error("Nome obrigatório");
  const type = input.type || "geral";

  const common = {
    name,
    type,
    active: input.active ?? true,
  } as const;

  if (input.id) {
    const existing = await prisma.categoriaCadastro.findFirst({ where: { id: input.id, storeId: sid }, select: { id: true } });
    if (!existing) throw new Error("Categoria não encontrada");
    const updated = await prisma.categoriaCadastro.update({ where: { id: input.id }, data: common, select: { id: true, name: true } });
    revalidatePath("/dashboard/cadastros-v2");
    return updated;
  }

  // Dedup case-insensitive antes de criar: evita duplicatas "Apple" vs "apple".
  const dup = await prisma.categoriaCadastro.findFirst({
    where: { storeId: sid, type, name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true, active: true },
  });
  if (dup) {
    if (!dup.active) {
      await prisma.categoriaCadastro.update({ where: { id: dup.id }, data: { active: true } });
    }
    revalidatePath("/dashboard/cadastros-v2");
    return { id: dup.id, name: dup.name };
  }

  const created = await prisma.categoriaCadastro.create({ data: { ...common, storeId: sid }, select: { id: true, name: true } });
  revalidatePath("/dashboard/cadastros-v2");
  return created;
}

export type MarcaCadastroDTO = {
  id: string;
  name: string;
  type: string;
  active: boolean;
};

export async function listMarcas(storeId: string): Promise<MarcaCadastroDTO[]> {
  const rows = await prisma.marcaCadastro.findMany({
    where: { storeId },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    take: 2000,
  });
  return rows.map((m) => ({
    id: m.id,
    name: m.name,
    type: m.type,
    active: m.active,
  }));
}

export async function upsertMarca(
  storeId: string,
  input: { id?: string; name: string; type?: string; active?: boolean }
): Promise<{ id: string; name: string }> {
  const name = input.name.trim();
  if (!name) throw new Error("Nome obrigatório");
  const type = (input.type ?? "").trim();

  const common = {
    name,
    type,
    active: input.active ?? true,
  } as const;

  if (input.id) {
    const existing = await prisma.marcaCadastro.findFirst({ where: { id: input.id, storeId }, select: { id: true } });
    if (!existing) throw new Error("Marca não encontrada");
    const updated = await prisma.marcaCadastro.update({ where: { id: input.id }, data: common, select: { id: true, name: true } });
    revalidatePath("/dashboard/cadastros-v2");
    return updated;
  }

  // Dedup case-insensitive: reativa marca inativa de mesmo nome em vez de criar duplicata.
  const dup = await prisma.marcaCadastro.findFirst({
    where: { storeId, type, name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true, active: true },
  });
  if (dup) {
    if (!dup.active) {
      await prisma.marcaCadastro.update({ where: { id: dup.id }, data: { active: true } });
    }
    revalidatePath("/dashboard/cadastros-v2");
    return { id: dup.id, name: dup.name };
  }

  const created = await prisma.marcaCadastro.create({ data: { ...common, storeId }, select: { id: true, name: true } });
  revalidatePath("/dashboard/cadastros-v2");
  return created;
}

/**
 * Lista valores distintos de categoria/marca **já gravados em produtos** da loja.
 * Usado para o autocomplete do modal de produto cobrir também strings legadas
 * (importadores, planilhas) que ainda não estão no dicionário CategoriaCadastro/MarcaCadastro.
 */
export async function listCategoriasMarcasUsadasEmProduto(
  storeId: string
): Promise<{ categorias: string[]; marcas: string[] }> {
  try {
    const [cats, brs] = await Promise.all([
      prisma.produto.findMany({
        where: { storeId, category: { not: null } },
        select: { category: true },
        distinct: ["category"],
        take: 2000,
      }),
      prisma.produto.findMany({
        where: { storeId, brand: { not: "" } },
        select: { brand: true },
        distinct: ["brand"],
        take: 2000,
      }),
    ]);
    const categorias = cats
      .map((c) => (c.category ?? "").trim())
      .filter((s) => s.length > 0);
    const marcas = brs
      .map((b) => (b.brand ?? "").trim())
      .filter((s) => s.length > 0);
    return { categorias, marcas };
  } catch {
    return { categorias: [], marcas: [] };
  }
}

export type TecnicoDTO = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  specialty: string;
  commissionPercent: number;
  active: boolean;
};

export async function listTecnicos(storeId: string): Promise<TecnicoDTO[]> {
  const rows = await prisma.tecnico.findMany({
    where: { storeId },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    email: t.email,
    phone: t.phone,
    role: t.role,
    specialty: t.specialty,
    commissionPercent: Number(t.commissionPercent ?? 0),
    active: t.active,
  }));
}

export async function upsertTecnico(
  storeId: string,
  input: {
    id?: string;
    name: string;
    email?: string;
    phone?: string;
    role?: string;
    specialty?: string;
    commissionPercent?: number;
    active?: boolean;
  }
): Promise<{ id: string }> {
  const name = input.name.trim();
  if (!name) throw new Error("Nome obrigatório");

  const common = {
    name,
    email: (input.email ?? "").trim(),
    phone: (input.phone ?? "").trim(),
    role: (input.role ?? "").trim(),
    specialty: (input.specialty ?? "").trim(),
    commissionPercent: Number(input.commissionPercent ?? 0),
    active: input.active ?? true,
  } as const;

  if (input.id) {
    const existing = await prisma.tecnico.findFirst({ where: { id: input.id, storeId }, select: { id: true } });
    if (!existing) throw new Error("Técnico não encontrado");
    const updated = await prisma.tecnico.update({ where: { id: input.id }, data: common, select: { id: true } });
    revalidatePath("/dashboard/cadastros-v2");
    return updated;
  }

  const created = await prisma.tecnico.create({ data: { ...common, storeId }, select: { id: true } });
  revalidatePath("/dashboard/cadastros-v2");
  return created;
}

export type EquipamentoModeloDTO = {
  id: string;
  name: string;
  brand: string;
  type: string;
  year: number;
  averageRepairTime: string;
  active: boolean;
  compatibleParts: string[];
  commonDefects: string[];
  recommendedChecklist: string[];
};

function jsonStringArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  return [];
}

export async function listEquipamentosModelos(storeId: string): Promise<EquipamentoModeloDTO[]> {
  const rows = await prisma.equipamentoModelo.findMany({
    where: { storeId },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  return rows.map((e) => ({
    id: e.id,
    name: e.name,
    brand: e.brand,
    type: e.type,
    year: e.year,
    averageRepairTime: e.averageRepairTime,
    active: e.active,
    compatibleParts: jsonStringArray(e.compatibleParts),
    commonDefects: jsonStringArray(e.commonDefects),
    recommendedChecklist: jsonStringArray(e.recommendedChecklist),
  }));
}

export async function upsertEquipamentoModelo(
  storeId: string,
  input: {
    id?: string;
    name: string;
    brand?: string;
    type?: string;
    year?: number;
    compatibleParts?: string[];
    commonDefects?: string[];
    recommendedChecklist?: string[];
    averageRepairTime?: string;
    active?: boolean;
  }
): Promise<{ id: string }> {
  const name = input.name.trim();
  if (!name) throw new Error("Nome obrigatório");

  const common = {
    name,
    brand: (input.brand ?? "").trim(),
    type: (input.type ?? "").trim(),
    year: Math.max(0, Math.trunc(input.year ?? 0)),
    compatibleParts: input.compatibleParts ?? undefined,
    commonDefects: input.commonDefects ?? undefined,
    recommendedChecklist: input.recommendedChecklist ?? undefined,
    averageRepairTime: (input.averageRepairTime ?? "").trim(),
    active: input.active ?? true,
  } as const;

  if (input.id) {
    const existing = await prisma.equipamentoModelo.findFirst({ where: { id: input.id, storeId }, select: { id: true } });
    if (!existing) throw new Error("Modelo não encontrado");
    const updated = await prisma.equipamentoModelo.update({ where: { id: input.id }, data: common, select: { id: true } });
    revalidatePath("/dashboard/cadastros-v2");
    return updated;
  }

  const created = await prisma.equipamentoModelo.create({ data: { ...common, storeId }, select: { id: true } });
  revalidatePath("/dashboard/cadastros-v2");
  return created;
}

export async function countProdutoImagens(storeId: string): Promise<{ total: number; distinctProducts: number }> {
  const total = await withPrismaSafe((db) => db.productMedia.count({ where: { storeId } }), 0);
  const distinctProducts = await withPrismaSafe(
    async (db) => {
      const distinct = await db.productMedia.findMany({
        where: { storeId },
        select: { productId: true },
        distinct: ["productId"],
      });
      return distinct.length;
    },
    0
  );
  return { total, distinctProducts };
}

export async function countMarketplaceListings(storeId: string): Promise<{ total: number; pending: number }> {
  const total = await withPrismaSafe((db) => db.marketplaceListing.count({ where: { storeId } }), 0);
  const pending = await withPrismaSafe(
    (db) => db.marketplaceListing.count({ where: { storeId, status: { in: ["draft", "pending", "error"] } } }),
    0
  );
  return { total, pending };
}

export type ClienteKind = "PF" | "PJ";

export type ClienteDTO = {
  id: string;
  nome: string;
  tipo: ClienteKind;
  telefone: string;
  email: string;
  documento: string;
  cidade: string;
  uf: string;
  endereco: string;
  observacoes: string;
  totalGasto: number;
  ultimaCompra: string;
  tags: string[];
  /**
   * `Cliente.tags` cru (JSONB). Pode ser array (modelo legado) ou objeto
   * estruturado (importador GestaoClick / form `/dashboard/clientes`).
   * Exposto para que o modal de edição preserve campos não exibidos
   * (rg, financial, etc.) no round-trip salvar.
   */
  tagsRaw: Record<string, unknown> | string[] | null;
  status: "Ativo" | "Inativo";
};

export type ProdutoDTO = {
  id: string;
  nome: string;
  sku: string;
  barras: string;
  categoria: string;
  marca: string;
  fornecedor: string;
  estoque: number;
  custo: number;
  preco: number;
  margem: number;
  garantia: number;
  status: "Ativo" | "Inativo" | "Incompleto";
  /** JSON extensível (IA / integrações) — Fase 1 só persiste, sem motor IA. */
  metadata?: Record<string, unknown> | null;
  /**
   * Resumo da proveniência da importação (`metadata.importacao.ultimoLote`).
   * Alimenta o destaque discreto e os badges da listagem. `null` para produto
   * que nunca veio de planilha.
   */
  importacao?: {
    batchId: string;
    acao: "criado" | "atualizado";
    statusRevisao: "pendente" | "revisado";
    matchPor: ProdutoImportMatch | null;
    fornecedor: string;
    importadoEm: string;
  } | null;
  /** `true` quando o SKU gravado ainda é resíduo de importador (linha-N / IMP-*). */
  skuSintetico?: boolean;
};

/** Extrai o resumo de proveniência exibido na listagem. */
function resumoImportacaoProduto(metadata: unknown): ProdutoDTO["importacao"] {
  const imp = getImportacaoMetadata({ metadata });
  if (!imp) return null;
  const l = imp.ultimoLote;
  return {
    batchId: l.batchId,
    acao: l.acao,
    statusRevisao: l.statusRevisao,
    matchPor: l.matchPor,
    fornecedor: l.fornecedor?.nome ?? "",
    importadoEm: l.importadoEm,
  };
}

export type ServicoDTO = {
  id: string;
  nome: string;
  categoria: string;
  tempo: string;
  custo: number;
  preco: number;
  margem: number;
  garantia: number;
  termo: string;
  active: boolean;
  status: "Ativo" | "Inativo" | "Incompleto";
};

function safeStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((x) => String(x)).filter(Boolean);
  return [];
}

/**
 * Extrai os "labels" (tags visíveis) tanto do modelo legado (`tags` é array)
 * quanto do estruturado (`tags.labels` é array dentro de objeto).
 */
function extractClienteLabels(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((x) => String(x)).filter(Boolean);
  if (typeof value === "object") {
    const labels = (value as Record<string, unknown>).labels;
    if (Array.isArray(labels)) return labels.map((x) => String(x)).filter(Boolean);
  }
  return [];
}

/**
 * Endereço para exibir/editar. Cobre os dois schemas em uso:
 * - importador GestaoClick: `tags.logradouro` + `tags.numero`
 * - form `/dashboard/clientes`: `tags.address.street` + `tags.address.number`
 */
function extractClienteEndereco(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const obj = value as Record<string, unknown>;
  const address =
    obj.address && typeof obj.address === "object" && !Array.isArray(obj.address)
      ? (obj.address as Record<string, unknown>)
      : null;
  const street = String(address?.street ?? obj.logradouro ?? "").trim();
  const number = String(address?.number ?? obj.numero ?? "").trim();
  if (!street) return "";
  return number ? `${street}, ${number}` : street;
}

function extractClienteUf(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const obj = value as Record<string, unknown>;
  const address =
    obj.address && typeof obj.address === "object" && !Array.isArray(obj.address)
      ? (obj.address as Record<string, unknown>)
      : null;
  return String(address?.state ?? obj.uf ?? "").trim();
}

function extractClienteObservacoes(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const obj = value as Record<string, unknown>;
  const operational =
    obj.operational && typeof obj.operational === "object" && !Array.isArray(obj.operational)
      ? (obj.operational as Record<string, unknown>)
      : null;
  return String(operational?.notes ?? obj.observacoes ?? "").trim();
}

function safeTagsRaw(value: unknown): Record<string, unknown> | string[] | null {
  if (!value) return null;
  if (Array.isArray(value)) return value.map((x) => String(x)).filter(Boolean);
  if (typeof value === "object") return value as Record<string, unknown>;
  return null;
}

function fmtDateISO(d: Date | null | undefined): string {
  if (!d) return "—";
  // yyyy-mm-dd para UI mock
  return d.toISOString().slice(0, 10);
}

export async function listClientes(storeId: string): Promise<ClienteDTO[]> {
  try {
    const rows = await prisma.cliente.findMany({
      where: { storeId },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });

    // Agrega totalGasto em paralelo: OS concluídas + Vendas concluídas vinculadas por clienteId.
    // Vendas sem clienteId (GestaoClick importadas ou consumidor final) não entram na soma.
    // Não há dupla contagem: OS e Venda são entidades distintas sem FK cruzada entre si.
    let totalPorCliente = new Map<string, number>();
    try {
      const [osTotals, vendaTotals] = await Promise.all([
        // OS Pronto ou Entregue por cliente
        prisma.ordemServico.groupBy({
          by: ["clienteId"],
          where: {
            storeId,
            clienteId: { not: null },
            status: { in: [StatusOrdemServico.Pronto, StatusOrdemServico.Entregue] },
          },
          _sum: { valorTotal: true },
        }),
        // Vendas concluídas com clienteId preenchido
        prisma.venda.groupBy({
          by: ["clienteId"],
          where: {
            storeId,
            clienteId: { not: null },
            status: "concluida",
          },
          _sum: { total: true },
        }),
      ]);

      const totais = new Map<string, number>();

      for (const r of osTotals) {
        if (r.clienteId) {
          totais.set(r.clienteId, (totais.get(r.clienteId) ?? 0) + Number(r._sum.valorTotal ?? 0));
        }
      }
      for (const r of vendaTotals) {
        if (r.clienteId) {
          totais.set(r.clienteId, (totais.get(r.clienteId) ?? 0) + Number(r._sum.total ?? 0));
        }
      }

      totalPorCliente = totais;
    } catch {
      // fallback silencioso: usa totalSpent estático do banco
    }

    return rows.map((c) => ({
      id: c.id,
      nome: c.name,
      tipo: (c.kind === "PJ" ? "PJ" : "PF") satisfies ClienteKind,
      telefone: c.phone ?? "—",
      email: c.email ?? "",
      documento: c.document || "—",
      cidade: c.city || "—",
      uf: extractClienteUf(c.tags),
      endereco: extractClienteEndereco(c.tags),
      observacoes: extractClienteObservacoes(c.tags),
      totalGasto: totalPorCliente.get(c.id) ?? Number(c.totalSpent ?? 0),
      ultimaCompra: fmtDateISO(c.lastPurchaseAt),
      tags: extractClienteLabels(c.tags),
      tagsRaw: safeTagsRaw(c.tags),
      status: c.active ? "Ativo" : "Inativo",
    }));
  } catch (err) {
    console.error("[listClientes] erro ao buscar clientes:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

export async function createCliente(
  storeId: string,
  input: {
    nome: string;
    tipo: ClienteKind;
    documento?: string;
    telefone?: string;
    email?: string;
    cidade?: string;
    /** Array legado de labels OU objeto estruturado (`{labels, address, ...}`). */
    tags?: string[] | Record<string, unknown>;
    active?: boolean;
  }
): Promise<{ id: string }> {
  try {
    const nome = input.nome.trim();
    if (!nome) throw new Error("Nome obrigatório");

    const created = await prisma.cliente.create({
      data: {
        storeId,
        name: nome,
        kind: input.tipo,
        document: (input.documento ?? "").trim(),
        phone: (input.telefone ?? "").trim() || null,
        email: (input.email ?? "").trim() || null,
        city: (input.cidade ?? "").trim(),
        tags: input.tags ? (input.tags as Prisma.InputJsonValue) : undefined,
        active: input.active ?? true,
      },
      select: { id: true },
    });
    revalidatePath("/dashboard/cadastros-v2");
    return created;
  } catch (err) {
    console.error("[createCliente] erro ao criar cliente:", err instanceof Error ? err.message : String(err));
    throw err instanceof Error ? err : new Error("Falha ao criar cliente. Tente novamente.");
  }
}

export async function updateCliente(
  storeId: string,
  id: string,
  patch: Partial<{
    nome: string;
    tipo: ClienteKind;
    documento: string;
    telefone: string;
    email: string;
    cidade: string;
    /**
     * Aceita o array legado (UI antiga) ou o objeto estruturado
     * (`{labels, address, operational, ...}`). Os campos não enviados
     * dentro do objeto são preservados pelo caller — esta camada apenas
     * persiste o JSON recebido como está.
     */
    tags: string[] | Record<string, unknown>;
    active: boolean;
  }>
): Promise<void> {
  try {
    const existing = await prisma.cliente.findFirst({ where: { id, storeId }, select: { id: true } });
    if (!existing) throw new Error("Cliente não encontrado");

    await prisma.cliente.update({
      where: { id },
      data: {
        name: patch.nome ? patch.nome.trim() : undefined,
        kind: patch.tipo,
        document: patch.documento !== undefined ? patch.documento.trim() : undefined,
        phone: patch.telefone !== undefined ? patch.telefone.trim() || null : undefined,
        email: patch.email !== undefined ? patch.email.trim() || null : undefined,
        city: patch.cidade !== undefined ? patch.cidade.trim() : undefined,
        tags: patch.tags !== undefined ? (patch.tags as Prisma.InputJsonValue) : undefined,
        active: patch.active,
      },
    });
    revalidatePath("/dashboard/cadastros-v2");
  } catch (err) {
    console.error("[updateCliente] erro ao atualizar cliente:", err instanceof Error ? err.message : String(err));
    throw err instanceof Error ? err : new Error("Falha ao atualizar cliente. Tente novamente.");
  }
}

function produtoMetadataRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

export async function listProdutos(storeId: string, opts?: { q?: string }): Promise<ProdutoDTO[]> {
  const q = opts?.q?.trim();
  try {
    const rows = await prisma.produto.findMany({
      where: {
        storeId,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { sku: { contains: q, mode: "insensitive" as const } },
                { barcode: { contains: q, mode: "insensitive" as const } },
                { category: { contains: q, mode: "insensitive" as const } },
                { brand: { contains: q, mode: "insensitive" as const } },
                { supplierName: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 1000,
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        category: true,
        brand: true,
        supplierName: true,
        stock: true,
        price: true,
        precoCusto: true,
        warrantyDays: true,
        active: true,
        metadata: true,
      },
    });
    return rows.map((p) => {
      const preco = Number(p.price ?? 0);
      const custo = Number(p.precoCusto ?? 0);
      const margem = preco > 0 ? ((preco - custo) / preco) * 100 : 0;
      const status =
        !p.name || !p.category || preco <= 0
          ? ("Incompleto" as const)
          : p.active
            ? ("Ativo" as const)
            : ("Inativo" as const);
      return {
        id: p.id,
        nome: p.name,
        sku: p.sku ?? "—",
        barras: p.barcode ?? "",
        categoria: p.category ?? "—",
        marca: p.brand || "—",
        fornecedor: p.supplierName || "—",
        estoque: p.stock ?? 0,
        custo,
        preco,
        margem: Number.isFinite(margem) ? Number(margem.toFixed(1)) : 0,
        garantia: p.warrantyDays ?? 0,
        status,
        metadata: produtoMetadataRecord(p.metadata),
      };
    });
  } catch (e) {
    // Hardening: em produção, se o banco estiver em versão parcial (colunas/tabelas divergentes),
    // evita quebrar o render e tenta um select mínimo.
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cadastros:listProdutos]", msg);

    const legacyRows = await withPrismaSafe(
      (db) =>
        db.produto.findMany({
          where: {
            storeId,
            ...(q
              ? {
                  OR: [
                    { name: { contains: q, mode: "insensitive" as const } },
                    { sku: { contains: q, mode: "insensitive" as const } },
                    { barcode: { contains: q, mode: "insensitive" as const } },
                    { category: { contains: q, mode: "insensitive" as const } },
                  ],
                }
              : {}),
          },
          orderBy: { updatedAt: "desc" },
          take: 1000,
          select: {
            id: true,
            name: true,
            sku: true,
            barcode: true,
            category: true,
            stock: true,
            price: true,
            precoCusto: true,
            updatedAt: true,
          },
        }),
      [],
    );

    return legacyRows.map((p) => {
      const preco = Number(p.price ?? 0);
      const custo = Number(p.precoCusto ?? 0);
      const margem = preco > 0 ? ((preco - custo) / preco) * 100 : 0;
      const status = !p.name || !p.category || preco <= 0 ? ("Incompleto" as const) : ("Ativo" as const);
      return {
        id: p.id,
        nome: p.name,
        sku: p.sku ?? "—",
        barras: p.barcode ?? "",
        categoria: p.category ?? "—",
        marca: "—",
        fornecedor: "—",
        estoque: p.stock ?? 0,
        custo,
        preco,
        margem: Number.isFinite(margem) ? Number(margem.toFixed(1)) : 0,
        garantia: 0,
        status,
        metadata: null,
      };
    });
  }
}
/**
 * `batchId` do lote de produtos mais recente da loja. Base do filtro
 * "Última importação" e do destaque na listagem. `null` quando a loja nunca
 * importou produtos por planilha.
 *
 * Delega para a camada única de SQL. O fallback anterior (varrer os 200 produtos
 * mais recentes via Prisma) foi removido: ele podia devolver um lote DIFERENTE do
 * mais recente e o filtro "Última importação" mentia sem avisar. Falha aqui é
 * propagada para o chamador decidir — ver `listProdutosPaginado`.
 */
export async function getUltimoBatchProdutos(storeId: string): Promise<string | null> {
  return resolverUltimoBatchProdutos(storeId);
}

/**
 * Resultado da listagem paginada.
 *
 * `erroFiltros` presente = a consulta NÃO pôde ser respondida. Nesse caso `produtos` é
 * vazio e `total` é 0 de propósito: a UI mostra o erro e mantém os filtros selecionados,
 * em vez de exibir o catálogo inteiro como se o filtro tivesse sido aplicado (F-02).
 */
export type ListagemProdutosResultado = {
  produtos: ProdutoDTO[];
  total: number;
  erroFiltros?: ErroFiltrosProdutos;
};

// ─── Listagem paginada (CadastrosHub → ProdutosPanel) ───────────────────────
// Os demais callers (osStore, executor, api/estoque) continuam usando
// `listProdutos` (retorna ProdutoDTO[]) e não foram alterados.
// Consulta ÚNICA em `lib/cadastros/produtos-listagem-sql` (página + total no mesmo
// WHERE) e suporta 5000+ produtos.
export async function listProdutosPaginado(
  storeId: string,
  opts?: {
    q?: string;
    page?: number;
    pageSize?: number;
    filters?: {
      status?: string;
      estoque?: string;
      preco?: string;
      fornecedor?: string;
      categoria?: string;
      marca?: string;
      /**
       * Filtros de importação (Parte 11). Todos server-side — a paginação e a busca
       * continuam no banco inteiro.
       *
       * `importacao`: "ultimoLote" | "hoje" | "pendenteRevisao" | "revisado"
       *               | "semBarcode" | "skuSintetico" | "semNcm" | "semCest"
       */
      importacao?: string;
      /** Recorte por lote específico. */
      batchId?: string;
      /** Nome exato do fornecedor gravado em `supplierName`. */
      fornecedorNome?: string;
    };
    orderBy?: {
      field: string;
      direction: "asc" | "desc";
    };
  },
): Promise<ListagemProdutosResultado> {
  const filtros: ProdutosListagemFiltros = opts?.filters ?? {};
  const importacao = normalizarFiltroImportacao(filtros.importacao);

  // "Última importação" vira um recorte exato por `batchId`, resolvido antes da consulta
  // principal. Se a resolução falhar o filtro NÃO pode ser aplicado — devolver a listagem
  // sem ele mostraria o catálogo inteiro como se o recorte tivesse funcionado.
  let batchIdResolvido: string | null = null;
  if (importacao === "ultimoLote" && !(filtros.batchId ?? "").trim()) {
    try {
      batchIdResolvido = (await resolverUltimoBatchProdutos(storeId)) ?? "__sem_lote__";
    } catch (e) {
      console.error(
        "[cadastros:listProdutosPaginado] FILTROS_PRODUTOS_SQL_FALHOU (ultimoLote)",
        e instanceof Error ? e.message : String(e),
      );
      return {
        produtos: [],
        total: 0,
        erroFiltros: {
          codigo: "FILTROS_PRODUTOS_SQL_FALHOU",
          filtrosSolicitados: ["importacao:ultimoLote"],
          sqlState: null,
          mensagem: MENSAGEM_ERRO_FILTROS_PRODUTOS,
        },
      };
    }
  }

  const mapRow = (p: {
    id: string;
    name: string;
    sku: string | null;
    barcode: string | null;
    category: string | null;
    brand: string;
    supplierName: string;
    stock: number | null;
    price: number | null;
    precoCusto: number | null;
    warrantyDays: number | null;
    active: boolean;
    metadata: unknown;
  }): ProdutoDTO => {
    const preco = Number(p.price ?? 0);
    const custo = Number(p.precoCusto ?? 0);
    const margem = preco > 0 ? ((preco - custo) / preco) * 100 : 0;
    const status =
      !p.name || !p.category || preco <= 0
        ? ("Incompleto" as const)
        : p.active
          ? ("Ativo" as const)
          : ("Inativo" as const);
    return {
      id: p.id,
      nome: p.name,
      sku: p.sku ?? "—",
      barras: p.barcode ?? "",
      categoria: p.category ?? "—",
      marca: p.brand || "—",
      fornecedor: p.supplierName || "—",
      estoque: p.stock ?? 0,
      custo,
      preco,
      margem: Number.isFinite(margem) ? Number(margem.toFixed(1)) : 0,
      garantia: p.warrantyDays ?? 0,
      status,
      metadata: produtoMetadataRecord(p.metadata),
      importacao: resumoImportacaoProduto(p.metadata),
      skuSintetico: isSyntheticImportSku(p.sku),
    };
  };

  const resultado = await consultarProdutosSql({
    storeId,
    q: opts?.q,
    page: opts?.page ?? 1,
    pageSize: opts?.pageSize ?? 100,
    filters: filtros,
    orderBy: opts?.orderBy,
    batchIdResolvido,
  });

  // Fail-closed: filtro que não pôde ser aplicado devolve ERRO e ZERO linha. Não existe
  // mais o fallback que descartava `hoje`/`semNcm`/`semCest` e devolvia o catálogo
  // inteiro como se o filtro tivesse funcionado.
  if (!resultado.ok) return { produtos: [], total: 0, erroFiltros: resultado.erro };

  return { produtos: resultado.rows.map(mapRow), total: resultado.total };
}

export type UpsertProdutoResult =
  | { ok: true; id: string }
  | {
      ok: false;
      type: "DUPLICATE_PRODUCT";
      field: "barcode" | "sku";
      message: string;
      produto?: ExistingProdutoLite;
    }
  | { ok: false; type: "VALIDATION_ERROR" | "NOT_FOUND" | "SAVE_ERROR"; message: string };

export type BarcodeLocalLookupResult =
  | { ok: false; status: "INVALID" | "ERROR"; message: string }
  | {
      ok: true;
      status: "FOUND";
      gtin: string;
      formato: GtinFormato;
      interno: boolean;
      produto: { id: string; nome: string; sku: string | null; barras: string | null; estoque: number; ativo: boolean };
    }
  | { ok: true; status: "NOT_FOUND"; gtin: string; formato: GtinFormato; interno: boolean };

/**
 * Consulta exclusivamente o cadastro da loja atual. Esta action não chama provedores,
 * serviços de IA ou qualquer endpoint externo.
 */
export async function lookupProdutoPorBarcodeLocal(
  storeId: string,
  rawBarcode: string,
): Promise<BarcodeLocalLookupResult> {
  const validation = validarGtin(rawBarcode);
  if (!validation.valid) return { ok: false, status: "INVALID", message: validation.message };

  try {
    const produto = await prisma.produto.findFirst({
      where: { storeId, barcode: { in: validation.lookupCandidates } },
      select: { id: true, name: true, sku: true, barcode: true, stock: true, active: true },
    });
    if (!produto) {
      return {
        ok: true,
        status: "NOT_FOUND",
        gtin: validation.gtin,
        formato: validation.formato,
        interno: validation.interno,
      };
    }
    return {
      ok: true,
      status: "FOUND",
      gtin: validation.gtin,
      formato: validation.formato,
      interno: validation.interno,
      produto: {
        id: produto.id,
        nome: produto.name,
        sku: produto.sku,
        barras: produto.barcode,
        estoque: produto.stock,
        ativo: produto.active,
      },
    };
  } catch {
    return { ok: false, status: "ERROR", message: "Não foi possível consultar o cadastro local. Tente novamente." };
  }
}

export async function upsertProduto(
  storeId: string,
  input: {
    id?: string;
    nome: string;
    sku?: string;
    barras?: string;
    categoria?: string;
    marca?: string;
    fornecedor?: string;
    estoque?: number;
    custo?: number;
    preco?: number;
    garantia?: number;
    active?: boolean;
    metadata?: Record<string, unknown> | null;
    accessoryConfig?: unknown;
  }
): Promise<UpsertProdutoResult> {
  const nome = input.nome.trim();
  if (!nome) return { ok: false, type: "VALIDATION_ERROR", message: "Informe o nome do produto." };

  const sku = normalizeProdutoIdentifier(input.sku);
  const barcode = normalizeProdutoIdentifier(input.barras);
  const duplicateContext = input.id ? "update" : "create";
  const findDuplicate = async (): Promise<ExistingProdutoLite | null> => {
    const duplicateFields: Prisma.ProdutoWhereInput[] = [];
    if (sku) duplicateFields.push({ sku });
    if (barcode) duplicateFields.push({ barcode });
    if (duplicateFields.length === 0) return null;
    return prisma.produto.findFirst({
      where: {
        storeId,
        ...(input.id ? { id: { not: input.id } } : {}),
        OR: duplicateFields,
      },
      select: PRODUTO_DUP_SELECT,
    });
  };

  let existing: { id: string; metadata: unknown } | null = null;
  if (input.id) {
    existing = await prisma.produto.findFirst({
      where: { id: input.id, storeId },
      select: { id: true, metadata: true },
    });
    if (!existing) return { ok: false, type: "NOT_FOUND", message: "Produto não encontrado." };
  }

  const duplicate = await findDuplicate();
  if (duplicate) {
    return { ok: false, ...duplicateProductDetails(duplicate, sku, barcode, { context: duplicateContext }) };
  }

  // Em edição, null é omissão deliberada: preserva o JSON existente e nunca o apaga.
  // A configuração específica é sempre saneada no servidor e substitui/remove somente
  // metadata.acessorios, inclusive para callers legados que ainda mandam o namespace bruto.
  const accessoryInput = produtoAcessoriosInputFromBody(input);
  // Identidade fiscal (GOAL-004): extrai campos fiscais canônicos (top-level ou metadata.fiscal)
  // do body, reutilizando o mesmo contrato das portas REST/importador. null = sem sinal fiscal.
  const fiscalInput = fiscalInputFromBody(input as Record<string, unknown>);
  const shouldWriteMetadata = Boolean(input.metadata) || accessoryInput.provided || fiscalInput != null;
  let nextMetadata: unknown = input.id
    ? mergeProdutoMetadataTwoLevels(existing?.metadata, input.metadata)
    : { ...(input.metadata ?? {}) };
  if (accessoryInput.provided) {
    nextMetadata = mergeProdutoAcessoriosIntoMetadata(nextMetadata, accessoryInput.value);
  }
  // Canoniza `metadata.fiscal` sobre o metadata já mesclado: sanea, preserva os campos fiscais
  // não reenviados e os demais namespaces, e descarta resíduo não canônico. Sem sinal fiscal, o
  // merge de 2 níveis acima já preserva o `fiscal` existente (não recanoniza legado à toa).
  if (fiscalInput) {
    nextMetadata = canonicalizeProdutoFiscalMetadata(nextMetadata, fiscalInput);
  }
  const metadataPart: { metadata?: Prisma.InputJsonValue } = shouldWriteMetadata
    ? { metadata: nextMetadata as Prisma.InputJsonValue }
    : {};

  // Stock: só inclui no patch quando o caller enviou número inteiro >= 0.
  // `undefined` significa "não tocar" — evita zerar estoque ao editar outros campos.
  // (Bug histórico: `Math.trunc(input.estoque ?? 0)` sobrescrevia stock com 0
  // em qualquer chamada sem estoque, ex.: botão Ativar/Inativar antes do fix.)
  const stockPatch = produtoStockPatch(input.estoque);

  const common = {
    name: nome,
    sku,
    barcode,
    category: (input.categoria ?? "").trim() || null,
    brand: (input.marca ?? "").trim(),
    supplierName: (input.fornecedor ?? "").trim(),
    precoCusto: Number(input.custo ?? 0),
    price: Number(input.preco ?? 0),
    warrantyDays: Math.max(0, Math.trunc(input.garantia ?? 0)),
    active: input.active ?? true,
    status: input.active === false ? "Inativo" : "Ativo",
    ...stockPatch,
    ...metadataPart,
  };

  try {
    if (input.id) {
      const updated = await prisma.produto.update({
        where: { id: input.id },
        data: common,
        select: { id: true },
      });
      revalidatePath("/dashboard/cadastros-v2");
      return { ok: true, id: updated.id };
    }

    // Create: estoque inicial é o que o caller enviou; quando ausente, default 0.
    const created = await prisma.produto.create({
      data: { ...common, storeId, stock: stockPatch.stock ?? 0 },
      select: { id: true },
    });
    revalidatePath("/dashboard/cadastros-v2");
    return { ok: true, id: created.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const conflicted = await findDuplicate().catch(() => null);
      if (conflicted) {
        return { ok: false, ...duplicateProductDetails(conflicted, sku, barcode, { context: duplicateContext }) };
      }
      return {
        ok: false,
        type: "DUPLICATE_PRODUCT",
        field: barcode ? "barcode" : "sku",
        message: "SKU ou código de barras já pertence a outro produto desta loja.",
      };
    }
    return { ok: false, type: "SAVE_ERROR", message: "Não foi possível salvar o produto. Tente novamente." };
  }
}

// ─── Conferência pós-importação por lote (Parte 9) ──────────────────────────
// Superfície de revisão do batch: carrega SOMENTE os produtos daquele
// `batchId` + `storeId`, lendo a proveniência de `metadata.importacao`.

export type ConferenciaProdutoDTO = {
  id: string;
  nome: string;
  barras: string;
  sku: string;
  /** `true` quando o SKU gravado ainda é resíduo de importador (linha-N / IMP-*). */
  skuSintetico: boolean;
  custo: number;
  preco: number;
  /** Margem bruta sobre o preço de venda (%). Não confundir com acréscimo sobre custo. */
  margemBruta: number;
  /** Acréscimo do preço sobre o custo (%) — markup. */
  acrescimoCusto: number;
  categoria: string;
  marca: string;
  fornecedor: string;
  ncm: string;
  cest: string;
  estoque: number;
  ativo: boolean;
  /** Ação registrada pela importação deste lote. */
  acaoImportacao: "criado" | "atualizado";
  matchPor: ProdutoImportMatch | null;
  statusRevisao: "pendente" | "revisado";
  revisadoEm: string | null;
  revisadoPor: string | null;
  linhaOrigem: number;
  estado: EstadoConferencia;
  /** Pendências que impedem a ativação (nome/categoria/preço). */
  pendencias: string[];
};

export type ConferenciaLoteDTO = {
  batchId: string;
  storeId: string;
  arquivo: string;
  importadoEm: string;
  fornecedor: { nome: string; documento: string } | null;
  documento: {
    tipo: "nfe" | "outro";
    numero: string;
    serie: string;
    chave: string;
    dataEmissao: string;
  } | null;
  produtos: ConferenciaProdutoDTO[];
  totais: {
    total: number;
    pendentes: number;
    revisados: number;
    incompletos: number;
    aptosAtivacao: number;
  };
};

const CONFERENCIA_SELECT = {
  id: true,
  name: true,
  sku: true,
  barcode: true,
  category: true,
  brand: true,
  supplierName: true,
  stock: true,
  price: true,
  precoCusto: true,
  active: true,
  metadata: true,
} as const;

function mapConferenciaRow(p: {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  brand: string;
  supplierName: string;
  stock: number | null;
  price: number | null;
  precoCusto: number | null;
  active: boolean;
  metadata: unknown;
}): ConferenciaProdutoDTO | null {
  const importacao = getImportacaoMetadata({ metadata: p.metadata });
  if (!importacao) return null;
  const lote = importacao.ultimoLote;

  const preco = Number(p.price ?? 0);
  const custo = Number(p.precoCusto ?? 0);
  const margemBruta = preco > 0 ? ((preco - custo) / preco) * 100 : 0;
  const acrescimoCusto = custo > 0 && preco > 0 ? ((preco - custo) / custo) * 100 : 0;
  const fiscal = getProdutoFiscal({ metadata: p.metadata });
  const aptidao = avaliarAptidaoAtivacao({ nome: p.name, categoria: p.category, preco });

  return {
    id: p.id,
    nome: p.name,
    barras: p.barcode ?? "",
    sku: p.sku ?? "",
    skuSintetico: isSyntheticImportSku(p.sku),
    custo,
    preco,
    margemBruta: Number(margemBruta.toFixed(1)),
    acrescimoCusto: Number(acrescimoCusto.toFixed(1)),
    categoria: p.category ?? "",
    marca: p.brand ?? "",
    fornecedor: p.supplierName ?? "",
    ncm: fiscal.ncm,
    cest: fiscal.cest,
    estoque: p.stock ?? 0,
    ativo: p.active,
    acaoImportacao: lote.acao === "atualizado" ? "atualizado" : "criado",
    matchPor: lote.matchPor,
    statusRevisao: lote.statusRevisao,
    revisadoEm: lote.revisadoEm,
    revisadoPor: lote.revisadoPor,
    linhaOrigem: lote.linhaOrigem,
    estado: estadoConferencia({
      statusRevisao: lote.statusRevisao,
      nome: p.name,
      categoria: p.category,
      preco,
    }),
    pendencias: aptidao.pendencias,
  };
}

/**
 * Carrega a conferência de um lote. O filtro por `batchId` usa o path JSON de
 * `metadata.importacao.ultimoLote.batchId`; se o banco não suportar o filtro, cai
 * para um recorte em memória dos produtos recentes da loja (nunca cruza lojas).
 */
export async function getConferenciaLote(
  storeId: string,
  batchId: string,
): Promise<ConferenciaLoteDTO | null> {
  const sid = (storeId ?? "").trim();
  const bid = (batchId ?? "").trim();
  if (!sid || !bid) return null;

  let rows: Array<Parameters<typeof mapConferenciaRow>[0]> = [];
  try {
    rows = await prisma.produto.findMany({
      where: {
        storeId: sid,
        metadata: { path: ["importacao", "ultimoLote", "batchId"], equals: bid },
      },
      orderBy: { name: "asc" },
      take: 2000,
      select: CONFERENCIA_SELECT,
    });
  } catch (e) {
    console.error("[cadastros:getConferenciaLote:jsonpath]", e instanceof Error ? e.message : String(e));
    const recentes = await withPrismaSafe(
      (db) =>
        db.produto.findMany({
          where: { storeId: sid },
          orderBy: { updatedAt: "desc" },
          take: 2000,
          select: CONFERENCIA_SELECT,
        }),
      [] as Array<Parameters<typeof mapConferenciaRow>[0]>,
    );
    rows = recentes.filter(
      (r) => getImportacaoMetadata({ metadata: r.metadata })?.ultimoLote.batchId === bid,
    );
  }

  const produtos = rows
    .map(mapConferenciaRow)
    .filter((p): p is ConferenciaProdutoDTO => p !== null)
    .sort((a, b) => a.linhaOrigem - b.linhaOrigem || a.nome.localeCompare(b.nome, "pt-BR"));

  if (produtos.length === 0) return null;

  const primeiro = getImportacaoMetadata({ metadata: rows[0]!.metadata })!.ultimoLote;

  return {
    batchId: bid,
    storeId: sid,
    arquivo: primeiro.arquivo,
    importadoEm: primeiro.importadoEm,
    fornecedor: primeiro.fornecedor,
    documento: primeiro.documento,
    produtos,
    totais: {
      total: produtos.length,
      pendentes: produtos.filter((p) => p.estado === "pendente").length,
      revisados: produtos.filter((p) => p.estado === "revisado").length,
      incompletos: produtos.filter((p) => p.estado === "incompleto").length,
      aptosAtivacao: produtos.filter((p) => p.pendencias.length === 0).length,
    },
  };
}

export type AplicarConferenciaResult =
  | {
      ok: true;
      atualizados: number;
      ativados: number;
      revisados: number;
      /** Itens que pediram ativação e foram recusados, com o motivo exibível. */
      naoAtivados: Array<{ id: string; motivo: string }>;
    }
  | { ok: false; message: string };

/**
 * Aplica as decisões da conferência em lote.
 *
 * Cada item traz explicitamente o que muda — a tela confirma antes de chamar.
 * `estoque` NUNCA é tocado aqui (movimentação é fluxo próprio, Parte 13).
 *
 * Ativação (F-05) exige, sem exceção: preço > 0, nome, categoria, ausência de conflito
 * de SKU/barcode na loja, e o produto pertencer a ESTA loja E a ESTE lote. Recusa não é
 * silenciosa — volta em `naoAtivados` com o motivo. "Marcar como revisado" NÃO ativa:
 * são duas decisões distintas e continuam separadas.
 */
export async function aplicarConferenciaLote(
  storeId: string,
  batchId: string,
  itens: Array<{
    id: string;
    /** Novo preço de venda. Omitir = não alterar. */
    preco?: number;
    /** Marcar/desmarcar revisão. Omitir = não alterar. */
    revisado?: boolean;
    /** Tentar ativar o produto. Ignorado se houver pendência. */
    ativar?: boolean;
  }>,
  opts?: { revisadoPor?: string },
): Promise<AplicarConferenciaResult> {
  const sid = (storeId ?? "").trim();
  const bid = (batchId ?? "").trim();
  if (!sid || !bid) return { ok: false, message: "Loja ou lote não informado." };
  if (!Array.isArray(itens) || itens.length === 0) {
    return { ok: false, message: "Nenhum item para aplicar." };
  }
  if (itens.length > 1000) {
    return { ok: false, message: "Limite de 1000 itens por aplicação." };
  }

  const ids = [...new Set(itens.map((i) => (i.id ?? "").trim()).filter(Boolean))];
  if (ids.length === 0) return { ok: false, message: "Nenhum item válido." };

  // Escopo duplo: id ∈ lote E storeId da sessão. Nenhum produto de outra loja
  // ou de outro batch pode ser alterado por esta ação.
  const atuais = await prisma.produto.findMany({
    where: { id: { in: ids }, storeId: sid },
    select: {
      id: true,
      name: true,
      category: true,
      price: true,
      active: true,
      metadata: true,
      sku: true,
      barcode: true,
    },
  });
  const porId = new Map(atuais.map((p) => [p.id, p]));

  let atualizados = 0;
  let ativados = 0;
  let revisados = 0;
  const naoAtivados: Array<{ id: string; motivo: string }> = [];
  const revisadoPor = (opts?.revisadoPor ?? "").trim() || "Conferência de importação";

  for (const item of itens) {
    const atual = porId.get((item.id ?? "").trim());
    if (!atual) continue;
    const importacao = getImportacaoMetadata({ metadata: atual.metadata });
    if (!importacao || importacao.ultimoLote.batchId !== bid) continue;

    const data: Prisma.ProdutoUpdateInput = {};

    if (item.preco !== undefined) {
      const preco = Number(item.preco);
      if (!Number.isFinite(preco) || preco < 0) continue;
      data.price = preco;
    }

    const precoFinal = data.price !== undefined ? Number(data.price) : Number(atual.price ?? 0);

    if (item.ativar) {
      // Conflito de identidade DENTRO da loja: outro produto já usa este SKU/barcode.
      // Ativar assim quebraria o unique `storeId_sku`/`storeId_barcode` no PDV.
      const conflitos = await prisma.produto.count({
        where: {
          storeId: sid,
          id: { not: atual.id },
          OR: [
            ...(atual.sku ? [{ sku: atual.sku }] : []),
            ...(atual.barcode ? [{ barcode: atual.barcode }] : []),
          ],
        },
      });
      const temConflitoIdentidade =
        conflitos > 0 && Boolean(atual.sku || atual.barcode);

      const aptidao = avaliarAptidaoAtivacao({
        nome: atual.name,
        categoria: atual.category,
        preco: precoFinal,
        temConflitoIdentidade,
      });
      if (!aptidao.apto) {
        // Preço zero tem mensagem própria — é a pendência que o operador resolve na tela.
        naoAtivados.push({
          id: atual.id,
          motivo: !(precoFinal > 0)
            ? MENSAGEM_PRECO_OBRIGATORIO
            : aptidao.pendencias.join(" · "),
        });
      } else if (!atual.active) {
        data.active = true;
        data.status = "Ativo";
        ativados++;
      }
    }

    if (item.revisado !== undefined) {
      data.metadata = marcarLoteRevisado(atual.metadata, {
        revisadoPor,
        status: item.revisado ? "revisado" : "pendente",
      }) as Prisma.InputJsonValue;
      if (item.revisado) revisados++;
    }

    if (Object.keys(data).length === 0) continue;

    try {
      await prisma.produto.update({ where: { id: atual.id }, data });
      atualizados++;
    } catch (e) {
      console.error("[cadastros:aplicarConferenciaLote]", e instanceof Error ? e.message : String(e));
    }
  }

  revalidatePath("/dashboard/cadastros-v2");
  return { ok: true, atualizados, ativados, revisados, naoAtivados };
}

export type DeleteProdutoResult =
  | {
      ok: true;
      deleted: true;
      produto: { id: string; nome: string };
    }
  | {
      ok: false;
      reason: string;
      vinculos?: { osItens: number; listings: number; links: number };
      produto?: { id: string; nome: string };
    };

/**
 * Excluir produto físico. Bloqueia se houver vínculos operacionais (OS, marketplace),
 * forçando o usuário a inativar (badge Ativar/Inativar) em vez de apagar. Sem soft delete
 * separado — `Produto.active` já cobre isso.
 */
export async function deleteProduto(
  storeId: string,
  produtoId: string
): Promise<DeleteProdutoResult> {
  if (!produtoId?.trim()) return { ok: false, reason: "ID inválido" };
  const sid = (storeId ?? "").trim();
  if (!sid) return { ok: false, reason: "Loja não selecionada" };

  const produto = await prisma.produto.findFirst({
    where: { id: produtoId, storeId: sid },
    select: { id: true, name: true },
  });
  if (!produto) return { ok: false, reason: "Produto não encontrado nesta loja" };

  // Marketplace listings usa `productId` (inconsistência histórica do schema). Links usa `produtoId`.
  const [osItens, listings, links] = await Promise.all([
    prisma.ordemServicoItem.count({ where: { produtoId } }),
    prisma.marketplaceListing.count({ where: { productId: produtoId } }),
    prisma.marketplaceProductLink.count({ where: { produtoId } }),
  ]);

  if (osItens + listings + links > 0) {
    return {
      ok: false,
      reason:
        "Produto vinculado a registros operacionais (OS, anúncios ou marketplace). Use o botão de status para Inativar em vez de excluir.",
      vinculos: { osItens, listings, links },
      produto: { id: produto.id, nome: produto.name },
    };
  }

  await prisma.produto.delete({ where: { id: produtoId } });
  revalidatePath("/dashboard/cadastros-v2");
  return { ok: true, deleted: true, produto: { id: produto.id, nome: produto.name } };
}

export async function listServicos(storeId: string): Promise<ServicoDTO[]> {
  const sid = await requireCadastrosStoreAccess(storeId);
  const rows = await prisma.servico.findMany({
    where: { storeId: sid },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  return rows.map((s) => ({
    id: s.id,
    nome: s.name,
    categoria: s.category || "—",
    tempo: s.avgTime || "—",
    custo: Number(s.cost ?? 0),
    preco: Number(s.price ?? 0),
    margem: Number(s.margin ?? 0),
    garantia: s.warrantyDays ?? 0,
    termo: s.terms || "",
    active: s.active,
    status: !s.active ? "Inativo" : (!s.name || !s.category || s.price <= 0 ? "Incompleto" : "Ativo"),
  }));
}

export async function upsertServico(
  storeId: string,
  input: {
    id?: string;
    nome: string;
    categoria?: string;
    tempo?: string;
    custo?: number;
    preco?: number;
    garantia?: number;
    termo?: string;
    active?: boolean;
  }
): Promise<{ id: string }> {
  const sid = await requireCadastrosStoreAccess(storeId);
  const nome = input.nome.trim();
  if (!nome) throw new Error("Nome obrigatório");

  const preco = Number(input.preco ?? 0);
  const custo = Number(input.custo ?? 0);
  const categoria = (input.categoria ?? "").trim();
  const active = input.active ?? true;
  if (active && categoria) {
    const categoriaValida = await prisma.categoriaCadastro.findFirst({
      where: { storeId: sid, type: "servico", active: true, name: { equals: categoria, mode: "insensitive" } },
      select: { name: true },
    });
    if (!categoriaValida) throw new Error("Selecione uma categoria de serviço ativa");
  }
  const margin = preco > 0 ? ((preco - custo) / preco) * 100 : 0;

  const common = {
    name: nome,
    category: categoria,
    avgTime: (input.tempo ?? "").trim(),
    cost: custo,
    price: preco,
    margin: Number.isFinite(margin) ? Number(margin.toFixed(1)) : 0,
    warrantyDays: Math.max(0, Math.trunc(input.garantia ?? 0)),
    terms: (input.termo ?? "").trim(),
    active,
    status: !active ? "Inativo" : nome && categoria && preco > 0 ? "Ativo" : "Incompleto",
  } as const;

  if (input.id) {
    const existing = await prisma.servico.findFirst({ where: { id: input.id, storeId: sid }, select: { id: true } });
    if (!existing) throw new Error("Serviço não encontrado");
    const updated = await prisma.servico.update({
      where: { id: input.id },
      data: common,
      select: { id: true },
    });
    revalidatePath("/dashboard/cadastros-v2");
    return updated;
  }

  const created = await prisma.servico.create({
    data: { ...common, storeId: sid },
    select: { id: true },
  });
  revalidatePath("/dashboard/cadastros-v2");
  return created;
}

// ── Auditoria ─────────────────────────────────────────────────────────────────

export type AuditoriaItemDTO = {
  id: string
  acao: string
  entidade: string
  usuario: string
  data: string
  antes: string
  depois: string
  ip: string
}

// ── Histórico de importações ─────────────────────────────────────────────────
// Lê LogsAuditoria filtrando pelos eventos gerados pelo Importador Avançado
// (action começa com "import."). Não usa mock — se nada foi registrado, a aba
// "Histórico" mostra um empty state honesto.

export type ImportacaoAuditoriaDTO = {
  id: string;
  action: string;
  /** Tipo amigável: "Planilhas", "XML NF-e", "Outro". */
  tipo: string;
  /** "ok" | "erro" | "info" */
  status: "ok" | "erro" | "info";
  usuario: string;
  /** ISO timestamp para ordenação/exibição. */
  dataIso: string;
  /** Resumo curto pronto para exibir. */
  resumo: string;
  batchId: string | null;
  totais: {
    criados: number;
    atualizados: number;
    ignorados: number;
    erros: number;
  } | null;
  duracaoMs: number | null;
  porDominio: Record<string, { criados: number; atualizados: number; erros: number }> | null;
};

function parseImportacaoMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function listImportacoesAuditoria(limit = 50): Promise<ImportacaoAuditoriaDTO[]> {
  try {
    const rows = await prisma.logsAuditoria.findMany({
      where: { action: { startsWith: "import." } },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(1, limit), 200),
    });

    return rows.map((r) => {
      const meta = parseImportacaoMetadata(r.metadata);
      const isXml = r.action.includes("xml");
      const isErro = r.action.endsWith(".erro") || r.action.endsWith("_erro");
      const tipo = isXml ? "XML NF-e" : r.action.startsWith("import.planilha") || r.action === "import.advanced" ? "Planilhas" : "Outro";
      const totais =
        meta.totais && typeof meta.totais === "object" && !Array.isArray(meta.totais)
          ? {
              criados: Number((meta.totais as Record<string, unknown>).criados ?? 0),
              atualizados: Number((meta.totais as Record<string, unknown>).atualizados ?? 0),
              ignorados: Number((meta.totais as Record<string, unknown>).ignorados ?? 0),
              erros: Number((meta.totais as Record<string, unknown>).erros ?? 0),
            }
          : null;
      const porDominioRaw = meta.porDominio;
      const porDominio =
        porDominioRaw && typeof porDominioRaw === "object" && !Array.isArray(porDominioRaw)
          ? (porDominioRaw as Record<string, { criados: number; atualizados: number; erros: number }>)
          : null;
      return {
        id: r.id,
        action: r.action,
        tipo,
        status: isErro ? "erro" : totais && totais.erros > 0 ? "erro" : "ok",
        usuario: r.userLabel || "—",
        dataIso: r.createdAt.toISOString(),
        resumo: (r.detail ?? "").slice(0, 240),
        batchId: typeof meta.batchId === "string" ? (meta.batchId as string) : null,
        totais,
        duracaoMs: typeof meta.duracaoMs === "number" ? (meta.duracaoMs as number) : null,
        porDominio,
      };
    });
  } catch (err) {
    console.error("[listImportacoesAuditoria]", err instanceof Error ? err.message : String(err));
    return [];
  }
}

export async function listLogsAuditoriaCadastros(): Promise<AuditoriaItemDTO[]> {
  const rows = await prisma.logsAuditoria.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  })
  return rows.map((r) => {
    let meta: Record<string, unknown> = {}
    try { if (r.metadata) meta = JSON.parse(r.metadata) } catch { /* ignore */ }
    return {
      id: r.id,
      acao: r.action,
      entidade: (meta.entidade as string) || r.detail.slice(0, 60),
      usuario: r.userLabel,
      data: r.createdAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
      antes: (meta.antes as string) || "",
      depois: (meta.depois as string) || r.detail.slice(0, 120),
      ip: r.source,
    }
  })
}

// ── Lojas ─────────────────────────────────────────────────────────────────────

export type LojaDTO = {
  id: string
  nome: string
  cnpj: string
  cidade: string
  ativa: boolean
}

export async function listLojasCadastros(): Promise<LojaDTO[]> {
  const rows = await prisma.store.findMany({ orderBy: { id: "asc" }, take: 50 })
  return rows.map((s) => {
    const addr =
      s.address && typeof s.address === "object" && !Array.isArray(s.address)
        ? (s.address as Record<string, unknown>)
        : null
    return {
      id: s.id,
      nome: s.name || s.id,
      cnpj: s.cnpj,
      cidade: (addr?.cidade as string) ?? (addr?.city as string) ?? "",
      ativa: true,
    }
  })
}

// ── Lookup externo por código de barras (GOAL 004A) ───────────────────────────
// Camada server-side: contrato + orquestrador + adapter Cosmos.
// Não salva produto, não altera metadata, não altera UI.
// Código interno 20–29 nunca vai a provedor externo (D08).

export type ResolverCodigoBarrasResult =
  | { ok: false; status: "INVALID"; message: string }
  | {
      ok: true;
      status: "INTERNO";
      gtin: string;
      formato: GtinFormato;
      mensagem: string;
      tentativas: TentativaLookup[];
    }
  | {
      ok: true;
      status: "encontrado";
      provedor: ProvedorId;
      dados: ProdutoNormalizado;
      tentativas: TentativaLookup[];
    }
  | { ok: true; status: "nao_encontrado"; tentativas: TentativaLookup[] }
  | {
      ok: true;
      status: "limite_excedido";
      tentativas: TentativaLookup[];
      resetEm?: string;
    }
  | {
      ok: true;
      status: "erro_config";
      mensagem: string;
      tentativas: TentativaLookup[];
    }
  | { ok: true; status: "erro"; tentativas: TentativaLookup[] };

function mapearResultadoCadeia(resultado: ResultadoCadeia): ResolverCodigoBarrasResult {
  switch (resultado.status) {
    case "encontrado":
      return {
        ok: true,
        status: "encontrado",
        provedor: resultado.provedor,
        dados: resultado.dados,
        tentativas: resultado.tentativas,
      };
    case "nao_encontrado":
      return { ok: true, status: "nao_encontrado", tentativas: resultado.tentativas };
    case "limite_excedido":
      return {
        ok: true,
        status: "limite_excedido",
        tentativas: resultado.tentativas,
        resetEm: resultado.resetEm?.toISOString(),
      };
    case "erro_config":
      return {
        ok: true,
        status: "erro_config",
        mensagem: resultado.mensagem,
        tentativas: resultado.tentativas,
      };
    case "erro":
      return { ok: true, status: "erro", tentativas: resultado.tentativas };
  }
}

/**
 * Resolve um código de barras contra a cadeia de provedores externos (GOAL 004A).
 *
 * - Valida GTIN via helper do GOAL 003.
 * - Recusa código inválido.
 * - Recusa prefixo interno 20–29 para lookup externo (resposta honesta sem tentativa).
 * - Chama o orquestrador pluggable; retorna resultado + tentativas.
 * - Não salva produto; não altera metadata; não altera UI.
 * - Chaves de API ficam server-side; nunca vão ao client/bundle/logs.
 */
export async function resolverCodigoBarras(
  _storeId: string,
  rawBarcode: string,
): Promise<ResolverCodigoBarrasResult> {
  const classificacao = classificarBarcode(rawBarcode);
  if (classificacao.tipo === "INVALID") {
    return { ok: false, status: "INVALID", message: classificacao.message };
  }

  if (classificacao.tipo === "INTERNO") {
    return {
      ok: true,
      status: "INTERNO",
      gtin: classificacao.gtin,
      formato: classificacao.formato,
      mensagem: classificacao.mensagem,
      tentativas: [],
    };
  }

  const env = lerEnvBarcode();
  const { resultado } = await resolverCodigoBarrasCore(env, {
    criarProvedor: fabricaProvedorPadrao,
    memo: memoLookupGlobal,
  }, classificacao.gtin);

  return mapearResultadoCadeia(resultado);
}

