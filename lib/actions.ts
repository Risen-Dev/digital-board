"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { all, get, run, transaction } from "./db";
import { createUser, createWorkspace, currentUser, endSession, login, passwordOf, setPassword, startSession, verifyPassword, type User } from "./auth";
import { cleanFilters, FIELD_TYPES, fieldOptionsOf, fieldValuesOf, joinLabels, LAYOUTS, nextDue, parseDuration, projectKeyOf, PROJECT_KEY_RE, REPEATS, templateOf, PALETTE, PRIORITIES, reorder, type CheckItem, type CustomField, type FieldType, type Filters, type Layout, type Member, type Priority, type Repeat } from "./board";
import { broadcast } from "./canvas/hub";
import { projectRole } from "./canvas/guard";
import { notify } from "./outgoing";
import { AGENT_MENTION } from "./chat";
import { nudgeBoard } from "./chat-live";
import { answerOnCard } from "./card-agent";
import { nextTaskNumber, relocateTask } from "./tasks";
import { DONE_COLUMN } from "./queries";
import { cleanImport, type Imported } from "./trello";
import { appUrl, mailEnabled, sendMail } from "./mail";
import { mentionedIn, pushTo } from "./push";
import { MEETING_REPEATS, safeLink, type MeetingRepeat } from "./meetings";
import type { Flow } from "./canvas/flow";
import examplesData from "./template-examples.json";

/** Example data per template id, generated from the JSON blocks in templates.md. */
type TemplateExamples = Record<string, {
  tasks: { column: string; title: string; label: string; priority: Priority; description?: string; dueInDays?: number }[];
  canvas: { title: string; flow: Flow };
}>;

async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

const now = () => new Date().toISOString();

/** Re-renders this tab and nudges the rest of the workspace to refresh. */
function changed(user: User) {
  revalidatePath("/board");
  nudgeBoard(user.workspace_id, user.id);
}

async function logEvent(taskId: string, actorId: string | null, text: string, kind: "event" | "comment" = "event") {
  await run("INSERT INTO task_events (task_id, actor_id, text, at, kind) VALUES (?,?,?,?,?)", taskId, actorId, text, now(), kind);
}

/** May change tasks and canvas sheets. */
async function canEdit(user: User, projectId: string | undefined) {
  const role = projectId && await projectRole(user, projectId);
  return !!role && role !== "viewer";
}

/** May rename the project and manage its columns and GitHub link. */
async function canManage(user: User, projectId: string | undefined) {
  const role = projectId && await projectRole(user, projectId);
  return role === "workspace-admin" || role === "admin";
}

const projectOfColumn = async (columnId: string) =>
  (await get<{ project_id: string }>("SELECT project_id FROM columns WHERE id = ?", columnId))?.project_id;

const writableColumn = async (user: User, columnId: string) => canEdit(user, await projectOfColumn(columnId));

// ── Registration ────────────────────────────────────────────────────────────

/**
 * Creates a workspace and its first admin. Open to anyone by default — set
 * REGISTRATION_CLOSED=1 to make this instance invite-only, which leaves the
 * existing workspaces working and refuses new ones.
 */
