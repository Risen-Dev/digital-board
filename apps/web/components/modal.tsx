"use client";

import { X } from "lucide-react";
import { useT } from "@/components/i18n";
import { useDialog } from "@/hooks/use-dialog";

/** Centered dialog shell: backdrop click and the X close it. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const tr = useT();
  const dialog = useDialog(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6 animate-in fade-in duration-150" onClick={onClose}>
      <div
        {...dialog}
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="mt-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-card shadow-lg outline-none animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-200"
      >
        <div className="flex shrink-0 items-center gap-2 border-b px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label={tr("Close")}
            className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
