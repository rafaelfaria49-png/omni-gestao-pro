import { describe, expect, it } from "vitest";
import { aplicabilidadeChecklistEntradaV4, rotuloChecklistExibidoV4 } from "./checklist-aplicabilidade";

describe("aplicabilidade do checklist vs segurança", () => {
  it("Face ID inexistente vira N/A sem exigir ação", () => {
    expect(aplicabilidadeChecklistEntradaV4("face_id", { faceId: false, biometria: true })).toBe("nao_aplicavel");
    expect(rotuloChecklistExibidoV4("face_id", "nao_testado", { faceId: false, biometria: true })).toEqual({
      label: "N/A",
      naoAplicavel: true,
    });
  });

  it("não apaga um teste já gravado", () => {
    expect(rotuloChecklistExibidoV4("face_id", "ok", { faceId: false, biometria: false })).toEqual({
      label: "OK",
      naoAplicavel: false,
    });
  });

  it("itens sem vínculo com segurança continuam aplicáveis", () => {
    expect(aplicabilidadeChecklistEntradaV4("liga", { faceId: false, biometria: false })).toBe("aplicavel");
  });
});
