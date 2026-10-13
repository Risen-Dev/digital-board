"use client";

import { useSyncExternalStore } from "react";
import type { Flow } from "@/lib/canvas/flow";

/**
 * The canvas agent's chat state, per sheet, kept outside React components.
 * The panel remounts on every sheet switch; keeping a request's state here lets
 * it finish (and show its progress again) when the user comes back, and lets a
 * flow that arrives while its sheet isn't open wait to be drawn on that sheet.
 */

/** `content` goes to the model; `shown` (if set) is what the chat displays. */
export type Turn = { role: "user" | "assistant"; content: string; shown?: string; note?: string };
export type ChatMeta = { id: string; title: string; author: string | null };
export type Session = {
  chats: ChatMeta[];
  chatId: string | null;
  turns: Turn[];
  draft: string;
  busy: boolean;
  status: string | null;
  startedAt: number | null;
  error: string | null;
};

const EMPTY: Session = { chats: [], chatId: null, turns: [], draft: "", busy: false, status: null, startedAt: null, error: null };
const sessions = new Map<string, Session>();
const listeners = new Set<() => void>();

const read = (canvasId: string) => sessions.get(canvasId) ?? EMPTY;

export function patchSession(canvasId: string, patch: Partial<Session> | ((s: Session) => Partial<Session>)) {
  const current = read(canvasId);
  sessions.set(canvasId, { ...current, ...(typeof patch === "function" ? patch(current) : patch) });
  for (const listener of listeners) listener();
}

export function useAgentSession(canvasId: string) {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => read(canvasId),
    () => EMPTY,
  );
}

// ── Drawing ─────────────────────────────────────────────────────────────────

type Drawer = (flow: Flow, by: string) => Promise<number>;
type Queued = { flow: Flow; by: string; drawn: (count: number) => void };
const drawers = new Map<string, Drawer>();
const queued = new Map<string, Queued[]>();

/**
 * The canvas registers the open sheet's drawer once that sheet has loaded, and
 * flows that arrived while it was closed are drawn right then.
 */
export function registerDrawer(canvasId: string, drawer: Drawer) {
  drawers.set(canvasId, drawer);
  const waiting = queued.get(canvasId) ?? [];
  queued.delete(canvasId);
  for (const item of waiting) void drawer(item.flow, item.by).then(item.drawn);
  return () => { if (drawers.get(canvasId) === drawer) drawers.delete(canvasId); };
}

/**
 * Draws now if the sheet is open, otherwise when it next opens (in this tab).
 * `drawn` is called with the number of shapes added, whenever that happens.
 */
export function deliverFlow(canvasId: string, flow: Flow, by: string, drawn: (count: number) => void) {
  const drawer = drawers.get(canvasId);
  if (drawer) return void drawer(flow, by).then(drawn);
  // ponytail: kept in memory only — a reload before reopening the sheet drops it; the chat still holds the flow.
  queued.set(canvasId, [...(queued.get(canvasId) ?? []), { flow, by, drawn }]);
  return "queued" as const;
}

// ── Sending ─────────────────────────────────────────────────────────────────

/** Sends one message for a sheet. Runs to completion even if the panel unmounts. */
export async function sendMessage(canvasId: string, text: string, options: { model?: string; reasoning: string }) {
  const start = read(canvasId);
  if (start.busy) return;
  const before = start.turns;
  patchSession(canvasId, {
    turns: [...before, { role: "user", content: text }],
    draft: "", busy: true, error: null, status: null, startedAt: Date.now(),
  });

  try {
    const res = await fetch(`/api/canvas/${canvasId}/ai`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: start.chatId, message: text, model: options.model || undefined, reasoning: options.reasoning }),
    });
    if (!res.ok || !res.body) {
      const failed = await res.json().catch(() => null);
      throw new Error(failed?.error ?? `Request failed (${res.status})`);
    }
    // NDJSON: "status" lines while the model works or retries, then one "result" or "error".
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let data: { reply?: string; flow?: Flow | null; chatId: string; by: string } | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === "status") patchSession(canvasId, { status: event.text });
        else if (event.type === "error") throw new Error(event.error);
        else if (event.type === "result") data = event;
      }
    }
    if (!data) throw new Error("The agent stopped without an answer.");

    const shown = data.reply || "Done.";
    const reply: Turn = { role: "assistant", content: shown, shown };
    const index = before.length + 1;
    const { by, chatId, flow } = data;
    patchSession(canvasId, (s) => ({
      turns: [...before, { role: "user", content: text }, reply],
      chatId,
      // Move this chat to the top of the history, adding it if it is new.
      chats: [s.chats.find((c) => c.id === chatId) ?? { id: chatId, title: text.split("\n")[0].slice(0, 60), author: null }, ...s.chats.filter((c) => c.id !== chatId)],
    }));

    if (flow) {
      const setNote = (note: string) => patchSession(canvasId, (s) =>
        // Only if the same chat is still on screen; otherwise the history shows it when reopened.
        s.chatId === chatId && s.turns[index] ? { turns: s.turns.map((t, i) => (i === index ? { ...t, note } : t)) } : {},
      );
      const result = deliverFlow(canvasId, flow, by, (count) => setNote(`Added ${count} shapes — ${by}`));
      if (result === "queued") setNote(`Will be drawn when this sheet is open — ${by}`);
    }
  } catch (e) {
    patchSession(canvasId, { error: e instanceof Error ? e.message : "Something went wrong.", turns: before, draft: text });
  } finally {
    patchSession(canvasId, { busy: false, startedAt: null });
  }
}
