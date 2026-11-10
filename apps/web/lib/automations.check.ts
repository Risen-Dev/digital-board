// Run: node --experimental-strip-types lib/automations.check.ts
import assert from "node:assert/strict";
import { automationsFor, cleanAutomation, type Automation } from "./automations.ts";

const cols = ["c1", "c2"];
const users = ["u1"];
const ok = (raw: Partial<Automation>) => {
  const r = cleanAutomation(raw, cols, users);
  assert.equal(typeof r, "object", `expected a rule, got: ${r}`);
  return r as Automation;
};
const bad = (raw: Partial<Automation>) => assert.equal(typeof cleanAutomation(raw, cols, users), "string", JSON.stringify(raw));

ok({ on: "task.created", columnId: null, do: "priority", value: "high" });
ok({ on: "task.moved", columnId: "c2", do: "assign", value: "u1" });
assert.equal(ok({ on: "task.moved", columnId: "c2", do: "unassign", value: "junk" }).value, "", "unassign ignores value");
assert.equal(ok({ id: "keep", on: "task.created", do: "due", value: "3" }).id, "keep", "existing id kept");
assert.ok(ok({ on: "task.created", do: "due", value: "0" }).id, "new id made");

bad({ on: "task.moved", columnId: null, do: "unassign" }); // moved needs a column
bad({ on: "task.moved", columnId: "other-project", do: "unassign" });
bad({ on: "task.created", do: "assign", value: "stranger" });
bad({ on: "task.created", do: "priority", value: "urgent" });
bad({ on: "task.created", do: "label", value: "a, b" });
bad({ on: "task.created", do: "label", value: " " });
bad({ on: "task.created", do: "due", value: "-1" });
bad({ on: "task.created", do: "due", value: "1.5" });
bad({ on: "task.deleted" as never, do: "unassign" });
bad({ on: "task.created", do: "move" as never });

const rules: Automation[] = [
  { id: "1", on: "task.moved", columnId: "c2", do: "unassign", value: "" },
  { id: "2", on: "task.created", columnId: null, do: "priority", value: "low" },
  { id: "3", on: "task.created", columnId: "c1", do: "label", value: "New" },
];
const ids = (event: string, col: string) => automationsFor(rules, event, col).map((r) => r.id);
assert.deepEqual(ids("task.moved", "c2"), ["1"]);
assert.deepEqual(ids("task.moved", "c1"), [], "moved into another column");
assert.deepEqual(ids("task.created", "c1"), ["2", "3"], "any-column and this-column, in saved order");
assert.deepEqual(ids("task.created", "c2"), ["2"]);
assert.deepEqual(ids("task.updated", "c2"), [], "other events never fire");

console.log("automations.check ok");
