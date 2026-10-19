"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays, ListChecks, MessageSquare, Repeat } from "lucide-react";
import { initials, labelsOf, PRIORITY_CFG, type Task } from "@/lib/board";
import type { TaskLinks } from "@/lib/github";
import { Avatar } from "./avatar";
import { PullBadge, primaryIssue, primaryPull } from "./views/github-view";

export function TaskCard({ task, links, onOpen, overlay = false }: { task: Task; links?: TaskLinks; onOpen?: () => void; overlay?: boolean }) {
  const priority = PRIORITY_CFG[task.priority];
  const pull = primaryPull(links);
  const issue = pull ? undefined : primaryIssue(links);
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
      <p className="mb-2.5 text-sm font-medium leading-snug">{task.title}</p>
      {task.description && (
        <p className="mb-2.5 overflow-hidden whitespace-pre-line text-xs leading-relaxed text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]">
          {task.description}
        </p>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {labelsOf(task.label).map((l) => (
          <span key={l} className="rounded border bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {l}
          </span>
        ))}
        <span
          style={{ color: priority.color, background: priority.bg }}
          className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
        >
          {priority.label}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
          {task.dueDate && (
            <span className="flex items-center gap-1">
              <CalendarDays className="size-3" />
              {task.dueDate}
            </span>
          )}
          {task.repeat && <Repeat className="size-3" aria-label={`Repeats ${task.repeat}`} />}
          {task.checklist.length > 0 && (
            <span className="flex items-center gap-1">
              <ListChecks className="size-3" />
              {task.checklist.filter((i) => i.done).length}/{task.checklist.length}
            </span>
          )}
          {task.comments > 0 && (
            <span className="flex items-center gap-1">
              <MessageSquare className="size-3" />
              {task.comments}
            </span>
          )}
        </div>
        <Assignees task={task} />
      </div>
    </div>
  );
}

export const imageUrl = (taskId: string, imageId: string) => `/api/tasks/${taskId}/images/${imageId}`;

export function SortableTaskCard({ task, links, onOpen }: { task: Task; links?: TaskLinks; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? "opacity-40" : undefined}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} links={links} onOpen={onOpen} />
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
