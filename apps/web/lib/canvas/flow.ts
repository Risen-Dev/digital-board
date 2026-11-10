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

/** Minimum sizes; a longer label grows its shape (see `sizeOf`). */
const SIZE: Record<FlowShape, [number, number]> = {
  start: [180, 70], end: [180, 70], process: [200, 80], decision: [220, 120], data: [200, 80],
};
// Excalidraw label text: 20px, line height 1.25, 5px padding inside the shape's text box.
const LINE_H = 25;
const PAD = 10;
// ponytail: estimated, not measured — wider than the real hand-drawn font, so labels fit with room to spare.
const CHAR_W = 11;
const WRAP_W = 150;
const LANE_GAP = 40;
const FILL: Record<FlowShape, string> = {
  start: "#b2f2bb", end: "#ffc9c9", process: "#a5d8ff", decision: "#ffec99", data: "#d0bfff",
};
const GAP_X = 60;
const GAP_Y = 90;
const CAPTION_H = 44;
// Excalidraw's Helvetica (system font). Its hand-drawn fonts load lazily, and text
// measured before they arrive gets a box too narrow for it, clipping the caption.
const CAPTION_FONT = 2;

/**
 * Big enough that Excalidraw never wraps a word mid-way or grows the shape after
 * the arrows were placed (a grown diamond left its arrows starting inside it).
 * Excalidraw's text box is the full rectangle, ~0.7 of an ellipse and half a diamond.
 */
function sizeOf(node: FlowNode): [number, number] {
  const lines: string[] = [];
  for (const word of node.label.split(/\s+/)) {
    const last = lines.at(-1);
    if (last !== undefined && (last.length + 1 + word.length) * CHAR_W <= WRAP_W) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  const tw = Math.max(...lines.map((l) => l.length)) * CHAR_W + PAD;
  const th = lines.length * LINE_H + PAD;
  const k = node.shape === "decision" ? 2 : node.shape === "start" || node.shape === "end" ? Math.SQRT2 : 1;
  const [w, h] = SIZE[node.shape];
  return [Math.ceil(Math.max(w, tw * k + 20)), Math.ceil(Math.max(h, th * k + 20))];
}

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

  const size = new Map(flow.nodes.map((n) => [n.id, sizeOf(n)]));
  const rowWidth = (row: FlowNode[]) => row.reduce((w, n) => w + size.get(n.id)![0], 0) + GAP_X * (row.length - 1);
  const width = Math.max(...rows.filter(Boolean).map(rowWidth));

  const box = new Map<string, { x: number; y: number; w: number; h: number }>();
  let y = origin.y;
  for (const row of rows) {
    if (!row) continue;
    let x = origin.x + (width - rowWidth(row)) / 2;
    const tallest = Math.max(...row.map((n) => size.get(n.id)![1]));
    for (const n of row) {
      const [w, h] = size.get(n.id)!;
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

  // Edges between neighbouring rows go straight down, or as a ┐└ elbow when the target is
  // off to the side. Loops back up and edges that skip rows run in their own lane beside
  // the whole flow, so they never cut through the steps in between: left of it when the
  // target is first in its row, else right. They leave and enter through that side when
  // nothing stands beyond it in the row, else through the bottom / top, a short stub away.
  const right = Math.max(...[...box.values()].map((b) => b.x + b.w));
  const left = Math.min(...[...box.values()].map((b) => b.x));
  const lastInRow = new Set(rows.filter(Boolean).map((row) => row.at(-1)!.id));
  const firstInRow = new Set(rows.filter(Boolean).map((row) => row[0].id));
  const STUB = GAP_Y / 3;
  const side = (nodeId: string, b: { x: number; w: number }) =>
    flow.nodes.find((n) => n.id === nodeId)!.shape === "decision" ? b.x + b.w / 2 : b.x + b.w * 0.8;
  let lanesR = 0, lanesL = 0;
  const arrows = flow.edges.map((e) => {
    const a = box.get(e.from)!;
    const b = box.get(e.to)!;
    let sx: number, sy: number, path: [number, number][];
    if (level.get(e.to)! - level.get(e.from)! === 1 && b.y > a.y) {
      sx = a.x + a.w / 2; sy = a.y + a.h;
      const dx = b.x + b.w / 2 - sx, dy = b.y - sy;
      path = Math.abs(dx) < 1 ? [[0, 0], [0, dy]] : [[0, 0], [0, dy / 2], [dx, dy / 2], [dx, dy]];
    } else {
      const goLeft = firstInRow.has(e.to) && !lastInRow.has(e.to);
      const edge = (n: { x: number; w: number }) => (goLeft ? n.x : n.x + n.w);
      const outSide = goLeft ? firstInRow.has(e.from) : lastInRow.has(e.from);
      const inSide = goLeft || lastInRow.has(e.to);
      sx = outSide ? edge(a) : side(e.from, a);
      sy = outSide ? a.y + a.h / 2 : a.y + a.h;
      const lane = (goLeft ? left - LANE_GAP * ++lanesL : right + LANE_GAP * ++lanesR) - sx;
      path = outSide ? [[0, 0]] : [[0, 0], [0, STUB]];
      path.push([lane, path.at(-1)![1]]);
      if (inSide) {
        const dy = b.y + b.h / 2 - sy;
        path.push([lane, dy], [edge(b) - sx, dy]);
      } else {
        const tx = side(e.to, b) - sx, top = b.y - sy;
        path.push([lane, top - STUB], [tx, top - STUB], [tx, top]);
      }
    }
    const xs = path.map((p) => p[0]), ys = path.map((p) => p[1]);
    return {
      type: "arrow",
      x: sx, y: sy,
      // Excalidraw swaps a 0 width/height for its 100px default, bending straight arrows.
      width: Math.max(...xs) - Math.min(...xs) || 1, height: Math.max(...ys) - Math.min(...ys) || 1,
      points: path,
      start: { id: id(e.from) },
      end: { id: id(e.to) },
      ...(e.label ? { label: { text: e.label } } : {}),
    };
  });

  return [...label, ...shapes, ...arrows];
}
