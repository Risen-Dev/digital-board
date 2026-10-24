import "server-only";
import { listen, onLive, publish } from "@/lib/live-bus";

/**
 * Live collaboration fan-out: each open sheet holds an SSE stream (the canvas
 * route's GET ?live=<tabId>) and messages are relayed to the other tabs on it,
 * including tabs served by other app instances (lib/live-bus.ts).
 * On globalThis so dev hot reloads don't orphan open streams.
 */
export type Peer = { client: string; send: (data: string) => void };

const hub = globalThis as unknown as { canvasPeers?: Map<string, Set<Peer>> };
export const peers = (hub.canvasPeers ??= new Map());

type Relay = { canvasId: string; from: string; message: object };

function deliver({ canvasId, from, message }: Relay) {
  const data = `data: ${JSON.stringify({ ...message, from })}\n\n`;
  for (const peer of peers.get(canvasId) ?? []) if (peer.client !== from) peer.send(data);
}
onLive("canvas", deliver);

export function broadcast(canvasId: string, from: string, message: object) {
  deliver({ canvasId, from, message });
  publish("canvas", { canvasId, from, message });
}

export { listen };
