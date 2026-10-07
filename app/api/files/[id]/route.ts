import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { get } from "@/lib/db";

/**
 * Attachments are never public. A session alone is not enough: the id is
 * guessable-ish and an attachment belongs to a message, which belongs to a
 * workspace — and, if it is a DM, to two specific people. Both are checked here.
 */
const SAFE_INLINE = /^(image\/(png|jpeg|gif|webp|avif)|application\/pdf|video\/(mp4|webm)|audio\/(mpeg|ogg|wav|webm))$/;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const row = await get<{ name: string; mime: string; size: number; data: Buffer | null; workspace_id: string; author_id: string; recipient_id: string | null }>(
    `SELECT a.name, a.mime, a.size, a.data, m.workspace_id, m.author_id, m.recipient_id
       FROM attachments a JOIN messages m ON m.id = a.message_id
      WHERE a.id = ?`,
    id,
  );
  if (!row) return new NextResponse("Not found", { status: 404 });
  if (row.workspace_id !== user.workspace_id) return new NextResponse("Not found", { status: 404 });
  // A DM's files are for its two participants only.
  if (row.recipient_id !== null && row.author_id !== user.id && row.recipient_id !== user.id) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!row.data) return new NextResponse("Attachment needs migration", { status: 410 });

  // The mime type is whatever the uploader claimed. Rendering HTML or SVG inline
  // would run a member's script on this origin with the viewer's session, so
  // only plain media is shown inline; everything else downloads.
  const inline = SAFE_INLINE.test(row.mime);
  return new NextResponse(row.data as unknown as BodyInit, {
    headers: {
      "content-type": inline ? row.mime : "application/octet-stream",
      "content-length": String(row.size),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
