import "server-only";
import { all, get, run, transaction } from "./db";

/**
 * Puts a task at `toIndex` in `toColumnId` and renumbers both columns so
 * positions stay dense. No permission check: callers (moveTask, the GitHub
 * webhook) decide who may move what. Archived cards keep their old position and
 * are skipped, so `toIndex` counts only the cards the board shows. Not in actions.ts on purpose — every
 * export there is a Server Action anyone can call.
 */
export async function relocateTask(taskId: string, fromColumnId: string, toColumnId: string, toIndex: number) {
  await transaction(async () => {
    const siblings = (
      await all<{ id: string }>("SELECT id FROM tasks WHERE column_id = ? AND id != ? AND archived_at IS NULL ORDER BY position", toColumnId, taskId)
    ).map((r) => r.id);
    siblings.splice(Math.max(0, Math.min(toIndex, siblings.length)), 0, taskId);

    await run("UPDATE tasks SET column_id = ? WHERE id = ?", toColumnId, taskId);
    for (const [i, sid] of siblings.entries()) await run("UPDATE tasks SET position = ? WHERE id = ?", i, sid);

    if (fromColumnId !== toColumnId) {
      await run("UPDATE tasks SET column_since = ? WHERE id = ?", new Date().toISOString(), taskId);
      const rest = await all<{ id: string }>("SELECT id FROM tasks WHERE column_id = ? AND archived_at IS NULL ORDER BY position", fromColumnId);
      for (const [i, r] of rest.entries()) await run("UPDATE tasks SET position = ? WHERE id = ?", i, r.id);
    }
  });
}

/**
 * The next task number in a project (the 42 in WEB-42). Must run inside a
 * transaction: the project row lock keeps two concurrent creates from taking
 * the same number.
 */
export async function nextTaskNumber(projectId: string) {
  await get("SELECT id FROM projects WHERE id = ? FOR UPDATE", projectId);
  return (await get<{ n: number }>(
    `SELECT COALESCE(MAX(t.number), 0) + 1 n FROM tasks t JOIN columns c ON c.id = t.column_id WHERE c.project_id = ?`,
    projectId,
  ))!.n;
}
