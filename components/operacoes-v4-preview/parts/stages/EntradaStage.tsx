/**
 * Operações V4 — workspace focado da Entrada.
 *
 * Cada seção usa os contratos reais já existentes da V3. O estado do editor
 * permanece no pai ao trocar de seção; nada é salvo automaticamente. Segurança
 * e Estado físico compartilham a prova de entrada real, enquanto Fotos apenas
 * lista evidências existentes e informa, honestamente, "upload em breve".
 * O PatternPadV4 e a condição senhaTipo === "padrao" vivem em EntradaSections.
 */
import type { V4Vals } from "../../use-v4-preview";
import { EntradaWorkspace } from "./EntradaWorkspace";

export function EntradaStage({ v }: { v: V4Vals }) {
  if (!v.osSelected) return null;

  return <EntradaWorkspace key={v.selectedOsId ?? "none"} v={v} />;
}
