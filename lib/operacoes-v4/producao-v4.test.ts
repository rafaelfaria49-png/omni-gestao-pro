import { describe, expect, it } from "vitest";
import type { OrdemServico } from "@/types/os";
import {
  acoesRapidasBancadaV4,
  buildProducaoBancadaV4,
  filtrarBancadaV4,
  isOsProducaoAtivaV4,
  montarSlaBancadaV4,
  ordenarProducaoBancadaV4,
  podeAvancarStatusBancadaV4,
  podeMutarProducaoV4,
  projetarOsProducaoV4,
} from "./producao-v4";

const NOW = new Date("2026-08-14T12:00:00.000Z");
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

describe("produção ativa", () => {
  it("OS cancelada e entregue ficam de fora; aguardando peça e pronta entram", () => {
    expect(isOsProducaoAtivaV4(os({ operacaoStatusV3: "cancelada" }))).toBe(false);
    expect(isOsProducaoAtivaV4(os({ operacaoStatusV3: "entregue" }))).toBe(false);
    expect(isOsProducaoAtivaV4(os({ operacaoStatusV3: "aguardando_peca" }))).toBe(true);
    expect(isOsProducaoAtivaV4(os({ operacaoStatusV3: "pronta" }))).toBe(true);
    expect(isOsProducaoAtivaV4(os({ operacaoStatusV3: "em_execucao" }))).toBe(true);
  });

  it("orçamento pré-OS ativo não entra na bancada", () => {
    const pre = os({
      operacaoStatusV3: "aberta",
      comercialV4: { tipo: "orcamento_pre_os", statusComercial: "rascunho" },
    });
    expect(isOsProducaoAtivaV4(pre)).toBe(false);
  });
});

describe("sem técnico × bucket de técnico", () => {
  it("OS sem técnico entra em Sem técnico e não inventa nome", () => {
    const proj = buildProducaoBancadaV4(
      [os({ id: "1", codigo: "OS-1", operacaoStatusV3: "aberta" })],
      NOW,
    );
    expect(proj.temProducao).toBe(true);
    expect(proj.semTecnico).toHaveLength(1);
    expect(proj.semTecnico[0]!.osId).toBe("1");
    expect(proj.semTecnico[0]!.semTecnico).toBe(true);
    expect(proj.semTecnico[0]!.tecnicoNome).toBeNull();
    expect(proj.tecnicos).toEqual([]);
    expect(proj.resumo.semTecnico).toBe(1);
  });

  it("OS com técnico entra no bucket correto", () => {
    const proj = buildProducaoBancadaV4(
      [os({ id: "1", operacaoStatusV3: "em_execucao", tecnico: { id: "t1", nome: "Rafael" } })],
      NOW,
    );
    expect(proj.semTecnico).toEqual([]);
    expect(proj.tecnicos).toHaveLength(1);
    expect(proj.tecnicos[0]!.tecnicoNome).toBe("Rafael");
    expect(proj.tecnicos[0]!.ordens.map((r) => r.osId)).toEqual(["1"]);
  });

  it("duas OS do mesmo técnico agrupam no mesmo bucket", () => {
    const proj = buildProducaoBancadaV4(
      [
        os({ id: "1", operacaoStatusV3: "em_execucao", tecnico: { id: "t1", nome: "Rafael" } }),
        os({ id: "2", operacaoStatusV3: "pronta", tecnico: { id: "t1", nome: "Rafael" } }),
      ],
      NOW,
    );
    expect(proj.tecnicos).toHaveLength(1);
    expect(proj.tecnicos[0]!.ordens.map((r) => r.osId).sort()).toEqual(["1", "2"]);
    expect(proj.tecnicos[0]!.carga.atribuidas).toBe(2);
    expect(proj.tecnicos[0]!.carga.emExecucao).toBe(1);
    expect(proj.tecnicos[0]!.carga.prontas).toBe(1);
  });

  it("reatribuição muda o bucket (projeção derivada do estado persistido)", () => {
    const base = os({ id: "1", codigo: "OS-1", operacaoStatusV3: "em_execucao" });
    const antes = buildProducaoBancadaV4([base], NOW);
    expect(antes.semTecnico.map((r) => r.osId)).toEqual(["1"]);

    const depois = buildProducaoBancadaV4(
      [{ ...base, tecnico: { id: "t1", nome: "Rafael" } } as OrdemServico],
      NOW,
    );
    expect(depois.semTecnico).toEqual([]);
    expect(depois.tecnicos[0]!.tecnicoNome).toBe("Rafael");
    expect(depois.tecnicos[0]!.ordens[0]!.osId).toBe("1");
  });

  it("lista vazia → sem produção, sem técnico inventado", () => {
    const proj = buildProducaoBancadaV4([], NOW);
    expect(proj.temProducao).toBe(false);
    expect(proj.semTecnico).toEqual([]);
    expect(proj.tecnicos).toEqual([]);
    expect(proj.tecnicosConhecidos).toEqual([]);
    expect(proj.resumo.ativas).toBe(0);
  });
});

