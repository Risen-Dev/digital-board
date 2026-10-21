"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus, Send, Sparkles, X } from "lucide-react";
import { MentionText, tagOptions, useMentionPicker } from "./mentions";
import type { CanvasTag } from "@/lib/queries";

type Turn = { role: "user" | "assistant"; content: string; shown?: string; done?: string[]; errors?: string[] };

/**
 * Prompt the whole project: "buatin task login page di Backlog, priority high".
 * The server runs what the model proposes through the normal task actions.
 * ponytail: the chat lives in this component only — lost on reload; store it like agent_chats if people want it back.
 */
export function ProjectAgent({ projectId, enabled, open, tags, onTag, onClose }: {
  projectId: string;
  enabled: boolean;
  open: boolean;
  /** This project's named canvas groups; the agent reads their text. */
  tags: CanvasTag[];
  onTag: (tag: CanvasTag) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const mention = useMentionPicker(input, setInput, tagOptions(tags));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  // null = docked bottom-right by CSS; set to left/top once the user grabs it.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  // Before the first drag or resize, pin the panel by left/top where it sits, so the
  // native resize corner grows it toward the cursor instead of from the right/bottom edge.
  function anchor() {
    if (pos || !panel.current) return pos;
    const r = panel.current.getBoundingClientRect();
    const p = { x: r.left, y: r.top };
    setPos(p);
    return p;
  }

  function startDrag(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    const start = anchor();
    if (!start || !panel.current) return;
    const { width, height } = panel.current.getBoundingClientRect();
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    const header = e.currentTarget as HTMLElement;
    header.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setPos({
      x: Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - width),
      y: Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - height),
    });
    const up = () => { header.removeEventListener("pointermove", move); header.removeEventListener("pointerup", up); };
    header.addEventListener("pointermove", move);
    header.addEventListener("pointerup", up);
  }

  useEffect(() => {
    requestAnimationFrame(() => end.current?.scrollIntoView({ behavior: "smooth" }));
  }, [turns.length, busy]);

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: "user", content: message }]);
    setInput("");
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `Request failed (${res.status}).`);
      // NDJSON: "status" lines while the model works or retries, then one "result" or "error".
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
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
          else if (event.type === "result") {
            const shown = event.reply || "Done.";
            // The model sees what actually happened next turn, not just what it meant to do.
            const content = [shown, ...event.done.map((d: string) => `✓ ${d}`), ...event.errors.map((e: string) => `✗ ${e}`)].join("\n");
            setTurns((t) => [...t, { role: "assistant", content, shown, done: event.done, errors: event.errors }]);
            if (event.done.length) router.refresh();
          }
        }
      }
    } catch (e) {
      // Drop the unanswered message so a resend doesn't send it twice.
      setTurns((t) => t.slice(0, -1));
      setInput(message);
      setError(e instanceof Error ? e.message : "The agent failed.");
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <aside
      ref={panel}
      onPointerDownCapture={anchor}
      // `resize` is the browser's own corner handle; React never sets width/height again, so it keeps the user's size.
      style={{ width: 380, height: 520, ...(pos ? { left: pos.x, top: pos.y } : { right: 16, bottom: 16 }) }}
      className={`fixed z-40 min-h-64 min-w-72 max-h-[calc(100dvh-16px)] max-w-[calc(100vw-16px)] resize flex-col overflow-hidden rounded-lg border bg-background shadow-xl ${open ? "flex" : "hidden"}`}
    >
      <header onPointerDown={startDrag} className="flex cursor-move touch-none select-none items-center gap-2 border-b px-3 py-2">
        <Sparkles className="size-4 shrink-0 text-[var(--chart-1)]" />
        <p className="flex-1 text-sm font-medium">Project agent</p>
        <button type="button" onClick={() => { setTurns([]); setError(null); }} disabled={busy} title="New chat" className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40">
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
            Ask about this project or act on it: tasks, columns, canvas flows, chat messages. Try: &ldquo;Buatin task setup CI untuk Ada, masukin ke Backlog dengan priority high&rdquo; or &ldquo;Buatin canvas flow negosiasi&rdquo;.
          </p>
        ) : null}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "ml-8 rounded-lg bg-primary px-3 py-2 text-primary-foreground" : "mr-8 rounded-lg bg-secondary px-3 py-2"}>
            <p className="whitespace-pre-wrap"><MentionText text={t.shown ?? t.content} names={[]} tags={tags} onTag={onTag} /></p>
            {t.done?.map((d) => <p key={d} className="mt-1 text-[11px] text-muted-foreground">✓ {d}</p>)}
            {t.errors?.map((e) => <p key={e} className="mt-1 text-[11px] text-[var(--chart-7)]">✗ {e}</p>)}
          </div>
        ))}
        {busy && <p className="text-xs text-muted-foreground">{status ?? "Thinking…"}</p>}
        {error && <p className="rounded-md bg-[rgba(239,68,68,0.08)] px-3 py-2 text-xs text-[var(--chart-7)]">{error}</p>}
        <div ref={end} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex items-end gap-2 border-t p-2">
        <div className="relative flex-1">
        {mention.menu}
        <textarea
          {...mention.bind}
          onKeyDown={(e) => {
            if (mention.onKeyDown(e)) return;
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
          }}
          disabled={!enabled}
          rows={2}
          placeholder={enabled ? "Tasks, canvas flows, chat messages… @name for a canvas group" : "Not configured"}
          className="block w-full resize-none rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring disabled:opacity-50"
        />
        </div>
        <button type="submit" disabled={!enabled || busy || !input.trim()} title="Send" className="rounded-md bg-primary p-2 text-primary-foreground disabled:opacity-40">
          <Send className="size-4" />
        </button>
      </form>
    </aside>
  );
}
