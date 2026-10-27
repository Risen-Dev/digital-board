"use client";

import { useState } from "react";
import { bulkTasks } from "@/lib/actions";
import { PRIORITY_CFG, type Column, type Member, type Task } from "@/lib/board";
import { Assignees } from "../task-card";
import { useT } from "@/components/i18n";

export function ListView({ columns, members, readOnly, onOpen }: { columns: Column[]; members: Member[]; readOnly: boolean; onOpen: (t: Task) => void }) {
  const tr = useT();
  const rows = columns.flatMap((c) => c.tasks.map((t) => ({ task: t, column: c })));
  const [selected, setSelected] = useState(new Set<string>());
  const [busy, setBusy] = useState(false);
  // Ids that are still on screen; a filter change or another member's archive drops the rest.
  const picked = rows.filter((r) => selected.has(r.task.id)).map((r) => r.task.id);

  // One request: per-card calls from here stopped after the first, when its revalidation re-rendered the view.
  async function bulk(op: Parameters<typeof bulkTasks>[1]) {
    setBusy(true);
    await bulkTasks(picked, op);
    setBusy(false);
    setSelected(new Set());
  }
  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  if (rows.length === 0) return <Empty />;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {picked.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-secondary px-5 py-2 text-xs">
          <span className="font-medium">{picked.length} {tr("selected")}</span>
          <select
            value=""
            disabled={busy}
            aria-label={tr("Move selected to column")}
            onChange={(e) => void bulk({ move: e.target.value })}
            className="rounded-md border bg-background px-2 py-1"
          >
            <option value="">{tr("Move to…")}</option>
            {columns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <select
            value=""
            disabled={busy}
            aria-label={tr("Assign selected to")}
            onChange={(e) => void bulk({ assign: e.target.value })}
            className="rounded-md border bg-background px-2 py-1"
          >
            <option value="">{tr("Assign to…")}</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button
            disabled={busy}
            onClick={() => void bulk({ archive: true })}
            className="rounded-md border bg-background px-2 py-1 transition-colors hover:bg-card disabled:opacity-50"
          >
            {tr("Archive")}
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-muted-foreground hover:text-foreground">
            {tr("Clear")}
          </button>
          {busy && <span className="text-muted-foreground">{tr("Working…")}</span>}
        </div>
      )}
      <div className="flex-1 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background text-left text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr className="border-b">
            {!readOnly && (
              <th className="w-8 pl-5">
                <input
                  type="checkbox"
                  aria-label={tr("Select all")}
                  checked={picked.length === rows.length}
                  onChange={() => setSelected(picked.length === rows.length ? new Set() : new Set(rows.map((r) => r.task.id)))}
                />
              </th>
            )}
            <th className="px-5 py-2.5 font-semibold">{tr("Task")}</th>
            <th className="px-3 py-2.5 font-semibold">{tr("Status")}</th>
            <th className="px-3 py-2.5 font-semibold">{tr("Label")}</th>
            <th className="px-3 py-2.5 font-semibold">{tr("Priority")}</th>
            <th className="px-3 py-2.5 font-semibold">{tr("Due")}</th>
            <th className="px-3 py-2.5 font-semibold">{tr("Assignee")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ task, column }) => {
            const p = PRIORITY_CFG[task.priority];
            return (
              <tr
                key={task.id}
                data-task={task.id}
                onClick={() => onOpen(task)}
                className="cursor-pointer border-b transition-colors hover:bg-secondary"
              >
                {!readOnly && (
                  <td className="w-8 pl-5" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${task.title}`} checked={selected.has(task.id)} onChange={() => toggle(task.id)} />
                  </td>
                )}
                <td className="px-5 py-2.5 font-medium">{task.title}</td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="size-2 rounded-full" style={{ background: column.color }} />
                    {column.title}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">{task.label ?? "—"}</td>
                <td className="px-3 py-2.5">
                  <span style={{ color: p.color, background: p.bg }} className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase">
                    {tr(p.label)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">{task.dueDate ?? "—"}</td>
                <td className="px-3 py-2.5">
                  {task.assignees.length ? (
                    <span className="flex items-center gap-2 text-xs">
                      <Assignees task={task} />
                      {task.assignees.length === 1 && task.assignees[0].name}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function Empty() {
  const tr = useT();
  return (
    <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-muted-foreground">
      {tr("No tasks match.")}
    </div>
  );
}
