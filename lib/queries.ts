import "server-only";
import { all, get, run } from "./db";
import type { Column, Entry, Member, Priority, Task } from "./board";
import { day, stamp } from "./format";

type TaskRow = {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  label: string | null;
  priority: Priority;
  due_date: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_color: string | null;
};

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  columnId: r.column_id,
  title: r.title,
  description: r.description,
  label: r.label,
  priority: r.priority,
  dueDate: r.due_date,
  assignee:
    r.assignee_id && r.assignee_name && r.assignee_color
      ? { id: r.assignee_id, name: r.assignee_name, color: r.assignee_color }
      : null,
});

export type Project = { id: string; name: string };

export const workspaceName = async (workspaceId: string) =>
  (await get<{ name: string }>("SELECT name FROM workspaces WHERE id = ?", workspaceId))?.name ?? "Workspace";

export const listProjects = (workspaceId: string, userId: string, isAdmin: boolean) =>
  isAdmin
    ? all<Project>("SELECT id, name FROM projects WHERE workspace_id = ? ORDER BY position, created_at", workspaceId)
    : all<Project>(
        `SELECT p.id, p.name FROM projects p JOIN project_members pm ON pm.project_id = p.id
         WHERE p.workspace_id = ? AND pm.user_id = ? ORDER BY p.position, p.created_at`,
        workspaceId, userId,
      );

export const firstProject = (workspaceId: string) =>
  get<Project>("SELECT id, name FROM projects WHERE workspace_id = ? ORDER BY position, created_at LIMIT 1", workspaceId);

export const listMembers = (workspaceId: string) =>
  all<Member>("SELECT id, name, color FROM users WHERE workspace_id = ? ORDER BY created_at", workspaceId);

export type ProjectMember = { user_id: string; project_id: string; role: "admin" | "editor" | "viewer" };
export const projectMembers = (workspaceId: string) =>
  all<ProjectMember>(
    `SELECT pm.user_id, pm.project_id, pm.role FROM project_members pm
       JOIN projects p ON p.id = pm.project_id WHERE p.workspace_id = ?`,
    workspaceId,
  );

export async function getBoard(projectId: string): Promise<Column[]> {
  const columns = await all<{ id: string; title: string; color: string }>(
    "SELECT id, title, color FROM columns WHERE project_id = ? ORDER BY position",
    projectId,
  );
  const rows = await all<TaskRow>(
    `SELECT t.id, t.column_id, t.title, t.description, t.label, t.priority, t.due_date,
            u.id AS assignee_id, u.name AS assignee_name, u.color AS assignee_color
       FROM tasks t
       JOIN columns c ON c.id = t.column_id
       LEFT JOIN users u ON u.id = t.assignee_id
      WHERE c.project_id = ?
      ORDER BY t.position`,
    projectId,
  );
  return columns.map((c) => ({ ...c, tasks: rows.filter((r) => r.column_id === c.id).map(toTask) }));
}

export const taskHistory = async (taskId: string): Promise<Entry[]> =>
  (await all<Omit<Entry, "atLabel">>(
    `SELECT e.at, e.text, u.name AS actor
       FROM task_events e LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.task_id = ? ORDER BY e.id DESC`,
    taskId,
  )).map((e) => ({ ...e, atLabel: stamp(e.at) }));

export type FeedItem = Entry & { id: number; taskId: string; taskTitle: string; columnTitle: string; columnColor: string; dayLabel: string };
type FeedRow = Omit<FeedItem, "atLabel" | "dayLabel">;


/** Workspace admins see every project; members only the projects they are assigned to. */
const VISIBLE_PROJECT = "(? = 1 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?))";

export const activityFeed = async (workspaceId: string, userId: string, isAdmin: number, limit = 100): Promise<FeedItem[]> =>
  (await all<FeedRow>(
    `SELECT e.id, e.at, e.text, u.name AS actor, t.id AS "taskId", t.title AS "taskTitle",
            c.title AS "columnTitle", c.color AS "columnColor"
       FROM task_events e
       JOIN tasks t ON t.id = e.task_id
       JOIN columns c ON c.id = t.column_id
       JOIN projects p ON p.id = c.project_id
       LEFT JOIN users u ON u.id = e.actor_id
      WHERE p.workspace_id = ? AND ${VISIBLE_PROJECT}
      ORDER BY e.id DESC LIMIT ?`,
    workspaceId, isAdmin, userId, limit,
  )).map((e) => ({ ...e, atLabel: stamp(e.at), dayLabel: day(e.at) }));

