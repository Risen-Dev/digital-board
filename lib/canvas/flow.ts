/**
 * The AI agent answers with a flow (nodes + edges), never with raw Excalidraw
 * elements: the model only decides what the steps are, this file decides where
 * they go. Pure — imported by the route (parse) and the canvas (layout).
 */

export type FlowShape = "start" | "end" | "process" | "decision" | "data";
export type FlowNode = { id: string; label: string; shape: FlowShape };
export type FlowEdge = { from: string; to: string; label?: string };
export type Flow = { nodes: FlowNode[]; edges: FlowEdge[] };

const SHAPES: FlowShape[] = ["start", "end", "process", "decision", "data"];
const MAX_NODES = 80;

/** Validates untrusted model output. Edges to unknown nodes are dropped. */
export function parseFlow(raw: unknown): Flow | null {
  if (!raw || typeof raw !== "object") return null;
  const { nodes, edges } = raw as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(nodes)) return null;

  const clean: FlowNode[] = [];
  const ids = new Set<string>();
  for (const n of nodes.slice(0, MAX_NODES)) {
    const id = String(n?.id ?? "").trim();
    const label = String(n?.label ?? "").trim().slice(0, 200);
    if (!id || !label || ids.has(id)) continue;
    ids.add(id);
    clean.push({ id, label, shape: SHAPES.includes(n.shape) ? n.shape : "process" });
  }
  if (clean.length === 0) return null;

  const links = (Array.isArray(edges) ? edges : [])
    .map((e) => ({ from: String(e?.from ?? ""), to: String(e?.to ?? ""), label: e?.label ? String(e.label).slice(0, 80) : undefined }))
    .filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);

  return { nodes: clean, edges: links };
}

const SIZE: Record<FlowShape, [number, number]> = {
  start: [180, 70], end: [180, 70], process: [200, 80], decision: [220, 120], data: [200, 80],
};
const FILL: Record<FlowShape, string> = {
  start: "#b2f2bb", end: "#ffc9c9", process: "#a5d8ff", decision: "#ffec99", data: "#d0bfff",
};
const GAP_X = 60;
const GAP_Y = 90;
const CAPTION_H = 44;
// Excalidraw's Helvetica (system font). Its hand-drawn fonts load lazily, and text
// measured before they arrive gets a box too narrow for it, clipping the caption.
const CAPTION_FONT = 2;

/** BFS depth from the roots; nodes nothing reaches go one row below the rest. */
export function levels(flow: Flow): Map<string, number> {
  const incoming = new Set(flow.edges.map((e) => e.to));
  const roots = flow.nodes.filter((n) => n.shape === "start" || !incoming.has(n.id)).map((n) => n.id);
  const level = new Map<string, number>();
  const queue = roots.length ? roots : [flow.nodes[0].id];
  for (const id of queue) level.set(id, 0);
  for (let i = 0; i < queue.length; i++) {
    for (const e of flow.edges) {
      if (e.from === queue[i] && !level.has(e.to)) {
        level.set(e.to, level.get(queue[i])! + 1);
        queue.push(e.to);
      }
    }
  }
  const last = Math.max(...level.values()) + 1;
  for (const n of flow.nodes) if (!level.has(n.id)) level.set(n.id, last);
  return level;
}

/**
 * Excalidraw element skeletons (feed to `convertToExcalidrawElements`), laid out
 * top-down with the top-left corner at `origin`. Ids are prefixed so a second
 * flow on the same sheet can't collide with the first.
 */
export function layoutFlow(flow: Flow, origin: { x: number; y: number }, prefix = "", caption = "") {
  // A gray line above the flow saying who drew it; the flow starts below it.
  const label = caption ? [{ type: "text", x: origin.x, y: origin.y, text: caption, fontSize: 16, strokeColor: "#868e96", fontFamily: CAPTION_FONT }] : [];
  if (caption) origin = { x: origin.x, y: origin.y + CAPTION_H };

  const level = levels(flow);
  const rows: FlowNode[][] = [];
  for (const n of flow.nodes) (rows[level.get(n.id)!] ??= []).push(n);

  const rowWidth = (row: FlowNode[]) => row.reduce((w, n) => w + SIZE[n.shape][0], 0) + GAP_X * (row.length - 1);
  const width = Math.max(...rows.filter(Boolean).map(rowWidth));

  const box = new Map<string, { x: number; y: number; w: number; h: number }>();
  let y = origin.y;
  for (const row of rows) {
    if (!row) continue;
    let x = origin.x + (width - rowWidth(row)) / 2;
    const tallest = Math.max(...row.map((n) => SIZE[n.shape][1]));
    for (const n of row) {
      const [w, h] = SIZE[n.shape];
      box.set(n.id, { x, y: y + (tallest - h) / 2, w, h });
      x += w + GAP_X;
    }
    y += tallest + GAP_Y;
  }

  const id = (nodeId: string) => `${prefix}${nodeId}`;
  const shapes = flow.nodes.map((n) => {
    const b = box.get(n.id)!;
    return {
      type: n.shape === "decision" ? "diamond" : n.shape === "start" || n.shape === "end" ? "ellipse" : "rectangle",
      id: id(n.id),
      x: b.x, y: b.y, width: b.w, height: b.h,
      backgroundColor: FILL[n.shape],
      fillStyle: "solid",
      ...(n.shape === "process" ? { roundness: { type: 3 } } : {}),
      label: { text: n.label },
    };
  });

  const arrows = flow.edges.map((e) => {
    const a = box.get(e.from)!;
    const b = box.get(e.to)!;
    // Downward edges run bottom → top; loops back up run right side → right side,
    // so they don't cut through the steps in between.
    const back = b.y <= a.y;
    const sx = back ? a.x + a.w : a.x + a.w / 2, sy = back ? a.y + a.h / 2 : a.y + a.h;
    const ex = back ? b.x + b.w : b.x + b.w / 2, ey = back ? b.y + b.h / 2 : b.y;
    return {
      type: "arrow",
      // Excalidraw swaps a 0 width/height for its 100px default, bending straight arrows.
      x: sx, y: sy, width: ex - sx || 1, height: ey - sy || 1,
      start: { id: id(e.from) },
      end: { id: id(e.to) },
      ...(e.label ? { label: { text: e.label } } : {}),
    };
  });

  return [...label, ...shapes, ...arrows];
}
