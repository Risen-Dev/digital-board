"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { useT } from "@/components/i18n";

/** Click-to-rename text. Used for the board name in the header and on Home. */
export function EditableTitle({
  value,
  onSave,
  className = "",
  inputClassName = "",
}: {
  value: string;
  onSave: (name: string) => Promise<{ error?: string } | void>;
  className?: string;
  inputClassName?: string;
}) {
  const tr = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  async function commit() {
    setEditing(false);
    if (draft.trim() === value || !draft.trim()) return setDraft(value);
    const res = await onSave(draft);
    if (res?.error) {
      setError(res.error);
      setDraft(value);
    }
  }

  if (editing) {
    return (
      <input
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className={`rounded-md border bg-background px-2 py-0.5 outline-none focus:border-ring ${inputClassName || className}`}
      />
    );
  }

  return (
    <button
      onClick={() => {
        setDraft(value);
        setError(null);
        setEditing(true);
      }}
      title={tr("Rename")}
      className={`group/title flex items-center gap-1.5 ${className}`}
    >
      <span className="truncate">{value}</span>
      <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100" />
      {error && <span className="text-[11px] font-normal text-[var(--chart-7)]">{tr(error)}</span>}
    </button>
  );
}
