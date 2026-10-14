import "server-only";
import { all, run, transaction } from "./db";

/**
 * Puts a task at `toIndex` in `toColumnId` and renumbers both columns so
 * positions stay dense. No permission check: callers (moveTask, the GitHub
 * webhook) decide who may move what. Not in actions.ts on purpose — every
 * export there is a Server Action anyone can call.
 */
export async function relocateTask(taskId: string, fromColumnId: string, toColumnId: string, toIndex: number) {
  await transaction(async () => {
    const siblings = (
      await all<{ id: string }>("SELECT id FROM tasks WHERE column_id = ? AND id != ? ORDER BY position", toColumnId, taskId)
    ).map((r) => r.id);
    siblings.splice(Math.max(0, Math.min(toIndex, siblings.length)), 0, taskId);

    await run("UPDATE tasks SET column_id = ? WHERE id = ?", toColumnId, taskId);
    for (const [i, sid] of siblings.entries()) await run("UPDATE tasks SET position = ? WHERE id = ?", i, sid);

    if (fromColumnId !== toColumnId) {
      const rest = await all<{ id: string }>("SELECT id FROM tasks WHERE column_id = ? ORDER BY position", fromColumnId);
      for (const [i, r] of rest.entries()) await run("UPDATE tasks SET position = ? WHERE id = ?", i, r.id);
    }
  });
}