export async function registerAction(_prev: unknown, form: FormData) {
  if (process.env.REGISTRATION_CLOSED === "1") return { error: "This instance is not accepting new workspaces." };

  const workspace = String(form.get("workspace") ?? "").trim();
  const project = String(form.get("project") ?? "").trim();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const columns = form.getAll("columns").map(String).filter(Boolean);

  if (!workspace || !project || !name || !email || !password) return { error: "All fields are required." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "That email address isn't valid." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (columns.length === 0) return { error: "Pick at least one column." };

  if (await get("SELECT 1 FROM users WHERE lower(email) = lower(?)", email)) {
    return { error: "That email already has an account. Sign in instead." };
  }

  // One transaction: a half-made workspace with no admin is unreachable forever.
  let userId = "";
  await transaction(async () => {
    const workspaceId = await createWorkspace(workspace);
    userId = await createUser(workspaceId, email, name, password, true);

    const projectId = randomUUID();
    await run(
      "INSERT INTO projects (id, workspace_id, name, key, position, created_at) VALUES (?,?,?,?,0,?)",
      projectId, workspaceId, project, projectKeyOf(project), now(),
    );
    await seedProject(projectId, form.get("template"), columns, form.get("examples") === "on", userId);
  });

  await startSession(userId);
  redirect("/board");
}

/**
 * Seeds a new project from its template: the columns (`titles`, or all of the
 * template's), and with `examples` its starter tasks plus one canvas sheet. The
 * sheet stores only the flow; the canvas draws it on first open (`seed`).
 */
async function seedProject(projectId: string, templateId: unknown, titles: string[] | null, examples: boolean, actorId: string) {
  const template = templateOf(templateId);
  const columnIds = new Map<string, string>();
  for (const [i, title] of (titles ?? template.columns.map((c) => c.title)).entries()) {
    const id = randomUUID();
    columnIds.set(title, id);
    await run(
      "INSERT INTO columns (id, project_id, title, color, position) VALUES (?,?,?,?,?)",
      id, projectId, title, template.columns.find((c) => c.title === title)?.color ?? "var(--muted-foreground)", i,
    );
  }
  // The Tech template is a sprint board: it starts with a two-week sprint.
  const sprintId = template.id === "tech" ? randomUUID() : null;
  if (sprintId) {
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    await run("INSERT INTO sprints (id, project_id, name, start_date, end_date, created_at) VALUES (?,?,?,?,?,?)", sprintId, projectId, "Sprint 1", day(0), day(13), now());
  }
  if (!examples) return;

  const { tasks, canvas } = (examplesData as TemplateExamples)[template.id];
  const firstColumn = columnIds.values().next().value;
  const positions = new Map<string, number>();
  for (const t of tasks) {
    const columnId = columnIds.get(t.column);
    if (!columnId) continue; // that column was unticked at register
    const position = positions.get(columnId) ?? 0;
    positions.set(columnId, position + 1);
    const due = t.dueInDays === undefined ? null : new Date(Date.now() + t.dueInDays * 86_400_000).toLocaleDateString("en-CA");
    const id = randomUUID();
    await run(
      `INSERT INTO tasks (id, column_id, title, description, label, priority, assignee_id, due_date, position, number, created_at, sprint_id)
       VALUES (?,?,?,?,?,?,NULL,?,?,?,?,?)`,
      id, columnId, t.title, t.description ?? null, t.label, t.priority, due, position, await nextTaskNumber(projectId), now(),
      columnId === firstColumn ? null : sprintId, // backlog cards wait outside the sprint
    );
    await logEvent(id, actorId, "Task created");
  }
  await run(
    "INSERT INTO canvases (id, project_id, name, position, snapshot, updated_at) VALUES (?,?,?,0,?,?)",
    randomUUID(), projectId, canvas.title,
    JSON.stringify({ elements: [], seed: { flow: canvas.flow, by: `${template.name} template` } }), now(),
  );
}

// ── Auth ────────────────────────────────────────────────────────────────────

export async function loginAction(_prev: unknown, form: FormData) {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const id = await login(email, password);
  if (id === "locked") return { error: "Too many failed attempts. Try again in 15 minutes." };
  if (!id) return { error: "Wrong email or password." };
  await startSession(id);
  redirect("/board");
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

export async function inviteMember(_prev: unknown, form: FormData) {
  const user = await requireUser();
  if (!user.is_admin) return { error: "Only admins can add members." };

  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!name || !email || password.length < 8) return { error: "Name, email and a password of at least 8 characters are required." };
  if (await get("SELECT 1 FROM users WHERE email = ?", email.toLowerCase())) return { error: "That email is already registered." };

  // Project access chosen in the same form: `access:<projectId>` = viewer | editor | admin.
  const access = [...form.entries()].flatMap(([key, value]) =>
    key.startsWith("access:") && PROJECT_ROLES.includes(value as never) ? [[key.slice(7), String(value)] as const] : [],
  );
  await transaction(async () => {
    const userId = await createUser(user.workspace_id, email, name, password);
    for (const [projectId, role] of access) {
      // Only this workspace's projects; anything else is silently dropped.
      if (await projectRole(user, projectId) === null) continue;
      await run("INSERT INTO project_members (project_id, user_id, role) VALUES (?,?,?)", projectId, userId, role);
    }
  });
  changed(user);
  return { ok: true };
}

const PROJECT_ROLES = ["admin", "editor", "viewer"];

// ── Passwords ───────────────────────────────────────────────────────────────
// You change your own with your current password, a workspace admin sets a
// member's, or — when SMTP_URL + APP_URL are set — an emailed one-hour link.
// All drop that user's sessions, so a stolen one dies with the password. Locked
// out of the admin account with no mail? scripts/reset-password.mjs on the
// machine holding the database.

export async function changeMyPassword(_prev: unknown, form: FormData) {
  const user = await requireUser();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (next.length < 8) return { error: "New password must be at least 8 characters." };

  const row = await passwordOf(user.id);
  if (!row || !verifyPassword(current, row.password_hash)) return { error: "Current password is wrong." };

  await setPassword(user.id, next);
  // setPassword drops every session including this one; start a fresh one so
  // changing your password does not sign you out of the tab you did it in.
  await startSession(user.id);
  return { ok: true };
}

export async function setMemberPassword(userId: string, password: string) {
  const user = await requireUser();
  if (!user.is_admin) return { error: "Only workspace admins can set a member's password." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const target = await get<{ workspace_id: string }>("SELECT workspace_id FROM users WHERE id = ?", userId);
  if (!target || target.workspace_id !== user.workspace_id) return { error: "No such member." };

  await setPassword(userId, password);
  if (userId === user.id) await startSession(user.id);
  changed(user);
  return { ok: true };
}

const RESET_MS = 60 * 60_000;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Always answers the same, so the form can't be used to probe which emails exist. */
export async function requestPasswordReset(_prev: unknown, form: FormData) {
  if (!mailEnabled()) return { error: "Password reset by email is not set up on this server." };
  const email = String(form.get("email") ?? "").toLowerCase().trim();
  const user = await get<{ id: string; name: string }>("SELECT id, name FROM users WHERE email = ?", email);
  // One mail per user per 5 minutes, so the form can't flood someone's inbox.
  const recentSent = user && await get(
    "SELECT 1 FROM password_resets WHERE user_id = ? AND created_at > ?", user.id, new Date(Date.now() - 5 * 60_000).toISOString());
  if (user && !recentSent) {
    const token = randomBytes(32).toString("hex");
    const now = Date.now();
    await run("DELETE FROM password_resets WHERE user_id = ?", user.id);
    await run("INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)",
      sha256(token), user.id, new Date(now).toISOString(), new Date(now + RESET_MS).toISOString());
    try {
      await sendMail(email, "Reset your Digital Board password",
        `Hi ${user.name},\n\nOpen this link within an hour to choose a new password:\n${appUrl(`/reset?token=${token}`)}\n\nIf you didn't ask for this, ignore this email.`);
    } catch (err) {
      console.error("password reset mail failed", err);
      return { error: "Could not send the email. Ask a workspace admin to check the mail settings." };
    }
  }
  return { ok: true };
}

export async function resetPassword(_prev: unknown, form: FormData) {
  const token = String(form.get("token") ?? "");
  const next = String(form.get("next") ?? "");
  if (next.length < 8) return { error: "New password must be at least 8 characters." };
  const row = await get<{ user_id: string }>(
    "SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?", sha256(token), new Date().toISOString());
  if (!row) return { error: "This link is invalid or has expired. Ask for a new one." };
  await run("DELETE FROM password_resets WHERE user_id = ?", row.user_id);
  await setPassword(row.user_id, next);
  await startSession(row.user_id);
  redirect("/board");
}

// ── Tasks ───────────────────────────────────────────────────────────────────

/** Priority drives a style lookup on every card, and every assignee must be a colleague. */
async function invalidTaskFields(user: Awaited<ReturnType<typeof requireUser>>, priority: string, assignees: string[], repeat: string | null) {
  if (!PRIORITIES.includes(priority as Priority)) return "Invalid priority.";
  if (repeat && !REPEATS.includes(repeat as Repeat)) return "Invalid repeat.";
  if (assignees.length && (await get<{ n: number }>(
    "SELECT COUNT(*) n FROM users WHERE id = ANY(?::text[]) AND workspace_id = ?", assignees, user.workspace_id,
  ))!.n !== assignees.length) {
    return "An assignee is not in this workspace.";
  }
  return null;
}

/** The task form's fields; assignees come as repeated `assigneeIds`. */
const taskFieldsOf = (form: FormData) => ({
  description: String(form.get("description") ?? "").trim() || null,
  label: joinLabels(String(form.get("label") ?? "")),
  dueDate: String(form.get("dueDate") ?? "").trim() || null,
  startDate: String(form.get("startDate") ?? "").trim() || null,
  sprintId: String(form.get("sprintId") ?? "").trim() || null,
  assignees: [...new Set(form.getAll("assigneeIds").map(String).filter(Boolean))],
  repeat: String(form.get("repeat") ?? "").trim() || null,
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** An error for dates the timeline can't draw: not YYYY-MM-DD, or a start after the due date. */
const badDates = (start: string | null, due: string | null) =>
  (start && !DATE_RE.test(start)) || (due && !DATE_RE.test(due)) ? "Dates must be YYYY-MM-DD."
  : start && due && start > due ? "The start date must be on or before the due date." : null;

/** The sprint's name when it is an open sprint of `projectId`; undefined otherwise. */
const openSprintName = async (projectId: string, sprintId: string) =>
  (await get<{ name: string }>("SELECT name FROM sprints WHERE id = ? AND project_id = ? AND closed_at IS NULL", sprintId, projectId))?.name;

async function setAssignees(taskId: string, userIds: string[]) {
  await run("DELETE FROM task_assignees WHERE task_id = ?", taskId);
  for (const userId of userIds) await run("INSERT INTO task_assignees (task_id, user_id) VALUES (?,?)", taskId, userId);
}

/** The task's column when this user may edit it, else null. */
async function writableTask(user: User, taskId: string) {
  const task = await get<{ column_id: string }>("SELECT column_id FROM tasks WHERE id = ?", taskId);
  return task && await writableColumn(user, task.column_id) ? task.column_id : null;
}

/** Column colours land in inline styles, so only the editor's own swatches are accepted. */
const COLUMN_COLORS = ["var(--muted-foreground)", ...PALETTE];

/** A column's stage limit: whole days 1–365, or null for none. */
const validLimit = (days: number | null) => days === null || (Number.isInteger(days) && days >= 1 && days <= 365);

export async function createTask(_prev: unknown, form: FormData) {
  const user = await requireUser();
  const columnId = String(form.get("columnId") ?? "");
  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "Title is required." };
  if (!await writableColumn(user, columnId)) return { error: "You cannot edit this project." };

  const priority = String(form.get("priority") ?? "medium") as Priority;
  const { description, label, dueDate, startDate, sprintId, assignees, repeat } = taskFieldsOf(form);
  const invalid = badDates(startDate, dueDate) ?? await invalidTaskFields(user, priority, assignees, repeat);
  if (invalid) return { error: invalid };
  if (sprintId && !await openSprintName((await projectOfColumn(columnId))!, sprintId)) return { error: "Pick an open sprint of this project." };
  const read = fieldValuesOf((k) => form.get(k), await fieldsOfColumn(columnId));
  if ("error" in read) return { error: read.error };
  const fields = read.values;

  const id = randomUUID();
  await transaction(async () => {
    const { project_id } = (await get<{ project_id: string }>("SELECT project_id FROM columns WHERE id = ?", columnId))!;
    const next = ((await get<{ n: number }>("SELECT COALESCE(MAX(position) + 1, 0) n FROM tasks WHERE column_id = ?", columnId)))!.n;
    await run(
      `INSERT INTO tasks (id, column_id, title, description, label, priority, due_date, start_date, sprint_id, repeat, position, number, created_at, fields)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, columnId, title, description, label, priority, dueDate, startDate, sprintId, repeat, next, await nextTaskNumber(project_id), now(), JSON.stringify(fields),
    );
    await setAssignees(id, assignees);
    await logEvent(id, user.id, "Task created");
  });
  await notify("task.created", id, "Task created", user.name);
  changed(user);
  return { ok: true };
}

/** Move or reorder. Renumbers both affected columns so positions stay dense. */
export async function moveTask(taskId: string, toColumnId: string, toIndex: number) {
  const user = await requireUser();
  const task = await get<{ column_id: string; title: string }>("SELECT column_id, title FROM tasks WHERE id = ?", taskId);
  const dest = await get<{ title: string }>("SELECT title FROM columns WHERE id = ?", toColumnId);
  if (!task || !dest || !await writableColumn(user, task.column_id) || !await writableColumn(user, toColumnId)) return;

  const fromColumnId = task.column_id;
  const fromTitle = ((await get<{ title: string }>("SELECT title FROM columns WHERE id = ?", fromColumnId)))?.title ?? "?";

  await transaction(async () => {
    await relocateTask(taskId, fromColumnId, toColumnId, toIndex);
    await logEvent(
      taskId,
      user.id,
      fromColumnId === toColumnId ? `Reordered in ${dest.title}` : `Moved from ${fromTitle} to ${dest.title}`,
    );
  });
  if (fromColumnId !== toColumnId) await notify("task.moved", taskId, `Moved from ${fromTitle} to ${dest.title}`, user.name);
  if (fromColumnId !== toColumnId) await repeatTask(taskId, toColumnId, user);
  if (fromColumnId !== toColumnId) await announceUnblocked(taskId, toColumnId, user);

  changed(user);
}

/**
 * A repeating card that reaches the project's done column gets its next copy in the
 * first column, due one period later, with the checklist unticked. The rule moves to
 * the copy, so dragging the old card back and forth never spawns a second one.
 */
async function repeatTask(taskId: string, toColumnId: string, user: User) {
  const task = await get<{ title: string; description: string | null; label: string | null; priority: string; due_date: string | null;
    repeat: Repeat | null; checklist: CheckItem[]; project_id: string; key: string }>(
    `SELECT t.title, t.description, t.label, t.priority, t.due_date, t.repeat, t.checklist, c.project_id, p.key || '-' || t.number AS key
       FROM tasks t JOIN columns c ON c.id = t.column_id JOIN projects p ON p.id = c.project_id WHERE t.id = ?`,
    taskId,
  );
  if (!task?.repeat) return;
  const { first, done } = (await get<{ first: string; done: string }>(
    `SELECT (SELECT id FROM columns WHERE project_id = p.id ORDER BY position LIMIT 1) AS first, ${DONE_COLUMN} AS done
       FROM projects p WHERE p.id = ?`,
    task.project_id,
  ))!;
  if (toColumnId !== done || first === toColumnId) return;

  const id = randomUUID();
  const due = nextDue(task.due_date ?? new Date().toISOString().slice(0, 10), task.repeat);
  await transaction(async () => {
    await run("UPDATE tasks SET repeat = NULL WHERE id = ?", taskId);
    const next = (await get<{ n: number }>("SELECT COALESCE(MAX(position) + 1, 0) n FROM tasks WHERE column_id = ?", first))!.n;
    await run(
      `INSERT INTO tasks (id, column_id, title, description, label, priority, due_date, repeat, checklist, position, number, created_at)
       VALUES (?,?,?,?,?,?,?,?,?::jsonb,?,?,?)`,
      id, first, task.title, task.description, task.label, task.priority, due, task.repeat,
      JSON.stringify(task.checklist.map((i) => ({ ...i, done: false }))), next, await nextTaskNumber(task.project_id), now(),
    );
    await run("INSERT INTO task_assignees (task_id, user_id) SELECT ?, user_id FROM task_assignees WHERE task_id = ?", id, taskId);
    await logEvent(id, user.id, `Repeats ${task.repeat}: created after ${task.key} was done`);
  });
  await notify("task.created", id, `Repeats ${task.repeat}`, user.name);
}

export async function updateTask(_prev: unknown, form: FormData) {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const before = await get<{ column_id: string; title: string; description: string | null; label: string | null; priority: string;
    due_date: string | null; start_date: string | null; sprint_id: string | null; repeat: string | null; assignees: string[]; fields: Record<string, string> }>(
    `SELECT column_id, title, description, label, priority, due_date, start_date, sprint_id, repeat, fields,
            ARRAY(SELECT user_id FROM task_assignees WHERE task_id = t.id) AS assignees
       FROM tasks t WHERE id = ?`,
    id,
  );
  if (!before || !await writableColumn(user, before.column_id)) return { error: "You cannot edit this project." };

  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "Title is required." };
  const priority = String(form.get("priority") ?? before.priority);
  const { description, label, dueDate, startDate, sprintId, assignees, repeat } = taskFieldsOf(form);
  const invalid = badDates(startDate, dueDate) ?? await invalidTaskFields(user, priority, assignees, repeat);
  if (invalid) return { error: invalid };
  // A card may stay in its (now closed) sprint; joining one needs it open.
  const sprintName = sprintId && sprintId !== before.sprint_id ? await openSprintName((await projectOfColumn(before.column_id))!, sprintId) : null;
  if (sprintId && sprintId !== before.sprint_id && !sprintName) return { error: "Pick an open sprint of this project." };
  const read = fieldValuesOf((k) => form.get(k), await fieldsOfColumn(before.column_id));
  if ("error" in read) return { error: read.error };
  const fields = read.values;

  const assigneesChanged = [...assignees].sort().join() !== [...before.assignees].sort().join();
  await transaction(async () => {
    await run(
      "UPDATE tasks SET title = ?, description = ?, label = ?, priority = ?, due_date = ?, start_date = ?, sprint_id = ?, repeat = ?, fields = ? WHERE id = ?",
      title, description, label, priority, dueDate, startDate, sprintId, repeat, JSON.stringify(fields), id,
    );
    if (assigneesChanged) await setAssignees(id, assignees);
  });
  const changes: string[] = [];
  if (before.title !== title) changes.push(`Title changed to "${title}"`);
  if (before.description !== description) changes.push("Details updated");
  if (before.label !== label) changes.push(label ? `Labels set to ${label}` : "Labels cleared");
  if (before.priority !== priority) changes.push(`Priority changed to ${priority}`);
  if (assigneesChanged) {
    const names = (await all<{ name: string }>("SELECT name FROM users WHERE id = ANY(?::text[]) ORDER BY name", assignees)).map((u) => u.name);
    changes.push(names.length ? `Assigned to ${names.join(", ")}` : "Assignees cleared");
  }
  if (before.sprint_id !== sprintId) changes.push(sprintId ? `Added to ${sprintName}` : "Moved to the backlog");
  if (before.start_date !== startDate) changes.push(startDate ? `Start date set to ${startDate}` : "Start date cleared");
  if (before.due_date !== dueDate) changes.push(dueDate ? `Due date set to ${dueDate}` : "Due date cleared");
  if (before.repeat !== repeat) changes.push(repeat ? `Repeats ${repeat}` : "Repeat turned off");
  if (JSON.stringify(Object.entries(before.fields).sort()) !== JSON.stringify(Object.entries(fields).sort())) changes.push("Custom fields updated");
  for (const c of changes) await logEvent(id, user.id, c);
  if (changes.length) await notify("task.updated", id, changes.join("; "), user.name);

  changed(user);
  return { ok: true };
}

export async function deleteTask(id: string) {
  const user = await requireUser();
  const task = await get<{ column_id: string }>("SELECT column_id FROM tasks WHERE id = ?", id);
  const projectId = task && await projectOfColumn(task.column_id);
  if (!projectId || !await canEdit(user, projectId)) return;
  await notify("task.deleted", id, "Task deleted", user.name); // before the row is gone
  const undo = await transaction(async () => {
    const undo = await trash(user, projectId, "id", id);
    await run("DELETE FROM tasks WHERE id = ?", id);
    return undo;
  });
  changed(user);
  return { undo };
}

// Rows that hang off a card, restored in this order after `columns` and `tasks`.
const TASK_CHILDREN = ["task_events", "task_links", "task_assignees", "task_images", "time_entries", "task_blockers"];

/**
 * Snapshots the cards with `by` = `id` (one card, or a whole column with its
 * column row) and their child rows into `trash`, inside the database, so the
 * deleter can undo. Returns the trash id. Run it in the deleting transaction.
 */
async function trash(user: User, projectId: string, by: "id" | "column_id", id: string) {
  const trashId = randomUUID();
  const children = TASK_CHILDREN.map((table) =>
    `'${table}', (SELECT COALESCE(jsonb_agg(x), '[]') FROM ${table} x WHERE x.task_id IN (SELECT id FROM t)${table === "task_blockers" ? " OR x.blocker_id IN (SELECT id FROM t)" : ""})`,
  ).join(",\n      ");
  const column = by === "column_id" ? id : null;
  await run(
    `WITH t AS (SELECT * FROM tasks WHERE ${by} = ?)
     INSERT INTO trash (id, user_id, project_id, payload)
     SELECT ?, ?, ?, jsonb_build_object(
      'columns', (SELECT COALESCE(jsonb_agg(c), '[]') FROM columns c WHERE c.id = ?),
      'done', (SELECT done_column_id = ? FROM projects WHERE id = ?),
      'tasks', (SELECT COALESCE(jsonb_agg(t), '[]') FROM t),
      -- Subtasks left behind lose their parent (ON DELETE SET NULL); undo links them again.
      'orphans', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', o.id, 'parent_id', o.parent_id)), '[]')
                    FROM tasks o WHERE o.parent_id IN (SELECT id FROM t) AND o.id NOT IN (SELECT id FROM t)),
      ${children})`,
    id, trashId, user.id, projectId, column, column, projectId,
  );
  await run("DELETE FROM trash WHERE at < now() - interval '1 day'");
  return trashId;
}

/** Puts back what deleteTask/deleteColumn removed; only for the person who deleted it. */
export async function restoreDeleted(trashId: string) {
  const user = await requireUser();
  const row = await get<{ project_id: string; column: boolean }>(
    "SELECT project_id, jsonb_array_length(payload->'columns') > 0 AS column FROM trash WHERE id = ? AND user_id = ?",
    trashId, user.id,
  );
  if (!row || !await (row.column ? canManage : canEdit)(user, row.project_id)) return { error: "Nothing to undo." };
  try {
    await transaction(async () => {
      for (const table of ["columns", "tasks", ...TASK_CHILDREN]) {
        await run(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table}, (SELECT payload->'${table}' FROM trash WHERE id = ?))`, trashId);
      }
      await run(
        `UPDATE tasks x SET parent_id = o.parent_id
           FROM jsonb_populate_recordset(NULL::tasks, (SELECT payload->'orphans' FROM trash WHERE id = ?)) o WHERE x.id = o.id`,
        trashId,
      );
      if (row.column) {
        await run(
          `UPDATE projects SET done_column_id = (SELECT payload->'columns'->0->>'id' FROM trash WHERE id = ?)
            WHERE id = ? AND (SELECT (payload->>'done')::boolean FROM trash WHERE id = ?)`,
          trashId, row.project_id, trashId,
        );
        // Other columns may have been renumbered since; the restored one goes back in front of its old neighbour.
        await run(
          `UPDATE columns c SET position = r.n FROM (
             SELECT id, ROW_NUMBER() OVER (ORDER BY position, id = (SELECT payload->'columns'->0->>'id' FROM trash WHERE id = ?) DESC) - 1 AS n
               FROM columns WHERE project_id = ?) r
            WHERE c.id = r.id`,
          trashId, row.project_id,
        );
      }
      await run("DELETE FROM trash WHERE id = ?", trashId);
    });
  } catch (err) {
    // Something it pointed at is gone or taken (its column, a blocker, a running timer).
    console.error("restore failed", err);
    return { error: "This can no longer be undone." };
  }
  changed(user);
  return { ok: true };
}

