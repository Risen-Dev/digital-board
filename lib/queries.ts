import "server-only";
import { all, get, run } from "./db";
import type { Blocker, CheckItem, Column, CustomField, Entry, Member, Priority, Repeat, SavedView, Sprint, Task, TaskImage } from "./board";
import { day, stamp } from "./format";
import type { Meeting } from "./meetings";

type TaskRow = {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  label: string | null;
  priority: Priority;
  due_date: string | null;
  start_date: string | null;
  sprint_id: string | null;
  task_key: string | null;
  assignees: Member[];
  checklist: CheckItem[];
  repeat: Repeat | null;
  comments: number;
  images: TaskImage[];
  blocked_by: Blocker[];
  parent_id: string | null;
  subtasks: Blocker[];
  column_since: string;
  tracked: number;
  timing: boolean;
  fields: Record<string, string>;
};

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  columnId: r.column_id,
  title: r.title,
  description: r.description,
  label: r.label,
  priority: r.priority,
  dueDate: r.due_date,
  startDate: r.start_date,
  sprintId: r.sprint_id,
  key: r.task_key,
  assignees: r.assignees,
  checklist: r.checklist,
  repeat: r.repeat,
  comments: r.comments,
  images: r.images,
  blockedBy: r.blocked_by,
  parentId: r.parent_id,
  subtasks: r.subtasks,
  stageDays: Math.floor((Date.now() - Date.parse(r.column_since)) / 86_400_000),
  trackedSeconds: r.tracked,
  timing: r.timing,
  fields: r.fields,
});

/** The project's done column for `p` (projects): the chosen one, else its last column. */
export const DONE_COLUMN = `COALESCE(p.done_column_id, (SELECT dc.id FROM columns dc WHERE dc.project_id = p.id ORDER BY dc.position DESC LIMIT 1))`;

/** Card columns shared by the board and My Tasks; `t`, `p` are tasks and projects. */
const TASK_COLS = `t.id, t.column_id, t.title, t.description, t.label, t.priority, t.due_date, t.start_date, t.sprint_id, t.checklist, t.repeat, t.fields,
            COALESCE(t.column_since, t.created_at) AS column_since,
            (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM COALESCE(te.ended_at, now()::text)::timestamptz - te.started_at::timestamptz)), 0)::int
               FROM time_entries te WHERE te.task_id = t.id) AS tracked,
            EXISTS (SELECT 1 FROM time_entries te WHERE te.task_id = t.id AND te.ended_at IS NULL) AS timing,
            p.key || '-' || t.number AS task_key,
            COALESCE((SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'color', u.color) ORDER BY u.name)
                        FROM task_assignees ta JOIN users u ON u.id = ta.user_id WHERE ta.task_id = t.id), '[]') AS assignees,
            (SELECT COUNT(*) FROM task_events e WHERE e.task_id = t.id AND e.kind = 'comment') AS comments,
            COALESCE((SELECT json_agg(json_build_object('id', ti.id, 'name', ti.name) ORDER BY ti.cover DESC, ti.created_at, ti.id)
                        FROM task_images ti WHERE ti.task_id = t.id), '[]') AS images,
            COALESCE((SELECT json_agg(json_build_object('id', bt.id, 'done', bt.column_id = ${DONE_COLUMN}) ORDER BY bt.number)
                        FROM task_blockers tb JOIN tasks bt ON bt.id = tb.blocker_id
                       WHERE tb.task_id = t.id AND bt.archived_at IS NULL), '[]') AS blocked_by,
            t.parent_id,
            COALESCE((SELECT json_agg(json_build_object('id', st.id, 'done', st.column_id = ${DONE_COLUMN}) ORDER BY st.number)
                        FROM tasks st WHERE st.parent_id = t.id AND st.archived_at IS NULL), '[]') AS subtasks`;

/** `repo` / `tokenHint` describe the GitHub link; the token itself never leaves the server. */
export type Project = { id: string; name: string; key: string; doneColumnId: string | null; repo: string | null; tokenHint: string | null; webhookHint: string | null; inbound: boolean;
  outgoing: { url: string; events: string[]; last?: { status: number | string; event: string; at: string } } | null };
const PROJECT_COLS = `p.id, p.name, p.key, p.done_column_id AS "doneColumnId", p.github::jsonb ->> 'repo' AS repo, right(p.github::jsonb ->> 'token', 4) AS "tokenHint",
  right(p.github::jsonb ->> 'webhookSecret', 4) AS "webhookHint", p.inbound_token IS NOT NULL AS inbound,
  p.outgoing - 'secret' AS outgoing`;

