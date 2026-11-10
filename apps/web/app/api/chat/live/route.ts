import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { chatStream } from "@/lib/chat-live";

export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return new NextResponse("Unauthorized", { status: 401 });
  return chatStream(req, me.workspace_id, me.id);
}
