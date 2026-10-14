import "server-only";
import { all, get } from "./db";
import { ciOf, type CiState } from "./board";
import { keysIn } from "./github-events";

/**
 * Per-project GitHub link, stored as JSON in `projects.github`: a repo and a
 * fine-grained personal access token (read-only is enough; blank works for a
 * public repo at GitHub's 60 requests/hour anonymous limit). The token never
 * leaves the server; the UI only ever sees `…last4` through listProjects.
 */
/** `webhookSecret` signs deliveries to /api/integrations/github (see lib/github-webhook.ts). */
export type GithubConfig = { repo: string; token: string; webhookSecret?: string };
export const GITHUB_KINDS = ["pulls", "issues", "commits", "branches"] as const;
export type GithubKind = (typeof GITHUB_KINDS)[number];

/** One row of the GitHub view, the same shape for every kind. */
export type GithubItem = {
  id: string;
  title: string;
  url: string;
  /** open | closed | merged | draft for PRs and issues; null for commits and branches. */
  state: string | null;
  /** #123, a short sha, or a branch's head sha. */
  ref: string;
  author: string | null;
  at: string | null;
  /** Small extra facts: labels, head→base, comment count. */
  meta: string[];
  /** Pull requests only: head branch and sha, for linking and CI. */
  head?: { ref: string; sha: string };
};

export const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export async function githubConfig(projectId: string): Promise<GithubConfig | null> {
  const row = await get<{ github: string | null }>("SELECT github FROM projects WHERE id = ?", projectId);
  return row?.github ? JSON.parse(row.github) : null;
}

export class GithubError extends Error {}

async function gh<T>(config: GithubConfig, path: string): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${config.repo}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
      "x-github-api-version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (res.ok) return res.json();
  if (res.status === 401) throw new GithubError("GitHub rejected the token. It may have expired; save a new one in Settings.");
  if (res.status === 404) {
    throw new GithubError(config.token ? `Repository ${config.repo} not found, or the token can't read it.` : `Repository ${config.repo} not found. A private repo needs a token.`);
  }
  if (res.status === 403 || res.status === 429) throw new GithubError("GitHub rate limit or permission error. Try again in a minute.");
  throw new GithubError(`GitHub answered ${res.status}.`);
}

/** Checks a repo + token pair before saving it; returns the repo's canonical full name. */
export async function verifyGithub(config: GithubConfig) {
  const repo = await gh<{ full_name: string }>(config, "");
  return repo.full_name;
}

type User = { login: string } | null;
type Pull = { number: number; title: string; html_url: string; state: string; draft: boolean; merged_at: string | null; user: User; updated_at: string; head: { ref: string; sha: string }; base: { ref: string } };
type Issue = { number: number; title: string; html_url: string; state: string; user: User; updated_at: string; comments: number; labels: { name: string }[]; pull_request?: unknown };
type Commit = { sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } | null }; author: User };
type Branch = { name: string; protected: boolean; commit: { sha: string } };

const PER_PAGE = 30;

async function load(config: GithubConfig, kind: GithubKind): Promise<GithubItem[]> {
  const repoUrl = `https://github.com/${config.repo}`;
  switch (kind) {
    case "pulls":
      return (await gh<Pull[]>(config, `/pulls?state=all&sort=updated&direction=desc&per_page=${PER_PAGE}`)).map((p) => ({
        id: String(p.number), title: p.title, url: p.html_url,
        state: p.merged_at ? "merged" : p.draft && p.state === "open" ? "draft" : p.state,
        ref: `#${p.number}`, author: p.user?.login ?? null, at: p.updated_at, meta: [`${p.head.ref} → ${p.base.ref}`],
        head: { ref: p.head.ref, sha: p.head.sha },
      }));
    case "issues":
      // The issues endpoint also returns PRs; those live in their own tab.
      return (await gh<Issue[]>(config, `/issues?state=all&sort=updated&direction=desc&per_page=${PER_PAGE}`))
        .filter((i) => !i.pull_request)
        .map((i) => ({
          id: String(i.number), title: i.title, url: i.html_url, state: i.state,
          ref: `#${i.number}`, author: i.user?.login ?? null, at: i.updated_at,
          meta: [...i.labels.map((l) => l.name), ...(i.comments ? [`${i.comments} comment${i.comments === 1 ? "" : "s"}`] : [])],
        }));
    case "commits":
      return (await gh<Commit[]>(config, `/commits?per_page=${PER_PAGE}`)).map((c) => ({
        id: c.sha, title: c.commit.message.split("\n")[0], url: c.html_url, state: null,
        ref: c.sha.slice(0, 7), author: c.author?.login ?? c.commit.author?.name ?? null, at: c.commit.author?.date ?? null, meta: [],
      }));
    case "branches":
      return (await gh<Branch[]>(config, `/branches?per_page=100`)).map((b) => ({
        id: b.name, title: b.name, url: `${repoUrl}/tree/${encodeURIComponent(b.name)}`, state: null,
        ref: b.commit.sha.slice(0, 7), author: null, at: null, meta: b.protected ? ["protected"] : [],
      }));
  }
}

