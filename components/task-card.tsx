"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays } from "lucide-react";
import { initials, PRIORITY_CFG, type Task } from "@/lib/board";
import type { TaskLinks } from "@/lib/github";
import { Avatar } from "./avatar";
import { PullBadge, primaryPull } from "./views/github-view";

export function TaskCard({ task, links, onOpen, overlay = false }: { task: Task; links?: TaskLinks; onOpen?: () => void; overlay?: boolean }) {
  const priority = PRIORITY_CFG[task.priority];
  const pull = primaryPull(links);
  return (
    <div
      onClick={onOpen}
      className={`group rounded-lg border bg-card p-3 shadow-sm transition-all ${
        overlay ? "rotate-1 cursor-grabbing shadow-lg" : "cursor-grab hover:-translate-y-px hover:shadow-md"
      }`}
    >
      {task.key && (
        <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="font-mono">{task.key}</span>
          {pull && <PullBadge pull={pull} />}
        </div>
      )}
      <p className="mb-2.5 text-sm font-medium leading-snug">{task.title}</p>
      {task.description && (
        <p className="mb-2.5 overflow-hidden whitespace-pre-line text-xs leading-relaxed text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]">
          {task.description}
        </p>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {task.label && (
          <span className="rounded border bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {task.label}
          </span>
        )}
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
        </div>
        {task.assignee && (
          <Avatar initials={initials(task.assignee.name)} color={task.assignee.color} size={22} />
        )}
      </div>
    </div>
  );
}

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