export const workspaceName = async (workspaceId: string) =>
  (await get<{ name: string }>("SELECT name FROM workspaces WHERE id = ?", workspaceId))?.name ?? "Workspace";

export const listProjects = (workspaceId: string, userId: string, isAdmin: boolean) =>
  isAdmin
    ? all<Project>(`SELECT ${PROJECT_COLS} FROM projects p WHERE p.workspace_id = ? ORDER BY p.position, p.created_at`, workspaceId)
    : all<Project>(
        `SELECT ${PROJECT_COLS} FROM projects p JOIN project_members pm ON pm.project_id = p.id
         WHERE p.workspace_id = ? AND pm.user_id = ? ORDER BY p.position, p.created_at`,
        workspaceId, userId,
      );

export const listMembers = (workspaceId: string) =>
  all<Member>("SELECT id, name, color FROM users WHERE workspace_id = ? ORDER BY created_at", workspaceId);

/** Every meeting in the workspace; members see all of them, attendees get the reminders. */
export const listMeetings = (workspaceId: string) =>
  all<Meeting>(
    `SELECT m.id, m.title, m.notes, m.link, m.start_date AS "startDate", m.start_time AS "startTime",
            m.duration_min AS "durationMin", m.repeat, m.remind_min AS "remindMin", m.created_by AS "createdBy",
            COALESCE((SELECT json_agg(a.user_id) FROM meeting_attendees a WHERE a.meeting_id = m.id), '[]') AS "attendeeIds"
       FROM meetings m WHERE m.workspace_id = ? ORDER BY m.start_time, m.title`,
    workspaceId,
  );

export type ProjectMember = { user_id: string; project_id: string; role: "admin" | "editor" | "viewer" };
export const projectMembers = (workspaceId: string) =>
  all<ProjectMember>(
    `SELECT pm.user_id, pm.project_id, pm.role FROM project_members pm
       JOIN projects p ON p.id = pm.project_id WHERE p.workspace_id = ?`,
    workspaceId,
  );

export async function getBoard(projectId: string): Promise<Column[]> {
  const columns = await all<{ id: string; title: string; color: string; limitDays: number | null }>(
    `SELECT id, title, color, stage_limit_days AS "limitDays" FROM columns WHERE project_id = ? ORDER BY position`,
    projectId,
  );
  const rows = await all<TaskRow>(
    `SELECT ${TASK_COLS}
       FROM tasks t
       JOIN columns c ON c.id = t.column_id
       JOIN projects p ON p.id = c.project_id
      WHERE c.project_id = ? AND t.archived_at IS NULL
      ORDER BY t.position`,
    projectId,
  );
  return columns.map((c) => ({ ...c, tasks: rows.filter((r) => r.column_id === c.id).map(toTask) }));
}

/** Archived cards of a project, newest first, for the restore list. */
export const archivedTasks = async (projectId: string) =>
  (await all<TaskRow>(
    `SELECT ${TASK_COLS}
       FROM tasks t JOIN columns c ON c.id = t.column_id JOIN projects p ON p.id = c.project_id
      WHERE c.project_id = ? AND t.archived_at IS NOT NULL
      ORDER BY t.archived_at DESC`,
    projectId,
  )).map(toTask);

export const taskHistory = async (taskId: string): Promise<Entry[]> =>
  (await all<Omit<Entry, "atLabel">>(
    `SELECT e.at, e.text, e.kind, e.agent, CASE WHEN e.agent THEN 'AI agent' ELSE u.name END AS actor
       FROM task_events e LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.task_id = ? ORDER BY e.id DESC`,
    taskId,
  )).map((e) => ({ ...e, atLabel: stamp(e.at) }));

/** `actorId`: the member who did it; null for webhooks and the AI agent. */
export type FeedItem = Entry & { id: number; actorId: string | null; taskId: string; taskTitle: string; columnTitle: string; columnColor: string; dayLabel: string };
type FeedRow = Omit<FeedItem, "atLabel" | "dayLabel">;

