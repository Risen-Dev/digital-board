import "server-only";
import { createHmac } from "node:crypto";
import { after } from "next/server";
import { get, run } from "./db";
import { outgoingPayload, type OutgoingEvent, type OutgoingTask } from "./outgoing-events";

/** `projects.outgoing` (JSONB): where to POST, the HMAC secret, which events, and the last result. */
export type OutgoingConfig = { url: string; secret: string; events: string[]; last?: { status: number | string; event: string; at: string } };

/**
 * Queues one delivery for a task change, sent after the response so the UI never waits on
 * the receiver. Call it after the change is committed — except for task.deleted, which
 * must run before the row is gone. A project without an outgoing URL costs one query.
 */
export async function notify(event: OutgoingEvent, taskId: string, change: string, actor: string | null) {
  const row = await get<OutgoingTask & { outgoing: OutgoingConfig; pid: string; pname: string; pkey: string }>(
    `SELECT p.outgoing, p.id AS pid, p.name AS pname, p.key AS pkey,
            t.id, p.key || '-' || t.number AS key, t.title, t.description, t.label, t.priority,
            t.due_date AS "dueDate", c.title AS "column",
            (SELECT string_agg(u.name, ', ' ORDER BY u.name) FROM task_assignees ta JOIN users u ON u.id = ta.user_id
              WHERE ta.task_id = t.id) AS assignee
       FROM tasks t JOIN columns c ON c.id = t.column_id JOIN projects p ON p.id = c.project_id
      WHERE t.id = ? AND p.outgoing IS NOT NULL`,
    taskId,
  );
  if (!row?.outgoing.events.includes(event)) return;
  const { outgoing, pid, pname, pkey, ...task } = row;
  const body = JSON.stringify(outgoingPayload(event, { id: pid, name: pname, key: pkey }, task, change, actor));
  after(() => deliver(pid, outgoing, event, body));
}

/**
 * POSTs one body, signed like GitHub (`X-Board-Signature: sha256=<hex hmac>`), and stores
 * the result as `last` for Settings to show. Returns the HTTP status or why it failed.
 */
// ponytail: one attempt, no retry queue; add a deliveries table with backoff if receivers flake.
export async function deliver(projectId: string, config: OutgoingConfig, event: OutgoingEvent, body: string) {
  let status: number | string;
  try {
    const res = await fetch(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "digital-board-webhook",
        "x-board-event": event,
        "x-board-signature": `sha256=${createHmac("sha256", config.secret).update(body).digest("hex")}`,
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    status = res.status;
  } catch (e) {
    status = e instanceof Error && e.name === "TimeoutError" ? "timeout" : "unreachable";
  }
  await run(
    "UPDATE projects SET outgoing = jsonb_set(outgoing, '{last}', ?::jsonb) WHERE id = ? AND outgoing IS NOT NULL",
    JSON.stringify({ status, event, at: new Date().toISOString() }), projectId,
  );
  return status;
}
