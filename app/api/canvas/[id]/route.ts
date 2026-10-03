import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { get, run } from "@/lib/db";

/**
 * Canvas snapshots travel through a Route Handler, not a Server Action.
 * Server Actions cap the request body at 1 MB, and a canvas scene blows past
 * that as soon as a drawing gets real (pasted images are inlined as data URLs).
 * Route Handlers have no such cap, so raising `serverActions.bodySizeLimit`
 * would only move the failure, not remove it.
 */

/**
 * The workspace check comes FIRST and applies to admins too — being an admin of
 * your own workspace must not open someone else's canvas.
 */
async function guard(projectId: string, write = false) {
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

/**
 * Live collaboration: each open sheet holds an SSE stream (GET ?live=<tabId>),
 * and cursor moves / element changes are PATCHed here and fanned out to the
 * other tabs on that sheet. The snapshot POST stays the source of truth.
 */
type Peer = { client: string; send: (data: string) => void };
// ponytail: in-process fan-out, so live cursors/edits only reach tabs served by
// the same Node instance. Running pm2 with instances > 1 needs Postgres LISTEN/NOTIFY here.
const hub = globalThis as unknown as { canvasPeers?: Map<string, Set<Peer>> };
const peers = (hub.canvasPeers ??= new Map());

function broadcast(canvasId: string, from: string, message: object) {
  const data = `data: ${JSON.stringify({ ...message, from })}\n\n`;
  for (const peer of peers.get(canvasId) ?? []) if (peer.client !== from) peer.send(data);
}

function liveStream(req: Request, canvasId: string, client: string) {
  const room = peers.get(canvasId) ?? new Set<Peer>();
  peers.set(canvasId, room);
  const encoder = new TextEncoder();
  let leave = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const peer: Peer = {
        client,
        send: (data) => {
          try { controller.enqueue(encoder.encode(data)); } catch { leave(); }
        },
      };
      // Comment frames keep proxies from closing an idle stream.
      const ping = setInterval(() => peer.send(": ping\n\n"), 25_000);
      leave = () => {
        if (!room.delete(peer)) return;
        clearInterval(ping);
        broadcast(canvasId, client, { type: "leave" });
        try { controller.close(); } catch {}
      };
      room.add(peer);
      req.signal.addEventListener("abort", () => leave());
    },
    cancel: () => leave(),
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const live = new URL(req.url).searchParams.get("live");
  const row = await get<{ snapshot: string | null; project_id: string }>(
    `SELECT ${live ? "NULL AS snapshot" : "snapshot"}, project_id FROM canvases WHERE id = ?`, id,
  );
  if (!row || !await guard(row.project_id)) return new NextResponse("Not found", { status: 404 });
  if (live) return liveStream(req, id, live);

  // Already JSON on disk — hand it back verbatim rather than parse-then-restringify.
  return new NextResponse(row.snapshot ?? "null", {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const canvas = await get<{ project_id: string }>("SELECT project_id FROM canvases WHERE id = ?", id);
  if (!canvas || !await guard(canvas.project_id, true)) return new NextResponse("Not found", { status: 404 });

  const snapshot = await req.text();
  try {
    JSON.parse(snapshot);
  } catch {
    return new NextResponse("Invalid snapshot", { status: 400 });
  }

  await run("UPDATE canvases SET snapshot = ?, updated_at = ? WHERE id = ?", snapshot, new Date().toISOString(), id);
  return new NextResponse(null, { status: 204 });
}

/** Relays one live message (cursor or changed elements) to the sheet's other tabs. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const message = await req.json().catch(() => null);
  if (!message || typeof message.from !== "string" || !["pointer", "scene"].includes(message.type)) {
    return new NextResponse("Invalid message", { status: 400 });
  }

  const canvas = await get<{ project_id: string }>("SELECT project_id FROM canvases WHERE id = ?", id);
  // ponytail: one session lookup per cursor PATCH (~20/s per drawing user); fine for a team, not a crowd.
  const user = canvas && await guard(canvas.project_id, message.type === "scene");
  if (!user) return new NextResponse("Not found", { status: 404 });

  // The name comes from the session, never from the client.
  broadcast(id, message.from, { ...message, name: user.name });
  return new NextResponse(null, { status: 204 });
}
