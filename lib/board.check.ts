// Run: node --experimental-strip-types lib/board.check.ts
import assert from "node:assert/strict";
import { applyFilters, branchNameOf, ciOf, columnOf, initials, placeTask, projectKeyOf, reorder, TEMPLATES, templateOf, type Column } from "./board.ts";
import { parseFlow } from "./canvas/flow.ts";
import { columnFor, keysIn, planEvent } from "./github-events.ts";
import { resolveActions } from "./board-agent.ts";
import { addressOf, emailOf, parseInbound } from "./inbound.ts";

import { toIcal } from "./ical.ts";
import examples from "./template-examples.json" with { type: "json" };

const mk = (id: string, title: string, n: number): Column["tasks"][number] => ({
  id, columnId: title, title: `task ${n}`, description: n % 2 ? "Detail" : null, label: n % 2 ? "Design" : "QA",
  priority: n % 2 ? "high" : "low", assignee: n === 1 ? { id: "u1", name: "Ada L", color: "#000" } : null, dueDate: null, key: null,
});

const board: Column[] = [
  { id: "a", title: "A", color: "#000", tasks: [mk("t1", "a", 1), mk("t2", "a", 2)] },
  { id: "b", title: "B", color: "#111", tasks: [mk("t3", "b", 3)] },
  { id: "c", title: "C", color: "#222", tasks: [] },
];
const ids = (cols: Column[], id: string) => cols.find((c) => c.id === id)!.tasks.map((t) => t.id);

// cross-column insert at an exact index, and columnId is rewritten
const moved = placeTask(board, "t1", "b", 0);
assert.deepEqual(ids(moved, "a"), ["t2"]);
assert.deepEqual(ids(moved, "b"), ["t1", "t3"]);
assert.equal(moved.find((c) => c.id === "b")!.tasks[0].columnId, "b", "columnId follows the move");
assert.deepEqual(ids(board, "a"), ["t1", "t2"], "input not mutated");

// reorder, clamping, empty column, no-ops
assert.deepEqual(ids(placeTask(board, "t2", "a", 0), "a"), ["t2", "t1"]);
assert.deepEqual(ids(placeTask(board, "t1", "a", 99), "a"), ["t2", "t1"], "index clamped");
assert.deepEqual(ids(placeTask(board, "t1", "c", 0), "c"), ["t1"], "drop into empty column");
assert.equal(placeTask(board, "nope", "b", 0), board, "unknown task is a no-op");
assert.equal(placeTask(board, "t1", "nope", 0), board, "unknown column is a no-op");

// columnOf resolves a task id and a bare column id
assert.equal(columnOf(board, "t3")!.id, "b");
assert.equal(columnOf(board, "c")!.id, "c");
assert.equal(columnOf(board, "missing"), undefined);

// filters compose and never drop a column
assert.equal(applyFilters(board, {}).length, 3, "columns preserved");
assert.deepEqual(applyFilters(board, { q: "task 3" }).flatMap((c) => c.tasks.map((t) => t.id)), ["t3"]);
assert.deepEqual(applyFilters(board, { priority: "low" }).flatMap((c) => c.tasks.map((t) => t.id)), ["t2"]);
assert.deepEqual(applyFilters(board, { assignee: "u1" }).flatMap((c) => c.tasks.map((t) => t.id)), ["t1"]);
assert.deepEqual(applyFilters(board, { label: "QA", priority: "high" }).flatMap((c) => c.tasks), []);

assert.equal(initials("Ada Lovelace"), "AL");
assert.equal(initials("cher"), "C");
assert.equal(initials("  "), "?");

