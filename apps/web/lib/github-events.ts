/**
 * Pure planning for GitHub webhook deliveries: payload in, a list of things to
 * do out. No I/O, so lib/board.check.ts can test it; the route applies the plan.
 */

/** Every task key (WEB-42) a piece of text mentions, for this project's key only, normalised to upper case. */
export function keysIn(text: string, projectKey: string) {
  const re = new RegExp(`\\b${projectKey}-(\\d+)\\b`, "gi");
  return [...new Set([...text.matchAll(re)].map((m) => `${projectKey}-${Number(m[1])}`))];
}

/** Where a card should go. Resolved to a column by name (columnFor), and only ever forward. */
export type Target = "progress" | "review" | "merged";

export type Link = {
  kind: "pulls" | "commits" | "branches";
  extId: string;
  title: string;
  url: string;
  ref: string;
  state: string | null;
  author: string | null;
  sha: string | null;
  at: string | null;
};

export type Step =
  | { key: string; link: Link }
  | { key: string; unlink: { kind: Link["kind"]; extId: string } }
  | { key: string; move: Target; why: string }
  | { key: string; note: string }
  | { sha: string; ci: "success" | "failure" };

type User = { login: string } | null;
type PullRequest = {
  number: number; title: string; html_url: string; state: string; draft: boolean; merged: boolean;
  user: User; updated_at: string; head: { ref: string; sha: string };
};
export type Payload = {
  action?: string;
  pull_request?: PullRequest;
  ref?: string;
  deleted?: boolean;
  repository?: { html_url?: string; full_name?: string };
  commits?: { id: string; message: string; url: string; timestamp: string; author: { username?: string; name: string } }[];
  issue?: { number: number; body: string | null; labels: { name: string }[] };
  check_suite?: { conclusion: string | null; head_branch: string | null; head_sha: string };
};

const BRANCH_PREFIX = "refs/heads/";

export function planEvent(event: string, p: Payload, projectKey: string): Step[] {
  const steps: Step[] = [];

  if (event === "pull_request" && p.pull_request) {
    const pr = p.pull_request;
    const state = pr.merged ? "merged" : pr.draft && pr.state === "open" ? "draft" : pr.state;
    const link: Link = {
      kind: "pulls", extId: String(pr.number), title: pr.title, url: pr.html_url, ref: `#${pr.number}`,
      state, author: pr.user?.login ?? null, sha: pr.head.sha, at: pr.updated_at,
    };
    for (const key of keysIn(`${pr.title} ${pr.head.ref}`, projectKey)) {
      steps.push({ key, link });
      if (p.action === "closed" && pr.merged) steps.push({ key, move: "merged", why: `PR #${pr.number} merged` });
      else if (["opened", "reopened", "ready_for_review"].includes(p.action ?? "") && !pr.draft) {
        steps.push({ key, move: "review", why: `PR #${pr.number} opened` });
      }
    }
  }

  if (event === "push" && p.ref?.startsWith(BRANCH_PREFIX)) {
    const branch = p.ref.slice(BRANCH_PREFIX.length);
    const repo = p.repository?.html_url ?? "";
    // The branch name decides the move; commit messages only link.
    for (const key of keysIn(branch, projectKey)) {
      if (p.deleted) {
        steps.push({ key, unlink: { kind: "branches", extId: branch } });
        continue;
      }
      steps.push({
        key,
        link: { kind: "branches", extId: branch, title: branch, url: `${repo}/tree/${encodeURIComponent(branch)}`, ref: branch, state: null, author: null, sha: null, at: null },
      });
      steps.push({ key, move: "progress", why: `pushed to ${branch}` });
    }
    for (const c of p.commits ?? []) {
      for (const key of keysIn(c.message, projectKey)) {
        steps.push({
          key,
          link: {
            kind: "commits", extId: c.id, title: c.message.split("\n")[0], url: c.url, ref: c.id.slice(0, 7),
            state: null, author: c.author.username ?? c.author.name, sha: c.id, at: c.timestamp,
          },
        });
      }
    }
  }

  if (event === "check_suite" && p.action === "completed" && p.check_suite) {
    const suite = p.check_suite;
    if (suite.conclusion === "success") steps.push({ sha: suite.head_sha, ci: "success" });
    if (suite.conclusion === "failure" || suite.conclusion === "timed_out") {
      steps.push({ sha: suite.head_sha, ci: "failure" });
      for (const key of keysIn(suite.head_branch ?? "", projectKey)) {
        steps.push({ key, note: `GitHub: checks failed on ${suite.head_branch}` });
      }
    }
  }

  return steps;
}

/** Column names each target looks for, first match wins (case-insensitive). */
const TARGET_COLUMNS: Record<Target, string[]> = {
  progress: ["in progress", "doing", "writing / design"],
  review: ["in review", "review"],
  merged: ["qa", "done", "resolved", "published"],
};

/**
 * The column a target lands in, or null when the board has none of those names
 * or the card is already at or past it (cards never move backwards).
 */
export function columnFor<C extends { id: string; title: string; position: number }>(
  target: Target, columns: C[], current: number,
) {
  for (const name of TARGET_COLUMNS[target]) {
    const col = columns.find((c) => c.title.trim().toLowerCase() === name);
    if (col) return col.position > current ? col : null;
  }
  return null;
}

/*
 * Checklist ⇄ issue body. The checklist lives between two HTML comments, which
 * GitHub doesn't render, so the rest of the body (anything people wrote on
 * GitHub) is never touched.
 */
type CheckItem = { text: string; done: boolean };
const START = "<!-- digital-board:checklist -->";
const END = "<!-- /digital-board:checklist -->";
const BLOCK = /<!-- digital-board:checklist -->[\s\S]*?<!-- \/digital-board:checklist -->/;
const FOOTER = "\n---\nFrom digital board card";

export const checklistBlock = (items: CheckItem[]) =>
  `${START}\n${items.map((i) => `- [${i.done ? "x" : " "}] ${i.text}`).join("\n")}\n${END}`;

/** The body with its checklist block replaced, or added above the card footer (or at the end). */
export function withChecklist(body: string, items: CheckItem[]) {
  const block = checklistBlock(items);
  if (BLOCK.test(body)) return body.replace(BLOCK, () => block);
  if (!items.length) return body;
  const plain = body.replace(/\r\n/g, "\n");
  const at = plain.indexOf(FOOTER);
  return at < 0 ? `${plain.trimEnd()}\n\n${block}` : `${plain.slice(0, at).trimEnd()}\n\n${block}\n${plain.slice(at)}`;
}

/** The checklist inside the block; null when the body has no block yet. */
export function checklistIn(body: string): CheckItem[] | null {
  const block = body.match(BLOCK)?.[0];
  if (!block) return null;
  return [...block.matchAll(/^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/gm)].map((m) => ({ text: m[2], done: m[1] !== " " }));
}
