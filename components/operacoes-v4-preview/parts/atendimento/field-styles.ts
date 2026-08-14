import type { CSSProperties } from "react";
import { C, upLabel } from "../../tokens";

export const atendInput: CSSProperties = {
  width: "100%",
  height: 32,
  padding: "0 11px",
  border: `1px solid ${C.inputBd}`,
  borderRadius: 8,
  fontSize: 12.5,
  color: C.body,
  background: C.surface,
};

export const atendLabel = { ...upLabel, marginBottom: 3 } as const;
