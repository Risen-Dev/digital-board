// Shared domain types + pure helpers. No data, no I/O — safe on client and server.

export type Priority = "low" | "medium" | "high";

export type Member = { id: string; name: string; color: string };

export type Task = {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  label: string | null;
  priority: Priority;
  assignee: Member | null;
  dueDate: string | null;
};

export type Column = { id: string; title: string; color: string; tasks: Task[] };

/** `atLabel` is formatted on the server — see lib/format.ts for why. */
export type Entry = { at: string; atLabel: string; text: string; actor: string | null };

export const PRIORITIES: Priority[] = ["low", "medium", "high"];

export const PRIORITY_CFG: Record<Priority, { label: string; color: string; bg: string }> = {
  high: { label: "High", color: "#ef4444", bg: "rgba(239,68,68,0.08)" },
  medium: { label: "Medium", color: "#f59e0b", bg: "rgba(245,158,11,0.08)" },
  low: { label: "Low", color: "#6b7280", bg: "rgba(107,114,128,0.08)" },
};

/** Suggested colours for columns created in the setup wizard. */
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

export type Filters = { q?: string; assignee?: string; priority?: string; label?: string };

/** Filtering runs client-side over the already-loaded board. */
export function applyFilters(columns: Column[], f: Filters): Column[] {
  const q = f.q?.toLowerCase().trim();
  return columns.map((c) => ({
    ...c,
    tasks: c.tasks.filter(
      (t) =>
        (!q || t.title.toLowerCase().includes(q) || (t.label ?? "").toLowerCase().includes(q)) &&
        (!f.assignee || t.assignee?.id === f.assignee) &&
        (!f.priority || t.priority === f.priority) &&
        (!f.label || t.label === f.label),
    ),
  }));
}