/** Workspace admins see every project; members only the projects they are assigned to. */
const FEED_FROM = `SELECT e.id, e.at, e.kind, CASE e.kind WHEN 'comment' THEN 'Commented: ' || e.text ELSE e.text END AS text, CASE WHEN e.agent THEN 'AI agent' ELSE u.name END AS actor,
            CASE WHEN e.agent THEN NULL ELSE e.actor_id END AS "actorId", t.id AS "taskId", t.title AS "taskTitle",
            c.title AS "columnTitle", c.color AS "columnColor"
       FROM task_events e
       JOIN tasks t ON t.id = e.task_id
       JOIN columns c ON c.id = t.column_id
       JOIN projects p ON p.id = c.project_id
       LEFT JOIN users u ON u.id = e.actor_id
      WHERE p.workspace_id = ? AND (? = 1 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?))`;

const toFeed = (rows: FeedRow[]): FeedItem[] => rows.map((e) => ({ ...e, atLabel: stamp(e.at), dayLabel: day(e.at) }));

export const activityFeed = async (workspaceId: string, userId: string, isAdmin: number, limit = 100) =>
  toFeed(await all<FeedRow>(`${FEED_FROM} ORDER BY e.id DESC LIMIT ?`, workspaceId, isAdmin, userId, limit));

