import "server-only";
import { currentUser } from "@/lib/auth";
import { get } from "@/lib/db";

/**
 * The workspace check comes FIRST and applies to admins too — being an admin of
 * your own workspace must not open someone else's canvas.
 */
export async function guard(projectId: string, write = false) {
  const user = await currentUser();
  if (!user) return null;

  const project = await get<{ workspace_id: string }>("SELECT workspace_id FROM projects WHERE id = ?", projectId);
  if (!project || project.workspace_id !== user.workspace_id) return null;

  if (user.is_admin === 1) return user;
  const member = await get<{ role: string }>(
    "SELECT role FROM project_members WHERE project_id = ? AND user_id = ?",
    projectId, user.id,
  );
  return member && (!write || member.role !== "viewer") ? user : null;
}
