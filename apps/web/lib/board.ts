// Shared domain types + pure helpers. No data, no I/O — safe on client and server.

export type Priority = "low" | "medium" | "high";

export type Member = { id: string; name: string; color: string };

export type Task = {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  /** Comma-separated; split with `labelsOf`. */
  label: string | null;
  priority: Priority;
  assignees: Member[];
  dueDate: string | null;
  /** The sprint the card is planned in; null = backlog. */
  sprintId: string | null;
  /** When work starts, for the timeline; never after dueDate. */
  startDate: string | null;
  /** "WEB-42": the project key plus this task's number in the project. */
  key: string | null;
  checklist: CheckItem[];
  repeat: Repeat | null;
  comments: number;
  /** The chosen cover first, then oldest first; the first is the card's cover. Served at /api/tasks/:id/images/:imageId. */
  images: TaskImage[];
  /** Cards in the same project this one waits on; `done` = that card sits in the done column. */
  blockedBy: Blocker[];
  /** The card this one is a subtask of. */
  parentId: string | null;
  /** This card's subtasks; `done` as for blockedBy. */
  subtasks: Blocker[];
  /** Whole days since the card entered its current column. */
  stageDays: number;
  /** Seconds logged on the card by everyone, running timers counted up to the load. */
  trackedSeconds: number;
  /** Someone's timer is running on it. */
  timing: boolean;
  /** Custom field values by field id, as text; empty ones are absent. */
  fields: Record<string, string>;
};

export const FIELD_TYPES = ["text", "number", "date", "select"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
/** A project's custom field; `options` only matters for select. */
export type CustomField = { id: string; name: string; type: FieldType; options: string[] };

/**
 * Reads `cf:<fieldId>` form entries into stored values: trimmed text (≤200), a
 * finite number, a YYYY-MM-DD date, or one of a select's options. Empty ones are
 * left out; the first invalid one returns an error.
 */
export function fieldValuesOf(get: (name: string) => unknown, defs: CustomField[]): { values: Record<string, string> } | { error: string } {
  const out: Record<string, string> = {};
  for (const f of defs) {
    const v = String(get(`cf:${f.id}`) ?? "").trim();
    if (!v) continue;
    const ok = f.type === "text" ? v.length <= 200
      : f.type === "number" ? v.length <= 30 && Number.isFinite(Number(v))
      : f.type === "date" ? /^\d{4}-\d{2}-\d{2}$/.test(v)
      : f.options.includes(v);
    // One fixed message so the UI can translate it; the inputs are typed, so this is rare.
    if (!ok) return { error: "A custom field has an invalid value." };
    out[f.id] = f.type === "number" ? String(Number(v)) : v;
  }
  return { values: out };
}

/** "Small, Medium, , Small" → ["Small", "Medium"]: trimmed, de-duplicated, at most 20 of ≤40 characters. */
export const fieldOptionsOf = (raw: string) =>
  [...new Set(raw.split(",").map((o) => o.trim()).filter((o) => o && o.length <= 40))].slice(0, 20);

export type Blocker = { id: string; done: boolean };

export type TaskImage = { id: string; name: string };

export type CheckItem = { text: string; done: boolean };

export const REPEATS = ["daily", "weekly", "monthly"] as const;
export type Repeat = (typeof REPEATS)[number];

/** The due date of a repeating task's next copy. Monthly keeps the day, clamped to short months (Jan 31 → Feb 28). */
export function nextDue(date: string, repeat: Repeat) {
  const [y, m, d] = date.split("-").map(Number);
  if (repeat === "monthly") {
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
  }
  return new Date(Date.UTC(y, m - 1, d + (repeat === "daily" ? 1 : 7))).toISOString().slice(0, 10);
}

/** 5400 → "1h 30m", 300 → "5m"; under a minute is "0m". */
export function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60), h = Math.floor(m / 60);
  return h ? (m % 60 ? `${h}h ${m % 60}m` : `${h}h`) : `${m}m`;
}

/** "1h 30m", "1.5h", "90m", "90" (minutes) → seconds; null when unreadable or not above zero. */
export function parseDuration(text: string) {
  const s = text.trim().toLowerCase().replace(/\s+/g, "");
  const m = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m?)?$/.exec(s);
  if (!s || !m || (!m[1] && !m[2])) return null;
  const seconds = Math.round(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60);
  return seconds > 0 ? seconds : null;
}

