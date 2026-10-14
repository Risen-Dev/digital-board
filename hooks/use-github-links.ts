"use client";

import { useEffect, useState } from "react";
import type { TaskLinks } from "@/lib/github";

/**
 * Task key → linked PRs / commits / branches for a GitHub-linked project. `version`
 * refetches (e.g. after a board refresh); the server caches GitHub for a minute,
 * so this never costs more than one GitHub round per minute per project.
 */
export function useGithubLinks(projectId: string | null, enabled: boolean, version: unknown) {
  const [links, setLinks] = useState<{ projectId: string; map: Record<string, TaskLinks> } | null>(null);

  useEffect(() => {
    if (!projectId || !enabled) return;
    let alive = true;
    fetch(`/api/projects/${projectId}/github?kind=links`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (alive && body?.links) setLinks({ projectId, map: body.links }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [projectId, enabled, version]);

  // Never show one project's links on another's cards while the new ones load.
  return enabled && links?.projectId === projectId ? links.map : {};
}
