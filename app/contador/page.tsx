import type { Metadata } from "next"
import { AreaContadorPro } from "@/components/dashboard/contador/area-contador-pro"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"

export const metadata: Metadata = {
  title: `Contador · ${APP_DISPLAY_NAME}`,
  description: "Área do contador e exportações fiscais.",
}

export default function ContadorPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="p-4 lg:p-8">
        <AreaContadorPro />
      </main>
    </div>
  )
}