export async function archiveTask(id: string, archived: boolean) {
  const user = await requireUser();
  const columnId = await writableTask(user, id);
  if (!columnId) return;
  await transaction(async () => {
    // A restored card goes to the end of its column; archived ones are skipped by relocateTask.
    const end = (await get<{ n: number }>("SELECT COALESCE(MAX(position) + 1, 0) n FROM tasks WHERE column_id = ?", columnId))!.n;
    await run(
      `UPDATE tasks SET archived_at = ?, position = CASE WHEN ? THEN position ELSE ? END WHERE id = ?`,
      archived ? now() : null, archived, end, id,
    );
    await logEvent(id, user.id, archived ? "Archived" : "Restored from the archive");
  });
  await notify("task.updated", id, archived ? "Archived" : "Restored from the archive", user.name);
  changed(user);
}

/** Adds one assignee and keeps the others (bulk assign in List view). */
export async function addAssignee(taskId: string, userId: string) {
  const user = await requireUser();
  if (!await writableTask(user, taskId) || await invalidTaskFields(user, "low", [userId], null)) return;
  const added = await get("INSERT INTO task_assignees (task_id, user_id) VALUES (?,?) ON CONFLICT DO NOTHING RETURNING user_id", taskId, userId);
  if (!added) return;
  const name = (await get<{ name: string }>("SELECT name FROM users WHERE id = ?", userId))!.name;
  await logEvent(taskId, user.id, `Assigned to ${name}`);
  await notify("task.updated", taskId, `Assigned to ${name}`, user.name);
  changed(user);
}

