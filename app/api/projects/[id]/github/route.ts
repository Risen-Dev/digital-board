import { NextResponse } from "next/server";
import { guard } from "@/lib/canvas/guard";
import { GITHUB_KINDS, GithubError, githubConfig, githubItems, type GithubKind } from "@/lib/github";

/** GET ?kind=pulls|issues|commits|branches[&fresh=1] — the project's GitHub rows, for anyone who can open the project. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!await guard(id)) return new NextResponse("Not found", { status: 404 });

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") as GithubKind;
  if (!GITHUB_KINDS.includes(kind)) return NextResponse.json({ error: "Unknown kind." }, { status: 400 });

  const config = await githubConfig(id);
  if (!config) return NextResponse.json({ error: "This project is not connected to GitHub." }, { status: 404 });

  try {
    const items = await githubItems(id, config, kind, url.searchParams.get("fresh") === "1");
    return NextResponse.json({ repo: config.repo, items }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const message = e instanceof GithubError ? e.message : "Could not reach GitHub.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
