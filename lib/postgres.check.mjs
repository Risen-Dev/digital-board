/**
 * Runs every SQL statement the app uses against a real Postgres, with
 * representative data, and asserts the results. Catches dialect breakage that
 * a type-check cannot see.
 *
 *   DATABASE_URL=postgres://... node lib/postgres.check.mjs
 *
 * Creates its own schema in the target database and deletes what it inserted,
 * so point it at a scratch database, not production.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

pg.types.setTypeParser(20, Number); // int8 -> number, same as lib/db.ts

const q = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const all = async (sql, ...a) => (await client.query(q(sql), a)).rows;
const get = async (sql, ...a) => (await client.query(q(sql), a)).rows[0];
const run = async (sql, ...a) => { await client.query(q(sql), a); };

await client.query(readFileSync(join(process.cwd(), "lib", "schema.sql"), "utf8"));

const now = new Date().toISOString();
const today = now.slice(0, 10);
const ada = randomUUID(), bob = randomUUID(), proj = randomUUID();
const c1 = randomUUID(), c2 = randomUUID(), t1 = randomUUID(), t2 = randomUUID();

try {
  await client.query("BEGIN");

  await run("INSERT INTO users (id,email,name,password_hash,color,is_admin,created_at) VALUES (?,?,?,?,?,?,?)",
    ada, `ada-${ada}@e`, "Ada", "h", "var(--chart-1)", 1, now);
  await run("INSERT INTO users (id,email,name,password_hash,color,is_admin,created_at) VALUES (?,?,?,?,?,?,?)",
    bob, `bob-${bob}@e`, "Bob", "h", "var(--chart-2)", 0, now);
  await run("UPDATE users SET last_activity_read_id = (SELECT COALESCE(MAX(id), 0) FROM task_events) WHERE id = ?", ada);
  await run("INSERT INTO projects (id,name,position,created_at) VALUES (?,?,0,?)", proj, "P", now);
  await run("INSERT INTO columns (id,project_id,title,color,position) VALUES (?,?,?,?,0)", c1, proj, "Backlog", "var(--chart-1)");
  await run("INSERT INTO columns (id,project_id,title,color,position) VALUES (?,?,?,?,1)", c2, proj, "Done", "var(--chart-2)");
  await run("INSERT INTO tasks (id,column_id,title,description,label,priority,assignee_id,due_date,position,created_at) VALUES (?,?,?,?,?,?,?,?,0,?)",
    t1, c1, "Task one", "Task detail", "QA", "high", ada, today, now);
  await run("INSERT INTO tasks (id,column_id,title,description,label,priority,assignee_id,due_date,position,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)",
    t2, c1, "Task two", null, null, "low", null, null, now);
  await run("INSERT INTO task_events (task_id,actor_id,text,at) VALUES (?,?,?,?)", t1, ada, "Task created", now);
  await run("INSERT INTO task_events (task_id, actor_id, text, at) VALUES (?,?,?,?)", t1, bob, "Task updated", now);

  // first-account check / auth
  assert.ok(await get("SELECT 1 FROM users LIMIT 1"), "first account");
  const userCount = (await get("SELECT COUNT(*) n FROM users")).n;
  // The point is the int8 type parser, not the absolute number — this check is
  // expected to run against a database that may already hold real rows.
  assert.equal(typeof userCount, "number", "COUNT comes back as a number, not a string");
  assert.ok(userCount >= 2, "the two seeded accounts are visible");

  // getBoard
  const cols = await all("SELECT id, title, color FROM columns WHERE project_id = ? ORDER BY position", proj);
  assert.deepEqual(cols.map((c) => c.title), ["Backlog", "Done"]);
  const board = await all(
    `SELECT t.id, t.column_id, t.title, t.description, t.label, t.priority, t.due_date,
            u.id AS assignee_id, u.name AS assignee_name, u.color AS assignee_color
       FROM tasks t JOIN columns c ON c.id = t.column_id
       LEFT JOIN users u ON u.id = t.assignee_id
      WHERE c.project_id = ? ORDER BY t.position`, proj);
  assert.equal(board.length, 2);
  assert.equal(board[0].assignee_name, "Ada");
  assert.equal(board[0].description, "Task detail", "task details load with the board");
  assert.equal(board[1].assignee_name, null, "LEFT JOIN keeps unassigned tasks");

  // myTasks — nulls-last ordering
  const mine = await all(
    `SELECT t.id, t.due_date FROM tasks t
       JOIN columns c ON c.id = t.column_id JOIN projects p ON p.id = c.project_id
       LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.assignee_id = ? ORDER BY t.due_date IS NULL, t.due_date, t.position`, ada);
  assert.equal(mine.length, 1);
  const mineLabels = await get(
    `SELECT c.title AS column_title, c.color AS column_color, p.name AS project_name FROM tasks t
       JOIN columns c ON c.id = t.column_id JOIN projects p ON p.id = c.project_id WHERE t.assignee_id = ?`, ada);
  assert.deepEqual(mineLabels, { column_title: "Backlog", column_color: "var(--chart-1)", project_name: "P" }, "My Tasks gets its project/column labels");

  // activity feed — members only see projects they are assigned to (lib/queries.ts VISIBLE_PROJECT)
  const feedFor = (userId, isAdmin) => all(
    `SELECT e.id FROM task_events e JOIN tasks t ON t.id = e.task_id JOIN columns c ON c.id = t.column_id
       JOIN projects p ON p.id = c.project_id
      WHERE p.id = ? AND (? = 1 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?))`,
    proj, isAdmin, userId);
  assert.equal((await feedFor(bob, 0)).length, 0, "unassigned member sees no activity");
  assert.equal((await feedFor(ada, 1)).length, 2, "workspace admin sees all activity");
  await run("INSERT INTO project_members (project_id, user_id, role) VALUES (?,?,?)", proj, bob, "viewer");
  assert.equal((await feedFor(bob, 0)).length, 2, "assigned member sees the project's activity");

  // analytics — the four riskiest statements
  const byColumn = await all(
    `SELECT c.title, c.color, COUNT(t.id) n FROM columns c LEFT JOIN tasks t ON t.column_id = c.id
      WHERE c.project_id = ? GROUP BY c.id ORDER BY c.position`, proj);
  assert.deepEqual(byColumn.map((r) => r.n), [2, 0], "GROUP BY primary key with extra selected columns");
  const byPriority = await all(
    `SELECT t.priority, COUNT(*) n FROM tasks t JOIN columns c ON c.id = t.column_id
      WHERE c.project_id = ? GROUP BY t.priority`, proj);
  assert.equal(byPriority.length, 2);
  const byAssignee = await all(
    `SELECT u.name, u.color, COUNT(*) n FROM tasks t
       JOIN columns c ON c.id = t.column_id LEFT JOIN users u ON u.id = t.assignee_id
      WHERE c.project_id = ? GROUP BY t.assignee_id, u.name, u.color ORDER BY n DESC`, proj);
  assert.equal(byAssignee.length, 2, "grouping by assignee needs the joined columns listed too");
  const activity = await all(
    `SELECT substr(e.at, 1, 10) AS day, COUNT(*) n FROM task_events e
       JOIN tasks t ON t.id = e.task_id JOIN columns c ON c.id = t.column_id
      WHERE c.project_id = ? AND e.at >= to_char(now() - interval '13 days', 'YYYY-MM-DD')
      GROUP BY day ORDER BY day`, proj);
  assert.equal(activity.length, 1, "interval window");

  const notifications = await all(
    `SELECT e.id FROM task_events e WHERE e.id > (SELECT last_activity_read_id FROM users WHERE id = ?)
      AND e.actor_id IS DISTINCT FROM ? ORDER BY e.id DESC LIMIT ?`,
    ada, ada, 5,
  );
  assert.equal(notifications.length, 1, "activity notifications exclude the current user");
  await run("UPDATE users SET last_activity_read_id = GREATEST(last_activity_read_id, ?) WHERE id = ?", notifications[0].id, ada);
  assert.equal((await all(
    `SELECT e.id FROM task_events e WHERE e.id > (SELECT last_activity_read_id FROM users WHERE id = ?)
      AND e.actor_id IS DISTINCT FROM ?`,
    ada, ada,
  )).length, 0, "reading activity clears the notification list");

  // Baseline, so the assertions below hold against a database that already
  // contains real rows — this check is meant to be runnable on your own server.
  const unreadBefore = (await get(
    "SELECT COUNT(*) n FROM messages WHERE recipient_id IS NULL AND author_id != ? AND id > ?", ada, 0)).n;

  // chat: RETURNING replaces lastInsertRowid
  const m1 = await get("INSERT INTO messages (author_id,recipient_id,body,created_at) VALUES (?,?,?,?) RETURNING id",
    bob, null, "hello room", now);
  assert.equal(typeof m1.id, "number", "identity id comes back as a number");
  const m2 = await get("INSERT INTO messages (author_id,recipient_id,body,created_at) VALUES (?,?,?,?) RETURNING id",
    bob, ada, "dm for ada", now);

  const att = randomUUID();
  const bytes = Buffer.from("attachment bytes");
  await run("INSERT INTO attachments (id,message_id,name,mime,size,data,created_at) VALUES (?,?,?,?,?,?,?)",
    att, m2.id, "f.png", "image/png", bytes.length, bytes, now);
  const files = await all(
    `SELECT id, message_id, name, mime, size, data FROM attachments WHERE message_id IN (?,?) ORDER BY created_at, id`,
    m1.id, m2.id);
  assert.equal(files.length, 1, "IN (...) list and rowid-free ordering");
  assert.deepEqual(files[0].data, bytes, "attachment bytes round-trip through Postgres");

  // DM isolation
  const dm = await all(
    `SELECT m.id FROM messages m JOIN users u ON u.id = m.author_id
      WHERE m.id > ? AND ((m.author_id = ? AND m.recipient_id = ?) OR (m.author_id = ? AND m.recipient_id = ?))
      ORDER BY m.id LIMIT 200`, 0, ada, bob, bob, ada);
  assert.deepEqual(dm.map((r) => r.id), [m2.id], "DM query returns only that pair");

  // unread + the upsert cursor
  const unreadAfter = (await get(
    "SELECT COUNT(*) n FROM messages WHERE recipient_id IS NULL AND author_id != ? AND id > ?", ada, 0)).n;
  assert.equal(unreadAfter - unreadBefore, 1, "one new channel message counts as unread for the other person");
  const upsert = `INSERT INTO message_reads (user_id, channel, last_read_id) VALUES (?,?,?)
     ON CONFLICT (user_id, channel) DO UPDATE SET last_read_id = GREATEST(message_reads.last_read_id, excluded.last_read_id)`;
  await run(upsert, ada, "all", m1.id);
  await run(upsert, ada, "all", 1);
  assert.equal((await get("SELECT last_read_id FROM message_reads WHERE user_id = ? AND channel = ?", ada, "all")).last_read_id,
    m1.id, "GREATEST keeps the cursor from moving backwards");

  // position bookkeeping
  assert.equal((await get("SELECT COALESCE(MAX(position) + 1, 0) n FROM tasks WHERE column_id = ?", c1)).n, 2);
  assert.equal((await get("SELECT COALESCE(MAX(position) + 1, 0) n FROM columns WHERE project_id = ?", proj)).n, 2);

  // cascade
  await run("DELETE FROM columns WHERE id = ?", c1);
  assert.equal((await get("SELECT COUNT(*) n FROM tasks WHERE id = ?", t1)).n, 0, "tasks cascade");
  assert.equal((await get("SELECT COUNT(*) n FROM task_events WHERE task_id = ?", t1)).n, 0, "events cascade");
  await run("DELETE FROM users WHERE id = ?", bob);
  assert.equal((await get("SELECT COUNT(*) n FROM messages WHERE id = ?", m2.id)).n, 0, "DM goes with its author");

  // canvas save: merge under a row lock (app/api/canvas/[id]/route.ts)
  const sheet = randomUUID();
  await run("INSERT INTO canvases (id,project_id,name,position,snapshot,updated_at) VALUES (?,?,?,0,?,?)", sheet, proj, "S", null, now);
  assert.equal((await get("SELECT snapshot FROM canvases WHERE id = ? FOR UPDATE", sheet)).snapshot, null, "row lock read");
  await run("UPDATE canvases SET snapshot = ?, updated_at = ? WHERE id = ?", '{"elements":[]}', now, sheet);
  assert.equal((await get("SELECT NULL AS snapshot, project_id FROM canvases WHERE id = ?", sheet)).project_id, proj, "live-stream lookup");

  // template example sheet: the seed claim hands the flow to exactly one caller (app/api/canvas/[id]/seed)
  const claim = `UPDATE canvases c SET snapshot = (c.snapshot::jsonb - 'seed')::text
       FROM (SELECT id, snapshot::jsonb -> 'seed' AS seed FROM canvases WHERE id = ? FOR UPDATE) old
      WHERE c.id = old.id AND old.seed IS NOT NULL
      RETURNING old.seed::text AS seed`;
  await run("UPDATE canvases SET snapshot = ? WHERE id = ?", '{"elements":[],"seed":{"by":"T"}}', sheet);
  assert.equal(JSON.parse((await get(claim, sheet)).seed).by, "T", "first claim gets the seed");
  assert.equal(await get(claim, sheet), undefined, "second claim gets nothing");
  assert.equal((await get("SELECT snapshot FROM canvases WHERE id = ?", sheet)).snapshot, '{"elements": []}', "seed removed, scene kept");

  // task keys: schema backfill numbered the seeded tasks 1..n; the next create takes max+1 under the project lock
  await run("UPDATE projects SET key = 'P' WHERE id = ?", proj);
  await get("SELECT id FROM projects WHERE id = ? FOR UPDATE", proj);
  const nextNo = (await get(`SELECT COALESCE(MAX(t.number), 0) + 1 n FROM tasks t JOIN columns c ON c.id = t.column_id WHERE c.project_id = ?`, proj)).n;
  assert.equal(typeof nextNo, "number", "next task number is a number");
  // Own column and tasks: earlier steps of this check delete the seeded ones.
  const k1 = randomUUID(), k2 = randomUUID(), kc = randomUUID();
  await run("INSERT INTO columns (id,project_id,title,color,position) VALUES (?,?,?,?,9)", kc, proj, "Keys", "var(--chart-1)");
  for (const [i, id] of [k1, k2].entries()) {
    await run("INSERT INTO tasks (id,column_id,title,priority,position,created_at) VALUES (?,?,?,?,?,?)", id, kc, `Key ${i}`, "low", i, now);
  }
  await client.query(readFileSync(join(process.cwd(), "lib", "schema.sql"), "utf8"));
  const keys = await all(`SELECT p.key || '-' || t.number AS task_key FROM tasks t JOIN columns c ON c.id = t.column_id
                           JOIN projects p ON p.id = c.project_id WHERE t.id IN (?, ?)`, k1, k2);
  assert.equal(new Set(keys.map((k) => k.task_key)).size, 2, "backfill gives each task its own number");
  assert.ok(keys.every((k) => /^P-\d+$/.test(k.task_key)), "keys look like P-1");

  // webhook links: upsert keeps CI only while the PR head sha is unchanged (lib/github-webhook.ts)
  const linkUpsert = `INSERT INTO task_links (task_id, kind, ext_id, title, url, ref, state, author, sha, ci, at)
           VALUES (?,?,?,?,?,?,?,?,?,NULL,?)
           ON CONFLICT (task_id, kind, ext_id) DO UPDATE SET
             title = excluded.title, url = excluded.url, ref = excluded.ref, state = excluded.state,
             author = COALESCE(excluded.author, task_links.author), at = COALESCE(excluded.at, task_links.at),
             ci = CASE WHEN task_links.sha = excluded.sha THEN task_links.ci END,
             sha = excluded.sha`;
  await run(linkUpsert, k1, "pulls", "9", "PR", "u", "#9", "open", "ada", "s1", now);
  await run("UPDATE task_links SET ci = ? WHERE kind = 'pulls' AND sha = ?", "failure", "s1");
  await run(linkUpsert, k1, "pulls", "9", "PR", "u", "#9", "merged", null, "s1", null);
  let link = await get("SELECT state, author, ci, at FROM task_links WHERE task_id = ? AND ext_id = '9'", k1);
  assert.deepEqual([link.state, link.author, link.ci, link.at], ["merged", "ada", "failure", now], "same sha keeps CI and author");
  await run(linkUpsert, k1, "pulls", "9", "PR", "u", "#9", "open", null, "s2", null);
  link = await get("SELECT ci FROM task_links WHERE task_id = ? AND ext_id = '9'", k1);
  assert.equal(link.ci, null, "a new head sha clears CI");

  // GitHub link: listProjects exposes repo + last 4 of the token, never the token
  await run("UPDATE projects SET github = ? WHERE id = ?", JSON.stringify({ repo: "o/r", token: "github_pat_abcd1234" }), proj);
  const linked = await get(`SELECT p.id, p.name, p.github::jsonb ->> 'repo' AS repo, right(p.github::jsonb ->> 'token', 4) AS "tokenHint" FROM projects p WHERE p.id = ?`, proj);
  assert.deepEqual([linked.repo, linked.tokenHint], ["o/r", "1234"], "repo and token hint");

  // Blockers: b2 waits on b1. The board's blocked_by follows t1 into the done column,
  // and the loop check (lib/actions.ts setBlocker) refuses b1 waiting on b2.
  // Own project: earlier sections already deleted the seeded columns.
  const bp = randomUUID(), bc1 = randomUUID(), bc2 = randomUUID(), b1 = randomUUID(), b2 = randomUUID();
  await run("INSERT INTO projects (id,name,position,created_at) VALUES (?,?,0,?)", bp, "Blockers", now);
  await run("INSERT INTO columns (id,project_id,title,color,position) VALUES (?,?,?,?,0)", bc1, bp, "To do", "var(--chart-1)");
  await run("INSERT INTO columns (id,project_id,title,color,position) VALUES (?,?,?,?,1)", bc2, bp, "Done", "var(--chart-2)");
  for (const [id, n] of [[b1, 1], [b2, 2]]) {
    await run("INSERT INTO tasks (id,column_id,title,priority,position,number,created_at) VALUES (?,?,?,?,?,?,?)", id, bc1, `Blocker ${n}`, "low", n, n, now);
  }
  const DONE = `COALESCE(p.done_column_id, (SELECT dc.id FROM columns dc WHERE dc.project_id = p.id ORDER BY dc.position DESC LIMIT 1))`;
  const blockedBy = async () => (await get(
    `SELECT COALESCE((SELECT json_agg(json_build_object('id', bt.id, 'done', bt.column_id = ${DONE}) ORDER BY bt.number)
                        FROM task_blockers tb JOIN tasks bt ON bt.id = tb.blocker_id
                       WHERE tb.task_id = t.id AND bt.archived_at IS NULL), '[]') AS blocked_by
       FROM tasks t JOIN columns c ON c.id = t.column_id JOIN projects p ON p.id = c.project_id WHERE t.id = ?`, b2)).blocked_by;
  await run("INSERT INTO task_blockers (task_id, blocker_id) VALUES (?,?)", b2, b1);
  assert.deepEqual(await blockedBy(), [{ id: b1, done: false }], "open blocker");
  await run("UPDATE tasks SET column_id = ? WHERE id = ?", bc2, b1);
  assert.deepEqual(await blockedBy(), [{ id: b1, done: true }], "blocker in the last column counts as done");
  const loop = `WITH RECURSIVE up(id) AS (
      SELECT blocker_id FROM task_blockers WHERE task_id = ?
      UNION SELECT tb.blocker_id FROM task_blockers tb JOIN up ON tb.task_id = up.id
    ) SELECT 1 FROM up WHERE id = ?`;
  assert.ok(await get(loop, b2, b1), "b1 waiting on b2 would close a loop");
  assert.equal(await get(loop, b1, b2), undefined, "b2 waiting on b1 is no loop");
  await run("DELETE FROM tasks WHERE id = ?", b1);
  assert.deepEqual(await blockedBy(), [], "deleting the blocker drops the edge");

  // Stage timer: schema.sql fills column_since from the last "Moved from" event, else created_at.
  const b3 = "pg-check-b3";
  await run("INSERT INTO tasks (id,column_id,title,priority,position,number,created_at) VALUES (?,?,?,?,?,?,?)", b3, bc1, "Never moved", "low", 9, 9, now);
  await run("INSERT INTO task_events (task_id, text, at) VALUES (?,?,?)", b2, "Moved from A to B", "2026-01-02T00:00:00.000Z");
  await run("UPDATE tasks SET column_since = NULL WHERE id = ?", b2);
  await client.query(readFileSync(join(process.cwd(), "lib", "schema.sql"), "utf8"));
  const since = async (id) => (await get("SELECT column_since FROM tasks WHERE id = ?", id)).column_since;
  assert.equal(await since(b2), "2026-01-02T00:00:00.000Z", "moved card: its last move");
  assert.equal(await since(b3), now, "never-moved card: created_at");

  // Time tracking: a finished hour plus a running timer started 10 minutes ago.
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  await run("INSERT INTO time_entries (task_id, user_id, started_at, ended_at) VALUES (?,?,?,?)", b2, ada, ago(120), ago(60));
  await run("INSERT INTO time_entries (task_id, user_id, started_at) VALUES (?,?,?)", b2, ada, ago(10));
  const tracked = (await get(
    `SELECT (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM COALESCE(te.ended_at, now()::text)::timestamptz - te.started_at::timestamptz)), 0)::int
               FROM time_entries te WHERE te.task_id = t.id) AS tracked FROM tasks t WHERE t.id = ?`, b2)).tracked;
  assert.ok(tracked >= 4190 && tracked <= 4300, `an hour plus the running ten minutes (got ${tracked})`);
  await run("SAVEPOINT running");
  await assert.rejects(run("INSERT INTO time_entries (task_id, user_id, started_at) VALUES (?,?,?)", b3, ada, ago(1)), "one running timer per person");
  await run("ROLLBACK TO SAVEPOINT running");

  // Saved views: JSONB filters come back as an object.
  await run("INSERT INTO saved_views (id, project_id, name, filters, layout, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
    "pg-check-view", bp, "Mine", JSON.stringify({ assignee: "me" }), "list", ada, now);
  assert.deepEqual(await all("SELECT id, name, filters, layout FROM saved_views WHERE project_id = ? ORDER BY created_at, id", bp),
    [{ id: "pg-check-view", name: "Mine", filters: { assignee: "me" }, layout: "list" }]);

  // Custom fields: values live in tasks.fields; removing a field drops its key on the project's cards.
  await run("INSERT INTO custom_fields (id, project_id, name, type, options, position) VALUES (?,?,?,?,?,0)", "pg-check-f", bp, "Size", "select", JSON.stringify(["S", "M"]));
  await run("UPDATE tasks SET fields = ? WHERE id = ?", JSON.stringify({ "pg-check-f": "M", other: "x" }), b2);
  assert.deepEqual((await get("SELECT fields FROM tasks WHERE id = ?", b2)).fields, { "pg-check-f": "M", other: "x" });
  await run("UPDATE tasks SET fields = fields - ? WHERE column_id IN (SELECT id FROM columns WHERE project_id = ?)", "pg-check-f", bp);
  assert.deepEqual((await get("SELECT fields FROM tasks WHERE id = ?", b2)).fields, { other: "x" }, "field key removed, others kept");
  assert.deepEqual((await get("SELECT options FROM custom_fields WHERE id = ?", "pg-check-f")).options, ["S", "M"]);

  await client.query("ROLLBACK");
  console.log("postgres.check ok");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("postgres.check FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