// column reordering — the exact call moveColumn() makes
assert.deepEqual(reorder(["a", "b", "c"], 2, 1), ["a", "c", "b"], "moved left");
assert.deepEqual(reorder(["a", "b", "c"], 0, 1), ["b", "a", "c"], "moved right");
assert.deepEqual(reorder(["a", "b", "c"], 0, 2), ["b", "c", "a"], "moved to the end");
const abc = ["a", "b", "c"];
assert.equal(reorder(abc, 0, -1), abc, "past the left edge is a no-op");
assert.equal(reorder(abc, 2, 3), abc, "past the right edge is a no-op");
assert.deepEqual(abc, ["a", "b", "c"], "input not mutated");

// templates
assert.equal(templateOf("sales").id, "sales");
assert.equal(templateOf("nope").id, TEMPLATES[0].id, "unknown id falls back to the default");
assert.equal(templateOf(null).id, TEMPLATES[0].id, "missing id falls back to the default");
for (const t of TEMPLATES) {
  const colors = t.columns.map((c) => c.color);
  assert.equal(new Set(colors).size, colors.length, `${t.id}: no repeated colours`);
  assert.ok(colors.every((c) => /^var\(--(muted-foreground|chart-[1-7])\)$/.test(c)), `${t.id}: colours are tokens`);
}

// every template has examples whose tasks land in its columns and whose flow parses whole
for (const t of TEMPLATES) {
  const ex = (examples as Record<string, { tasks: { column: string; priority: string }[]; canvas: { flow: unknown } }>)[t.id];
  assert.ok(ex, `${t.id}: has examples`);
  for (const task of ex.tasks) {
    assert.ok(t.columns.some((c) => c.title === task.column), `${t.id}: column ${task.column} exists`);
    assert.ok(["low", "medium", "high"].includes(task.priority), `${t.id}: priority ${task.priority}`);
  }
  const raw = ex.canvas.flow as { nodes: unknown[]; edges: unknown[] };
  const flow = parseFlow(raw);
  assert.ok(flow && flow.nodes.length === raw.nodes.length && flow.edges.length === raw.edges.length, `${t.id}: flow parses`);
}

// task keys and GitHub linking
assert.equal(projectKeyOf("Web app 2"), "WEB");
assert.equal(projectKeyOf("123"), "TASK", "no letters falls back");
assert.deepEqual(keysIn("feat/web-42-login fixes WEB-42 and WEB-7, not WEBX-1 or WEB-42a", "WEB"), ["WEB-42", "WEB-7"]);
assert.deepEqual(keysIn("WEB-007", "WEB"), ["WEB-7"], "leading zeros normalised");
assert.equal(branchNameOf({ key: "WEB-42", title: "Login page: email + password!", label: "Feature" }), "feat/WEB-42-login-page-email-password");
assert.equal(branchNameOf({ key: "WEB-3", title: "Fix crash", label: "Bug" }), "fix/WEB-3-fix-crash");
const run = (status: string, conclusion: string | null) => ({ status, conclusion });
assert.equal(ciOf([]), null);
assert.equal(ciOf([run("completed", "success"), run("completed", "skipped")]), "success");
assert.equal(ciOf([run("completed", "success"), run("in_progress", null)]), "pending");
assert.equal(ciOf([run("in_progress", null), run("completed", "failure")]), "failure", "failure beats pending");

