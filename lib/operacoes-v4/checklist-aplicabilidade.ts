// ============================================================================
// Operações V4 — aplicabilidade do checklist vs segurança (GOAL 002).
// ----------------------------------------------------------------------------
// Segurança: "o aparelho possui Face ID?"
// Checklist: "Face ID está funcionando?"
// Se a segurança diz que o recurso NÃO existe, o checklist pode mostrar N/A
// sem gravar por cima de um resultado já registrado.
// ============================================================================

export type AplicabilidadeChecklistV4 = "aplicavel" | "nao_aplicavel";

export interface CredenciaisAplicabilidadeV4 {
  faceId: boolean;
  biometria: boolean;
}

const RECURSO_POR_ITEM: Record<string, keyof CredenciaisAplicabilidadeV4> = {
  face_id: "faceId",
  biometria: "biometria",
};

export function aplicabilidadeChecklistEntradaV4(
  itemId: string,
  credenciais: CredenciaisAplicabilidadeV4,
): AplicabilidadeChecklistV4 {
  const recurso = RECURSO_POR_ITEM[itemId];
  if (!recurso) return "aplicavel";
  return credenciais[recurso] ? "aplicavel" : "nao_aplicavel";
}

/** Exibe N/A só quando o recurso não existe E ainda não há teste gravado. */
export function rotuloChecklistExibidoV4(
  itemId: string,
  estado: string,
  credenciais: CredenciaisAplicabilidadeV4,
): { label: string; naoAplicavel: boolean } {
  const na = aplicabilidadeChecklistEntradaV4(itemId, credenciais) === "nao_aplicavel";
  if (na && (estado === "nao_testado" || !estado)) {
    return { label: "N/A", naoAplicavel: true };
  }
  return { label: estado === "ok" ? "OK" : estado === "ruim" ? "Ruim" : "N/T", naoAplicavel: false };
}