describe("prioridade e SLA", () => {
  it("interpreta prioridade V3 e o fallback V2", () => {
    expect(projetarOsProducaoV4(os({ prioridadeV3: "urgente" }), NOW).prioridade).toBe("urgente");
    expect(projetarOsProducaoV4(os({ prioridade: "critica" }), NOW).prioridade).toBe("urgente");
    expect(projetarOsProducaoV4(os({}), NOW).prioridade).toBe("normal");
  });

  it("sem SLA não gera relógio fake", () => {
    const sla = montarSlaBancadaV4(os({ operacaoStatusV3: "em_execucao" }), NOW);
    expect(sla.situacao).toBe("sem_prazo");
    expect(sla.relogio).toBe("");
    expect(sla.texto).toBe("Sem SLA");
  });

  it("SLA atrasada ordena antes de em risco, urgente e o resto", () => {
    const lista = [
      os({
        id: "normal",
        operacaoStatusV3: "aberta",
        prioridadeV3: "normal",
        sla: { prazo: emHoras(48), status: "ok" },
        criadoEm: emHoras(-10),
      }),
      os({
        id: "urgente",
        operacaoStatusV3: "aberta",
        prioridadeV3: "urgente",
        sla: { prazo: emHoras(48), status: "ok" },
        criadoEm: emHoras(-10),
      }),
      os({
        id: "risco",
        operacaoStatusV3: "aberta",
        prioridadeV3: "baixa",
        sla: { prazo: emHoras(2), status: "atencao" },
        criadoEm: emHoras(-10),
      }),
      os({
        id: "atrasada",
        operacaoStatusV3: "aberta",
        prioridadeV3: "baixa",
        sla: { prazo: emHoras(-3), status: "ok" },
        criadoEm: emHoras(-10),
      }),
    ];
    expect(ordenarProducaoBancadaV4(lista, NOW).map((o) => o.id)).toEqual([
      "atrasada",
      "risco",
      "urgente",
      "normal",
    ]);
  });

  it("urgente precede normal em condições equivalentes (mesmo SLA, mesma idade)", () => {
    const lista = [
      os({
        id: "n",
        operacaoStatusV3: "em_execucao",
        prioridadeV3: "normal",
        sla: { prazo: emHoras(48), status: "ok" },
        criadoEm: "2026-08-01T10:00:00.000Z",
      }),
      os({
        id: "u",
        operacaoStatusV3: "em_execucao",
        prioridadeV3: "urgente",
        sla: { prazo: emHoras(48), status: "ok" },
        criadoEm: "2026-08-01T10:00:00.000Z",
      }),
    ];
    expect(ordenarProducaoBancadaV4(lista, NOW)[0]!.id).toBe("u");
  });

  it("mais antiga precede a mais nova no mesmo SLA/prioridade", () => {
    const lista = [
      os({
        id: "nova",
        operacaoStatusV3: "aberta",
        prioridadeV3: "alta",
        sla: { prazo: emHoras(48), status: "ok" },
        criadoEm: "2026-08-10T10:00:00.000Z",
      }),
      os({
        id: "antiga",
        operacaoStatusV3: "aberta",
        prioridadeV3: "alta",
        sla: { prazo: emHoras(48), status: "ok" },
        criadoEm: "2026-08-01T10:00:00.000Z",
      }),
    ];
    expect(ordenarProducaoBancadaV4(lista, NOW).map((o) => o.id)).toEqual(["antiga", "nova"]);
  });
});

describe("ações rápidas — autoridade da máquina V3", () => {
  it("aprovada oferece Iniciar serviço (em_execucao) e Aguardar peça", () => {
    const acoes = acoesRapidasBancadaV4(os({ operacaoStatusV3: "aprovado" }));
    expect(acoes.map((a) => a.to)).toEqual(["em_execucao", "aguardando_peca"]);
    expect(acoes[0]!.label).toBe("Iniciar serviço");
    expect(acoes[0]!.primaria).toBe(true);
  });

  it("aguardando peça oferece Peça chegou", () => {
    const acoes = acoesRapidasBancadaV4(os({ operacaoStatusV3: "aguardando_peca" }));
    expect(acoes).toEqual([{ to: "em_execucao", label: "Peça chegou", primaria: true }]);
  });

  it("em execução oferece Marcar pronta", () => {
    const acoes = acoesRapidasBancadaV4(os({ operacaoStatusV3: "em_execucao" }));
    expect(acoes).toEqual([{ to: "pronta", label: "Marcar pronta", primaria: true }]);
  });

  it("pronta não oferece transição de volta nem entrega", () => {
    expect(acoesRapidasBancadaV4(os({ operacaoStatusV3: "pronta" }))).toEqual([]);
    expect(acoesRapidasBancadaV4(os({ operacaoStatusV3: "entregue" }))).toEqual([]);
    expect(acoesRapidasBancadaV4(os({ operacaoStatusV3: "cancelada" }))).toEqual([]);
  });

  it("transição inválida é rejeitada pelo gate da Bancada", () => {
    const row = os({ operacaoStatusV3: "aberta" });
    expect(podeAvancarStatusBancadaV4(row, "pronta").ok).toBe(false);
    expect(podeAvancarStatusBancadaV4(row, "em_execucao").ok).toBe(false);
    expect(podeAvancarStatusBancadaV4(row, "diagnostico").ok).toBe(true);
    expect(podeAvancarStatusBancadaV4(row, "entregue").ok).toBe(false);
    expect(podeAvancarStatusBancadaV4(null, "diagnostico").ok).toBe(false);
  });

  it("diagnóstico e aguardando aprovação não oferecem mutation comercial", () => {
    expect(acoesRapidasBancadaV4(os({ operacaoStatusV3: "diagnostico" }))).toEqual([]);
    expect(acoesRapidasBancadaV4(os({ operacaoStatusV3: "aguardando_aprovacao" }))).toEqual([]);
    expect(podeAvancarStatusBancadaV4(os({ operacaoStatusV3: "diagnostico" }), "aguardando_aprovacao").ok).toBe(false);
    expect(podeAvancarStatusBancadaV4(os({ operacaoStatusV3: "aguardando_aprovacao" }), "aprovado").ok).toBe(false);
  });

  it("CTA comercial substitui o botão de status nesses dois estados", () => {
    const diag = projetarOsProducaoV4(os({ operacaoStatusV3: "diagnostico" }), NOW);
    const ag = projetarOsProducaoV4(os({ operacaoStatusV3: "aguardando_aprovacao" }), NOW);
    expect(diag.ctaComercial?.label).toBe("Abrir OS para criar/enviar orçamento");
    expect(ag.ctaComercial?.label).toBe("Registrar aprovação na OS");
    expect(diag.acoesRapidas).toEqual([]);
    expect(ag.acoesRapidas).toEqual([]);
  });
});

