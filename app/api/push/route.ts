import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { run } from "@/lib/db";
import { vapidPublicKey } from "@/lib/push";

/** GET: the VAPID public key. POST: save this browser's subscription. DELETE: forget it. */
export async function GET() {
  if (!(await currentUser())) return new NextResponse("Unauthorized", { status: 401 });
  return NextResponse.json({ key: await vapidPublicKey() });
}

type Sub = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };

export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return new NextResponse("Unauthorized", { status: 401 });
  const sub = (await req.json().catch(() => null)) as Sub | null;
  const endpoint = sub?.endpoint, p256dh = sub?.keys?.p256dh, auth = sub?.keys?.auth;
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://") || endpoint.length > 1000
    || typeof p256dh !== "string" || typeof auth !== "string" || p256dh.length > 200 || auth.length > 100) {
    return new NextResponse("Bad subscription", { status: 400 });
  }
  // One browser = one endpoint; signing in as someone else on it moves it to them.
  await run(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?,?,?,?,?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    endpoint, me.id, p256dh, auth, new Date().toISOString(),
  );
  return new NextResponse(null, { status: 204 });
}

export async function DELETE(req: Request) {
  const me = await currentUser();
  if (!me) return new NextResponse("Unauthorized", { status: 401 });
  const { endpoint } = ((await req.json().catch(() => null)) ?? {}) as { endpoint?: string };
  if (endpoint) await run("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?", endpoint, me.id);
  return new NextResponse(null, { status: 204 });
}
