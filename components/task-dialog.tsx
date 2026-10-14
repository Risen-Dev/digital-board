"use client";

import { useActionState, useEffect, useState } from "react";
import { Check, GitBranch, GitPullRequest, History, Trash2, X } from "lucide-react";
import { createTask, deleteTask, fetchHistory, updateTask } from "@/lib/actions";
import { branchNameOf, PRIORITIES, PRIORITY_CFG, type Column, type Entry, type Member, type Task } from "@/lib/board";
import type { TaskLinks } from "@/lib/github";
import { TaskGithubLinks } from "./views/github-view";
import { Field, FormError, Select, SubmitButton } from "./form-bits";

type Props = {
  task: Task | null;
  columns: Column[];
  members: Member[];
  defaultColumnId?: string;
  /** Linked PRs / branches / commits, when the project has a GitHub repo. */
  links?: TaskLinks;
  onClose: () => void;
};

export function TaskDialog({ task, columns, members, defaultColumnId, links, onClose }: Props) {
  const editing = task !== null;
  const [state, action] = useActionState(editing ? updateTask : createTask, null);
  const [history, setHistory] = useState<Entry[]>([]);
  const [copied, setCopied] = useState(false);
  const linked = links ? links.pulls.length + links.branches.length + links.commits.length : 0;

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  useEffect(() => {
    if (task) fetchHistory(task.id).then(setHistory);
  }, [task]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6 animate-in fade-in duration-150" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="mt-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-card shadow-lg animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-200"
      >
        <div className="flex shrink-0 items-center gap-2 border-b px-5 py-3">
          <h2 className="text-sm font-semibold">{editing ? "Edit task" : "New task"}</h2>
          {task?.key && <span className="font-mono text-xs text-muted-foreground">{task.key}</span>}
          {task?.key && (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(branchNameOf(task)).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              title={branchNameOf(task)}
              className="ml-auto flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {copied ? <Check className="size-3" /> : <GitBranch className="size-3" />}
              {copied ? "Copied" : "Copy branch name"}
            </button>
          )}
          <button
            onClick={onClose}
            className={`${task?.key ? "" : "ml-auto "}rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground`}
          >
            <X className="size-4" />
          </button>
        </div>

        <form action={action} className="flex flex-col gap-4 overflow-y-auto p-5">
          {editing && <input type="hidden" name="id" value={task.id} />}
          <Field label="Title" name="title" required defaultValue={task?.title ?? ""} autoFocus />
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Details</span>
            <textarea
              name="description"
              defaultValue={task?.description ?? ""}
              rows={4}
              placeholder="Add task details"
              className="resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-ring"
            />
          </label>

          {!editing && (
            <Select label="Column" name="columnId" defaultValue={defaultColumnId ?? columns[0]?.id}>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </Select>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Label" name="label" defaultValue={task?.label ?? ""} placeholder="Design" />
            <Select label="Priority" name="priority" defaultValue={task?.priority ?? "medium"}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_CFG[p].label}</option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Due date" name="dueDate" type="date" defaultValue={task?.dueDate ?? ""} />
            <Select label="Assignee" name="assigneeId" defaultValue={task?.assignee?.id ?? ""}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </div>

          <FormError error={state?.error} />

          <div className="flex items-center gap-2">
            <SubmitButton>{editing ? "Save" : "Create task"}</SubmitButton>
            {editing && (
              <button
                type="button"
                onClick={async () => {
                  await deleteTask(task.id);
                  onClose();
                }}
                className="ml-auto flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs text-[#ef4444] transition-colors hover:bg-[rgba(239,68,68,0.08)]"
              >
                <Trash2 className="size-3.5" />
                Delete
              </button>
            )}
          </div>
        </form>

        {links && linked > 0 && (
          <div className="shrink-0 border-t px-5 py-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <GitPullRequest className="size-3.5" />
              GitHub
            </h3>
            <div className="max-h-40 overflow-y-auto">
              <TaskGithubLinks links={links} />
            </div>
          </div>
        )}

        {editing && (
          <div className="shrink-0 border-t px-5 py-4">
            <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <History className="size-3.5" />
              History
            </h3>
            <ol className="flex max-h-56 flex-col overflow-y-auto pr-1">
              {history.map((e, i) => (
                <li key={i} className="relative border-l pb-3 pl-4 last:pb-0">
                  <span className="absolute -left-[3.5px] top-1.5 size-1.5 rounded-full bg-muted-foreground" />
                  <p className="text-xs leading-snug">{e.text}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {e.atLabel} {e.actor ? `· ${e.actor}` : ""}
                  </p>
                </li>
              ))}
              {history.length === 0 && <li className="text-xs text-muted-foreground">No history yet.</li>}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
