"use client";

import { PRIORITY_CFG, type Priority } from "@/lib/board";

export type Stats = {
  byColumn: { title: string; color: string; n: number }[];
  byPriority: { priority: Priority; n: number }[];
  byAssignee: { name: string | null; color: string | null; n: number }[];
  activity14d: { day: string; n: number }[];
  total: number;
  /** Cards in the project's done column. */
  done: number;
};

/** Magnitude by category → horizontal bars, every bar directly labelled. */
function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{label}</span>
      <div className="flex h-2.5 flex-1 items-center">
        <div
          className="h-2.5 rounded-[4px]"
          style={{ background: color, width: max > 0 ? `${Math.max((value / max) * 100, value ? 2 : 0)}%` : 0 }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums">{value}</span>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function AnalyticsView({ stats }: { stats: Stats }) {
  const { done } = stats;
  const maxCol = Math.max(1, ...stats.byColumn.map((c) => c.n));
  const maxPerson = Math.max(1, ...stats.byAssignee.map((a) => a.n));
  const maxDay = Math.max(1, ...stats.activity14d.map((d) => d.n));

  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    const key = d.toISOString().slice(0, 10);
    return { key, n: stats.activity14d.find((a) => a.day === key)?.n ?? 0 };
  });

  if (stats.total === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-muted-foreground">
        No tasks yet. Analytics fills in as the board gets used.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Tile label="Total tasks" value={stats.total} />
          <Tile label="Completed" value={done} hint={`${Math.round((done / stats.total) * 100)}% of total`} />
          <Tile label="Outstanding" value={stats.total - done} />
          <Tile label="14-day activity" value={days.reduce((s, d) => s + d.n, 0)} hint="changes logged" />
        </div>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">Tasks per column</h2>
          {stats.byColumn.map((c) => (
            <BarRow key={c.title} label={c.title} value={c.n} max={maxCol} color={c.color} />
          ))}
        </section>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">Priority</h2>
          <div className="flex flex-wrap gap-2">
            {(["high", "medium", "low"] as Priority[]).map((p) => {
              const n = stats.byPriority.find((x) => x.priority === p)?.n ?? 0;
              const cfg = PRIORITY_CFG[p];
              return (
                <div key={p} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <span className="size-2 rounded-full" style={{ background: cfg.color }} />
                  <span className="text-xs text-muted-foreground">{cfg.label}</span>
                  <span className="text-sm font-semibold tabular-nums">{n}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">Workload per member</h2>
          {stats.byAssignee.map((a, i) => (
            <BarRow
              key={a.name ?? `none-${i}`}
              label={a.name ?? "Unassigned"}
              value={a.n}
              max={maxPerson}
              color={a.color ?? "var(--muted-foreground)"}
            />
          ))}
        </section>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-1 text-sm font-semibold">Last 14 days</h2>
          <p className="mb-4 text-[11px] text-muted-foreground">Task changes per day.</p>
          <div className="flex h-28 items-end gap-1.5">
            {days.map((d) => (
              <div key={d.key} className="flex flex-1 flex-col items-center gap-1.5" title={`${d.key}: ${d.n}`}>
                <span className="text-[10px] tabular-nums text-muted-foreground">{d.n || ""}</span>
                <div
                  className="w-full rounded-t-[4px] bg-[var(--chart-1)]"
                  style={{ height: `${(d.n / maxDay) * 100}%`, minHeight: d.n ? 3 : 1 }}
                />
                <span className="text-[9px] text-muted-foreground">{d.key.slice(8)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
