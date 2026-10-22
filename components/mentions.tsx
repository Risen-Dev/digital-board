"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { PenLine, Tag } from "lucide-react";

import { loadCanvasSnapshot } from "@/lib/canvas/api";
import type { CanvasTag } from "@/lib/queries";
import { useT } from "@/components/i18n";

export type MentionOption = { id: string; name: string; label: string; icon: ReactNode; hint?: string };

export const tagOptions = (tags: CanvasTag[]): MentionOption[] =>
  tags.map((t) => ({
    id: `tag:${t.sheetId}:${t.tag}`,
    name: t.tag,
    label: `@${t.tag}`,
    hint: t.project,
    icon: (
      <span className="flex size-5 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <Tag className="size-3" />
      </span>
    ),
  }));

/**
 * "@" at the caret of a controlled textarea opens a picker over `all`.
 * Spread `bind` on the textarea and render `menu` inside a `relative` wrapper;
 * call `onKeyDown` first from the textarea's own handler — true means it was handled.
 */
export function useMentionPicker(value: string, setValue: (v: string) => void, all: MentionOption[], below = false) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const q = mention?.query.toLowerCase() ?? "";
  const options = mention ? all.filter((o) => o.label.toLowerCase().includes(q) || o.name.toLowerCase().includes(q)) : [];

  const track = (text: string, caret: number) => {
    const match = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
    setMention(match ? { query: match[2], start: caret - match[2].length - 1 } : null);
    setActive(0);
  };
  const pick = (name: string) => {
    if (!mention || !input.current) return;
    const caret = input.current.selectionStart;
    const insert = `@${name} `;
    setValue(value.slice(0, mention.start) + insert + value.slice(caret));
    setMention(null);
    const at = mention.start + insert.length;
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(at, at);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!options.length) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(options[active].name);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setMention(null);
    } else return false;
    return true;
  };

  const menu = options.length > 0 && (
    <ul role="listbox" className={`absolute inset-x-0 z-10 max-h-56 overflow-y-auto rounded-md border bg-card p-1 shadow-lg ${below ? "top-full mt-1" : "bottom-full mb-1"}`}>
      {options.map((o, i) => (
        <li
          key={o.id}
          role="option"
          aria-selected={i === active}
          onMouseDown={(e) => {
            e.preventDefault();
            pick(o.name);
          }}
          onMouseEnter={() => setActive(i)}
          className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs ${i === active ? "bg-secondary" : ""}`}
        >
          {o.icon}
          {o.label}
          {o.hint && <span className="ml-auto text-[11px] text-muted-foreground">{o.hint}</span>}
        </li>
      ))}
    </ul>
  );

  const bind = {
    ref: input,
    value,
    onChange: (e: { target: HTMLTextAreaElement }) => {
      setValue(e.target.value);
      track(e.target.value, e.target.selectionStart);
    },
    onBlur: () => setMention(null),
  };

  return { menu, bind, onKeyDown };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every `@tag` in `text` that names a known canvas tag. */
export const tagsIn = (text: string, tags: CanvasTag[]) =>
  tags.filter((t) => new RegExp(`(^|\\s)@${escape(t.tag)}(?![\\w-])`).test(text));

/**
 * Highlights `@Full Name` for members and turns a known `@tag` into a link to its
 * canvas shapes. Longest first, so "@Ada Lovelace" beats "@Ada".
 */
export function MentionText({ text, names, tags, onTag }: { text: string; names: string[]; tags: CanvasTag[]; onTag: (tag: CanvasTag) => void }) {
  // First wins: callers list the open project's tags first.
  const byName = new Map<string, CanvasTag>(tags.map((t) => [`@${t.tag}`, t] as const).reverse());
  const words = [...names.map((n) => `@${n}`), ...byName.keys()].sort((a, b) => b.length - a.length);
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => `${escape(w)}(?![\\w-])`).join("|")})`, "g");
  return text.split(re).map((part, i) => {
    if (i % 2 === 0) return part;
    const tag = byName.get(part);
    return tag ? (
      <button key={i} type="button" onClick={() => onTag(tag)} title={`Show on the canvas (${tag.project})`} className="font-semibold underline underline-offset-2 hover:opacity-80">
        {part}
      </button>
    ) : (
      <span key={i} className="font-semibold text-primary">{part}</span>
    );
  });
}

/** A picture of one tagged group, drawn from its sheet's saved scene. */
function TagPreview({ tag, onClick }: { tag: CanvasTag; onClick: () => void }) {
  const tr = useT();
  const [src, setSrc] = useState<string | null>();
  useEffect(() => {
    let cancelled = false;
    let url = "";
    void Promise.all([loadCanvasSnapshot(tag.sheetId), import("@excalidraw/excalidraw")])
      .then(async ([scene, { exportToBlob }]) => {
        const elements = ((scene?.elements ?? []) as { isDeleted?: boolean; customData?: { tag?: string } }[])
          .filter((e) => !e.isDeleted && e.customData?.tag === tag.tag);
        if (!elements.length) return setSrc(null);
        // PNG, not SVG: SVG export subsets fonts in a Web Worker that Turbopack can't load
        // ("Failed to construct 'Worker'"), and a PNG can't carry script either.
        const png = await exportToBlob({
          elements: elements as never,
          appState: { exportBackground: false, exportScale: 2, exportWithDarkMode: document.documentElement.classList.contains("dark") },
          files: (scene?.files ?? null) as never,
          exportPadding: 8,
          mimeType: "image/png",
        });
        url = URL.createObjectURL(png);
        if (cancelled) URL.revokeObjectURL(url);
        else setSrc(url);
      })
      .catch(() => !cancelled && setSrc(null));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [tag.sheetId, tag.tag]);

  return (
    <button type="button" onClick={onClick} title={`Show on the canvas (${tag.project})`} className="group flex w-56 flex-col overflow-hidden rounded-md border text-left transition-colors hover:border-ring">
      <span className="flex h-40 items-center justify-center bg-secondary/40 p-2">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`@${tag.tag}`} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[11px] text-muted-foreground">{src === null ? tr("Nothing drawn") : tr("Loading…")}</span>
        )}
      </span>
      <span className="flex items-center gap-1 border-t px-2 py-1 text-[11px] text-foreground">
        <Tag className="size-3 shrink-0" />
        <span className="truncate">@{tag.tag}</span>
      </span>
    </button>
  );
}

/** Previews of the canvas groups a text mentions; each opens its group on the canvas. */
export function TagLinks({ text, tags, onTag }: { text: string; tags: CanvasTag[]; onTag: (tag: CanvasTag) => void }) {
  const tr = useT();
  // One per name, the open project's first (callers order them that way).
  const found = tagsIn(text, tags).filter((t, i, all) => all.findIndex((o) => o.tag === t.tag) === i);
  if (!found.length) return null;
  return (
    <div className="border-t py-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <PenLine className="size-3.5" />
        {tr("Canvas")} {found.length}
      </h3>
      <div className="flex flex-wrap gap-2">
        {found.map((t) => (
          <TagPreview key={`${t.sheetId}:${t.tag}`} tag={t} onClick={() => onTag(t)} />
        ))}
      </div>
    </div>
  );
}
