"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlignLeft, Archive, CalendarDays, Check, CircleDot, Flag, GitBranch, GitPullRequest, History, Image as ImageIcon, ImagePlus, ListChecks, Ban, Repeat, Sparkles, Tag, Trash2, Users, X, type LucideIcon } from "lucide-react";
import { addComment, archiveTask, askCardAgent, createGithubIssue, createTask, deleteTask, fetchHistory, setBlocker, setChecklist, updateTask } from "@/lib/actions";
import { branchNameOf, initials, pullRequestUrlOf, PRIORITIES, PRIORITY_CFG, REPEATS, type CheckItem, type Column, type Entry, type Member, type Task, type TaskImage } from "@/lib/board";
import { Avatar } from "./avatar";
import { imageUrl } from "./task-card";
import type { TaskLinks } from "@/lib/github";
import { TaskGithubLinks } from "./views/github-view";
import { FormError, SubmitButton } from "./form-bits";
import { MentionText, TagLinks, tagOptions, useMentionPicker } from "./mentions";
import type { CanvasTag } from "@/lib/queries";
import { useT } from "@/components/i18n";
import { eventText } from "@/lib/i18n";

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
  /** Named canvas shapes, offered when typing "@" (the open project's first). */
  tags: CanvasTag[];
  /** An @tag was clicked: show it on the canvas. */
  onTag: (tag: CanvasTag) => void;
  /** The project's done column; null = its last column. Decides whether a blocker is finished. */
  doneColumnId: string | null;
  /** A card in the Dependencies list was clicked. */
  onOpenTask: (task: Task) => void;
  onClose: () => void;
};

