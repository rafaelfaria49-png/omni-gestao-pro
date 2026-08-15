import { describe, expect, it } from "vitest";
import type { OrdemServico } from "@/types/os";
import { STATUS_V3_LIST, podeTransicionarV3, proximasTransicoesV3 } from "@/lib/operacoes-v3/status-machine";
import { acoesRapidasBancadaV4, projetarOsProducaoV4 } from "./producao-v4";
import { destinosRapidosProducaoV4 } from "./transicoes-producao-v4";
import {
  COLUNAS_FILA_V4,
  DESTINOS_WRITE_FILA_V4,
  FILTROS_FILA_VAZIOS,
  SEM_TECNICO_FILA_V4,
  buildFilaOperacionalV4,
  classificarColunaFilaV4,
  destinosPermitidosFilaV4,
  destinosWriteFilaV4,
  filtrarFilaV4,
  filtrosFilaAtivosV4,
  hintCockpitFilaV4,
  isOsFilaAtivaV4,
  isTransicaoComercialForaDragV4,
  lerModoFilaV4,
  podeMoverStatusFilaV4,
  projetarOsFilaV4,
  vereditoDestinoFilaV4,
} from "./fila-v4";

const NOW = new Date("2026-08-15T12:00:00.000Z");
const H = 3600000;
const emHoras = (h: number) => new Date(NOW.getTime() + h * H).toISOString();

function os(over: Record<string, unknown>): OrdemServico {
  return {
    id: "o",
    codigo: "OS",
    cliente: { nome: "C" },
    timeline: [],
    ...over,
  } as unknown as OrdemServico;
}

describe("colunas e recorte de produção", () => {
  it("Kanban tem as 7 estações da máquina, sem recebida/entregue/cancelada", () => {
    expect([...COLUNAS_FILA_V4]).toEqual([
      "aberta",
      "diagnostico",
      "aguardando_aprovacao",
      "aprovado",
      "aguardando_peca",
      "em_execucao",
      "pronta",
    ]);
    expect(COLUNAS_FILA_V4).not.toContain("recebida");
    expect(COLUNAS_FILA_V4).not.toContain("entregue");
    expect(COLUNAS_FILA_V4).not.toContain("cancelada");
  });

  it("write de produção não inclui aprovação comercial nem entrega", () => {
    expect([...DESTINOS_WRITE_FILA_V4]).toEqual(["diagnostico", "aguardando_peca", "em_execucao", "pronta"]);
  });
});

describe("projeção por coluna", () => {
  const proj = buildFilaOperacionalV4(
    [
      os({ id: "ab", codigo: "OS-AB", operacaoStatusV3: "aberta" }),
      os({ id: "dg", codigo: "OS-DG", operacaoStatusV3: "diagnostico" }),
      os({ id: "aa", codigo: "OS-AA", operacaoStatusV3: "aguardando_aprovacao" }),
      os({ id: "ap", codigo: "OS-AP", operacaoStatusV3: "aprovado" }),
      os({ id: "pc", codigo: "OS-PC", operacaoStatusV3: "aguardando_peca" }),
      os({ id: "ex", codigo: "OS-EX", operacaoStatusV3: "em_execucao" }),
      os({ id: "pr", codigo: "OS-PR", operacaoStatusV3: "pronta" }),
      os({ id: "en", codigo: "OS-EN", operacaoStatusV3: "entregue" }),
      os({ id: "ca", codigo: "OS-CA", operacaoStatusV3: "cancelada" }),
      os({ id: "rc", codigo: "OS-RC", operacaoStatusV3: "recebida" }),
    ],
    NOW,
  );

  it.each([
    ["aberta", "ab"],
    ["diagnostico", "dg"],
    ["aguardando_aprovacao", "aa"],
    ["aprovado", "ap"],
    ["aguardando_peca", "pc"],
    ["em_execucao", "ex"],
    ["pronta", "pr"],
  ] as const)("%s recebe só a OS correspondente", (status, id) => {
    expect(proj.colunas.find((c) => c.status === status)!.itens.map((r) => r.osId)).toEqual([id]);
  });

  it("entregue, cancelada e recebida ficam fora da fila ativa", () => {
    expect(isOsFilaAtivaV4(os({ operacaoStatusV3: "entregue" }))).toBe(false);
    expect(isOsFilaAtivaV4(os({ operacaoStatusV3: "cancelada" }))).toBe(false);
    expect(isOsFilaAtivaV4(os({ operacaoStatusV3: "recebida" }))).toBe(false);
    expect(proj.lista.map((r) => r.osId)).not.toContain("en");
    expect(proj.lista.map((r) => r.osId)).not.toContain("ca");
    expect(proj.lista.map((r) => r.osId)).not.toContain("rc");
    expect(proj.resumo.ativas).toBe(7);
  });

  it("pré-OS comercial não entra", () => {
    expect(
      isOsFilaAtivaV4(
        os({
          operacaoStatusV3: "aberta",
          comercialV4: { tipo: "orcamento_pre_os", statusComercial: "rascunho" },
        }),
      ),
    ).toBe(false);
  });
});

