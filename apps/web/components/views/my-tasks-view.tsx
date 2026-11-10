"use client";

import { PRIORITY_CFG, type Task } from "@/lib/board";
import { Assignees } from "../task-card";
import { useT } from "@/components/i18n";

export type MyTask = Task & { columnTitle: string; columnColor: string; projectName: string; projectId: string; done: boolean };

const overdue = (d: string | null) => !!d && d < new Date().toISOString().slice(0, 10);

export function MyTasksView({ tasks, onOpen }: { tasks: MyTask[]; onOpen: (id: string) => void }) {
  const tr = useT();
  if (tasks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-muted-foreground">
        {tr("Nothing is assigned to you.")}
      </div>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto">
      <ul className="mx-auto flex max-w-2xl flex-col gap-2 px-5 py-6">
        {tasks.map((t) => {
          const p = PRIORITY_CFG[t.priority];
          return (
            <li key={t.id}>
              <button
                onClick={() => onOpen(t.id)}
                className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-secondary"
              >
                <span className="size-2 shrink-0 rounded-full" style={{ background: t.columnColor }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t.projectName} · {t.columnTitle}
                    {t.label ? ` · ${t.label}` : ""}
                  </p>
                </div>
                {t.dueDate && (
                  <span className={`text-[11px] ${!t.done && overdue(t.dueDate) ? "font-medium text-[var(--chart-7)]" : "text-muted-foreground"}`}>
                    {t.dueDate}
                  </span>
                )}
                <span style={{ color: p.color, background: p.bg }} className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase">
                  {tr(p.label)}
                </span>
                <Assignees task={t} />
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
