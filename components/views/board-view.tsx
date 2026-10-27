"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  closestCenter, closestCorners, DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, MouseSensor,
  pointerWithin, rectIntersection, TouchSensor, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CircleCheck, Pencil, Plus } from "lucide-react";
import { columnOf, PALETTE, placeTask, type Column, type CustomField, type Task } from "@/lib/board";
import { addColumn, deleteColumn, moveColumn, moveTask, setDoneColumn, updateColumn } from "@/lib/actions";
import type { TaskLinks } from "@/lib/github";
import { SortableTaskCard, TaskCard } from "../task-card";
import { ColumnEditor } from "../column-editor";
import { useT } from "@/components/i18n";

/**
 * Pointer-first collision detection. closestCorners alone compares the dragged
 * card's corners against droppable rects, which makes the column *next to* the
 * origin ambiguous — its near corner can stay further away than the origin's own,
 * so an adjacent-column drop silently resolves back to the source column.
 * Whatever is literally under the pointer wins; the rect tests are only fallbacks
 * for keyboard dragging, where there is no pointer.
 */
const cardCollision: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  if (pointer.length > 0) return pointer;
  const intersections = rectIntersection(args);
  return intersections.length > 0 ? intersections : closestCorners(args);
};

/** Columns drag by their header; their sortable ids carry this prefix so cards and columns never hit each other. */
const COL = "col:";
const collisionDetection: CollisionDetection = (args) => {
  const columnDrag = String(args.active.id).startsWith(COL);
  const droppableContainers = args.droppableContainers.filter((c) => String(c.id).startsWith(COL) === columnDrag);
  return (columnDrag ? closestCenter : cardCollision)({ ...args, droppableContainers });
};

/** Column/task ordering, for comparing the optimistic tree against the server's. */
const shape = (cols: Column[]) =>
  cols.map((c) => `${c.id}:${c.tasks.map((t) => t.id).join(",")}`).join("|");

/**
 * Where the pointer really is during a drag. dnd-kit's `over` only moves when React
 * renders, so on a busy main thread a quick release can land before the render that
 * saw the pointer reach the new column, and the card snapped back to where it started.
 */
let pointerAt: { x: number; y: number } | null = null;
const trackPointer = (e: PointerEvent | TouchEvent) => {
  const p = "touches" in e ? e.touches[0] : e;
  if (p) pointerAt = { x: p.clientX, y: p.clientY };
};
function startTracking() {
  window.addEventListener("pointermove", trackPointer);
  window.addEventListener("touchmove", trackPointer);
}
function stopTracking() {
  window.removeEventListener("pointermove", trackPointer);
  window.removeEventListener("touchmove", trackPointer);
  pointerAt = null;
}
const columnUnderPointer = () =>
  pointerAt
    ? (document.elementsFromPoint(pointerAt.x, pointerAt.y).find((el): el is HTMLElement => el instanceof HTMLElement && !!el.dataset.column)?.dataset.column ?? null)
    : null;

/** A column: a drop target for cards, and itself sortable by the header `children` renders with `handle`. */
type Handle = React.HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
function DropZone({ id, fixed, children }: { id: string; fixed?: boolean; children: (handle: Handle) => React.ReactNode }) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id });
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: COL + id, disabled: fixed });
  return (
    <div
      ref={(node) => { setDropRef(node); setNodeRef(node); }}
      data-column={id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`flex w-[272px] shrink-0 flex-col gap-2 rounded-lg transition-colors ${
        isOver ? "bg-secondary" : ""
      } ${isDragging ? "opacity-40" : ""}`}
    >
      {children({ ...attributes, ...listeners, ref: setActivatorNodeRef })}
    </div>
  );
}

