"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquarePlus, Send, Sparkles, X } from "lucide-react";
import { patchSession, sendMessage, useAgentSession, type ChatMeta, type Turn } from "@/hooks/use-agent-session";
import { useT } from "@/components/i18n";

/** Shared with Settings. Values are lib/ai.ts `REASONING`. */
export const REASONING_OPTIONS = [
  ["", "Default (model decides)"],
  ["low", "Low — fastest"],
  ["medium", "Medium"],
  ["high", "High — most careful, slowest"],
] as const;

const MODEL_KEY = "agent-model";
const REASONING_KEY = "agent-reasoning";

type StoredTurn = Turn & { drew?: boolean; by?: string };

const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch {} };
const recall = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };

/**
 * Chat with the canvas agent. Conversations are stored per sheet on the server
 * (`agent_chats`), so anyone editing the sheet can reopen one or start a new one.
 * The chat state itself lives in `use-agent-session`, so a request keeps going —
 * and its flow still lands on its own sheet — when the user switches sheets.
 */
export function CanvasAgent({
  canvasId, enabled, onClose,
}: {
  canvasId: string;
  enabled: boolean;
  onClose: () => void;
}) {
  const tr = useT();
  const { chats, chatId, turns, draft: input, busy, status, startedAt, error } = useAgentSession(canvasId);
  const setInput = (draft: string) => patchSession(canvasId, { draft });
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
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data: { models: string[]; model: string | null; reasoning: string; chats: ChatMeta[] }) => {
        if (!live) return;
        patchSession(canvasId, { chats: data.chats });
        if (!data.model) return;
        const lastModel = recall(MODEL_KEY);
        const lastReasoning = recall(REASONING_KEY);
        setModels(data.models);
        setModel(lastModel && data.models.includes(lastModel) ? lastModel : data.model);
        setReasoning(lastReasoning !== null && REASONING_OPTIONS.some(([v]) => v === lastReasoning) ? lastReasoning : data.reasoning);
      })
      // Without this the panel just looks like it has no model or history to offer.
      .catch((e) => { if (live) patchSession(canvasId, { error: `Couldn't load the agent's chats and models (${e.message}). Reload the page; if it persists, check the server log.` }); });
    return () => { live = false; };
  }, [canvasId, enabled]);

  // Ticks the "12s" counter while a request is out, so a slow model doesn't look frozen.
  useEffect(() => {
    if (startedAt === null) return;
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 1000);
    const first = setTimeout(tick, 0);
    return () => { clearInterval(timer); clearTimeout(first); };
  }, [startedAt]);
  const elapsed = startedAt === null ? 0 : Math.max(0, Math.round((now - startedAt) / 1000));

  // Keep the newest turn (or the progress line) in view, also when coming back to a running chat.
  useEffect(() => {
    requestAnimationFrame(() => end.current?.scrollIntoView({ behavior: "smooth" }));
  }, [turns.length, busy]);

  function newChat() {
    patchSession(canvasId, { chatId: null, turns: [], error: null });
  }

  async function openChat(id: string) {
    patchSession(canvasId, { error: null });
    const res = await fetch(`/api/canvas/${canvasId}/ai?chat=${encodeURIComponent(id)}`);
    if (!res.ok) return patchSession(canvasId, { error: tr("That chat could not be opened — it may have been deleted with its sheet.") });
    const { turns: stored }: { turns: StoredTurn[] } = await res.json();
    patchSession(canvasId, {
      chatId: id,
      turns: stored.map(({ drew, by, ...turn }) => ({ ...turn, note: drew ? `Drew a flow${by ? ` — ${by}` : " on the canvas"}` : undefined })),
    });
  }

  function send() {
    const text = input.trim();
    if (text && !busy) void sendMessage(canvasId, text, { model, reasoning });
  }

  const picker = "min-w-0 truncate rounded border bg-background px-1.5 py-0.5 text-xs disabled:opacity-50";

  return (
    <aside className="absolute inset-y-0 right-0 z-10 flex w-full max-w-sm flex-col border-l bg-background shadow-lg">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Sparkles className="size-4 shrink-0 text-[var(--chart-1)]" />
        <select
          aria-label={tr("Chat history")}
          value={chatId ?? ""}
          disabled={busy || !enabled}
          onChange={(e) => (e.target.value ? void openChat(e.target.value) : newChat())}
          className={`${picker} flex-1 py-1 text-sm font-medium`}
        >
          <option value="">{tr("New chat")}</option>
          {chats.map((c) => (
            <option key={c.id} value={c.id}>{c.title}{c.author ? ` — ${c.author}` : ""}</option>
          ))}
        </select>
        <button type="button" onClick={newChat} disabled={busy || !enabled} title={tr("New chat")} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40">
          <MessageSquarePlus className="size-4" />
        </button>
        <button type="button" onClick={onClose} title={tr("Close")} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
          <X className="size-4" />
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {!enabled ? (
          <p className="text-xs text-muted-foreground">{tr("The AI agent isn't set up. A workspace admin can configure a provider in Settings → AI agent.")}</p>
        ) : turns.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {tr("Describe a business process and the agent draws it on this sheet. Try: “Buatkan flow proses pemesanan barang dari order sampai pengiriman”.")}
            {chats.length > 0 && tr(" Earlier chats on this sheet are in the menu above.")}
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
            {status ?? (elapsed < 20 ? tr("Thinking…") : tr("Still working — a big flow can take a while…"))} · {elapsed}s
          </p>
        )}
        {error && <p className="rounded-md bg-[rgba(239,68,68,0.08)] px-3 py-2 text-xs text-[var(--chart-7)]">{tr(error)}</p>}
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
            placeholder={enabled ? tr("Describe a process…") : tr("Not configured")}
            className="flex-1 resize-none rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring disabled:opacity-50"
          />
          <button type="submit" disabled={!enabled || busy || !input.trim()} title={tr("Send")} className="rounded-md bg-primary p-2 text-primary-foreground disabled:opacity-40">
            <Send className="size-4" />
          </button>
        </div>
        {enabled && models.length > 0 && (
          <div className="flex items-center gap-1.5">
            <select
              aria-label={tr("Model")}
              value={model}
              disabled={busy || models.length < 2}
              onChange={(e) => { setModel(e.target.value); remember(MODEL_KEY, e.target.value); }}
              className={`${picker} flex-1`}
            >
              {models.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
            <select
              aria-label={tr("Reasoning")}
              title={tr("Reasoning: how long the model thinks before answering")}
              value={reasoning}
              disabled={busy}
              onChange={(e) => { setReasoning(e.target.value); remember(REASONING_KEY, e.target.value); }}
              className={picker}
            >
              {REASONING_OPTIONS.map(([value, label]) => <option key={value} value={value}>{tr("Reasoning:")} {label.split(" — ")[0]}</option>)}
            </select>
          </div>
        )}
      </form>
    </aside>
  );
}
