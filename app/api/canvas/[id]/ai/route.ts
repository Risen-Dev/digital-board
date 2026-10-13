import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { all, get, run } from "@/lib/db";
import { guard } from "@/lib/canvas/guard";
import { REASONING, agentLabel, aiConfig, askAgent, reasoningOf, workspaceModels, type Reasoning } from "@/lib/ai";

/** One stored chat turn. `content` is what the model sees again; `shown` is what the panel prints. */
type StoredTurn = { role: "user" | "assistant"; content: string; shown?: string; drew?: boolean; by?: string };
const HISTORY_TURNS = 40;

async function editor(id: string) {
  const canvas = await get<{ project_id: string }>("SELECT project_id FROM canvases WHERE id = ?", id);
  return canvas ? guard(canvas.project_id, true) : null;
}

/**
 * `?chat=<id>` → that chat's turns. Otherwise the panel's setup: the sheet's chats
 * and the models it may switch between (the saved key's list, never the key).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await editor(id);
  if (!user) return new NextResponse("Not found", { status: 404 });

  const chatId = new URL(req.url).searchParams.get("chat");
  if (chatId) {
    const chat = await get<{ messages: StoredTurn[] }>("SELECT messages FROM agent_chats WHERE id = ? AND canvas_id = ?", chatId, id);
    return chat ? NextResponse.json({ turns: chat.messages }) : new NextResponse("Not found", { status: 404 });
  }

  const chats = await all<{ id: string; title: string; author: string | null; updated_at: string }>(
    `SELECT c.id, c.title, u.name AS author, c.updated_at
       FROM agent_chats c LEFT JOIN users u ON u.id = c.author_id
      WHERE c.canvas_id = ? ORDER BY c.updated_at DESC LIMIT 50`,
    id,
  );
  const config = await aiConfig(user.workspace_id);
  if (!config) return NextResponse.json({ models: [], model: null, reasoning: "", chats });
  // A provider that can't list models still works with the admin's model.
  const models = await workspaceModels(user.workspace_id, config).catch(() => [config.model]);
  return NextResponse.json({ models: models.includes(config.model) ? models : [config.model, ...models], model: config.model, reasoning: reasoningOf(config), chats });
}

/**
 * The canvas AI agent. The client sends one message (and the chat it belongs to,
 * if any); the history comes from `agent_chats`. The model answers with a reply
 * and optionally a flow, which the client draws — so the drawing then saves and
 * syncs through the normal canvas path.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: canvasId } = await params;
  const user = await editor(canvasId);
  if (!user) return new NextResponse("Not found", { status: 404 });

  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 8000) return NextResponse.json({ error: "Message must be 1–8000 characters." }, { status: 400 });

  const chatId: string | null = typeof body.chatId === "string" && body.chatId ? body.chatId : null;
  let history: StoredTurn[] = [];
  if (chatId) {
    const chat = await get<{ messages: StoredTurn[] }>("SELECT messages FROM agent_chats WHERE id = ? AND canvas_id = ?", chatId, canvasId);
    if (!chat) return NextResponse.json({ error: "That chat no longer exists." }, { status: 404 });
    history = chat.messages;
  }
  const turns = [...history.slice(-(HISTORY_TURNS - 1)), { role: "user" as const, content: message }];

  const config = await aiConfig(user.workspace_id);
  if (!config) return NextResponse.json({ error: "The AI agent isn't set up yet — a workspace admin can configure it in Settings." }, { status: 400 });

  // Any member may switch models, but only to one the admin's key offers — not, say, a pricier one typed in by hand.
  const model = typeof body.model === "string" && body.model ? body.model : config.model;
  if (model !== config.model && !(await workspaceModels(user.workspace_id, config).catch((): string[] => [])).includes(model)) {
    return NextResponse.json({ error: "That model isn't available for this workspace." }, { status: 400 });
  }

  // Per-message override of the admin's default; "" means the provider's own default.
  const reasoning: Reasoning = REASONING.includes(body.reasoning) ? body.reasoning : reasoningOf(config);

  // One NDJSON line per event: progress ("status") while the model works or retries, then "result" or "error".
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        const { reply, flow } = await askAgent({ ...config, model, reasoning }, turns.map(({ role, content }) => ({ role, content })), (text) => send({ type: "status", text }));

        const by = agentLabel({ ...config, model, reasoning });
        // Saved only once the model answered, so a failed attempt can simply be resent.
        // The flow goes back into the history as JSON so "change step 3" has something to refer to.
        const shown = reply || "Done.";
        const added = JSON.stringify([
          { role: "user", content: message },
          { role: "assistant", content: shown + (flow ? `\n\n${JSON.stringify({ flow })}` : ""), shown, drew: !!flow, ...(flow ? { by } : {}) },
        ] satisfies StoredTurn[]);
        const now = new Date().toISOString();
        let id = chatId;
        if (id) {
          await run("UPDATE agent_chats SET messages = messages || ?::jsonb, updated_at = ? WHERE id = ?", added, now, id);
        } else {
          id = randomUUID();
          await run(
            "INSERT INTO agent_chats (id, canvas_id, author_id, title, messages, created_at, updated_at) VALUES (?,?,?,?,?::jsonb,?,?)",
            id, canvasId, user.id, message.split("\n")[0].slice(0, 60), added, now, now,
          );
        }
        send({ type: "result", reply, flow, chatId: id, by });
      } catch (error) {
        send({ type: "error", error: error instanceof Error ? error.message : "The AI provider failed." });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
