// Run: node --experimental-strip-types lib/secret.check.ts
import assert from "node:assert/strict";
import { seal, unseal } from "./secret.ts";

delete process.env.SECRET_KEY;
assert.equal(seal("sk-1"), "sk-1", "no SECRET_KEY stores plain text");
assert.equal(unseal("sk-1"), "sk-1", "plain value reads back");

process.env.SECRET_KEY = "one";
const sealed = seal("sk-1");
assert.ok(sealed.startsWith("enc:") && !sealed.includes("sk-1"), "sealed hides the key");
assert.notEqual(seal("sk-1"), sealed, "fresh IV per seal");
assert.equal(unseal(sealed), "sk-1", "round trip");
assert.equal(unseal("sk-old"), "sk-old", "legacy plain value still reads");
assert.equal(seal(""), "", "empty key stays empty (Ollama)");

process.env.SECRET_KEY = "two";
assert.equal(unseal(sealed), "", "wrong SECRET_KEY reads as no key");
delete process.env.SECRET_KEY;
assert.equal(unseal(sealed), "", "missing SECRET_KEY reads as no key");

console.log("secret.check ok");
