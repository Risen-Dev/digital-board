import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { get, run, transaction } from "@/lib/db";
import { mergeSnapshots, type Snapshot } from "@/lib/canvas/merge";
import { broadcast, peers, type Peer } from "@/lib/canvas/hub";

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
 * Live collaboration (lib/canvas/hub.ts): cursor moves and element changes are
 * PATCHed here and relayed to the sheet's other tabs over their SSE stream.
 * The snapshot POST stays the source of truth.
 */
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
      // Peers answer with their full scene, so a (re)joining tab misses nothing.
      broadcast(canvasId, client, { type: "join" });
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

  const incoming: Snapshot | null = await req.json().catch(() => null);
  if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.elements ?? [])) {
    return new NextResponse("Invalid snapshot", { status: 400 });
  }

  // Merge, don't overwrite: with several tabs on one sheet, saves can land out
  // of order. The row lock keeps two concurrent merges from racing each other.
  await transaction(async () => {
    const row = await get<{ snapshot: string | null }>("SELECT snapshot FROM canvases WHERE id = ? FOR UPDATE", id);
    const merged = mergeSnapshots(row?.snapshot ? JSON.parse(row.snapshot) : null, incoming);
    await run("UPDATE canvases SET snapshot = ?, updated_at = ? WHERE id = ?", JSON.stringify(merged), new Date().toISOString(), id);
  });
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
