// Shared helpers for drawing and reshaping connection lines.

import type { XY } from './data/architecture';

/** SVG path through `pts` with corners rounded by up to `r`. */
export function roundedPolyline(pts: XY[], r = 10): string {
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const inLen = Math.hypot(b.x - a.x, b.y - a.y);
    const outLen = Math.hypot(c.x - b.x, c.y - b.y);
    const k = Math.min(r, inLen / 2, outLen / 2);
    if (k < 0.5) {
      d += ` L ${b.x} ${b.y}`;
      continue;
    }
    const p1 = { x: b.x - ((b.x - a.x) / inLen) * k, y: b.y - ((b.y - a.y) / inLen) * k };
    const p2 = { x: b.x + ((c.x - b.x) / outLen) * k, y: b.y + ((c.y - b.y) / outLen) * k };
    d += ` L ${p1.x} ${p1.y} Q ${b.x} ${b.y} ${p2.x} ${p2.y}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

/** Distance from `p` to the segment a–b. */
export function distToSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Point halfway along the polyline through `pts`. */
export function polylineMidpoint(pts: XY[]): XY {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  let half = lens.reduce((a, l) => a + l, 0) / 2;
  for (let i = 0; i < lens.length; i++) {
    if (half <= lens[i] && lens[i] > 0) {
      const t = half / lens[i];
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    }
    half -= lens[i];
  }
  return pts[pts.length - 1];
}

/** Move `p` level/plumb with any of `neighbours` that is within `distance`. */
export function snapToNeighbours(p: XY, neighbours: XY[], distance = 10): XY {
  let { x, y } = p;
  let dx = distance;
  let dy = distance;
  for (const n of neighbours) {
    if (Math.abs(n.x - p.x) < dx) [x, dx] = [n.x, Math.abs(n.x - p.x)];
    if (Math.abs(n.y - p.y) < dy) [y, dy] = [n.y, Math.abs(n.y - p.y)];
  }
  return { x, y };
}
