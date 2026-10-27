"use client";

import { dateOfDay, timelineOf, type Column, type Task } from "@/lib/board";
import { MONTHS } from "@/lib/format";
import { useT } from "@/components/i18n";

const DAY = 28;
const ROW = 36;
const LEFT = 260;
const HEAD = 44;

/**
 * Gantt-style timeline: a bar per dated card from its start to its due date, in
 * its column's colour, with an arrow from each card it waits on (red when it is
 * scheduled to start before that card is due). Click a bar or title to open it.
 */
export function TimelineView({ columns, doneColumnId, today, onOpen }: {
  columns: Column[];
  doneColumnId: string | null;
  today: string;
  onOpen: (t: Task) => void;
}) {
  const tr = useT();
  const doneId = doneColumnId ?? columns.at(-1)?.id;
  const colour = new Map(columns.map((c) => [c.id, c.color]));
  const tl = timelineOf(columns.flatMap((c) => c.tasks), today);
  const rowOf = new Map(tl.rows.map((r, i) => [r.task.id, i]));
  const days = Array.from({ length: tl.days }, (_, i) => dateOfDay(tl.from + i));
  const x = (day: number) => (day - tl.from) * DAY;

  if (!tl.rows.length) {
    return <main className="flex-1 p-5 text-sm text-muted-foreground">{tr("No dated cards yet. Give cards a start or due date to see them here.")}</main>;
  }

  // Waits-on arrows: from the end of the blocker's bar to the start of this card's.
  const arrows = tl.rows.flatMap((r, i) => r.task.blockedBy.flatMap((b) => {
    const j = rowOf.get(b.id);
    if (j === undefined) return [];
    const blocker = tl.rows[j];
    return [{ key: `${b.id}-${r.task.id}`, x1: x(blocker.end + 1), y1: j * ROW + ROW / 2, x2: x(r.start), y2: i * ROW + ROW / 2, late: r.start <= blocker.end, by: blocker.task.key }];
  }));

  return (
    <main className="flex-1 overflow-auto">
      <div className="relative" style={{ width: LEFT + tl.days * DAY, minHeight: "100%" }}>
        {/* Day header */}
        <div className="sticky top-0 z-20 flex border-b bg-background" style={{ height: HEAD }}>
          <div className="sticky left-0 z-10 flex shrink-0 items-end border-r bg-background px-4 pb-1.5 text-xs font-semibold text-muted-foreground" style={{ width: LEFT }}>
            {tr("Timeline")}
          </div>
          {days.map((d, i) => {
            const date = new Date(`${d}T00:00:00Z`);
            const weekend = date.getUTCDay() % 6 === 0;
            return (
              <div key={d} className={`relative shrink-0 border-r text-center text-[10px] ${weekend ? "bg-secondary/60 text-muted-foreground" : "text-muted-foreground"}`} style={{ width: DAY }}>
                {(i === 0 || date.getUTCDate() === 1) && (
                  <span className="absolute left-1 top-1 whitespace-nowrap font-semibold text-foreground">{MONTHS[date.getUTCMonth()]} {date.getUTCFullYear()}</span>
                )}
                <span className={`absolute inset-x-0 bottom-1.5 ${d === today ? "font-bold text-[#ef4444]" : ""}`}>{date.getUTCDate()}</span>
              </div>
            );
          })}
        </div>

        {/* Weekend shading and today, behind the rows */}
        <div className="pointer-events-none absolute bottom-0 flex" style={{ top: HEAD, left: LEFT }}>
          {days.map((d) => (
            <div key={d} className={`shrink-0 border-r border-border/40 ${new Date(`${d}T00:00:00Z`).getUTCDay() % 6 === 0 ? "bg-secondary/40" : ""}`} style={{ width: DAY }} />
          ))}
        </div>
        <div className="pointer-events-none absolute bottom-0 z-10 w-px bg-[#ef4444]" style={{ top: HEAD, left: LEFT + x(tl.today) + DAY / 2 }} title={tr("Today")} />

        {/* Rows */}
        {tl.rows.map(({ task, start, end }) => {
          const done = task.columnId === doneId;
          return (
            <div key={task.id} className="relative flex border-b border-border/60" style={{ height: ROW }}>
              <button
                onClick={() => onOpen(task)}
                className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r bg-background px-4 text-left text-xs hover:bg-secondary"
                style={{ width: LEFT }}
              >
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{task.key}</span>
                <span className={`truncate ${done ? "text-muted-foreground line-through" : ""}`}>{task.title}</span>
              </button>
              <button
                onClick={() => onOpen(task)}
                title={`${task.title} · ${dateOfDay(start)} → ${dateOfDay(end)}`}
                className={`absolute top-1.5 z-10 flex items-center overflow-hidden rounded-md px-2 text-[11px] font-medium text-white shadow-sm transition-opacity hover:opacity-90 ${done ? "opacity-50" : ""}`}
                style={{ left: LEFT + x(start) + 2, width: (end - start + 1) * DAY - 4, height: ROW - 12, background: colour.get(task.columnId) }}
              >
                <span className="truncate">{task.title}</span>
              </button>
            </div>
          );
        })}

        {/* Dependency arrows */}
        <svg className="pointer-events-none absolute z-10 overflow-visible" style={{ top: HEAD, left: LEFT }} width={tl.days * DAY} height={tl.rows.length * ROW} aria-hidden>
          <defs>
            <marker id="tl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="var(--muted-foreground)" /></marker>
            <marker id="tl-arrow-late" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#ef4444" /></marker>
          </defs>
          {arrows.map((a) => {
            const bend = Math.max(a.x1 + 6, Math.min(a.x2 - 6, a.x1 + 12));
            return (
              <path
                key={a.key}
                d={`M${a.x1} ${a.y1} H${bend} V${a.y2} H${a.x2}`}
                fill="none"
                stroke={a.late ? "#ef4444" : "var(--muted-foreground)"}
                strokeWidth={1.5}
                markerEnd={`url(#${a.late ? "tl-arrow-late" : "tl-arrow"})`}
              >
                {a.late && <title>{tr("Starts before {key} is done", { key: a.by ?? "" })}</title>}
              </path>
            );
          })}
        </svg>

        {tl.undated > 0 && (
          <p className="sticky left-0 px-4 py-3 text-xs text-muted-foreground" style={{ width: LEFT * 2 }}>
            {tr("{n} card(s) without dates are not on the timeline.", { n: tl.undated })}
          </p>
        )}
      </div>
    </main>
  );
}