// GitHub webhook planning
const pr = (action: string, extra: Record<string, unknown> = {}) => ({
  action,
  pull_request: {
    number: 12, title: "Login page WEB-42", html_url: "u", state: "open", draft: false, merged: false,
    user: { login: "ada" }, updated_at: "t", head: { ref: "feat/web-42-login", sha: "abc" }, ...extra,
  },
});
const moves = (steps: ReturnType<typeof planEvent>) => steps.flatMap((s) => ("move" in s ? [`${s.key}:${s.move}`] : []));
assert.deepEqual(moves(planEvent("pull_request", pr("opened"), "WEB")), ["WEB-42:review"]);
assert.deepEqual(moves(planEvent("pull_request", pr("opened", { draft: true }), "WEB")), [], "draft PRs don't move cards");
assert.deepEqual(moves(planEvent("pull_request", pr("closed", { state: "closed", merged: true }), "WEB")), ["WEB-42:merged"]);
assert.deepEqual(moves(planEvent("pull_request", pr("closed", { state: "closed" }), "WEB")), [], "closed unmerged: link only");
assert.equal(planEvent("pull_request", pr("closed", { state: "closed", merged: true }), "WEB").filter((s) => "link" in s).length, 1);
const push = planEvent("push", {
  ref: "refs/heads/feat/WEB-7-x", repository: { html_url: "https://github.com/o/r" },
  commits: [{ id: "c0ffee1234", message: "fix WEB-8\n\nbody", url: "cu", timestamp: "t", author: { name: "Ada" } }],
}, "WEB");
assert.deepEqual(moves(push), ["WEB-7:progress"], "only the branch name moves");
assert.deepEqual(push.flatMap((s) => ("link" in s ? [`${s.key}:${s.link.kind}`] : [])), ["WEB-7:branches", "WEB-8:commits"]);
assert.ok(planEvent("push", { ref: "refs/heads/WEB-7", deleted: true }, "WEB").some((s) => "unlink" in s), "deleted branch unlinks");
assert.deepEqual(planEvent("push", { ref: "refs/tags/WEB-7" }, "WEB"), [], "tags are ignored");
const failed = planEvent("check_suite", { action: "completed", check_suite: { conclusion: "failure", head_branch: "fix/WEB-3-crash", head_sha: "s" } }, "WEB");
assert.ok(failed.some((s) => "note" in s && s.key === "WEB-3") && failed.some((s) => "ci" in s && s.ci === "failure"));
const cols = [{ id: "b", title: "Backlog", position: 0 }, { id: "p", title: "In Progress", position: 1 }, { id: "r", title: "In Review", position: 2 }, { id: "d", title: "Done", position: 3 }];
assert.equal(columnFor("review", cols, 0)?.id, "r");
assert.equal(columnFor("merged", cols, 2)?.id, "d", "no QA column: merged goes to Done");
assert.equal(columnFor("progress", cols, 3), null, "never moves a card backwards");
assert.equal(columnFor("review", [{ id: "x", title: "Todo", position: 0 }], 0), null, "no matching column: stay");

// project agent: names → ids, partial updates keep the rest, anything unclear is an error, not a guess
{
  const cols: Column[] = [
    { id: "bl", title: "Backlog", color: "", tasks: [{ ...mk("t1", "bl", 1), columnId: "bl", key: "WEB-1" }] },
    { id: "ip", title: "In Progress", color: "", tasks: [] },
  ];
  const people = [{ id: "u1", name: "Ada Lovelace", color: "" }, { id: "u2", name: "Ben Ito", color: "" }];
  const { ops, errors } = resolveActions([
    { op: "create", title: "Setup CI", column: "backlog", priority: "high", assignee: "ada", due: "2026-10-20" },
    { op: "create", title: "No column given" },
    { op: "update", task: "web-1", column: "In Progress", assignee: null },
    { op: "create", title: "Bad", column: "Nope" },
    { op: "create", title: "Bad", priority: "urgent" },
    { op: "update", task: "WEB-99" },
    { op: "delete", task: "WEB-1" },
  ], cols, people);
  assert.deepEqual(ops[0], { op: "create", columnId: "bl", summary: 'Created "Setup CI" in Backlog',
    fields: { title: "Setup CI", description: null, label: null, priority: "high", assigneeId: "u1", dueDate: "2026-10-20" } });
  assert.equal(ops[1].op === "create" && ops[1].columnId, "bl", "no column → first column");
  assert.equal(ops[1].fields.priority, "medium");
  const up = ops[2];
  assert.ok(up.op === "update" && up.taskId === "t1" && up.moveTo === "ip");
  assert.equal(up.fields.assigneeId, null, "null unassigns");
  assert.equal(up.fields.priority, "high", "untouched fields keep their value");
  assert.equal(up.fields.description, "Detail");
  assert.equal(ops.length, 3, "delete is not an op");
  assert.equal(errors.length, 3);
  assert.equal(resolveActions([{ op: "create", title: "x", assignee: "e" }], cols, people).errors.length, 1, "ambiguous member");
  assert.equal(resolveActions(null, cols, people).ops.length, 0);
  const more = resolveActions([
    { op: "sheet", name: "Negosiasi", flow: { nodes: [] } },
    { op: "message", to: "all", text: "Hi" },
    { op: "message", to: "ben", text: "Ping" },
    { op: "message", to: "nobody", text: "x" },
    { op: "message", to: "all", text: "  " },
    { op: "column", title: "QA" },
  ], cols, people);
  assert.deepEqual(more.ops.map((o) => o.op === "message" ? o.to : o.op), ["sheet", null, "u2", "column"]);
  assert.equal(more.errors.length, 2, "unknown recipient and empty text");
}


