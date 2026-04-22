export default function SuportePage() {
  return (
    <div className="min-h-screen bg-background p-6 lg:p-10 max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Suporte</h1>
      <p className="text-muted-foreground">Canal para resolver dúvidas de cobrança e uso do sistema</p>
      <div className="rounded-xl border border-border bg-card p-6 space-y-2">
        <p className="text-sm">WhatsApp: (00) 00000-0000</p>
        <p className="text-sm">E-mail: suporte@seudominio.com.br</p>
        <p className="text-sm text-muted-foreground">Horário: seg a sex, 08:00 às 18:00</p>
      </div>
    </div>
  )
}
