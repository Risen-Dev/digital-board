"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Hash, Paperclip, Pencil, Send, X } from "lucide-react";
import { initials } from "@/lib/board";
import { cursorOf, mergeMessages } from "@/lib/chat";
import type { Attachment, ChatMessage, MemberPresence, Presence, Unread } from "@/lib/queries";
import { Avatar } from "../avatar";

const POLL_MS = 3000;

const PRESENCE_COLOR: Record<Presence, string> = {
  online: "var(--chart-2)",
  away: "var(--chart-3)",
  offline: "var(--muted-foreground)",
};

export function PresenceDot({ presence, className = "" }: { presence: Presence; className?: string }) {
  return (
    <span
      title={presence}
      style={{ background: PRESENCE_COLOR[presence] }}
      className={`size-2 shrink-0 rounded-full ${presence === "offline" ? "opacity-50" : ""} ${className}`}
    />
  );
}

export function UnreadBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="ml-auto min-w-4 rounded-full bg-primary px-1.5 py-0.5 text-center text-[10px] font-semibold text-primary-foreground">
      {n > 99 ? "99+" : n}
    </span>
  );
}

const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function Attachments({ files }: { files: Attachment[] }) {
  if (files.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {files.map((f) =>
        f.mime.startsWith("image/") && f.mime !== "image/svg+xml" ? (
          <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/files/${f.id}`}
              alt={f.name}
              className="max-h-56 rounded-md border object-contain"
            />
          </a>
        ) : (
          <a
            key={f.id}
            href={`/api/files/${f.id}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-xs transition-colors hover:bg-secondary"
          >
            <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{bytes(f.size)}</span>
          </a>
        ),
      )}
    </div>
  );
}

