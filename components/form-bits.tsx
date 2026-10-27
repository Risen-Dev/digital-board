"use client";

import { useFormStatus } from "react-dom";
import { useT } from "@/components/i18n";

export function Field({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium">{label}</span>
      <input
        {...props}
        className="rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-ring"
      />
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Select({
  label,
  children,
  ...props
}: { label: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium">{label}</span>
      <select
        {...props}
        className="rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-ring"
      >
        {children}
      </select>
    </label>
  );
}

export function FormError({ error }: { error?: string }) {
  const tr = useT();
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md bg-[rgba(239,68,68,0.08)] px-3 py-2 text-xs text-[#ef4444]">
      {tr(error)}
    </p>
  );
}

/** `pending` overrides the form status, for forms submitted from onSubmit (see TaskDialog). */
export function SubmitButton({ children, pending: busy }: { children: React.ReactNode; pending?: boolean }) {
  const tr = useT();
  const status = useFormStatus();
  const pending = busy ?? status.pending;
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {pending ? tr("Saving…") : children}
    </button>
  );
}
