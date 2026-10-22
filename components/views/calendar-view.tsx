"use client";

import { useState, useTransition } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { calendarFeedToken } from "@/lib/actions";
import { PRIORITY_CFG, type Column, type Task } from "@/lib/board";
import { useT } from "@/components/i18n";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function CalendarView({ columns, projectId, onOpen }: { columns: Column[]; projectId: string; onOpen: (t: Task) => void }) {
  const tr = useT();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const tasks = columns.flatMap((c) => c.tasks.filter((t) => t.dueDate));
  const undated = columns.flatMap((c) => c.tasks.filter((t) => !t.dueDate)).length;

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7)); // weeks start Monday
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const today = iso(new Date());

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b px-5 py-2.5">
        <button
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-40 text-sm font-semibold">
          {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <button
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ChevronRight className="size-4" />
        </button>
        <div className="ml-auto flex items-center gap-3">
          {undated > 0 && <span className="text-xs text-muted-foreground">{undated} {tr("tasks with no due date")}</span>}
          <Subscribe key={projectId} projectId={projectId} />
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-7 border-b text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="px-2 py-2 text-center">{d}</div>
        ))}
      </div>

      <div className="grid flex-1 grid-cols-7 overflow-auto">
        {days.map((d) => {
          const key = iso(d);
          const dayTasks = tasks.filter((t) => t.dueDate === key);
          const outside = d.getMonth() !== month.getMonth();
          return (
            <div key={key} className={`min-h-24 border-b border-r p-1.5 ${outside ? "bg-secondary/40" : ""}`}>
              <div
                className={`mb-1 inline-flex size-5 items-center justify-center rounded-full text-[11px] ${
                  key === today ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {d.getDate()}
              </div>
              <div className="flex flex-col gap-1">
                {dayTasks.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onOpen(t)}
                    style={{ borderLeftColor: PRIORITY_CFG[t.priority].color }}
                    className="truncate rounded border border-l-2 bg-card px-1.5 py-1 text-left text-[11px] leading-tight transition-colors hover:bg-secondary"
                  >
                    {t.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The project's iCal link, for Google Calendar, Apple Calendar or Outlook to subscribe to. */
function Subscribe({ projectId }: { projectId: string }) {
  const tr = useT();
  const [feed, setFeed] = useState<{ token?: string; error?: string } | null>(null);
  const [busy, startBusy] = useTransition();
  const load = (reset = false) => startBusy(async () => setFeed(await calendarFeedToken(projectId, reset)));
  const url = feed?.token && `${window.location.origin}/api/integrations/ical?project=${projectId}&token=${feed.token}`;

  return (
    <div className="relative">
      <button
        onClick={() => (feed ? setFeed(null) : load())}
        className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <CalendarPlus className="size-3.5" /> {tr("Subscribe")}
      </button>
      {feed && (
        <div className="absolute right-0 top-full z-20 mt-1.5 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg border bg-popover p-3 shadow-lg">
          {feed.error ? (
            <p className="text-xs text-[var(--chart-7)]">{feed.error}</p>
          ) : url ? (
            <>
              <p className="text-[11px] text-muted-foreground">
                {tr("Add this link to your calendar app (Google Calendar: Other calendars → From URL). Tasks with a due date show as all-day events. Anyone with the link can see them.")}
              </p>
              <div className="flex gap-1.5">
                <input readOnly value={url} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 font-mono text-[11px]" />
                <button onClick={() => void navigator.clipboard.writeText(url)} className="rounded-md border px-2 text-[11px] text-muted-foreground hover:bg-secondary">
                  {tr("Copy")}
                </button>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <a href={url.replace(/^https?:/, "webcal:")} className="underline">{tr("Open in calendar app")}</a>
                <button
                  disabled={busy}
                  onClick={() => confirm(tr("Make a new link? Calendars using the old one stop updating.")) && load(true)}
                  className="text-muted-foreground underline disabled:opacity-50"
                >
                  {tr("Reset link")}
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
