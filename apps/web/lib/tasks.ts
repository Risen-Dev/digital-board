import "server-only";
import { all, get, run, transaction } from "./db";
import { automationsFor, type Automation } from "./automations";
import { joinLabels } from "./board";

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

/**
 * Runs the project's automation rules for a card that was just created or moved (called
 * from `notify`, which every such path goes through). Actions only edit fields and
 * assignees, never move the card, so a rule can never trigger another.
 */
// ponytail: fires only on created/moved, one action per rule; add triggers (due soon, label added) when someone asks.
export async function runAutomations(event: string, taskId: string) {
  const row = await get<{ automations: Automation[] | null; column_id: string; label: string | null }>(
    `SELECT p.automations, t.column_id, t.label
       FROM tasks t JOIN columns c ON c.id = t.column_id JOIN projects p ON p.id = c.project_id WHERE t.id = ?`,
    taskId,
  );
  if (!row?.automations) return;
  let label = row.label;
  for (const rule of automationsFor(row.automations, event, row.column_id)) {
    let text: string | null = null;
    if (rule.do === "assign") {
      const added = await get<{ name: string }>(
        `WITH ins AS (INSERT INTO task_assignees (task_id, user_id) SELECT ?, id FROM users WHERE id = ? ON CONFLICT DO NOTHING RETURNING user_id)
         SELECT u.name FROM ins JOIN users u ON u.id = ins.user_id`,
        taskId, rule.value,
      );
      if (added) text = `Automation: assigned to ${added.name}`;
    } else if (rule.do === "unassign") {
      const removed = await get<{ n: number }>("WITH d AS (DELETE FROM task_assignees WHERE task_id = ? RETURNING 1) SELECT COUNT(*)::int n FROM d", taskId);
      if (removed!.n) text = "Automation: removed every assignee";
    } else if (rule.do === "priority") {
      await run("UPDATE tasks SET priority = ? WHERE id = ?", rule.value, taskId);
      text = `Automation: priority set to ${rule.value}`;
    } else if (rule.do === "label") {
      const next = joinLabels(`${label ?? ""}, ${rule.value}`);
      if (next !== label) {
        await run("UPDATE tasks SET label = ? WHERE id = ?", next, taskId);
        label = next;
        text = `Automation: label ${rule.value} added`;
      }
    } else {
      const due = new Date(Date.now() + Number(rule.value) * 864e5).toLocaleDateString("en-CA");
      await run("UPDATE tasks SET due_date = ? WHERE id = ?", due, taskId);
      text = `Automation: due date set to ${due}`;
    }
    if (text) await run("INSERT INTO task_events (task_id, actor_id, text, at, kind) VALUES (?,NULL,?,?,'event')", taskId, text, new Date().toISOString());
  }
}
