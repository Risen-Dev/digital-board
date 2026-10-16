import "server-only";
import { all, run } from "./db";
import { aiConfig, askText } from "./ai";
import { turnsOf } from "./chat";
import { boardBrief } from "./board-agent";
import { getBoard, listMembers, listProjects } from "./queries";
import type { User } from "./auth";

const HISTORY = 30;
const MAX_PROJECTS = 5;

const CHAT_SYSTEM = `You are the AI agent in a team's workspace chat, next to their kanban boards. People call you with "@agent" in the channel or a direct message, or talk to you in their private Agent thread.

- Answer in plain text (no JSON, no markdown headings), short and conversational, in the language of the latest message.
- Messages from people are prefixed with their name ("Ada: …"). Address them by name when it helps.
- You can read the boards listed below and nothing else. You cannot change tasks, columns or settings: for changes, tell them to use the Agent button in the project header.
- If the answer depends on a board you were not given, say you can't see it from this conversation.`;

/**
 * Projects every participant may open. The reply is read by everyone in the
 * conversation, so it may only draw on boards all of them can see.
 */
async function sharedProjects(workspaceId: string, participants: string[]) {
  const users = await all<{ id: string; is_admin: number }>(
    "SELECT id, is_admin FROM users WHERE workspace_id = ? AND id = ANY(?::text[])", workspaceId, participants,
  );
  let shared: { id: string; name: string }[] | null = null;
  for (const u of users) {
    const mine = await listProjects(workspaceId, u.id, u.is_admin === 1);
    shared = shared ? shared.filter((p) => mine.some((m) => m.id === p.id)) : mine;
  }
  return (shared ?? []).slice(0, MAX_PROJECTS);
}

/**
 * Answers the conversation `me` just wrote in: the channel (`to` null), a DM, or the
 * private agent thread (`to` = me). The reply is a message with `agent = true`,
 * stored under the asker's id (authors must be users) and picked up by the poll.
 */
// ponytail: any member can call the agent, no per-user quota; add one if the provider bill matters.
export async function answerInChat(me: User, to: string | null) {
  const reply = async (body: string) =>
    run(
      "INSERT INTO messages (workspace_id, author_id, recipient_id, body, created_at, agent) VALUES (?,?,?,?,?,true)",
      me.workspace_id, me.id, to, body.slice(0, 4000), new Date().toISOString(),
    );

  const config = await aiConfig(me.workspace_id);
  if (!config) return reply("The AI agent isn't set up yet — a workspace admin can configure it in Settings → AI agent.");

  const participants = to === null
    ? (await all<{ id: string }>("SELECT id FROM users WHERE workspace_id = ?", me.workspace_id)).map((u) => u.id)
    : [...new Set([me.id, to])];
  const members = await listMembers(me.workspace_id);
  const today = new Date().toISOString().slice(0, 10);
  const boards = [];
  for (const p of await sharedProjects(me.workspace_id, participants)) boards.push(boardBrief(p.name, today, await getBoard(p.id), members));

  const where = to === null
    ? "m.recipient_id IS NULL"
    : "((m.author_id = ? AND m.recipient_id = ?) OR (m.author_id = ? AND m.recipient_id = ?))";
  const rows = (await all<{ agent: boolean; body: string; name: string }>(
    `SELECT m.agent, m.body, u.name FROM messages m JOIN users u ON u.id = m.author_id
      WHERE m.workspace_id = ? AND ${where} ORDER BY m.id DESC LIMIT ?`,
    me.workspace_id, ...(to === null ? [] : [me.id, to, to, me.id]), HISTORY,
  )).reverse();

  const room = to === null ? "the workspace channel (everyone reads it)" : to === me.id ? `${me.name}'s private thread with you` : "a direct message between two people";
  const system = `${CHAT_SYSTEM}\n\nThis conversation: ${room}.\n\n${boards.join("\n\n") || "No boards are shared by everyone in this conversation."}`;
  try {
    const text = await askText(config, system, turnsOf(rows));
    await reply(text.trim() || "(no answer)");
  } catch (error) {
    await reply(`Sorry, the AI provider failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}
