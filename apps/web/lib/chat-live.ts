import "server-only";
import { listen, onLive, publish } from "@/lib/live-bus";

/**
 * Workspace push: each open tab holds an SSE stream (GET /api/chat/live) and
 * gets a content-free nudge whenever its workspace has a new, edited, deleted or
 * reacted-to message (Chat refetches through the normal GET, which does the
 * access checks) or a board change (the workspace shell calls router.refresh()).
 * Typing nudges are the exception: they carry who and where, so a DM's goes only
 * to the other person.
 * Nudges reach other app instances through lib/live-bus.ts.
 * On globalThis so dev hot reloads don't orphan open streams.
 */
type Listener = { user: string; send: (data: string) => void };
const hub = globalThis as unknown as { chatRooms?: Map<string, Set<Listener>> };
const listeners = (hub.chatRooms ??= new Map());

/**
 * `by` = the user whose action it was; their own tab already revalidated.
 * "edit" = any change to existing rows (edit, delete, reaction): a full refetch.
 * `to` limits delivery to those users; `channel`/`name` are only set on typing.
 */
type Nudge = {
  workspaceId: string;
  type: "message" | "edit" | "board" | "typing";
  by?: string | null;
  channel?: string;
  name?: string;
  to?: string[];
};

function deliver({ workspaceId, type, by, channel, name, to }: Nudge) {
  const data = `data: ${JSON.stringify({ type, by, channel, name })}\n\n`;
  for (const l of listeners.get(workspaceId) ?? []) if (!to || to.includes(l.user)) l.send(data);
}
onLive("chat", deliver);

export function nudgeChat(workspaceId: string, type: Nudge["type"] = "message", by: string | null = null) {
  deliver({ workspaceId, type, by });
  publish("chat", { workspaceId, type, by });
}

/** Board data changed: other members' open tabs refresh. */
export const nudgeBoard = (workspaceId: string, by: string | null = null) => nudgeChat(workspaceId, "board", by);

/** `by` is typing in the channel (`to` null) or in a DM to `to`, whose conversation key for it is `by`. */
export function nudgeTyping(workspaceId: string, by: { id: string; name: string }, to: string | null) {
  const n: Nudge = to
    ? { workspaceId, type: "typing", by: by.id, name: by.name, channel: by.id, to: [to] }
    : { workspaceId, type: "typing", by: by.id, name: by.name, channel: "all" };
  deliver(n);
  publish("chat", n);
}

export function chatStream(req: Request, workspaceId: string, userId: string) {
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
      const me = { user: userId, send };
      leave = () => {
        if (!room.delete(me)) return;
        clearInterval(ping);
        try { controller.close(); } catch {}
      };
      room.add(me);
      req.signal.addEventListener("abort", () => leave());
    },
    cancel: () => leave(),
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
