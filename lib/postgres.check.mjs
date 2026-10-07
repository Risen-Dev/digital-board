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

  // isInstalled / auth
  assert.ok(await get("SELECT 1 FROM users LIMIT 1"), "isInstalled");
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

  await client.query("ROLLBACK");
  console.log("postgres.check ok");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("postgres.check FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
