import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { get } from "@/lib/db";
import { planEvent, type Payload } from "@/lib/github-events";
import { applySteps, validSignature } from "@/lib/github-webhook";

/**
 * GitHub webhook for one project: POST /api/integrations/github?project=<id>.
 * No session — the HMAC signature with the project's secret is the auth, and it
 * is checked before the body is parsed. Set it up under Settings → Projects →
 * the project → GitHub; events: Pull requests, Pushes, Check suites.
 */
export async function POST(req: Request) {
  const projectId = new URL(req.url).searchParams.get("project") ?? "";
  const body = await req.text();
  const row = await get<{ github: string | null; key: string }>("SELECT github, key FROM projects WHERE id = ?", projectId);
  const config = row?.github ? (JSON.parse(row.github) as { repo: string; webhookSecret?: string }) : null;
  if (!config?.webhookSecret || !validSignature(config.webhookSecret, body, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }

  const event = req.headers.get("x-github-event") ?? "";
  if (event === "ping") return NextResponse.json({ ok: true });

  let payload: Payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Body is not JSON. Set the webhook content type to application/json." }, { status: 400 });
  }
  // A secret reused across repos must not let another repo move this project's cards.
  if (payload.repository?.full_name?.toLowerCase() !== config.repo.toLowerCase()) {
    return NextResponse.json({ ignored: `Delivery is for ${payload.repository?.full_name}, not ${config.repo}.` }, { status: 202 });
  }

  const done = await applySteps(projectId, planEvent(event, payload, row!.key));
  if (done.linked || done.moved || done.noted) revalidatePath("/board");
  return NextResponse.json({ ok: true, ...done });
}
