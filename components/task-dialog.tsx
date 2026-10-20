"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlignLeft, Archive, CalendarDays, Check, CircleDot, Flag, GitBranch, GitPullRequest, History, Image as ImageIcon, ImagePlus, ListChecks, Repeat, Sparkles, Tag, Trash2, Users, X, type LucideIcon } from "lucide-react";
import { addComment, archiveTask, askCardAgent, createGithubIssue, createTask, deleteTask, fetchHistory, setChecklist, updateTask } from "@/lib/actions";
import { branchNameOf, initials, pullRequestUrlOf, PRIORITIES, PRIORITY_CFG, REPEATS, type CheckItem, type Column, type Entry, type Member, type Task, type TaskImage } from "@/lib/board";
import { Avatar } from "./avatar";
import { imageUrl } from "./task-card";
import type { TaskLinks } from "@/lib/github";
import { TaskGithubLinks } from "./views/github-view";
import { FormError, SubmitButton } from "./form-bits";

type Props = {
  task: Task | null;
  columns: Column[];
  members: Member[];
  /** Who can open this project, offered when typing "@" in a comment. */
  mentionable: Member[];
  defaultColumnId?: string;
  /** Linked PRs / branches / commits, when the project has a GitHub repo. */
  links?: TaskLinks;
  /** The project's GitHub repo ("owner/name"), for the create issue / PR buttons. */
  repo?: string | null;
  onClose: () => void;
};