export function TaskDialog({ task, columns, members, mentionable, defaultColumnId, links, repo, tags, onTag, doneColumnId, onOpenTask, onClose }: Props) {
  const tr = useT();
  const editing = task !== null;
  const [state, action] = useActionState(editing ? updateTask : createTask, null);
  const [history, setHistory] = useState<Entry[]>([]);
  const [copied, setCopied] = useState(false);
  const linked = links ? links.pulls.length + links.issues.length + links.branches.length + links.commits.length : 0;
  const column = columns.find((c) => c.id === task?.columnId);
  const [description, setDescription] = useState(task?.description ?? "");
  const describe = useMentionPicker(description, setDescription, tagOptions(tags), true);

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
          {!editing && <span className="font-medium text-foreground">{tr("New task")}</span>}
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
              {copied ? tr("Copied") : tr("Copy branch name")}
            </button>
          )}
          <button
            onClick={onClose}
            aria-label={tr("Close")}
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
                placeholder={tr("Task name")}
                aria-label={tr("Title")}
                onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                className="field-sizing-content resize-none bg-transparent text-2xl font-semibold leading-tight outline-none placeholder:text-muted-foreground"
              />

              <div className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
                {!editing && (
                  <Prop icon={CircleDot} label={tr("Column")}>
                    <select name="columnId" defaultValue={defaultColumnId ?? columns[0]?.id} className={bare}>
                      {columns.map((c) => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </select>
                  </Prop>
                )}
                <Prop icon={Flag} label={tr("Priority")}>
                  <select name="priority" defaultValue={task?.priority ?? "medium"} className={bare}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{tr(PRIORITY_CFG[p].label)}</option>
                    ))}
                  </select>
                </Prop>
                <Prop icon={CalendarDays} label={tr("Due date")}>
                  <input type="date" name="dueDate" defaultValue={task?.dueDate ?? ""} className={bare} />
                </Prop>
                <Prop icon={Repeat} label={tr("Repeat")} title={tr("Repeating cards get their next copy when moved to the done column.")}>
                  <select name="repeat" defaultValue={task?.repeat ?? ""} className={bare}>
                    <option value="">{tr("Never")}</option>
                    {REPEATS.map((r) => (
                      <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>
                    ))}
                  </select>
                </Prop>
                <Prop icon={Tag} label={tr("Labels")}>
                  <input name="label" defaultValue={task?.label ?? ""} placeholder={tr("Design, QA")} className={bare} />
                </Prop>
                <Prop icon={Users} label={tr("Assignees")} wide>
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

              <div className="flex flex-col gap-2 border-t pt-5">
                <label htmlFor="task-description" className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <AlignLeft className="size-3.5" />
                  {tr("Description")}
                </label>
                <div className="relative">
                  <textarea
                    id="task-description"
                    name="description"
                    {...describe.bind}
                    onKeyDown={(e) => describe.onKeyDown(e)}
                    rows={5}
                    placeholder={tr("Add a description. @tag links shapes on the canvas.")}
                    className="field-sizing-content min-h-28 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
                  />
                  {describe.menu}
                </div>
              </div>

              <FormError error={state?.error} />

              <div className="flex items-center gap-2">
                <SubmitButton>{editing ? tr("Save") : tr("Create task")}</SubmitButton>
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
                    {tr("Archive")}
                  </button>
                )}
                {editing && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm(tr("Delete \"{name}\" and its history? Archive keeps it restorable.", { name: task.title }))) return;
                      await deleteTask(task.id);
                      onClose();
                    }}
                    className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs text-[#ef4444] transition-colors hover:bg-[rgba(239,68,68,0.08)]"
                  >
                    <Trash2 className="size-3.5" />
                    {tr("Delete")}
                  </button>
                )}
              </div>
            </form>

            {editing && <Checklist key={task.id} taskId={task.id} initial={task.checklist} />}

            {editing && <Images key={`images-${task.id}`} task={task} />}

            {editing && (
              <Dependencies
                key={`deps-${task.id}`}
                task={task}
                columns={columns}
                doneColumnId={doneColumnId ?? columns.at(-1)?.id ?? null}
                onOpen={onOpenTask}
                onChange={loadHistory}
              />
            )}

            {/* Every canvas group the card mentions, in the description or a comment. */}
            <TagLinks text={[description, ...history.filter((e) => e.kind === "comment").map((e) => e.text)].join("\n")} tags={tags} onTag={onTag} />

            {(linked > 0 || (repo && task?.key)) && (
              <div className="border-t py-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <GitPullRequest className="size-3.5" />
                  {tr("GitHub")}
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
                {tr("Comments & activity")}
              </h3>
              <ol ref={feed} className="flex max-h-80 flex-col gap-3 overflow-y-auto px-4 py-4 md:max-h-none md:flex-1">
                {history.toReversed().map((e, i) =>
                  e.kind === "comment" ? (
                    <li key={i} className="flex gap-2.5 rounded-lg border bg-card p-2.5">
                      <CommentAvatar entry={e} members={members} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs">
                          <span className="font-semibold">{e.actor ?? tr("Someone")}</span>
                          <span className="ml-1.5 text-[11px] text-muted-foreground">{e.atLabel}</span>
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap text-xs leading-snug">
                          <MentionText text={e.text} names={members.map((m) => m.name)} tags={tags} onTag={onTag} />
                        </p>
                      </div>
                    </li>
                  ) : (
                    <li key={i} className="px-1 text-[11px] text-muted-foreground">
                      <span className="text-foreground/80">{e.actor ?? tr("Someone")}</span> · {eventText(e.text, tr)} · {e.atLabel}
                    </li>
                  ),
                )}
                {history.length === 0 && <li className="m-auto text-xs text-muted-foreground">{tr("No comments yet.")}</li>}
              </ol>
              <div className="shrink-0 border-t p-3">
                <CommentBox taskId={task.id} members={mentionable} tags={tags} onPosted={loadHistory} />
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

/** Images inside the card; the first is its cover on the board ("Make cover" moves one there). Saves on pick, like the checklist. */
function Images({ task }: { task: Task }) {
  const tr = useT();
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
    if (!confirm(tr("Delete \"{name}\"?", { name: image.name }))) return;
    const res = await fetch(`/api/tasks/${task.id}/images/${image.id}`, { method: "DELETE" });
    if (!res.ok) return setError(await res.text());
    setImages((all) => all.filter((i) => i.id !== image.id));
    router.refresh();
  }

  async function makeCover(image: TaskImage) {
    const res = await fetch(`/api/tasks/${task.id}/images/${image.id}`, { method: "PATCH" });
    if (!res.ok) return setError(await res.text());
    setImages((all) => [image, ...all.filter((i) => i.id !== image.id)]);
    router.refresh();
  }

  return (
    <div className="border-t py-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <ImageIcon className="size-3.5" />
        {tr("Images")} {images.length > 0 && images.length}
      </h3>
      {images.length > 0 && (
        <div className="mb-2 grid grid-cols-3 gap-2">
          {images.map((image, i) => (
            <div key={image.id} className="group relative">
              <a href={imageUrl(task.id, image.id)} target="_blank" rel="noreferrer" title={image.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(task.id, image.id)} alt={image.name} className="aspect-video w-full rounded-md border bg-secondary object-cover" />
              </a>
              {i === 0 ? (
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{tr("Cover")}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void makeCover(image)}
                  className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                >
                  {tr("Make cover")}
                </button>
              )}
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
        <ImagePlus className="size-3" /> {busy ? tr("Uploading…") : tr("Add images")}
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
      {error && <p className="mt-1.5 text-[11px] text-[#ef4444]">{tr(error)}</p>}
    </div>
  );
}

/**
 * "Waiting on" (this card's blockers) and "Blocking" (cards waiting on it), both from
 * this project's board. Adding or removing saves at once, like the checklist.
 */
function Dependencies({ task, columns, doneColumnId, onOpen, onChange }: {
  task: Task; columns: Column[]; doneColumnId: string | null; onOpen: (task: Task) => void; onChange: () => void;
}) {
  const tr = useT();
  const [ids, setIds] = useState(task.blockedBy.map((b) => b.id));
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cards = columns.flatMap((c) => c.tasks);
  const waitingOn = ids.flatMap((id) => cards.filter((t) => t.id === id));
  const blocking = cards.filter((t) => t.blockedBy.some((b) => b.id === task.id));
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? cards.filter((t) => t.id !== task.id && !ids.includes(t.id) && `${t.key ?? ""} ${t.title}`.toLowerCase().includes(needle)).slice(0, 6)
    : [];

  async function toggle(blocker: Task, on: boolean) {
    setError(null);
    const result = await setBlocker(task.id, blocker.id, on);
    if ("error" in result) return setError(result.error ?? "Could not save.");
    setIds((all) => (on ? [...all, blocker.id] : all.filter((id) => id !== blocker.id)));
    setQuery("");
    onChange();
  }

  const row = (t: Task, remove?: () => void) => {
    const done = t.columnId === doneColumnId;
    return (
      <li key={t.id} className="group flex items-center gap-2 text-xs">
        <button type="button" onClick={() => onOpen(t)} className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline">
          <span className="shrink-0 font-mono text-muted-foreground">{t.key}</span>
          <span className={`truncate ${done ? "text-muted-foreground line-through" : ""}`}>{t.title}</span>
        </button>
        {done && <Check className="size-3.5 shrink-0 text-[var(--chart-2)]" aria-label={tr("Done")} />}
        {remove && (
          <button
            type="button"
            aria-label={`Remove ${t.key}`}
            onClick={remove}
            className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus:opacity-100"
          >
            <X className="size-3" />
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="border-t py-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Ban className="size-3.5" />
        {tr("Dependencies")}
      </h3>
      {waitingOn.length > 0 && (
        <>
          <p className="mb-1 text-[11px] text-muted-foreground">{tr("Waiting on")}</p>
          <ul className="mb-3 flex flex-col gap-1">{waitingOn.map((t) => row(t, () => void toggle(t, false)))}</ul>
        </>
      )}
      {blocking.length > 0 && (
        <>
          <p className="mb-1 text-[11px] text-muted-foreground">{tr("Blocking")}</p>
          <ul className="mb-3 flex flex-col gap-1">{blocking.map((t) => row(t))}</ul>
        </>
      )}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={tr("Blocked by… type a key or title")}
        className="w-full rounded-md border bg-background px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-ring"
      />
      {matches.length > 0 && (
        <ul className="mt-1 flex flex-col rounded-md border bg-background p-1">
          {matches.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => void toggle(t, true)}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-secondary"
              >
                <span className="shrink-0 font-mono text-muted-foreground">{t.key}</span>
                <span className="truncate">{t.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-[11px] text-[#ef4444]">{tr(error)}</p>}
    </div>
  );
}

/** Ticks save at once; there is no Save button for the checklist. */
function Checklist({ taskId, initial }: { taskId: string; initial: CheckItem[] }) {
  const tr = useT();
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
        {tr("Checklist")} {items.length > 0 && `${done}/${items.length}`}
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
          placeholder={tr("Add an item and press Enter")}
          className="w-full rounded-md border bg-background px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-ring"
        />
      </form>
    </div>
  );
}

/** "@" at the caret opens a member and canvas-tag picker; the agent is always the first choice. */
function CommentBox({ taskId, members, tags, onPosted }: { taskId: string; members: Member[]; tags: CanvasTag[]; onPosted: () => void }) {
  const tr = useT();
  const [body, setBody] = useState("");
  const picker = useMentionPicker(body, setBody, [
    {
      id: "agent",
      name: "agent",
      label: tr("AI agent"),
      hint: tr("Ask about this card"),
      icon: (
        <span className="flex size-5 items-center justify-center rounded-full bg-secondary text-[var(--chart-1)]">
          <Sparkles className="size-3" />
        </span>
      ),
    },
    ...members.map((m) => ({ id: m.id, name: m.name, label: m.name, icon: <Avatar initials={initials(m.name)} color={m.color} size={20} /> })),
    ...tagOptions(tags),
  ]);
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
      {picker.menu}
      <textarea
        {...picker.bind}
        onKeyDown={(e) => {
          if (picker.onKeyDown(e)) return;
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void post();
        }}
        rows={2}
        placeholder={tr("Write a comment. @Name mentions a member or a canvas tag, @agent asks the AI.")}
        className="resize-y rounded-md border bg-background px-3 py-2 text-xs outline-none transition-colors focus:border-ring"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void post()}
          disabled={!body.trim() || busy}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {tr("Comment")}
        </button>
        <span className="text-[11px] text-muted-foreground">{thinking ? tr("AI agent is thinking…") : tr("Ctrl/⌘ + Enter")}</span>
        {error && <span className="text-[11px] text-[#ef4444]">{tr(error)}</span>}
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

/** Create a GitHub issue from the card, or open GitHub's new-PR page for its branch. */
function GithubActions({ taskId, repo, task, closes, onDone }: { taskId: string; repo: string; task: Task; closes: string[]; onDone: () => void }) {
  const tr = useT();
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
          <CircleDot className="size-3" /> {busy ? tr("Creating issue…") : tr("Create issue")}
        </button>
        <a
          href={pullRequestUrlOf(repo, task, closes)}
          target="_blank"
          rel="noreferrer"
          title={`Push ${branchNameOf(task)} first; GitHub opens a pull request from it into the default branch.${closes.length ? ` Merging it closes ${closes.join(", ")}.` : ""}`}
          className={btn}
        >
          <GitPullRequest className="size-3" /> {tr("Open pull request")}
        </a>
      </div>
      {error && <p className="mt-1.5 text-[11px] text-[#ef4444]">{tr(error)}</p>}
    </>
  );
}
