import { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Position,
  useInternalNode,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';
import { HARNESS_TYPE_COLORS, type HarnessLabelPos, type HarnessType, type XY } from './data/architecture';
import { roundedPolyline } from './paths';
import { boundaryPoint, type BlockShape } from './shapes';

/** Pixels the pointer must move before pressing on a harness line becomes a drag. */
const DRAG_THRESHOLD = 4;
/** Opacity of harnesses the type filter doesn't match. */
const DIM_OPACITY = 0.15;

export type HarnessEdgeData = {
  harnessId: string;
  segmentId: string;
  name: string;
  types: HarnessType[];
  color: string;
  selected: boolean;
  /** Set only on the segment that carries the harness name. */
  label?: { t: number; side: 'above' | 'below'; anchor?: 'end' };
  /** With anchor 'end': more lines meet the target's side than the source's, so the name goes by the source. */
  labelAtSource?: boolean;
  onLabelMove: (harnessId: string, pos: HarnessLabelPos, done: boolean) => void;
  /** The name is being dragged (possibly started on another segment's edge). */
  labelDragging?: boolean;
  /** Click on the name (not a drag); the position lets draw mode attach at that spot. */
  onLabelClick: (harnessId: string, segmentId: string, clientX: number, clientY: number) => void;
  onMenu: (harnessId: string, segmentId: string, x: number, y: number) => void;
  /**
   * Where this segment meets each block: the side and the offset along it from
   * the side's centre, so several harnesses leaving one side get their own spot.
   * Absent for junction ends (they meet at the dot's centre).
   */
  sourcePort?: HarnessPort;
  targetPort?: HarnessPort;
  /** Shifts where the route turns so harnesses leaving together don't overlap. */
  stagger: number;
  /** Type filter result: 'match' is highlighted, 'dim' is faded, 'none' when no filter is set. */
  filter: 'none' | 'match' | 'dim';
  /** Whether the line can be dragged to reshape the route (edit mode, not drawing). */
  draggable: boolean;
  /** Dragging the line started at flow point `at`: add a bend there and return its junction id. */
  onLineDragStart: (harnessId: string, segmentId: string, at: XY) => string | null;
  /** Move that bend to flow point `to` (its centre); `done` on release. */
  onLineDrag: (junctionId: string, to: XY, done: boolean) => void;
};
export type HarnessFlowEdge = Edge<HarnessEdgeData, 'harness'>;

export type BlockSide = 'top' | 'right' | 'bottom' | 'left';
export interface HarnessPort {
  side: BlockSide;
  offset: number;
}

const SIDE_POSITION: Record<BlockSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

const LABEL_OFFSET = 14;
const TYPE_LETTER: Record<HarnessType, string> = { power: 'P', communication: 'C', safety: 'S', ground: 'G' };

// Detached path used to measure points along an SVG path string.
let measurePath: SVGPathElement | null = null;
function pathElement(d: string): SVGPathElement {
  measurePath ??= document.createElementNS('http://www.w3.org/2000/svg', 'path');
  measurePath.setAttribute('d', d);
  return measurePath;
}

/** Point at fraction `t` of a path, plus the unit normal on its "above" side (up, or left on verticals). */
function pointAt(p: SVGPathElement, t: number) {
  const len = p.getTotalLength();
  const at = p.getPointAtLength(len * t);
  const a = p.getPointAtLength(Math.max(0, len * t - 2));
  const b = p.getPointAtLength(Math.min(len, len * t + 2));
  const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let nx = -(b.y - a.y) / tl;
  let ny = (b.x - a.x) / tl;
  if (ny > 0 || (Math.abs(ny) < 1e-6 && nx > 0)) {
    nx = -nx;
    ny = -ny;
  }
  return { x: at.x, y: at.y, nx, ny };
}

/**
 * Where a harness meets a node: its assigned port on a block side, else the
 * middle of the block side facing the other end, or a junction's centre.
 */
function anchor(node: InternalNode, toward: { x: number; y: number }, port?: HarnessPort) {
  const { x, y } = node.internals.positionAbsolute;
  const w = node.measured.width ?? 0;
  const h = node.measured.height ?? 0;
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (port && node.type !== 'junction') {
    // On the block's actual outline (oval, diamond and circle curve inside the box).
    const shape = (node.data as { shape?: BlockShape }).shape ?? 'rectangle';
    return { ...boundaryPoint(shape, { x, y, w, h }, port.side, port.offset), pos: SIDE_POSITION[port.side] };
  }
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  const horizontal = node.type === 'junction' ? Math.abs(dx) > Math.abs(dy) : Math.abs(dx) * h > Math.abs(dy) * w;
  if (node.type === 'junction') {
    const pos = horizontal ? (dx > 0 ? Position.Right : Position.Left) : dy > 0 ? Position.Bottom : Position.Top;
    return { x: cx, y: cy, pos };
  }
  if (horizontal) return dx > 0 ? { x: x + w, y: cy, pos: Position.Right } : { x, y: cy, pos: Position.Left };
  return dy > 0 ? { x: cx, y: y + h, pos: Position.Bottom } : { x: cx, y, pos: Position.Top };
}

const centre = (n: InternalNode) => ({
  x: n.internals.positionAbsolute.x + (n.measured.width ?? 0) / 2,
  y: n.internals.positionAbsolute.y + (n.measured.height ?? 0) / 2,
});

type Anchor = { x: number; y: number; pos: Position };

const isVertical = (p: Position) => p === Position.Top || p === Position.Bottom;


/** Fraction of the gap between two rows where block-to-block harnesses run, clear of the tree connectors at 0.5. */
const HARNESS_RUN_FRACTION = 0.72;

/**
 * Route of one harness segment:
 * - bend/branch point to bend/branch point: a straight line (the user places the corners);
 * - block to bend point: straight out of the block, one rounded corner, into the point;
 * - block to block: right-angle routing that turns in the lower part of the gap
 *   between rows, so it doesn't run along the child-connect (tree) lines.
 */
function harnessPath(s: Anchor, t: Anchor, sJunction: boolean, tJunction: boolean, stagger: number): string {
  if (sJunction && tJunction) return `M ${s.x} ${s.y} L ${t.x} ${t.y}`;
  if (sJunction || tJunction) {
    const block = sJunction ? t : s;
    const dot = sJunction ? s : t;
    const corner = isVertical(block.pos) ? { x: block.x, y: dot.y } : { x: dot.x, y: block.y };
    const pts = [block, corner, dot];
    return roundedPolyline(sJunction ? pts.reverse() : pts);
  }
  const [path] = getSmoothStepPath({
    sourceX: s.x,
    sourceY: s.y,
    sourcePosition: s.pos,
    targetX: t.x,
    targetY: t.y,
    targetPosition: t.pos,
    borderRadius: 10,
    offset: 20,
    // Turn at a different spot per harness so parallel runs keep a gap.
    centerX: turnAt(s.x, t.x, (s.x + t.x) / 2 + stagger),
    centerY: turnAt(s.y, t.y, s.y + (t.y - s.y) * (s.y < t.y ? HARNESS_RUN_FRACTION : 1 - HARNESS_RUN_FRACTION) + stagger),
  });
  return path;
}

/** The turn, kept clear of both ends: a wide stagger must not fold a route back on a narrow gap. */
function turnAt(a: number, b: number, want: number): number {
  const lo = Math.min(a, b) + 24, hi = Math.max(a, b) - 24;
  return lo < hi ? Math.min(hi, Math.max(lo, want)) : (a + b) / 2;
}

export function HarnessEdge({ source, target, data }: EdgeProps<HarnessFlowEdge>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const { screenToFlowPosition } = useReactFlow();
  const [dragging, setDragging] = useState(false);

  if (!sourceNode || !targetNode || !data) return null;

  const s = anchor(sourceNode, centre(targetNode), data.sourcePort);
  const t = anchor(targetNode, centre(sourceNode), data.targetPort);
  const path = harnessPath(s, t, sourceNode.type === 'junction', targetNode.type === 'junction', data.stagger);

  let labelPoint: { x: number; y: number } | null = null;
  let labelMax: number | undefined;
  const horiz = (a: Anchor) => a.pos === Position.Left || a.pos === Position.Right;
  if (data.label?.anchor === 'end' && horiz(s) && horiz(t) && sourceNode.type !== 'junction' && targetNode.type !== 'junction') {
    // the last horizontal run: from the turn (see harnessPath's centerX) to the target - or the
    // first run when the target is the busier end, where the runs into it are packed close
    const turnX = turnAt(s.x, t.x, (s.x + t.x) / 2 + data.stagger);
    const end = data.labelAtSource ? s : t;
    labelPoint = { x: (turnX + end.x) / 2, y: end.y - LABEL_OFFSET };
    labelMax = Math.max(60, Math.abs(end.x - turnX) - 18);
  } else if (data.label) {
    const p = pointAt(pathElement(path), Math.min(1, Math.max(0, data.label.t)));
    const sign = data.label.side === 'above' ? 1 : -1;
    labelPoint = { x: p.x + p.nx * LABEL_OFFSET * sign, y: p.y + p.ny * LABEL_OFFSET * sign };
  }

  // Move the name to the nearest point on any segment of this harness; which
  // side of the line the pointer is on decides above/below.
  const nearestOnHarness = (clientX: number, clientY: number): HarnessLabelPos | null => {
    const pt = screenToFlowPosition({ x: clientX, y: clientY });
    let best: { d: number; pos: HarnessLabelPos } | null = null;
    const edges = document.querySelectorAll<SVGGElement>(`.react-flow__edge[data-id^="h__${data.harnessId}__"]`);
    for (const g of edges) {
      const el = g.querySelector<SVGPathElement>('path.react-flow__edge-path');
      const segment = g.getAttribute('data-id')!.split('__')[2];
      if (!el || !segment) continue;
      const steps = 80;
      for (let i = 0; i <= steps; i++) {
        const frac = i / steps;
        const p = pointAt(el, frac);
        const d = (p.x - pt.x) ** 2 + (p.y - pt.y) ** 2;
        if (!best || d < best.d) {
          const side = (pt.x - p.x) * p.nx + (pt.y - p.y) * p.ny >= 0 ? 'above' : 'below';
          best = { d, pos: { segment, t: frac, side } };
        }
      }
    }
    return best?.pos ?? null;
  };

  const types = data.types;
  return (
    <>
      <BaseEdge
        path={path}
        interactionWidth={18}
        style={{
          stroke: data.color,
          strokeWidth: data.selected || data.filter === 'match' ? 6 : 4,
          strokeLinecap: 'round',
          opacity: data.filter === 'dim' ? DIM_OPACITY : 1,
          filter:
            data.selected || data.filter === 'match' ? `drop-shadow(0 0 ${data.selected ? 4 : 6}px ${data.color})` : undefined,
          transition: 'opacity .15s, stroke-width .15s',
        }}
      />
      {data.draggable && (
        // Wide invisible strip along the line: drag it to bend the harness there.
        // Listeners live on the window because the segment is replaced (split in
        // two) as soon as the bend is added, unmounting this element mid-drag.
        <path
          d={path}
          className="harness-grab nodrag nopan"
          fill="none"
          stroke="transparent"
          strokeWidth={16}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const start = { x: e.clientX, y: e.clientY };
            const { harnessId, segmentId, onLineDragStart, onLineDrag } = data;
            let junctionId: string | null = null;
            let lastPos: XY | null = null;
            const move = (ev: PointerEvent) => {
              if (!junctionId) {
                if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
                junctionId = onLineDragStart(harnessId, segmentId, screenToFlowPosition(start));
                if (!junctionId) return;
              }
              lastPos = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
              onLineDrag(junctionId, lastPos, false);
            };
            const up = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
              if (junctionId && lastPos) onLineDrag(junctionId, lastPos, true);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
        />
      )}
      {labelPoint && (
        <EdgeLabelRenderer>
          <div
            className={`harness-label nodrag nopan${dragging || data.labelDragging ? ' dragging' : ''}${data.selected ? ' selected' : ''}${
              data.filter === 'dim' ? ' dimmed' : data.filter === 'match' ? ' matched' : ''
            }`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelPoint.x}px, ${labelPoint.y}px)`,
              borderColor: data.color,
              ...(labelMax ? { ['--label-max' as string]: `${labelMax - 30}px` } : {}),
            }}
            title={`${data.name || 'Unnamed harness'} — drag along the harness to move the name`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              // The drag runs on window listeners, not on this element: once the name crosses
              // onto another segment it is rendered by THAT segment's edge, and this component
              // unmounts mid-drag. Element handlers and state died with it, so the drop was
              // never saved and the screen disagreed with the file.
              const { harnessId, segmentId, onLabelMove, onLabelClick } = data;
              let moved = false;
              let last: HarnessLabelPos | null = null;
              setDragging(true);
              const move = (ev: PointerEvent) => {
                const pos = nearestOnHarness(ev.clientX, ev.clientY);
                if (!pos) return;
                moved = true;
                last = pos;
                onLabelMove(harnessId, pos, false);
              };
              const up = (ev: PointerEvent) => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                setDragging(false);
                if (moved && last) onLabelMove(harnessId, last, true);
                else onLabelClick(harnessId, segmentId, ev.clientX, ev.clientY);
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              data.onMenu(data.harnessId, data.segmentId, e.clientX, e.clientY);
            }}
          >
            <span className={data.name ? 'harness-name' : 'harness-name unnamed'}>{data.name || 'Unnamed harness'}</span>
            {types.length === 0 && (
              <span className="harness-type none" title="No type yet — right-click the harness to choose">
                ?
              </span>
            )}
            {types.map((ty) => (
              <span key={ty} className="harness-type" style={{ background: HARNESS_TYPE_COLORS[ty] }} title={ty}>
                {TYPE_LETTER[ty]}
              </span>
            ))}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
