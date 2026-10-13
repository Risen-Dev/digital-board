"use client";

import { useRef, useState } from "react";
import { Send, Sparkles, X } from "lucide-react";
import type { Flow } from "@/lib/canvas/flow";

/** `content` goes to the model; `shown` (if set) is what the chat displays. */
type Turn = { role: "user" | "assistant"; content: string; shown?: string; note?: string };

/**
 * Chat with the canvas agent. The conversation lives in this component only
 * (remounted per sheet); `onFlow` draws whatever flow the agent returns.
 */
export function CanvasAgent({
  canvasId, enabled, onFlow, onClose,
}: {
  canvasId: string;
  enabled: boolean;
  onFlow: (flow: Flow) => Promise<number>;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/canvas/${canvasId}/ai`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const data = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      const added = data.flow ? await onFlow(data.flow) : 0;
      // The flow goes back to the model as JSON so "change step 3" has something to refer to.
      const content = (data.reply || "Done.") + (data.flow ? `\n\n${JSON.stringify({ flow: data.flow })}` : "");
      setTurns([...next, { role: "assistant", content, shown: data.reply || "Done.", note: added ? `Added ${added} shapes to the canvas` : undefined }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setTurns(turns);
      setInput(text);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => end.current?.scrollIntoView({ behavior: "smooth" }));
    }
  }

  return (
    <aside className="absolute inset-y-0 right-0 z-10 flex w-full max-w-sm flex-col border-l bg-background shadow-lg">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Sparkles className="size-4 text-[var(--chart-1)]" />
        <span className="text-sm font-medium">Agent</span>
        <button type="button" onClick={onClose} title="Close" className="ml-auto rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
          <X className="size-4" />
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {!enabled ? (
          <p className="text-xs text-muted-foreground">The AI agent isn&apos;t set up. A workspace admin can configure a provider in Settings → AI agent.</p>
        ) : turns.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Describe a business process and the agent draws it on this sheet. Try: &ldquo;Buatkan flow proses pemesanan barang dari order sampai pengiriman&rdquo;.
          </p>
        ) : null}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "ml-8 rounded-lg bg-primary px-3 py-2 text-primary-foreground" : "mr-8 rounded-lg bg-secondary px-3 py-2"}>
            <p className="whitespace-pre-wrap">{t.shown ?? t.content}</p>
            {t.note && <p className="mt-1 text-[11px] text-muted-foreground">✓ {t.note}</p>}
          </div>
        ))}
        {busy && <p className="text-xs text-muted-foreground">Thinking…</p>}
        {error && <p className="rounded-md bg-[rgba(239,68,68,0.08)] px-3 py-2 text-xs text-[var(--chart-7)]">{error}</p>}
        <div ref={end} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex items-end gap-2 border-t p-2">
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
      </form>
    </aside>
  );
}
