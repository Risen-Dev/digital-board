"use client";

import { useCallback, useEffect, useEffectEvent, useRef } from "react";

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
  type: "pointer" | "scene" | "join" | "leave" | "deleted";
  pointer?: Collaborator["pointer"];
  button?: Collaborator["button"];
  elements?: Element[];
  files?: BinaryFileData[];
};

/**
 * Shows other people's cursors (with their names) and merges their edits into
 * the open sheet in near-real-time. Only changed elements travel; Excalidraw's
 * own reconcileElements decides which side wins per element by version.
 *
 * Whenever any tab (re)connects, it and every peer exchange full scenes, so
 * edits made while someone was loading or offline still reach them.
 */
export function useCanvasLive(
  canvasId: string | null,
  api: ExcalidrawImperativeAPI | null,
  /** The sheet's initialData: connect only after it loaded, or it would overwrite merged peer edits. */
  loaded: Promise<unknown> | null,
  /** Told about each merged remote scene, so this tab doesn't re-save it. */
  onRemote: (elements: readonly unknown[], appState: object) => void,
  /** Someone else deleted this sheet. */
  onDeleted: () => void,
) {
  // Callers pass fresh closures each render; these keep the stream from reconnecting.
  const remoteMerged = useEffectEvent(onRemote);
  const sheetDeleted = useEffectEvent(onDeleted);

  /** Highest version of each element the peers already have. */
  const sentRef = useRef(new Map<string, number>());
  const sentFilesRef = useRef(new Set<string>());
  const lastPointerRef = useRef(0);
  const sceneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Sends unsent changes; set only while the live stream is open. */
  const sendChangesRef = useRef<(() => void) | null>(null);

  const send = useCallback(
    (message: Omit<LiveMessage, "from">) => {
      if (!canvasId) return;
      void fetch(`/api/canvas/${canvasId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...message, from: CLIENT }),
      })
        .then((response) => {
          // Peers may have missed it: resend everything with the next change.
          if (!response.ok) sentRef.current.clear();
        })
        .catch(() => sentRef.current.clear());
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

    // ponytail: a full exchange resends every image on each (re)connect; offer file ids first if image-heavy sheets get slow.
    const sendScene = (all: boolean) => {
      const elements = api
        .getSceneElementsIncludingDeleted()
        .filter((element) => all || element.version > (sent.get(element.id) ?? 0));
      if (!elements.length) return;

      const files = Object.values(api.getFiles()).filter(
        (file) => all || !sentFiles.has(file.id),
      );

      for (const element of elements) sent.set(element.id, element.version);
      for (const file of files) sentFiles.add(file.id);

      send({ type: "scene", elements, files });
    };

    void Promise.all([import("@excalidraw/excalidraw"), loaded]).then(
      ([{ reconcileElements, CaptureUpdateAction }]) => {
        if (cancelled) return;

        source = new EventSource(`/api/canvas/${canvasId}?live=${CLIENT}`);
        source.onopen = () => {
          sendChangesRef.current = () => sendScene(false);
          sendScene(true);
        };
        source.onerror = () => {
          // EventSource reconnects by itself; onopen then resyncs.
          sendChangesRef.current = null;
          collaborators.clear();
          api.updateScene({ collaborators: new Map() });
        };
        source.onmessage = (event) => {
          const message = JSON.parse(event.data) as LiveMessage;
          const id = message.from as SocketId;

          if (message.type === "deleted") {
            source?.close();
            sheetDeleted();
            return;
          }

          if (message.type === "join") {
            sendScene(true);
            return;
          }

          if (message.type === "scene") {
            for (const file of message.files ?? []) sentFiles.add(file.id);
            if (message.files?.length) api.addFiles(message.files);

            for (const element of message.elements ?? []) {
              sent.set(element.id, Math.max(sent.get(element.id) ?? 0, element.version));
            }

            const appState = api.getAppState();
            const elements = reconcileElements(
              api.getSceneElementsIncludingDeleted(),
              (message.elements ?? []) as never,
              appState,
            );

            remoteMerged(elements, appState);
            api.updateScene({
              elements,
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
      sendChangesRef.current = null;
      sent.clear();
      sentFiles.clear();
      if (sceneTimerRef.current) clearTimeout(sceneTimerRef.current);
      sceneTimerRef.current = null;
    };
  }, [canvasId, api, loaded, send]);

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
    if (sceneTimerRef.current) return;

    sceneTimerRef.current = setTimeout(() => {
      sceneTimerRef.current = null;
      sendChangesRef.current?.();
    }, SCENE_THROTTLE);
  }, []);

  return { onPointerUpdate, onChange };
}
