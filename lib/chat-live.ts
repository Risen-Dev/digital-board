import "server-only";
import { listen, onLive, publish } from "@/lib/live-bus";

/**
 * Workspace push: each open tab holds an SSE stream (GET /api/chat/live) and
 * gets a content-free nudge whenever its workspace has a new or edited message
 * (Chat refetches through the normal GET, which does the access checks) or a
 * board change (the workspace shell calls router.refresh()).
 * Nudges reach other app instances through lib/live-bus.ts.
 * On globalThis so dev hot reloads don't orphan open streams.
 */
const hub = globalThis as unknown as { chatListeners?: Map<string, Set<(data: string) => void>> };
const listeners = (hub.chatListeners ??= new Map());

/** `by` = the user whose action it was; their own tab already revalidated. */
type Nudge = { workspaceId: string; type: "message" | "edit" | "board"; by?: string | null };

function deliver({ workspaceId, type, by }: Nudge) {
  const data = `data: ${JSON.stringify({ type, by })}\n\n`;
  for (const send of listeners.get(workspaceId) ?? []) send(data);
}
onLive("chat", deliver);

export function nudgeChat(workspaceId: string, type: Nudge["type"] = "message", by: string | null = null) {
  deliver({ workspaceId, type, by });
  publish("chat", { workspaceId, type, by });
}

/** Board data changed: other members' open tabs refresh. */
export const nudgeBoard = (workspaceId: string, by: string | null = null) => nudgeChat(workspaceId, "board", by);

export function chatStream(req: Request, workspaceId: string) {
  listen();
  const room = listeners.get(workspaceId) ?? new Set();
  listeners.set(workspaceId, room);
  const encoder = new TextEncoder();
  let leave = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try { controller.enqueue(encoder.encode(data)); } catch { leave(); }
      };
      // Comment frames keep proxies from closing an idle stream.
      const ping = setInterval(() => send(": ping\n\n"), 25_000);
      leave = () => {
        if (!room.delete(send)) return;
        clearInterval(ping);
        try { controller.close(); } catch {}
      };
      room.add(send);
      req.signal.addEventListener("abort", () => leave());
    },
    cancel: () => leave(),
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
