import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { activityNotifications, listMembersWithPresence, markActivityItemsRead, markActivityRead, markAllMessagesRead, unreadCounts } from "@/lib/queries";

/**
 * Lightweight ping from the workspace shell so presence and unread badges stay
 * live outside the Chat section. `currentUser()` does the heartbeat itself.
 */
export async function GET() {
  const me = await currentUser();
  if (!me) return new NextResponse("Unauthorized", { status: 401 });

  return NextResponse.json(
    { members: await listMembersWithPresence(me.workspace_id), unread: await unreadCounts(me.workspace_id, me.id), notifications: await activityNotifications(me.workspace_id, me.id, me.is_admin) },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return new NextResponse("Unauthorized", { status: 401 });
  const body = await req.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown): id is number => typeof id === "number" && Number.isInteger(id) && id > 0) : [];
  if (ids.length > 0) await markActivityItemsRead(me.id, ids);
  else await markActivityRead(me.workspace_id, me.id);
  if (new URL(req.url).searchParams.get("all") === "true") await markAllMessagesRead(me.workspace_id, me.id);
  return new NextResponse(null, { status: 204 });
}
