// The project agent's pure half: what the model is told, and turning its answer into
// task operations. Type-only imports, so `board.check.ts` can load it under strip-types.
import type { CheckItem, Column, Member, Task } from "./board";

/** Fields the task actions take, already resolved to ids. `null` clears a field. */
export type TaskFields = {
  title: string;
  description: string | null;
  label: string | null;
  priority: "low" | "medium" | "high";
  assigneeIds: string[];
  dueDate: string | null;
  repeat: string | null;
};
export type AgentOp =
  | { op: "create"; columnId: string; fields: TaskFields; summary: string }
  | { op: "update"; taskId: string; fields: TaskFields; moveTo: string | null; summary: string }
  /** `flow` is still unvalidated: the route runs it through parseFlow, which this file can't import. */
  | { op: "sheet"; name: string; flow: unknown; summary: string }
  | { op: "message"; to: string | null; text: string; summary: string }
  | { op: "column"; title: string; summary: string }
  /** `items` is the whole new checklist: the existing items plus the added ones. */
  | { op: "checklist"; taskId: string; items: CheckItem[]; summary: string }
  | { op: "comment"; taskId: string; text: string; summary: string }
  | { op: "archive"; taskId: string; summary: string };

const PRIORITIES = ["low", "medium", "high"];
const MAX_OPS = 50;

export const PROJECT_SYSTEM = `You are the assistant of a project workspace: a kanban board, canvas sheets (whiteboards) and a team chat. You can answer questions about the project and act on it.

Always answer with ONE JSON object and nothing else:
{"reply": string, "actions": [
  {"op": "create", "title": string, "column"?: string, "priority"?: "low"|"medium"|"high", "assignee"?: string|null, "due"?: "YYYY-MM-DD"|null, "label"?: string|null, "description"?: string|null},
  {"op": "update", "task": string, "title"?: string, "column"?: string, "priority"?: "low"|"medium"|"high", "assignee"?: string|null, "due"?: "YYYY-MM-DD"|null, "label"?: string|null, "description"?: string|null},
  {"op": "sheet", "name": string, "flow": {"nodes": [{"id": string, "label": string, "shape": "start"|"end"|"process"|"decision"|"data"}], "edges": [{"from": string, "to": string, "label"?: string}]}},
  {"op": "message", "to": "all" | string, "text": string},
  {"op": "column", "title": string},
  {"op": "checklist", "task": string, "items": [string]},
  {"op": "comment", "task": string, "text": string},
  {"op": "archive", "task": string}
]}

- "reply": a short message to the user, in the language they wrote in, saying what you did or answering the question.
- "actions": empty when you only answer a question or need clarification first. Never invent work the user did not ask for.
- "column" is a column title exactly as listed below; omit it on create to use the first column. "update" with "column" moves the card.
- "assignee" is a member's name exactly as listed below; null unassigns. "task" is the task key (e.g. "WEB-12"), or its exact title if it has no key.
- "sheet" creates a new canvas sheet with a flowchart (business process, workflow, negotiation steps…). One "start" node, at least one "end" node, "decision" for branching with labelled outgoing edges ("Yes"/"No"), short verb-phrase labels, 4–25 nodes. Changing a flow you made earlier means a new sheet with the complete updated flow.
- "message" posts to the team chat as the user: "to" is "all" for the workspace channel or a member's name for a direct message. Only when the user asks you to send or tell someone something.
- "column" adds a board column at the end.
- "checklist" adds items to a card's checklist (existing items stay). "comment" posts a comment on a card as the user; "@Full Name" mentions a member. "archive" takes a card off the board; it can be restored later.
- On "update", include only the fields that change. Resolve relative dates ("tomorrow", "next Friday") against today's date.
- You cannot delete anything, change settings, members or roles, or read chat history: if asked, say so in the reply.`;

/** The board as the model sees it, appended to the system prompt. */
export function boardBrief(project: string, today: string, columns: Column[], members: Member[]) {
  const line = (t: Task) =>
    `- ${t.key ?? "(no key)"} "${t.title}"${t.checklist.length ? ` · checklist ${t.checklist.filter((i) => i.done).length}/${t.checklist.length}` : ""} · ${t.priority}${t.assignees.length ? ` · ${t.assignees.map((a) => a.name).join(", ")}` : ""}${t.dueDate ? ` · due ${t.dueDate}` : ""}${t.label ? ` · ${t.label}` : ""}`;
  // ponytail: whole board in the prompt, capped per column; search/tool calls if boards outgrow it.
  return [
    `Project: ${project}. Today: ${today}.`,
    `Members: ${members.map((m) => m.name).join(", ") || "none"}.`,
    ...columns.map((c) => [`\nColumn "${c.title}" (${c.tasks.length} tasks):`, ...c.tasks.slice(0, 100).map(line)].join("\n")),
  ].join("\n");
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);

/** Exact (case-insensitive) match first, else the single item that contains the name. */
function pick<T>(items: T[], name: unknown, nameOf: (item: T) => string): T | undefined {
  const want = norm(name);
  if (!want) return undefined;
  const exact = items.find((i) => norm(nameOf(i)) === want);
  if (exact) return exact;
  const loose = items.filter((i) => norm(nameOf(i)).includes(want));
  return loose.length === 1 ? loose[0] : undefined;
}

/**
 * Turns the model's `actions` into operations on this board. Anything it can't pin
 * down (unknown column, ambiguous member…) becomes an error line instead of a guess.
 */
