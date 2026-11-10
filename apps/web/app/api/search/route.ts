import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { searchWorkspace } from "@/lib/queries";

export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return new NextResponse("Unauthorized", { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return NextResponse.json({ cards: [], messages: [] });
  return NextResponse.json(await searchWorkspace(me.workspace_id, me.id, me.is_admin, q), { headers: { "cache-control": "no-store" } });
}
