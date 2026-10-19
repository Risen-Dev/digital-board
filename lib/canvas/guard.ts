import "server-only";
import { currentUser, type User } from "@/lib/auth";
import { get } from "@/lib/db";

type ProjectRole = "workspace-admin" | "admin" | "editor" | "viewer";

/**
 * Every permission check routes through here. The workspace check comes FIRST
 * and applies to admins too — being an admin of your own workspace must not
 * reach into someone else's.
 */
export async function projectRole(user: User, projectId: string): Promise<ProjectRole | null> {
  const project = await get<{ workspace_id: string }>("SELECT workspace_id FROM projects WHERE id = ?", projectId);
  if (!project || project.workspace_id !== user.workspace_id) return null;
  if (user.is_admin) return "workspace-admin";
  return (await get<{ role: ProjectRole }>(
    "SELECT role FROM project_members WHERE project_id = ? AND user_id = ?",
    projectId, user.id,
  ))?.role ?? null;
}

/** The signed-in user when they may read (or with `write`, edit) the project; else null. */
export async function guard(projectId: string, write = false) {
  const user = await currentUser();
  const role = user && await projectRole(user, projectId);
  return role && (!write || role !== "viewer") ? user : null;
}

/** `guard` for the project a task belongs to. */
export async function taskGuard(taskId: string, write = false) {
  const task = await get<{ project_id: string }>(
    "SELECT c.project_id FROM tasks t JOIN columns c ON c.id = t.column_id WHERE t.id = ?", taskId,
  );
  return task ? guard(task.project_id, write) : null;
}
