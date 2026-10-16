"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, CalendarClock, CheckCircle2, LayoutGrid, PenLine, Plus } from "lucide-react";
import { PRIORITY_CFG } from "@/lib/board";
import { renameProject } from "@/lib/actions";
import { EditableTitle } from "../editable-title";
import type { FeedItem, Project } from "@/lib/queries";
import type { Stats } from "./analytics-view";
import type { MyTask } from "./my-tasks-view";

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function HomeView({
  userName, project, columnCount, stats, mine, feed, today, onGo,
}: {
  userName: string;
  project: Project | null;
  columnCount: number;
  /** Server-supplied so "overdue" cannot differ between SSR and hydration. */
  today: string;
  stats: Stats | null;
  mine: MyTask[];
  feed: FeedItem[];
  onGo: (section: "board" | "canvas" | "mine" | "inbox") => void;
}) {
  const router = useRouter();
  const done = stats?.done ?? 0;
  const total = stats?.total ?? 0;
  const overdue = mine.filter((t) => !t.done && t.dueDate && t.dueDate < today).length;
  const dueToday = mine.filter((t) => !t.done && t.dueDate === today).length;
  const maxCol = Math.max(1, ...(stats?.byColumn.map((c) => c.n) ?? [1]));

  return (
    <main className="flex-1 overflow-y-auto p-5">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Hi, {userName.split(" ")[0]}</h1>
          {project ? (
            <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <span>Here&rsquo;s where</span>
              <EditableTitle
                value={project.name}
                onSave={(name) => renameProject(project.id, name).then((r) => { router.refresh(); return r; })}
                className="font-medium text-foreground"
                inputClassName="text-sm font-medium w-48"
              />
              <span>stands.</span>
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">No project yet.</p>
          )}
        </header>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Tile label="Assigned to you" value={mine.length} hint={dueToday ? `${dueToday} due today` : undefined} />
          <Tile label="Overdue" value={overdue} hint={overdue ? "needs attention" : "all clear"} />
          <Tile label="Completed" value={done} hint={total ? `${Math.round((done / total) * 100)}% of ${total}` : undefined} />
          <Tile label="Total tasks" value={total} />
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <section className="rounded-xl border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold">Progress by column</h2>
            {stats && stats.byColumn.length > 0 ? (
              stats.byColumn.map((c) => (
                <div key={c.title} className="flex items-center gap-3 py-1.5">
                  <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{c.title}</span>
                  <div className="flex h-2.5 flex-1 items-center">
                    <div
                      className="h-2.5 rounded-[4px]"
                      style={{ background: c.color, width: `${Math.max((c.n / maxCol) * 100, c.n ? 2 : 0)}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums">{c.n}</span>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                {columnCount === 0 ? "This board has no columns yet." : "No tasks yet."}
              </p>
            )}
            <button
              onClick={() => onGo("board")}
              className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3" />
              {columnCount === 0 ? "Add your first column" : "Add or rename columns"}
            </button>
          </section>

          <section className="rounded-xl border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold">Your next tasks</h2>
            {mine.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing assigned to you.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {mine.slice(0, 5).map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: t.columnColor }} />
                    <span className="min-w-0 flex-1 truncate text-xs">{t.title}</span>
                    {t.dueDate && (
                      <span className={`shrink-0 text-[11px] ${t.dueDate < today ? "text-[var(--chart-7)]" : "text-muted-foreground"}`}>
                        {t.dueDate}
                      </span>
                    )}
                    <span
                      style={{ color: PRIORITY_CFG[t.priority].color }}
                      className="shrink-0 text-[10px] font-medium uppercase"
                    >
                      {PRIORITY_CFG[t.priority].label}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {mine.length > 5 && (
              <button onClick={() => onGo("mine")} className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                See all {mine.length} <ArrowRight className="size-3" />
              </button>
            )}
          </section>
        </div>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">Recent activity</h2>
          {feed.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing has happened yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {feed.slice(0, 6).map((e, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: e.columnColor }} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{e.taskTitle}</span>
                    <span className="text-muted-foreground"> — {e.text}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {e.dayLabel}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {feed.length > 6 && (
            <button onClick={() => onGo("inbox")} className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              Open inbox <ArrowRight className="size-3" />
            </button>
          )}
        </section>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => onGo("board")} className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs transition-colors hover:bg-secondary">
            <LayoutGrid className="size-3.5" /> Open board
          </button>
          <button onClick={() => onGo("canvas")} className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs transition-colors hover:bg-secondary">
            <PenLine className="size-3.5" /> Open canvas
          </button>
          <button onClick={() => onGo("mine")} className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs transition-colors hover:bg-secondary">
            <CheckCircle2 className="size-3.5" /> My tasks
          </button>
          <button onClick={() => onGo("inbox")} className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs transition-colors hover:bg-secondary">
            <CalendarClock className="size-3.5" /> Activity
          </button>
        </div>
      </div>
    </main>
  );
}
