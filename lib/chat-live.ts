import "server-only";

/**
 * Chat push: each open Chat tab holds an SSE stream (GET /api/chat/live) and
 * gets a content-free nudge whenever its workspace has a new or edited message;
 * it then refetches through the normal GET, which does the access checks.
 * On globalThis so dev hot reloads don't orphan open streams.
 */
// ponytail: in-process like lib/canvas/hub.ts; with several Node instances the
// chat view's slow fallback poll is what delivers across them.
const hub = globalThis as unknown as { chatListeners?: Map<string, Set<(data: string) => void>> };
const listeners = (hub.chatListeners ??= new Map());

export function nudgeChat(workspaceId: string, type: "message" | "edit" = "message") {
  const data = `data: ${JSON.stringify({ type })}\n\n`;
  for (const send of listeners.get(workspaceId) ?? []) send(data);
}

export function chatStream(req: Request, workspaceId: string) {
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
