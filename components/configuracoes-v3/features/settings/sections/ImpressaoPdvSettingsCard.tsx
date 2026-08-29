"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { SettingsCard } from "../components/SettingsCard";
import { Label } from "@/components/configuracoes-v3/components/ui/label";
import { Input } from "@/components/configuracoes-v3/components/ui/input";
import { Button } from "@/components/configuracoes-v3/components/ui/button";
import { Switch } from "@/components/configuracoes-v3/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/configuracoes-v3/components/ui/select";
import { useToast } from "@/components/configuracoes-v3/hooks/use-toast";
import { useLojaAtiva } from "@/lib/loja-ativa";
import { useStoreSettings } from "@/lib/store-settings-provider";
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers";
import {
  defaultPdvImpressaoConfig,
  mergeImpressaoIntoPrinterConfig,
  type PdvImpressaoConfig,
} from "@/lib/pdv-impressao-config";
import { buildPdvReceiptEscPos } from "@/lib/escpos";
import { sendEscPosViaProxy } from "@/lib/thermal-print";
import { configPadrao } from "@/lib/config-empresa";

function safePrinter(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
}

function configsEqual(a: PdvImpressaoConfig, b: PdvImpressaoConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function ImpressaoPdvSettingsCard() {
  const { toast } = useToast();
  const { lojaAtivaId } = useLojaAtiva();
  const { hydrated, settings, impressaoConfig, refresh } = useStoreSettings();

  const [form, setForm] = useState<PdvImpressaoConfig>(() => defaultPdvImpressaoConfig());
  const [snapshot, setSnapshot] = useState<PdvImpressaoConfig>(() => defaultPdvImpressaoConfig());
  const [remotePrinter, setRemotePrinter] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const sync = useCallback(() => {
    const next = impressaoConfig;
    setForm(next);
    setSnapshot(next);
    setRemotePrinter(safePrinter(settings?.printerConfig));
  }, [impressaoConfig, settings?.printerConfig]);

  useEffect(() => {
    if (!hydrated) return;
    sync();
  }, [hydrated, sync, lojaAtivaId]);

  const dirty = useMemo(() => !configsEqual(form, snapshot), [form, snapshot]);
  const noLoja = !lojaAtivaId?.trim();
  const busy = !hydrated || saving;

  const patch = <K extends keyof PdvImpressaoConfig>(key: K, value: PdvImpressaoConfig[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleCancel = () => setForm(snapshot);

  const handleSave = async () => {
    const lojaHeader = lojaAtivaId?.trim();
    if (!lojaHeader) {
      toast({
        title: "Nenhuma unidade ativa",
        description: "Defina a unidade ativa na seção Lojas.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const impressao: PdvImpressaoConfig = {
        ...form,
        impressoraHost: form.impressoraHost.trim(),
        impressoraPorta: Math.min(65535, Math.max(1, Math.round(form.impressoraPorta) || 9100)),
        rodapeCupom: form.rodapeCupom.trim(),
        viasCupom: Math.min(5, Math.max(1, Math.round(form.viasCupom) || 1)),
      };

      const nextPrinter = mergeImpressaoIntoPrinterConfig(remotePrinter, impressao);
      const res = await fetch(`/api/stores/${encodeURIComponent(lojaHeader)}/settings`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          [ASSISTEC_LOJA_HEADER]: lojaHeader,
        },
        body: JSON.stringify({
          printerConfig: nextPrinter,
          ...(impressao.rodapeCupom
            ? { receiptFooter: impressao.rodapeCupom }
            : {}),
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `Falha ao salvar (HTTP ${res.status})`);
      }

      setForm(impressao);
      setSnapshot(impressao);
      setRemotePrinter(nextPrinter);
      await refresh();
      toast({
        title: "Impressão salva",
        description: "O PDV desta unidade passará a usar estas preferências.",
      });
    } catch (e) {
      toast({
        title: "Não foi possível salvar",
        description: e instanceof Error ? e.message : "Erro inesperado",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestPrint = async () => {
    setTesting(true);
    try {
      const bytes = buildPdvReceiptEscPos(
        {
          nomeFantasia: configPadrao.empresa.nomeFantasia,
          cnpj: configPadrao.empresa.cnpj,
          itens: [{ name: "Teste de impressão", quantity: 1, unitPrice: 1, lineTotal: 1 }],
          subtotal: 1,
          taxes: 0,
          discount: 0,
          total: 1,
          dataHora: new Date().toLocaleString("pt-BR"),
          receiptFooter: form.rodapeCupom.trim() || "Teste OmniGestão — configurações PDV",
        },
        { modo: form.comprovanteModo, maxChars: form.bobinaTamanho === "58mm" ? 32 : 48 },
      );
      const host = form.impressoraHost.trim();
      const res = await sendEscPosViaProxy(
        bytes,
        host ? { host, port: form.impressoraPorta } : undefined,
      );
      if (res.ok) {
        toast({ title: "Teste enviado", description: "Cupom de teste enviado à impressora (TCP/raw)." });
      } else {
        toast({
          title: "Impressora indisponível",
          description: `${res.error} — verifique host/porta ou THERMAL_PRINT_HOST no servidor.`,
          variant: "destructive",
        });
      }
    } finally {
      setTesting(false);
    }
  };

  return (
    <SettingsCard
      title="Impressão operacional"
      description="Preferências da estação/unidade consumidas pelo PDV, OS e crediário. O cupom usa ESC/POS pela API /api/print/raw (TCP 9100 ou bridge HTTP)."
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2 min-w-0 sm:col-span-2">
          <Label htmlFor="imp-host">Impressora de comprovante (host/IP)</Label>
          <Input
            id="imp-host"
            placeholder="Ex.: 192.168.0.50 ou deixe vazio para THERMAL_PRINT_HOST do servidor"
            value={form.impressoraHost}
            onChange={(e) => patch("impressoraHost", e.target.value)}
            disabled={busy || noLoja}
          />
          <p className="text-xs text-muted-foreground">
            Porta raw padrão 9100. Com host configurado, o caixa envia direto para esta térmica; o navegador só é aberto quando o operador escolhe o fallback.
          </p>
        </div>

        <div className="space-y-2 min-w-0">
          <Label htmlFor="imp-port">Porta TCP</Label>
          <Input
            id="imp-port"
            type="number"
            min={1}
            max={65535}
            value={form.impressoraPorta}
            onChange={(e) => patch("impressoraPorta", Number(e.target.value) || 9100)}
            disabled={busy || noLoja}
          />
        </div>

        <div className="space-y-2 min-w-0">
          <Label>Bobina</Label>
          <Select
            value={form.bobinaTamanho}
            onValueChange={(v) => patch("bobinaTamanho", v === "58mm" ? "58mm" : "80mm")}
            disabled={busy || noLoja}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="80mm">80 mm (padrão)</SelectItem>
              <SelectItem value="58mm">58 mm</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 min-w-0">
          <Label>Comprovante</Label>
          <Select
            value={form.comprovanteModo}
            onValueChange={(v) =>
              patch("comprovanteModo", v === "simplificado" ? "simplificado" : "completo")
            }
            disabled={busy || noLoja}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="completo">Completo (itens detalhados)</SelectItem>
              <SelectItem value="simplificado">Simplificado (resumo)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 min-w-0">
          <Label htmlFor="imp-vias">Vias do cupom</Label>
          <Input
            id="imp-vias"
            type="number"
            min={1}
            max={5}
            value={form.viasCupom}
            onChange={(e) => patch("viasCupom", Number(e.target.value) || 1)}
            disabled={busy || noLoja}
          />
        </div>

        <div className="space-y-2 min-w-0 sm:col-span-2">
          <Label htmlFor="imp-rodape">Rodapé do cupom</Label>
          <Input
            id="imp-rodape"
            placeholder="Opcional — sobrescreve o rodapé geral da unidade quando preenchido"
            value={form.rodapeCupom}
            onChange={(e) => patch("rodapeCupom", e.target.value)}
            disabled={busy || noLoja}
          />
        </div>
      </div>

      <ul className="mt-5 divide-y divide-border rounded-lg border border-border">
        {(
          [
            ["abrirGaveta", "Abrir gaveta após impressão", "Pulso ESC/POS na gaveta de dinheiro"],
            ["imprimirAutomatico", "Imprimir cupom automaticamente", "Após confirmar pagamento no PDV"],
            ["logoNoCupom", "Exibir logo no cupom (HTML)", "Usa logoUrl da unidade quando disponível"],
            ["imprimirOs", "Permitir impressão térmica de OS", "Ordens de serviço no módulo Operações"],
            ["imprimirCrediario", "Permitir recibo de crediário", "Baixas em Contas a Receber"],
          ] as const
        ).map(([key, label, hint]) => (
          <li key={key} className="flex items-start justify-between gap-4 px-4 py-3 min-w-0">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-xs text-muted-foreground">{hint}</p>
            </div>
            <Switch
              checked={form[key]}
              onCheckedChange={(v) => patch(key, v)}
              disabled={busy || noLoja}
            />
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={handleCancel} disabled={busy || !dirty}>
          Cancelar
        </Button>
        <Button type="button" onClick={() => void handleSave()} disabled={busy || noLoja || !dirty}>
          {saving ? "Salvando…" : "Salvar impressão"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void handleTestPrint()}
          disabled={busy || noLoja || testing}
        >
          <Printer className="mr-2 h-4 w-4" />
          {testing ? "Testando…" : "Testar impressão"}
        </Button>
      </div>
    </SettingsCard>
  );
}