export const activityNotifications = async (workspaceId: string, userId: string, isAdmin: number, limit = 5) => {
  const read = (await get<{ last_activity_read_id: number }>(
    "SELECT last_activity_read_id FROM users WHERE id = ?",
    userId,
  ))?.last_activity_read_id ?? 0;
  return toFeed(await all<FeedRow>(
    `${FEED_FROM} AND e.id > ?
        AND NOT EXISTS (SELECT 1 FROM activity_reads ar WHERE ar.user_id = ? AND ar.event_id = e.id)
      ORDER BY e.id DESC LIMIT ?`,
    workspaceId, isAdmin, userId, read, userId, limit,
  ));
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
  (await all<TaskRow & { column_title: string; column_color: string; project_name: string; done: boolean }>(
    `SELECT ${TASK_COLS},
            c.title AS column_title, c.color AS column_color, p.name AS project_name, c.id = ${DONE_COLUMN} AS done
       FROM tasks t
       JOIN columns c ON c.id = t.column_id
       JOIN projects p ON p.id = c.project_id
      WHERE t.archived_at IS NULL AND EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?)
      ORDER BY t.due_date IS NULL, t.due_date, t.position`,
    userId,
  )).map((r) => ({ ...toTask(r), columnTitle: r.column_title, columnColor: r.column_color, projectName: r.project_name, done: r.done }));

export async function analytics(projectId: string) {
  const byColumn = await all<{ title: string; color: string; n: number }>(
    `SELECT c.title, c.color, COUNT(t.id) n
       FROM columns c LEFT JOIN tasks t ON t.column_id = c.id AND t.archived_at IS NULL
      WHERE c.project_id = ? GROUP BY c.id ORDER BY c.position`,
    projectId,
  );
  const byPriority = await all<{ priority: Priority; n: number }>(
    `SELECT t.priority, COUNT(*) n FROM tasks t JOIN columns c ON c.id = t.column_id
      WHERE c.project_id = ? AND t.archived_at IS NULL GROUP BY t.priority`,
    projectId,
  );
  const byAssignee = await all<{ name: string | null; color: string | null; n: number }>(
    // A card with two assignees counts once for each.
    `SELECT u.name, u.color, COUNT(*) n FROM tasks t
       JOIN columns c ON c.id = t.column_id
       LEFT JOIN task_assignees ta ON ta.task_id = t.id LEFT JOIN users u ON u.id = ta.user_id
      WHERE c.project_id = ? AND t.archived_at IS NULL GROUP BY u.id, u.name, u.color ORDER BY n DESC`,
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
  const done = (await get<{ n: number }>(
    `SELECT COUNT(t.id) n FROM projects p JOIN tasks t ON t.column_id = ${DONE_COLUMN} AND t.archived_at IS NULL WHERE p.id = ?`,
    projectId,
  ))!.n;
  return { byColumn, byPriority, byAssignee, activity14d, total, done };
}

/** The project's custom fields, in order. */
export const listFields = (projectId: string) =>
  all<CustomField>("SELECT id, name, type, options FROM custom_fields WHERE project_id = ? ORDER BY position, id", projectId);

/** The project's sprints: open ones first, each by start date. */
export const listSprints = (projectId: string) =>
  all<Sprint>(
    `SELECT s.id, s.name, s.start_date AS "startDate", s.end_date AS "endDate", s.closed_at IS NOT NULL AS closed,
            (SELECT COUNT(*)::int FROM tasks t WHERE t.sprint_id = s.id AND t.archived_at IS NULL) AS total,
            (SELECT COUNT(*)::int FROM tasks t WHERE t.sprint_id = s.id AND t.archived_at IS NULL AND t.column_id = ${DONE_COLUMN}) AS done
       FROM sprints s JOIN projects p ON p.id = s.project_id
      WHERE s.project_id = ?
      ORDER BY s.closed_at IS NOT NULL, s.start_date, s.created_at`,
    projectId,
  );

/** The project's saved views, oldest first. */
export const listViews = (projectId: string) =>
  all<SavedView>("SELECT id, name, filters, layout FROM saved_views WHERE project_id = ? ORDER BY created_at, id", projectId);

export type CanvasMeta = { id: string; name: string; updated_at: string };

/** Sheet tabs. The snapshot blob is fetched separately so the board payload stays small. */
export const listCanvases = (projectId: string) =>
  all<CanvasMeta>(
    "SELECT id, name, updated_at FROM canvases WHERE project_id = ? ORDER BY position, updated_at",
    projectId,
  );

export type CanvasTag = { tag: string; sheetId: string; projectId: string; project: string };

/**
 * Named groups of canvas shapes (`customData.tag`, set by the canvas "Tag" button),
 * which cards and chat mention as @tag.
 * ponytail: parses every snapshot per page load; store tags in a column if sheets get heavy.
 */
export const listCanvasTags = (projectIds: string[]) =>
  all<CanvasTag>(
    `SELECT DISTINCT tag, c.id AS "sheetId", p.id AS "projectId", p.name AS project
     FROM canvases c JOIN projects p ON p.id = c.project_id,
       jsonb_array_elements_text(COALESCE(c.tags, '[]'::jsonb)) tag
     WHERE c.project_id = ANY(?)
     ORDER BY tag`,
    projectIds,
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
  /** Written by the AI agent on behalf of `author_id`, who called it. */
  agent: boolean;
  attachments: Attachment[];
};

/** Canonical channel key for the read cursor: the workspace channel or a peer id. */
const channelKey = (withUser: string | null) => withUser ?? "all";

/** `withUser` null means the workspace channel; otherwise the DM thread with that person. */
export async function conversation(workspaceId: string, meId: string, withUser: string | null, afterId = 0): Promise<ChatMessage[]> {
  const base = `SELECT m.id, m.body, m.created_at, m.edited_at, m.author_id, m.agent,
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
async function latestId(workspaceId: string, meId: string, withUser: string | null) {
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

export type SearchCard = { id: string; title: string; key: string | null; projectId: string; projectName: string; columnTitle: string };
export type SearchMessage = { id: number; body: string; channel: string; author: string; atLabel: string };

/**
 * Cmd+K search over cards (title, description or key like "RIS-12") in the projects
 * this user can open, and messages in the channel or their own DMs. Projects and
 * meetings are already on the client, so the palette filters those itself.
 */
// ponytail: ILIKE scans; add a pg_trgm GIN index on tasks.title/messages.body if it gets slow.
export async function searchWorkspace(workspaceId: string, meId: string, isAdmin: number, q: string) {
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const cards = await all<SearchCard>(
    `SELECT t.id, t.title, p.key || '-' || t.number AS key, p.id AS "projectId", p.name AS "projectName", c.title AS "columnTitle"
       FROM tasks t JOIN columns c ON c.id = t.column_id JOIN projects p ON p.id = c.project_id
      WHERE p.workspace_id = ? AND t.archived_at IS NULL
        AND (? = 1 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?))
        AND (t.title ILIKE ? OR t.description ILIKE ? OR p.key || '-' || t.number ILIKE ?)
      ORDER BY t.created_at DESC LIMIT 8`,
    workspaceId, isAdmin, meId, like, like, like,
  );
  const messages = (await all<Omit<SearchMessage, "atLabel"> & { created_at: string }>(
    `SELECT m.id, m.body, m.created_at, CASE WHEN m.agent THEN 'AI agent' ELSE u.name END AS author,
            CASE WHEN m.recipient_id IS NULL THEN 'all' WHEN m.author_id = ? THEN m.recipient_id ELSE m.author_id END AS channel
       FROM messages m JOIN users u ON u.id = m.author_id
      WHERE m.workspace_id = ? AND (m.recipient_id IS NULL OR m.recipient_id = ? OR m.author_id = ?) AND m.body ILIKE ?
      ORDER BY m.id DESC LIMIT 8`,
    meId, workspaceId, meId, meId, like,
  )).map(({ created_at, ...m }) => ({ ...m, atLabel: stamp(created_at) }));
  return { cards, messages };
}
