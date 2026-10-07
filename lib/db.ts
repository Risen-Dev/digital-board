import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const { Pool, types } = pg;

// int8 (COUNT, SUM) arrives as a string by default, which silently turns
// `count > 0` into a string comparison. Every count here fits in a JS number.
types.setTypeParser(20, Number);


declare global {
  var __boardPool: pg.Pool | undefined;
  var __boardReady: Promise<void> | undefined;
}

function pool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required. Set it in .env or .env.local to an existing PostgreSQL database.");
  return (globalThis.__boardPool ??= new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  }));
}

/** Schema applied once per process, on the first query. */
function ready() {
  return (globalThis.__boardReady ??= pool()
    .query(readFileSync(join(process.cwd(), "lib", "schema.sql"), "utf8"))
    .then(
      () => undefined,
      (error) => {
        // Don't cache the failure: a database that was down at boot would
        // otherwise fail every request until the process restarts.
        globalThis.__boardReady = undefined;
        throw error;
      },
    ));
}

/**
 * Binds one client for the duration of a transaction, so every helper called
 * inside `transaction()` — however deeply — runs on that same connection
 * instead of grabbing a fresh one from the pool and landing outside the tx.
 */
const tx = new AsyncLocalStorage<pg.PoolClient>();

/**
 * Call sites write `?` placeholders; Postgres wants `$1`, `$2`.
 * Rewriting here means the ~80 queries did not have to be touched.
 * ponytail: naive scan — a literal `?` inside a string literal would be
 * rewritten too. None of the queries contain one; add quote-awareness if that
 * ever changes.
 */
function toPg(sql: string) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function query<T extends pg.QueryResultRow>(sql: string, args: unknown[]) {
  await ready();
  const client = tx.getStore();
  const text = toPg(sql);
  return client ? client.query<T>(text, args) : pool().query<T>(text, args);
}

export const get = async <T>(sql: string, ...args: unknown[]) =>
  (await query<pg.QueryResultRow>(sql, args)).rows[0] as T | undefined;

export const all = async <T>(sql: string, ...args: unknown[]) =>
  (await query<pg.QueryResultRow>(sql, args)).rows as T[];

export const run = async (sql: string, ...args: unknown[]) => {
  await query<pg.QueryResultRow>(sql, args);
};

/** Runs `fn` in a transaction. Rolls back on throw. */
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  await ready();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const out = await tx.run(client, fn);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** True once the first account exists — the setup-wizard gate. */
export const isInstalled = async () => (await get("SELECT 1 FROM users LIMIT 1")) !== undefined;
