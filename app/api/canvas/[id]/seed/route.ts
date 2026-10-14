import { NextResponse } from "next/server";
import { get } from "@/lib/db";
import { guard } from "@/lib/canvas/guard";

/**
 * Claims a template sheet's example flow (`seed`, see seedProject in lib/actions.ts).
 * One statement removes it and returns the old value, so when several editors open
 * the fresh sheet at once exactly one tab gets it and draws; the others receive the
 * drawing over live sync. Everyone else gets `null`.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const canvas = await get<{ project_id: string }>("SELECT project_id FROM canvases WHERE id = ?", id);
  if (!canvas || !await guard(canvas.project_id, true)) return new NextResponse("Not found", { status: 404 });

  // No jsonb `?` operator here: lib/db.ts rewrites every `?` into a placeholder.
  const row = await get<{ seed: string }>(
    `UPDATE canvases c SET snapshot = (c.snapshot::jsonb - 'seed')::text
       FROM (SELECT id, snapshot::jsonb -> 'seed' AS seed FROM canvases WHERE id = ? FOR UPDATE) old
      WHERE c.id = old.id AND old.seed IS NOT NULL
      RETURNING old.seed::text AS seed`,
    id,
  );
  return new NextResponse(row?.seed ?? "null", { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