export function resolveActions(raw: unknown, columns: Column[], members: Member[]) {
  const ops: AgentOp[] = [];
  const errors: string[] = [];
  const tasks = columns.flatMap((c) => c.tasks);
  const list = Array.isArray(raw) ? raw.slice(0, MAX_OPS) : [];
  const findTask = (name: unknown) => tasks.find((t) => t.key && norm(t.key) === norm(name)) ?? pick(tasks, name, (t) => t.title);

  for (const a of list as Record<string, unknown>[]) {
    if (!a || typeof a !== "object") continue;
    const label = `"${String(a.title ?? a.task ?? "?")}"`;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(a, k);

    let columnId: string | null = null;
    if (has("column") && a.column != null) {
      const col = pick(columns, a.column, (c) => c.title);
      if (!col) { errors.push(`${label}: no column named "${a.column}".`); continue; }
      columnId = col.id;
    }
    let assigneeId: string | null | undefined;
    if (has("assignee")) {
      if (a.assignee == null || a.assignee === "") assigneeId = null;
      else {
        const m = pick(members, a.assignee, (x) => x.name);
        if (!m) { errors.push(`${label}: no single member matches "${a.assignee}".`); continue; }
        assigneeId = m.id;
      }
    }
    if (has("priority") && !PRIORITIES.includes(norm(a.priority))) { errors.push(`${label}: invalid priority "${a.priority}".`); continue; }
    if (has("due") && a.due != null && a.due !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(a.due))) { errors.push(`${label}: invalid due date "${a.due}".`); continue; }
    const due = has("due") ? text(a.due, 10) : undefined;

    if (a.op === "sheet") {
      const name = text(a.name, 80) ?? "Agent flow";
      ops.push({ op: "sheet", name, flow: a.flow, summary: `Drew "${name}" on a new canvas sheet` });
      continue;
    }
    if (a.op === "message") {
      const body = text(a.text, 4000);
      if (!body) { errors.push("An empty chat message was skipped."); continue; }
      if (a.to == null || norm(a.to) === "all") { ops.push({ op: "message", to: null, text: body, summary: "Posted in the workspace chat" }); continue; }
      const m = pick(members, a.to, (x) => x.name);
      if (!m) { errors.push(`Message: no single member matches "${a.to}".`); continue; }
      ops.push({ op: "message", to: m.id, text: body, summary: `Sent a message to ${m.name}` });
      continue;
    }
    if (a.op === "column") {
      const title = text(a.title, 60);
      if (!title) { errors.push("A column without a title was skipped."); continue; }
      ops.push({ op: "column", title, summary: `Added column "${title}"` });
      continue;
    }
    if (a.op === "checklist" || a.op === "comment" || a.op === "archive") {
      const task = findTask(a.task);
      if (!task) { errors.push(`No task matches "${a.task}".`); continue; }
      const name = task.key ?? `"${task.title}"`;
      if (a.op === "archive") { ops.push({ op: "archive", taskId: task.id, summary: `Archived ${name}` }); continue; }
      if (a.op === "comment") {
        const body = text(a.text, 5000);
        if (!body) { errors.push(`${name}: an empty comment was skipped.`); continue; }
        ops.push({ op: "comment", taskId: task.id, text: body, summary: `Commented on ${name}` });
        continue;
      }
      const added = (Array.isArray(a.items) ? a.items : []).map((i) => text(i, 300)).filter((i): i is string => !!i);
      if (!added.length) { errors.push(`${name}: no checklist items given.`); continue; }
      ops.push({
        op: "checklist", taskId: task.id, items: [...task.checklist, ...added.map((t) => ({ text: t, done: false }))],
        summary: `Added ${added.length} checklist item${added.length === 1 ? "" : "s"} to ${name}`,
      });
      continue;
    }

    if (a.op === "create") {
      const title = text(a.title, 200);
      if (!title) { errors.push("A task without a title was skipped."); continue; }
      const col = columnId ? columns.find((c) => c.id === columnId)! : columns[0];
      if (!col) { errors.push(`${label}: the project has no columns.`); continue; }
      ops.push({
        op: "create",
        columnId: col.id,
        fields: {
          title,
          description: text(a.description, 5000),
          label: text(a.label, 40),
          priority: (has("priority") ? norm(a.priority) : "medium") as TaskFields["priority"],
          assigneeIds: assigneeId ? [assigneeId] : [],
          dueDate: due ?? null,
          repeat: null,
        },
        summary: `Created "${title}" in ${col.title}`,
      });
    } else if (a.op === "update") {
      const task = findTask(a.task);
      if (!task) { errors.push(`No task matches "${a.task}".`); continue; }
      const moveTo = columnId && columnId !== task.columnId ? columnId : null;
      ops.push({
        op: "update",
        taskId: task.id,
        moveTo,
        fields: {
          title: text(a.title, 200) ?? task.title,
          description: has("description") ? text(a.description, 5000) : task.description,
          label: has("label") ? text(a.label, 40) : task.label,
          priority: (has("priority") ? norm(a.priority) : task.priority) as TaskFields["priority"],
          // "assignee" replaces the whole list with one person; left out, everyone stays.
          assigneeIds: assigneeId === undefined ? task.assignees.map((a) => a.id) : assigneeId ? [assigneeId] : [],
          dueDate: due === undefined ? task.dueDate : due,
          repeat: task.repeat,
        },
        summary: `Updated ${task.key ?? `"${task.title}"`}${moveTo ? ` → ${columns.find((c) => c.id === moveTo)!.title}` : ""}`,
      });
    }
  }
  return { ops, errors };
}
