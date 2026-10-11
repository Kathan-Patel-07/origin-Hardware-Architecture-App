import dagre from '@dagrejs/dagre';
import type { ArchNode, XY } from './data/architecture';
import { SHAPE_SIZE, sizeOf } from './shapes';

// Size of a rectangle block (the default shape); other shapes: see SHAPE_SIZE.
export const NODE_WIDTH = SHAPE_SIZE.rectangle.w;
export const NODE_HEIGHT = SHAPE_SIZE.rectangle.h;
// Horizontal space between separate trees (e.g. Robot and Accessories).
export const TREE_GAP = 220;
// Space between sibling blocks and between rows.
const NODE_SEP = 40;
const RANK_SEP = 110;

// Positions tree nodes top-down (top-left corners). Only parent→child edges
// drive the layout so cross-links never distort the hierarchy. Each root's tree
// is laid out on its own, then the trees are placed side by side, top-aligned,
// TREE_GAP apart.
function autoLayout(treeNodes: ArchNode[], direction: 'TB' | 'LR' = 'TB'): Map<string, XY> {
  const ids = new Set(treeNodes.map((n) => n.id));
  const byId = new Map(treeNodes.map((n) => [n.id, n]));
  const rootOf = (n: ArchNode): string => {
    // Guarded against a parent cycle (an invalid document): it must not hang the page.
    let cur = n;
    const seen = new Set<string>([cur.id]);
    while (cur.parent && ids.has(cur.parent) && !seen.has(cur.parent)) {
      cur = byId.get(cur.parent)!;
      seen.add(cur.id);
    }
    return cur.id;
  };

  const trees = new Map<string, ArchNode[]>();
  for (const n of treeNodes) {
    const root = rootOf(n);
    if (!trees.has(root)) trees.set(root, []);
    trees.get(root)!.push(n);
  }

  const positions = new Map<string, XY>();
  // Trees sit side by side (TB) or stacked (LR, the convention for flow diagrams such as
  // power distribution: source on the left, loads on the right).
  let offsetX = 0;
  let offsetY = 0;
  for (const members of trees.values()) {
    const g = new dagre.graphlib.Graph();
    // ranksep leaves room in each row gap for cross-link lanes (see App.tsx).
    g.setGraph({ rankdir: direction, nodesep: NODE_SEP, ranksep: RANK_SEP, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of members) {
      const { w, h } = sizeOf(n);
      g.setNode(n.id, { width: w, height: h });
    }
    for (const n of members) if (n.parent && g.hasNode(n.parent)) g.setEdge(n.parent, n.id);
    dagre.layout(g);

    let maxRight = 0;
    let maxBottom = 0;
    for (const n of members) {
      const p = g.node(n.id);
      const { w, h } = sizeOf(n);
      const x = p.x - w / 2;
      const y = p.y - h / 2;
      positions.set(n.id, { x: offsetX + x, y: offsetY + y });
      maxRight = Math.max(maxRight, x + w);
      maxBottom = Math.max(maxBottom, y + h);
    }
    if (direction === 'LR') offsetY += maxBottom + TREE_GAP;
    else offsetX += maxRight + TREE_GAP;
  }
  return positions;
}

type Box = XY & { w: number; h: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w + NODE_SEP / 2 && b.x < a.x + a.w + NODE_SEP / 2 && a.y < b.y + b.h + NODE_SEP / 2 && b.y < a.y + a.h + NODE_SEP / 2;

/**
 * Block positions (top-left corners) for a sheet. With no dragged blocks the
 * whole sheet is laid out automatically. Once blocks have saved positions those
 * are kept, and any block without one is placed in a free spot: below its
 * parent, or to the right of everything for a new top-level block.
 */
export function layoutTree(treeNodes: ArchNode[], direction: 'TB' | 'LR' = 'TB'): Map<string, XY> {
  if (!treeNodes.some((n) => n.position)) return autoLayout(treeNodes, direction);

  const byId = new Map(treeNodes.map((n) => [n.id, n]));
  const positions = new Map<string, XY>();
  for (const n of treeNodes) if (n.position) positions.set(n.id, n.position);

  // Placed boxes, kept incrementally (rebuilding them on every probe made a 500-block sheet
  // take seconds per drag frame).
  const placed: Box[] = [...positions].map(([id, p]) => ({ ...p, ...sizeOf(byId.get(id)!) }));
  const boxes = (): Box[] => placed;
  const setPos = (id: string, p: XY) => {
    positions.set(id, p);
    placed.push({ ...p, ...sizeOf(byId.get(id)!) });
  };
  // First slot start.x + k*(w + NODE_SEP), k >= 0, that overlaps nothing. Instead of trying
  // every k, jump straight past the box that is in the way: every slot skipped still overlaps
  // it, so the result is the same as stepping one slot at a time.
  const freeSpot = (start: XY, size: { w: number; h: number }): XY => {
    const step = size.w + NODE_SEP;
    const p = { ...start };
    for (;;) {
      const hit = placed.find((q) => overlaps({ ...p, ...size }, q));
      if (!hit) return p;
      const k = Math.max(1, Math.ceil((hit.x + hit.w + NODE_SEP / 2 - p.x) / step));
      p.x += k * step;
    }
  };

  // Place parents before their children so a child can sit under its parent.
  let pending = treeNodes.filter((n) => !positions.has(n.id));
  while (pending.length) {
    const ready = pending.filter((n) => !n.parent || positions.has(n.parent) || !pending.some((p) => p.id === n.parent));
    for (const n of ready.length ? ready : pending) {
      const size = sizeOf(n);
      const parent = n.parent ? byId.get(n.parent) : undefined;
      const parentPos = n.parent ? positions.get(n.parent) : undefined;
      if (parent && parentPos) {
        setPos(n.id, freeSpot({ x: parentPos.x, y: parentPos.y + sizeOf(parent).h + RANK_SEP }, size));
      } else {
        const all = boxes();
        const right = all.length ? Math.max(...all.map((q) => q.x + q.w)) + TREE_GAP : 0;
        const top = all.length ? Math.min(...all.map((q) => q.y)) : 0;
        setPos(n.id, freeSpot({ x: right, y: top }, size));
      }
    }
    pending = pending.filter((n) => !positions.has(n.id));
  }
  return positions;
}
