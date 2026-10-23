import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { all, get } from "@/lib/db";

/**
 * Settings → General → Export: the whole workspace as one JSON file, for
 * workspace admins. Every table keeps its own rows and ids, so a restore is a
 * straight INSERT per table. Left out on purpose: password hashes, sessions,
 * push subscriptions and every token or API key (GitHub, webhooks, iCal, AI),
 * and direct messages, which are private to the two people in them.
 * Image and attachment bytes are base64.
 */
// ponytail: built in memory; a workspace with gigabytes of images needs a streamed writer.
export async function GET() {
  const me = await currentUser();
  if (!me) return new NextResponse("Unauthorized", { status: 401 });
  if (!me.is_admin) return new NextResponse("Only workspace admins can export.", { status: 403 });

  const ws = me.workspace_id;
  const P = "(SELECT id FROM projects WHERE workspace_id = ?)";
  const T = `(SELECT t.id FROM tasks t JOIN columns c ON c.id = t.column_id WHERE c.project_id IN ${P})`;
  const M = "(SELECT id FROM messages WHERE workspace_id = ? AND recipient_id IS NULL)";

  const workspace = await get("SELECT id, name, created_at FROM workspaces WHERE id = ?", ws);
  const data = {
    format: "digital-board-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace,
    users: await all("SELECT id, email, name, color, is_admin, created_at FROM users WHERE workspace_id = ? ORDER BY created_at", ws),
    projects: await all(
      `SELECT id, name, key, position, created_at, done_column_id, github::jsonb ->> 'repo' AS github_repo, outgoing - 'secret' AS outgoing
         FROM projects WHERE workspace_id = ? ORDER BY position, created_at`, ws),
    project_members: await all(`SELECT * FROM project_members WHERE project_id IN ${P}`, ws),
    columns: await all(`SELECT * FROM columns WHERE project_id IN ${P} ORDER BY project_id, position`, ws),
    tasks: await all(`SELECT * FROM tasks WHERE id IN ${T} ORDER BY created_at`, ws),
    task_assignees: await all(`SELECT * FROM task_assignees WHERE task_id IN ${T}`, ws),
    task_blockers: await all(`SELECT * FROM task_blockers WHERE task_id IN ${T}`, ws),
    time_entries: await all(`SELECT * FROM time_entries WHERE task_id IN ${T} ORDER BY id`, ws),
    task_events: await all(`SELECT * FROM task_events WHERE task_id IN ${T} ORDER BY id`, ws),
    task_links: await all(`SELECT * FROM task_links WHERE task_id IN ${T}`, ws),
    task_images: await all(
      `SELECT id, task_id, name, mime, cover, created_at, encode(data, 'base64') AS data FROM task_images WHERE task_id IN ${T}`, ws),
    custom_fields: await all(`SELECT * FROM custom_fields WHERE project_id IN ${P} ORDER BY project_id, position`, ws),
    saved_views: await all(`SELECT * FROM saved_views WHERE project_id IN ${P} ORDER BY project_id, created_at`, ws),
    canvases: await all(`SELECT * FROM canvases WHERE project_id IN ${P} ORDER BY project_id, position`, ws),
    meetings: await all("SELECT * FROM meetings WHERE workspace_id = ? ORDER BY created_at", ws),
    meeting_attendees: await all("SELECT * FROM meeting_attendees WHERE meeting_id IN (SELECT id FROM meetings WHERE workspace_id = ?)", ws),
    messages: await all(`SELECT * FROM messages WHERE id IN ${M} ORDER BY id`, ws),
    attachments: await all(
      `SELECT id, message_id, name, mime, size, created_at, encode(data, 'base64') AS data FROM attachments WHERE message_id IN ${M}`, ws),
  };

  const name = (workspace as { name?: string } | undefined)?.name ?? "workspace";
  const file = `${name.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "workspace"}-${data.exportedAt.slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(data), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${file}"`,
      "cache-control": "no-store",
    },
  });
}
