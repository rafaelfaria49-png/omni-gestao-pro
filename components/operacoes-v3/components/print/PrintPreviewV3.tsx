"use client";

// ============================================================================
// Operações V3 — Fase 1D/1E · Preview de impressão (modal portado ao body).
// ----------------------------------------------------------------------------
// Renderiza o documento escolhido (`tipo`) num overlay portado para
// `document.body` (escapa do AppShell) + injeta CSS `@media print` que esconde
// toda a app e imprime só o `#og-print-root`. Toolbar tem `data-no-print`.
// Suporta: OS cliente · Termo de garantia · Via interna · Etiqueta técnica.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Printer, MessageCircle } from "lucide-react";
import type { LinkWaV4 } from "@/lib/operacoes-v4/orcamento-mensagem";
import type { OrdemServico } from "@/types/os";
import {
  montarDocumentoOSV3,
  montarEtiquetaV3,
  montarTermoEntregaV3,
  montarTermoGarantiaDocV3,
  type EmpresaPrintInputV3,
} from "@/lib/operacoes-v3/print-model";
import { documentoMetaV3, type DocumentoTipoV3 } from "@/lib/operacoes-v3/documentos";
import { montarOrcamentoClienteViewV4 } from "@/lib/operacoes-v4/orcamento-cliente-view";
import { ButtonV3 } from "../UiV3";
import { OSPrintDocumentV3 } from "./OSPrintDocumentV3";
import { TermoGarantiaDocV3 } from "./TermoGarantiaDocV3";
import { TermoEntregaDocV3 } from "./TermoEntregaDocV3";
import { EtiquetaTecnicaV3 } from "./EtiquetaTecnicaV3";
// GOAL OPS-V4-ORC-VIEWMODEL-DOC-023: novo documento "Orçamento (via cliente)",
// mesmo motor de impressão — consome a projeção client-safe, nunca a OS crua.
import { OrcamentoClienteDocV4 } from "@/components/operacoes-v4-preview/parts/OrcamentoClienteDocV4";

const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 12mm; }
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body * { visibility: hidden !important; }
  [data-og-print-overlay] { position: static !important; inset: auto !important; overflow: visible !important; background: transparent !important; }
  [data-no-print] { display: none !important; }
  #og-print-root, #og-print-root * { visibility: visible !important; }
  #og-print-root { position: absolute; left: 0; top: 0; width: 100%; max-width: none !important; margin: 0 !important; box-shadow: none !important; padding-left: 0 !important; padding-right: 0 !important; }
}
`;

export function PrintPreviewV3({
  tipo,
  os,
  empresa,
  onClose,
  onPrinted,
  whatsapp,
}: {
  /** Documento a imprimir; null = fechado. */
  tipo: DocumentoTipoV3 | null;
  os: OrdemServico | null;
  empresa?: EmpresaPrintInputV3;
  onClose: () => void;
  onPrinted?: (tipo: DocumentoTipoV3) => void;
  /** Link wa.me já montado (mesmo contrato do orçamento). Só documentos visíveis ao cliente. */
  whatsapp?: LinkWaV4 | null;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const open = tipo !== null && !!os;

  const conteudo = useMemo(() => {
    if (!open || !os || !tipo) return null;
    switch (tipo) {
      case "os_cliente":
        return <OSPrintDocumentV3 doc={montarDocumentoOSV3(os, empresa, { variante: "cliente" })} />;
      case "comprovante_interno":
        return <OSPrintDocumentV3 doc={montarDocumentoOSV3(os, empresa, { variante: "interna" })} />;
      case "termo_garantia":
        return <TermoGarantiaDocV3 doc={montarTermoGarantiaDocV3(os, empresa)} />;
      case "termo_entrega":
        return <TermoEntregaDocV3 doc={montarTermoEntregaV3(os, empresa)} />;
      case "etiqueta":
        return <EtiquetaTecnicaV3 etiqueta={montarEtiquetaV3(os)} />;
      case "orcamento_cliente": {
        const view = montarOrcamentoClienteViewV4(os, empresa);
        return view ? <OrcamentoClienteDocV4 doc={view} /> : null;
      }
      default:
        return null;
    }
  }, [open, os, tipo, empresa]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted || !conteudo || !tipo) return null;

  const meta = documentoMetaV3(tipo);
  const numero = os?.codigo ?? "";

  const imprimir = () => {
    onPrinted?.(tipo);
    window.print();
  };

  return createPortal(
    <div data-og-print-overlay className="fixed inset-0 z-[80] overflow-y-auto bg-zinc-700/60">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div data-no-print className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-card px-4 py-2.5 shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{meta.label} · {numero}</span>
          {!meta.cliente ? (
            <span className="hidden rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning sm:inline">uso interno</span>
          ) : (
            <span className="hidden text-xs text-muted-foreground sm:inline">A4</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ButtonV3 variant="ghost" onClick={onClose}>
            <ArrowLeft className="h-4 w-4" aria-hidden /> Voltar
          </ButtonV3>
          {meta.cliente && whatsapp && whatsapp.valido ? (
            <ButtonV3
              variant="outline"
              onClick={() => window.open(whatsapp.url, "_blank", "noopener,noreferrer")}
            >
              <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
            </ButtonV3>
          ) : null}
          {meta.cliente && whatsapp && !whatsapp.valido ? (
            <span className="hidden max-w-[180px] truncate text-xs text-muted-foreground sm:inline" title={whatsapp.motivo}>
              {whatsapp.motivo}
            </span>
          ) : null}
          <ButtonV3 variant="primary" onClick={imprimir}>
            <Printer className="h-4 w-4" aria-hidden /> Imprimir
          </ButtonV3>
        </div>
      </div>

      <div className="flex justify-center px-3 py-6">
        <div className="w-full max-w-[820px] rounded-md bg-white shadow-lg">
          {conteudo}
        </div>
      </div>
    </div>,
    document.body,
  );
}
