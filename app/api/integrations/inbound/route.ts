import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { all, get, run, transaction } from "@/lib/db";
import { keysIn } from "@/lib/github-events";
import { addressOf, emailOf, parseInbound } from "@/lib/inbound";
import { notify } from "@/lib/outgoing";
import { nextTaskNumber } from "@/lib/tasks";
import { nudgeBoard } from "@/lib/chat-live";

const sha256 = (s: string) => createHash("sha256").update(s).digest();

/**
 * Generic inbound webhook: POST /api/integrations/inbound?project=<id> creates one card.
 * For Zapier, Make, form tools or curl. No session — the project's token is the auth,
 * sent as `Authorization: Bearer <token>` or, for tools that can't set headers, `&token=`.
 * Body: JSON or form fields `title` (required), `description`, `label`, `priority`,
 * `due_date` (YYYY-MM-DD), `column` (title; default the first column).
 *
 * Email-to-ticket: point an inbound-mail service (Postmark, SendGrid Inbound Parse,
 * Mailgun) here with `&token=` (or Basic auth with the token as password). The subject
 * becomes the title. A reply from a card's original sender, whose subject names the card
 * (WEB-42) or matches its title after "Re:", is appended to its description instead.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("project") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  // Basic auth (https://x:<token>@host/…) is the only header some mail services can send.
  const basic = /^Basic\s+/i.test(auth) && Buffer.from(auth.replace(/^Basic\s+/i, ""), "base64").toString().split(":").slice(1).join(":");
  const given = basic || auth.replace(/^Bearer\s+/i, "") || url.searchParams.get("token") || "";
  const row = await get<{ inbound_token: string | null; key: string; workspace_id: string }>("SELECT inbound_token, key, workspace_id FROM projects WHERE id = ?", projectId);
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
  const email = emailOf(body);
  if (email) {
    const [key] = keysIn(email.subject, row.key);
    // The card a reply belongs to: the key in its subject, else the newest card with the same subject.
    const card = await get<{ id: string; key: string; description: string | null }>(
      `SELECT t.id, p.key || '-' || t.number AS key, t.description
         FROM tasks t JOIN columns c ON c.id = t.column_id JOIN projects p ON p.id = c.project_id
        WHERE c.project_id = ? AND ${key ? "t.number = ?" : "lower(t.title) = lower(?)"}
        ORDER BY t.created_at DESC LIMIT 1`,
      projectId, key ? Number(key.split("-")[1]) : email.subject.slice(0, 200),
    );
    const original = card && card.description?.match(/^From: (.+)$/m)?.[1];
    if (card && original && addressOf(original) === addressOf(email.from)) {
      const at = new Date().toISOString();
      await transaction(async () => {
        const reply = `---\nReply from ${email.from} (${at.slice(0, 16).replace("T", " ")} UTC):\n\n${email.text}`;
        await run("UPDATE tasks SET description = ? WHERE id = ?", [card.description, reply].join("\n\n"), card.id);
        await run("INSERT INTO task_events (task_id, actor_id, text, at) VALUES (?, NULL, ?, ?)", card.id, `Email reply from ${email.from}`, at);
      });
      await notify("task.updated", card.id, `Email reply from ${email.from}`, null);
      revalidatePath("/board");
      nudgeBoard(row.workspace_id);
      return NextResponse.json({ ok: true, id: card.id, key: card.key, replied: true });
    }
    body = { title: email.subject, description: [`From: ${email.from}`, email.text].filter(Boolean).join("\n\n") };
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
    await run("INSERT INTO task_events (task_id, actor_id, text, at) VALUES (?, NULL, ?, ?)", id, email ? `Created from email by ${email.from}` : "Created by inbound webhook", at);
    return n;
  });
  await notify("task.created", id, email ? `Created from email by ${email.from}` : "Created by inbound webhook", null);
  revalidatePath("/board");
  nudgeBoard(row.workspace_id);
  return NextResponse.json({ ok: true, id, key: `${row.key}-${number}`, column: column.title }, { status: 201 });
}
