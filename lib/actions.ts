"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { all, get, run, transaction } from "./db";
import { createUser, createWorkspace, currentUser, endSession, login, passwordOf, setPassword, startSession, verifyPassword } from "./auth";
import { DEFAULT_COLUMNS, reorder, type Priority } from "./board";
import { broadcast } from "./canvas/hub";

async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

const now = () => new Date().toISOString();

async function logEvent(taskId: string, actorId: string | null, text: string) {
  await run("INSERT INTO task_events (task_id, actor_id, text, at) VALUES (?,?,?,?)", taskId, actorId, text, now());
}

async function projectRole(user: Awaited<ReturnType<typeof requireUser>>, projectId: string) {
  if (user.is_admin) return "workspace-admin";
  return (await get<{ role: "admin" | "editor" | "viewer" }>(
    "SELECT role FROM project_members WHERE project_id = ? AND user_id = ?",
    projectId, user.id,
  ))?.role ?? null;
}

async function writableColumn(user: Awaited<ReturnType<typeof requireUser>>, columnId: string) {
  const column = await get<{ project_id: string }>("SELECT project_id FROM columns WHERE id = ?", columnId);
  if (!column) return false;
  const role = await projectRole(user, column.project_id);
  return role !== null && role !== "viewer";
}

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
      "INSERT INTO projects (id, workspace_id, name, position, created_at) VALUES (?,?,?,0,?)",
      projectId, workspaceId, project, now(),
    );
    for (const [i, title] of columns.entries()) {
      const preset = DEFAULT_COLUMNS.find((d) => d.title === title);
      await run(
        "INSERT INTO columns (id, project_id, title, color, position) VALUES (?,?,?,?,?)",
        randomUUID(),
        projectId,
        title,
        preset?.color ?? "var(--muted-foreground)",
        i,
      );
    }
  });

  await startSession(userId);
  redirect("/board");
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

  await createUser(user.workspace_id, email, name, password);
  revalidatePath("/board");
  return { ok: true };
}

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

