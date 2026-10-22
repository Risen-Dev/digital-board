"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { all, get, run, transaction } from "./db";
import { createUser, createWorkspace, currentUser, endSession, login, passwordOf, setPassword, startSession, verifyPassword, type User } from "./auth";
import { joinLabels, nextDue, projectKeyOf, PROJECT_KEY_RE, REPEATS, templateOf, PALETTE, PRIORITIES, reorder, type CheckItem, type Priority, type Repeat } from "./board";
import { broadcast } from "./canvas/hub";
import { projectRole } from "./canvas/guard";
import { notify } from "./outgoing";
import { AGENT_MENTION } from "./chat";
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
  if (!examples) return;

  const { tasks, canvas } = (examplesData as TemplateExamples)[template.id];
  const positions = new Map<string, number>();
  for (const t of tasks) {
    const columnId = columnIds.get(t.column);
    if (!columnId) continue; // that column was unticked at register
    const position = positions.get(columnId) ?? 0;
    positions.set(columnId, position + 1);
    const due = t.dueInDays === undefined ? null : new Date(Date.now() + t.dueInDays * 86_400_000).toLocaleDateString("en-CA");
    const id = randomUUID();
    await run(
      `INSERT INTO tasks (id, column_id, title, description, label, priority, assignee_id, due_date, position, number, created_at)
       VALUES (?,?,?,?,?,?,NULL,?,?,?,?)`,
      id, columnId, t.title, t.description ?? null, t.label, t.priority, due, position, await nextTaskNumber(projectId), now(),
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
  revalidatePath("/board");
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
  revalidatePath("/board");
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
  assignees: [...new Set(form.getAll("assigneeIds").map(String).filter(Boolean))],
  repeat: String(form.get("repeat") ?? "").trim() || null,
});

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

