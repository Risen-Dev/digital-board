import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const source = process.argv[2];
if (!source) throw new Error("Usage: DATABASE_URL=... node scripts/files-to-postgres.mjs /path/to/uploads");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(readFileSync(join(process.cwd(), "lib", "schema.sql"), "utf8"));

try {
  const rows = (await client.query("SELECT id, size FROM attachments WHERE data IS NULL")).rows;
  const files = rows.map((row) => {
    const path = join(source, row.id);
    if (!existsSync(path)) throw new Error(`Missing attachment file: ${path}`);
    const data = readFileSync(path);
    if (data.length !== row.size) throw new Error(`Size mismatch: ${path}`);
    return { id: row.id, data };
  });

  await client.query("BEGIN");
  for (const file of files) await client.query("UPDATE attachments SET data = $1 WHERE id = $2", [file.data, file.id]);
  await client.query("COMMIT");
  console.log(`Migrated ${files.length} attachment${files.length === 1 ? "" : "s"}.`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}
