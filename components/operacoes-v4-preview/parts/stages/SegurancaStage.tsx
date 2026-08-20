/**
 * Operações V4 — superfície residual de Segurança.
 *
 * Não autentica, não implementa PIN paralelo e não persiste nada.
 * Encaminha para as configurações reais da loja.
 */
import { C, card } from "../../tokens";
import type { V4Vals } from "../../use-v4-preview";
import { ChevronLeftIcon } from "../icons";

export function SegurancaStage({ v }: { v: V4Vals }) {
  return (
    <div data-testid="v4-seguranca-preview">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          onClick={v.backFromSeguranca}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            border: "none",
            background: "transparent",
            fontSize: 12,
            color: C.muted,
            cursor: "pointer",
            padding: 0,
          }}
        >
          <ChevronLeftIcon />
          Voltar à Execução
        </button>
      </div>
      <div style={{ ...card, maxWidth: 520 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 8 }}>Configurações reais da loja</div>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: C.bodySoft2, lineHeight: 1.55 }}>
          A V4 não tem PIN, senha de gerente nem autorização paralela. Equipe, acesso e segurança ficam no módulo de Configurações já existente.
        </p>
        <button
          type="button"
          onClick={v.railSettings}
          style={{
            height: 34,
            padding: "0 16px",
            border: "none",
            borderRadius: 8,
            background: C.primary,
            color: C.white,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Abrir configurações
        </button>
      </div>
    </div>
  );
}