/** "Design, QA" → ["Design", "QA"]. */
export const labelsOf = (label: string | null) => (label ?? "").split(",").map((l) => l.trim()).filter(Boolean);
/** What `label` stores: trimmed, de-duplicated ignoring case (first spelling wins), comma-joined; null when empty. */
export const joinLabels = (raw: string) =>
  labelsOf(raw).filter((l, i, all) => all.findIndex((x) => x.toLowerCase() === l.toLowerCase()) === i).join(", ") || null;

/** `limitDays`: days a card may stay here before its stage timer turns red; null = no limit. */
export type Column = { id: string; title: string; color: string; limitDays: number | null; tasks: Task[] };

/** `atLabel` is formatted on the server — see lib/format.ts for why. */
export type Entry = { at: string; atLabel: string; text: string; actor: string | null; kind: "event" | "comment"; agent?: boolean };

export const PRIORITIES: Priority[] = ["low", "medium", "high"];

export const PRIORITY_CFG: Record<Priority, { label: string; color: string; bg: string }> = {
  high: { label: "High", color: "#ef4444", bg: "rgba(239,68,68,0.08)" },
  medium: { label: "Medium", color: "#f59e0b", bg: "rgba(245,158,11,0.08)" },
  low: { label: "Low", color: "#6b7280", bg: "rgba(107,114,128,0.08)" },
};

/**
 * Entity colours are CSS custom properties, not hex, so light and dark each get
 * their own validated step. Both orderings pass the colourblind-separation
 * checks; see AGENTS.md. Assign in order, never cycle past 7 — reuse instead.
 */
export const PALETTE = Array.from({ length: 7 }, (_, i) => `var(--chart-${i + 1})`);

export type TemplateColumn = { title: string; color: string };
export type Template = { id: string; name: string; description: string; columns: TemplateColumn[] };

const col = (title: string, n: number): TemplateColumn => ({
  title,
  color: n === 0 ? "var(--muted-foreground)" : PALETTE[n - 1],
});

/** Project templates offered at create time; the spec lives in templates.md. First one is the default. */
export const TEMPLATES: Template[] = [
  {
    id: "general", name: "General", description: "Simple board for any kind of work.",
    columns: [col("Backlog", 0), col("To Do", 4), col("In Progress", 1), col("Blocked", 6), col("Done", 2)],
  },
  {
    id: "tech", name: "Software / Tech", description: "Sprint board for engineering teams.",
    columns: [col("Backlog", 0), col("Todo", 4), col("In Progress", 1), col("In Review", 3), col("QA", 5), col("Done", 2)],
  },
  {
    id: "sales", name: "Sales pipeline", description: "Track deals from first lead to won or lost.",
    columns: [col("Lead", 0), col("Contacted", 4), col("Qualified", 1), col("Proposal", 3), col("Negotiation", 5), col("Won", 2), col("Lost", 6)],
  },
  {
    id: "marketing", name: "Marketing / Content", description: "Content calendar from idea to published.",
    columns: [col("Ideas", 0), col("Planned", 4), col("Writing / Design", 1), col("Review", 3), col("Scheduled", 5), col("Published", 2)],
  },
  {
    id: "support", name: "Customer Support", description: "Helpdesk queue with severity-based response times.",
    columns: [col("New", 0), col("Triaged", 4), col("In Progress", 1), col("Waiting on Customer", 5), col("Resolved", 2)],
  },
  {
    id: "recruiting", name: "Recruiting", description: "Hiring pipeline from application to offer.",
    columns: [col("Applied", 0), col("Screening", 4), col("Interview", 1), col("Offer", 3), col("Hired", 2), col("Rejected", 6)],
  },
];

/** Unknown or missing ids fall back to the first (General) template. */
export const templateOf = (id: unknown) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** Which column holds this task id (or the column with this id, for an empty-column drop). */
export function columnOf(columns: Column[], id: string): Column | undefined {
  return columns.find((c) => c.id === id || c.tasks.some((t) => t.id === id));
}

