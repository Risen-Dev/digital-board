// Run: node --experimental-strip-types lib/board.check.ts
import assert from "node:assert/strict";
import { applyFilters, columnOf, initials, placeTask, reorder, TEMPLATES, templateOf, type Column } from "./board.ts";
import { parseFlow } from "./canvas/flow.ts";
import examples from "./template-examples.json" with { type: "json" };

const mk = (id: string, title: string, n: number): Column["tasks"][number] => ({
  id, columnId: title, title: `task ${n}`, description: n % 2 ? "Detail" : null, label: n % 2 ? "Design" : "QA",
  priority: n % 2 ? "high" : "low", assignee: n === 1 ? { id: "u1", name: "Ada L", color: "#000" } : null, dueDate: null,
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

console.log("board.check ok");