describe("filtros e contexto de mutation", () => {
  const proj = buildProducaoBancadaV4(
    [
      os({ id: "s", codigo: "OS-100", cliente: { nome: "Ana" }, operacaoStatusV3: "aberta" }),
      os({
        id: "e",
        codigo: "OS-200",
        cliente: { nome: "Bruno" },
        operacaoStatusV3: "em_execucao",
        tecnico: { id: "t1", nome: "Rafael" },
        equipamento: { marca: "Samsung", modelo: "S22" },
      }),
      os({
        id: "p",
        codigo: "OS-300",
        operacaoStatusV3: "pronta",
        tecnico: { id: "t2", nome: "Carlos" },
      }),
    ],
    NOW,
  );

  it("filtro Sem técnico e por técnico", () => {
    expect(filtrarBancadaV4(proj, "sem_tecnico", null, "").semTecnico.map((r) => r.osId)).toEqual(["s"]);
    expect(filtrarBancadaV4(proj, "sem_tecnico", null, "").tecnicos).toEqual([]);
    expect(filtrarBancadaV4(proj, "todos", "t1", "").tecnicos.map((t) => t.tecnicoId)).toEqual(["t1"]);
    expect(filtrarBancadaV4(proj, "todos", "t1", "").semTecnico).toEqual([]);
  });

  it("filtro por status e busca (OS / cliente / aparelho)", () => {
    expect(filtrarBancadaV4(proj, "em_execucao", null, "").tecnicos.flatMap((t) => t.ordens).map((r) => r.osId)).toEqual([
      "e",
    ]);
    expect(filtrarBancadaV4(proj, "pronta", null, "").tecnicos.flatMap((t) => t.ordens).map((r) => r.osId)).toEqual([
      "p",
    ]);
    expect(filtrarBancadaV4(proj, "todos", null, "s22").tecnicos.flatMap((t) => t.ordens).map((r) => r.osId)).toEqual([
      "e",
    ]);
    expect(filtrarBancadaV4(proj, "todos", null, "OS-100").semTecnico.map((r) => r.osId)).toEqual(["s"]);
    expect(filtrarBancadaV4(proj, "todos", null, "xyz").semTecnico).toEqual([]);
    expect(filtrarBancadaV4(proj, "todos", null, "xyz").tecnicos).toEqual([]);
  });

  it("contexto inválido é rejeitado antes da action", () => {
    expect(podeMutarProducaoV4("", "os-1").ok).toBe(false);
    expect(podeMutarProducaoV4("loja-1", "").ok).toBe(false);
    expect(podeMutarProducaoV4("loja-1", "os-1")).toEqual({ ok: true });
  });
});

describe("defeito, aparelho e carga — sem invenção", () => {
  it("projeta defeito/aparelho reais e deixa vazio quando ausentes", () => {
    const cheio = projetarOsProducaoV4(
      os({
        codigo: "OS-1042",
        cliente: { nome: "Rafael Faria" },
        defeito: "Tela quebrada",
        operacaoStatusV3: "aberta",
      }),
      NOW,
    );
    expect(cheio.aparelho).toBe("");
    expect(cheio.defeito).toBe("Tela quebrada");

    const comAparelho = projetarOsProducaoV4(
      os({
        equipamento: { marca: "Samsung", modelo: "A15" },
        operacaoStatusV3: "aberta",
      }),
      NOW,
    );
    expect(comAparelho.aparelho).toBe("Samsung A15");
  });
});