export function BoardView({
  columns, fields, projectId, doneColumnId, today, links = {}, onOpen, onAdd, onDeleted, lane,
}: {
  columns: Column[];
  /** The project's custom fields, to name the values a card shows. */
  fields: CustomField[];
  projectId: string;
  /** The chosen done column; null means the last one. */
  doneColumnId: string | null;
  /** Server date, so the overdue check matches between server and browser. */
  today: string;
  /** Task key → linked GitHub items, when the project has a repo. */
  links?: Record<string, TaskLinks>;
  onOpen: (t: Task) => void;
  onAdd: (columnId: string) => void;
  /** A column was deleted; `undo` restores it with its cards. */
  onDeleted: (undo: string, name: string) => void;
  /**
   * One swimlane: `columns` are this lane's cards, `all` the whole (filtered) board,
   * to place a dropped card among the cards of other lanes. The page scrolls, not
   * the lane; columns don't drag or get added here.
   */
  lane?: { key: string; all: Column[] };
}) {
  const tr = useT();
  const router = useRouter();
  const doneId = doneColumnId ?? columns.at(-1)?.id;
  const overdue = (t: Task) => !!t.dueDate && t.dueDate < today && t.columnId !== doneId;
  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  // Optimistic copy so the drag feels instant; the server is the source of truth.
  const [local, setLocal] = useState<Column[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const originRef = useRef<string | null>(null);
  // Server layout the optimistic tree was branched from. `local` is shown only
  // while the props still read that way: clearing it the moment the action
  // resolves flashes one frame of pre-move data (the card snapping back), and
  // keeping it past any server change hides everything that changed since —
  // a task someone else added, or one this tab just created.
  const [branchedFrom, setBranchedFrom] = useState<string | null>(null);
  const view = local && shape(columns) === branchedFrom ? local : columns;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeTask = view.flatMap((c) => c.tasks).find((t) => t.id === activeId) ?? null;
  const activeColumn = activeId?.startsWith(COL) ? view.find((c) => COL + c.id === activeId) ?? null : null;
  // The stage timer shown on a card in `col`: none in the done column.
  const stageLimit = (col: Column | undefined) => (!col || col.id === doneId ? undefined : col.limitDays);

  function onDragStart({ active, activatorEvent }: DragStartEvent) {
    // Keyboard drags have no pointer to trust.
    if (!(activatorEvent instanceof KeyboardEvent)) startTracking();
    setActiveId(String(active.id));
    setBranchedFrom(shape(columns));
    setLocal(columns);
    originRef.current = columnOf(columns, String(active.id))?.id ?? null;
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over || !local || String(active.id).startsWith(COL)) return;
    const id = String(active.id);
    const overId = String(over.id);
    const from = columnOf(local, id);
    const to = columnOf(local, overId);
    if (!from || !to || from.id === to.id) return;
    const index = overId === to.id ? to.tasks.length : to.tasks.findIndex((t) => t.id === overId);
    setLocal((cols) => (cols ? placeTask(cols, id, to.id, index < 0 ? to.tasks.length : index) : cols));
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    const pointerColumn = columnUnderPointer();
    stopTracking();
    const origin = originRef.current;
    originRef.current = null;
    if (!local) return setLocal(null);
    if (String(active.id).startsWith(COL)) return over ? dropColumn(String(active.id).slice(COL.length), String(over.id).slice(COL.length)) : setLocal(null);
    if (!origin) return setLocal(null);

    const id = String(active.id);
    const overId = over ? String(over.id) : null;
    const hit = overId ? columnOf(local, overId) : undefined;
    // The column under the pointer wins over a lagging `over` (see pointerAt).
    const to = local.find((c) => c.id === (pointerColumn ?? hit?.id));
    if (!to) return setLocal(null);

    const oldIndex = to.tasks.findIndex((t) => t.id === id);
    const newIndex = to.id !== hit?.id ? (oldIndex >= 0 ? oldIndex : to.tasks.length) // a column the render missed: keep or append
      : overId === to.id ? to.tasks.length - 1 : to.tasks.findIndex((t) => t.id === overId);
    const moved = origin !== to.id;
    const reordered = newIndex >= 0 && newIndex !== oldIndex;
    if (!moved && !reordered) return setLocal(null);

    const final = reordered ? placeTask(local, id, to.id, newIndex) : local;
    setLocal(final);
    const laneIds = final.find((c) => c.id === to.id)!.tasks.map((t) => t.id);
    let index = laneIds.indexOf(id);
    if (lane) {
      // Before the next card of this lane, else after the previous one, in the whole column.
      const full = (lane.all.find((c) => c.id === to.id)?.tasks ?? []).map((t) => t.id).filter((t) => t !== id);
      const next = laneIds.slice(index + 1).find((t) => full.includes(t));
      const prev = laneIds.slice(0, index).reverse().find((t) => full.includes(t));
      index = next ? full.indexOf(next) : prev ? full.indexOf(prev) + 1 : full.length;
    }
    // moveTask revalidates /board, so its response carries the new tree already —
    // a router.refresh() here is a second round trip for the same data.
    await moveTask(id, to.id, index);
  }

  async function dropColumn(id: string, overId: string) {
    const from = local!.findIndex((c) => c.id === id);
    const to = local!.findIndex((c) => c.id === overId);
    if (from < 0 || to < 0 || from === to) return setLocal(null);
    setLocal(arrayMove(local!, from, to));
    await moveColumn(id, to - from);
  }

  return (
    <main className={lane ? "" : "flex-1 overflow-x-auto overflow-y-hidden"}>
      <DndContext
        // A fixed id: dnd-kit otherwise numbers its aria-describedby from a global
        // counter, which differs between the server render and hydration.
        id={lane ? `board-lane-${lane.key}` : "board"}
        sensors={sensors}
        collisionDetection={collisionDetection}
        // Re-measure on every drag. Without this, droppable rects are captured
        // once at drag start; the optimistic move in onDragOver resizes the
        // columns and every later hit-test runs against stale geometry.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          stopTracking();
          setActiveId(null);
          setBranchedFrom(null);
          setLocal(null);
        }}
      >
        <div className={`flex w-max gap-4 ${lane ? "px-5 pb-5" : "h-full p-5"}`}>
          <SortableContext items={view.map((c) => COL + c.id)} strategy={horizontalListSortingStrategy}>
          {view.map((col) => (
            <DropZone key={col.id} id={col.id} fixed={!!lane}>
              {(handle) => (<>
              <div className="relative mb-1">
              {/* Only the header row drags the column; the editor below must keep its own keys and clicks. */}
              <div {...handle} className={`flex items-center justify-between px-1 ${lane ? "" : "cursor-grab active:cursor-grabbing"}`}>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="size-2 shrink-0 rounded-full" style={{ background: col.color }} />
                  <button
                    onClick={() => setEditingColumn(col.id)}
                    title={tr("Rename column")}
                    className="group/col flex min-w-0 items-center gap-1"
                  >
                    <span className="truncate text-sm font-semibold">{col.title}</span>
                    {col.id === doneId && <CircleCheck className="size-3 shrink-0 text-muted-foreground" aria-label={tr("Done column")} />}
                    <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/col:opacity-100" />
                  </button>
                  <span className="shrink-0 rounded-full border bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {col.tasks.length}
                  </span>
                </div>
                <button
                  onClick={() => onAdd(col.id)}
                  title={tr("Add task")}
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Plus className="size-3" />
                </button>
              </div>

                {editingColumn === col.id && (
                  <ColumnEditor
                    heading={tr("Edit column")}
                    submitLabel={tr("Save")}
                    title={col.title}
                    color={col.color}
                    limitDays={col.limitDays}
                    onSubmit={(t, c, l) => updateColumn(col.id, t, c, l).then((r) => { router.refresh(); return r; })}
                    onDelete={async () => {
                      const count = col.tasks.length;
                      if (count > 0 && !confirm(tr("Delete \"{name}\"? Its {n} task(s) will be deleted too.", { name: col.title, n: count }))) return;
                      const r = await deleteColumn(col.id);
                      router.refresh();
                      if (r.undo) onDeleted(r.undo, col.title);
                      return r;
                    }}
                    onMove={async (d) => { await moveColumn(col.id, d); router.refresh(); }}
                    done={col.id === doneId}
                    onToggleDone={() => setDoneColumn(projectId, col.id === doneColumnId ? null : col.id).then(() => router.refresh())}
                    onClose={() => setEditingColumn(null)}
                  />
                )}
              </div>
              <div className={`flex flex-col gap-2 px-1 ${lane ? "" : "flex-1 overflow-y-auto pb-4"}`}>
                <SortableContext items={col.tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                  {col.tasks.map((task) => (
                    <SortableTaskCard key={task.id} task={task} links={task.key ? links[task.key] : undefined} overdue={overdue(task)} stageLimit={stageLimit(col)} fields={fields} onOpen={() => onOpen(task)} />
                  ))}
                </SortableContext>
                {col.tasks.length === 0 && (
                  <p className="rounded-lg border border-dashed px-3 py-6 text-center text-[11px] text-muted-foreground">
                    {tr("Empty — drag a task here")}
                  </p>
                )}
                <button
                  onClick={() => onAdd(col.id)}
                  className="flex items-center gap-1.5 rounded-md px-1 py-2 text-xs text-muted-foreground transition-all hover:bg-secondary hover:text-foreground"
                >
                  <Plus className="size-3" />
                  <span>{tr("Add task")}</span>
                </button>
              </div>
              </>)}
            </DropZone>
          ))}
          </SortableContext>

          {/* Add a column */}
          {!lane && (
          <div className="relative w-52 shrink-0 pt-0.5">
            <button
              onClick={() => setAddingColumn(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Plus className="size-3.5" />
              {tr("Add column")}
            </button>
            {addingColumn && (
              <ColumnEditor
                heading={tr("New column")}
                submitLabel={tr("Add column")}
                color={PALETTE[columns.length % PALETTE.length]}
                onSubmit={(t, c, l) => addColumn(projectId, t, c, l).then((r) => { router.refresh(); return r; })}
                onClose={() => setAddingColumn(false)}
              />
            )}
          </div>
          )}
        </div>

        {/* Cards and columns both drag as an overlay, so a drop animates into place instead of jumping. */}
        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} links={activeTask.key ? links[activeTask.key] : undefined} overdue={overdue(activeTask)} stageLimit={stageLimit(columnOf(view, activeTask.id))} fields={fields} overlay />
          : activeColumn ? (
            <div className="flex w-[272px] rotate-1 cursor-grabbing flex-col gap-2 rounded-lg bg-background/90 shadow-lg">
              <div className="mb-1 flex items-center gap-2 px-1">
                <div className="size-2 shrink-0 rounded-full" style={{ background: activeColumn.color }} />
                <span className="truncate text-sm font-semibold">{activeColumn.title}</span>
                <span className="shrink-0 rounded-full border bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{activeColumn.tasks.length}</span>
              </div>
              <div className="flex max-h-[70vh] flex-col gap-2 overflow-hidden px-1 pb-4">
                {activeColumn.tasks.map((task) => <TaskCard key={task.id} task={task} fields={fields} />)}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </main>
  );
}
