// Run: node --experimental-strip-types lib/i18n/i18n.check.ts
import assert from "node:assert/strict";
import { eventText, pickLocale, translator } from "./core.ts";

const tr = translator({
  "Save": "Simpan",
  "{n} members": "{n} anggota",
  "Moved from {from} to {to}": "Dipindah dari {from} ke {to}",
  "Commented: {text}": "Berkomentar: {text}",
});

assert.equal(tr("Save"), "Simpan");
assert.equal(tr("Not in the dictionary"), "Not in the dictionary", "missing keys fall back to English");
assert.equal(tr("{n} members", { n: 3 }), "3 anggota", "placeholders filled");

// stored English history → template → translation, values kept as written
assert.equal(eventText("Moved from To Do to In Progress", tr), "Dipindah dari To Do ke In Progress");
assert.equal(eventText("Commented: line one\nline two", tr), "Berkomentar: line one\nline two", "multi-line comment text survives");
assert.equal(eventText("Save", tr), "Simpan", "fixed events go straight through");
assert.equal(eventText("Something new", tr), "Something new");

assert.equal(pickLocale("en", "id-ID,id;q=0.9"), "en", "the cookie wins over the browser");
assert.equal(pickLocale(undefined, "id-ID,id;q=0.9,en;q=0.8"), "id");
assert.equal(pickLocale(undefined, "en-US,id;q=0.5"), "en", "only the first preference counts");
assert.equal(pickLocale("fr", null), "en", "unknown cookie falls back");

console.log("i18n.check ok");
