// Testes PUROS do mapeamento Nova OS V4 → NovaOSDraftV3 (OPS-V4-NOVA-OS-REAL-001).
// Ambiente node: o helper e `validarNovaOSDraftV3` são puros (sem Prisma/React).
import { describe, expect, it } from "vitest";
import {
  buildNovaOSDraftFromFormV4,
  equipTipoLabelV4,
  type NovaOSFormV4,
} from "./nova-os-draft-from-form";
import { validarNovaOSDraftV3 } from "@/lib/operacoes-v3/nova-os-model";

const FIXED = new Date("2026-06-30T12:00:00.000Z");

function form(over: Partial<NovaOSFormV4> = {}): NovaOSFormV4 {
  return {
    clienteExistente: null,
    clienteNovo: { nome: "" },
    equipamentoTipo: "celular",
    marca: "",
    modelo: "",
    defeitoRelatado: "",
    origem: "balcao",
    ...over,
  };
}

describe("buildNovaOSDraftFromFormV4 — cliente", () => {
  it("usa o cliente existente selecionado (id) e ignora os campos de novo", () => {
    const draft = buildNovaOSDraftFromFormV4(
      form({
        clienteExistente: { id: "cli-1", nome: "Fulano", telefone: "11999", documento: "123" },
        clienteNovo: { nome: "Outro Nome", telefone: "22888" },
        marca: "Apple",
        modelo: "iPhone 13",
        defeitoRelatado: "Tela quebrada",
      }),
      FIXED,
    );
    expect(draft.cliente.id).toBe("cli-1");
    expect(draft.cliente.nome).toBe("Fulano");
    expect(draft.cliente.telefone).toBe("11999");
    expect(draft.cliente.documento).toBe("123");
    expect(validarNovaOSDraftV3(draft)).toBeNull();
  });

  it("usa o cliente novo (só nome) quando não há existente", () => {
    const draft = buildNovaOSDraftFromFormV4(
      form({
        clienteNovo: { nome: "Maria", email: "maria@x.com", tipo: "PJ" },
        marca: "Samsung",
        modelo: "S21",
        defeitoRelatado: "Não liga",
      }),
      FIXED,
    );
    expect(draft.cliente.id).toBeUndefined();
    expect(draft.cliente.nome).toBe("Maria");
    expect(draft.cliente.email).toBe("maria@x.com");
    expect(draft.cliente.tipo).toBe("PJ");
    expect(validarNovaOSDraftV3(draft)).toBeNull();
  });

  it("clienteExistente com id em branco cai para o cliente novo", () => {
    const draft = buildNovaOSDraftFromFormV4(
      form({
        clienteExistente: { id: "   ", nome: "Ignorar" },
        clienteNovo: { nome: "Novo Real" },
        marca: "LG",
        modelo: "K40",
        defeitoRelatado: "Bateria",
      }),
      FIXED,
    );
    expect(draft.cliente.id).toBeUndefined();
    expect(draft.cliente.nome).toBe("Novo Real");
  });

  it("serviço autorizado materializa valor comercial > 0", () => {
    const draft = buildNovaOSDraftFromFormV4(
      form({
        clienteNovo: { nome: "Rafael" },
        marca: "Samsung",
        modelo: "S22",
        defeitoRelatado: "Tela quebrada",
        tipoEntrada: "servico_autorizado",
        servicoAutorizado: { descricao: "Tela Premium", valor: 400, custo: 210, garantiaDias: 90 },
      }),
      FIXED,
    );
    expect(draft.itens).toHaveLength(1);
    expect(draft.itens[0]?.valorUnitario).toBe(400);
    expect(draft.itens[0]?.custoUnitario).toBe(210);
    expect(draft.garantia.prazoDias).toBe(90);
    expect(validarNovaOSDraftV3(draft)).toBeNull();
  });

  it("precisa de diagnóstico não exige preço", () => {
    const draft = buildNovaOSDraftFromFormV4(
      form({
        clienteNovo: { nome: "Ana" },
        marca: "Apple",
        modelo: "13",
        defeitoRelatado: "Não liga",
        tipoEntrada: "precisa_diagnostico",
      }),
      FIXED,
    );
    expect(draft.itens).toEqual([]);
    expect(validarNovaOSDraftV3(draft)).toBeNull();
  });

  it("cliente novo default tipo = PF", () => {
    const draft = buildNovaOSDraftFromFormV4(form({ clienteNovo: { nome: "Z" } }), FIXED);
    expect(draft.cliente.tipo).toBe("PF");
  });
});

