// Pure half of project automations: rule shape, validation, matching. No imports, so the check can load it.

export const AUTOMATION_TRIGGERS = ["task.created", "task.moved"] as const;
export const AUTOMATION_ACTIONS = ["assign", "unassign", "priority", "label", "due"] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];
export type AutomationAction = (typeof AUTOMATION_ACTIONS)[number];

/**
 * One rule in `projects.automations`: when a card is created (in `columnId`, or anywhere
 * when null) or moved into `columnId`, do one thing. `value` is a user id, a priority,
 * a label, or a number of days from today for the due date; unused by "unassign".
 */
export type Automation = { id: string; on: AutomationTrigger; columnId: string | null; do: AutomationAction; value: string };

export const MAX_AUTOMATIONS = 20;
const PRIORITY_VALUES = ["low", "medium", "high"]; // = PRIORITIES in board.ts

/** A clean rule, or why it is rejected. `columnIds`/`memberIds` are this project's columns and the workspace's users. */
export function cleanAutomation(raw: Partial<Automation>, columnIds: string[], memberIds: string[]): Automation | string {
  const on = AUTOMATION_TRIGGERS.find((t) => t === raw.on);
  const action = AUTOMATION_ACTIONS.find((a) => a === raw.do);
  if (!on) return "Pick a trigger.";
  if (!action) return "Pick an action.";
  const columnId = raw.columnId || null;
  if (columnId ? !columnIds.includes(columnId) : on === "task.moved") return "Pick a column of this project.";
  const value = String(raw.value ?? "").trim();
  if (action === "assign" && !memberIds.includes(value)) return "Pick a member to assign.";
  if (action === "priority" && !PRIORITY_VALUES.includes(value)) return "Pick a priority.";
  if (action === "label" && (!value || value.includes(",") || value.length > 40)) return "A label is one name, up to 40 characters, without commas.";
  if (action === "due" && !/^\d{1,3}$/.test(value)) return "Due date: a whole number of days, 0–999.";
  return { id: raw.id || crypto.randomUUID(), on, columnId, do: action, value: action === "unassign" ? "" : value };
}

/** Rules that fire for this event, with the card now in `columnId`. Saved order is run order. */
export const automationsFor = (rules: Automation[], event: string, columnId: string) =>
  rules.filter((r) => r.on === event && (!r.columnId || r.columnId === columnId));
