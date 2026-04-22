"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const REQUIRED = "EXCLUIR"

export function TypeToConfirmDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  requiredText?: string
  onConfirm: () => void | Promise<void>
  busy?: boolean
}) {
  const required = props.requiredText?.trim() || REQUIRED
  const [text, setText] = useState("")

  useEffect(() => {
    if (!props.open) setText("")
  }, [props.open])

  const canConfirm = useMemo(() => text.trim() === required, [text, required])

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          {props.description ? <DialogDescription>{props.description}</DialogDescription> : null}
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="type-to-confirm">Digite {required} para confirmar</Label>
          <Input
            id="type-to-confirm"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            placeholder={required}
          />
          <p className="text-xs text-muted-foreground">
            Esta etapa extra evita exclusões acidentais em massa.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)} disabled={props.busy}>
            Cancelar
          </Button>
          <Button
            type="button"
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={!canConfirm || props.busy}
            onClick={() => void props.onConfirm()}
          >
            {props.confirmLabel ?? "Excluir definitivamente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
