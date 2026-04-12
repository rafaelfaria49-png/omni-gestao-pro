import { AppOpsProviders } from "@/components/dashboard/app-ops-providers"

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <AppOpsProviders>{children}</AppOpsProviders>
}