/**
 * List view's bulk bar: one request for every selected card, each going through the
 * single-card action so permissions, history and webhooks stay the same.
 */
export async function bulkTasks(ids: string[], op: { move?: string; assign?: string; archive?: boolean }) {
  for (const id of ids.slice(0, 500)) {
    if (op.move) await moveTask(id, op.move, Number.MAX_SAFE_INTEGER);
    if (op.assign) await addAssignee(id, op.assign);
    if (op.archive) await archiveTask(id, true);
  }
}

export async function fetchArchived(projectId: string) {
  const user = await requireUser();
  if (await projectRole(user, projectId) === null) return [];
  const { archivedTasks } = await import("./queries");
  return archivedTasks(projectId);
}

/** Comments are task_events with kind 'comment'. Viewers may comment too: it changes no card field. */
export async function addComment(taskId: string, body: string) {
  const user = await requireUser();
  const text = body.trim().slice(0, 5000);
  const task = await get<{ project_id: string; title: string }>(
    "SELECT c.project_id, t.title FROM tasks t JOIN columns c ON c.id = t.column_id WHERE t.id = ?", taskId,
  );
  if (!text || !task || await projectRole(user, task.project_id) === null) return { error: "You cannot comment on this task." };
  await logEvent(taskId, user.id, text, "comment");
  after(async () => pushTo(await mentionedIn(user.workspace_id, text, user.id, task.project_id), {
    title: `${user.name} mentioned you`, body: `${task.title}: ${text}`.slice(0, 200),
    url: `/board?${new URLSearchParams({ project: task.project_id, task: taskId })}`,
  }));
  await notify("task.updated", taskId, `Comment: ${text}`, user.name);
  changed(user);
  return { ok: true, agent: AGENT_MENTION.test(text) };
}

/** The dialog calls this after a comment with "@agent", so the comment shows while the model thinks. */
export async function askCardAgent(taskId: string) {
  const user = await requireUser();
  const task = await get<{ project_id: string }>(
    "SELECT c.project_id FROM tasks t JOIN columns c ON c.id = t.column_id WHERE t.id = ?", taskId,
  );
  if (!task || await projectRole(user, task.project_id) === null) return;
  await answerOnCard(user, taskId);
  changed(user);
}

/** A card reached its done column: say so on every card that was waiting on it. */
async function announceUnblocked(taskId: string, columnId: string, user: User) {
  const done = await get<{ key: string }>(
    `SELECT p.key || '-' || t.number AS key FROM tasks t JOIN columns c ON c.id = t.column_id JOIN projects p ON p.id = c.project_id
      WHERE t.id = ? AND c.id = ? AND c.id = ${DONE_COLUMN}`,
    taskId, columnId,
  );
  if (!done) return;
  for (const { task_id } of await all<{ task_id: string }>("SELECT task_id FROM task_blockers WHERE blocker_id = ?", taskId)) {
    await logEvent(task_id, user.id, `${done.key} is done`);
  }
}

/**
 * "Blocked by": `taskId` waits on `blockerId`. Same project only, so a card never
 * shows the title of one its viewers can't open; a dependency loop is refused.
 */
export async function setBlocker(taskId: string, blockerId: string, blocked: boolean) {
  const user = await requireUser();
  if (!await writableTask(user, taskId)) return { error: "You cannot edit this task." };
  const pair = await all<{ id: string; project_id: string; key: string }>(
    `SELECT t.id, c.project_id, p.key || '-' || t.number AS key
       FROM tasks t JOIN columns c ON c.id = t.column_id JOIN projects p ON p.id = c.project_id
      WHERE t.id IN (?, ?) AND t.archived_at IS NULL`,
    taskId, blockerId,
  );
  const task = pair.find((t) => t.id === taskId), blocker = pair.find((t) => t.id === blockerId);
  if (!task || !blocker || taskId === blockerId || task.project_id !== blocker.project_id) return { error: "Pick another card in this project." };

  if (!blocked) {
    await run("DELETE FROM task_blockers WHERE task_id = ? AND blocker_id = ?", taskId, blockerId);
    await logEvent(taskId, user.id, `No longer blocked by ${blocker.key}`);
  } else {
    // Would the blocker (transitively) wait on this card? Then this edge closes a loop.
    const loop = await get(
      `WITH RECURSIVE up(id) AS (
         SELECT blocker_id FROM task_blockers WHERE task_id = ?
         UNION SELECT tb.blocker_id FROM task_blockers tb JOIN up ON tb.task_id = up.id
       ) SELECT 1 FROM up WHERE id = ?`,
      blockerId, taskId,
    );
    if (loop) return { error: `${blocker.key} already waits on this card.` };
    await run("INSERT INTO task_blockers (task_id, blocker_id) VALUES (?,?) ON CONFLICT DO NOTHING", taskId, blockerId);
    await logEvent(taskId, user.id, `Blocked by ${blocker.key}`);
  }
  changed(user);
  return { ok: true };
}

/** A new card under `parentId`, in the project's first column. One level deep: a subtask has no subtasks. */
export async function addSubtask(parentId: string, title: string) {
  const user = await requireUser();
  const clean = title.trim().slice(0, 500);
  const parent = await get<{ project_id: string; parent_id: string | null; key: string }>(
    `SELECT c.project_id, t.parent_id, p.key || '-' || t.number AS key
       FROM tasks t JOIN columns c ON c.id = t.column_id JOIN projects p ON p.id = c.project_id WHERE t.id = ?`,
    parentId,
  );
  if (!clean) return { error: "Title is required." };
  if (!parent || !await canEdit(user, parent.project_id)) return { error: "You cannot edit this task." };
  if (parent.parent_id) return { error: "A subtask cannot have subtasks." };
  const id = randomUUID();
  await transaction(async () => {
    const column = (await get<{ id: string }>("SELECT id FROM columns WHERE project_id = ? ORDER BY position LIMIT 1", parent.project_id))!;
    await run(
      `INSERT INTO tasks (id, column_id, title, priority, position, number, created_at, fields, parent_id)
       VALUES (?,?,?,'medium',(SELECT COALESCE(MAX(position) + 1, 0) FROM tasks WHERE column_id = ?),?,?,'{}',?)`,
      id, column.id, clean, column.id, await nextTaskNumber(parent.project_id), now(), parentId,
    );
    await logEvent(id, user.id, `Task created as a subtask of ${parent.key}`);
    await logEvent(parentId, user.id, `Subtask added: ${clean}`);
  });
  await notify("task.created", id, "Task created", user.name);
  changed(user);
  return { ok: true };
}

