import "server-only";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { get, run } from "./db";
import { PALETTE } from "./board";

export type User = { id: string; email: string; name: string; color: string; is_admin: number; workspace_id: string };

const COOKIE = "session";
const DAYS = 30;

// scrypt from node:crypto — no bcrypt/argon dependency needed.
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const a = Buffer.from(key, "hex");
  const b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createUser(workspaceId: string, email: string, name: string, password: string, isAdmin = false) {
  const id = randomUUID();
  // Colour cycles within the workspace so a new one does not start at index 7.
  const n = (await get<{ n: number }>("SELECT COUNT(*) n FROM users WHERE workspace_id = ?", workspaceId))!.n;
  const color = PALETTE[n % PALETTE.length];
  await run(
    "INSERT INTO users (id, workspace_id, email, name, password_hash, color, is_admin, created_at) VALUES (?,?,?,?,?,?,?,?)",
    id, workspaceId, email.toLowerCase().trim(), name.trim(), hashPassword(password), color, isAdmin ? 1 : 0, new Date().toISOString());
  return id;
}

export async function createWorkspace(name: string) {
  const id = randomUUID();
  await run("INSERT INTO workspaces (id, name, created_at) VALUES (?,?,?)", id, name.trim(), new Date().toISOString());
  return id;
}

export async function setPassword(userId: string, password: string) {
  // Every existing session is a copy of the old credential. Drop them.
  await run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(password), userId);
  await run("DELETE FROM sessions WHERE user_id = ?", userId);
}

export const passwordOf = (userId: string) =>
  get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", userId);

export async function startSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + DAYS * 864e5);
  await run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)", token, userId, expires.toISOString());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await run("DELETE FROM sessions WHERE token = ?", token);
  jar.delete(COOKIE);
}

/** Current user, or null. Also reaps the session row once it has expired. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const row = await get<User & { expires_at: string; last_seen_at: string | null }>(
    `SELECT u.id, u.email, u.name, u.color, u.is_admin, u.workspace_id, u.last_seen_at, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`,
    token,
  );

  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await run("DELETE FROM sessions WHERE token = ?", token);
    return null;
  }

  // Presence heartbeat. Every authenticated request counts, not just chat —
  // otherwise someone who never opens Chat reads as "never signed in".
  // Throttled so a burst of requests is one write.
  await touch(row.id, row.last_seen_at);
  return { id: row.id, email: row.email, name: row.name, color: row.color, is_admin: row.is_admin, workspace_id: row.workspace_id };
}

const HEARTBEAT_MS = 45_000;

/** Stamp last_seen_at, at most once per HEARTBEAT_MS per user. */
async function touch(userId: string, lastSeen: string | null) {
  if (lastSeen && Date.now() - new Date(lastSeen).getTime() < HEARTBEAT_MS) return;
  await run("UPDATE users SET last_seen_at = ? WHERE id = ?", new Date().toISOString(), userId);
}

// Counters live in login_failures so every app instance shares them.
const WINDOW = "15 minutes";
const MAX_PER_EMAIL = 5;
const MAX_PER_IP = 20;

const recent = async (key: string) =>
  (await get<{ n: number }>(`SELECT COUNT(*) n FROM login_failures WHERE key = ? AND at > now() - interval '${WINDOW}'`, key))!.n;

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

/** User id, null on a wrong email/password, or "locked" after too many recent failures. */
export async function login(email: string, password: string): Promise<string | null | "locked"> {
  email = email.toLowerCase().trim();
  const keys = [`e:${email}`, `ip:${await clientIp()}`];
  if (await recent(keys[0]) >= MAX_PER_EMAIL || await recent(keys[1]) >= MAX_PER_IP) return "locked";

  const row = await get<{ id: string; password_hash: string }>("SELECT id, password_hash FROM users WHERE email = ?", email);
  // Hash anyway on a miss so a bad email and a bad password take the same time.
  const ok = row ? verifyPassword(password, row.password_hash) : verifyPassword(password, hashPassword("decoy"));
  if (ok && row) {
    await run("DELETE FROM login_failures WHERE key = ?", keys[0]);
    return row.id;
  }
  await run("INSERT INTO login_failures (key) VALUES (?), (?)", ...keys);
  await run(`DELETE FROM login_failures WHERE at < now() - interval '${WINDOW}'`);
  return null;
}
