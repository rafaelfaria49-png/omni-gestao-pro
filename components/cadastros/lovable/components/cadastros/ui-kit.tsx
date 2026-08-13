import { forwardRef, type ReactNode, useState } from "react";
import { X } from "lucide-react";

export function Modal({ open, onClose, title, subtitle, children, size = "lg" }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode;
  size?: "md" | "lg" | "xl";
}) {
  if (!open) return null;
  const w = size === "xl" ? "max-w-5xl" : size === "lg" ? "max-w-3xl" : "max-w-xl";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${w} max-h-[90vh] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl flex flex-col`}>
        <div
          data-omni-ui-kit="modal-header"
          className="flex items-start justify-between gap-3 border-b border-border px-5 py-4 md:px-6"
        >
          <div>
            <h2 className="text-base font-semibold leading-tight text-foreground">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 hover:bg-accent text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div data-omni-ui-kit="modal-body" className="overflow-y-auto p-5 md:p-6">
          {children}
        </div>
      </div>
    </div>
  );
}

export function Field({ label, children, span = 1 }: { label: string; children: ReactNode; span?: 1 | 2 }) {
  return (
    <div className={span === 2 ? "col-span-full space-y-1.5" : "space-y-1.5"}>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  props,
  ref
) {
  return (
    <input
      {...props}
      ref={ref}
      data-omni-ui-kit="control"
      className={`w-full h-10 px-3 rounded-lg border border-input bg-background text-foreground outline-none text-sm transition-colors focus:ring-2 focus:ring-ring ${props.className ?? ""}`}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  props,
  ref
) {
  return (
    <textarea
      {...props}
      ref={ref}
      data-omni-ui-kit="control"
      className={`w-full p-3 rounded-lg border border-input bg-background text-foreground outline-none text-sm transition-colors focus:ring-2 focus:ring-ring ${props.className ?? ""}`}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { children, ...props },
  ref
) {
  return (
    <select
      {...props}
      ref={ref}
      data-omni-ui-kit="control"
      className={`w-full h-10 px-3 rounded-lg border border-input bg-background text-foreground outline-none text-sm transition-colors focus:ring-2 focus:ring-ring ${props.className ?? ""}`}
    >
      {children}
    </select>
  );
});

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "success" | "warning" | "danger" | "info" | "primary" }) {
  const tones: Record<string, string> = {
    default: "bg-muted text-muted-foreground",
    success: "bg-[color-mix(in_oklab,var(--success)_18%,transparent)] text-[color:var(--success)]",
    warning: "bg-[color-mix(in_oklab,var(--warning)_20%,transparent)] text-[color:var(--warning)]",
    danger: "bg-[color-mix(in_oklab,var(--destructive)_18%,transparent)] text-[color:var(--destructive)]",
    info: "bg-[color-mix(in_oklab,var(--info)_18%,transparent)] text-[color:var(--info)]",
    primary: "bg-primary/15 text-primary",
  };
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Card({
  children,
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { children: ReactNode; className?: string }) {
  return (
    <div
      {...props}
      className={`min-w-0 max-w-full rounded-2xl border border-border bg-card ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex min-w-0 items-end justify-between gap-3">
      <div className="min-w-0">
        <h3 className="truncate text-base font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function useToggle(init = false) {
  const [v, setV] = useState(init);
  return { open: v, openIt: () => setV(true), close: () => setV(false), toggle: () => setV(!v) };
}