describe("buildNovaOSDraftFromFormV4 — equipamento e origem", () => {
  it("mapeia as chaves de equipamento para os rótulos canônicos da V3", () => {
    expect(equipTipoLabelV4("celular")).toBe("Smartphone");
    expect(equipTipoLabelV4("tablet")).toBe("Tablet");
    expect(equipTipoLabelV4("notebook")).toBe("Notebook");
    expect(equipTipoLabelV4("videogame")).toBe("Console");
    expect(equipTipoLabelV4("outro")).toBe("Outro");
  });

  it("aplica o tipo mapeado e os campos do equipamento no draft", () => {
    const draft = buildNovaOSDraftFromFormV4(
      form({
        equipamentoTipo: "videogame",
        marca: "Sony",
        modelo: "PS5",
        imei: "SN-001",
        clienteNovo: { nome: "Cli" },
        defeitoRelatado: "HDMI",
      }),
      FIXED,
    );
    expect(draft.equipamento.tipo).toBe("Console");
    expect(draft.equipamento.marca).toBe("Sony");
    expect(draft.equipamento.modelo).toBe("PS5");
    expect(draft.equipamento.imei).toBe("SN-001");
  });

  it("origem é mapeada 1:1", () => {
    for (const o of ["balcao", "whatsapp", "retorno", "garantia"] as const) {
      const draft = buildNovaOSDraftFromFormV4(form({ origem: o }), FIXED);
      expect(draft.recepcao.origem).toBe(o);
    }
  });
});

describe("buildNovaOSDraftFromFormV4 — defaults e limpeza", () => {
  it("preserva os defaults de novaOSDraftVazioV3", () => {
    const draft = buildNovaOSDraftFromFormV4(form({ clienteNovo: { nome: "C" } }), FIXED);
    expect(draft.recepcao.dataEntrada).toBe(FIXED.toISOString());
    expect(draft.recepcao.prioridade).toBe("media");
    expect(draft.recepcao.localFisico).toBe("balcao");
    expect(draft.itens).toEqual([]);
    expect(draft.desconto).toBe(0);
    expect(draft.pagamento.forma).toBe("a_combinar");
    expect(draft.garantia.modelo).toBe("sem_garantia");
  });

  it("campos opcionais em branco viram undefined (não inventa valor)", () => {
    const draft = buildNovaOSDraftFromFormV4(
      form({
        clienteNovo: { nome: "C", telefone: "  ", documento: "" },
        imei: "   ",
        observacoes: "",
        recebidoPor: "   ",
      }),
      FIXED,
    );
    expect(draft.cliente.telefone).toBeUndefined();
    expect(draft.cliente.documento).toBeUndefined();
    expect(draft.equipamento.imei).toBeUndefined();
    expect(draft.problema.observacoesInternas).toBeUndefined();
    expect(draft.recepcao.recebidoPor).toBeUndefined();
  });

  it("aplica trim em defeito/observações/recebido por", () => {
    const draft = buildNovaOSDraftFromFormV4(
      form({
        clienteNovo: { nome: "C" },
        marca: "  Apple  ",
        modelo: "  X  ",
        defeitoRelatado: "  Tela  ",
        observacoes: "  obs  ",
        recebidoPor: "  Ana  ",
      }),
      FIXED,
    );
    expect(draft.equipamento.marca).toBe("Apple");
    expect(draft.equipamento.modelo).toBe("X");
    expect(draft.problema.defeitoRelatado).toBe("Tela");
    expect(draft.problema.observacoesInternas).toBe("obs");
    expect(draft.recepcao.recebidoPor).toBe("Ana");
  });
});

describe("buildNovaOSDraftFromFormV4 — validação mínima (integra com validarNovaOSDraftV3)", () => {
  it("sem cliente nem nome → erro de cliente", () => {
    const draft = buildNovaOSDraftFromFormV4(
      form({ marca: "A", modelo: "B", defeitoRelatado: "D" }),
      FIXED,
    );
    expect(validarNovaOSDraftV3(draft)).toMatch(/cliente/i);
  });

  it("sem marca/modelo → erro de equipamento", () => {
    const draft = buildNovaOSDraftFromFormV4(
      form({ clienteNovo: { nome: "C" }, defeitoRelatado: "D" }),
      FIXED,
    );
    expect(validarNovaOSDraftV3(draft)).toMatch(/marca e modelo/i);
  });

  it("sem defeito → erro de defeito", () => {
    const draft = buildNovaOSDraftFromFormV4(
      form({ clienteNovo: { nome: "C" }, marca: "A", modelo: "B" }),
      FIXED,
    );
    expect(validarNovaOSDraftV3(draft)).toMatch(/defeito/i);
  });
});
