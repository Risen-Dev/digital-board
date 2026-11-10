import "server-only";
import webpush from "web-push";
import { all, get, run } from "./db";
import { DONE_COLUMN } from "./queries";

/**
 * Web Push to installed/opted-in browsers, so mentions, DMs and due cards reach
 * people with no tab open. The VAPID key pair is made on first use and kept in
 * `settings`, so there is nothing to configure. Browsers only allow push on
 * HTTPS (or localhost).
 */

export type PushMessage = { title: string; body: string; url: string };

async function vapid() {
  const row = await get<{ value: string }>("SELECT value FROM settings WHERE key = 'vapid'");
  if (row) return JSON.parse(row.value) as { publicKey: string; privateKey: string };
  const keys = webpush.generateVAPIDKeys();
  // Two first requests at once: the loser's insert is ignored and both read the winner.
  await run("INSERT INTO settings (key, value) VALUES ('vapid', ?) ON CONFLICT DO NOTHING", JSON.stringify(keys));
  return JSON.parse((await get<{ value: string }>("SELECT value FROM settings WHERE key = 'vapid'"))!.value) as { publicKey: string; privateKey: string };
}

export const vapidPublicKey = async () => (await vapid()).publicKey;

/** Sends to every device of these users. Never throws; dead subscriptions are dropped. */
export async function pushTo(userIds: string[], message: PushMessage) {
  if (userIds.length === 0) return;
  try {
    const subs = await all<{ endpoint: string; p256dh: string; auth: string }>(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (${userIds.map(() => "?").join(",")})`,
      ...userIds,
    );
    if (subs.length === 0) return;
    const { publicKey, privateKey } = await vapid();
    // Push services want a contact; an https APP_URL is the natural one.
    const subject = process.env.APP_URL?.startsWith("https://") ? process.env.APP_URL : "mailto:admin@example.com";
    const payload = JSON.stringify(message);
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          vapidDetails: { subject, publicKey, privateKey }, TTL: 3600,
        });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410: the browser unsubscribed or the subscription expired.
        if (status === 404 || status === 410) await run("DELETE FROM push_subscriptions WHERE endpoint = ?", s.endpoint);
        else console.error("push failed", status ?? err);
      }
    }));
  } catch (err) {
    console.error("push failed", err);
  }
}

/**
 * Members written as `@Name` in `text` (same rule as the in-app "@you" badge), minus
 * the author; with `projectId`, only those who can open that project.
 */
export async function mentionedIn(workspaceId: string, text: string, authorId: string, projectId?: string) {
  const lower = text.toLowerCase();
  if (!lower.includes("@")) return [];
  const members = projectId
    ? await all<{ id: string; name: string }>(
      `SELECT id, name FROM users u WHERE workspace_id = ?
          AND (is_admin = 1 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = ? AND pm.user_id = u.id))`,
      workspaceId, projectId)
    : await all<{ id: string; name: string }>("SELECT id, name FROM users WHERE workspace_id = ?", workspaceId);
  return members.filter((m) => m.id !== authorId && lower.includes(`@${m.name.toLowerCase()}`)).map((m) => m.id);
}

/**
 * Once a day from 08:00 server time (TZ), one push per subscribed user listing
 * their open cards due today or overdue. Ticked hourly from instrumentation.ts.
 */
// ponytail: runs in every app instance; with several, the due_pushed_on update
// makes later ones skip, but two could race on the same minute.
export async function pushDueCards(now = new Date()) {
  if (now.getHours() < 8) return;
  const today = now.toLocaleDateString("en-CA");
  const rows = await all<{ user_id: string; n: number; first: string }>(
    `SELECT ta.user_id, COUNT(*) AS n, (array_agg(t.title ORDER BY t.due_date, t.title))[1] AS first
       FROM tasks t
       JOIN columns c ON c.id = t.column_id
       JOIN projects p ON p.id = c.project_id
       JOIN task_assignees ta ON ta.task_id = t.id
       JOIN users u ON u.id = ta.user_id
      WHERE t.archived_at IS NULL AND t.due_date IS NOT NULL AND t.due_date <= ? AND c.id <> ${DONE_COLUMN}
        AND (u.due_pushed_on IS NULL OR u.due_pushed_on < ?)
        AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = ta.user_id)
      GROUP BY ta.user_id`,
    today, today,
  );
  for (const r of rows) {
    await run("UPDATE users SET due_pushed_on = ? WHERE id = ?", today, r.user_id);
    await pushTo([r.user_id], {
      title: r.n === 1 ? "1 card due" : `${r.n} cards due`,
      body: r.n === 1 ? r.first : `${r.first} and ${r.n - 1} more`,
      url: "/board?section=mine",
    });
  }
}