/** Move a task into `to` at `index`, or reorder inside its own column. Pure — used for the optimistic drag. */
export function placeTask(columns: Column[], taskId: string, to: string, index: number): Column[] {
  const from = columns.find((c) => c.tasks.some((t) => t.id === taskId));
  const dest = columns.find((c) => c.id === to);
  if (!from || !dest) return columns;

  const task = from.tasks.find((t) => t.id === taskId)!;
  const without = columns.map((c) =>
    c.id === from.id ? { ...c, tasks: c.tasks.filter((t) => t.id !== taskId) } : c,
  );

  return without.map((c) => {
    if (c.id !== to) return c;
    const tasks = [...c.tasks];
    tasks.splice(Math.max(0, Math.min(index, tasks.length)), 0, { ...task, columnId: to });
    return { ...c, tasks };
  });
}

/** Move `from` to `to` in a list of ids. Used for column reordering. */
export function reorder<T>(ids: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids;
  const next = [...ids];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** `assignee` is a user id, or "me" for whoever is looking (so a shared view works for each person). */
/**
 * `group` splits the board into swimlanes (see lanesOf); the rest narrow the cards.
 * `sprint`: a sprint id, "current" (resolved by the caller, so a saved view follows
 * the sprints) or "none" for the backlog.
 */
export type Filters = { q?: string; assignee?: string; priority?: string; label?: string; group?: Group; sprint?: string };

/** `total`/`done` count the sprint's unarchived cards and those in the done column. */
export type Sprint = { id: string; name: string; startDate: string; endDate: string; closed: boolean; total: number; done: number };

/** The open sprint running on `today`, else the earliest open one. */
export const currentSprint = (sprints: Sprint[], today: string) =>
  sprints.find((s) => !s.closed && s.startDate <= today && today <= s.endDate) ?? sprints.find((s) => !s.closed);

export const GROUPS = ["assignee", "label", "priority"] as const;
export type Group = (typeof GROUPS)[number];
export type Lane = { key: string; name: string; columns: Column[] };

/**
 * Swimlanes: the board once per assignee, label or priority, each with every
 * column. A card with two assignees or labels shows in both lanes; key "" holds
 * the cards with none (never for priority). People and labels sort by name,
 * priorities high first.
 */
export function lanesOf(columns: Column[], group: Group): Lane[] {
  const keysOf = (t: Task) =>
    group === "assignee" ? t.assignees.map((a) => ({ key: a.id, name: a.name }))
    : group === "label" ? labelsOf(t.label).map((l) => ({ key: l, name: l }))
    : [{ key: t.priority, name: PRIORITY_CFG[t.priority].label }];
  const names = new Map<string, string>();
  let none = false;
  for (const t of columns.flatMap((c) => c.tasks)) {
    const keys = keysOf(t);
    if (!keys.length) none = true;
    for (const k of keys) names.set(k.key, k.name);
  }
  const keys = group === "priority"
    ? [...PRIORITIES].reverse().filter((p) => names.has(p))
    : [...names.keys()].sort((a, b) => names.get(a)!.localeCompare(names.get(b)!));
  if (none) keys.push("");
  return keys.map((key) => ({
    key,
    name: names.get(key) ?? "",
    columns: columns.map((c) => ({ ...c, tasks: c.tasks.filter((t) => key ? keysOf(t).some((k) => k.key === key) : !keysOf(t).length) })),
  }));
}

/** Layouts a saved view can open in; the first four of the workspace's view tabs, in order. */
export const LAYOUTS = ["board", "list", "calendar", "timeline"] as const;
export type Layout = (typeof LAYOUTS)[number];
export type SavedView = { id: string; name: string; filters: Filters; layout: Layout };

/** Only the known keys, as trimmed non-empty strings of at most 100 characters; anything else is dropped. */
export function cleanFilters(raw: unknown): Filters {
  const out: Filters = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of ["q", "assignee", "priority", "label", "sprint"] as const) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim() && v.length <= 100) out[key] = v.trim();
  }
  if (out.priority && !PRIORITIES.includes(out.priority as Priority)) delete out.priority;
  const group = (raw as Record<string, unknown>).group;
  if (GROUPS.includes(group as Group)) out.group = group as Group;
  return out;
}

