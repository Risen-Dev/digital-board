import { NextResponse } from "next/server";
import { get } from "@/lib/db";
import { guard } from "@/lib/canvas/guard";
import { aiConfig, askAgent, workspaceModels, type ChatTurn } from "@/lib/ai";

async function editor(id: string) {
  const canvas = await get<{ project_id: string }>("SELECT project_id FROM canvases WHERE id = ?", id);
  return canvas ? guard(canvas.project_id, true) : null;
}

/** Models the chat panel may switch between — the saved key's list, never the key. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await editor((await params).id);
  if (!user) return new NextResponse("Not found", { status: 404 });
  const config = await aiConfig(user.workspace_id);
  if (!config) return NextResponse.json({ models: [], model: null });
  // A provider that can't list models still works with the admin's model.
  const models = await workspaceModels(user.workspace_id, config).catch(() => [config.model]);
  return NextResponse.json({ models: models.includes(config.model) ? models : [config.model, ...models], model: config.model });
}

/**
 * The canvas AI agent. Stateless: the client sends the whole conversation, the
 * model answers with a reply and optionally a flow, and the client draws it —
 * so the drawing then saves and syncs through the normal canvas path.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await editor((await params).id);
  if (!user) return new NextResponse("Not found", { status: 404 });

  const body = await req.json().catch(() => null);
  const turns: ChatTurn[] = Array.isArray(body?.messages) ? body.messages : [];
  const valid = turns.length > 0 && turns.length <= 40 && turns.at(-1)!.role === "user" && turns.every(
    (t) => (t?.role === "user" || t?.role === "assistant") && typeof t.content === "string" && t.content.length <= 8000,
  );
  if (!valid) return NextResponse.json({ error: "Invalid conversation." }, { status: 400 });

  const config = await aiConfig(user.workspace_id);
  if (!config) return NextResponse.json({ error: "The AI agent isn't set up yet — a workspace admin can configure it in Settings." }, { status: 400 });

  // Any member may switch models, but only to one the admin's key offers — not, say, a pricier one typed in by hand.
  const model = typeof body.model === "string" && body.model ? body.model : config.model;
  if (model !== config.model && !(await workspaceModels(user.workspace_id, config).catch((): string[] => [])).includes(model)) {
    return NextResponse.json({ error: "That model isn't available for this workspace." }, { status: 400 });
  }

  try {
    return NextResponse.json(await askAgent({ ...config, model }, turns.map(({ role, content }) => ({ role, content }))));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The AI provider failed." }, { status: 502 });
  }
}
