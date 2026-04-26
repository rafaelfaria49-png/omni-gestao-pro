const PT_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const

export type MarketingPostRow = {
  id: string
  caption: string
  productName: string
  tone: string
  status: string
  scheduledFor: string | null
  createdAt: string
}

export type EditorialCalendarItem = {
  id: string
  day: string
  time: string
  title: string
  status: "agendado" | "rascunho"
}

function titleFromPost(p: MarketingPostRow): string {
  const prod = (p.productName || "").trim()
  if (prod) return prod.length > 56 ? `${prod.slice(0, 53)}…` : prod
  const line = p.caption.replace(/\s+/g, " ").trim()
  if (!line) return "Post IA"
  return line.length > 56 ? `${line.slice(0, 53)}…` : line
}

/** Converte registros do Prisma para cards do calendário editorial. */
export function marketingPostsToCalendarItems(posts: MarketingPostRow[]): EditorialCalendarItem[] {
  return posts.map((p) => {
    const created = new Date(p.createdAt)
    const sched = p.scheduledFor ? new Date(p.scheduledFor) : null
    const isScheduled = p.status === "SCHEDULED"
    const ref =
      isScheduled && sched && !Number.isNaN(sched.getTime())
        ? sched
        : !Number.isNaN(created.getTime())
          ? created
          : new Date()
    const day = PT_SHORT[ref.getDay()] ?? "—"
    const time = ref.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    return {
      id: p.id,
      day,
      time,
      title: titleFromPost(p),
      status: isScheduled ? "agendado" : "rascunho",
    }
  })
}
