"use client";

import { useEffect, useState } from "react";
import { CircleCheck, CircleDot, ExternalLink, GitBranch, GitCommitHorizontal, GitMerge, GitPullRequest, RefreshCw } from "lucide-react";
import type { GithubItem, GithubKind } from "@/lib/github";

const TABS: { kind: GithubKind; label: string }[] = [
  { kind: "pulls", label: "Pull requests" },
  { kind: "issues", label: "Issues" },
  { kind: "commits", label: "Commits" },
  { kind: "branches", label: "Branches" },
];

const ago = (iso: string | null) => {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString();
};

/** Icon + colour per state, GitHub's own convention: green open, purple merged, grey closed/draft. */
function StateIcon({ kind, state }: { kind: GithubKind; state: string | null }) {
  const cls = "size-4 shrink-0";
  if (kind === "commits") return <GitCommitHorizontal className={`${cls} text-muted-foreground`} />;
  if (kind === "branches") return <GitBranch className={`${cls} text-muted-foreground`} />;
  const color = state === "open" ? "text-[var(--chart-2)]" : state === "merged" ? "text-[var(--chart-6)]" : "text-muted-foreground";
  if (kind === "pulls") {
    const Icon = state === "merged" ? GitMerge : GitPullRequest;
    return <Icon className={`${cls} ${color}`} aria-label={state ?? undefined} />;
  }
  const Icon = state === "open" ? CircleDot : CircleCheck;
  return <Icon className={`${cls} ${color}`} aria-label={state ?? undefined} />;
}

type Loaded = { kind: GithubKind; repo: string; items: GithubItem[] } | { kind: GithubKind; error: string };

export function GithubView({ projectId, repo }: { projectId: string; repo: string }) {
  const [kind, setKind] = useState<GithubKind>("pulls");
  const [data, setData] = useState<Loaded | null>(null);
  const [fresh, setFresh] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${projectId}/github?kind=${kind}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({ error: `Request failed (${res.status}).` }));
        if (alive) setData(body.error ? { kind, error: body.error } : { kind, ...body });
      })
      .catch(() => alive && setData({ kind, error: "Could not reach the server." }));
    return () => { alive = false; };
  }, [projectId, kind, fresh]);

  // Stale rows from the previous tab never show under the new one.
  const current = data?.kind === kind ? data : null;

  return (
    // The workspace's content area is overflow-hidden; every view scrolls itself (like ListView).
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-5">
        <div className="flex items-center gap-2">
          <a
            href={`https://github.com/${repo}`}
            target="_blank"
            rel="noreferrer"
            className="flex min-w-0 items-center gap-1.5 text-sm font-semibold hover:underline"
          >
            <span className="truncate">{repo}</span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
          </a>
          <button
            onClick={() => { setData(null); setFresh((n) => n + 1); }}
            title="Refresh from GitHub"
            aria-label="Refresh from GitHub"
            className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <RefreshCw className={`size-4 ${!current ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div role="tablist" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b">
          {TABS.map((t) => (
            <button
              key={t.kind}
              role="tab"
              aria-selected={kind === t.kind}
              onClick={() => setKind(t.kind)}
              className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-xs transition-colors ${
                kind === t.kind ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {!current ? (
          <p className="py-10 text-center text-xs text-muted-foreground">Loading from GitHub…</p>
        ) : "error" in current ? (
          <p role="alert" className="rounded-md bg-[rgba(239,68,68,0.08)] px-3 py-2 text-xs text-[#ef4444]">{current.error}</p>
        ) : current.items.length === 0 ? (
          <p className="rounded-lg border border-dashed py-10 text-center text-xs text-muted-foreground">Nothing here yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {current.items.map((item) => (
              <li key={item.id}>
                <a href={item.url} target="_blank" rel="noreferrer" className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-secondary/50">
                  <span className="mt-0.5"><StateIcon kind={kind} state={item.state} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{item.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="font-mono">{item.ref}</span>
                      {item.state && item.state !== "open" && <span className="capitalize">{item.state}</span>}
                      {item.author && <span>{item.author}</span>}
                      {item.at && <span>{ago(item.at)}</span>}
                      {item.meta.map((m) => (
                        <span key={m} className="rounded-full border px-1.5 py-px">{m}</span>
                      ))}
                    </p>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
        {current && !("error" in current) && current.items.length >= 30 && kind !== "branches" && (
          <a href={`https://github.com/${repo}/${kind === "commits" ? "commits" : kind}`} target="_blank" rel="noreferrer" className="text-center text-xs text-muted-foreground underline">
            See more on GitHub
          </a>
        )}
      </div>
    </div>
  );
}