export function TaskDialog({ task, columns, members, mentionable, defaultColumnId, links, repo, onClose }: Props) {
  const editing = task !== null;
  const [state, action] = useActionState(editing ? updateTask : createTask, null);
  const [history, setHistory] = useState<Entry[]>([]);
  const [copied, setCopied] = useState(false);
  const linked = links ? links.pulls.length + links.issues.length + links.branches.length + links.commits.length : 0;
  const column = columns.find((c) => c.id === task?.columnId);

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  const loadHistory = useCallback(() => {
    if (task) fetchHistory(task.id).then(setHistory);
  }, [task]);
  useEffect(loadHistory, [loadHistory]);
  // Oldest at the top, like a chat: keep the newest comment in view.
  const feed = useRef<HTMLOListElement>(null);
  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight });
  }, [history]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 animate-in fade-in duration-150 sm:p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl border bg-card shadow-lg animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-200 sm:mt-6 ${editing ? "max-w-5xl md:h-[90vh]" : "max-w-2xl"}`}
      >
        <div className="flex shrink-0 items-center gap-2 border-b px-5 py-2.5 text-xs text-muted-foreground">
          {column && (
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: column.color }} />
              {column.title}
            </span>
          )}
          {task?.key && <span className="font-mono">{column ? "/ " : ""}{task.key}</span>}
          {!editing && <span className="font-medium text-foreground">New task</span>}
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
              className="ml-auto flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors hover:bg-secondary hover:text-foreground"
            >
              {copied ? <Check className="size-3" /> : <GitBranch className="size-3" />}
              {copied ? "Copied" : "Copy branch name"}
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className={`${task?.key ? "" : "ml-auto "}rounded p-1 transition-colors hover:bg-secondary hover:text-foreground`}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          <div className="px-5 pb-6 pt-5 md:min-w-0 md:flex-1 md:overflow-y-auto md:px-8">
            <form action={action} className="flex flex-col gap-5 pb-6">
              {editing && <input type="hidden" name="id" value={task.id} />}
              <textarea
                name="title"
                required
                defaultValue={task?.title ?? ""}
                autoFocus={!editing}
                rows={1}
                placeholder="Task name"
                aria-label="Title"
                onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                className="field-sizing-content resize-none bg-transparent text-2xl font-semibold leading-tight outline-none placeholder:text-muted-foreground"
              />

              <div className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
                {!editing && (
                  <Prop icon={CircleDot} label="Column">
                    <select name="columnId" defaultValue={defaultColumnId ?? columns[0]?.id} className={bare}>
                      {columns.map((c) => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </select>
                  </Prop>
                )}
                <Prop icon={Flag} label="Priority">
                  <select name="priority" defaultValue={task?.priority ?? "medium"} className={bare}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{PRIORITY_CFG[p].label}</option>
                    ))}
                  </select>
                </Prop>
                <Prop icon={CalendarDays} label="Due date">
                  <input type="date" name="dueDate" defaultValue={task?.dueDate ?? ""} className={bare} />
                </Prop>
                <Prop icon={Repeat} label="Repeat" title="Repeating cards get their next copy when moved to the done column.">
                  <select name="repeat" defaultValue={task?.repeat ?? ""} className={bare}>
                    <option value="">Never</option>
                    {REPEATS.map((r) => (
                      <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>
                    ))}
                  </select>
                </Prop>
                <Prop icon={Tag} label="Labels">
                  <input name="label" defaultValue={task?.label ?? ""} placeholder="Design, QA" className={bare} />
                </Prop>
                <Prop icon={Users} label="Assignees" wide>
                  <div className="flex flex-wrap gap-1.5">
                    {members.map((m) => (
                      <label key={m.id} className="flex cursor-pointer items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary">
                        <input type="checkbox" name="assigneeIds" value={m.id} defaultChecked={task?.assignees.some((a) => a.id === m.id)} className="sr-only" />
                        <Avatar initials={initials(m.name)} color={m.color} size={20} />
                        {m.name}
                      </label>
                    ))}
                  </div>
                </Prop>
              </div>

              <label className="flex flex-col gap-2 border-t pt-5">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <AlignLeft className="size-3.5" />
                  Description
                </span>
                <textarea
                  name="description"
                  defaultValue={task?.description ?? ""}
                  rows={5}
                  placeholder="Add a description"
                  className="field-sizing-content min-h-28 resize-none rounded-md border bg-background px-3 py-2 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
                />
              </label>

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

            {editing && <Checklist key={task.id} taskId={task.id} initial={task.checklist} />}

            {editing && <Images key={`images-${task.id}`} task={task} />}

            {(linked > 0 || (repo && task?.key)) && (
              <div className="border-t py-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <GitPullRequest className="size-3.5" />
                  GitHub
                </h3>
                {repo && task?.key && (
                  <GithubActions
                    taskId={task.id}
                    repo={repo}
                    task={task}
                    closes={links?.issues.filter((i) => i.state === "open").map((i) => i.ref) ?? []}
                    onDone={loadHistory}
                  />
                )}
                {links && linked > 0 && (
                  <div className="mt-2 max-h-40 overflow-y-auto">
                    <TaskGithubLinks links={links} />
                  </div>
                )}
              </div>
            )}
          </div>

          {editing && (
            <aside className="flex shrink-0 flex-col border-t bg-secondary/30 md:w-[380px] md:border-l md:border-t-0">
              <h3 className="flex shrink-0 items-center gap-1.5 border-b px-4 py-3 text-xs font-semibold">
                <History className="size-3.5 text-muted-foreground" />
                Comments &amp; activity
              </h3>
              <ol ref={feed} className="flex max-h-80 flex-col gap-3 overflow-y-auto px-4 py-4 md:max-h-none md:flex-1">
                {history.toReversed().map((e, i) =>
                  e.kind === "comment" ? (
                    <li key={i} className="flex gap-2.5 rounded-lg border bg-card p-2.5">
                      <CommentAvatar entry={e} members={members} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs">
                          <span className="font-semibold">{e.actor ?? "Someone"}</span>
                          <span className="ml-1.5 text-[11px] text-muted-foreground">{e.atLabel}</span>
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap text-xs leading-snug">
                          <Mentions text={e.text} members={members} />
                        </p>
                      </div>
                    </li>
                  ) : (
                    <li key={i} className="px-1 text-[11px] text-muted-foreground">
                      <span className="text-foreground/80">{e.actor ?? "Someone"}</span> · {e.text} · {e.atLabel}
                    </li>
                  ),
                )}
                {history.length === 0 && <li className="m-auto text-xs text-muted-foreground">No comments yet.</li>}
              </ol>
              <div className="shrink-0 border-t p-3">
                <CommentBox taskId={task.id} members={mentionable} onPosted={loadHistory} />
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

const bare = "w-full rounded-md bg-transparent px-2 py-1 text-sm outline-none transition-colors hover:bg-secondary focus:bg-secondary";

/** One property row: icon + label on the left, its control on the right. */
function Prop({ icon: Icon, label, title, wide, children }: { icon: LucideIcon; label: string; title?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-start gap-3 ${wide ? "sm:col-span-2" : ""}`} title={title}>
      <span className="flex w-28 shrink-0 items-center gap-2 py-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Images inside the card; the first is its cover on the board. Saves on pick, like the checklist. */
