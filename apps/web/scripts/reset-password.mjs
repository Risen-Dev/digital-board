#!/usr/bin/env node
/**
 * Account recovery for a self-hosted instance. There is no email server, so the
 * way back in is the machine that holds the database.
 *
 *   node scripts/reset-password.mjs                    # list accounts
 *   node scripts/reset-password.mjs <email> [password] # set a password
 *
 * With no password given, one is generated and printed. Reads DATABASE_URL from
 * the environment or from .env / .env.local, the same files the app reads.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // no such file — environment only
  }
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Put it in .env, or pass it inline:\n  DATABASE_URL=postgres://... node scripts/reset-password.mjs");
  process.exit(1);
}

// Must stay byte-identical to hashPassword() in lib/auth.ts.
const hash = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};

const [email, given] = process.argv.slice(2);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

if (!email) {
  const { rows } = await db.query("SELECT email, name, is_admin, last_seen_at FROM users ORDER BY created_at");
  if (rows.length === 0) {
    console.log("No accounts yet — open the app and the setup wizard will run.");
  } else {
    console.log(`${rows.length} account(s):\n`);
    for (const u of rows) {
      console.log(`  ${u.email.padEnd(32)} ${u.name.padEnd(20)} ${u.is_admin ? "admin" : "member"}   last seen ${u.last_seen_at ?? "never"}`);
    }
    console.log("\nSet one:  node scripts/reset-password.mjs <email> [new-password]");
  }
  await db.end();
  process.exit(0);
}

const password = given ?? randomBytes(9).toString("base64url");
if (password.length < 8) {
  console.error("Password must be at least 8 characters — the app enforces the same minimum.");
  await db.end();
  process.exit(1);
}

const { rowCount } = await db.query("UPDATE users SET password_hash = $1 WHERE lower(email) = lower($2)", [hash(password), email.trim()]);
if (rowCount === 0) {
  console.error(`No account with email "${email}". Run without arguments to list them.`);
  await db.end();
  process.exit(1);
}

// Old sessions keep working otherwise, which defeats the point of a reset.
const { rowCount: killed } = await db.query("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE lower(email) = lower($1))", [email.trim()]);
await db.end();

console.log(`Password updated for ${email}`);
if (!given) console.log(`New password: ${password}`);
console.log(`Signed out ${killed} existing session(s). Sign in, then change it from Settings.`);