// ponytail: in-process cache, per server instance; fine for one self-hosted node.
const cache = new Map<string, { at: number; items: GithubItem[] }>();
const TTL = 60_000;

/** A project's PRs / issues / commits / branches, cached for a minute so the view can't burn the rate limit. */
export async function githubItems(projectId: string, config: GithubConfig, kind: GithubKind, fresh = false) {
  // The token is part of the key, so saving a new one never serves the old token's data.
  const key = `${projectId}:${kind}:${config.repo}:${config.token.slice(-8)}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.items;
  const items = await load(config, kind);
  cache.set(key, { at: Date.now(), items });
  return items;
}

export type TaskLinks = { pulls: (GithubItem & { ci?: CiState })[]; commits: GithubItem[]; branches: GithubItem[] };

type CheckRuns = { check_runs: { status: string; conclusion: string | null }[] };

const ciCache = new Map<string, { at: number; ci: CiState }>();

async function ciFor(config: GithubConfig, sha: string): Promise<CiState> {
  const hit = ciCache.get(sha);
  if (hit && Date.now() - hit.at < TTL) return hit.ci;
  // A token without the Checks permission gets 403 here; that only hides the badge.
  const ci = await gh<CheckRuns>(config, `/commits/${sha}/check-runs?per_page=100`).then((r) => ciOf(r.check_runs), () => null);
  ciCache.set(sha, { at: Date.now(), ci });
  return ci;
}

/**
 * Which PRs, commits and branches mention which task key. Built from the same
 * cached lists as the GitHub view (30 PRs, 30 commits, 100 branches) plus
 * whatever the webhook stored in task_links, so links older than that window
 * show only for projects with the webhook set up. CI is fetched for linked open PRs only.
 */
export async function githubLinks(projectId: string, config: GithubConfig, projectKey: string, fresh = false) {
  // GitHub down or rate-limited: still serve what the webhook stored.
  const [pulls, commits, branches] = await Promise.all(
    (["pulls", "commits", "branches"] as const).map((k) => githubItems(projectId, config, k, fresh)),
  ).catch(() => [[], [], []] as GithubItem[][]);
  const links: Record<string, TaskLinks> = {};
  const add = (kind: keyof TaskLinks, text: string, item: GithubItem) => {
    for (const key of keysIn(text, projectKey)) {
      const entry = (links[key] ??= { pulls: [], commits: [], branches: [] });
      entry[kind].push(item);
    }
  };
  for (const p of pulls) add("pulls", `${p.title} ${p.head?.ref ?? ""}`, p);
  for (const c of commits) add("commits", c.title, c);
  for (const b of branches) add("branches", b.title, b);

  // Older links the webhook stored (task_links); the live lists above win on duplicates.
  const stored = await all<{
    task_key: string; kind: keyof TaskLinks; ext_id: string; title: string; url: string; ref: string;
    state: string | null; author: string | null; sha: string | null; ci: CiState; at: string | null;
  }>(
    `SELECT p.key || '-' || t.number AS task_key, l.kind, l.ext_id, l.title, l.url, l.ref, l.state, l.author, l.sha, l.ci, l.at
       FROM task_links l JOIN tasks t ON t.id = l.task_id JOIN columns c ON c.id = t.column_id JOIN projects p ON p.id = c.project_id
      WHERE c.project_id = ? ORDER BY l.at DESC NULLS LAST`,
    projectId,
  );
  for (const r of stored) {
    const entry = (links[r.task_key] ??= { pulls: [], commits: [], branches: [] });
    if (entry[r.kind].some((i) => i.id === r.ext_id)) continue;
    entry[r.kind].push({
      id: r.ext_id, title: r.title, url: r.url, state: r.state, ref: r.ref, author: r.author, at: r.at, meta: [],
      ...(r.sha ? { head: { ref: "", sha: r.sha } } : {}), ...(r.ci ? { ci: r.ci } : {}),
    });
  }

  await Promise.all(Object.values(links).flatMap((l) => l.pulls.map(async (p, i) => {
    // A CI state the webhook already stored saves the API call.
    if ((p.state === "open" || p.state === "draft") && p.ci === undefined) l.pulls[i] = { ...p, ci: p.head ? await ciFor(config, p.head.sha) : null };
  })));
  return links;
}