/** Saves the whole checklist; the dialog sends it after every tick, add or delete. */
// ponytail: last write wins; two people ticking the same card at once can undo each other.
export async function setChecklist(taskId: string, items: CheckItem[]) {
  const user = await requireUser();
  if (!await writableTask(user, taskId)) return;
  const clean = (Array.isArray(items) ? items : []).slice(0, 100)
    .map((i) => ({ text: String(i?.text ?? "").trim().slice(0, 300), done: i?.done === true }))
    .filter((i) => i.text);
  await run("UPDATE tasks SET checklist = ?::jsonb WHERE id = ?", JSON.stringify(clean), taskId);
  changed(user);
}

export async function setProjectMember(projectId: string, userId: string, role: "admin" | "editor" | "viewer" | "") {
  const user = await requireUser();
  if (!user.is_admin) return { error: "Only workspace admins can assign projects." };
  if (await projectRole(user, projectId) === null) return { error: "No such project." };
  if (!await get("SELECT 1 FROM users WHERE id = ? AND workspace_id = ?", userId, user.workspace_id)) return { error: "No such member." };
  if (role === "") await run("DELETE FROM project_members WHERE project_id = ? AND user_id = ?", projectId, userId);
  else await run(
    `INSERT INTO project_members (project_id, user_id, role) VALUES (?,?,?)
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = excluded.role`,
    projectId, userId, role,
  );
  changed(user);
  return { ok: true };
}

/**
 * Adds the imported columns and cards to a project. An imported column whose title matches an
 * existing one (ignoring case) reuses it; the rest are added after it. Cards go below the
 * cards already there. Members are matched to workspace members by name, ignoring case;
 * unknown names are dropped. Comments are not imported.
 */
async function seedImport(projectId: string, data: Imported, user: User) {
  const existing = await all<{ id: string; title: string; n: number }>(
    `SELECT c.id, c.title, (SELECT COALESCE(MAX(position) + 1, 0) FROM tasks WHERE column_id = c.id) n
       FROM columns c WHERE c.project_id = ? ORDER BY c.position`, projectId,
  );
  const columnIds = new Map(existing.map((c) => [c.title.trim().toLowerCase(), c.id]));
  const positions = new Map(existing.map((c) => [c.id, c.n]));
  for (const title of data.columns) {
    if (columnIds.has(title.toLowerCase())) continue;
    const id = randomUUID();
    const i = columnIds.size;
    columnIds.set(title.toLowerCase(), id);
    await run(
      "INSERT INTO columns (id, project_id, title, color, position) VALUES (?,?,?,?,?)",
      id, projectId, title, COLUMN_COLORS[i % COLUMN_COLORS.length], i,
    );
  }
  const members = await all<{ id: string; name: string }>("SELECT id, name FROM users WHERE workspace_id = ?", user.workspace_id);
  const memberId = new Map(members.map((m) => [m.name.trim().toLowerCase(), m.id]));
  for (const c of data.cards) {
    const columnId = columnIds.get(c.column.toLowerCase())!;
    const position = positions.get(columnId) ?? 0;
    positions.set(columnId, position + 1);
    const id = randomUUID();
    await run(
      `INSERT INTO tasks (id, column_id, title, description, label, priority, due_date, checklist, archived_at, position, number, created_at)
       VALUES (?,?,?,?,?,'medium',?,?::jsonb,?,?,?,?)`,
      id, columnId, c.title, c.description, c.label, c.dueDate, JSON.stringify(c.checklist),
      c.archived ? now() : null, position, await nextTaskNumber(projectId), now(),
    );
    // No per-card history event: hundreds of "Imported" lines would flood everyone's bell and Inbox.
    await setAssignees(id, [...new Set(c.members.map((m) => memberId.get(m.toLowerCase())).filter((m) => m !== undefined))]);
  }
}

export async function addProject(name: string, templateId?: string, examples = false, imported?: Imported) {
  const user = await requireUser();
  if (!user.is_admin) return { error: "Only workspace admins can create projects." };
  const clean = name.trim();
  if (!clean) return { error: "Project name is required." };
  const data = imported === undefined ? null : cleanImport(imported);
  if (imported !== undefined && !data) return { error: "Nothing to import from that file." };

  const id = randomUUID();
  const next = (await get<{ n: number }>(
    "SELECT COALESCE(MAX(position) + 1, 0) n FROM projects WHERE workspace_id = ?", user.workspace_id,
  ))!.n;
  await transaction(async () => {
    await run(
      "INSERT INTO projects (id, workspace_id, name, key, position, created_at) VALUES (?,?,?,?,?,?)",
      id, user.workspace_id, clean, projectKeyOf(clean), next, now(),
    );
    // A project with no columns is a dead end, so seed the template's.
    if (data?.columns.length) await seedImport(id, data, user);
    else await seedProject(id, templateId, null, examples, user.id);
  });
  changed(user);
  return { ok: true, id };
}

/**
 * Imports a Trello/CSV board into an existing project. `replace` first deletes every column
 * and card (archived ones too, with their history and comments), so the board becomes the
 * file's lists in its order; otherwise matching columns are reused and the rest appended.
 */
export async function importIntoProject(projectId: string, imported: Imported, replace: boolean) {
  const user = await requireUser();
  if (!await canManage(user, projectId)) return { error: "Only project admins can import." };
  const data = cleanImport(imported);
  if (!data) return { error: "Nothing to import from that file." };
  await transaction(async () => {
    // cleanImport always returns at least one column, so the board never ends up empty.
    if (replace) await run("DELETE FROM columns WHERE project_id = ?", projectId);
    await seedImport(projectId, data, user);
  });
  changed(user);
  return { ok: true, cards: data.cards.length };
}

/** Removes the project and everything under it: columns, tasks, history, canvas sheets. */
export async function deleteProject(id: string) {
  const user = await requireUser();
  if (!user.is_admin) return { error: "Only admins can delete a project." };
  if ((await get<{ n: number }>("SELECT COUNT(*) n FROM projects WHERE workspace_id = ?", user.workspace_id))!.n <= 1) {
    return { error: "A workspace needs at least one project." };
  }
  await run("DELETE FROM projects WHERE id = ? AND workspace_id = ?", id, user.workspace_id);
  changed(user);
  return { ok: true };
}

export async function renameWorkspace(name: string) {
  const user = await requireUser();
  if (!user.is_admin) return { error: "Only workspace admins can rename the workspace." };
  const clean = name.trim();
  if (!clean) return { error: "Workspace name is required." };
  await run("UPDATE workspaces SET name = ? WHERE id = ?", clean, user.workspace_id);
  changed(user);
  return { ok: true };
}

/**
 * Makes a new webhook secret for the project's GitHub link and returns it once;
 * afterwards only its last 4 characters are ever shown. The old secret stops working.
 */
export async function rotateGithubWebhook(projectId: string) {
  const user = await requireUser();
  if (!await canManage(user, projectId)) return { error: "You cannot manage this project." };
  const { githubConfig } = await import("./github");
  const saved = await githubConfig(projectId);
  if (!saved) return { error: "Connect a repository first." };
  const webhookSecret = randomBytes(24).toString("hex");
  await run("UPDATE projects SET github = ? WHERE id = ?", JSON.stringify({ ...saved, webhookSecret }), projectId);
  changed(user);
  return { secret: webhookSecret };
}

/**
 * Makes a new token for the project's inbound webhook and returns it once; only
 * its hash is stored. The old token stops working.
 */
export async function rotateInboundToken(projectId: string) {
  const user = await requireUser();
  if (!await canManage(user, projectId)) return { error: "You cannot manage this project." };
  const token = randomBytes(24).toString("hex");
  await run("UPDATE projects SET inbound_token = ? WHERE id = ?", createHash("sha256").update(token).digest("hex"), projectId);
  changed(user);
  return { token };
}

/**
 * The project's iCal feed token, made on first use. Anyone who can open the project
 * may read it; `reset` (managers only) makes a new one so old links stop working.
 */
export async function calendarFeedToken(projectId: string, reset = false) {
  const user = await requireUser();
  if (reset ? !await canManage(user, projectId) : !await projectRole(user, projectId)) return { error: "You cannot do that in this project." };
  // COALESCE keeps two first opens from handing out different tokens.
  const row = await get<{ ical_token: string }>(
    `UPDATE projects SET ical_token = ${reset ? "?" : "COALESCE(ical_token, ?)"} WHERE id = ? RETURNING ical_token`,
    randomBytes(24).toString("hex"), projectId,
  );
  return { token: row!.ical_token };
}

/**
 * Saves the project's outgoing webhook. An empty URL turns it off. The signing secret is
 * made on first save and returned only then (or with `rotate`); later saves keep it.
 */
