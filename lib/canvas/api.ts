export type CanvasSnapshot = Record<string, unknown>;

export async function loadCanvasSnapshot(
  canvasId: string,
): Promise<CanvasSnapshot | null> {
  const response = await fetch(`/api/canvas/${canvasId}`, {
    cache: "no-store",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Failed to load canvas ${canvasId}: ${response.status}`,
    );
  }

  return response.json();
}

export async function saveCanvasSnapshot(
  canvasId: string,
  body: string,
  keepalive = false,
): Promise<void> {
  const response = await fetch(`/api/canvas/${canvasId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body,
    ...(keepalive ? { keepalive: true } : {}),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");

    throw new Error(
      `Failed to save canvas ${canvasId}: ${response.status} ${message}`,
    );
  }
}

/** Takes a template sheet's example flow; only the first caller gets it (see the seed route). */
export async function claimCanvasSeed(canvasId: string): Promise<{ flow: unknown; by: string } | null> {
  const response = await fetch(`/api/canvas/${canvasId}/seed`, { method: "POST" });
  return response.ok ? response.json() : null;
}
