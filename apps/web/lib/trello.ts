// Trello board import: parses an export (JSON on every plan, CSV on paid plans) or a
// plain CSV into columns + cards. Pure — the browser parses the file, the server re-checks
// the result with `cleanImport` (it is untrusted input) before writing.
import type { CheckItem } from "./board";

export type ImportCard = {
  column: string; title: string; description: string | null; label: string | null;
  dueDate: string | null; members: string[]; checklist: CheckItem[]; archived: boolean;
};
export type Imported = { name: string; columns: string[]; cards: ImportCard[] };

const MAX_COLUMNS = 50;
const MAX_CARDS = 2000;
const str = (v: unknown, max: number) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "");
/** "2026-05-01T12:00:00.000Z", "2026-05-01", "05/01/2026 12:00" → "2026-05-01"; unparsable → null. */
const dayOf = (v: unknown) => {
  const s = str(v, 40);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = s ? new Date(s) : null;
  return d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
};
/** Same as `joinLabels` in board.ts (value imports from there don't run under node's strip-types check). */
const joinLabels = (raw: string) => {
  const all = raw.split(",").map((l) => l.trim()).filter(Boolean);
  return all.filter((l, i) => all.findIndex((x) => x.toLowerCase() === l.toLowerCase()) === i).join(", ") || null;
};
const byPos = (a: { pos?: unknown }, b: { pos?: unknown }) => Number(a.pos ?? 0) - Number(b.pos ?? 0);

/** RFC 4180: quoted fields, "" escapes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

type TrelloJson = {
  name?: string;
  lists?: { id: string; name: string; closed?: boolean; pos?: number }[];
  cards?: { id: string; name: string; desc?: string; idList: string; closed?: boolean; due?: string | null; pos?: number;
    labels?: { name?: string; color?: string }[]; idMembers?: string[] }[];
  checklists?: { idCard: string; pos?: number; checkItems?: { name: string; state?: string; pos?: number }[] }[];
  members?: { id: string; fullName?: string }[];
};

function fromJson(j: TrelloJson): Imported {
  const lists = (j.lists ?? []).filter((l) => !l.closed).sort(byPos);
  const listName = new Map(lists.map((l) => [l.id, str(l.name, 100) || "Untitled"]));
  const member = new Map((j.members ?? []).map((m) => [m.id, str(m.fullName, 100)]));
  const checks = new Map<string, CheckItem[]>();
  for (const cl of [...(j.checklists ?? [])].sort(byPos)) {
    const items = [...(cl.checkItems ?? [])].sort(byPos).map((i) => ({ text: str(i.name, 300), done: i.state === "complete" }));
    checks.set(cl.idCard, [...(checks.get(cl.idCard) ?? []), ...items]);
  }
  const cards = (j.cards ?? []).filter((c) => listName.has(c.idList)).sort(byPos).map((c) => ({
    column: listName.get(c.idList)!,
    title: str(c.name, 500),
    description: str(c.desc, 20_000) || null,
    // Colour-only Trello labels have no name; their colour is the closest thing to one.
    label: joinLabels((c.labels ?? []).map((l) => str(l.name, 50) || str(l.color, 50)).join(",")),
    dueDate: dayOf(c.due),
    members: (c.idMembers ?? []).map((id) => member.get(id) ?? "").filter(Boolean),
    checklist: checks.get(c.id) ?? [],
    archived: c.closed === true,
  }));
  return { name: str(j.name, 100), columns: [...listName.values()], cards };
}

// Trello's CSV headers first, then plain-spreadsheet ones. Matched ignoring case.
const HEADERS = {
  title: ["card name", "title", "name", "task"],
  column: ["list name", "column", "list", "status", "stage"],
  description: ["card description", "description", "desc", "notes"],
  label: ["labels", "label", "tags"],
  dueDate: ["due date", "due", "deadline"],
  members: ["members", "assignees", "assignee", "owner"],
  archived: ["archived", "closed"],
  board: ["board name"],
} as const;

function fromCsv(text: string): Imported | string {
  const [head, ...rows] = parseCsv(text.replace(/^﻿/, ""));
  if (!head) return "The CSV file is empty.";
  const names = head.map((h) => h.trim().toLowerCase());
  const col = (k: keyof typeof HEADERS) => HEADERS[k].map((h) => names.indexOf(h)).find((i) => i >= 0) ?? -1;
  const at = Object.fromEntries(Object.keys(HEADERS).map((k) => [k, col(k as keyof typeof HEADERS)])) as Record<keyof typeof HEADERS, number>;
  if (at.title < 0) return `No title column found. Name one of the headers "${HEADERS.title.join('", "')}".`;
  const cell = (r: string[], k: keyof typeof HEADERS) => (at[k] >= 0 ? r[at[k]] ?? "" : "");
  const cards = rows.map((r) => ({
    column: str(cell(r, "column"), 100) || "To Do",
    title: str(cell(r, "title"), 500),
    description: str(cell(r, "description"), 20_000) || null,
    // Trello writes labels as "Urgent (red), Bug (orange)".
    label: joinLabels(cell(r, "label").replace(/\s*\([a-z_]+\)/g, "")),
    dueDate: dayOf(cell(r, "dueDate")),
    members: cell(r, "members").split(/[,;]/).map((m) => str(m, 100)).filter(Boolean),
    checklist: [],
    archived: /^(true|yes|1)$/i.test(cell(r, "archived").trim()),
  }));
  return { name: str(rows[0] && cell(rows[0], "board"), 100), columns: [...new Set(cards.map((c) => c.column))], cards };
}

/** Parses an uploaded file's text. A string result is an error to show. */
export function parseImport(text: string): Imported | string {
  let parsed: Imported | string;
  if (/^\s*[{[]/.test(text)) {
    try { parsed = fromJson(JSON.parse(text)); } catch { return "That JSON file couldn't be read."; }
  } else parsed = fromCsv(text);
  if (typeof parsed === "string") return parsed;
  return cleanImport(parsed) ?? "No cards found in that file.";
}

/** Server-side re-check of a client-parsed import: shape, lengths and counts. Null when unusable. */
export function cleanImport(data: unknown): Imported | null {
  const d = data as Partial<Imported> | null;
  if (!d || !Array.isArray(d.cards)) return null;
  const columns = [...new Set((Array.isArray(d.columns) ? d.columns : []).map((c) => str(c, 100)).filter(Boolean))].slice(0, MAX_COLUMNS);
  // ponytail: cards past MAX_CARDS (or in columns past MAX_COLUMNS) are dropped; chunk the upload if real boards hit it.
  const cards = d.cards.slice(0, MAX_CARDS).map((c): ImportCard => ({
    column: str(c?.column, 100),
    title: str(c?.title, 500),
    description: str(c?.description, 20_000) || null,
    label: joinLabels(str(c?.label, 500)),
    dueDate: dayOf(c?.dueDate),
    members: (Array.isArray(c?.members) ? c.members : []).map((m) => str(m, 100)).filter(Boolean).slice(0, 20),
    checklist: (Array.isArray(c?.checklist) ? c.checklist : []).slice(0, 100)
      .map((i) => ({ text: str(i?.text, 300), done: i?.done === true })).filter((i) => i.text),
    archived: c?.archived === true,
  })).filter((c) => c.title);
  for (const c of cards) if (!columns.includes(c.column) && columns.length < MAX_COLUMNS) columns.push(c.column || "To Do");
  const kept = cards.filter((c) => columns.includes(c.column || "To Do")).map((c) => ({ ...c, column: c.column || "To Do" }));
  return kept.length || columns.length ? { name: str(d.name, 100), columns, cards: kept } : null;
}
