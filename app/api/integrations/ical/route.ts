import { timingSafeEqual } from "node:crypto";
import { all, get } from "@/lib/db";
import { toIcal, type IcalTask } from "@/lib/ical";

/**
 * Read-only iCal feed of a project's dated tasks: GET /api/integrations/ical?project=<id>&token=<t>.
 * No session — calendar apps can't log in, so the token in the link is the auth.
 * Copy the link from the Calendar view → Subscribe.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("project") ?? "";
  const given = Buffer.from(url.searchParams.get("token") ?? "");
  const project = await get<{ name: string; ical_token: string | null }>("SELECT name, ical_token FROM projects WHERE id = ?", projectId);
  const saved = Buffer.from(project?.ical_token ?? "");
  if (!saved.length || given.length !== saved.length || !timingSafeEqual(given, saved)) {
    return new Response("Bad link.", { status: 401 });
  }

  const tasks = await all<IcalTask>(
    `SELECT t.id, p.key || '-' || t.number AS key, t.title, t.description, t.due_date AS "dueDate", c.title AS "column"
       FROM tasks t JOIN columns c ON c.id = t.column_id JOIN projects p ON p.id = c.project_id
      WHERE c.project_id = ? AND t.due_date IS NOT NULL
      ORDER BY t.due_date`,
    projectId,
  );
  return new Response(toIcal(project!.name, tasks), {
    headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store" },
  });
}