describe("técnico, prioridade e SLA — mesmos readers da Bancada", () => {
  it("projeta técnico real e preserva Sem técnico", () => {
    const com = projetarOsFilaV4(
      os({ id: "1", operacaoStatusV3: "em_execucao", tecnico: { id: "t1", nome: "Rafael" } }),
      NOW,
    );
    const sem = projetarOsFilaV4(os({ id: "2", operacaoStatusV3: "aberta" }), NOW);
    expect(com.tecnicoNome).toBe("Rafael");
    expect(com.semTecnico).toBe(false);
    expect(sem.semTecnico).toBe(true);
    expect(sem.tecnicoNome).toBeNull();
    expect(com.tecnicoNome).toBe(projetarOsProducaoV4(os({ id: "1", operacaoStatusV3: "em_execucao", tecnico: { id: "t1", nome: "Rafael" } }), NOW).tecnicoNome);
  });

  it("prioridade e SLA compartilham a classificação da Bancada", () => {
    const fila = projetarOsFilaV4(
      os({
        id: "1",
        operacaoStatusV3: "aberta",
        prioridadeV3: "urgente",
        sla: { prazo: emHoras(-2), status: "estourado" },
      }),
      NOW,
    );
    const bancada = projetarOsProducaoV4(
      os({
        id: "1",
        operacaoStatusV3: "aberta",
        prioridadeV3: "urgente",
        sla: { prazo: emHoras(-2), status: "estourado" },
      }),
      NOW,
    );
    expect(fila.prioridade).toBe(bancada.prioridade);
    expect(fila.sla.situacao).toBe(bancada.sla.situacao);
    expect(fila.sla.situacao).toBe("atrasada");
    expect(fila.sla.relogio).toMatch(/^\d{2}:\d{2}$/);
  });

  it("SLA em risco e sem prazo não inventam deadline", () => {
    const risco = projetarOsFilaV4(
      os({ id: "r", operacaoStatusV3: "aberta", sla: { prazo: emHoras(2), status: "atencao" } }),
      NOW,
    );
    const sem = projetarOsFilaV4(os({ id: "s", operacaoStatusV3: "aberta" }), NOW);
    expect(risco.sla.situacao).toBe("em_risco");
    expect(sem.sla.situacao).toBe("sem_prazo");
    expect(sem.sla.relogio).toBe("");
    expect(sem.sla.texto).toBe("Sem SLA");
  });

  it("ordenação é determinística: atrasada → risco → urgente → idade", () => {
    const proj = buildFilaOperacionalV4(
      [
        os({
          id: "normal",
          operacaoStatusV3: "aberta",
          prioridadeV3: "normal",
          sla: { prazo: emHoras(48), status: "ok" },
          criadoEm: emHoras(-1),
        }),
        os({
          id: "urgente",
          operacaoStatusV3: "aberta",
          prioridadeV3: "urgente",
          sla: { prazo: emHoras(48), status: "ok" },
          criadoEm: emHoras(-1),
        }),
        os({
          id: "risco",
          operacaoStatusV3: "aberta",
          prioridadeV3: "baixa",
          sla: { prazo: emHoras(2), status: "atencao" },
          criadoEm: emHoras(-1),
        }),
        os({
          id: "atrasada",
          operacaoStatusV3: "aberta",
          prioridadeV3: "baixa",
          sla: { prazo: emHoras(-3), status: "estourado" },
          criadoEm: emHoras(-1),
        }),
      ],
      NOW,
    );
    expect(proj.colunas.find((c) => c.status === "aberta")!.itens.map((r) => r.osId)).toEqual([
      "atrasada",
      "risco",
      "urgente",
      "normal",
    ]);
  });
});

