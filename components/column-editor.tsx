"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleCheck, Timer, Trash2, X } from "lucide-react";
import { PALETTE } from "@/lib/board";
import { useT } from "@/components/i18n";

const NEUTRAL = "var(--muted-foreground)";
const SWATCHES = [NEUTRAL, ...PALETTE];

/**
 * One popover used for both "add column" and "edit column" — same fields,
 * so there is no reason for two components.
 */
export function ColumnEditor({
  title: initialTitle = "",
  color: initialColor = NEUTRAL,
  limitDays: initialLimit = null,
  heading,
  submitLabel,
  onSubmit,
  onDelete,
  onMove,
  done,
  onToggleDone,
  onClose,
}: {
  title?: string;
  color?: string;
  limitDays?: number | null;
  heading: string;
  submitLabel: string;
  onSubmit: (title: string, color: string, limitDays: number | null) => Promise<{ error?: string } | void>;
  onDelete?: () => Promise<{ error?: string } | void>;
  onMove?: (direction: -1 | 1) => Promise<void>;
  /** Whether this is the project's done column; the toggle marks or unmarks it. */
  done?: boolean;
  onToggleDone?: () => Promise<unknown>;
  onClose: () => void;
}) {
  const tr = useT();
  const [title, setTitle] = useState(initialTitle);
  const [color, setColor] = useState(initialColor);
  const [limit, setLimit] = useState(initialLimit === null ? "" : String(initialLimit));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    const res = await onSubmit(title, color, limit.trim() ? Number(limit) : null);
    setBusy(false);
    if (res?.error) return setError(res.error);
    onClose();
  }

  return (
    <div className="absolute left-0 top-8 z-30 w-60 rounded-lg border bg-card p-3 shadow-lg animate-in fade-in zoom-in-95 slide-in-from-top-1 duration-150">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold">{heading}</span>
        <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>

      <input
        value={title}
        autoFocus
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
          if (e.key === "Escape") onClose();
        }}
        placeholder={tr("Column name")}
        className="mb-2 w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:border-ring"
      />

      <div className="mb-3 flex flex-wrap gap-1.5">
        {SWATCHES.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            aria-label={`Colour ${c}`}
            style={{ background: c }}
            className={`size-5 rounded-full transition-transform ${
              color === c ? "ring-2 ring-ring ring-offset-2 ring-offset-card" : "hover:scale-110"
            }`}
          >
            {color === c && <Check className="mx-auto size-3 text-white" />}
          </button>
        ))}
      </div>

      <label className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground" title={tr("Cards that stay longer than this turn red")}>
        <Timer className="size-3.5 shrink-0" />
        {tr("Day limit")}
        <input
          type="number"
          min={1}
          max={365}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
          placeholder={tr("None")}
          className="ml-auto w-16 rounded-md border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
        />
      </label>

      {onToggleDone && (
        <button
          onClick={() => void onToggleDone()}
          aria-pressed={done}
          title={tr("Cards here count as completed; repeating cards renew when they arrive")}
          className={`mb-3 flex w-full items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors hover:bg-secondary ${done ? "border-primary font-medium" : "text-muted-foreground"}`}
        >
          <CircleCheck className="size-3.5" />
          {done ? tr("Done column") : tr("Mark as done column")}
        </button>
      )}

      {error && <p className="mb-2 text-[11px] text-[var(--chart-7)]">{tr(error)}</p>}

      <div className="flex items-center gap-1.5">
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? tr("Saving…") : submitLabel}
        </button>

        {onMove && (
          <>
            <button
              onClick={() => void onMove(-1)}
              title={tr("Move left")}
              className="rounded-md border p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
            </button>
            <button
              onClick={() => void onMove(1)}
              title={tr("Move right")}
              className="rounded-md border p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <ArrowRight className="size-3.5" />
            </button>
          </>
        )}

        {onDelete && (
          <button
            onClick={async () => {
              const res = await onDelete();
              if (res?.error) return setError(res.error);
              onClose();
            }}
            title={tr("Delete column")}
            className="ml-auto rounded-md border p-1.5 text-muted-foreground transition-colors hover:bg-[rgba(239,68,68,0.08)] hover:text-[var(--chart-7)]"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
