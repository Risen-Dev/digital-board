import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { get, run, transaction } from "@/lib/db";
import { conversation, listMembersWithPresence, markRead, unreadCounts } from "@/lib/queries";

/**
 * Chat runs on a poll, not a socket. A self-hosted single instance does not
 * justify a WebSocket server, and Server Actions would revalidate the whole
 * board on every message. Reading a conversation also marks it read.
 */

const MAX_BODY = 4000;
const MAX_FILE = 10 * 1024 * 1024;
const MAX_FILES = 5;
const EDIT_WINDOW_MS = 15 * 60 * 1000;

export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return new NextResponse("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const withParam = url.searchParams.get("with");
  const withUser = !withParam || withParam === "all" ? null : withParam;
  const after = Number(url.searchParams.get("after") ?? 0) || 0;

  // Viewing a conversation is what marks it read.
  await markRead(me.workspace_id, me.id, withUser);

  return NextResponse.json(
    {
      messages: await conversation(me.workspace_id, me.id, withUser, after),
      members: await listMembersWithPresence(me.workspace_id),
      unread: await unreadCounts(me.workspace_id, me.id),
      me: me.id,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return new NextResponse("Unauthorized", { status: 401 });

  const isForm = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
  let to: string | null = null;
  let text = "";
  let files: File[] = [];

  if (isForm) {
    const form = await req.formData();
    to = (form.get("to") as string) || null;
    text = String(form.get("body") ?? "").trim();
    files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  } else {
    const json = ((await req.json().catch(() => null)) ?? {}) as { to?: string | null; body?: string };
    to = json.to ?? null;
    text = (json.body ?? "").trim();
  }

  if (to && to !== "all" && !(await get("SELECT 1 FROM users WHERE id = ? AND workspace_id = ?", to, me.workspace_id))) {
    return new NextResponse("No such recipient", { status: 403 });
  }
  if (!text && files.length === 0) return new NextResponse("Empty message", { status: 400 });
  if (text.length > MAX_BODY) return new NextResponse("Message too long", { status: 413 });
  if (files.length > MAX_FILES) return new NextResponse(`At most ${MAX_FILES} files`, { status: 413 });
  if (files.some((f) => f.size > MAX_FILE)) return new NextResponse("File larger than 10 MB", { status: 413 });

  const saved = await Promise.all(
    files.map(async (f) => ({
      id: randomUUID(),
      name: f.name || "file",
      mime: f.type || "application/octet-stream",
      size: f.size,
      data: Buffer.from(await f.arrayBuffer()),
    })),
  );

  const now = new Date().toISOString();
  await transaction(async () => {
    const inserted = await get<{ id: number }>(
      "INSERT INTO messages (workspace_id, author_id, recipient_id, body, created_at) VALUES (?,?,?,?,?) RETURNING id",
      me.workspace_id, me.id, to && to !== "all" ? to : null, text, now,
    );
    for (const f of saved) {
      await run(
        "INSERT INTO attachments (id, message_id, name, mime, size, data, created_at) VALUES (?,?,?,?,?,?,?)",
        f.id, inserted!.id, f.name, f.mime, f.size, f.data, now,
      );
    }
  });

  return new NextResponse(null, { status: 204 });
}

export async function PATCH(req: Request) {
  const me = await currentUser();
  if (!me) return new NextResponse("Unauthorized", { status: 401 });

  const { id, body } = ((await req.json().catch(() => null)) ?? {}) as { id?: number; body?: string };
  const text = (body ?? "").trim();
  if (!id || !text) return new NextResponse("Bad request", { status: 400 });
  if (text.length > MAX_BODY) return new NextResponse("Message too long", { status: 413 });

  const row = await get<{ author_id: string; created_at: string }>(
    "SELECT author_id, created_at FROM messages WHERE id = ?",
    id,
  );

  if (!row) return new NextResponse("Not found", { status: 404 });
  if (row.author_id !== me.id) return new NextResponse("Not your message", { status: 403 });
  if (Date.now() - new Date(row.created_at).getTime() > EDIT_WINDOW_MS) {
    return new NextResponse("Edit window closed", { status: 403 });
  }

  await run("UPDATE messages SET body = ?, edited_at = ? WHERE id = ?", text, new Date().toISOString(), id);
  return new NextResponse(null, { status: 204 });
}
