import "server-only";
import { all, get, run } from "./db";
import { aiConfig, askText } from "./ai";
import { turnsOf } from "./chat";
import { boardBrief } from "./board-agent";
import { getBoard, listMeetings, listMembers } from "./queries";
import type { Task } from "./board";
import type { User } from "./auth";

const HISTORY = 40;
const SHEET_CHARS = 1500;

const CARD_SYSTEM = `You are the AI agent inside one card of a team's kanban board. People call you with "@agent" in the card's comments.

- Answer in plain text (no JSON, no markdown headings), short and to the point, in the language of the latest comment.
- Comments are prefixed with their author's name ("Ada: …").
- You can read this card, the rest of the board, the workspace's meetings and the project's canvas sheets (their text only), all listed below. Use them when the question needs them.
- You cannot change anything. For changes, tell them to use the Agent button in the project header.`;

const cardBrief = (t: Task, column: string) =>
  [
    `The open card: ${t.key ?? "(no key)"} "${t.title}" in column "${column}".`,
    `Priority: ${t.priority}. Due: ${t.dueDate ?? "none"}. Assignees: ${t.assignees.map((a) => a.name).join(", ") || "none"}. Labels: ${t.label ?? "none"}.`,
    `Description:\n${t.description ?? "(empty)"}`,
    t.checklist.length ? `Checklist:\n${t.checklist.map((i) => `- [${i.done ? "x" : " "}] ${i.text}`).join("\n")}` : "No checklist.",
  ].join("\n");

type SheetElement = { isDeleted?: boolean; text?: string; customData?: { tag?: string } };

/**
 * The words on each sheet (Excalidraw text elements, in drawing order) and on each of its
 * named groups, which people mention as "@name". Shared by the card and project agents.
 */
export async function sheetsBrief(projectId: string) {
  const rows = await all<{ name: string; snapshot: string | null }>(
    "SELECT name, snapshot FROM canvases WHERE project_id = ? ORDER BY position", projectId,
  );
  const wordsOf = (elements: SheetElement[]) => elements.filter((e) => e.text).map((e) => e.text).join(" · ");
  const lines = rows.map((r) => {
    let elements: SheetElement[] = [];
    try {
      elements = (JSON.parse(r.snapshot ?? "null")?.elements ?? []).filter((e: SheetElement) => !e.isDeleted);
    } catch {}
    const tags = [...new Set(elements.map((e) => e.customData?.tag).filter(Boolean))];
    const groups = tags.map((tag) => `\n  - Named group @${tag}: ${wordsOf(elements.filter((e) => e.customData?.tag === tag)).slice(0, SHEET_CHARS) || "(shapes, no text)"}`);
    return `- Sheet "${r.name}": ${wordsOf(elements).slice(0, SHEET_CHARS) || "(no text)"}${groups.join("")}`;
  });
  if (!lines.length) return "";
  return `${lines.join("\n")}\n"@name" in a message means the named group of that name on a sheet above.`;
}

/**
 * Answers the card's comment thread after someone wrote "@agent" in it. The reply is a
 * comment with `agent = true`, stored under the asker's id like chat agent messages.
 * Everything in the prompt is visible to anyone on the project, so nothing private leaks.
 */
// ponytail: whole board + every sheet's text in the prompt; search/tool calls if projects outgrow it.
export async function answerOnCard(me: User, taskId: string) {
  const reply = (text: string) =>
    run(
      "INSERT INTO task_events (task_id, actor_id, text, at, kind, agent) VALUES (?,?,?,?,'comment',true)",
      taskId, me.id, text.slice(0, 5000), new Date().toISOString(),
    );

  const config = await aiConfig(me.workspace_id);
  if (!config) return reply("The AI agent isn't set up yet — a workspace admin can configure it in Settings → AI agent.");

  const project = (await get<{ id: string; name: string }>(
    "SELECT p.id, p.name FROM tasks t JOIN columns c ON c.id = t.column_id JOIN projects p ON p.id = c.project_id WHERE t.id = ?", taskId,
  ))!;
  const today = new Date().toISOString().slice(0, 10);
  const columns = await getBoard(project.id);
  const column = columns.find((c) => c.tasks.some((t) => t.id === taskId))!;
  const task = column.tasks.find((t) => t.id === taskId)!;
  const meetings = (await listMeetings(me.workspace_id))
    .filter((m) => m.repeat !== "none" || m.startDate >= today)
    .slice(0, 30)
    .map((m) => `- "${m.title}" ${m.startDate} ${m.startTime} (${m.durationMin} min${m.repeat !== "none" ? `, repeats ${m.repeat}` : ""})${m.notes ? `: ${m.notes.slice(0, 300)}` : ""}`);

  const rows = (await all<{ agent: boolean; kind: string; body: string; name: string | null }>(
    `SELECT e.agent, e.kind, e.text AS body, u.name FROM task_events e LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.task_id = ? ORDER BY e.id DESC LIMIT ?`,
    taskId, HISTORY,
  )).reverse();
  const activity = rows.filter((r) => r.kind !== "comment").map((r) => `- ${r.name ?? "Someone"}: ${r.body}`);
  const comments = rows.filter((r) => r.kind === "comment").map((r) => ({ ...r, name: r.name ?? "Someone" }));

  const system = [
    CARD_SYSTEM,
    cardBrief(task, column.title),
    `Recent card activity:\n${activity.join("\n") || "none"}`,
    boardBrief(project.name, today, columns, await listMembers(me.workspace_id)),
    `Upcoming and repeating meetings:\n${meetings.join("\n") || "none"}`,
    `Canvas sheets:\n${await sheetsBrief(project.id) || "none"}`,
  ].join("\n\n");
  try {
    const text = await askText(config, system, turnsOf(comments));
    await reply(text.trim() || "(no answer)");
  } catch (error) {
    await reply(`Sorry, the AI provider failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}
