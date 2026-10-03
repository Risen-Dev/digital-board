"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { saveCanvasSnapshot } from "@/lib/canvas/api";

const SAVE_DEBOUNCE = 300;
const KEEPALIVE_MAX_BYTES = 60_000;

type SaveStatus = "idle" | "saving" | "error";

type SceneSnapshot = {
  canvasId: string;
  /** sceneKey() of this scene; equal keys mean nothing worth saving changed. */
  key: string;
  version: number;
  elements: readonly unknown[];
  appState: object;
  files: object;
};

type SerializeAsJSON = (
  elements: never,
  appState: never,
  files: never,
  source: "local",
) => string;

let serializerPromise: Promise<SerializeAsJSON> | null = null;

function loadSerializer(): Promise<SerializeAsJSON> {
  if (!serializerPromise) {
    serializerPromise = import("@excalidraw/excalidraw").then(
      (module) =>
        module.serializeAsJSON as unknown as SerializeAsJSON,
    );
  }

  return serializerPromise;
}

/**
 * Fingerprint of what a save would actually change. Every element edit,
 * deletes included, bumps that element's version; scroll, zoom, selection
 * and remote cursors don't touch it. Background defaults to Excalidraw's
 * white so an empty new sheet matches its stored `null` snapshot.
 */
function sceneKey(
  canvasId: string,
  elements: readonly unknown[],
  appState: object,
) {
  const versions = elements.reduce(
    (sum: number, element) =>
      sum + (element as { version: number }).version,
    0,
  );
  const background =
    (appState as { viewBackgroundColor?: string })
      .viewBackgroundColor ?? "#ffffff";

  return `${canvasId}:${versions}:${background}`;
}

