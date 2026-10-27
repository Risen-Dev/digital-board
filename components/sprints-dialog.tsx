"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { completeSprint, deleteSprint, saveSprint } from "@/lib/actions";
import { dateOfDay, dayNumber, type Sprint } from "@/lib/board";
import { Modal } from "./modal";
import { useT } from "@/components/i18n";

/** Plan, complete and delete a project's sprints. */
export function SprintsDialog({ projectId, sprints, today, readOnly, onClose }: {
  projectId: string;
  sprints: Sprint[];
  today: string;
  readOnly: boolean;
  onClose: () => void;
}) {
  const tr = useT();
  const router = useRouter();
  const open = sprints.filter((s) => !s.closed);
  const closed = sprints.filter((s) => s.closed);
  // The next sprint starts the day after the last one ends, and runs two weeks.
  const lastEnd = Math.max(dayNumber(today) - 1, ...sprints.map((s) => dayNumber(s.endDate)));
  const [name, setName] = useState(`Sprint ${sprints.length + 1}`);
  const [start, setStart] = useState(dateOfDay(lastEnd + 1));
  const [end, setEnd] = useState(dateOfDay(lastEnd + 14));
  const [completing, setCompleting] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function run(result: Promise<{ error?: string; ok?: boolean }>) {
    setError(null);
    const r = await result;
    if (r.error) {
      setError(r.error);
      return false;
    }
    router.refresh();
    return true;
  }

  const row = (s: Sprint) => {
    const left = dayNumber(s.endDate) - dayNumber(today);
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    return (
      <li key={s.id} className="flex flex-col gap-2 py-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{s.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {s.startDate} → {s.endDate}
              {!s.closed && (today < s.startDate ? ` · ${tr("Starts {date}", { date: s.startDate })}`
                : left >= 0 ? ` · ${tr("{n} days left", { n: left })}` : ` · ${tr("{n} days over", { n: -left })}`)}
              {s.closed && ` · ${tr("Completed")}`}
            </p>
          </div>
          <span className="shrink-0 text-[11px] text-muted-foreground">{tr("{done}/{total} done", { done: s.done, total: s.total })}</span>
          {!readOnly && !s.closed && (
            <button
              onClick={() => { setCompleting(completing === s.id ? null : s.id); setMoveTo(open.find((o) => o.id !== s.id)?.id ?? ""); }}
              className="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-secondary"
            >
              {tr("Complete")}
            </button>
          )}
          {!readOnly && (
            <button
              aria-label={tr("Delete")}
              onClick={() => confirm(tr("Delete sprint \"{name}\"? Its cards go back to the backlog.", { name: s.name })) && void run(deleteSprint(s.id))}
              className="rounded p-1 text-muted-foreground transition-colors hover:text-[#ef4444]"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-[var(--chart-2)]" style={{ width: `${pct}%` }} />
        </div>
        {completing === s.id && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-secondary/60 p-2 text-xs">
            <span>{tr("Unfinished cards go to")}</span>
            <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="rounded-md border bg-background px-2 py-1">
              {open.filter((o) => o.id !== s.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              <option value="">{tr("the backlog")}</option>
            </select>
            <button
              onClick={async () => { if (await run(completeSprint(s.id, moveTo || null))) setCompleting(null); }}
              className="ml-auto rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground"
            >
              {tr("Complete")}
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <Modal title={tr("Sprints")} onClose={onClose}>
      {sprints.length === 0 && <p className="mb-3 text-xs text-muted-foreground">{tr("No sprints yet. Plan the next two weeks of work as a sprint.")}</p>}
      {open.length > 0 && <ul className="flex flex-col divide-y">{open.map(row)}</ul>}
      {!readOnly && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(saveSprint(projectId, name, start, end))) {
              setName(`Sprint ${sprints.length + 2}`);
              setStart(dateOfDay(dayNumber(end) + 1));
              setEnd(dateOfDay(dayNumber(end) + 14));
            }
          }}
          className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3 text-xs"
        >
          <label className="flex min-w-32 flex-1 flex-col gap-1">
            <span className="text-muted-foreground">{tr("New sprint")}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} className="rounded-md border bg-background px-2 py-1.5" />
          </label>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} required aria-label={tr("Start date")} className="rounded-md border bg-background px-2 py-1.5" />
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} required aria-label={tr("Due date")} className="rounded-md border bg-background px-2 py-1.5" />
          <button className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">{tr("Create sprint")}</button>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-[#ef4444]">{tr(error)}</p>}
      {closed.length > 0 && (
        <>
          <p className="mt-4 text-[11px] font-semibold text-muted-foreground">{tr("Completed sprints")}</p>
          <ul className="flex flex-col divide-y opacity-70">{closed.map(row)}</ul>
        </>
      )}
    </Modal>
  );
}
