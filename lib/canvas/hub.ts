import "server-only";

/**
 * Live collaboration fan-out: each open sheet holds an SSE stream (the canvas
 * route's GET ?live=<tabId>) and messages are relayed to the other tabs on it.
 * On globalThis so dev hot reloads don't orphan open streams.
 */
export type Peer = { client: string; send: (data: string) => void };

// ponytail: in-process fan-out, so live cursors/edits only reach tabs served by
// the same Node instance. Running pm2 with instances > 1 needs Postgres LISTEN/NOTIFY here.
const hub = globalThis as unknown as { canvasPeers?: Map<string, Set<Peer>> };
export const peers = (hub.canvasPeers ??= new Map());

export function broadcast(canvasId: string, from: string, message: object) {
  const data = `data: ${JSON.stringify({ ...message, from })}\n\n`;
  for (const peer of peers.get(canvasId) ?? []) if (peer.client !== from) peer.send(data);
}
