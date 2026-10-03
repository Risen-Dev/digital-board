// Run: node --experimental-strip-types lib/canvas/merge.check.ts
import assert from "node:assert/strict";
import { mergeSnapshots, type Snapshot } from "./merge.ts";

const NOW = 1_000_000_000_000;
const el = (id: string, version: number, extra: object = {}) => ({
  id, version, versionNonce: 1, index: `a${id}`, updated: NOW, ...extra,
});
const ids = (s: Snapshot) => s.elements!.map((e) => `${e.id}@${e.version}${e.isDeleted ? "x" : ""}`);

// the actual bug: A's older save lands after B's newer one — B's edit must survive
const afterB = mergeSnapshots(null, { elements: [el("1", 2), el("2", 1)] }, NOW);
const afterA = mergeSnapshots(afterB, { elements: [el("1", 2)] }, NOW);
assert.deepEqual(ids(afterA), ["1@2", "2@1"], "stale save keeps the other tab's element");

// higher version wins either way round
assert.deepEqual(ids(mergeSnapshots({ elements: [el("1", 5)] }, { elements: [el("1", 3)] }, NOW)), ["1@5"]);
assert.deepEqual(ids(mergeSnapshots({ elements: [el("1", 3)] }, { elements: [el("1", 5)] }, NOW)), ["1@5"]);

// a tombstone beats the stale live copy, so a deletion isn't resurrected
const deleted = mergeSnapshots({ elements: [el("1", 4, { isDeleted: true })] }, { elements: [el("1", 3)] }, NOW);
assert.deepEqual(ids(deleted), ["1@4x"]);

// tombstones older than a day are pruned
const old = mergeSnapshots(null, { elements: [el("1", 4, { isDeleted: true, updated: NOW - 2 * 86_400_000 })] }, NOW);
assert.deepEqual(ids(old), []);

// equal versions: lower versionNonce wins, same as Excalidraw's reconcile
const tie = mergeSnapshots({ elements: [el("1", 2, { versionNonce: 9 })] }, { elements: [el("1", 2, { versionNonce: 3 })] }, NOW);
assert.equal(tie.elements![0].versionNonce, 3);

// output is ordered by fractional index
assert.deepEqual(ids(mergeSnapshots({ elements: [el("b", 1)] }, { elements: [el("a", 1)] }, NOW)), ["a@1", "b@1"]);

// files: union, minus ones no live element uses
const files = mergeSnapshots(
  { elements: [el("1", 1, { fileId: "f1" })], files: { f1: {}, gone: {} } },
  { elements: [el("2", 1, { fileId: "f2" })], files: { f2: {} } },
  NOW,
).files!;
assert.deepEqual(Object.keys(files).sort(), ["f1", "f2"]);

// non-element fields (appState) come from the newest save
assert.deepEqual(mergeSnapshots({ appState: { a: 1 } }, { appState: { a: 2 } }, NOW).appState, { a: 2 });

console.log("merge.check: ok");