export function useCanvasPersistence(
  activeId: string | null,
  /** The sheet's initialData: what's already stored needs no save. */
  loaded: Promise<Record<string, unknown> | null> | null,
) {
  const [status, setStatus] =
    useState<SaveStatus>("idle");

  const timerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const latestSceneRef =
    useRef<SceneSnapshot | null>(null);

  const versionRef = useRef(0);

  /** Fingerprint of the last scene seen, to ignore non-drawing changes. */
  const sceneKeyRef = useRef<string | null>(null);

  /** sceneKey() of what each canvas has stored on the server. */
  const storedKeysRef = useRef(new Map<string, string>());

  useEffect(() => {
    if (!activeId || !loaded) {
      return;
    }

    void loaded
      .then((saved) => {
        storedKeysRef.current.set(
          activeId,
          sceneKey(
            activeId,
            (saved?.elements ?? []) as unknown[],
            (saved?.appState ?? {}) as object,
          ),
        );
      })
      .catch(() => {
        // A failed load just means the first change saves; nothing to do.
      });
  }, [activeId, loaded]);

  /**
   * Save queue prevents this:
   *
   * save A -----------> DB
   * save B ---> DB
   *
   * followed by save A finishing later and overwriting B.
   */
  const saveQueueRef = useRef<Promise<void>>(
    Promise.resolve(),
  );

  const serializerRef =
    useRef<SerializeAsJSON | null>(null);

  /**
   * Track successfully persisted versions per canvas.
   */
  const savedVersionsRef = useRef(
    new Map<string, number>(),
  );

  /**
   * Preload the serializer.
   *
   * This is important because when the user navigates away we
   * don't want the final save to first wait for a dynamic import.
   */
  useEffect(() => {
    let cancelled = false;

    void loadSerializer().then((serializer) => {
      if (!cancelled) {
        serializerRef.current = serializer;
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(
    async (
      scene: SceneSnapshot,
      keepalive = false,
    ) => {
      const alreadySaved =
        savedVersionsRef.current.get(scene.canvasId) ?? 0;

      if (
        scene.version <= alreadySaved ||
        storedKeysRef.current.get(scene.canvasId) === scene.key
      ) {
        return;
      }

      let serializer = serializerRef.current;

      if (!serializer) {
        serializer = await loadSerializer();
        serializerRef.current = serializer;
      }

      const data = JSON.parse(
        serializer(
          scene.elements as never,
          scene.appState as never,
          scene.files as never,
          "local",
        ),
      );

      /**
       * serializeAsJSON drops deleted elements. Keep them as tombstones so the
       * server-side merge (lib/canvas/merge.ts) can't resurrect a deletion
       * from another tab's older save.
       */
      data.elements = scene.elements;

      const body = JSON.stringify(data);

      /**
       * Browser keepalive requests have a small payload limit.
       *
       * This is only the emergency pagehide save.
       * Normal autosave happens every 300 ms.
       */
      if (
        keepalive &&
        new Blob([body]).size > KEEPALIVE_MAX_BYTES
      ) {
        return;
      }

      setStatus("saving");

      const runSave = async () => {
        try {
          await saveCanvasSnapshot(
            scene.canvasId,
            body,
            keepalive,
          );

          savedVersionsRef.current.set(
            scene.canvasId,
            scene.version,
          );

          storedKeysRef.current.set(
            scene.canvasId,
            scene.key,
          );

          const latest = latestSceneRef.current;

          /**
           * Only show "Saved" if nothing newer appeared while
           * this request was running.
           */
          if (
            latest &&
            latest.canvasId === scene.canvasId &&
            latest.version === scene.version
          ) {
            setStatus("idle");
          }
        } catch (error) {
          console.error(
            "Failed to save canvas:",
            error,
          );

          setStatus("error");
        }
      };

      saveQueueRef.current = saveQueueRef.current
        .catch(() => {
          /**
           * Keep the queue alive even if an earlier request failed.
           */
        })
        .then(runSave);

      await saveQueueRef.current;
    },
    [],
  );

  const flush = useCallback(
    async (keepalive = false) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const scene = latestSceneRef.current;

      if (!scene) {
        return;
      }

      await persist(scene, keepalive);
    },
    [persist],
  );

  const onChange = useCallback(
    (
      elements: readonly unknown[],
      appState: object,
      files: object,
    ) => {
      if (!activeId) {
        return;
      }

      // onChange also fires for scroll, zoom, selection and remote cursors.
      const key = sceneKey(activeId, elements, appState);

      if (key === sceneKeyRef.current) {
        return;
      }

      sceneKeyRef.current = key;

      const version = ++versionRef.current;

      latestSceneRef.current = {
        canvasId: activeId,
        key,
        version,
        elements,
        appState,
        files,
      };

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        void flush();
      }, SAVE_DEBOUNCE);
    },
    [activeId, flush],
  );

  /**
   * Save when the page becomes hidden.
   *
   * visibilitychange normally happens before pagehide, giving
   * the regular fetch a better chance to finish.
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void flush();
      }
    };

    const handlePageHide = () => {
      void flush(true);
    };

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );

    window.addEventListener(
      "pagehide",
      handlePageHide,
    );

    return () => {
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );

      window.removeEventListener(
        "pagehide",
        handlePageHide,
      );

      /**
       * Next.js client-side navigation.
       */
      void flush();
    };
  }, [flush]);

  /**
   * Called when deliberately switching sheets.
   */
  const reset = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    latestSceneRef.current = null;
  }, []);

  /**
   * Used when deleting the currently active canvas.
   * We explicitly DON'T want the pending snapshot to save after
   * the canvas was deleted.
   */
  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    latestSceneRef.current = null;

    setStatus("idle");
  }, []);

  /**
   * A peer's edit was merged in. The editor's own tab saves it, so if this
   * tab had nothing unsaved, the merged scene counts as already stored.
   * With local unsaved work, leave it alone so that work still gets saved.
   */
  const markRemote = useCallback(
    (elements: readonly unknown[], appState: object) => {
      if (!activeId) {
        return;
      }

      const stored = storedKeysRef.current.get(activeId);

      if (stored === undefined || sceneKeyRef.current !== stored) {
        return;
      }

      storedKeysRef.current.set(
        activeId,
        sceneKey(activeId, elements, appState),
      );
    },
    [activeId],
  );

  return {
    status,
    onChange,
    markRemote,
    flush,
    reset,
    cancel,
  };
}
