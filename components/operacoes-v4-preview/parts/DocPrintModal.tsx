/**
 * Operações V4 Preview — modal de impressão real (GOAL OPS-V4-DOCS-ASSINATURA-
 * TERMOS-ANEXOS-012 / OPS-V4-DOCUMENTOS-ASSINATURA-ANEXOS-015).
 *
 * Reaproveita `PrintPreviewV3` (mesmo overlay, `@media print` e documentos V3).
 * Todos os `DocumentoTipoV3` com motor de impressão existente são suportados.
 * WhatsApp usa `wa.me` (mesmo contrato do orçamento), só em documentos visíveis
 * ao cliente e com telefone válido.
 */
"use client";

import { useMemo } from "react";
import { PrintPreviewV3 } from "@/components/operacoes-v3/components/print/PrintPreviewV3";
import { documentoMetaV3, type DocumentoTipoV3 } from "@/lib/operacoes-v3/documentos";
import { montarMensagemDocumentoV4 } from "@/lib/operacoes-v4/documento-mensagem";
import { montarLinkWaV4 } from "@/lib/operacoes-v4/orcamento-mensagem";
import type { V4Vals } from "../use-v4-preview";

const TIPOS_SUPORTADOS = new Set<DocumentoTipoV3>([
  "os_cliente",
  "comprovante_interno",
  "termo_garantia",
  "termo_entrega",
  "etiqueta",
  "orcamento_cliente",
]);

export function DocPrintModal({ v }: { v: V4Vals }) {
  const tipo = v.docPrintTipo && TIPOS_SUPORTADOS.has(v.docPrintTipo) ? v.docPrintTipo : null;
  const os = v.realOS;
  const whatsapp = useMemo(() => {
    if (!tipo || !os) return null;
    if (!documentoMetaV3(tipo).cliente) return null;
    return montarLinkWaV4(
      os.cliente?.telefone || os.cliente?.whatsapp,
      montarMensagemDocumentoV4(tipo, os),
    );
  }, [tipo, os]);

  return (
    <PrintPreviewV3
      tipo={tipo}
      os={os}
      onClose={v.closeDocPrint}
      onPrinted={v.registrarImpressaoDoc}
      whatsapp={whatsapp}
    />
  );
}
