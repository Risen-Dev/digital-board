import "server-only";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { get, outsideTx, run } from "@/lib/db";

/**
 * Cross-instance fan-out for the live hubs (lib/canvas/hub.ts, lib/chat-live.ts).
 * Each process delivers to its own streams directly and NOTIFYs the rest; one
 * dedicated connection per process LISTENs and hands other processes' messages
 * to the same local delivery. NOTIFY payloads cap at 8000 bytes, so bigger ones
 * (canvas scenes carrying images) go through the live_relay table and only
 * their id is notified. On globalThis so hot reloads keep one listener.
 */
const CHANNEL = "board_live";
const MAX_NOTIFY = 7900;

type Bus = { origin: string; handlers: Map<string, (data: never) => void>; listening?: Promise<void> };
const bus: Bus = ((globalThis as unknown as { liveBus?: Bus }).liveBus ??= { origin: randomUUID(), handlers: new Map() });

/** Registers the local delivery for one kind of message (last registration wins). */
export function onLive<T>(kind: string, deliver: (data: T) => void) {
  bus.handlers.set(kind, deliver);
}

/** Sends to the other processes; the caller has already delivered locally. */
export function publish(kind: string, data: unknown) {
  listen();
  const payload = JSON.stringify({ o: bus.origin, k: kind, d: data });
  void outsideTx(() => send(payload)).catch((err) => console.error("live publish failed", err));
}

async function send(payload: string) {
  if (Buffer.byteLength(payload) <= MAX_NOTIFY) return run("SELECT pg_notify(?, ?)", CHANNEL, payload);
  const row = await get<{ id: number }>("INSERT INTO live_relay (payload) VALUES (?) RETURNING id", payload);
  await run("SELECT pg_notify(?, ?)", CHANNEL, JSON.stringify({ o: bus.origin, r: row!.id }));
  await run("DELETE FROM live_relay WHERE at < now() - interval '1 minute'");
}

async function receive(payload: string | undefined) {
  if (!payload) return;
  let msg = JSON.parse(payload) as { o: string; k?: string; d?: unknown; r?: number };
  if (msg.o === bus.origin) return;
  if (msg.r) {
    const row = await get<{ payload: string }>("SELECT payload FROM live_relay WHERE id = ?", msg.r);
    if (!row) return;
    msg = JSON.parse(row.payload);
  }
  (bus.handlers.get(msg.k!) as ((data: unknown) => void) | undefined)?.(msg.d);
}

/**
 * Starts this process's listener; called when a stream opens or a message is
 * published, never at import, so `next build` needs no database.
 */
export function listen() {
  bus.listening ??= (async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    const retry = () => {
      if (!bus.listening) return;
      bus.listening = undefined;
      client.end().catch(() => {});
      setTimeout(listen, 3000);
    };
    client.on("error", (err) => { console.error("live listener lost", err.message); retry(); });
    client.on("end", retry);
    client.on("notification", (n) => void receive(n.payload).catch((err) => console.error("live receive failed", err)));
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
  })().catch((err) => {
    console.error("live listener failed", err.message);
    bus.listening = undefined;
    setTimeout(listen, 3000);
  });
}