describe("destinos — máquina V3 ∩ recorte da Fila", () => {
  it("destinosPermitidosFilaV4 é subconjunto de proximasTransicoesV3", () => {
    for (const from of COLUNAS_FILA_V4) {
      const permitidos = destinosPermitidosFilaV4(from);
      const maquina = proximasTransicoesV3(from);
      for (const to of permitidos) {
        expect(maquina).toContain(to);
        expect(podeTransicionarV3(from, to).ok).toBe(true);
      }
    }
  });

  it("grafo de produção seguro: aberta→diagnóstico; aprovado→peça|execução; peça→execução; execução→pronta", () => {
    expect(destinosPermitidosFilaV4("aberta")).toEqual(["diagnostico"]);
    expect(destinosPermitidosFilaV4("aprovado").sort()).toEqual(["aguardando_peca", "em_execucao"]);
    expect(destinosPermitidosFilaV4("aguardando_peca")).toEqual(["em_execucao"]);
    expect(destinosPermitidosFilaV4("em_execucao")).toEqual(["pronta"]);
  });

  it("transição inválida não é drop target", () => {
    expect(classificarColunaFilaV4("aberta", "pronta")).toBe("recusada");
    expect(vereditoDestinoFilaV4("aberta", "em_execucao").ok).toBe(false);
    expect(classificarColunaFilaV4("aberta", "diagnostico")).toBe("aceita");
    expect(classificarColunaFilaV4("aberta", "aberta")).toBe("origem");
    expect(classificarColunaFilaV4(null, "diagnostico")).toBe("neutra");
  });

  it("cancelamento, entrega e recebimento nunca são destino de drag", () => {
    expect(podeTransicionarV3("aberta", "cancelada").ok).toBe(true);
    expect(vereditoDestinoFilaV4("aberta", "cancelada").ok).toBe(false);
    expect(destinosPermitidosFilaV4("aberta")).not.toContain("cancelada");
    expect(podeTransicionarV3("pronta", "recebida").ok).toBe(true);
    expect(vereditoDestinoFilaV4("pronta", "recebida").ok).toBe(false);
    expect(podeTransicionarV3("recebida", "entregue").ok).toBe(true);
    expect(vereditoDestinoFilaV4("recebida", "entregue").ok).toBe(false);
    expect(destinosPermitidosFilaV4("pronta")).toEqual([]);
  });
});

describe("proteção comercial — drag não burla orçamento", () => {
  it("diagnóstico → aguardando aprovação é da máquina, mas fora do drag", () => {
    expect(podeTransicionarV3("diagnostico", "aguardando_aprovacao").ok).toBe(true);
    expect(isTransicaoComercialForaDragV4("diagnostico", "aguardando_aprovacao")).toBe(true);
    expect(vereditoDestinoFilaV4("diagnostico", "aguardando_aprovacao").ok).toBe(false);
    expect(destinosPermitidosFilaV4("diagnostico")).toEqual([]);
    expect(hintCockpitFilaV4("diagnostico")).toMatch(/enviar o orçamento/i);
  });

  it("aguardando aprovação → aprovada exige aprovarOrcamentoV3, não status-only", () => {
    expect(podeTransicionarV3("aguardando_aprovacao", "aprovado").ok).toBe(true);
    expect(isTransicaoComercialForaDragV4("aguardando_aprovacao", "aprovado")).toBe(true);
    expect(vereditoDestinoFilaV4("aguardando_aprovacao", "aprovado").ok).toBe(false);
    expect(destinosPermitidosFilaV4("aguardando_aprovacao")).toEqual([]);
    expect(hintCockpitFilaV4("aguardando_aprovacao")).toMatch(/aprovar o orçamento/i);
  });

  it("OS com orçamento já aprovado segue o fluxo de produção da máquina", () => {
    const alvo = os({ operacaoStatusV3: "aprovado", orcamento: { status: "aprovado" } });
    expect(podeMoverStatusFilaV4(alvo, "em_execucao").ok).toBe(true);
    expect(podeMoverStatusFilaV4(alvo, "aguardando_peca").ok).toBe(true);
    expect(projetarOsFilaV4(alvo, NOW).destinos.map((d) => d.to).sort()).toEqual(["aguardando_peca", "em_execucao"]);
  });
});

