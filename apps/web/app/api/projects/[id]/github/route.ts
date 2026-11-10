import { NextResponse } from "next/server";
import { guard } from "@/lib/canvas/guard";
import { get } from "@/lib/db";
import { GITHUB_KINDS, GithubError, githubConfig, githubItems, githubLinks, type GithubKind } from "@/lib/github";

/**
 * GET ?kind=pulls|issues|commits|branches|links[&fresh=1] — the project's GitHub rows,
 * or (links) which PRs/commits/branches mention which task key. Anyone who can open the project.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!await guard(id)) return new NextResponse("Not found", { status: 404 });

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") as GithubKind | "links";
  if (kind !== "links" && !GITHUB_KINDS.includes(kind)) return NextResponse.json({ error: "Unknown kind." }, { status: 400 });

  const config = await githubConfig(id);
  if (!config) return NextResponse.json({ error: "This project is not connected to GitHub." }, { status: 404 });

  try {
    const fresh = url.searchParams.get("fresh") === "1";
    if (kind === "links") {
      const { key } = (await get<{ key: string }>("SELECT key FROM projects WHERE id = ?", id))!;
      return NextResponse.json({ links: await githubLinks(id, config, key, fresh) }, { headers: { "cache-control": "no-store" } });
    }
    const items = await githubItems(id, config, kind, fresh);
    return NextResponse.json({ repo: config.repo, items }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const message = e instanceof GithubError ? e.message : "Could not reach GitHub.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
