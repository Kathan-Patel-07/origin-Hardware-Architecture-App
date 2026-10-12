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
// Column gap on left-to-right sheets, room for a connection name on each line.
const LR_LABEL_RANK_SEP = 420;

// Positions tree nodes top-down (top-left corners). Only parent→child edges
// drive the layout so cross-links never distort the hierarchy. Each root's tree
// is laid out on its own, then the trees are placed side by side, top-aligned,
// TREE_GAP apart.
function autoLayout(treeNodes: ArchNode[], direction: 'TB' | 'LR' = 'TB', links: [string, string][] = []): Map<string, XY> {
  // Blocks joined by connections (harnesses) are laid out as one graph, so connected
  // blocks end up next to each other in flow order. Laying out only the parent trees
  // put unrelated-looking blocks in one row and stacked their connections on top of
  // each other (Auto-arrange on the system overview).
  if (links.length) return graphLayout(treeNodes, direction, links);
  // Unconnected blocks with no tree (a menu of views, an index): a grid, not one long row.
  if (treeNodes.length > 3 && !treeNodes.some((n) => n.parent)) {
    const cols = Math.ceil(Math.sqrt(treeNodes.length * 1.5));
    const out = new Map<string, XY>();
    treeNodes.forEach((n, i) => out.set(n.id, { x: (i % cols) * (NODE_WIDTH + NODE_SEP * 2), y: Math.floor(i / cols) * 200 }));
    return out;
  }
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
  keepSiblingOrder(treeNodes, positions, direction);
  return positions;
}

/**
 * dagre orders a column to cut line crossings, so siblings came out in any order (fuses
 * 1, 4, 3, 2). Restack each block's children - each with its whole branch - in the order the
 * sheet lists them, inside the band they already occupy. A restack that would land a branch
 * on a block outside the siblings' branches is not done.
 */
function keepSiblingOrder(nodes: ArchNode[], positions: Map<string, XY>, direction: 'TB' | 'LR') {
  const ax = direction === 'LR' ? 'y' : 'x';
  const len = (n: ArchNode) => (direction === 'LR' ? sizeOf(n).h : sizeOf(n).w);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, ArchNode[]>();
  for (const n of nodes) if (n.parent && byId.has(n.parent) && positions.has(n.id)) {
    if (!kids.has(n.parent)) kids.set(n.parent, []);
    kids.get(n.parent)!.push(n);
  }
  const branch = (id: string, out: string[] = [], seen = new Set<string>()): string[] => {
    if (seen.has(id)) return out;
    seen.add(id);
    out.push(id);
    for (const k of kids.get(id) ?? []) branch(k.id, out, seen);
    return out;
  };
  const boxOf = (id: string): Box => ({ ...positions.get(id)!, ...sizeOf(byId.get(id)!) });
  const queue = nodes.filter((n) => !n.parent || !byId.has(n.parent)).map((n) => n.id);
  const visited = new Set<string>();
  while (queue.length) {
    const p = queue.shift()!;
    if (visited.has(p)) continue;
    visited.add(p);
    const ch = kids.get(p) ?? [];
    queue.push(...ch.map((c) => c.id));
    if (ch.length < 2) continue;
    const spans = ch.map((c) => {
      const ids = branch(c.id);
      const lo = Math.min(...ids.map((id) => positions.get(id)![ax]));
      const hi = Math.max(...ids.map((id) => positions.get(id)![ax] + len(byId.get(id)!)));
      return { c, ids, lo, hi };
    });
    const current = [...spans].sort((a, b) => a.lo - b.lo);
    if (current.every((s, i) => s.c === spans[i].c)) continue;  // already in order
    const before = new Map(spans.flatMap((s) => s.ids.map((id) => [id, { ...positions.get(id)! }] as const)));
    let cursor = current[0].lo;
    for (const s of spans) {
      const d = cursor - s.lo;
      for (const id of s.ids) {
        const q = positions.get(id)!;
        positions.set(id, { ...q, [ax]: q[ax] + d });
      }
      cursor += s.hi - s.lo + NODE_SEP;
    }
    const moved = new Set(before.keys());
    const clash = [...moved].some((id) => nodes.some((o) => !moved.has(o.id) && positions.has(o.id) && overlaps(boxOf(id), boxOf(o.id))));
    if (clash) for (const [id, q] of before) positions.set(id, q);
  }
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
function graphLayout(nodes: ArchNode[], direction: 'TB' | 'LR', links: [string, string][]): Map<string, XY> {
  const ids = new Set(nodes.map((n) => n.id));
  const g = new dagre.graphlib.Graph({ multigraph: false });
  // Left-to-right sheets carry connection names in the gaps between columns. A name sits on
  // the last run after the line's turn - about half the gap - so the gap is sized for a full
  // harness name such as "PWR_07 · wire-001" with its type badge (HarnessEdge labelMax).
  g.setGraph({ rankdir: direction, nodesep: NODE_SEP, ranksep: direction === 'LR' ? LR_LABEL_RANK_SEP : RANK_SEP * 1.4, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    const { w, h } = sizeOf(n);
    g.setNode(n.id, { width: w, height: h });
  }
  for (const n of nodes) if (n.parent && ids.has(n.parent)) g.setEdge(n.parent, n.id, { weight: 2 });
  // With a tree, columns follow the tree alone: ranking by a link beside it pushed a block a
  // column further, and its tree line then ran past the block in between. (dagre does not
  // take minlen 0 - it threw.) Without a tree the links are all there is to rank by.
  const hasTree = nodes.some((n) => n.parent && ids.has(n.parent));
  if (!hasTree)
    for (const [a, b] of links)
      if (a !== b && ids.has(a) && ids.has(b) && !g.hasEdge(a, b) && !g.hasEdge(b, a)) g.setEdge(a, b, { weight: 1 });
  dagre.layout(g);
  const positions = new Map<string, XY>();
  for (const n of nodes) {
    const p = g.node(n.id);
    const { w, h } = sizeOf(n);
    positions.set(n.id, { x: p.x - w / 2, y: p.y - h / 2 });
  }
  keepSiblingOrder(nodes, positions, direction);
  return positions;
}

export function layoutTree(treeNodes: ArchNode[], direction: 'TB' | 'LR' = 'TB', links: [string, string][] = []): Map<string, XY> {
  if (!treeNodes.some((n) => n.position)) return autoLayout(treeNodes, direction, links);

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