/** Same filters, ignoring key order and empty values — which saved view (if any) is showing. */
export const sameFilters = (a: Filters, b: Filters) =>
  JSON.stringify(Object.entries(cleanFilters(a)).sort()) === JSON.stringify(Object.entries(cleanFilters(b)).sort());

/** Filtering runs client-side over the already-loaded board. `me` resolves the "me" assignee. */
export function applyFilters(columns: Column[], f: Filters, me?: string, current?: string): Column[] {
  // "current" with no open sprint shows nothing rather than everything.
  const sprint = f.sprint === "current" ? current ?? "-" : f.sprint;
  const q = f.q?.toLowerCase().trim();
  const assignee = f.assignee === "me" ? me : f.assignee;
  return columns.map((c) => ({
    ...c,
    tasks: c.tasks.filter(
      (t) =>
        (!q || t.title.toLowerCase().includes(q) || (t.label ?? "").toLowerCase().includes(q)) &&
        (!assignee || t.assignees.some((a) => a.id === assignee)) &&
        (!f.priority || t.priority === f.priority) &&
        (!f.label || labelsOf(t.label).includes(f.label)) &&
        (!sprint || (sprint === "none" ? !t.sprintId : t.sprintId === sprint)),
    ),
  }));
}

/** Default project key from its name: first three letters, upper-cased (same rule as the schema backfill). */
export const projectKeyOf = (name: string) => name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "TASK";
export const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;

/** Git branch name for a task: `fix/` for bug-ish labels, else `feat/`, then key and a title slug. */
export const branchNameOf = (task: Pick<Task, "key" | "title" | "label">) => {
  const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-$/, "");
  return `${/bug|fix/i.test(task.label ?? "") ? "fix" : "feat"}/${task.key}${slug ? `-${slug}` : ""}`;
};

/**
 * GitHub's "open a pull request" page for the card's branch (`branchNameOf`), with the title
 * prefilled so the key links the PR back. One ref in /compare means "against the default branch".
 * `closes` ("#21") go in the body as "Closes #21", one per line, so merging closes those issues.
 */
export const pullRequestUrlOf = (repo: string, task: Pick<Task, "key" | "title" | "label">, closes: string[] = []) =>
  `https://github.com/${repo}/compare/${branchNameOf(task)}?expand=1&title=${encodeURIComponent(`[${task.key}] ${task.title}`)}` +
  (closes.length ? `&body=${encodeURIComponent(closes.map((ref) => `Closes ${ref}`).join("\n"))}` : "");

export type CiState = "success" | "failure" | "pending" | null;

/** One state for a commit's check runs: any failure wins, then anything unfinished, else success; none → null. */
export function ciOf(runs: { status: string; conclusion: string | null }[]): CiState {
  if (!runs.length) return null;
  if (runs.some((r) => ["failure", "timed_out", "cancelled", "action_required", "startup_failure"].includes(r.conclusion ?? ""))) return "failure";
  if (runs.some((r) => r.status !== "completed")) return "pending";
  return "success";
}

/** Days since the epoch for a YYYY-MM-DD date (UTC, so no time zone shifts a bar); NaN if malformed. */
export const dayNumber = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000 : NaN;
export const dateOfDay = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

export type TimelineRow = { task: Task; start: number; end: number };
/**
 * The timeline's rows: every card with a start or due date, as a span of day
 * numbers (one date alone is a one-day bar), earliest first. The range runs from
 * three days before the first bar (or today) to a week after the last.
 */
export function timelineOf(tasks: Task[], today: string) {
  const rows: TimelineRow[] = tasks
    .flatMap((task) => {
      const start = dayNumber(task.startDate ?? task.dueDate ?? "");
      const end = dayNumber(task.dueDate ?? task.startDate ?? "");
      return Number.isFinite(start) && Number.isFinite(end) ? [{ task, start, end: Math.max(start, end) }] : [];
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const now = dayNumber(today);
  const from = Math.min(now, ...rows.map((r) => r.start)) - 3;
  const to = Math.max(now, ...rows.map((r) => r.end)) + 7;
  return { from, days: to - from + 1, today: now, rows, undated: tasks.length - rows.length };
}
