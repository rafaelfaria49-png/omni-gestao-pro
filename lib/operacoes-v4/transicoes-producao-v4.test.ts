import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OrdemServico } from "@/types/os";
import {
  STATUS_V3_LIST,
  podeTransicionarV3,
  proximasTransicoesV3,
} from "@/lib/operacoes-v3/status-machine";
import {
  acoesRapidasBancadaV4,
  podeAvancarStatusBancadaV4,
  projetarOsProducaoV4,
} from "./producao-v4";
import {
  destinosPermitidosFilaV4,
  isTransicaoComercialForaDragV4,
  podeMoverStatusFilaV4,
  vereditoDestinoFilaV4,
} from "./fila-v4";
import {
  DESTINOS_RAPIDOS_PRODUCAO_V4,
  TRANSICOES_COMERCIAIS_PROTEGIDAS_V4,
  ctaComercialProducaoV4,
  destinosRapidosProducaoV4,
  isTransicaoComercialProtegidaV4,
  vereditoTransicaoRapidaProducaoV4,
} from "./transicoes-producao-v4";

function os(over: Record<string, unknown>): OrdemServico {
  return {
    id: "o",
    codigo: "OS",
    cliente: { nome: "C" },
    timeline: [],
    ...over,
  } as unknown as OrdemServico;
}

function destinosDe(from: string): string[] {
  return destinosRapidosProducaoV4(from);
}

describe("transições rápidas permitidas", () => {
  it("aberta → diagnóstico continua permitida", () => {
    expect(destinosDe("aberta")).toEqual(["diagnostico"]);
    expect(vereditoTransicaoRapidaProducaoV4("aberta", "diagnostico").ok).toBe(true);
    expect(podeAvancarStatusBancadaV4(os({ operacaoStatusV3: "aberta" }), "diagnostico").ok).toBe(true);
    expect(podeMoverStatusFilaV4(os({ operacaoStatusV3: "aberta" }), "diagnostico").ok).toBe(true);
  });

  it("aprovada → em execução continua permitida", () => {
    expect(destinosDe("aprovado")).toContain("em_execucao");
    expect(vereditoTransicaoRapidaProducaoV4("aprovado", "em_execucao").ok).toBe(true);
  });

  it("aprovada → aguardando peça continua permitida (máquina permite)", () => {
    expect(podeTransicionarV3("aprovado", "aguardando_peca").ok).toBe(true);
    expect(destinosDe("aprovado")).toContain("aguardando_peca");
    expect(vereditoTransicaoRapidaProducaoV4("aprovado", "aguardando_peca").ok).toBe(true);
  });

  it("aguardando peça → em execução continua permitida", () => {
    expect(destinosDe("aguardando_peca")).toEqual(["em_execucao"]);
  });

  it("em execução → pronta continua permitida", () => {
    expect(destinosDe("em_execucao")).toEqual(["pronta"]);
  });
});

describe("transições comerciais e terminais fora da mutation rápida", () => {
  it("diagnóstico → aguardando aprovação NÃO aparece como quick status mutation", () => {
    expect(podeTransicionarV3("diagnostico", "aguardando_aprovacao").ok).toBe(true);
    expect(isTransicaoComercialProtegidaV4("diagnostico", "aguardando_aprovacao")).toBe(true);
    expect(vereditoTransicaoRapidaProducaoV4("diagnostico", "aguardando_aprovacao").ok).toBe(false);
    expect(destinosDe("diagnostico")).toEqual([]);
    expect(acoesRapidasBancadaV4(os({ operacaoStatusV3: "diagnostico" })).map((a) => a.to)).toEqual([]);
    expect(destinosPermitidosFilaV4("diagnostico")).toEqual([]);
  });

  it("aguardando aprovação → aprovada NÃO aparece como quick status mutation", () => {
    expect(podeTransicionarV3("aguardando_aprovacao", "aprovado").ok).toBe(true);
    expect(isTransicaoComercialProtegidaV4("aguardando_aprovacao", "aprovado")).toBe(true);
    expect(vereditoTransicaoRapidaProducaoV4("aguardando_aprovacao", "aprovado").ok).toBe(false);
    expect(destinosDe("aguardando_aprovacao")).toEqual([]);
    expect(acoesRapidasBancadaV4(os({ operacaoStatusV3: "aguardando_aprovacao" })).map((a) => a.to)).toEqual([]);
    expect(destinosPermitidosFilaV4("aguardando_aprovacao")).toEqual([]);
  });

  it("pronta não possui quick transition de chão", () => {
    expect(destinosDe("pronta")).toEqual([]);
    expect(acoesRapidasBancadaV4(os({ operacaoStatusV3: "pronta" }))).toEqual([]);
  });

  it("cancelamento nunca aparece", () => {
    for (const from of STATUS_V3_LIST) {
      expect(destinosDe(from)).not.toContain("cancelada");
      expect(vereditoTransicaoRapidaProducaoV4(from, "cancelada").ok).toBe(false);
    }
  });

  it("entrega nunca aparece", () => {
    for (const from of STATUS_V3_LIST) {
      expect(destinosDe(from)).not.toContain("entregue");
      expect(vereditoTransicaoRapidaProducaoV4(from, "entregue").ok).toBe(false);
    }
  });

  it("recebimento nunca aparece", () => {
    for (const from of STATUS_V3_LIST) {
      expect(destinosDe(from)).not.toContain("recebida");
      expect(vereditoTransicaoRapidaProducaoV4(from, "recebida").ok).toBe(false);
    }
  });
});

