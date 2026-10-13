// Run: node --experimental-strip-types lib/canvas/flow.check.ts
import assert from "node:assert/strict";
import { layoutFlow, levels, parseFlow } from "./flow.ts";

assert.equal(parseFlow(null), null);
assert.equal(parseFlow({ nodes: [] }), null);

const flow = parseFlow({
  nodes: [
    { id: "s", label: "Order received", shape: "start" },
    { id: "d", label: "In stock?", shape: "decision" },
    { id: "y", label: "Ship", shape: "process" },
    { id: "n", label: "Backorder", shape: "weird" },
    { id: "s", label: "duplicate id" },
    { id: "x", label: "" },
    { id: "lonely", label: "Unreached", shape: "data" },
  ],
  edges: [
    { from: "s", to: "d" }, { from: "d", to: "y", label: "yes" }, { from: "d", to: "n", label: "no" },
    { from: "n", to: "d" }, { from: "d", to: "ghost" }, { from: "y", to: "y" },
  ],
})!;

assert.deepEqual(flow.nodes.map((n) => n.id), ["s", "d", "y", "n", "lonely"], "dupes and empty labels dropped");
assert.equal(flow.nodes[3].shape, "process", "unknown shape falls back to process");
assert.equal(flow.edges.length, 4, "edges to unknown nodes and self-loops dropped");

// "lonely" has no incoming edge, so it is a root alongside "s".
const lv = levels(flow);
assert.deepEqual([lv.get("s"), lv.get("d"), lv.get("y"), lv.get("n"), lv.get("lonely")], [0, 1, 2, 2, 0], "back edge n→d ignored");

const els = layoutFlow(flow, { x: 100, y: 50 }, "p-");
assert.equal(els.length, 9);
const byId = Object.fromEntries(els.filter((e) => "id" in e).map((e) => [(e as { id: string }).id, e]));
assert.equal(byId["p-d"].type, "diamond");
assert.ok(byId["p-y"].y > byId["p-d"].y, "children sit below parents");
assert.ok(Math.min(...els.filter((e) => "id" in e).map((e) => e.x)) >= 100, "nothing left of origin");
console.log("flow ok");