export const activityNotifications = async (workspaceId: string, userId: string, isAdmin: number, limit = 5): Promise<FeedItem[]> => {
  const read = (await get<{ last_activity_read_id: number }>(
    "SELECT last_activity_read_id FROM users WHERE id = ?",
    userId,
  ))?.last_activity_read_id ?? 0;
  return (await all<FeedRow>(
    `SELECT e.id, e.at, e.text, u.name AS actor, t.id AS "taskId", t.title AS "taskTitle",
            c.title AS "columnTitle", c.color AS "columnColor"
       FROM task_events e
       JOIN tasks t ON t.id = e.task_id
       JOIN columns c ON c.id = t.column_id
       JOIN projects p ON p.id = c.project_id
       LEFT JOIN users u ON u.id = e.actor_id
      WHERE p.workspace_id = ? AND e.id > ? AND ${VISIBLE_PROJECT}
        AND NOT EXISTS (SELECT 1 FROM activity_reads ar WHERE ar.user_id = ? AND ar.event_id = e.id)
      ORDER BY e.id DESC LIMIT ?`,
    workspaceId, read, isAdmin, userId, userId, limit,
  )).map((e) => ({ ...e, atLabel: stamp(e.at), dayLabel: day(e.at) }));
};

export async function markActivityRead(workspaceId: string, userId: string) {
  const upTo = (await get<{ id: number }>(
    `SELECT COALESCE(MAX(e.id), 0) id FROM task_events e
       JOIN tasks t ON t.id = e.task_id
       JOIN columns c ON c.id = t.column_id
       JOIN projects p ON p.id = c.project_id
      WHERE p.workspace_id = ?`,
    workspaceId,
  ))!.id;
  await run("UPDATE users SET last_activity_read_id = GREATEST(last_activity_read_id, ?) WHERE id = ?", upTo, userId);
}

export async function markActivityItemsRead(userId: string, eventIds: number[]) {
  for (const eventId of eventIds) {
    await run("INSERT INTO activity_reads (user_id, event_id) VALUES (?,?) ON CONFLICT DO NOTHING", userId, eventId);
  }
}

export const myTasks = async (userId: string) =>
  (await all<TaskRow & { column_title: string; column_color: string; project_name: string }>(
    `SELECT t.id, t.column_id, t.title, t.description, t.label, t.priority, t.due_date,
            u.id AS assignee_id, u.name AS assignee_name, u.color AS assignee_color,
            c.title AS column_title, c.color AS column_color, p.name AS project_name
       FROM tasks t
       JOIN columns c ON c.id = t.column_id
       JOIN projects p ON p.id = c.project_id
       LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.assignee_id = ?
      ORDER BY t.due_date IS NULL, t.due_date, t.position`,
    userId,
  )).map((r) => ({ ...toTask(r), columnTitle: r.column_title, columnColor: r.column_color, projectName: r.project_name }));

export async function analytics(projectId: string) {
  const byColumn = await all<{ title: string; color: string; n: number }>(
    `SELECT c.title, c.color, COUNT(t.id) n
       FROM columns c LEFT JOIN tasks t ON t.column_id = c.id
      WHERE c.project_id = ? GROUP BY c.id ORDER BY c.position`,
    projectId,
  );
  const byPriority = await all<{ priority: Priority; n: number }>(
    `SELECT t.priority, COUNT(*) n FROM tasks t JOIN columns c ON c.id = t.column_id
      WHERE c.project_id = ? GROUP BY t.priority`,
    projectId,
  );
  const byAssignee = await all<{ name: string | null; color: string | null; n: number }>(
    `SELECT u.name, u.color, COUNT(*) n FROM tasks t
       JOIN columns c ON c.id = t.column_id LEFT JOIN users u ON u.id = t.assignee_id
      WHERE c.project_id = ? GROUP BY t.assignee_id, u.name, u.color ORDER BY n DESC`,
    projectId,
  );
  const activity14d = await all<{ day: string; n: number }>(
    `SELECT substr(e.at, 1, 10) AS day, COUNT(*) n FROM task_events e
       JOIN tasks t ON t.id = e.task_id JOIN columns c ON c.id = t.column_id
      WHERE c.project_id = ? AND e.at >= to_char(now() - interval '13 days', 'YYYY-MM-DD')
      GROUP BY day ORDER BY day`,
    projectId,
  );
  const total = byColumn.reduce((s, c) => s + c.n, 0);
  return { byColumn, byPriority, byAssignee, activity14d, total };
}

export type CanvasMeta = { id: string; name: string; updated_at: string };

/** Sheet tabs. The snapshot blob is fetched separately so the board payload stays small. */
export const listCanvases = (projectId: string) =>
  all<CanvasMeta>(
    "SELECT id, name, updated_at FROM canvases WHERE project_id = ? ORDER BY position, updated_at",
    projectId,
  );

// ── Presence & chat ─────────────────────────────────────────────────────────

export type Presence = "online" | "away" | "offline";
export type MemberPresence = Member & { email: string; is_admin: number; lastSeen: string | null; presence: Presence };

/** Derived from the heartbeat the chat poll sends; no separate presence store. */
function presenceOf(lastSeen: string | null): Presence {
  if (!lastSeen) return "offline";
  const mins = (Date.now() - new Date(lastSeen).getTime()) / 60000;
  return mins < 2 ? "online" : mins < 15 ? "away" : "offline";
}

export const listMembersWithPresence = async (workspaceId: string): Promise<MemberPresence[]> =>
  (await all<Member & { email: string; is_admin: number; last_seen_at: string | null }>(
    "SELECT id, name, color, email, is_admin, last_seen_at FROM users WHERE workspace_id = ? ORDER BY created_at",
    workspaceId,
  )).map((u) => ({ ...u, lastSeen: u.last_seen_at, presence: presenceOf(u.last_seen_at) }));

