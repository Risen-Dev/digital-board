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
