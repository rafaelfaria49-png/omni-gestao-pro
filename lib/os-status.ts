import type { StatusOrdemServico } from "@/generated/prisma"

export const STATUS_OS_OPTIONS: { value: StatusOrdemServico; label: string }[] = [
  { value: "Aberto", label: "Aberto" },
  { value: "EmAnalise", label: "Em Análise" },
  { value: "Pronto", label: "Pronto" },
  { value: "Entregue", label: "Entregue" },
]

export function labelStatusOS(s: StatusOrdemServico): string {
  return STATUS_OS_OPTIONS.find((o) => o.value === s)?.label ?? s
}

export function parseStatusOS(raw: unknown): StatusOrdemServico | null {
  if (typeof raw !== "string") return null
  const ok = STATUS_OS_OPTIONS.some((o) => o.value === raw)
  return ok ? (raw as StatusOrdemServico) : null
}
