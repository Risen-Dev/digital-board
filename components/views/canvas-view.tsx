"use client";

import {
  Component,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import dynamic from "next/dynamic";
import {
  Check,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import "@excalidraw/excalidraw/index.css";

import {
  createCanvas,
  deleteCanvas,
  renameCanvas,
} from "@/lib/actions";

import type { CanvasMeta } from "@/lib/queries";

import { loadCanvasSnapshot } from "@/lib/canvas/api";

import { useCanvasPersistence } from "@/hooks/use-canvas-persistence";
import { useCanvasLive } from "@/hooks/use-canvas-live";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/**
 * Excalidraw is browser-only.
 *
 * Keep it out of the SSR bundle.
 */
const Excalidraw = dynamic(
  () =>
    import("@excalidraw/excalidraw").then(
      (module) => module.Excalidraw,
    ),
  {
    ssr: false,

    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading canvas…
      </div>
    ),
  },
);

class CanvasBoundary extends Component<
  {
    children: ReactNode;
  },
  {
    failed: boolean;
  }
> {
  state = {
    failed: false,
  };

  static getDerivedStateFromError() {
    return {
      failed: true,
    };
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-sm font-medium">
          The canvas could not load
        </p>

        <p className="max-w-sm text-xs text-muted-foreground">
          This usually means the app was updated while this tab
          was open. Your drawing is safe — reload to pick up the
          new version.
        </p>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Reload
        </button>
      </div>
    );
  }
}

type CanvasViewProps = {
  projectId: string;
  sheets: CanvasMeta[];
  dark: boolean;
  onChanged: () => void;
};

export function CanvasView({
  projectId,
  sheets,
  dark,
  onChanged,
}: CanvasViewProps) {
  const [selected, setSelected] = useState<
    string | null
  >(null);

  const [renaming, setRenaming] = useState<
    string | null
  >(null);

  /**
   * If the selected sheet gets deleted, automatically fall back
   * to the first available sheet.
   */
  const activeId =
    selected &&
    sheets.some((sheet) => sheet.id === selected)
      ? selected
      : (sheets[0]?.id ?? null);

  const {
    status,
    onChange,
    flush,
    reset,
    cancel,
  } = useCanvasPersistence(activeId);

  /**
   * Excalidraw accepts Promise-based initialData.
   *
   * Changing activeId changes the CanvasBoundary key below,
   * causing Excalidraw to remount with the new sheet snapshot.
   */
  const initialData = useMemo(() => {
    if (!activeId) {
      return null;
    }

    return loadCanvasSnapshot(activeId)
      .then((saved) => {
        if (!saved) {
          return null;
        }

        return {
          ...saved,
          scrollToContent: true,
        };
      })
      .catch((error) => {
        console.error(
          "Failed to load canvas snapshot:",
          error,
        );

        return null;
      });
  }, [activeId]);

  /**
   * Tagged with its sheet so the outgoing instance's API is never used for the
   * incoming sheet during the remount.
   */
  const [excalidraw, setExcalidraw] = useState<{
    sheetId: string;
    api: ExcalidrawImperativeAPI;
  } | null>(null);

  const live = useCanvasLive(
    activeId,
    excalidraw?.sheetId === activeId ? excalidraw.api : null,
    initialData,
  );

  async function addSheet() {
    /**
     * Make sure current sheet is persisted before changing the
     * project structure.
     */
    await flush();

    await createCanvas(
      projectId,
      `Sheet ${sheets.length + 1}`,
    );

    onChanged();
  }

  async function switchTo(id: string) {
    if (id === activeId) {
      return;
    }

    /**
     * CRITICAL:
     *
     * Wait for Sheet A to finish saving before Sheet B mounts.
     */
    await flush();

    /**
     * Remove the old in-memory scene so it can't accidentally
     * be saved again after the new sheet mounts.
     */
    reset();

    setSelected(id);
  }

  async function removeSheet(
    id: string,
    name: string,
  ) {
    const confirmed = window.confirm(
      `Delete sheet "${name}"? Its drawing goes with it.`,
    );

    if (!confirmed) {
      return;
    }

    /**
     * If deleting the active sheet, don't let a pending debounce
     * resurrect/save it after deletion.
     */
    if (id === activeId) {
      cancel();
    }

    await deleteCanvas(id);

    if (selected === id) {
      setSelected(null);
    }

    onChanged();
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Sheet tabs */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-3 py-1.5">
        {sheets.map((sheet) => {
          const active =
            sheet.id === activeId;

          return (
            <div
              key={sheet.id}
              className={[
                "group flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",

                active
                  ? "border-primary bg-secondary font-medium"
                  : "border-transparent text-muted-foreground hover:bg-secondary",
              ].join(" ")}
            >
              {renaming === sheet.id ? (
                <form
                  action={async (formData) => {
                    const name = String(
                      formData.get("name") ?? "",
                    ).trim();

                    if (name) {
                      await renameCanvas(
                        sheet.id,
                        name,
                      );
                    }

                    setRenaming(null);

                    onChanged();
                  }}
                  className="flex items-center gap-1"
                >
                  <input
                    name="name"
                    defaultValue={sheet.name}
                    autoFocus
                    className="w-24 rounded border bg-background px-1 py-0.5 text-xs outline-none"
                  />

                  <button
                    type="submit"
                    title="Save name"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Check className="size-3" />
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      void switchTo(sheet.id);
                    }}
                    className="max-w-32 truncate"
                  >
                    {sheet.name}
                  </button>

                  {active && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setRenaming(sheet.id)
                        }
                        title="Rename"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="size-3" />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          void removeSheet(
                            sheet.id,
                            sheet.name,
                          );
                        }}
                        title="Delete sheet"
                        className="text-muted-foreground hover:text-[var(--chart-7)]"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => {
            void addSheet();
          }}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Plus className="size-3" />

          Sheet
        </button>

        <span className="ml-auto shrink-0 pl-3 text-[11px] text-muted-foreground">
          {status === "saving" ? (
            "Saving…"
          ) : status === "error" ? (
            <span className="text-[var(--chart-7)]">
              Save failed — retrying on next change
            </span>
          ) : activeId ? (
            "Saved"
          ) : null}
        </span>
      </div>

      {/* Canvas */}
      <div className="relative flex-1">
        {activeId ? (
          /**
           * key={activeId} forces a fresh Excalidraw instance
           * whenever the selected sheet changes.
           */
          <CanvasBoundary key={activeId}>
            <Excalidraw
              initialData={initialData}
              excalidrawAPI={(api) =>
                setExcalidraw({ sheetId: activeId, api })
              }
              onChange={(elements, appState, files) => {
                onChange(elements, appState, files);
                live.onChange();
              }}
              onPointerUpdate={live.onPointerUpdate}
              theme={dark ? "dark" : "light"}
            />
          </CanvasBoundary>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">
              No sheets in this project yet.
            </p>

            <button
              type="button"
              onClick={() => {
                void addSheet();
              }}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              <Plus className="size-3" />

              Create the first sheet
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