export async function createTask(_prev: unknown, form: FormData) {
  const user = await requireUser();
  const columnId = String(form.get("columnId") ?? "");
  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "Title is required." };
  if (!await writableColumn(user, columnId)) return { error: "You cannot edit this project." };

  const priority = String(form.get("priority") ?? "medium") as Priority;
  const { description, label, dueDate, assignees, repeat } = taskFieldsOf(form);
  const invalid = await invalidTaskFields(user, priority, assignees, repeat);
  if (invalid) return { error: invalid };

  const id = randomUUID();
  await transaction(async () => {
    const { project_id } = (await get<{ project_id: string }>("SELECT project_id FROM columns WHERE id = ?", columnId))!;
    const next = ((await get<{ n: number }>("SELECT COALESCE(MAX(position) + 1, 0) n FROM tasks WHERE column_id = ?", columnId)))!.n;
    await run(
      `INSERT INTO tasks (id, column_id, title, description, label, priority, due_date, repeat, position, number, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, columnId, title, description, label, priority, dueDate, repeat, next, await nextTaskNumber(project_id), now(),
    );
    await setAssignees(id, assignees);
    await logEvent(id, user.id, "Task created");
  });
  await notify("task.created", id, "Task created", user.name);
  revalidatePath("/board");
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

  revalidatePath("/board");
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
    due_date: string | null; repeat: string | null; assignees: string[] }>(
    `SELECT column_id, title, description, label, priority, due_date, repeat,
            ARRAY(SELECT user_id FROM task_assignees WHERE task_id = t.id) AS assignees
       FROM tasks t WHERE id = ?`,
    id,
  );
  if (!before || !await writableColumn(user, before.column_id)) return { error: "You cannot edit this project." };

  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "Title is required." };
  const priority = String(form.get("priority") ?? before.priority);
  const { description, label, dueDate, assignees, repeat } = taskFieldsOf(form);
  const invalid = await invalidTaskFields(user, priority, assignees, repeat);
  if (invalid) return { error: invalid };

  const assigneesChanged = [...assignees].sort().join() !== [...before.assignees].sort().join();
  await transaction(async () => {
    await run(
      "UPDATE tasks SET title = ?, description = ?, label = ?, priority = ?, due_date = ?, repeat = ? WHERE id = ?",
      title, description, label, priority, dueDate, repeat, id,
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
  if (before.due_date !== dueDate) changes.push(dueDate ? `Due date set to ${dueDate}` : "Due date cleared");
  if (before.repeat !== repeat) changes.push(repeat ? `Repeats ${repeat}` : "Repeat turned off");
  for (const c of changes) await logEvent(id, user.id, c);
  if (changes.length) await notify("task.updated", id, changes.join("; "), user.name);

  revalidatePath("/board");
  return { ok: true };
}

export async function deleteTask(id: string) {
  const user = await requireUser();
  const task = await get<{ column_id: string }>("SELECT column_id FROM tasks WHERE id = ?", id);
  if (!task || !await writableColumn(user, task.column_id)) return;
  await notify("task.deleted", id, "Task deleted", user.name); // before the row is gone
  await run("DELETE FROM tasks WHERE id = ?", id);
  revalidatePath("/board");
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
  revalidatePath("/board");
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
  revalidatePath("/board");
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
  revalidatePath("/board");
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
  revalidatePath("/board");
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
  revalidatePath("/board");
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
  revalidatePath("/board");
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
  revalidatePath("/board");
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
  revalidatePath("/board");
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
  revalidatePath("/board");
  return { ok: true };
}

export async function renameWorkspace(name: string) {
  const user = await requireUser();
  if (!user.is_admin) return { error: "Only workspace admins can rename the workspace." };
  const clean = name.trim();
  if (!clean) return { error: "Workspace name is required." };
  await run("UPDATE workspaces SET name = ? WHERE id = ?", clean, user.workspace_id);
  revalidatePath("/board");
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
  revalidatePath("/board");
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
  revalidatePath("/board");
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
    revalidatePath("/board");
    return { ok: "Turned off." };
  }
  if (!URL.canParse(clean) || !/^https?:$/.test(new URL(clean).protocol)) return { error: "URL must start with http:// or https://." };
  const { OUTGOING_EVENTS } = await import("./outgoing-events");
  const picked = OUTGOING_EVENTS.filter((e) => events.includes(e));
  if (!picked.length) return { error: "Pick at least one event." };

  const saved = (await get<{ outgoing: { secret: string } | null }>("SELECT outgoing FROM projects WHERE id = ?", projectId))?.outgoing;
  const secret = !saved || rotate ? randomBytes(24).toString("hex") : saved.secret;
  await run("UPDATE projects SET outgoing = ? WHERE id = ?", JSON.stringify({ url: clean, secret, events: picked }), projectId);
  revalidatePath("/board");
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
  revalidatePath("/board");
  return { status };
}

/** Changes the project's task key prefix; existing tasks keep their numbers, so WEB-42 becomes APP-42. */
export async function setProjectKey(projectId: string, key: string) {
  const user = await requireUser();
  if (!await canManage(user, projectId)) return { error: "You cannot manage this project." };
  const clean = key.trim().toUpperCase();
  if (!PROJECT_KEY_RE.test(clean)) return { error: "2–10 letters or digits, starting with a letter." };
  await run("UPDATE projects SET key = ? WHERE id = ?", clean, projectId);
  revalidatePath("/board");
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
  revalidatePath("/board");
  return { ok: true };
}

export async function deleteMeeting(id: string) {
  const user = await requireUser();
  const row = await get<{ created_by: string | null }>("SELECT created_by FROM meetings WHERE id = ? AND workspace_id = ?", id, user.workspace_id);
  if (!row) return { error: "Meeting not found." };
  if (row.created_by !== user.id && !user.is_admin) return { error: "Only its creator or a workspace admin can delete this meeting." };
  await run("DELETE FROM meetings WHERE id = ?", id);
  revalidatePath("/board");
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
    revalidatePath("/board");
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
    revalidatePath("/board");
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
  revalidatePath("/board");
  return { ok: "Connected.", repo: full };
}

export async function renameProject(id: string, name: string) {
  const user = await requireUser();
  if (!await canManage(user, id)) return { error: "You cannot manage this project." };
  const clean = name.trim();
  if (!clean) return { error: "Project name is required." };
  await run("UPDATE projects SET name = ? WHERE id = ?", clean, id);
  revalidatePath("/board");
  return { ok: true };
}

export async function addColumn(projectId: string, title: string, color: string) {
  const user = await requireUser();
  if (!await canManage(user, projectId)) return { error: "You cannot manage this project." };
  const clean = title.trim();
  if (!clean) return { error: "Column name is required." };
  if (!COLUMN_COLORS.includes(color)) return { error: "Invalid colour." };
  const next = (await get<{ n: number }>(
    "SELECT COALESCE(MAX(position) + 1, 0) n FROM columns WHERE project_id = ?",
    projectId,
  ))!.n;
  await run(
    "INSERT INTO columns (id, project_id, title, color, position) VALUES (?,?,?,?,?)",
    randomUUID(), projectId, clean, color, next,
  );
  revalidatePath("/board");
  return { ok: true };
}

export async function updateColumn(id: string, title: string, color: string) {
  const user = await requireUser();
  if (!await canManage(user, await projectOfColumn(id))) return { error: "You cannot manage this project." };
  const clean = title.trim();
  if (!clean) return { error: "Column name is required." };
  if (!COLUMN_COLORS.includes(color)) return { error: "Invalid colour." };
  await run("UPDATE columns SET title = ?, color = ? WHERE id = ?", clean, color, id);
  revalidatePath("/board");
  return { ok: true };
}

/** Deleting a column takes its tasks with it (FK cascade) — the UI confirms the count first. */
export async function deleteColumn(id: string) {
  const user = await requireUser();
  const projectId = await projectOfColumn(id);
  if (!projectId) return { error: "Column not found." };
  if (!await canManage(user, projectId)) return { error: "You cannot manage this project." };
  const last = (await get<{ n: number }>("SELECT COUNT(*) n FROM columns WHERE project_id = ?", projectId))!.n;
  if (last <= 1) return { error: "A board needs at least one column." };
  await run("DELETE FROM columns WHERE id = ?", id);
  revalidatePath("/board");
  return { ok: true };
}

/** Marks the column that counts as done; null goes back to "the last column". */
export async function setDoneColumn(projectId: string, columnId: string | null) {
  const user = await requireUser();
  if (!await canManage(user, projectId)) return { error: "You cannot manage this project." };
  if (columnId && await projectOfColumn(columnId) !== projectId) return { error: "Column not found." };
  await run("UPDATE projects SET done_column_id = ? WHERE id = ?", columnId, projectId);
  revalidatePath("/board");
  return { ok: true };
}

/** Move a column left or right. Positions are renumbered densely afterwards. */
export async function moveColumn(id: string, direction: -1 | 1) {
  const user = await requireUser();
  const col = await get<{ project_id: string; position: number }>(
    "SELECT project_id, position FROM columns WHERE id = ?",
    id,
  );
  if (!col || !await canManage(user, col.project_id)) return;
  const ordered = (
    await all<{ id: string }>("SELECT id FROM columns WHERE project_id = ? ORDER BY position", col.project_id)
  ).map((r) => r.id);
  const from = ordered.indexOf(id);
  const moved = reorder(ordered, from, from + direction);
  if (moved === ordered) return;
  await transaction(async () => {
    for (const [i, cid] of moved.entries()) await run("UPDATE columns SET position = ? WHERE id = ?", i, cid);
  });
  revalidatePath("/board");
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
  revalidatePath("/board");
  return id;
}

export async function renameCanvas(id: string, name: string) {
  const user = await requireUser();
  if (!await canEdit(user, await projectOfCanvas(id))) return;
  const clean = name.trim();
  if (!clean) return;
  await run("UPDATE canvases SET name = ? WHERE id = ?", clean, id);
  revalidatePath("/board");
}

export async function deleteCanvas(id: string) {
  const user = await requireUser();
  if (!await canEdit(user, await projectOfCanvas(id))) return;
  await run("DELETE FROM canvases WHERE id = ?", id);
  // Anyone else on this sheet would keep drawing into a row that no longer exists.
  broadcast(id, "", { type: "deleted" });
  revalidatePath("/board");
}

// ── AI agent ────────────────────────────────────────────────────────────────

/** Admin-only. A blank API key keeps the saved one, so the key never has to round-trip to the browser. */
export async function saveAiConfig(_prev: unknown, form: FormData) {
  const user = await requireUser();
  if (!user.is_admin) return { error: "Only workspace admins can configure the AI agent." };

  const { AI_PROVIDERS, REASONING, aiConfig } = await import("./ai");
  const provider = String(form.get("provider") ?? "") as (typeof AI_PROVIDERS)[number];
  const model = String(form.get("model") ?? "").trim();
  const baseUrl = String(form.get("baseUrl") ?? "").trim();
  const apiKey = String(form.get("apiKey") ?? "").trim();
  const reasoning = String(form.get("reasoning") ?? "") as (typeof REASONING)[number];

  if (form.get("disable")) {
    await run("UPDATE workspaces SET ai_config = NULL WHERE id = ?", user.workspace_id);
    revalidatePath("/board");
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
    JSON.stringify({ provider, model, baseUrl: provider === "openai" ? baseUrl : "", apiKey: key, reasoning }), user.workspace_id,
  );
  revalidatePath("/board");
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