// inbound webhook body: defaults, normalising, and rejects
assert.deepEqual(parseInbound({ title: "  Hi ", priority: "HIGH", dueDate: "2026-01-31", column: "Todo", extra: 1 }),
  { title: "Hi", description: null, label: null, priority: "high", dueDate: "2026-01-31", column: "Todo" });
assert.equal((parseInbound({ title: "x" }) as { priority: string }).priority, "medium", "priority defaults to medium");
assert.ok("error" in parseInbound({}), "title required");
assert.ok("error" in parseInbound({ title: "x", priority: "urgent" }), "unknown priority");
assert.ok("error" in parseInbound({ title: "x", due_date: "31/01/2026" }), "bad date");
assert.equal((parseInbound({ title: "t".repeat(300) }) as { title: string }).title.length, 200, "title capped");

// inbound email: Postmark JSON, Mailgun form fields, HTML-only, quoted thread, not-an-email
assert.deepEqual(emailOf({ FromFull: { Email: "ada@x.io", Name: "Ada" }, Subject: "Re: FW: Login broken", TextBody: "Still broken.\n\nOn Mon, Ben wrote:\n> old" }),
  { from: "Ada <ada@x.io>", subject: "Login broken", text: "Still broken." });
assert.deepEqual(emailOf({ sender: "ben@y.io", subject: "", "body-plain": "full", "stripped-text": "short" }),
  { from: "ben@y.io", subject: "(no subject)", text: "short" });
assert.equal(emailOf({ from: "a@b.c", subject: "s", html: "<p>Hi<br>there</p><style>p{}</style>" })!.text, "Hi\nthere");
assert.equal(emailOf({ title: "card", from: "a@b.c" }), null, "a card body is not an email");
assert.equal(emailOf({ subject: "no sender" }), null);
assert.equal(addressOf("Ada L <ADA@x.io>"), "ada@x.io");

// iCal feed: all-day event ending the next day, escaping, CRLF, 75-octet folding
const ics = toIcal("Web; App", [
  { id: "t1", key: "WEB-1", title: "Ship, now", description: "a\nb", dueDate: "2026-12-31", column: "Done" },
  { id: "t2", key: "WEB-2", title: "é".repeat(60), description: null, dueDate: "2026-01-05", column: "Todo" },
], new Date("2026-10-16T08:00:00.123Z"));
assert.ok(ics.includes("X-WR-CALNAME:Web\\; App\r\n"));
assert.ok(ics.includes("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101\r\n"), "ends next day, across a year");
assert.ok(ics.includes("SUMMARY:WEB-1 Ship\\, now"));
assert.ok(ics.includes("DESCRIPTION:Column: Done\\n\\na\\nb"));
assert.ok(ics.includes("DTSTAMP:20261016T080000Z"));
assert.ok(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75), "folded to 75 octets");
assert.ok(!ics.replace(/\r\n/g, "").includes("\n"), "only CRLF line ends");

console.log("board.check ok");