export async function createTask(_prev: unknown, form: FormData) {
  const user = await requireUser();
  const columnId = String(form.get("columnId") ?? "");
  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "Title is required." };
  if (!await writableColumn(user, columnId)) return { error: "You cannot edit this project." };
  if (!await get("SELECT 1 FROM columns WHERE id = ?", columnId)) return { error: "Column not found." };

  const priority = (String(form.get("priority") ?? "medium") as Priority) ?? "medium";
  const description = String(form.get("description") ?? "").trim() || null;
  const label = String(form.get("label") ?? "").trim() || null;
  const dueDate = String(form.get("dueDate") ?? "").trim() || null;
  const assignee = String(form.get("assigneeId") ?? "").trim() || null;

  const next = ((await get<{ n: number }>("SELECT COALESCE(MAX(position) + 1, 0) n FROM tasks WHERE column_id = ?", columnId)))!.n;
  const id = randomUUID();
  await run(
    `INSERT INTO tasks (id, column_id, title, description, label, priority, assignee_id, due_date, position, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id, columnId, title, description, label, priority, assignee, dueDate, next, now(),
  );
  await logEvent(id, user.id, "Task created");
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
    const siblings = (
      await all<{ id: string }>(
        "SELECT id FROM tasks WHERE column_id = ? AND id != ? ORDER BY position",
        toColumnId,
        taskId,
      )
    ).map((r) => r.id);
    siblings.splice(Math.max(0, Math.min(toIndex, siblings.length)), 0, taskId);

    await run("UPDATE tasks SET column_id = ? WHERE id = ?", toColumnId, taskId);
    for (const [i, sid] of siblings.entries()) await run("UPDATE tasks SET position = ? WHERE id = ?", i, sid);

    if (fromColumnId !== toColumnId) {
      const rest = await all<{ id: string }>("SELECT id FROM tasks WHERE column_id = ? ORDER BY position", fromColumnId);
      for (const [i, r] of rest.entries()) await run("UPDATE tasks SET position = ? WHERE id = ?", i, r.id);
    }

    await logEvent(
      taskId,
      user.id,
      fromColumnId === toColumnId ? `Reordered in ${dest.title}` : `Moved from ${fromTitle} to ${dest.title}`,
    );
  });

  revalidatePath("/board");
}

export async function updateTask(_prev: unknown, form: FormData) {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const before = await get<{ title: string; description: string | null; priority: string; assignee_id: string | null; due_date: string | null }>(
    "SELECT title, description, priority, assignee_id, due_date FROM tasks WHERE id = ?",
    id,
  );
  const taskColumn = await get<{ column_id: string }>("SELECT column_id FROM tasks WHERE id = ?", id);
  if (!taskColumn || !await writableColumn(user, taskColumn.column_id)) return { error: "You cannot edit this project." };
  if (!before) return { error: "Task not found." };

  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "Title is required." };
  const priority = String(form.get("priority") ?? before.priority);
  const description = String(form.get("description") ?? "").trim() || null;
  const label = String(form.get("label") ?? "").trim() || null;
  const dueDate = String(form.get("dueDate") ?? "").trim() || null;
  const assignee = String(form.get("assigneeId") ?? "").trim() || null;

  await run(
    "UPDATE tasks SET title = ?, description = ?, label = ?, priority = ?, assignee_id = ?, due_date = ? WHERE id = ?",
    title, description, label, priority, assignee, dueDate, id,
  );
  if (before.title !== title) await logEvent(id, user.id, `Title changed to "${title}"`);
  if (before.description !== description) await logEvent(id, user.id, "Details updated");
  if (before.priority !== priority) await logEvent(id, user.id, `Priority changed to ${priority}`);
  if (before.assignee_id !== assignee) {
    const who = assignee ? ((await get<{ name: string }>("SELECT name FROM users WHERE id = ?", assignee)))?.name : null;
    await logEvent(id, user.id, who ? `Assigned to ${who}` : "Assignee cleared");
  }
  if (before.due_date !== dueDate) await logEvent(id, user.id, dueDate ? `Due date set to ${dueDate}` : "Due date cleared");

  revalidatePath("/board");
  return { ok: true };
}

export async function deleteTask(id: string) {
  const user = await requireUser();
  const task = await get<{ column_id: string }>("SELECT column_id FROM tasks WHERE id = ?", id);
  if (!task || !await writableColumn(user, task.column_id)) return;
  await run("DELETE FROM tasks WHERE id = ?", id);
  revalidatePath("/board");
}
export async function setProjectMember(projectId: string, userId: string, role: "admin" | "editor" | "viewer" | "") {
  const user = await requireUser();
  if (!user.is_admin) return { error: "Only workspace admins can assign projects." };
  if (role === "") await run("DELETE FROM project_members WHERE project_id = ? AND user_id = ?", projectId, userId);
  else await run(
    `INSERT INTO project_members (project_id, user_id, role) VALUES (?,?,?)
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = excluded.role`,
    projectId, userId, role,
  );
  revalidatePath("/board");
  return { ok: true };
}

export async function addProject(name: string) {
  const user = await requireUser();
  if (!user.is_admin) return { error: "Only workspace admins can create projects." };
  await requireUser();
  const clean = name.trim();
  if (!clean) return { error: "Project name is required." };

  const id = randomUUID();
  const next = (await get<{ n: number }>(
    "SELECT COALESCE(MAX(position) + 1, 0) n FROM projects WHERE workspace_id = ?", user.workspace_id,
  ))!.n;
  await transaction(async () => {
    await run(
      "INSERT INTO projects (id, workspace_id, name, position, created_at) VALUES (?,?,?,?,?)",
      id, user.workspace_id, clean, next, now(),
    );
    // A project with no columns is a dead end, so seed the defaults.
    for (const [i, c] of DEFAULT_COLUMNS.entries()) {
      await run(
        "INSERT INTO columns (id, project_id, title, color, position) VALUES (?,?,?,?,?)",
        randomUUID(), id, c.title, c.color, i,
      );
    }
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

export async function renameProject(id: string, name: string) {
  const user = await requireUser();
  const role = await projectRole(user, id);
  if (role !== "workspace-admin" && role !== "admin") return { error: "You cannot manage this project." };
  const clean = name.trim();
  if (!clean) return { error: "Project name is required." };
  await run("UPDATE projects SET name = ? WHERE id = ?", clean, id);
  revalidatePath("/board");
  return { ok: true };
}

export async function addColumn(projectId: string, title: string, color: string) {
  const user = await requireUser();
  const role = await projectRole(user, projectId);
  if (role !== "workspace-admin" && role !== "admin") return { error: "You cannot manage this project." };
  const clean = title.trim();
  if (!clean) return { error: "Column name is required." };
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
  const column = await get<{ project_id: string }>("SELECT project_id FROM columns WHERE id = ?", id);
  const role = column && await projectRole(user, column.project_id);
  if (role !== "workspace-admin" && role !== "admin") return { error: "You cannot manage this project." };
  const clean = title.trim();
  if (!clean) return { error: "Column name is required." };
  await run("UPDATE columns SET title = ?, color = ? WHERE id = ?", clean, color, id);
  revalidatePath("/board");
  return { ok: true };
}

/** Deleting a column takes its tasks with it (FK cascade) — the UI confirms the count first. */
export async function deleteColumn(id: string) {
  const user = await requireUser();
  const column = await get<{ project_id: string }>("SELECT project_id FROM columns WHERE id = ?", id);
  if (!column) return { error: "Column not found." };
  const role = await projectRole(user, column.project_id);
  if (role !== "workspace-admin" && role !== "admin") return { error: "You cannot manage this project." };
  const last = (await get<{ n: number }>("SELECT COUNT(*) n FROM columns WHERE project_id = ?", column.project_id))!.n;
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
  const role = col && await projectRole(user, col.project_id);
  if (!col || (role !== "workspace-admin" && role !== "admin")) return;
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
  await requireUser();
  const { taskHistory } = await import("./queries");
  return taskHistory(taskId);
}

// ── Canvas sheets ───────────────────────────────────────────────────────────

export async function createCanvas(projectId: string, name: string) {
  const user = await requireUser();
  if ((await projectRole(user, projectId)) === null || (await projectRole(user, projectId)) === "viewer") return;
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
  const canvas = await get<{ project_id: string }>("SELECT project_id FROM canvases WHERE id = ?", id);
  if (!canvas || (await projectRole(user, canvas.project_id)) === "viewer" || (await projectRole(user, canvas.project_id)) === null) return;
  const clean = name.trim();
  if (!clean) return;
  await run("UPDATE canvases SET name = ? WHERE id = ?", clean, id);
  revalidatePath("/board");
}

export async function deleteCanvas(id: string) {
  const user = await requireUser();
  const canvas = await get<{ project_id: string }>("SELECT project_id FROM canvases WHERE id = ?", id);
  if (!canvas || (await projectRole(user, canvas.project_id)) === "viewer" || (await projectRole(user, canvas.project_id)) === null) return;
  await run("DELETE FROM canvases WHERE id = ?", id);
  // Anyone else on this sheet would keep drawing into a row that no longer exists.
  broadcast(id, "", { type: "deleted" });
  revalidatePath("/board");
}
