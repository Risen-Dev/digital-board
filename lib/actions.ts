"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { all, get, run, transaction } from "./db";
import { createUser, createWorkspace, currentUser, endSession, login, passwordOf, setPassword, startSession, verifyPassword, type User } from "./auth";
import { projectKeyOf, PROJECT_KEY_RE, templateOf, PALETTE, PRIORITIES, reorder, type Priority } from "./board";
import { broadcast } from "./canvas/hub";
import { projectRole } from "./canvas/guard";
import { notify } from "./outgoing";
import { nextTaskNumber, relocateTask } from "./tasks";
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

async function logEvent(taskId: string, actorId: string | null, text: string) {
  await run("INSERT INTO task_events (task_id, actor_id, text, at) VALUES (?,?,?,?)", taskId, actorId, text, now());
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
// No mail server here, so there is no emailed reset link. Two paths instead:
// you change your own with your current password, or a workspace admin sets a
// member's. Both drop that user's sessions, so a stolen one dies with the
// password. Locked out of the admin account entirely? scripts/reset-password.mjs
// on the machine holding the database.

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

// ── Tasks ───────────────────────────────────────────────────────────────────

/** Priority drives a style lookup on every card, and an assignee must be a colleague. */
async function invalidTaskFields(user: Awaited<ReturnType<typeof requireUser>>, priority: string, assignee: string | null) {
  if (!PRIORITIES.includes(priority as Priority)) return "Invalid priority.";
  if (assignee && !await get("SELECT 1 FROM users WHERE id = ? AND workspace_id = ?", assignee, user.workspace_id)) {
    return "That assignee is not in this workspace.";
  }
  return null;
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
  const description = String(form.get("description") ?? "").trim() || null;
  const label = String(form.get("label") ?? "").trim() || null;
  const dueDate = String(form.get("dueDate") ?? "").trim() || null;
  const assignee = String(form.get("assigneeId") ?? "").trim() || null;
  const invalid = await invalidTaskFields(user, priority, assignee);
  if (invalid) return { error: invalid };

  const id = randomUUID();
  await transaction(async () => {
    const { project_id } = (await get<{ project_id: string }>("SELECT project_id FROM columns WHERE id = ?", columnId))!;
    const next = ((await get<{ n: number }>("SELECT COALESCE(MAX(position) + 1, 0) n FROM tasks WHERE column_id = ?", columnId)))!.n;
    await run(
      `INSERT INTO tasks (id, column_id, title, description, label, priority, assignee_id, due_date, position, number, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, columnId, title, description, label, priority, assignee, dueDate, next, await nextTaskNumber(project_id), now(),
    );
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

  revalidatePath("/board");
}

export async function updateTask(_prev: unknown, form: FormData) {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const before = await get<{ column_id: string; title: string; description: string | null; priority: string; assignee_id: string | null; due_date: string | null }>(
    "SELECT column_id, title, description, priority, assignee_id, due_date FROM tasks WHERE id = ?",
    id,
  );
  if (!before || !await writableColumn(user, before.column_id)) return { error: "You cannot edit this project." };

  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "Title is required." };
  const priority = String(form.get("priority") ?? before.priority);
  const description = String(form.get("description") ?? "").trim() || null;
  const label = String(form.get("label") ?? "").trim() || null;
  const dueDate = String(form.get("dueDate") ?? "").trim() || null;
  const assignee = String(form.get("assigneeId") ?? "").trim() || null;
  const invalid = await invalidTaskFields(user, priority, assignee);
  if (invalid) return { error: invalid };

  await run(
    "UPDATE tasks SET title = ?, description = ?, label = ?, priority = ?, assignee_id = ?, due_date = ? WHERE id = ?",
    title, description, label, priority, assignee, dueDate, id,
  );
  const changes: string[] = [];
  if (before.title !== title) changes.push(`Title changed to "${title}"`);
  if (before.description !== description) changes.push("Details updated");
  if (before.priority !== priority) changes.push(`Priority changed to ${priority}`);
  if (before.assignee_id !== assignee) {
    const who = assignee ? ((await get<{ name: string }>("SELECT name FROM users WHERE id = ?", assignee)))?.name : null;
    changes.push(who ? `Assigned to ${who}` : "Assignee cleared");
  }
  if (before.due_date !== dueDate) changes.push(dueDate ? `Due date set to ${dueDate}` : "Due date cleared");
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

export async function addProject(name: string, templateId?: string, examples = false) {
  const user = await requireUser();
  if (!user.is_admin) return { error: "Only workspace admins can create projects." };
  const clean = name.trim();
  if (!clean) return { error: "Project name is required." };

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
    await seedProject(id, templateId, null, examples, user.id);
  });
  revalidatePath("/board");
  return { ok: true, id };
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
