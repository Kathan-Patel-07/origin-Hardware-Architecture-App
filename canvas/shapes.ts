// Block shapes and their geometry. Every block has a bounding box (used for
// layout); the shape's outline sits inside it, and lines attach to the outline.

import type { XY } from './data/architecture';

export const BLOCK_SHAPES = ['rectangle', 'oval', 'diamond', 'circle'] as const;
export type BlockShape = (typeof BLOCK_SHAPES)[number];

/** Bounding box of each shape, sized so heading and description still fit inside. */
export const SHAPE_SIZE: Record<BlockShape, { w: number; h: number }> = {
  rectangle: { w: 250, h: 112 },
  oval: { w: 270, h: 124 },
  diamond: { w: 290, h: 160 },
  circle: { w: 164, h: 164 },
};

export const shapeOf = (n: { shape?: BlockShape }): BlockShape => n.shape ?? 'rectangle';
export const sizeOf = (n: { shape?: BlockShape }) => SHAPE_SIZE[shapeOf(n)];

export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * How far in from the bounding-box edge the outline is, at `along` (distance
 * from the middle of that edge). `half` is half the edge's length, `depth` half
 * the box size the other way.
 */
export function edgeInset(shape: BlockShape, half: number, depth: number, along: number): number {
  if (shape === 'rectangle') return 0;
  const r = Math.min(1, Math.abs(along) / half);
  if (shape === 'diamond') return depth * r;
  return depth - depth * Math.sqrt(1 - r * r); // oval / circle (ellipse)
}

/** Point on the shape's outline on `side`, `offset` from that side's middle. */
export function boundaryPoint(shape: BlockShape, box: { x: number; y: number; w: number; h: number }, side: Side, offset: number): XY {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  if (side === 'top') return { x: cx + offset, y: box.y + edgeInset(shape, box.w / 2, box.h / 2, offset) };
  if (side === 'bottom') return { x: cx + offset, y: box.y + box.h - edgeInset(shape, box.w / 2, box.h / 2, offset) };
  if (side === 'left') return { x: box.x + edgeInset(shape, box.h / 2, box.w / 2, offset), y: cy + offset };
  return { x: box.x + box.w - edgeInset(shape, box.h / 2, box.w / 2, offset), y: cy + offset };
}
