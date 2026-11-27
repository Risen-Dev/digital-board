import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { get } from "@/lib/db";
import { planEvent, type Payload } from "@/lib/github-events";
import { openGithub } from "@/lib/github";
import { applyIssue, applySteps, validSignature } from "@/lib/github-webhook";
import { nudgeBoard } from "@/lib/chat-live";

/**
 * GitHub webhook for one project: POST /api/integrations/github?project=<id>.
 * No session — the HMAC signature with the project's secret is the auth, and it
 * is checked before the body is parsed. Set it up under Settings → Projects →
 * the project → GitHub; events: Pull requests, Pushes, Check suites, Issues.
 */
export async function POST(req: Request) {
  const projectId = new URL(req.url).searchParams.get("project") ?? "";
  const body = await req.text();
  const row = await get<{ github: string | null; key: string; workspace_id: string }>("SELECT github, key, workspace_id FROM projects WHERE id = ?", projectId);
  const config = row?.github ? openGithub(row.github) : null;
  if (!config?.webhookSecret || !validSignature(config.webhookSecret, body, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }

  const event = req.headers.get("x-github-event") ?? "";
  if (event === "ping") return NextResponse.json({ ok: true });

  let payload: Payload;
  try {
    // Either content type GitHub offers: application/json, or form with the JSON in `payload`.
    payload = JSON.parse(body.startsWith("payload=") ? new URLSearchParams(body).get("payload") ?? "" : body);
  } catch {
    return NextResponse.json({ error: "Body is not JSON." }, { status: 400 });
  }
  // A secret reused across repos must not let another repo move this project's cards.
  if (payload.repository?.full_name?.toLowerCase() !== config.repo.toLowerCase()) {
    return NextResponse.json({ ignored: `Delivery is for ${payload.repository?.full_name}, not ${config.repo}.` }, { status: 202 });
  }

  // Checklist or labels edited on the card's issue.
  if (event === "issues" && payload.issue) {
    const t = await get<{ id: string }>(
      "SELECT t.id FROM tasks t JOIN columns c ON c.id = t.column_id WHERE c.project_id = ? AND t.github_issue = ?", projectId, payload.issue.number);
    const r = t && await applyIssue(t.id, { body: payload.issue.body ?? "", labels: payload.issue.labels.map((l) => l.name) });
    if (r && r.changed) {
      revalidatePath("/board");
      nudgeBoard(row!.workspace_id);
    }
    return NextResponse.json({ ok: true, synced: !!r && r.changed });
  }

  const done = await applySteps(projectId, planEvent(event, payload, row!.key));
  if (done.linked || done.moved || done.noted) {
    revalidatePath("/board");
    nudgeBoard(row!.workspace_id);
  }
  return NextResponse.json({ ok: true, ...done });
}
