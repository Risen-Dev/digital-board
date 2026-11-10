// Run: node --experimental-strip-types lib/safe-url.check.ts
import assert from "node:assert/strict";
import { urlProblem } from "./safe-url.ts";

delete process.env.ALLOW_PRIVATE_URLS;
for (const bad of [
  "http://127.0.0.1:5432", "http://localhost:3000", "http://10.1.2.3/", "http://169.254.169.254/latest/meta-data",
  "http://192.168.1.1", "http://172.20.0.1", "http://100.115.174.40", "http://0.0.0.0", "http://[::1]/",
  "http://[::ffff:127.0.0.1]/", "http://[fd00::1]/", "http://2130706433/", "http://0x7f.1/",
]) assert.ok(await urlProblem(bad), `${bad} is blocked`);
assert.equal(await urlProblem("https://8.8.8.8/hook"), null, "public IP passes");
assert.equal(await urlProblem("https://[2606:4700:4700::1111]/"), null, "public IPv6 passes");
assert.ok(await urlProblem("ftp://8.8.8.8/"), "non-http scheme rejected");
assert.ok(await urlProblem("not a url"), "garbage rejected");

process.env.ALLOW_PRIVATE_URLS = "1";
assert.equal(await urlProblem("http://localhost:11434/v1"), null, "opt-in allows local Ollama");
assert.ok(await urlProblem("file:///etc/passwd"), "opt-in still needs http(s)");

console.log("safe-url.check ok");