export type Attachment = { id: string; name: string; mime: string; size: number };

export type ChatMessage = {
  id: number;
  body: string;
  created_at: string;
  edited_at: string | null;
  author_id: string;
  author_name: string;
  author_color: string;
  attachments: Attachment[];
};

/** Canonical channel key for the read cursor: the workspace channel or a peer id. */
export const channelKey = (withUser: string | null) => withUser ?? "all";

/** `withUser` null means the workspace channel; otherwise the DM thread with that person. */
export async function conversation(workspaceId: string, meId: string, withUser: string | null, afterId = 0): Promise<ChatMessage[]> {
  const base = `SELECT m.id, m.body, m.created_at, m.edited_at, m.author_id,
                       u.name AS author_name, u.color AS author_color
                  FROM messages m JOIN users u ON u.id = m.author_id
                 WHERE m.workspace_id = ? AND m.id > ? AND `;
  const rows =
    withUser === null
      ? await all<Omit<ChatMessage, "attachments">>(`${base} m.recipient_id IS NULL ORDER BY m.id LIMIT 200`, workspaceId, afterId)
      : await all<Omit<ChatMessage, "attachments">>(
          `${base} ((m.author_id = ? AND m.recipient_id = ?) OR (m.author_id = ? AND m.recipient_id = ?))
            ORDER BY m.id LIMIT 200`,
          workspaceId, afterId, meId, withUser, withUser, meId,
        );
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const files = await all<Attachment & { message_id: number }>(
    `SELECT id, message_id, name, mime, size FROM attachments
      WHERE message_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at, id`,
    ...ids,
  );
  return rows.map((r) => ({ ...r, attachments: files.filter((f) => f.message_id === r.id) }));
}

/** Highest message id in a conversation — the value the read cursor moves to. */
export async function latestId(workspaceId: string, meId: string, withUser: string | null) {
  const row =
    withUser === null
      ? await get<{ id: number }>("SELECT MAX(id) id FROM messages WHERE workspace_id = ? AND recipient_id IS NULL", workspaceId)
      : await get<{ id: number }>(
          `SELECT MAX(id) id FROM messages
            WHERE (author_id = ? AND recipient_id = ?) OR (author_id = ? AND recipient_id = ?)`,
          meId, withUser, withUser, meId,
        );
  return row?.id ?? 0;
}

export type Unread = { channel: string; n: number };

/**
 * Unread per conversation for one user. Own messages never count, and a
 * conversation with no read cursor yet counts everything in it.
 */
export async function unreadCounts(workspaceId: string, meId: string): Promise<Unread[]> {
  const cursors = new Map(
    (await all<{ channel: string; last_read_id: number }>(
      "SELECT channel, last_read_id FROM message_reads WHERE user_id = ?",
      meId,
    )).map((r) => [r.channel, r.last_read_id]),
  );

  const channel = (await all<{ n: number }>(
    "SELECT COUNT(*) n FROM messages WHERE workspace_id = ? AND recipient_id IS NULL AND author_id != ? AND id > ?",
    workspaceId, meId, cursors.get("all") ?? 0,
  ))[0]!.n;

  const dms = await all<{ channel: string; id: number }>(
    "SELECT author_id AS channel, id FROM messages WHERE recipient_id = ?",
    meId,
  );

  const out: Unread[] = channel > 0 ? [{ channel: "all", n: channel }] : [];
  for (const [peer, rows] of Map.groupBy(dms, (d) => d.channel)) {
    const n = rows.filter((r) => r.id > (cursors.get(peer) ?? 0)).length;
    if (n > 0) out.push({ channel: peer, n });
  }
  return out;
}

export async function markRead(workspaceId: string, meId: string, withUser: string | null) {
  const upTo = await latestId(workspaceId, meId, withUser);
  if (upTo === 0) return;
  await run(
    `INSERT INTO message_reads (user_id, channel, last_read_id) VALUES (?,?,?)
     ON CONFLICT (user_id, channel) DO UPDATE SET last_read_id = GREATEST(message_reads.last_read_id, excluded.last_read_id)`,
    meId, channelKey(withUser), upTo,
  );
}

export async function markAllMessagesRead(workspaceId: string, meId: string) {
  const rows = await all<{ channel: string; id: number }>(
    `SELECT 'all' channel, COALESCE(MAX(id), 0) id FROM messages WHERE workspace_id = ? AND recipient_id IS NULL
     UNION ALL
     SELECT author_id channel, MAX(id) id FROM messages WHERE recipient_id = ? GROUP BY author_id`,
    workspaceId, meId,
  );
  for (const row of rows) {
    if (row.id === 0) continue;
    await run(
      `INSERT INTO message_reads (user_id, channel, last_read_id) VALUES (?,?,?)
       ON CONFLICT (user_id, channel) DO UPDATE SET last_read_id = GREATEST(message_reads.last_read_id, excluded.last_read_id)`,
      meId, row.channel, row.id,
    );
  }
}