export async function saveOutgoing(projectId: string, url: string, events: string[], rotate = false) {
  const user = await requireUser();
  if (!await canManage(user, projectId)) return { error: "You cannot manage this project." };
  const clean = url.trim();
  if (!clean) {
    await run("UPDATE projects SET outgoing = NULL WHERE id = ?", projectId);
    changed(user);
    return { ok: "Turned off." };
  }
  if (!URL.canParse(clean) || !/^https?:$/.test(new URL(clean).protocol)) return { error: "URL must start with http:// or https://." };
  const { OUTGOING_EVENTS } = await import("./outgoing-events");
  const picked = OUTGOING_EVENTS.filter((e) => events.includes(e));
  if (!picked.length) return { error: "Pick at least one event." };

  const saved = (await get<{ outgoing: { secret: string } | null }>("SELECT outgoing FROM projects WHERE id = ?", projectId))?.outgoing;
  const secret = !saved || rotate ? randomBytes(24).toString("hex") : saved.secret;
  await run("UPDATE projects SET outgoing = ? WHERE id = ?", JSON.stringify({ url: clean, secret, events: picked }), projectId);
  changed(user);
  return { ok: "Saved.", secret: secret === saved?.secret ? undefined : secret };
}

/** Sends a `ping` now and returns the receiver's HTTP status (or "timeout" / "unreachable"). */
export async function testOutgoing(projectId: string) {
  const user = await requireUser();
  if (!await canManage(user, projectId)) return { error: "You cannot manage this project." };
  const p = await get<{ name: string; key: string; outgoing: import("./outgoing").OutgoingConfig | null }>(
    "SELECT name, key, outgoing FROM projects WHERE id = ?", projectId,
  );
  if (!p?.outgoing) return { error: "Save a URL first." };
  const { deliver } = await import("./outgoing");
  const { outgoingPayload } = await import("./outgoing-events");
  const body = JSON.stringify(outgoingPayload("ping", { id: projectId, name: p.name, key: p.key }, null, "Test delivery", user.name));
  const status = await deliver(projectId, p.outgoing, "ping", body);
  changed(user);
  return { status };
}

/** Changes the project's task key prefix; existing tasks keep their numbers, so WEB-42 becomes APP-42. */
export async function setProjectKey(projectId: string, key: string) {
  const user = await requireUser();
  if (!await canManage(user, projectId)) return { error: "You cannot manage this project." };
  const clean = key.trim().toUpperCase();
  if (!PROJECT_KEY_RE.test(clean)) return { error: "2–10 letters or digits, starting with a letter." };
  await run("UPDATE projects SET key = ? WHERE id = ?", clean, projectId);
  changed(user);
  return { ok: true };
}

/**
 * Links a project to a GitHub repo. A blank token keeps the saved one; an empty
 * repo disconnects. The pair is checked against GitHub before it is stored.
 */
// ── Meetings ────────────────────────────────────────────────────────────────

