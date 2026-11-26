"use client";

import { useEffect, useMemo, useState } from "react";
import { PRIORITIES, PRIORITY_CFG, type Task } from "@/lib/board";
import { Assignees } from "../task-card";
import { useT } from "@/components/i18n";

export type MyTask = Task & { columnTitle: string; columnColor: string; projectName: string; projectId: string; done: boolean };

const GROUPS = ["status", "project", "due", "priority", "none"] as const;
type Group = (typeof GROUPS)[number];
const GROUP_LABEL: Record<Group, string> = { status: "Status", project: "Project", due: "Due date", priority: "Priority", none: "No grouping" };

type Section = { key: string; title: string; color?: string; tasks: MyTask[] };

/** Local YYYY-MM-DD, so "today" follows the user's clock rather than UTC. */
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function sectionsOf(tasks: MyTask[], group: Group, tr: ReturnType<typeof useT>): Section[] {
  if (group === "none") return [{ key: "all", title: "", tasks }];
  const map = new Map<string, Section>();
  const put = (key: string, title: string, t: MyTask, color?: string) => {
    if (!map.has(key)) map.set(key, { key, title, color, tasks: [] });
    map.get(key)!.tasks.push(t);
  };
  const today = localDay(new Date());
  const week = localDay(new Date(Date.now() + 7 * 864e5));
  for (const t of tasks) {
    if (group === "status") put(`${t.done ? 1 : 0}:${t.columnTitle.toLowerCase()}`, t.columnTitle, t, t.columnColor);
    else if (group === "project") put(t.projectId, t.projectName, t);
    else if (group === "priority") put(t.priority, tr(PRIORITY_CFG[t.priority].label), t, PRIORITY_CFG[t.priority].color);
    else if (t.done) put("5", tr("Done"), t);
    else if (!t.dueDate) put("4", tr("No due date"), t);
    else if (t.dueDate < today) put("0", tr("Overdue"), t, "var(--destructive)");
    else if (t.dueDate === today) put("1", tr("Today"), t);
    else if (t.dueDate <= week) put("2", tr("Next 7 days"), t);
    else put("3", tr("Later"), t);
  }
  const all = [...map.values()];
  // Status: open columns first, in the order they first appear (board order), done columns last.
  if (group === "status") return all.sort((a, b) => Number(a.key[0]) - Number(b.key[0]));
  if (group === "project") return all.sort((a, b) => a.title.localeCompare(b.title));
  if (group === "priority") return all.sort((a, b) => PRIORITIES.indexOf(b.key as never) - PRIORITIES.indexOf(a.key as never));
  return all.sort((a, b) => a.key.localeCompare(b.key));
}

/** Remembered per browser; a blocked storage just means the defaults every visit. */
function useStored<T extends string>(key: string, fallback: T, valid: (v: string) => boolean) {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    try {
      const v = localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after mount; storage isn't available during SSR
      if (v && valid(v)) setValue(v as T);
    } catch {}
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (v: T) => {
    setValue(v);
    try { localStorage.setItem(key, v); } catch {}
  };
  return [value, set] as const;
}

export function MyTasksView({ tasks, onOpen }: { tasks: MyTask[]; onOpen: (task: MyTask) => void }) {
  const tr = useT();
  const projects = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; count: number }>();
    for (const t of tasks) {
      const p = seen.get(t.projectId) ?? { id: t.projectId, name: t.projectName, count: 0 };
      p.count++;
      seen.set(t.projectId, p);
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);
  const [group, setGroup] = useStored<Group>("my-tasks-group", "status", (v) => (GROUPS as readonly string[]).includes(v));
  const [projectId, setProjectId] = useStored<string>("my-tasks-project", "", () => true);
  // A remembered project the user no longer has tasks in falls back to all.
  const project = projects.some((p) => p.id === projectId) ? projectId : "";
  const shown = project ? tasks.filter((t) => t.projectId === project) : tasks;
  const sections = sectionsOf(shown, project && group === "project" ? "status" : group, tr);

  if (tasks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-muted-foreground">
        {tr("Nothing is assigned to you.")}
      </div>
    );
  }

  const select = "rounded-md border bg-background px-2 py-1 text-xs";
  return (
    <main className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col px-5 pb-10">
        <div className="sticky top-0 z-10 -mx-5 flex flex-wrap items-center gap-2 border-b bg-background/95 px-5 py-3 backdrop-blur-sm">
          <select value={project} onChange={(e) => setProjectId(e.target.value)} aria-label={tr("Project")} className={select}>
            <option value="">{tr("All projects")} ({tasks.length})</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.count})</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {tr("Group by")}
            <select value={group} onChange={(e) => setGroup(e.target.value as Group)} className={`${select} text-foreground`}>
              {GROUPS.filter((g) => !(project && g === "project")).map((g) => (
                <option key={g} value={g}>{tr(GROUP_LABEL[g])}</option>
              ))}
            </select>
          </label>
        </div>

        {sections.map((s) => (
          <section key={s.key} className="mt-6 first-of-type:mt-5" aria-label={s.title || undefined}>
            {s.title && (
              <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold">
                {s.color && <span className="size-2 rounded-full" style={{ background: s.color }} />}
                {s.title}
                <span className="font-normal tabular-nums text-muted-foreground">{s.tasks.length}</span>
              </h2>
            )}
            <ul className="flex flex-col gap-2">
              {s.tasks.map((t) => (
                <Row key={t.id} task={t} group={group} oneProject={!!project} onOpen={onOpen} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}

/** The meta line leaves out whatever the section heading already says. */
function Row({ task: t, group, oneProject, onOpen }: { task: MyTask; group: Group; oneProject: boolean; onOpen: (task: MyTask) => void }) {
  const tr = useT();
  const p = PRIORITY_CFG[t.priority];
  const late = !t.done && !!t.dueDate && t.dueDate < localDay(new Date());
  const meta = [
    !oneProject && group !== "project" && t.projectName,
    group !== "status" && t.columnTitle,
    t.label,
  ].filter(Boolean).join(" · ");
  return (
    <li>
      <button
        onClick={() => onOpen(t)}
        className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-secondary"
      >
        <span className="size-2 shrink-0 rounded-full" style={{ background: t.columnColor }} />
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm font-medium ${t.done ? "text-muted-foreground line-through" : ""}`}>{t.title}</p>
          {meta && <p className="truncate text-[11px] text-muted-foreground">{meta}</p>}
        </div>
        {t.dueDate && (
          <span className={`shrink-0 text-[11px] tabular-nums ${late ? "font-medium text-destructive" : "text-muted-foreground"}`}>
            {t.dueDate}
          </span>
        )}
        {group !== "priority" && (
          <span style={{ color: p.color, background: p.bg }} className="hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase sm:inline">
            {tr(p.label)}
          </span>
        )}
        {/* Phones keep the title readable; priority and co-assignees are a tap away. */}
        <span className="hidden sm:contents"><Assignees task={t} /></span>
      </button>
    </li>
  );
}
