"use client";

import { useCallback, useEffect, useRef } from "react";

import type {
  BinaryFileData,
  Collaborator,
  ExcalidrawImperativeAPI,
  SocketId,
} from "@excalidraw/excalidraw/types";

const POINTER_THROTTLE = 50;
const SCENE_THROTTLE = 100;

/**
 * Identifies this tab, so the same user in two tabs shows two cursors and a
 * tab never receives its own messages back. Not crypto.randomUUID: that only
 * exists in secure contexts and the dev server is plain http.
 */
const CLIENT = Math.random().toString(36).slice(2);

type Element = { id: string; version: number };

type LiveMessage = {
  from: string;
  name?: string;
  type: "pointer" | "scene" | "leave";
  pointer?: Collaborator["pointer"];
  button?: Collaborator["button"];
  elements?: Element[];
  files?: BinaryFileData[];
};

/**
 * Shows other people's cursors (with their names) and merges their edits into
 * the open sheet in near-real-time. Only changed elements travel; Excalidraw's
 * own reconcileElements decides which side wins per element by version.
 */
export function useCanvasLive(
  canvasId: string | null,
  api: ExcalidrawImperativeAPI | null,
  /** The sheet's initialData: whatever it loaded, peers already have. */
  loaded: Promise<Record<string, unknown> | null> | null,
) {
  /** Highest version of each element the peers already have. */
  const sentRef = useRef(new Map<string, number>());
  const sentFilesRef = useRef(new Set<string>());
  const lastPointerRef = useRef(0);
  const sceneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback(
    (message: Omit<LiveMessage, "from">) => {
      if (!canvasId) return;
      void fetch(`/api/canvas/${canvasId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...message, from: CLIENT }),
      }).catch(() => {
        // Live updates are best-effort; the snapshot save is what persists.
      });
    },
    [canvasId],
  );

  useEffect(() => {
    if (!canvasId || !api) return;

    const sent = sentRef.current;
    const sentFiles = sentFilesRef.current;
    const collaborators = new Map<SocketId, Collaborator>();
    let source: EventSource | null = null;
    let cancelled = false;

    void Promise.all([import("@excalidraw/excalidraw"), loaded]).then(
      ([{ reconcileElements, CaptureUpdateAction }, saved]) => {
        if (cancelled) return;

        // Don't re-broadcast the whole stored scene just because it loaded.
        for (const element of (saved?.elements ?? []) as Element[]) {
          sent.set(element.id, element.version);
        }
        for (const fileId of Object.keys(saved?.files ?? {})) sentFiles.add(fileId);

        source = new EventSource(`/api/canvas/${canvasId}?live=${CLIENT}`);
        source.onmessage = (event) => {
          const message = JSON.parse(event.data) as LiveMessage;
          const id = message.from as SocketId;

          if (message.type === "scene") {
            for (const file of message.files ?? []) sentFiles.add(file.id);
            if (message.files?.length) api.addFiles(message.files);

            for (const element of message.elements ?? []) {
              sent.set(element.id, Math.max(sent.get(element.id) ?? 0, element.version));
            }

            api.updateScene({
              elements: reconcileElements(
                api.getSceneElementsIncludingDeleted(),
                (message.elements ?? []) as never,
                api.getAppState(),
              ),
              captureUpdate: CaptureUpdateAction.NEVER,
            });
            return;
          }

          if (message.type === "leave") {
            collaborators.delete(id);
          } else {
            collaborators.set(id, {
              username: message.name,
              pointer: message.pointer,
              button: message.button,
            });
          }

          api.updateScene({ collaborators: new Map(collaborators) });
        };
      },
    );

    return () => {
      cancelled = true;
      source?.close();
      sent.clear();
      sentFiles.clear();
      if (sceneTimerRef.current) clearTimeout(sceneTimerRef.current);
      sceneTimerRef.current = null;
    };
  }, [canvasId, api, loaded]);

  const onPointerUpdate = useCallback(
    (payload: {
      pointer: NonNullable<Collaborator["pointer"]>;
      button: "up" | "down";
    }) => {
      const now = Date.now();
      if (now - lastPointerRef.current < POINTER_THROTTLE) return;
      lastPointerRef.current = now;
      send({ type: "pointer", pointer: payload.pointer, button: payload.button });
    },
    [send],
  );

  /** Call from Excalidraw's onChange; sends only what peers don't have yet. */
  const onChange = useCallback(() => {
    if (!api || sceneTimerRef.current) return;

    sceneTimerRef.current = setTimeout(() => {
      sceneTimerRef.current = null;
      const sent = sentRef.current;

      const elements = api
        .getSceneElementsIncludingDeleted()
        .filter((element) => element.version > (sent.get(element.id) ?? 0));
      if (!elements.length) return;

      const files = Object.values(api.getFiles()).filter(
        (file) => !sentFilesRef.current.has(file.id),
      );

      for (const element of elements) sent.set(element.id, element.version);
      for (const file of files) sentFilesRef.current.add(file.id);

      send({ type: "scene", elements, files });
    }, SCENE_THROTTLE);
  }, [api, send]);

  return { onPointerUpdate, onChange };
}