describe("destinos filtrados pela máquina V3", () => {
  it("todo destino rápido é subconjunto de proximasTransicoesV3", () => {
    for (const from of STATUS_V3_LIST) {
      const permitidos = destinosRapidosProducaoV4(from);
      const maquina = proximasTransicoesV3(from);
      for (const to of permitidos) {
        expect(maquina).toContain(to);
        expect(podeTransicionarV3(from, to).ok).toBe(true);
        expect(DESTINOS_RAPIDOS_PRODUCAO_V4).toContain(to);
      }
    }
  });

  it("allowlist sozinha não libera salto inválido da máquina", () => {
    expect(DESTINOS_RAPIDOS_PRODUCAO_V4).toContain("pronta");
    expect(podeTransicionarV3("aberta", "pronta").ok).toBe(false);
    expect(vereditoTransicaoRapidaProducaoV4("aberta", "pronta").ok).toBe(false);
    expect(destinosDe("aberta")).not.toContain("pronta");
  });
});

describe("paridade Fila × Bancada", () => {
  it("Bancada e Fila consultam a policy compartilhada", () => {
    expect(TRANSICOES_COMERCIAIS_PROTEGIDAS_V4).toEqual([
      ["diagnostico", "aguardando_aprovacao"],
      ["aguardando_aprovacao", "aprovado"],
    ]);
    expect(isTransicaoComercialForaDragV4("diagnostico", "aguardando_aprovacao")).toBe(true);
    expect(isTransicaoComercialForaDragV4("aguardando_aprovacao", "aprovado")).toBe(true);
  });

  it("para cada status, destinos rápidos da Fila == destinos rápidos da Bancada", () => {
    for (const from of STATUS_V3_LIST) {
      const fila = [...destinosPermitidosFilaV4(from)].sort();
      const bancada = acoesRapidasBancadaV4(os({ operacaoStatusV3: from }))
        .map((a) => a.to)
        .sort();
      const policy = [...destinosRapidosProducaoV4(from)].sort();
      expect(fila, `Fila divergiu em ${from}`).toEqual(policy);
      expect(bancada, `Bancada divergiu em ${from}`).toEqual(policy);
    }
  });

  it("Fila e Bancada não divergem nos pares comerciais sensíveis", () => {
    expect(vereditoDestinoFilaV4("diagnostico", "aguardando_aprovacao").ok).toBe(false);
    expect(podeAvancarStatusBancadaV4(os({ operacaoStatusV3: "diagnostico" }), "aguardando_aprovacao").ok).toBe(false);
    expect(vereditoDestinoFilaV4("aguardando_aprovacao", "aprovado").ok).toBe(false);
    expect(podeAvancarStatusBancadaV4(os({ operacaoStatusV3: "aguardando_aprovacao" }), "aprovado").ok).toBe(false);
  });
});

describe("CTA comercial abre OS — não muta status", () => {
  it("CTA Diagnóstico aponta para o cockpit, sem destino de status", () => {
    const cta = ctaComercialProducaoV4("diagnostico");
    const row = projetarOsProducaoV4(os({ operacaoStatusV3: "diagnostico" }));
    expect(cta).toEqual({
      kind: "enviar_orcamento",
      label: "Abrir OS para criar/enviar orçamento",
    });
    expect(row.ctaComercial).toEqual(cta);
    expect(row.acoesRapidas).toEqual([]);
    expect(row.acoesRapidas.some((a) => a.to === "aguardando_aprovacao")).toBe(false);
  });

  it("CTA Aguardando aprovação aponta para o cockpit, sem marcar aprovada", () => {
    const cta = ctaComercialProducaoV4("aguardando_aprovacao");
    const row = projetarOsProducaoV4(os({ operacaoStatusV3: "aguardando_aprovacao" }));
    expect(cta).toEqual({
      kind: "registrar_aprovacao",
      label: "Registrar aprovação na OS",
    });
    expect(row.ctaComercial).toEqual(cta);
    expect(row.acoesRapidas.some((a) => a.to === "aprovado")).toBe(false);
  });

  it("status sem contrato comercial extra não ganha CTA", () => {
    expect(ctaComercialProducaoV4("aberta")).toBeNull();
    expect(ctaComercialProducaoV4("aprovado")).toBeNull();
    expect(ctaComercialProducaoV4("em_execucao")).toBeNull();
    expect(projetarOsProducaoV4(os({ operacaoStatusV3: "aprovado" })).ctaComercial).toBeNull();
  });
});

describe("nenhum write-path rápido chama aplicarTransicaoStatusV3 nos pares comerciais", () => {
  it("policy, Fila e Bancada não invocam a action comercialmente", () => {
    const root = join(process.cwd(), "lib", "operacoes-v4");
    const policy = readFileSync(join(root, "transicoes-producao-v4.ts"), "utf8");
    const fila = readFileSync(join(root, "fila-v4.ts"), "utf8");
    const producao = readFileSync(join(root, "producao-v4.ts"), "utf8");
    const bancadaUi = readFileSync(
      join(process.cwd(), "components", "operacoes-v4-preview", "parts", "BancadaV4.tsx"),
      "utf8",
    );
    expect(policy).not.toContain("aplicarTransicaoStatusV3(");
    expect(fila).not.toContain("aplicarTransicaoStatusV3(");
    expect(producao).not.toContain("aplicarTransicaoStatusV3(");
    expect(bancadaUi).toMatch(/ctaComercial[\s\S]*openOSFromRail/);
    expect(bancadaUi).not.toMatch(/ctaComercial[\s\S]*avancarStatusBancada/);
  });
});
