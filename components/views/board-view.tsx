"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  closestCorners, DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, MouseSensor,
  pointerWithin, rectIntersection, TouchSensor, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CircleCheck, Pencil, Plus } from "lucide-react";
import { columnOf, PALETTE, placeTask, type Column, type Task } from "@/lib/board";
import { addColumn, deleteColumn, moveColumn, moveTask, setDoneColumn, updateColumn } from "@/lib/actions";
import type { TaskLinks } from "@/lib/github";
import { SortableTaskCard, TaskCard } from "../task-card";
import { ColumnEditor } from "../column-editor";

/**
 * Pointer-first collision detection. closestCorners alone compares the dragged
 * card's corners against droppable rects, which makes the column *next to* the
 * origin ambiguous — its near corner can stay further away than the origin's own,
 * so an adjacent-column drop silently resolves back to the source column.
 * Whatever is literally under the pointer wins; the rect tests are only fallbacks
 * for keyboard dragging, where there is no pointer.
 */
const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  if (pointer.length > 0) return pointer;
  const intersections = rectIntersection(args);
  return intersections.length > 0 ? intersections : closestCorners(args);
};

/** Column/task ordering, for comparing the optimistic tree against the server's. */
const shape = (cols: Column[]) =>
  cols.map((c) => `${c.id}:${c.tasks.map((t) => t.id).join(",")}`).join("|");

function DropZone({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-[220px] max-w-[320px] flex-1 flex-col gap-2 rounded-lg transition-colors ${
        isOver ? "bg-secondary" : ""
      }`}
    >
      {children}
    </div>
  );
}

export function BoardView({
  columns, projectId, doneColumnId, links = {}, onOpen, onAdd,
}: {
  columns: Column[];
  projectId: string;
  /** The chosen done column; null means the last one. */
  doneColumnId: string | null;
  /** Task key → linked GitHub items, when the project has a repo. */
  links?: Record<string, TaskLinks>;
  onOpen: (t: Task) => void;
  onAdd: (columnId: string) => void;
}) {
  const router = useRouter();
  const doneId = doneColumnId ?? columns.at(-1)?.id;
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

  function onDragStart({ active }: DragStartEvent) {
    setActiveId(String(active.id));
    setBranchedFrom(shape(columns));
    setLocal(columns);
    originRef.current = columnOf(columns, String(active.id))?.id ?? null;
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over || !local) return;
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
    const origin = originRef.current;
    originRef.current = null;
    if (!over || !local || !origin) return setLocal(null);

    const id = String(active.id);
    const overId = String(over.id);
    const to = columnOf(local, overId);
    if (!to) return setLocal(null);

    const oldIndex = to.tasks.findIndex((t) => t.id === id);
    const newIndex = overId === to.id ? to.tasks.length - 1 : to.tasks.findIndex((t) => t.id === overId);
    const moved = origin !== to.id;
    const reordered = newIndex >= 0 && newIndex !== oldIndex;
    if (!moved && !reordered) return setLocal(null);

    const final = reordered ? placeTask(local, id, to.id, newIndex) : local;
    setLocal(final);
    const index = final.find((c) => c.id === to.id)!.tasks.findIndex((t) => t.id === id);
    // moveTask revalidates /board, so its response carries the new tree already —
    // a router.refresh() here is a second round trip for the same data.
    await moveTask(id, to.id, index);
  }

  return (
    <main className="flex-1 overflow-x-auto overflow-y-hidden">
      <DndContext
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
          setActiveId(null);
          setBranchedFrom(null);
          setLocal(null);
        }}
      >
        <div className="flex h-full min-w-[880px] gap-4 p-5">
          {view.map((col) => (
            <DropZone key={col.id} id={col.id}>
              <div className="relative mb-1 flex items-center justify-between px-1">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="size-2 shrink-0 rounded-full" style={{ background: col.color }} />
                  <button
                    onClick={() => setEditingColumn(col.id)}
                    title="Rename column"
                    className="group/col flex min-w-0 items-center gap-1"
                  >
                    <span className="truncate text-sm font-semibold">{col.title}</span>
                    {col.id === doneId && <CircleCheck className="size-3 shrink-0 text-muted-foreground" aria-label="Done column" />}
                    <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/col:opacity-100" />
                  </button>
                  <span className="shrink-0 rounded-full border bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {col.tasks.length}
                  </span>
                </div>
                <button
                  onClick={() => onAdd(col.id)}
                  title="Add task"
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Plus className="size-3" />
                </button>

                {editingColumn === col.id && (
                  <ColumnEditor
                    heading="Edit column"
                    submitLabel="Save"
                    title={col.title}
                    color={col.color}
                    onSubmit={(t, c) => updateColumn(col.id, t, c).then((r) => { router.refresh(); return r; })}
                    onDelete={async () => {
                      const count = col.tasks.length;
                      if (count > 0 && !confirm(`Delete "${col.title}"? Its ${count} task(s) will be deleted too.`)) return;
                      const r = await deleteColumn(col.id);
                      router.refresh();
                      return r;
                    }}
                    onMove={async (d) => { await moveColumn(col.id, d); router.refresh(); }}
                    done={col.id === doneId}
                    onToggleDone={() => setDoneColumn(projectId, col.id === doneColumnId ? null : col.id).then(() => router.refresh())}
                    onClose={() => setEditingColumn(null)}
                  />
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-1 pb-4">
                <SortableContext items={col.tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                  {col.tasks.map((task) => (
                    <SortableTaskCard key={task.id} task={task} links={task.key ? links[task.key] : undefined} onOpen={() => onOpen(task)} />
                  ))}
                </SortableContext>
                {col.tasks.length === 0 && (
                  <p className="rounded-lg border border-dashed px-3 py-6 text-center text-[11px] text-muted-foreground">
                    Empty — drag a task here
                  </p>
                )}
                <button
                  onClick={() => onAdd(col.id)}
                  className="flex items-center gap-1.5 rounded-md px-1 py-2 text-xs text-muted-foreground transition-all hover:bg-secondary hover:text-foreground"
                >
                  <Plus className="size-3" />
                  <span>Add task</span>
                </button>
              </div>
            </DropZone>
          ))}

          {/* Add a column */}
          <div className="relative w-52 shrink-0 pt-0.5">
            <button
              onClick={() => setAddingColumn(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Plus className="size-3.5" />
              Add column
            </button>
            {addingColumn && (
              <ColumnEditor
                heading="New column"
                submitLabel="Add column"
                color={PALETTE[columns.length % PALETTE.length]}
                onSubmit={(t, c) => addColumn(projectId, t, c).then((r) => { router.refresh(); return r; })}
                onClose={() => setAddingColumn(false)}
              />
            )}
          </div>
        </div>

        <DragOverlay>{activeTask ? <TaskCard task={activeTask} links={activeTask.key ? links[activeTask.key] : undefined} overlay /> : null}</DragOverlay>
      </DndContext>
    </main>
  );
}
