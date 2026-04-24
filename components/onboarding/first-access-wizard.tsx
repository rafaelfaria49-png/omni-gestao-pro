"use client"

import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { ASSISTEC_STORES_SYNC_STORAGE_KEY, useLojaAtiva } from "@/lib/loja-ativa"
import { LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"

type WizardStep = 1 | 2 | 3
type StoreProfile = "ASSISTENCIA" | "SUPERMERCADO" | "VARIEDADES"

function emptyAddress() {
  return { rua: "", numero: "", bairro: "", cidade: "", estado: "", cep: "" }
}

export function FirstAccessWizard() {
  const { toast } = useToast()
  const { lojaAtivaId, lojaAtivaRaw, cadastroBasicoIncompleto, refreshStoresList } = useLojaAtiva()
  const storeId = (lojaAtivaId || lojaAtivaRaw?.id || LEGACY_PRIMARY_STORE_ID).trim() || LEGACY_PRIMARY_STORE_ID

  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<WizardStep>(1)
  const [saving, setSaving] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const [nomeFantasia, setNomeFantasia] = useState("")
  const [cnpj, setCnpj] = useState("")
  const [address, setAddress] = useState(() => emptyAddress())
  const [telefone, setTelefone] = useState("")
  const [whatsapp, setWhatsapp] = useState("")
  const [whatsappDono, setWhatsappDono] = useState("")
  const [email, setEmail] = useState("")
  const [perfil, setPerfil] = useState<StoreProfile>("ASSISTENCIA")

  const dismissKey = useMemo(() => `@omnigestao:first-access-wizard:dismissed:${storeId}`, [storeId])
  const canClose = !cadastroBasicoIncompleto || dismissed
  const title = useMemo(() => {
    if (step === 1) return "Boas-vindas! Vamos configurar sua loja"
    if (step === 2) return "Endereço e contatos"
    return "Perfil do negócio"
  }, [step])

  useEffect(() => {
    try {
      const raw = String(sessionStorage.getItem(dismissKey) || "")
      if (raw === "1") setDismissed(true)
    } catch {
      /* ignore */
    }

    if (cadastroBasicoIncompleto && !dismissed) {
      setOpen(true)
      setStep(1)
    } else {
      setOpen(false)
    }
  }, [cadastroBasicoIncompleto, dismissKey, dismissed])

  useEffect(() => {
    // Prefill com dados remotos (se existirem) para evitar “wizard infinito” por falta de hidratação.
    const raw = lojaAtivaRaw
    if (!raw) return
    setNomeFantasia((prev) => prev || (raw.nomeFantasia || "").trim())
    setCnpj((prev) => prev || (raw.cnpj || "").trim())
    setAddress((prev) => {
      const base = { ...prev, ...(raw.endereco || {}) }
      return { ...emptyAddress(), ...base }
    })
    setPerfil((prev) => prev || (raw.storeProfile as StoreProfile) || "ASSISTENCIA")
  }, [lojaAtivaRaw])

  const validateStep1 = () => {
    const n = nomeFantasia.trim()
    const d = cnpj.trim()
    if (!n) {
      toast({ variant: "destructive", title: "Nome obrigatório", description: "Informe o nome da loja (nome fantasia)." })
      return false
    }
    if (!d) {
      toast({ variant: "destructive", title: "CNPJ obrigatório", description: "Informe o CNPJ da loja." })
      return false
    }
    return true
  }

  const validateStep2 = () => true
  const validateStep3 = () => true

  const next = () => {
    if (step === 1 && !validateStep1()) return
    if (step === 2 && !validateStep2()) return
    setStep((s) => (s === 1 ? 2 : 3))
  }

  const back = () => setStep((s) => (s === 3 ? 2 : 1))

  const finish = async () => {
    if (!validateStep1() || !validateStep2() || !validateStep3()) return
    const nomeTrim = nomeFantasia.trim()
    const cnpjTrim = cnpj.trim()
    setSaving(true)
    try {
      const r1 = await fetch(`/api/stores/${encodeURIComponent(storeId)}`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          [ASSISTEC_LOJA_HEADER]: storeId,
        },
        body: JSON.stringify({
          name: nomeTrim,
          cnpj: cnpjTrim,
          phone: telefone.trim(),
          logoUrl: "",
          address: { ...emptyAddress(), ...address },
          profile: perfil,
        }),
      })
      if (!r1.ok) {
        const j = (await r1.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || `Falha ao salvar dados da loja (HTTP ${r1.status})`)
      }

      await fetch(`/api/stores/${encodeURIComponent(storeId)}/settings`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          [ASSISTEC_LOJA_HEADER]: storeId,
        },
        body: JSON.stringify({
          contactEmail: email.trim(),
          contactWhatsapp: whatsapp.trim(),
          contactWhatsappDono: whatsappDono.trim(),
        }),
      })

      await refreshStoresList()
      try {
        localStorage.setItem(ASSISTEC_STORES_SYNC_STORAGE_KEY, String(Date.now()))
      } catch {
        /* ignore */
      }

      toast({ title: "Cadastro concluído", description: "Dados básicos salvos. Você já pode operar o sistema." })
      setOpen(false)
      setDismissed(false)
      try {
        sessionStorage.removeItem(dismissKey)
      } catch {
        /* ignore */
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Não foi possível concluir",
        description: e instanceof Error ? e.message : "Falha ao salvar",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !canClose) {
          setDismissed(true)
          try {
            sessionStorage.setItem(dismissKey, "1")
          } catch {
            /* ignore */
          }
          setOpen(false)
          return
        }
        setOpen(v)
      }}
    >
      <DialogContent
        className="sm:max-w-[720px]"
        onPointerDownOutside={(e) => {
          if (!canClose) {
            e.preventDefault()
            setDismissed(true)
            try {
              sessionStorage.setItem(dismissKey, "1")
            } catch {
              /* ignore */
            }
            setOpen(false)
          }
        }}
        onEscapeKeyDown={(e) => {
          if (!canClose) {
            e.preventDefault()
            setDismissed(true)
            try {
              sessionStorage.setItem(dismissKey, "1")
            } catch {
              /* ignore */
            }
            setOpen(false)
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Informe os dados mínimos para identificar a unidade no sistema e nos documentos."
              : step === 2
                ? "Esses dados ajudam em documentos, automações e mensagens."
                : "Isso ajusta módulos e telas conforme o tipo do seu negócio."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Nome da loja (nome fantasia)</Label>
              <Input value={nomeFantasia} onChange={(e) => setNomeFantasia(e.target.value)} placeholder="Minha Loja" />
            </div>
            <div className="space-y-2">
              <Label>CNPJ</Label>
              <Input value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0001-00" />
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Rua</Label>
                <Input value={address.rua} onChange={(e) => setAddress((p) => ({ ...p, rua: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Número</Label>
                <Input value={address.numero} onChange={(e) => setAddress((p) => ({ ...p, numero: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Bairro</Label>
                <Input value={address.bairro} onChange={(e) => setAddress((p) => ({ ...p, bairro: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Cidade</Label>
                <Input value={address.cidade} onChange={(e) => setAddress((p) => ({ ...p, cidade: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Estado</Label>
                <Input value={address.estado} onChange={(e) => setAddress((p) => ({ ...p, estado: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>CEP</Label>
                <Input value={address.cep} onChange={(e) => setAddress((p) => ({ ...p, cep: e.target.value }))} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(00) 00000-0000" />
              </div>
              <div className="space-y-2">
                <Label>WhatsApp</Label>
                <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="(00) 00000-0000" />
              </div>
              <div className="space-y-2">
                <Label>WhatsApp do dono</Label>
                <Input value={whatsappDono} onChange={(e) => setWhatsappDono(e.target.value)} placeholder="(00) 00000-0000" />
              </div>
              <div className="space-y-2">
                <Label>E-mail</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contato@seudominio.com.br" />
              </div>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Escolha o perfil</Label>
              <Select value={perfil} onValueChange={(v) => setPerfil(v as StoreProfile)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ASSISTENCIA">Assistência</SelectItem>
                  <SelectItem value="SUPERMERCADO">Supermercado</SelectItem>
                  <SelectItem value="VARIEDADES">Variedades</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center justify-between gap-3 sm:justify-start">
            <div className="text-xs text-muted-foreground">Passo {step} de 3</div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDismissed(true)
                try {
                  sessionStorage.setItem(dismissKey, "1")
                } catch {
                  /* ignore */
                }
                setOpen(false)
              }}
            >
              Voltar depois
            </Button>
          </div>

          <div className="flex gap-2 sm:justify-end">
            {step > 1 ? (
              <Button type="button" variant="outline" onClick={back} disabled={saving}>
                Voltar
              </Button>
            ) : null}
            {step < 3 ? (
              <Button type="button" onClick={next} disabled={saving}>
                Continuar
              </Button>
            ) : (
              <Button type="button" onClick={finish} disabled={saving}>
                {saving ? "Salvando..." : "Concluir"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