describe("filtros e busca", () => {
  const proj = buildFilaOperacionalV4(
    [
      os({
        id: "1",
        codigo: "OS-1042",
        cliente: { nome: "Ana Souza" },
        equipamento: { marca: "Samsung", modelo: "S22", numeroSerie: "356789" },
        defeito: "Tela quebrada",
        operacaoStatusV3: "aberta",
        prioridadeV3: "urgente",
        sla: { prazo: emHoras(-2), status: "estourado" },
      }),
      os({
        id: "2",
        codigo: "OS-2000",
        cliente: { nome: "Bruno" },
        equipamento: { marca: "Apple", modelo: "iPhone 12" },
        operacaoStatusV3: "em_execucao",
        prioridadeV3: "normal",
        tecnico: { id: "t1", nome: "Rafael" },
        sla: { prazo: emHoras(2), status: "atencao" },
      }),
    ],
    NOW,
  );

  it("busca por OS, cliente, aparelho, IMEI e defeito", () => {
    expect(filtrarFilaV4(proj, { ...FILTROS_FILA_VAZIOS, busca: "1042" }).lista.map((r) => r.osId)).toEqual(["1"]);
    expect(filtrarFilaV4(proj, { ...FILTROS_FILA_VAZIOS, busca: "ana" }).lista.map((r) => r.osId)).toEqual(["1"]);
    expect(filtrarFilaV4(proj, { ...FILTROS_FILA_VAZIOS, busca: "iphone" }).lista.map((r) => r.osId)).toEqual(["2"]);
    expect(filtrarFilaV4(proj, { ...FILTROS_FILA_VAZIOS, busca: "356789" }).lista.map((r) => r.osId)).toEqual(["1"]);
    expect(filtrarFilaV4(proj, { ...FILTROS_FILA_VAZIOS, busca: "tela" }).lista.map((r) => r.osId)).toEqual(["1"]);
  });

  it("filtros de técnico, prioridade e SLA combinam; filtro vazio some a OS", () => {
    expect(filtrarFilaV4(proj, { ...FILTROS_FILA_VAZIOS, tecnicoId: SEM_TECNICO_FILA_V4 }).lista.map((r) => r.osId)).toEqual(["1"]);
    expect(filtrarFilaV4(proj, { ...FILTROS_FILA_VAZIOS, tecnicoId: "t1" }).lista.map((r) => r.osId)).toEqual(["2"]);
    expect(filtrarFilaV4(proj, { ...FILTROS_FILA_VAZIOS, prioridade: "urgente" }).lista.map((r) => r.osId)).toEqual(["1"]);
    expect(filtrarFilaV4(proj, { ...FILTROS_FILA_VAZIOS, sla: "atrasada" }).lista.map((r) => r.osId)).toEqual(["1"]);
    expect(filtrarFilaV4(proj, { ...FILTROS_FILA_VAZIOS, sla: "em_risco" }).lista.map((r) => r.osId)).toEqual(["2"]);
    expect(filtrarFilaV4(proj, { ...FILTROS_FILA_VAZIOS, tecnicoId: "t1", prioridade: "urgente" }).lista).toEqual([]);
    expect(filtrosFilaAtivosV4(FILTROS_FILA_VAZIOS)).toBe(false);
  });
});

describe("preferência de view", () => {
  it("lê kanban por padrão e só aceita lista explícita", () => {
    expect(lerModoFilaV4(null)).toBe("kanban");
    expect(lerModoFilaV4("lista")).toBe("lista");
    expect(lerModoFilaV4("kanban")).toBe("kanban");
    expect(lerModoFilaV4("lixo")).toBe("kanban");
  });
});

describe("paridade com a Bancada — mesma policy", () => {
  it("destinos da Fila coincidem com destinos rápidos da Bancada e da policy", () => {
    for (const from of STATUS_V3_LIST) {
      const fila = [...destinosPermitidosFilaV4(from)].sort();
      const bancada = acoesRapidasBancadaV4(os({ operacaoStatusV3: from }))
        .map((a) => a.to)
        .sort();
      expect(fila).toEqual([...destinosRapidosProducaoV4(from)].sort());
      expect(fila).toEqual(bancada);
    }
  });
});

describe("empty honesto", () => {
  it("loja sem OS ativas não inventa coluna populada", () => {
    const proj = buildFilaOperacionalV4([], NOW);
    expect(proj.temFila).toBe(false);
    expect(proj.resumo.ativas).toBe(0);
    expect(proj.colunas.every((c) => c.itens.length === 0)).toBe(true);
    expect(proj.tecnicosConhecidos).toEqual([]);
  });
});
