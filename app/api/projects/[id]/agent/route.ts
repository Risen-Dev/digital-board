import { NextResponse } from "next/server";
import { guard } from "@/lib/canvas/guard";
import { get, run } from "@/lib/db";
import { agentLabel, aiConfig, askText, jsonOf, type ChatTurn } from "@/lib/ai";
import { getBoard, listMembers } from "@/lib/queries";
import { addColumn, createCanvas, createTask, moveTask, updateTask } from "@/lib/actions";
import { PROJECT_SYSTEM, boardBrief, resolveActions, type AgentOp, type TaskFields } from "@/lib/board-agent";
import { parseFlow } from "@/lib/canvas/flow";
import { PALETTE } from "@/lib/board";

const HISTORY_TURNS = 20;

const formOf = (fields: TaskFields, extra: Record<string, string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries({ ...extra, ...fields })) {
    if (Array.isArray(v)) for (const item of v) form.append(k, item);
    else form.set(k, v ?? "");
  }
  return form;
};

/**
 * The project agent: "create task X in Backlog with high priority", "draw the negotiation
 * flow", "tell Ada the release moved". The model only proposes actions; they run through
 * the same Server Actions as the UI where one exists, so permissions, validation and
 * task history are the ones every edit gets.
 * History lives in the panel and comes back with each message.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const user = await guard(projectId, true);
  if (!user) return new NextResponse("Not found", { status: 404 });

  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 8000) return NextResponse.json({ error: "Message must be 1–8000 characters." }, { status: 400 });
  const history: ChatTurn[] = (Array.isArray(body.history) ? body.history : [])
    .filter((t: ChatTurn) => (t?.role === "user" || t?.role === "assistant") && typeof t.content === "string")
    .slice(-HISTORY_TURNS)
    .map(({ role, content }: ChatTurn) => ({ role, content: content.slice(0, 8000) }));

  const config = await aiConfig(user.workspace_id);
  if (!config) return NextResponse.json({ error: "The AI agent isn't set up yet — a workspace admin can configure it in Settings." }, { status: 400 });

  const project = (await get<{ name: string }>("SELECT name FROM projects WHERE id = ?", projectId))!;
  const columns = await getBoard(projectId);
  const members = await listMembers(user.workspace_id);
  const system = `${PROJECT_SYSTEM}\n\n${boardBrief(project.name, new Date().toISOString().slice(0, 10), columns, members)}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        const text = await askText(config, system, [...history, { role: "user", content: message }], (status) => send({ type: "status", text: status }));
        const parsed = jsonOf(text);
        const { ops, errors } = resolveActions(parsed?.actions, columns, members);
        const done: string[] = [];
        let added = columns.length;
        const by = agentLabel(config);
        // Returns an error message, or null when the op went through.
        const apply = async (op: AgentOp): Promise<string | null> => {
          if (op.op === "create" || op.op === "update") {
            const result = op.op === "create"
              ? await createTask(null, formOf(op.fields, { columnId: op.columnId }))
              : await updateTask(null, formOf(op.fields, { id: op.taskId }));
            if ("error" in result) return result.error ?? "failed";
            if (op.op === "update" && op.moveTo) await moveTask(op.taskId, op.moveTo, Number.MAX_SAFE_INTEGER);
            return null;
          }
          if (op.op === "sheet") {
            const flow = parseFlow(op.flow);
            if (!flow) return "the flow was not a valid flowchart";
            const id = await createCanvas(projectId, op.name);
            if (!id) return "you cannot edit this project";
            // Same `seed` a template sheet carries: the first editor tab to open the sheet draws it.
            await run("UPDATE canvases SET snapshot = ? WHERE id = ?", JSON.stringify({ elements: [], seed: { flow, by } }), id);
            return null;
          }
          if (op.op === "message") {
            await run(
              "INSERT INTO messages (workspace_id, author_id, recipient_id, body, created_at) VALUES (?,?,?,?,?)",
              user.workspace_id, user.id, op.to, op.text, new Date().toISOString(),
            );
            return null;
          }
          const result = await addColumn(projectId, op.title, PALETTE[added++ % PALETTE.length]);
          return "error" in result ? result.error ?? "failed" : null;
        };
        for (const op of ops) {
          const error = await apply(op);
          if (error) errors.push(`${op.summary}: ${error}`);
          else done.push(op.summary);
        }
        send({ type: "result", reply: parsed ? String(parsed.reply ?? "") : text.trim(), done, errors });
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
