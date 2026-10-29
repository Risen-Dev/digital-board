import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { nudgeTyping } from "@/lib/chat-live";

/** "I'm typing" — sent every few seconds while the draft changes; nothing is stored. */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return new NextResponse("Unauthorized", { status: 401 });

  const { to } = ((await req.json().catch(() => null)) ?? {}) as { to?: string };
  const recipient = !to || to === "all" ? null : to;
  // Your own thread is the agent's; nobody else is there to see it.
  if (recipient === me.id) return new NextResponse(null, { status: 204 });
  if (recipient && !(await get("SELECT 1 FROM users WHERE id = ? AND workspace_id = ?", recipient, me.workspace_id))) {
    return new NextResponse("No such recipient", { status: 403 });
  }
  nudgeTyping(me.workspace_id, me, recipient);
  return new NextResponse(null, { status: 204 });
}
