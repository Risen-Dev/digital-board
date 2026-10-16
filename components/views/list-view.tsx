"use client";

import { PRIORITY_CFG, type Column, type Task } from "@/lib/board";
import { Assignees } from "../task-card";

export function ListView({ columns, onOpen }: { columns: Column[]; onOpen: (t: Task) => void }) {
  const rows = columns.flatMap((c) => c.tasks.map((t) => ({ task: t, column: c })));

  if (rows.length === 0) return <Empty />;

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background text-left text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr className="border-b">
            <th className="px-5 py-2.5 font-semibold">Task</th>
            <th className="px-3 py-2.5 font-semibold">Status</th>
            <th className="px-3 py-2.5 font-semibold">Label</th>
            <th className="px-3 py-2.5 font-semibold">Priority</th>
            <th className="px-3 py-2.5 font-semibold">Due</th>
            <th className="px-3 py-2.5 font-semibold">Assignee</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ task, column }) => {
            const p = PRIORITY_CFG[task.priority];
            return (
              <tr
                key={task.id}
                onClick={() => onOpen(task)}
                className="cursor-pointer border-b transition-colors hover:bg-secondary"
              >
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
                    {p.label}
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
  );
}

function Empty() {
  return (
    <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-muted-foreground">
      No tasks match.
    </div>
  );
}
