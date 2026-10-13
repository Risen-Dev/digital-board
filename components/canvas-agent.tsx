"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquarePlus, Send, Sparkles, X } from "lucide-react";
import type { Flow } from "@/lib/canvas/flow";

/** Shared with Settings. Values are lib/ai.ts `REASONING`. */
export const REASONING_OPTIONS = [
  ["", "Default (model decides)"],
  ["low", "Low — fastest"],
  ["medium", "Medium"],
  ["high", "High — most careful, slowest"],
] as const;

const MODEL_KEY = "agent-model";
const REASONING_KEY = "agent-reasoning";

/** `content` goes to the model; `shown` (if set) is what the chat displays. */
type Turn = { role: "user" | "assistant"; content: string; shown?: string; note?: string };
type StoredTurn = Turn & { drew?: boolean };
type ChatMeta = { id: string; title: string; author: string | null };

const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch {} };
const recall = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };

/**
 * Chat with the canvas agent. Conversations are stored per sheet on the server
 * (`agent_chats`), so anyone editing the sheet can reopen one or start a new one;
 * `onFlow` draws whatever flow the agent returns.
 */
export function CanvasAgent({
  canvasId, enabled, onFlow, onClose,
}: {
  canvasId: string;
  enabled: boolean;
  onFlow: (flow: Flow) => Promise<number>;
  onClose: () => void;
}) {
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [reasoning, setReasoning] = useState("");
  const end = useRef<HTMLDivElement>(null);

  // The sheet's chats, plus the models and default reasoning the admin set up;
  // what this browser picked last wins while it is still offered.
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch(`/api/canvas/${canvasId}/ai`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { models: string[]; model: string | null; reasoning: string; chats: ChatMeta[] } | null) => {
        if (!live || !data) return;
        setChats(data.chats);
        if (!data.model) return;
        const lastModel = recall(MODEL_KEY);
        const lastReasoning = recall(REASONING_KEY);
        setModels(data.models);
        setModel(lastModel && data.models.includes(lastModel) ? lastModel : data.model);
        setReasoning(lastReasoning !== null && REASONING_OPTIONS.some(([v]) => v === lastReasoning) ? lastReasoning : data.reasoning);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [canvasId, enabled]);

  // Ticks the "12s" counter while a request is out, so a slow model doesn't look frozen.
  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const elapsed = startedAt === null ? 0 : Math.max(0, Math.round((now - startedAt) / 1000));

  const scrollDown = () => requestAnimationFrame(() => end.current?.scrollIntoView({ behavior: "smooth" }));

  function newChat() {
    setChatId(null);
    setTurns([]);
    setError(null);
  }

  async function openChat(id: string) {
    setError(null);
    const res = await fetch(`/api/canvas/${canvasId}/ai?chat=${encodeURIComponent(id)}`);
    if (!res.ok) return setError("That chat could not be opened — it may have been deleted with its sheet.");
    const { turns: stored }: { turns: StoredTurn[] } = await res.json();
    setChatId(id);
    setTurns(stored.map(({ drew, ...turn }) => ({ ...turn, note: drew ? "Drew a flow on the canvas" : undefined })));
    scrollDown();
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const before = turns;
    setTurns([...turns, { role: "user", content: text }]);
    setInput("");
    setBusy(true);
    setError(null);
    setStatus(null);
    setStartedAt(Date.now());
    setNow(Date.now());
    scrollDown();
    try {
      const res = await fetch(`/api/canvas/${canvasId}/ai`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId, message: text, model: model || undefined, reasoning }),
      });
      if (!res.ok || !res.body) {
        const failed = await res.json().catch(() => null);
        throw new Error(failed?.error ?? `Request failed (${res.status})`);
      }
      // NDJSON: "status" lines while the model works or retries, then one "result" or "error".
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let data: { reply?: string; flow?: Flow | null; chatId: string } | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === "status") setStatus(event.text);
          else if (event.type === "error") throw new Error(event.error);
          else if (event.type === "result") data = event;
        }
      }
      if (!data) throw new Error("The agent stopped without an answer.");

      const added = data.flow ? await onFlow(data.flow) : 0;
      const shown = data.reply || "Done.";
      setTurns([...before, { role: "user", content: text }, { role: "assistant", content: shown, shown, note: added ? `Added ${added} shapes to the canvas` : undefined }]);
      // Move this chat to the top of the history, adding it if it is new.
      const id = data.chatId;
      setChatId(id);
      setChats((list) => {
        const existing = list.find((c) => c.id === id);
        return [existing ?? { id, title: text.split("\n")[0].slice(0, 60), author: null }, ...list.filter((c) => c.id !== id)];
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setTurns(before);
      setInput(text);
    } finally {
      setBusy(false);
      setStartedAt(null);
      scrollDown();
    }
  }

  const picker = "min-w-0 truncate rounded border bg-background px-1.5 py-0.5 text-xs disabled:opacity-50";

  return (
    <aside className="absolute inset-y-0 right-0 z-10 flex w-full max-w-sm flex-col border-l bg-background shadow-lg">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Sparkles className="size-4 shrink-0 text-[var(--chart-1)]" />
        <select
          aria-label="Chat history"
          value={chatId ?? ""}
          disabled={busy || !enabled}
          onChange={(e) => (e.target.value ? void openChat(e.target.value) : newChat())}
          className={`${picker} flex-1 py-1 text-sm font-medium`}
        >
          <option value="">New chat</option>
          {chats.map((c) => (
            <option key={c.id} value={c.id}>{c.title}{c.author ? ` — ${c.author}` : ""}</option>
          ))}
        </select>
        <button type="button" onClick={newChat} disabled={busy || !enabled} title="New chat" className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40">
          <MessageSquarePlus className="size-4" />
        </button>
        <button type="button" onClick={onClose} title="Close" className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
          <X className="size-4" />
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {!enabled ? (
          <p className="text-xs text-muted-foreground">The AI agent isn&apos;t set up. A workspace admin can configure a provider in Settings → AI agent.</p>
        ) : turns.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Describe a business process and the agent draws it on this sheet. Try: &ldquo;Buatkan flow proses pemesanan barang dari order sampai pengiriman&rdquo;.
            {chats.length > 0 && " Earlier chats on this sheet are in the menu above."}
          </p>
        ) : null}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "ml-8 rounded-lg bg-primary px-3 py-2 text-primary-foreground" : "mr-8 rounded-lg bg-secondary px-3 py-2"}>
            <p className="whitespace-pre-wrap">{t.shown ?? t.content}</p>
            {t.note && <p className="mt-1 text-[11px] text-muted-foreground">✓ {t.note}</p>}
          </div>
        ))}
        {busy && (
          <p className="text-xs text-muted-foreground">
            {status ?? (elapsed < 20 ? "Thinking…" : "Still working — a big flow can take a while…")} · {elapsed}s
          </p>
        )}
        {error && <p className="rounded-md bg-[rgba(239,68,68,0.08)] px-3 py-2 text-xs text-[var(--chart-7)]">{error}</p>}
        <div ref={end} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex flex-col gap-1.5 border-t p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
            }}
            disabled={!enabled}
            rows={2}
            placeholder={enabled ? "Describe a process…" : "Not configured"}
            className="flex-1 resize-none rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring disabled:opacity-50"
          />
          <button type="submit" disabled={!enabled || busy || !input.trim()} title="Send" className="rounded-md bg-primary p-2 text-primary-foreground disabled:opacity-40">
            <Send className="size-4" />
          </button>
        </div>
        {enabled && models.length > 0 && (
          <div className="flex items-center gap-1.5">
            <select
              aria-label="Model"
              value={model}
              disabled={busy || models.length < 2}
              onChange={(e) => { setModel(e.target.value); remember(MODEL_KEY, e.target.value); }}
              className={`${picker} flex-1`}
            >
              {models.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
            <select
              aria-label="Reasoning"
              title="Reasoning: how long the model thinks before answering"
              value={reasoning}
              disabled={busy}
              onChange={(e) => { setReasoning(e.target.value); remember(REASONING_KEY, e.target.value); }}
              className={picker}
            >
              {REASONING_OPTIONS.map(([value, label]) => <option key={value} value={value}>Reasoning: {label.split(" — ")[0]}</option>)}
            </select>
          </div>
        )}
      </form>
    </aside>
  );
}
