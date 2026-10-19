import { NextResponse } from "next/server";
import { get, run } from "@/lib/db";
import { taskGuard } from "@/lib/canvas/guard";

type Params = { params: Promise<{ id: string; imageId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id, imageId } = await params;
  if (!await taskGuard(id)) return new NextResponse("Not found", { status: 404 });
  const image = await get<{ name: string; mime: string; data: Buffer }>(
    "SELECT name, mime, data FROM task_images WHERE id = ? AND task_id = ?", imageId, id,
  );
  if (!image) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(image.data as unknown as BodyInit, {
    headers: {
      "content-type": image.mime,
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(image.name)}`,
      "x-content-type-options": "nosniff",
      // An image id never gets new bytes.
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id, imageId } = await params;
  if (!await taskGuard(id, true)) return new NextResponse("You cannot edit this task.", { status: 403 });
  await run("DELETE FROM task_images WHERE id = ? AND task_id = ?", imageId, id);
  return new NextResponse(null, { status: 204 });
}
