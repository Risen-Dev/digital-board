"use client";

import { useEffect, useState } from "react";
import { CalendarClock, FolderKanban, MessageSquare, Search, SquareCheckBig } from "lucide-react";
import type { Project, SearchCard, SearchMessage } from "@/lib/queries";
import type { Meeting } from "@/lib/meetings";
import { useT } from "@/components/i18n";

type Hit = { key: string; group: string; Icon: typeof Search; title: string; sub: string; pick: () => void };

/**
 * Cmd+K: cards and messages come from /api/search; projects and meetings are
 * already in the workspace, so they are matched here.
 */
export function SearchPalette({ projects, meetings, channelName, onClose, onCard, onProject, onMessage, onMeeting }: {
  projects: Project[];
  meetings: Meeting[];
  channelName: (channel: string) => string;
  onClose: () => void;
  onCard: (card: SearchCard) => void;
  onProject: (projectId: string) => void;
  onMessage: (channel: string) => void;
  onMeeting: () => void;
}) {
  const tr = useT();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; cards: SearchCard[]; messages: SearchMessage[] }>({ q: "", cards: [], messages: [] });
  const [active, setActive] = useState(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?${new URLSearchParams({ q: query })}`, { signal: ctrl.signal, cache: "no-store" });
        if (res.ok) setFound({ q: query, ...(await res.json()) });
      } catch {
        // Aborted by the next keystroke, or offline; the list just stays as it was.
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const needle = q.trim().toLowerCase();
  // Server hits only for the query they answered, so stale rows never linger under a new one.
  const remote = needle.length >= 2 && found.q.toLowerCase() === needle ? found : { cards: [], messages: [] };
  const hits: Hit[] = needle ? [
    ...remote.cards.map((c) => ({
      key: `c${c.id}`, group: "Cards", Icon: SquareCheckBig, title: c.title,
      sub: [c.key, c.projectName, c.columnTitle].filter(Boolean).join(" · "), pick: () => onCard(c),
    })),
    ...projects.filter((p) => p.name.toLowerCase().includes(needle)).slice(0, 5).map((p) => ({
      key: `p${p.id}`, group: "Projects", Icon: FolderKanban, title: p.name, sub: p.key, pick: () => onProject(p.id),
    })),
    ...remote.messages.map((m) => ({
      key: `m${m.id}`, group: "Messages", Icon: MessageSquare, title: m.body,
      sub: `${m.author} in ${channelName(m.channel)} · ${m.atLabel}`, pick: () => onMessage(m.channel),
    })),
    ...meetings.filter((m) => m.title.toLowerCase().includes(needle)).slice(0, 5).map((m) => ({
      key: `e${m.id}`, group: "Meetings", Icon: CalendarClock, title: m.title, sub: `${m.startDate} ${m.startTime}`, pick: onMeeting,
    })),
  ] : [];
  const current = Math.min(active, hits.length - 1);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + hits.length) % Math.max(hits.length, 1));
    } else if (e.key === "Enter" && hits[current]) {
      e.preventDefault();
      hits[current].pick();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh] animate-in fade-in duration-150" onClick={onClose}>
      <div
        role="dialog"
        aria-label={tr("Search")}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-card shadow-lg animate-in fade-in zoom-in-95 duration-150"
      >
        <label className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={tr("Search cards, projects, messages, meetings…")}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">{tr("Esc")}</kbd>
        </label>
        <div className="overflow-y-auto p-2">
          {!needle && <p className="px-2 py-6 text-center text-xs text-muted-foreground">{tr("Type to search everything you can open.")}</p>}
          {needle && hits.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">{tr("No results.")}</p>}
          {hits.map((h, i) => (
            <div key={h.key}>
              {h.group !== hits[i - 1]?.group && (
                <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h.group}</p>
              )}
              <button
                onClick={h.pick}
                onMouseMove={() => setActive(i)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left ${i === current ? "bg-secondary" : ""}`}
              >
                <h.Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{h.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{h.sub}</span>
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
