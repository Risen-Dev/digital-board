import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { all, get, run, transaction } from "./db";
import { columnFor, type Step } from "./github-events";
import { relocateTask } from "./tasks";

/** GitHub signs each delivery with the project's secret: `X-Hub-Signature-256: sha256=<hex hmac of the raw body>`. */
export function validSignature(secret: string, body: string, header: string | null) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const event = (taskId: string, text: string) =>
  run("INSERT INTO task_events (task_id, actor_id, text, at) VALUES (?, NULL, ?, ?)", taskId, text, new Date().toISOString());

/** Applies a planned delivery to one project. Unknown keys are skipped; the whole delivery is one transaction. */
export async function applySteps(projectId: string, steps: Step[]) {
  const done = { linked: 0, moved: 0, noted: 0 };
  await transaction(async () => {
    const columns = await all<{ id: string; title: string; position: number }>(
      "SELECT id, title, position FROM columns WHERE project_id = ? ORDER BY position", projectId,
    );
    // Re-read per step: an earlier step of the same delivery may have moved the card.
    const task = (key: string) =>
      get<{ id: string; column_id: string; position: number }>(
        `SELECT t.id, t.column_id, c.position FROM tasks t JOIN columns c ON c.id = t.column_id
          WHERE c.project_id = ? AND t.number = ?`,
        projectId, Number(key.split("-").pop()),
      );

    for (const step of steps) {
      if ("sha" in step) {
        await run(
          `UPDATE task_links SET ci = ? WHERE kind = 'pulls' AND sha = ?
              AND task_id IN (SELECT t.id FROM tasks t JOIN columns c ON c.id = t.column_id WHERE c.project_id = ?)`,
          step.ci, step.sha, projectId,
        );
        continue;
      }
      const t = await task(step.key);
      if (!t) continue;

      if ("link" in step) {
        const l = step.link;
        await run(
          `INSERT INTO task_links (task_id, kind, ext_id, title, url, ref, state, author, sha, ci, at)
           VALUES (?,?,?,?,?,?,?,?,?,NULL,?)
           ON CONFLICT (task_id, kind, ext_id) DO UPDATE SET
             title = excluded.title, url = excluded.url, ref = excluded.ref, state = excluded.state,
             author = COALESCE(excluded.author, task_links.author), at = COALESCE(excluded.at, task_links.at),
             ci = CASE WHEN task_links.sha = excluded.sha THEN task_links.ci END,
             sha = excluded.sha`,
          t.id, l.kind, l.extId, l.title, l.url, l.ref, l.state, l.author, l.sha, l.at,
        );
        done.linked++;
      } else if ("unlink" in step) {
        await run("DELETE FROM task_links WHERE task_id = ? AND kind = ? AND ext_id = ?", t.id, step.unlink.kind, step.unlink.extId);
      } else if ("move" in step) {
        const to = columnFor(step.move, columns, t.position);
        if (!to) continue;
        const from = columns.find((c) => c.id === t.column_id)?.title ?? "?";
        await relocateTask(t.id, t.column_id, to.id, 0);
        await event(t.id, `GitHub: ${step.why} — moved from ${from} to ${to.title}`);
        done.moved++;
      } else {
        await event(t.id, step.note);
        done.noted++;
      }
    }
  });
  return done;
}
