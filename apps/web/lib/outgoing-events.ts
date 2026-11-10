// Pure half of the outgoing webhook: what a delivery says. No imports, so `board.check.ts` can load it.

export const OUTGOING_EVENTS = ["task.created", "task.moved", "task.updated", "task.deleted"] as const;
export type OutgoingEvent = (typeof OUTGOING_EVENTS)[number] | "ping";

export type OutgoingTask = {
  id: string; key: string; title: string; description: string | null; label: string | null;
  priority: string; dueDate: string | null; column: string; assignee: string | null;
};
export type OutgoingProject = { id: string; name: string; key: string };

/**
 * The JSON body. `text` and `content` carry one readable line, so Slack, Google Chat,
 * Mattermost (`text`) and Discord (`content`) incoming webhooks can take it as is.
 */
export function outgoingPayload(
  event: OutgoingEvent, project: OutgoingProject, task: OutgoingTask | null,
  change: string, actor: string | null, at = new Date(),
) {
  const text = task
    ? `${task.key} "${task.title}": ${change}${actor ? ` by ${actor}` : ""} · ${project.name}`
    : `Test delivery from ${project.name}`;
  return { event, at: at.toISOString(), text, content: text, project, task, change, actor };
}