/** Creates (no `id`) or updates a meeting. Any member may create; the creator or a workspace admin may edit. */
export async function saveMeeting(_prev: unknown, form: FormData) {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const title = String(form.get("title") ?? "").trim().slice(0, 200);
  const startDate = String(form.get("startDate") ?? "");
  const startTime = String(form.get("startTime") ?? "");
  const durationMin = Number(form.get("durationMin"));
  const remindMin = Number(form.get("remindMin"));
  const repeat = String(form.get("repeat") ?? "none") as MeetingRepeat;
  const rawLink = String(form.get("link") ?? "").trim();
  const link = safeLink(rawLink);
  const notes = String(form.get("notes") ?? "").trim().slice(0, 5000) || null;
  const attendees = [...new Set(form.getAll("attendeeIds").map(String).filter(Boolean))];

  if (!title) return { error: "Title is required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) return { error: "Pick a date and a time." };
  if (!Number.isInteger(durationMin) || durationMin < 5 || durationMin > 720) return { error: "Duration must be 5 to 720 minutes." };
  if (!Number.isInteger(remindMin) || remindMin < 0 || remindMin > 1440) return { error: "Reminder must be 0 to 1440 minutes before." };
  if (!MEETING_REPEATS.includes(repeat)) return { error: "Unknown repeat." };
  if (rawLink && !link) return { error: "The link must start with http:// or https://." };
  const known = await all<{ id: string }>("SELECT id FROM users WHERE workspace_id = ? AND id = ANY(?::text[])", user.workspace_id, attendees);
  if (known.length !== attendees.length) return { error: "Unknown attendee." };

  if (id) {
    const row = await get<{ created_by: string | null }>("SELECT created_by FROM meetings WHERE id = ? AND workspace_id = ?", id, user.workspace_id);
    if (!row) return { error: "Meeting not found." };
    if (row.created_by !== user.id && !user.is_admin) return { error: "Only its creator or a workspace admin can edit this meeting." };
  }
  const meetingId = id || randomUUID();
  await transaction(async () => {
    if (id) {
      await run(
        `UPDATE meetings SET title = ?, notes = ?, link = ?, start_date = ?, start_time = ?, duration_min = ?, repeat = ?, remind_min = ? WHERE id = ?`,
        title, notes, link, startDate, startTime, durationMin, repeat, remindMin, id,
      );
      await run("DELETE FROM meeting_attendees WHERE meeting_id = ?", id);
    } else {
      await run(
        `INSERT INTO meetings (id, workspace_id, title, notes, link, start_date, start_time, duration_min, repeat, remind_min, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        meetingId, user.workspace_id, title, notes, link, startDate, startTime, durationMin, repeat, remindMin, user.id, now(),
      );
    }
    for (const a of attendees) await run("INSERT INTO meeting_attendees (meeting_id, user_id) VALUES (?,?)", meetingId, a);
  });
  changed(user);
  return { ok: true };
}

export async function deleteMeeting(id: string) {
  const user = await requireUser();
  const row = await get<{ created_by: string | null }>("SELECT created_by FROM meetings WHERE id = ? AND workspace_id = ?", id, user.workspace_id);
  if (!row) return { error: "Meeting not found." };
  if (row.created_by !== user.id && !user.is_admin) return { error: "Only its creator or a workspace admin can delete this meeting." };
  await run("DELETE FROM meetings WHERE id = ?", id);
  changed(user);
  return { ok: true };
}

/** Opens a GitHub issue from a card: "[KEY] title", the description, and a back-reference. */
export async function createGithubIssue(taskId: string) {
  const user = await requireUser();
  if (!await writableTask(user, taskId)) return { error: "You cannot edit this task." };
  const task = (await get<{ title: string; description: string | null; project_id: string; key: string }>(
    `SELECT t.title, t.description, c.project_id, p.key || '-' || t.number AS key
       FROM tasks t JOIN columns c ON c.id = t.column_id JOIN projects p ON p.id = c.project_id WHERE t.id = ?`, taskId,
  ))!;
  const { GithubError, createIssue, forgetGithub, githubConfig } = await import("./github");
  const config = await githubConfig(task.project_id);
  if (!config?.repo) return { error: "Connect a GitHub repo in Settings → Projects first." };
  if (!config.token) return { error: "Creating issues needs a token with Issues: Read and write (Settings → Projects → GitHub)." };
  try {
    const body = `${task.description ?? ""}\n\n---\nFrom digital board card ${task.key}.`.trim();
    const issue = await createIssue(config, `[${task.key}] ${task.title}`, body);
    await logEvent(taskId, user.id, `Created GitHub issue #${issue.number}: ${issue.url}`);
    forgetGithub(task.project_id);
    changed(user);
    return { ok: true, url: issue.url };
  } catch (e) {
    return { error: e instanceof GithubError ? e.message : "Could not reach GitHub." };
  }
}

export async function saveGithub(projectId: string, repo: string, token: string) {
  const user = await requireUser();
  if (!await canManage(user, projectId)) return { error: "You cannot manage this project." };

  const { REPO_RE, GithubError, githubConfig, verifyGithub } = await import("./github");
  const clean = repo.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$|\/$/g, "");
  if (!clean) {
    await run("UPDATE projects SET github = NULL WHERE id = ?", projectId);
    changed(user);
    return { ok: "Disconnected." };
  }
  if (!REPO_RE.test(clean)) return { error: "Repository must look like owner/name." };
  let full = clean;

  // Blank keeps the saved token; with none saved, the repo is read anonymously (public repos only).
  const saved = await githubConfig(projectId);
  const key = token.trim() || saved?.token || "";
  try {
    full = await verifyGithub({ repo: clean, token: key });
    // Keep the webhook secret: re-saving the token must not break the configured webhook.
    await run("UPDATE projects SET github = ? WHERE id = ?", JSON.stringify({ ...saved, repo: full, token: key }), projectId);
  } catch (e) {
    return { error: e instanceof GithubError ? e.message : "Could not reach GitHub." };
  }
  changed(user);
  return { ok: "Connected.", repo: full };
}

export async function renameProject(id: string, name: string) {
  const user = await requireUser();
  if (!await canManage(user, id)) return { error: "You cannot manage this project." };
  const clean = name.trim();
  if (!clean) return { error: "Project name is required." };
  await run("UPDATE projects SET name = ? WHERE id = ?", clean, id);
  changed(user);
  return { ok: true };
}

export async function addColumn(projectId: string, title: string, color: string, limitDays: number | null = null) {
  const user = await requireUser();
  if (!await canManage(user, projectId)) return { error: "You cannot manage this project." };
  const clean = title.trim();
  if (!clean) return { error: "Column name is required." };
  if (!COLUMN_COLORS.includes(color)) return { error: "Invalid colour." };
  if (!validLimit(limitDays)) return { error: "Day limit must be a whole number from 1 to 365." };
  const next = (await get<{ n: number }>(
    "SELECT COALESCE(MAX(position) + 1, 0) n FROM columns WHERE project_id = ?",
    projectId,
  ))!.n;
  await run(
    "INSERT INTO columns (id, project_id, title, color, position, stage_limit_days) VALUES (?,?,?,?,?,?)",
    randomUUID(), projectId, clean, color, next, limitDays,
  );
  changed(user);
  return { ok: true };
}

export async function updateColumn(id: string, title: string, color: string, limitDays: number | null) {
  const user = await requireUser();
  if (!await canManage(user, await projectOfColumn(id))) return { error: "You cannot manage this project." };
  const clean = title.trim();
  if (!clean) return { error: "Column name is required." };
  if (!COLUMN_COLORS.includes(color)) return { error: "Invalid colour." };
  if (!validLimit(limitDays)) return { error: "Day limit must be a whole number from 1 to 365." };
  await run("UPDATE columns SET title = ?, color = ?, stage_limit_days = ? WHERE id = ?", clean, color, limitDays, id);
  changed(user);
  return { ok: true };
}

/** Deleting a column takes its tasks with it (FK cascade) — the UI confirms the count first and offers undo after. */
export async function deleteColumn(id: string) {
  const user = await requireUser();
  const projectId = await projectOfColumn(id);
  if (!projectId) return { error: "Column not found." };
  if (!await canManage(user, projectId)) return { error: "You cannot manage this project." };
  const last = (await get<{ n: number }>("SELECT COUNT(*) n FROM columns WHERE project_id = ?", projectId))!.n;
  if (last <= 1) return { error: "A board needs at least one column." };
  const undo = await transaction(async () => {
    const undo = await trash(user, projectId, "column_id", id);
    await run("DELETE FROM columns WHERE id = ?", id);
    return undo;
  });
  changed(user);
  return { ok: true, undo };
}

/** Marks the column that counts as done; null goes back to "the last column". */
export async function setDoneColumn(projectId: string, columnId: string | null) {
  const user = await requireUser();
  if (!await canManage(user, projectId)) return { error: "You cannot manage this project." };
  if (columnId && await projectOfColumn(columnId) !== projectId) return { error: "Column not found." };
  await run("UPDATE projects SET done_column_id = ? WHERE id = ?", columnId, projectId);
  changed(user);
  return { ok: true };
}

/** Move a column `by` places (negative = left). Positions are renumbered densely afterwards. */
export async function moveColumn(id: string, by: number) {
  const user = await requireUser();
  if (!Number.isInteger(by)) return;
  const col = await get<{ project_id: string; position: number }>(
    "SELECT project_id, position FROM columns WHERE id = ?",
    id,
  );
  if (!col || !await canManage(user, col.project_id)) return;
  const ordered = (
    await all<{ id: string }>("SELECT id FROM columns WHERE project_id = ? ORDER BY position", col.project_id)
  ).map((r) => r.id);
  const from = ordered.indexOf(id);
  const moved = reorder(ordered, from, from + by);
  if (moved === ordered) return;
  await transaction(async () => {
    for (const [i, cid] of moved.entries()) await run("UPDATE columns SET position = ? WHERE id = ?", i, cid);
  });
  changed(user);
}


export async function fetchHistory(taskId: string) {
  const user = await requireUser();
  const task = await get<{ project_id: string }>(
    "SELECT c.project_id FROM tasks t JOIN columns c ON c.id = t.column_id WHERE t.id = ?", taskId,
  );
  if (!task || await projectRole(user, task.project_id) === null) return [];
  const { taskHistory } = await import("./queries");
  return taskHistory(taskId);
}

// ── Custom fields ───────────────────────────────────────────────────────────

const fieldsOfColumn = async (columnId: string) =>
  all<CustomField>(
    "SELECT f.id, f.name, f.type, f.options FROM custom_fields f JOIN columns c ON c.project_id = f.project_id WHERE c.id = ? ORDER BY f.position",
    columnId,
  );

/** Adds a field to the project (managers). `options` is comma-separated, for select. */
export async function addField(projectId: string, name: string, type: FieldType, options: string) {
  const user = await requireUser();
  if (!await canManage(user, projectId)) return { error: "You cannot manage this project." };
  const clean = name.trim();
  if (!clean || clean.length > 40) return { error: "Field name must be 1 to 40 characters." };
  if (!FIELD_TYPES.includes(type)) return { error: "Unknown field type." };
  const opts = type === "select" ? fieldOptionsOf(options) : [];
  if (type === "select" && opts.length === 0) return { error: "A select field needs at least one option." };
  const taken = await all<{ name: string }>("SELECT name FROM custom_fields WHERE project_id = ?", projectId);
  if (taken.length >= 20) return { error: "A project can have at most 20 fields." };
  if (taken.some((f) => f.name.toLowerCase() === clean.toLowerCase())) return { error: "A field with that name already exists." };
  await run(
    "INSERT INTO custom_fields (id, project_id, name, type, options, position) VALUES (?,?,?,?,?,?)",
    randomUUID(), projectId, clean, type, JSON.stringify(opts), taken.length,
  );
  changed(user);
  return { ok: true };
}

/** Removes a field and its value on every card of the project (managers). */
export async function deleteField(id: string) {
  const user = await requireUser();
  const field = await get<{ project_id: string }>("SELECT project_id FROM custom_fields WHERE id = ?", id);
  if (!field || !await canManage(user, field.project_id)) return { error: "You cannot manage this project." };
  await transaction(async () => {
    await run("UPDATE tasks SET fields = fields - ? WHERE column_id IN (SELECT id FROM columns WHERE project_id = ?)", id, field.project_id);
    await run("DELETE FROM custom_fields WHERE id = ?", id);
  });
  changed(user);
  return { ok: true };
}

// ── Saved views ─────────────────────────────────────────────────────────────

/** Saves the current filters + layout under a name for everyone in the project; the same name replaces it. */
export async function saveView(projectId: string, name: string, filters: Filters, layout: Layout) {
  const user = await requireUser();
  if (!await canEdit(user, projectId)) return { error: "You cannot edit this project." };
  const clean = name.trim();
  if (!clean || clean.length > 40) return { error: "View name must be 1 to 40 characters." };
  if (!LAYOUTS.includes(layout)) return { error: "Unknown layout." };
  const id = randomUUID();
  await transaction(async () => {
    await run("DELETE FROM saved_views WHERE project_id = ? AND lower(name) = lower(?)", projectId, clean);
    await run(
      "INSERT INTO saved_views (id, project_id, name, filters, layout, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
      id, projectId, clean, JSON.stringify(cleanFilters(filters)), layout, user.id, now(),
    );
  });
  changed(user);
  return { ok: true, id };
}

export async function deleteView(id: string) {
  const user = await requireUser();
  const view = await get<{ project_id: string }>("SELECT project_id FROM saved_views WHERE id = ?", id);
  if (!view || !await canEdit(user, view.project_id)) return { error: "You cannot edit this project." };
  await run("DELETE FROM saved_views WHERE id = ?", id);
  changed(user);
  return { ok: true };
}

// ── Time tracking ───────────────────────────────────────────────────────────

/** Seconds of an entry; a running one counts up to now. */
const ELAPSED = "EXTRACT(EPOCH FROM COALESCE(te.ended_at, now()::text)::timestamptz - te.started_at::timestamptz)";

/** Time logged on a card per person, plus the caller's id and when their running timer on it started. */
export async function fetchTime(taskId: string) {
  const user = await requireUser();
  const task = await get<{ project_id: string }>(
    "SELECT c.project_id FROM tasks t JOIN columns c ON c.id = t.column_id WHERE t.id = ?", taskId,
  );
  if (!task || await projectRole(user, task.project_id) === null) return null;
  const people = await all<Member & { seconds: number }>(
    `SELECT u.id, u.name, u.color, SUM(${ELAPSED})::int AS seconds
       FROM time_entries te JOIN users u ON u.id = te.user_id
      WHERE te.task_id = ? GROUP BY u.id ORDER BY seconds DESC`,
    taskId,
  );
  const mine = await get<{ started_at: string }>(
    "SELECT started_at FROM time_entries WHERE task_id = ? AND user_id = ? AND ended_at IS NULL", taskId, user.id,
  );
  return { people, me: user.id, since: mine?.started_at ?? null };
}

/** Starts the caller's timer on this card, stopping one running elsewhere — one at a time per person. */
export async function startTimer(taskId: string) {
  const user = await requireUser();
  if (!await writableTask(user, taskId)) return { error: "You cannot edit this task." };
  await transaction(async () => {
    await run("UPDATE time_entries SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL", now(), user.id);
    await run("INSERT INTO time_entries (task_id, user_id, started_at) VALUES (?,?,?)", taskId, user.id, now());
  });
  changed(user);
  return { ok: true };
}

/** Stops the caller's own timer on this card; always allowed, even after losing edit access. */
export async function stopTimer(taskId: string) {
  const user = await requireUser();
  await run("UPDATE time_entries SET ended_at = ? WHERE task_id = ? AND user_id = ? AND ended_at IS NULL", now(), taskId, user.id);
  changed(user);
  return { ok: true };
}

/** Logs time after the fact ("1h 30m", "45m"), ending now. At most 24h per entry. */
export async function logTime(taskId: string, text: string) {
  const user = await requireUser();
  if (!await writableTask(user, taskId)) return { error: "You cannot edit this task." };
  const seconds = parseDuration(text);
  if (seconds === null || seconds > 86_400) return { error: "Enter a time like 1h 30m or 45m, up to 24h." };
  const end = Date.now();
  await run(
    "INSERT INTO time_entries (task_id, user_id, started_at, ended_at) VALUES (?,?,?,?)",
    taskId, user.id, new Date(end - seconds * 1000).toISOString(), new Date(end).toISOString(),
  );
  changed(user);
  return { ok: true };
}

// ── Canvas sheets ───────────────────────────────────────────────────────────

const projectOfCanvas = async (id: string) =>
  (await get<{ project_id: string }>("SELECT project_id FROM canvases WHERE id = ?", id))?.project_id;

export async function createCanvas(projectId: string, name: string) {
  const user = await requireUser();
  if (!await canEdit(user, projectId)) return;
  const clean = name.trim() || "Untitled sheet";
  const next = (await get<{ n: number }>("SELECT COALESCE(MAX(position) + 1, 0) n FROM canvases WHERE project_id = ?", projectId))!.n;
  const id = randomUUID();
  await run(
    "INSERT INTO canvases (id, project_id, name, position, snapshot, updated_at) VALUES (?,?,?,?,NULL,?)",
    id, projectId, clean, next, now(),
  );
  changed(user);
  return id;
}

export async function renameCanvas(id: string, name: string) {
  const user = await requireUser();
  if (!await canEdit(user, await projectOfCanvas(id))) return;
  const clean = name.trim();
  if (!clean) return;
  await run("UPDATE canvases SET name = ? WHERE id = ?", clean, id);
  changed(user);
}

export async function deleteCanvas(id: string) {
  const user = await requireUser();
  if (!await canEdit(user, await projectOfCanvas(id))) return;
  await run("DELETE FROM canvases WHERE id = ?", id);
  // Anyone else on this sheet would keep drawing into a row that no longer exists.
  broadcast(id, "", { type: "deleted" });
  changed(user);
}

// ── AI agent ────────────────────────────────────────────────────────────────

/** Admin-only. A blank API key keeps the saved one, so the key never has to round-trip to the browser. */
export async function saveAiConfig(_prev: unknown, form: FormData) {
  const user = await requireUser();
  if (!user.is_admin) return { error: "Only workspace admins can configure the AI agent." };

  const { AI_PROVIDERS, REASONING, aiConfig } = await import("./ai");
  const { seal } = await import("./secret");
  const provider = String(form.get("provider") ?? "") as (typeof AI_PROVIDERS)[number];
  const model = String(form.get("model") ?? "").trim();
  const baseUrl = String(form.get("baseUrl") ?? "").trim();
  const apiKey = String(form.get("apiKey") ?? "").trim();
  const reasoning = String(form.get("reasoning") ?? "") as (typeof REASONING)[number];

  if (form.get("disable")) {
    await run("UPDATE workspaces SET ai_config = NULL WHERE id = ?", user.workspace_id);
    changed(user);
    return { ok: "AI agent turned off." };
  }
  if (!AI_PROVIDERS.includes(provider)) return { error: "Pick a provider." };
  if (!model) return { error: "Model is required." };
  if (!REASONING.includes(reasoning)) return { error: "Pick a reasoning level." };
  if (baseUrl && !/^https?:\/\/\S+$/.test(baseUrl)) return { error: "Base URL must start with http:// or https://." };

  const saved = await aiConfig(user.workspace_id);
  const key = apiKey || (saved?.provider === provider ? saved.apiKey : "");
  // Ollama and other local servers need no key; the hosted providers do.
  if (provider !== "openai" && !key) return { error: "An API key is required for this provider." };

  await run(
    "UPDATE workspaces SET ai_config = ? WHERE id = ?",
    JSON.stringify({ provider, model, baseUrl: provider === "openai" ? baseUrl : "", apiKey: seal(key), reasoning }), user.workspace_id,
  );
  changed(user);
  return { ok: "Saved." };
}

/** Admin-only. Lists models for the typed key, or the saved one when the key field is blank. */
export async function fetchAiModels(provider: string, baseUrl: string, apiKey: string) {
  const user = await requireUser();
  if (!user.is_admin) return { error: "Only workspace admins can configure the AI agent." };

  const { AI_PROVIDERS, aiConfig, listModels } = await import("./ai");
  if (!AI_PROVIDERS.includes(provider as (typeof AI_PROVIDERS)[number])) return { error: "Pick a provider." };
  if (baseUrl && !/^https?:\/\/\S+$/.test(baseUrl)) return { error: "Base URL must start with http:// or https://." };

  const saved = await aiConfig(user.workspace_id);
  const key = apiKey.trim() || (saved?.provider === provider ? saved.apiKey : "");
  if (provider !== "openai" && !key) return { error: "Enter an API key to load the models." };

  try {
    const models = await listModels({ provider: provider as (typeof AI_PROVIDERS)[number], model: "", baseUrl: baseUrl.trim(), apiKey: key });
    return models.length ? { models } : { error: "This key has no chat models available." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not load models." };
  }
}

// ── Sprints ─────────────────────────────────────────────────────────────────

/** Creates a sprint, or renames/redates it when `id` is given. Editors plan sprints. */
export async function saveSprint(projectId: string, name: string, startDate: string, endDate: string, id?: string) {
  const user = await requireUser();
  if (!await canEdit(user, projectId)) return { error: "You cannot edit this project." };
  const clean = name.trim().slice(0, 100);
  if (!clean) return { error: "Name the sprint." };
  const bad = !DATE_RE.test(startDate) || !DATE_RE.test(endDate) ? "Dates must be YYYY-MM-DD."
    : startDate > endDate ? "The sprint must end on or after its start." : null;
  if (bad) return { error: bad };
  if (id) await run("UPDATE sprints SET name = ?, start_date = ?, end_date = ? WHERE id = ? AND project_id = ?", clean, startDate, endDate, id, projectId);
  else await run("INSERT INTO sprints (id, project_id, name, start_date, end_date, created_at) VALUES (?,?,?,?,?,?)", randomUUID(), projectId, clean, startDate, endDate, now());
  changed(user);
  return { ok: true };
}

/**
 * Closes a sprint. Its unfinished cards (not in the done column) move to
 * `moveTo`, another open sprint of the project, or to the backlog when null;
 * finished cards keep the sprint as their record.
 */
export async function completeSprint(id: string, moveTo: string | null) {
  const user = await requireUser();
  const sprint = await get<{ project_id: string; name: string }>("SELECT project_id, name FROM sprints WHERE id = ? AND closed_at IS NULL", id);
  if (!sprint || !await canEdit(user, sprint.project_id)) return { error: "Nothing to complete." };
  const target = moveTo && moveTo !== id ? await openSprintName(sprint.project_id, moveTo) : null;
  if (moveTo && !target) return { error: "Pick an open sprint of this project." };
  await transaction(async () => {
    const open = await all<{ id: string }>(
      `UPDATE tasks t SET sprint_id = ? FROM columns c JOIN projects p ON p.id = c.project_id
        WHERE c.id = t.column_id AND t.sprint_id = ? AND t.archived_at IS NULL AND t.column_id <> ${DONE_COLUMN}
        RETURNING t.id`,
      target ? moveTo : null, id,
    );
    for (const t of open) await logEvent(t.id, user.id, target ? `Carried over from ${sprint.name} to ${target}` : `Moved to the backlog when ${sprint.name} ended`);
    await run("UPDATE sprints SET closed_at = ? WHERE id = ?", now(), id);
  });
  changed(user);
  return { ok: true };
}

/** Deletes a sprint; its cards go back to the backlog (ON DELETE SET NULL). */
export async function deleteSprint(id: string) {
  const user = await requireUser();
  const sprint = await get<{ project_id: string }>("SELECT project_id FROM sprints WHERE id = ?", id);
  if (!sprint || !await canEdit(user, sprint.project_id)) return { error: "You cannot edit this project." };
  await run("DELETE FROM sprints WHERE id = ?", id);
  changed(user);
  return { ok: true };
}