function Images({ task }: { task: Task }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // The dialog keeps the task it opened with; this tracks the images until it closes.
  const [images, setImages] = useState(task.images);
  const btn = "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50";

  async function add(files: File[]) {
    setBusy(true);
    const body = new FormData();
    for (const f of files) body.append("files", f);
    const res = await fetch(`/api/tasks/${task.id}/images`, { method: "POST", body });
    setBusy(false);
    if (!res.ok) return setError(await res.text());
    setError(undefined);
    setImages(await res.json());
    router.refresh();
  }

  async function remove(image: TaskImage) {
    if (!confirm(`Delete "${image.name}"?`)) return;
    const res = await fetch(`/api/tasks/${task.id}/images/${image.id}`, { method: "DELETE" });
    if (!res.ok) return setError(await res.text());
    setImages((all) => all.filter((i) => i.id !== image.id));
    router.refresh();
  }

  return (
    <div className="border-t py-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <ImageIcon className="size-3.5" />
        Images {images.length > 0 && images.length}
      </h3>
      {images.length > 0 && (
        <div className="mb-2 grid grid-cols-3 gap-2">
          {images.map((image, i) => (
            <div key={image.id} className="group relative">
              <a href={imageUrl(task.id, image.id)} target="_blank" rel="noreferrer" title={image.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(task.id, image.id)} alt={image.name} className="aspect-video w-full rounded-md border bg-secondary object-cover" />
              </a>
              {i === 0 && <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">Cover</span>}
              <button
                type="button"
                aria-label={`Delete ${image.name}`}
                onClick={() => void remove(image)}
                className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <label className={`${btn} w-fit cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}>
        <ImagePlus className="size-3" /> {busy ? "Uploading…" : "Add images"}
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
          className="sr-only"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) void add(files);
          }}
        />
      </label>
      {error && <p className="mt-1.5 text-[11px] text-[#ef4444]">{error}</p>}
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
    <div className="border-t py-4">
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

/** "@" at the caret opens a member picker; the agent is always the first choice. */
function CommentBox({ taskId, members, onPosted }: { taskId: string; members: Member[]; onPosted: () => void }) {
  const [body, setBody] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const options = mention
    ? [{ id: "agent", name: "agent", label: "AI agent" }, ...members.map((m) => ({ id: m.id, name: m.name, label: m.name }))]
        .filter((o) => o.label.toLowerCase().includes(mention.query.toLowerCase()) || o.name.toLowerCase().includes(mention.query.toLowerCase()))
    : [];
  const track = (text: string, caret: number) => {
    const match = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
    setMention(match ? { query: match[2], start: caret - match[2].length - 1 } : null);
    setActive(0);
  };
  const pick = (name: string) => {
    if (!mention || !input.current) return;
    const caret = input.current.selectionStart;
    const insert = `@${name} `;
    setBody(body.slice(0, mention.start) + insert + body.slice(caret));
    setMention(null);
    const at = mention.start + insert.length;
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(at, at);
    });
  };
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const post = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    const result = await addComment(taskId, body);
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setBody("");
    setError(undefined);
    onPosted();
    if (!result.agent) return;
    setThinking(true);
    await askCardAgent(taskId).finally(() => setThinking(false));
    onPosted();
  };
  return (
    <div className="relative flex flex-col gap-1.5">
      {options.length > 0 && (
        <ul role="listbox" className="absolute inset-x-0 bottom-full z-10 mb-1 max-h-56 overflow-y-auto rounded-md border bg-card p-1 shadow-lg">
          {options.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o.name);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs ${i === active ? "bg-secondary" : ""}`}
            >
              {o.id === "agent" ? (
                <span className="flex size-5 items-center justify-center rounded-full bg-secondary text-[var(--chart-1)]">
                  <Sparkles className="size-3" />
                </span>
              ) : (
                <Avatar initials={initials(o.name)} color={members.find((m) => m.id === o.id)!.color} size={20} />
              )}
              {o.label}
              {o.id === "agent" && <span className="ml-auto text-[11px] text-muted-foreground">Ask about this card</span>}
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={input}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          track(e.target.value, e.target.selectionStart);
        }}
        onBlur={() => setMention(null)}
        onKeyDown={(e) => {
          if (options.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              return pick(options[active].name);
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              return setMention(null);
            }
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void post();
        }}
        rows={2}
        placeholder="Write a comment. @Name mentions a member, @agent asks the AI about this card."
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
        <span className="text-[11px] text-muted-foreground">{thinking ? "AI agent is thinking…" : "Ctrl/⌘ + Enter"}</span>
        {error && <span className="text-[11px] text-[#ef4444]">{error}</span>}
      </div>
    </div>
  );
}

/** The commenter's avatar; the AI agent gets the sparkles mark the agent panels use. */
function CommentAvatar({ entry, members }: { entry: Entry; members: Member[] }) {
  if (entry.agent)
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[var(--chart-1)]">
        <Sparkles className="size-4" />
      </span>
    );
  const member = members.find((m) => m.name === entry.actor);
  return <Avatar initials={initials(entry.actor ?? "?")} color={member?.color ?? "var(--muted-foreground)"} size={28} />;
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

/** Create a GitHub issue from the card, or open GitHub's new-PR page for its branch. */
function GithubActions({ taskId, repo, task, closes, onDone }: { taskId: string; repo: string; task: Task; closes: string[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const btn = "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50";

  async function issue() {
    // Opened before the await, or the browser treats it as a popup and blocks it.
    const tab = window.open("", "_blank");
    setBusy(true);
    const res = await createGithubIssue(taskId);
    setBusy(false);
    if ("error" in res) {
      tab?.close();
      return setError(res.error);
    }
    setError(undefined);
    if (tab) tab.location.href = res.url;
    onDone();
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void issue()} className={btn}>
          <CircleDot className="size-3" /> {busy ? "Creating issue…" : "Create issue"}
        </button>
        <a
          href={pullRequestUrlOf(repo, task, closes)}
          target="_blank"
          rel="noreferrer"
          title={`Push ${branchNameOf(task)} first; GitHub opens a pull request from it into the default branch.${closes.length ? ` Merging it closes ${closes.join(", ")}.` : ""}`}
          className={btn}
        >
          <GitPullRequest className="size-3" /> Open pull request
        </a>
      </div>
      {error && <p className="mt-1.5 text-[11px] text-[#ef4444]">{error}</p>}
    </>
  );
}
