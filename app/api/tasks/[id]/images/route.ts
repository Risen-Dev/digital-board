import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { all, get, run, transaction } from "@/lib/db";
import { taskGuard } from "@/lib/canvas/guard";

/**
 * Images inside a card. Only raster images are accepted: the bytes are served
 * inline from this origin, and an SVG would run its script here.
 */
const IMAGE = /^image\/(png|jpeg|gif|webp|avif)$/;
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_IMAGES = 20;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!await taskGuard(id, true)) return new NextResponse("You cannot edit this task.", { status: 403 });
  const files = ((await req.formData().catch(() => null))?.getAll("files") ?? []).filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return new NextResponse("Pick an image.", { status: 400 });
  if (files.some((f) => !IMAGE.test(f.type))) return new NextResponse("Only PNG, JPEG, GIF, WebP or AVIF images.", { status: 400 });
  if (files.some((f) => f.size > MAX_IMAGE)) return new NextResponse("Image larger than 5 MB.", { status: 413 });

  const saved = await Promise.all(files.map(async (f) => ({ name: f.name || "image", mime: f.type, data: Buffer.from(await f.arrayBuffer()) })));
  const error = await transaction(async () => {
    const { n } = (await get<{ n: number }>("SELECT COUNT(*) n FROM task_images WHERE task_id = ?", id))!;
    if (n + saved.length > MAX_IMAGES) return `At most ${MAX_IMAGES} images per card.`;
    const now = new Date().toISOString();
    for (const f of saved) {
      await run("INSERT INTO task_images (id, task_id, name, mime, data, created_at) VALUES (?,?,?,?,?,?)", randomUUID(), id, f.name, f.mime, f.data, now);
    }
  });
  if (error) return new NextResponse(error, { status: 413 });
  // The open dialog shows these; it keeps the task it opened with.
  return NextResponse.json(await all("SELECT id, name FROM task_images WHERE task_id = ? ORDER BY created_at, id", id));
}
