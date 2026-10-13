import { NextResponse } from "next/server";
import { get } from "@/lib/db";
import { guard } from "@/lib/canvas/guard";
import { aiConfig, askAgent, type ChatTurn } from "@/lib/ai";

/**
 * The canvas AI agent. Stateless: the client sends the whole conversation, the
 * model answers with a reply and optionally a flow, and the client draws it —
 * so the drawing then saves and syncs through the normal canvas path.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const canvas = await get<{ project_id: string }>("SELECT project_id FROM canvases WHERE id = ?", id);
  const user = canvas && await guard(canvas.project_id, true);
  if (!user) return new NextResponse("Not found", { status: 404 });

  const body = await req.json().catch(() => null);
  const turns: ChatTurn[] = Array.isArray(body?.messages) ? body.messages : [];
  const valid = turns.length > 0 && turns.length <= 40 && turns.at(-1)!.role === "user" && turns.every(
    (t) => (t?.role === "user" || t?.role === "assistant") && typeof t.content === "string" && t.content.length <= 8000,
  );
  if (!valid) return NextResponse.json({ error: "Invalid conversation." }, { status: 400 });

  const config = await aiConfig(user.workspace_id);
  if (!config) return NextResponse.json({ error: "The AI agent isn't set up yet — a workspace admin can configure it in Settings." }, { status: 400 });

  try {
    return NextResponse.json(await askAgent(config, turns.map(({ role, content }) => ({ role, content }))));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The AI provider failed." }, { status: 502 });
  }
}
