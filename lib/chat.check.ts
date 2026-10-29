// Run: node --experimental-strip-types lib/chat.check.ts
import assert from "node:assert/strict";
import { AGENT_MENTION, cursorOf, mergeMessages, turnsOf } from "./chat.ts";
import type { ChatMessage } from "./queries.ts";

const msg = (id: number, body = `m${id}`): ChatMessage => ({
  id, body, created_at: "2026-09-17T00:00:00.000Z", edited_at: null,
  author_id: "u1", author_name: "Ada", author_color: "#000", agent: false, attachments: [], reactions: [],
});

const a = [msg(1), msg(2)];

// the actual bug: two overlapping polls deliver the same rows
assert.deepEqual(mergeMessages(a, [msg(3)]).map((m) => m.id), [1, 2, 3], "new rows append");
assert.deepEqual(mergeMessages(a, [msg(2), msg(3)]).map((m) => m.id), [1, 2, 3], "overlap deduped");
assert.deepEqual(mergeMessages(a, [msg(1), msg(2)]).map((m) => m.id), [1, 2], "full repeat adds nothing");
assert.equal(mergeMessages(a, [msg(1)]), a, "no change returns the same array (no re-render)");
assert.equal(mergeMessages(a, []), a, "empty poll returns the same array");

// ids stay unique no matter how the same batch is replayed
const replayed = mergeMessages(mergeMessages(a, [msg(3)]), [msg(3), msg(4)]);
assert.deepEqual(replayed.map((m) => m.id), [1, 2, 3, 4]);
assert.equal(new Set(replayed.map((m) => m.id)).size, replayed.length, "no duplicate React keys");

// reset replaces, and does so even when the payload is empty
assert.deepEqual(mergeMessages(a, [msg(9)], true).map((m) => m.id), [9], "reset replaces the thread");
assert.deepEqual(mergeMessages(a, [], true), [], "reset with no rows clears");
assert.deepEqual(
  mergeMessages(a, [msg(1, "edited")], true).map((m) => m.body),
  ["edited"],
  "reset picks up an edited body for an id already seen",
);

// cursor
assert.equal(cursorOf([msg(4), msg(7), msg(5)], 0), 7, "max id wins, order-independent");
assert.equal(cursorOf([], 12), 12, "empty poll keeps the cursor");
assert.equal(cursorOf([msg(3)], 10), 10, "cursor never moves backwards");

console.log("chat.check ok");

// agent: "@agent" as a word calls it; history becomes alternating turns that start with a person
assert.ok(AGENT_MENTION.test("@agent what is due?") && AGENT_MENTION.test("hey @Agent, help"));
assert.ok(!AGENT_MENTION.test("email me@agent.io") && !AGENT_MENTION.test("@agents"));
assert.deepEqual(turnsOf([
  { agent: true, body: "stale greeting", name: "Ada" },
  { agent: false, body: "@agent hi", name: "Ada" },
  { agent: false, body: "and me", name: "Ben" },
  { agent: false, body: "", name: "Ben" },
  { agent: true, body: "Hello both", name: "Ada" },
]), [
  { role: "user", content: "Ada: @agent hi\nBen: and me" },
  { role: "assistant", content: "Hello both" },
]);
