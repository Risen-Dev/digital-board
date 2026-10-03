/**
 * Server-side merge of a canvas save into what is already stored.
 *
 * Each tab saves its whole scene, so with several people on one sheet a plain
 * overwrite loses whichever edit lands first. Merging per element by version
 * (Excalidraw's own rule: higher version wins, tie → lower versionNonce) makes
 * the stored scene the union of every save, whatever order they arrive in.
 *
 * Deletions travel as tombstones (`isDeleted: true`, version bumped) so a stale
 * save can't resurrect them; tombstones are dropped after a day.
 */

type Element = {
  id: string;
  version: number;
  versionNonce: number;
  index?: string | null;
  isDeleted?: boolean;
  updated?: number;
  fileId?: string | null;
};

export type Snapshot = {
  elements?: Element[];
  files?: Record<string, unknown>;
  [key: string]: unknown;
};

// ponytail: a peer offline for longer than this can resurrect what was deleted meanwhile.
const TOMBSTONE_TTL = 24 * 60 * 60 * 1000;

export function mergeSnapshots(
  stored: Snapshot | null,
  incoming: Snapshot,
  now = Date.now(),
): Snapshot {
  const byId = new Map<string, Element>();

  for (const element of [...(stored?.elements ?? []), ...(incoming.elements ?? [])]) {
    const current = byId.get(element.id);
    if (
      !current ||
      element.version > current.version ||
      (element.version === current.version && element.versionNonce < current.versionNonce)
    ) {
      byId.set(element.id, element);
    }
  }

  const elements = [...byId.values()]
    .filter((element) => !element.isDeleted || now - (element.updated ?? 0) < TOMBSTONE_TTL)
    // Fractional indices order by plain string comparison.
    .sort((a, b) => ((a.index ?? "") < (b.index ?? "") ? -1 : (a.index ?? "") > (b.index ?? "") ? 1 : 0));

  const usedFiles = new Set(
    elements.filter((element) => !element.isDeleted).map((element) => element.fileId),
  );
  const files = Object.fromEntries(
    Object.entries({ ...stored?.files, ...incoming.files }).filter(([id]) => usedFiles.has(id)),
  );

  return { ...incoming, elements, files };
}
