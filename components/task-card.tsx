"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlignLeft, Ban, CalendarDays, Flag, ListChecks, MessageSquare, Paperclip, Clock, Repeat, Tag, Timer } from "lucide-react";
import { formatDuration, initials, labelsOf, PRIORITY_CFG, type CustomField, type Task } from "@/lib/board";
import type { TaskLinks } from "@/lib/github";
import { Avatar } from "./avatar";
import { PullBadge, primaryIssue, primaryPull } from "./views/github-view";
import { useT } from "@/components/i18n";

/**
 * `stageLimit`: the column's day limit (null = none) to show the stage timer;
 * left out (done column) hides it.
 */
export function TaskCard({ task, links, onOpen, overdue = false, overlay = false, stageLimit, fields = [] }: { task: Task; links?: TaskLinks; onOpen?: () => void; overdue?: boolean; overlay?: boolean; stageLimit?: number | null; fields?: CustomField[] }) {
  const tr = useT();
  const priority = PRIORITY_CFG[task.priority];
  const pull = primaryPull(links);
  const issue = pull ? undefined : primaryIssue(links);
  const labels = labelsOf(task.label);
  const waiting = task.blockedBy.filter((b) => !b.done).length;
  // The first two custom fields this card has a value for.
  const custom = fields.filter((f) => task.fields[f.id]).slice(0, 2);
  // No limit: only once a card has sat a day. With one: a countdown, red once over.
  const stage = stageLimit === undefined || (stageLimit === null && task.stageDays < 1) ? null
    : stageLimit === null ? { text: tr("{n}d", { n: task.stageDays }), over: false }
    : task.stageDays > stageLimit ? { text: tr("{n}d over", { n: task.stageDays - stageLimit }), over: true }
    : { text: tr("{n}d left", { n: stageLimit - task.stageDays }), over: false };
  return (
    <div
      onClick={onOpen}
      className={`group overflow-hidden rounded-lg border bg-card p-3 shadow-sm transition-all ${
        overlay ? "rotate-1 cursor-grabbing shadow-lg" : "cursor-grab hover:-translate-y-px hover:shadow-md"
      }`}
    >
      {task.images[0] && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl(task.id, task.images[0].id)}
          alt=""
          draggable={false}
          className="-mx-3 -mt-3 mb-3 block max-h-48 w-[calc(100%+1.5rem)] max-w-none bg-secondary object-cover"
        />
      )}
      {task.key && (
        <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="font-mono">{task.key}</span>
          {pull && <PullBadge pull={pull} />}
          {issue && <PullBadge pull={issue} kind="issues" />}
        </div>
      )}
      <p className="mb-2 line-clamp-2 text-sm font-medium leading-snug">{task.title}</p>
      {(stage || task.timing || task.trackedSeconds >= 60 || waiting > 0 || task.description || task.checklist.length > 0 || task.comments > 0 || task.images.length > 0 || task.repeat) && (
        <div className="mb-2 flex items-center gap-2.5 text-[11px] text-muted-foreground">
          {waiting > 0 && (
            <span className="flex items-center gap-1 font-medium text-[var(--chart-7)]" title={tr(waiting === 1 ? "Waiting on {n} card" : "Waiting on {n} cards", { n: waiting })}>
              <Ban className="size-3.5" />
              {tr("Blocked")}
            </span>
          )}
          {stage && (
            <span
              className={`flex items-center gap-1 ${stage.over ? "font-medium text-[var(--chart-7)]" : ""}`}
              title={tr(task.stageDays === 1 ? "{n} day in this column" : "{n} days in this column", { n: task.stageDays })}
            >
              <Timer className="size-3.5" />
              {stage.text}
            </span>
          )}
          {(task.timing || task.trackedSeconds >= 60) && (
            <span className="flex items-center gap-1" title={tr(task.timing ? "Timer running" : "Time logged")}>
              {task.timing ? <span className="size-1.5 animate-pulse rounded-full bg-[var(--chart-2)]" /> : <Clock className="size-3.5" />}
              {formatDuration(task.trackedSeconds)}
            </span>
          )}
          {task.description && <AlignLeft className="size-3.5" aria-label={tr("Has description")} />}
          {task.checklist.length > 0 && (
            <span className="flex items-center gap-1">
              <ListChecks className="size-3.5" />
              {task.checklist.filter((i) => i.done).length}/{task.checklist.length}
            </span>
          )}
          {task.comments > 0 && (
            <span className="flex items-center gap-1">
              <MessageSquare className="size-3.5" />
              {task.comments}
            </span>
          )}
          {task.images.length > 0 && (
            <span className="flex items-center gap-1">
              <Paperclip className="size-3.5" />
              {task.images.length}
            </span>
          )}
          {task.repeat && <Repeat className="size-3.5" aria-label={`Repeats ${task.repeat}`} />}
        </div>
      )}
      {(task.assignees.length > 0 || task.dueDate) && (
        <div className="mb-2 flex items-center gap-2">
          <Assignees task={task} />
          {task.dueDate && (
            <span className={`flex items-center gap-1 text-xs ${overdue ? "font-medium text-[var(--chart-7)]" : "text-muted-foreground"}`}>
              <CalendarDays className="size-3.5" />
              {shortDate(task.dueDate)}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-1.5 text-xs">
        <Flag className="size-3.5" style={{ color: priority.color, fill: priority.color }} />
        {tr(priority.label)}
      </div>
      {labels.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5">
          <Tag className="size-3.5 shrink-0 text-muted-foreground" />
          {labels.slice(0, 2).map((l) => (
            <span key={l} className="max-w-24 truncate rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {l}
            </span>
          ))}
          {labels.length > 2 && <span className="text-[10px] text-muted-foreground" title={labels.slice(2).join(", ")}>+{labels.length - 2}</span>}
        </div>
      )}
      {custom.length > 0 && (
        <div className="mt-2 flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          {custom.map((f) => (
            <span key={f.id} className="truncate">
              {f.name}: <span className="text-foreground">{f.type === "date" ? shortDate(task.fields[f.id]) : task.fields[f.id]}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09-04" → "Sep 4". Split, not `new Date`, so no timezone shifts the day. */
const shortDate = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

export const imageUrl = (taskId: string, imageId: string) => `/api/tasks/${taskId}/images/${imageId}`;

export function SortableTaskCard({ task, links, overdue, stageLimit, fields, onOpen }: { task: Task; links?: TaskLinks; overdue?: boolean; stageLimit?: number | null; fields?: CustomField[]; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? "opacity-40" : undefined}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} links={links} overdue={overdue} stageLimit={stageLimit} fields={fields} onOpen={onOpen} />
    </div>
  );
}

/** Overlapping avatars, at most three plus a count. */
export function Assignees({ task }: { task: Task }) {
  if (!task.assignees.length) return null;
  return (
    <div className="flex -space-x-1.5" title={task.assignees.map((a) => a.name).join(", ")}>
      {task.assignees.slice(0, 3).map((a) => (
        <span key={a.id} className="rounded-full ring-2 ring-card">
          <Avatar initials={initials(a.name)} color={a.color} size={22} />
        </span>
      ))}
      {task.assignees.length > 3 && (
        <span className="flex size-[22px] items-center justify-center rounded-full bg-secondary text-[9px] font-medium ring-2 ring-card">
          +{task.assignees.length - 3}
        </span>
      )}
    </div>
  );
}
