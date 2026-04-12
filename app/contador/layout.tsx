import { AppOpsProviders } from "@/components/dashboard/app-ops-providers"

export default function ContadorLayout({ children }: { children: React.ReactNode }) {
  return <AppOpsProviders>{children}</AppOpsProviders>
}