export function ChatView({ meId, initialMembers, initialChannel = "all" }: { meId: string; initialMembers: MemberPresence[]; initialChannel?: string }) {
  const [members, setMembers] = useState(initialMembers);
  const [unread, setUnread] = useState<Unread[]>([]);
  const [active, setActive] = useState(initialChannel);

  const countFor = (channel: string) => (channel === active ? 0 : (unread.find((u) => u.channel === channel)?.n ?? 0));
  const others = members.filter((m) => m.id !== meId);
  const activeMember = others.find((m) => m.id === active);

  const onlineCount = members.filter((m) => m.presence === "online").length;

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex w-56 shrink-0 flex-col border-r">
        <div className="border-b px-3 py-2.5">
          <p className="text-xs font-semibold">{members.length} members</p>
          <p className="text-[11px] text-muted-foreground">{onlineCount} online now</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <button
            onClick={() => setActive("all")}
            className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
              active === "all" ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            <Hash className="size-3.5 shrink-0" />
            Workspace
            <UnreadBadge n={countFor("all")} />
          </button>

          <p className="mb-1 mt-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Direct messages
          </p>
          {others.map((m) => (
            <button
              key={m.id}
              onClick={() => setActive(m.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                active === m.id ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              <span className="relative shrink-0">
                <Avatar initials={initials(m.name)} color={m.color} size={22} />
                <PresenceDot presence={m.presence} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-background" />
              </span>
              <span className="truncate">{m.name}</span>
              <UnreadBadge n={countFor(m.id)} />
            </button>
          ))}
          {others.length === 0 && (
            <p className="px-2 text-[11px] text-muted-foreground">You&rsquo;re the only member so far.</p>
          )}
        </div>
      </div>

      {/* Keyed on the conversation: switching remounts with empty state, so
          there is no reset-in-effect and no chance of leaking the old thread. */}
      <Thread
        key={active}
        meId={meId}
        active={active}
        member={activeMember}
        onMembers={setMembers}
        onUnread={setUnread}
      />
    </div>
  );
}

function Thread({
  meId, active, member, onMembers, onUnread,
}: {
  meId: string;
  active: string;
  member: MemberPresence | undefined;
  onMembers: (m: MemberPresence[]) => void;
  onUnread: (u: Unread[]) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const lastId = useRef(0);
  const inFlight = useRef(false);

  /**
   * Poll this conversation. Reading it also clears its unread count server-side.
   *
   * `reset` refetches from the start — needed after an edit, since an
   * `after=<id>` poll never revisits a row it has already seen.
   *
   * Two polls can overlap (the 3s interval and the one fired right after a
   * send), and both would read the same `lastId` and append the same rows, so
   * the merge dedupes by id and an interval tick yields while one is in flight.
   */
  const poll = useCallback(
    async (reset = false) => {
      if (inFlight.current && !reset) return;
      inFlight.current = true;
      const from = reset ? 0 : lastId.current;
      try {
        const res = await fetch(`/api/chat?with=${active}&after=${from}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { messages: ChatMessage[]; members: MemberPresence[]; unread: Unread[] };
        onMembers(data.members);
        onUnread(data.unread);
        lastId.current = cursorOf(data.messages, from);
        setMessages((prev) => mergeMessages(prev, data.messages, reset));
      } catch {
        // A dropped poll is not worth surfacing; the next tick recovers.
      } finally {
        inFlight.current = false;
      }
    },
    [active, onMembers, onUnread],
  );

  useEffect(() => {
    void poll();
    const t = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const body = draft.trim();
    if ((!body && files.length === 0) || sending) return;
    setSending(true);
    setError(null);

    const form = new FormData();
    form.set("to", active);
    form.set("body", body);
    files.forEach((f) => form.append("files", f));

    const snapshot = { draft, files };
    setDraft("");
    setFiles([]);
    try {
      const res = await fetch("/api/chat", { method: "POST", body: form });
      if (!res.ok) {
        // Hand the message back rather than losing what they typed.
        setDraft(snapshot.draft);
        setFiles(snapshot.files);
        setError(await res.text());
      } else {
        await poll();
      }
    } catch {
      setDraft(snapshot.draft);
      setFiles(snapshot.files);
      setError("Could not send. Check your connection.");
    } finally {
      setSending(false);
    }
  }

  async function saveEdit(id: number) {
    const body = editDraft.trim();
    setEditing(null);
    if (!body) return;
    const res = await fetch("/api/chat", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, body }),
    });
    if (!res.ok) return setError(await res.text());
    await poll(true);
  }

  // Only "is it mine" is decided here. The 15-minute window is the server's
  // call — reading a clock during render is impure, and the server is the
  // authority anyway; a late attempt comes back as "Edit window closed".
  const editable = (m: ChatMessage) => m.author_id === meId;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
        {member ? (
          <>
            <PresenceDot presence={member.presence} />
            <span className="text-sm font-medium">{member.name}</span>
            <span className="text-[11px] capitalize text-muted-foreground">{member.presence}</span>
          </>
        ) : (
          <>
            <Hash className="size-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">Workspace</span>
            <span className="text-[11px] text-muted-foreground">everyone can read this</span>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">No messages yet. Say something.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((m) => {
              const mine = m.author_id === meId;
              return (
                <li key={m.id} className={`group flex gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
                  <Avatar initials={initials(m.author_name)} color={m.author_color} size={26} />
                  <div className={`flex max-w-[70%] flex-col ${mine ? "items-end" : ""}`}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-medium">{mine ? "You" : m.author_name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {m.edited_at && " · edited"}
                      </span>
                      {editable(m) && editing !== m.id && (
                        <button
                          onClick={() => {
                            setEditing(m.id);
                            setEditDraft(m.body);
                          }}
                          title="Edit message"
                          className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                        >
                          <Pencil className="size-3" />
                        </button>
                      )}
                    </div>

                    {editing === m.id ? (
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <textarea
                          value={editDraft}
                          autoFocus
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              void saveEdit(m.id);
                            }
                            if (e.key === "Escape") setEditing(null);
                          }}
                          rows={2}
                          className="w-64 resize-y rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-ring"
                        />
                        <button onClick={() => void saveEdit(m.id)} className="text-muted-foreground hover:text-foreground">
                          <Check className="size-4" />
                        </button>
                        <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-foreground">
                          <X className="size-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        {m.body && (
                          <p
                            className={`mt-0.5 whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${
                              mine ? "bg-primary text-primary-foreground" : "border bg-card"
                            }`}
                          >
                            {m.body}
                          </p>
                        )}
                        <Attachments files={m.attachments} />
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={bottom} />
      </div>

      <div className="shrink-0 border-t p-3">
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="flex items-center gap-1.5 rounded-md border bg-secondary px-2 py-1 text-[11px]">
                <Paperclip className="size-3 text-muted-foreground" />
                <span className="max-w-40 truncate">{f.name}</span>
                <span className="text-muted-foreground">{bytes(f.size)}</span>
                <button
                  onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {error && <p className="mb-2 text-[11px] text-[var(--chart-7)]">{error}</p>}

        <div className="flex items-end gap-2">
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              setFiles((p) => [...p, ...Array.from(e.target.files ?? [])].slice(0, 5));
              e.target.value = "";
            }}
          />
          <button
            onClick={() => picker.current?.click()}
            title="Attach files"
            className="flex size-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Paperclip className="size-4" />
          </button>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder={member ? `Message ${member.name}…` : "Message the workspace…"}
            className="max-h-32 min-h-9 flex-1 resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-ring"
          />
          <button
            onClick={() => void send()}
            disabled={(!draft.trim() && files.length === 0) || sending}
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
