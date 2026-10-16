import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { all, get, run, transaction } from "@/lib/db";
import { parseInbound } from "@/lib/inbound";
import { nextTaskNumber } from "@/lib/tasks";

const sha256 = (s: string) => createHash("sha256").update(s).digest();

/**
 * Generic inbound webhook: POST /api/integrations/inbound?project=<id> creates one card.
 * For Zapier, Make, form tools or curl. No session — the project's token is the auth,
 * sent as `Authorization: Bearer <token>` or, for tools that can't set headers, `&token=`.
 * Body: JSON or form fields `title` (required), `description`, `label`, `priority`,
 * `due_date` (YYYY-MM-DD), `column` (title; default the first column).
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("project") ?? "";
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || url.searchParams.get("token") || "";
  const row = await get<{ inbound_token: string | null; key: string }>("SELECT inbound_token, key FROM projects WHERE id = ?", projectId);
  if (!row?.inbound_token || !given || !timingSafeEqual(sha256(given), Buffer.from(row.inbound_token, "hex"))) {
    return NextResponse.json({ error: "Bad token." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const type = req.headers.get("content-type") ?? "";
    body = type.includes("form") ? Object.fromEntries(await req.formData()) : await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch {
    return NextResponse.json({ error: "Body must be a JSON object or form fields." }, { status: 400 });
  }
  const task = parseInbound(body);
  if ("error" in task) return NextResponse.json(task, { status: 400 });

  const columns = await all<{ id: string; title: string }>("SELECT id, title FROM columns WHERE project_id = ? ORDER BY position", projectId);
  const column = task.column ? columns.find((c) => c.title.toLowerCase() === task.column!.toLowerCase()) : columns[0];
  if (!column) {
    const names = columns.map((c) => c.title).join(", ");
    return NextResponse.json({ error: task.column ? `No column "${task.column}". Columns: ${names}.` : "The project has no columns." }, { status: 400 });
  }

  const id = randomUUID();
  const number = await transaction(async () => {
    const n = await nextTaskNumber(projectId);
    const at = new Date().toISOString();
    await run(
      `INSERT INTO tasks (id, column_id, title, description, label, priority, assignee_id, due_date, position, number, created_at)
       VALUES (?,?,?,?,?,?,NULL,?,(SELECT COALESCE(MAX(position) + 1, 0) FROM tasks WHERE column_id = ?),?,?)`,
      id, column.id, task.title, task.description, task.label, task.priority, task.dueDate, column.id, n, at,
    );
    await run("INSERT INTO task_events (task_id, actor_id, text, at) VALUES (?, NULL, ?, ?)", id, "Created by inbound webhook", at);
    return n;
  });
  revalidatePath("/board");
  return NextResponse.json({ ok: true, id, key: `${row.key}-${number}`, column: column.title }, { status: 201 });
}
