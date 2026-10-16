// Pure half of the inbound webhook; type-only imports so `board.check.ts` can load it under strip-types.
import type { Priority } from "./board";

const PRIORITIES: Priority[] = ["low", "medium", "high"];

export type InboundTask = {
  title: string;
  description: string | null;
  label: string | null;
  priority: Priority;
  dueDate: string | null;
  column: string | null;
};

const text = (v: unknown, max: number) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "") || null;

/**
 * Reads one card from a generic webhook body (Zapier, Make, a form tool, curl).
 * Accepts snake_case or camelCase for the due date; anything unknown is ignored.
 */
export function parseInbound(body: Record<string, unknown>): InboundTask | { error: string } {
  const title = text(body.title, 200);
  if (!title) return { error: "title is required." };

  const priority = (text(body.priority, 10)?.toLowerCase() ?? "medium") as Priority;
  if (!PRIORITIES.includes(priority)) return { error: `priority must be one of ${PRIORITIES.join(", ")}.` };

  const dueDate = text(body.due_date ?? body.dueDate, 10);
  if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || isNaN(Date.parse(dueDate)))) {
    return { error: "due_date must be YYYY-MM-DD." };
  }

  return {
    title,
    description: text(body.description, 10_000),
    label: text(body.label, 50),
    priority,
    dueDate,
    column: text(body.column, 100),
  };
}

export type InboundEmail = { from: string; subject: string; text: string };

const str = (...vs: unknown[]) => vs.find((v): v is string => typeof v === "string" && v.trim() !== "")?.trim() ?? "";

/** Drops the quoted thread under a reply ("On … wrote:", "-----Original Message-----", "> " lines). */
export function stripQuoted(text: string) {
  const cut = text.search(/^(On .{1,200}wrote:\s*$|-{2,} ?Original Message|>)/im);
  return (cut < 0 ? text : text.slice(0, cut)).trim();
}

/**
 * Reads an email from an inbound-mail webhook: Postmark (JSON), SendGrid Inbound
 * Parse and Mailgun routes (form fields), or any tool posting `from`/`subject`/`text`.
 * Null when the body isn't an email, so the plain card fields apply instead.
 */
export function emailOf(b: Record<string, unknown>): InboundEmail | null {
  const full = b.FromFull as { Email?: string; Name?: string } | undefined;
  const from = full?.Email ? (full.Name ? `${full.Name} <${full.Email}>` : full.Email) : str(b.From, b.from, b.sender);
  if (!from || typeof b.title === "string") return null;
  const html = str(b.HtmlBody, b["body-html"], b.html);
  const text = str(b.StrippedTextReply, b["stripped-text"], b.TextBody, b["body-plain"], b.text)
    || html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");
  // "Re: Fwd: Login broken" → "Login broken", so a reply finds the card its first email made.
  const subject = str(b.Subject, b.subject).replace(/^((re|fwd?|aw|sv)\s*:\s*)+/i, "").trim() || "(no subject)";
  return { from, subject, text: stripQuoted(text).slice(0, 10_000) };
}

/** `Ada <ada@x.io>` → `ada@x.io`, lowercased, so senders compare by address only. */
export const addressOf = (from: string) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
