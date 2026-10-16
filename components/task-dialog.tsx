"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { Archive, Check, GitBranch, GitPullRequest, History, ListChecks, Trash2, X } from "lucide-react";
import { addComment, archiveTask, createTask, deleteTask, fetchHistory, setChecklist, updateTask } from "@/lib/actions";
import { branchNameOf, initials, PRIORITIES, PRIORITY_CFG, REPEATS, type CheckItem, type Column, type Entry, type Member, type Task } from "@/lib/board";
import { Avatar } from "./avatar";
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

  const loadHistory = useCallback(() => {
    if (task) fetchHistory(task.id).then(setHistory);
  }, [task]);
  useEffect(loadHistory, [loadHistory]);

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
            <Field label="Labels" name="label" defaultValue={task?.label ?? ""} placeholder="Design, QA" />
            <Select label="Priority" name="priority" defaultValue={task?.priority ?? "medium"}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_CFG[p].label}</option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Due date" name="dueDate" type="date" defaultValue={task?.dueDate ?? ""} />
            <Select label="Repeat" name="repeat" defaultValue={task?.repeat ?? ""}>
              <option value="">Never</option>
              {REPEATS.map((r) => (
                <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>
              ))}
            </Select>
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-xs font-medium">Assignees</legend>
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary">
                  <input type="checkbox" name="assigneeIds" value={m.id} defaultChecked={task?.assignees.some((a) => a.id === m.id)} className="sr-only" />
                  <Avatar initials={initials(m.name)} color={m.color} size={20} />
                  {m.name}
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">Repeating cards get their next copy when moved to the done column.</p>
          </fieldset>

          <FormError error={state?.error} />

          <div className="flex items-center gap-2">
            <SubmitButton>{editing ? "Save" : "Create task"}</SubmitButton>
            {editing && (
              <button
                type="button"
                onClick={async () => {
                  await archiveTask(task.id, true);
                  onClose();
                }}
                className="ml-auto flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Archive className="size-3.5" />
                Archive
              </button>
            )}
            {editing && (
              <button
                type="button"
                onClick={async () => {
                  if (!confirm(`Delete "${task.title}" and its history? Archive keeps it restorable.`)) return;
                  await deleteTask(task.id);
                  onClose();
                }}
                className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs text-[#ef4444] transition-colors hover:bg-[rgba(239,68,68,0.08)]"
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

        {editing && <Checklist key={task.id} taskId={task.id} initial={task.checklist} />}

        {editing && (
          <div className="shrink-0 border-t px-5 py-4">
            <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <History className="size-3.5" />
              Comments &amp; history
            </h3>
            <CommentBox taskId={task.id} onPosted={loadHistory} />
            <ol className="flex max-h-56 flex-col overflow-y-auto pr-1">
              {history.map((e, i) => (
                <li key={i} className="relative border-l pb-3 pl-4 last:pb-0">
                  <span className="absolute -left-[3.5px] top-1.5 size-1.5 rounded-full bg-muted-foreground" />
                  {e.kind === "comment" ? (
                    <p className="whitespace-pre-wrap rounded-md bg-secondary px-2.5 py-1.5 text-xs leading-snug">
                      <Mentions text={e.text} members={members} />
                    </p>
                  ) : (
                    <p className="text-xs leading-snug">{e.text}</p>
                  )}
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

/** Ticks save at once; there is no Save button for the checklist. */
function Checklist({ taskId, initial }: { taskId: string; initial: CheckItem[] }) {
  const [items, setItems] = useState(initial);
  const [draft, setDraft] = useState("");
  const save = (next: CheckItem[]) => {
    setItems(next);
    void setChecklist(taskId, next);
  };
  const done = items.filter((i) => i.done).length;
  return (
    <div className="shrink-0 border-t px-5 py-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <ListChecks className="size-3.5" />
        Checklist {items.length > 0 && `${done}/${items.length}`}
      </h3>
      <ul className="flex flex-col gap-1">
        {items.map((item, i) => (
          <li key={i} className="group flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={item.done}
              onChange={() => save(items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
              className="size-3.5 accent-[var(--primary)]"
            />
            <span className={`flex-1 ${item.done ? "text-muted-foreground line-through" : ""}`}>{item.text}</span>
            <button
              type="button"
              aria-label={`Remove ${item.text}`}
              onClick={() => save(items.filter((_, j) => j !== i))}
              className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus:opacity-100"
            >
              <X className="size-3" />
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) save([...items, { text: draft.trim(), done: false }]);
          setDraft("");
        }}
        className="mt-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add an item and press Enter"
          className="w-full rounded-md border bg-background px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-ring"
        />
      </form>
    </div>
  );
}

function CommentBox({ taskId, onPosted }: { taskId: string; onPosted: () => void }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const post = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    const result = await addComment(taskId, body);
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setBody("");
    setError(undefined);
    onPosted();
  };
  return (
    <div className="mb-4 flex flex-col gap-1.5">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void post();
        }}
        rows={2}
        placeholder="Write a comment. @Name mentions a member."
        className="resize-y rounded-md border bg-background px-3 py-2 text-xs outline-none transition-colors focus:border-ring"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void post()}
          disabled={!body.trim() || busy}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Comment
        </button>
        <span className="text-[11px] text-muted-foreground">Ctrl/⌘ + Enter</span>
        {error && <span className="text-[11px] text-[#ef4444]">{error}</span>}
      </div>
    </div>
  );
}

/** Highlights `@Full Name` for members; longest names first so "@Ada Lovelace" beats "@Ada". */
function Mentions({ text, members }: { text: string; members: Member[] }) {
  const names = members.map((m) => m.name).sort((a, b) => b.length - a.length);
  if (!names.length) return text;
  const re = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`, "g");
  return text.split(re).map((part, i) =>
    i % 2 ? <span key={i} className="font-semibold text-primary">{part}</span> : part,
  );
}
