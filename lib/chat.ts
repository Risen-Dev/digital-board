import type { ChatTurn } from "./ai";
import type { ChatMessage } from "./queries";

/**
 * Merge a poll response into the thread.
 *
 * Two polls can overlap — the 3s interval and the one fired straight after a
 * send — and both read the same cursor, so the same rows arrive twice. React
 * then throws "two children with the same key". Dedupe by id here rather than
 * trying to guarantee only one request is ever in flight.
 *
 * `reset` replaces the thread instead of appending; used after an edit, since
 * an `after=<id>` poll never revisits a row it has already returned.
 */
export function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[], reset = false): ChatMessage[] {
  const base = reset ? [] : prev;
  const seen = new Set(base.map((m) => m.id));
  const added = incoming.filter((m) => !seen.has(m.id));
  // Returning `prev` unchanged keeps React from re-rendering on an empty poll.
  return added.length > 0 || reset ? [...base, ...added] : prev;
}

/** Highest id seen so far — the cursor the next poll asks after. */
export const cursorOf = (messages: ChatMessage[], from: number) =>
  messages.reduce((max, m) => Math.max(max, m.id), from);

/** "@agent" anywhere in a message, as its own word, calls the AI agent into the conversation. */
export const AGENT_MENTION = /(^|\s)@agent\b/i;

/** Chat rows as model turns: the agent's own lines are assistant turns, same-role runs merged, leading agent lines dropped. */
export function turnsOf(rows: { agent: boolean; body: string; name: string }[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const r of rows) {
    if (!r.body.trim()) continue;
    const role = r.agent ? "assistant" : "user";
    const content = r.agent ? r.body : `${r.name}: ${r.body}`;
    const last = turns.at(-1);
    if (last?.role === role) last.content += `\n${content}`;
    else if (turns.length || role === "user") turns.push({ role, content });
  }
  return turns;
}
