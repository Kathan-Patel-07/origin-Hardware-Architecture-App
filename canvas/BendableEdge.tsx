import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import type { XY } from './data/architecture';
import { distToSegment, polylineMidpoint, roundedPolyline, snapToNeighbours } from './paths';

/**
 * A child-connect (tree) line or a mechanical connection that can be reshaped
 * like a harness: drag the line to add a bend, drag a bend dot to move it,
 * double-click a dot to remove it. Bends are stored in diagram coordinates.
 */
export type BendableEdgeData = {
  kind: 'tree' | 'lane';
  /** 'tree:<child id>' or 'link:<link id>' — where the bends are saved. */
  edgeKey: string;
  bends: XY[];
  /** Lane lines without bends run along this y (see App.tsx). */
  laneY?: number;
  /** Lane label colour. */
  color?: string;
  /** Reshaping allowed (edit mode, not drawing). */
  editable: boolean;
  /** Keep the bend dots visible (e.g. the connection is selected). */
  showBends: boolean;
  onBendsChange: (edgeKey: string, bends: XY[], done: boolean) => void;
};
export type BendableFlowEdge = Edge<BendableEdgeData, 'bendable'>;

const DRAG_THRESHOLD = 4;

/** Lane route: down/up from the source to `laneY`, across, then into the target. */
function lanePath(s: XY, t: XY, laneY: number): string {
  return roundedPolyline([s, { x: s.x, y: laneY }, { x: t.x, y: laneY }, t], 8);
}

/**
 * Route through the bends: straight out of the source block (vertically), one
 * corner onto the first bend, straight lines between bends, and one corner off
 * the last bend into the target block.
 */
function bentPoints(s: XY, t: XY, bends: XY[]): XY[] {
  const first = bends[0];
  const last = bends[bends.length - 1];
  return [s, { x: s.x, y: first.y }, ...bends, { x: t.x, y: last.y }, t];
}

export function BendableEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  label,
  style,
  markerEnd,
}: EdgeProps<BendableFlowEdge>) {
  const { screenToFlowPosition } = useReactFlow();
  if (!data) return null;

  const s = { x: sourceX, y: sourceY };
  const t = { x: targetX, y: targetY };
  const { bends } = data;

  let path: string;
  let labelAt: XY;
  if (bends.length) {
    const pts = bentPoints(s, t, bends);
    path = roundedPolyline(pts);
    labelAt = polylineMidpoint(pts);
  } else if (data.kind === 'lane') {
    const laneY = data.laneY ?? (s.y + t.y) / 2;
    path = lanePath(s, t, laneY);
    labelAt = { x: (s.x + t.x) / 2, y: laneY };
  } else {
    [path] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
    labelAt = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
  }

  /**
   * Follow the pointer with bend `index` (after `startBends`), snapping it level
   * or plumb with its neighbours. Listeners live on the window so the drag keeps
   * going whatever is under the pointer.
   */
  const dragBend = (startBends: XY[], index: number, alreadyChanged = false) => {
    let current = startBends;
    let changed = alreadyChanged;
    const neighbours = (b: XY[]) => [index === 0 ? s : b[index - 1], index === b.length - 1 ? t : b[index + 1]];
    const move = (ev: PointerEvent) => {
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const next = [...current];
      next[index] = snapToNeighbours(p, neighbours(current));
      current = next;
      changed = true;
      data.onBendsChange(data.edgeKey, current, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // A plain click (or the first click of a double-click) saves nothing.
      if (changed) data.onBendsChange(data.edgeKey, current, true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <g className={`bendable${data.showBends ? ' show-bends' : ''}`}>
      <BaseEdge path={path} style={style} markerEnd={markerEnd} interactionWidth={16} />
      {data.editable && (
        // Wide invisible strip: drag the line to add a bend where you grabbed it.
        <path
          d={path}
          className="line-grab nodrag nopan"
          fill="none"
          stroke="transparent"
          strokeWidth={16}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const start = { x: e.clientX, y: e.clientY };
            const waitForDrag = (ev: PointerEvent) => {
              if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
              window.removeEventListener('pointermove', waitForDrag);
              window.removeEventListener('pointerup', cancel);
              // Insert the new bend in the stretch of the route nearest the grab point.
              const grab = screenToFlowPosition(start);
              const stops = [s, ...bends, t];
              let at = 0;
              let best = Infinity;
              for (let i = 0; i < stops.length - 1; i++) {
                const d = distToSegment(grab, stops[i], stops[i + 1]);
                if (d < best) [at, best] = [i, d];
              }
              const withNew = [...bends.slice(0, at), grab, ...bends.slice(at)];
              data.onBendsChange(data.edgeKey, withNew, false);
              dragBend(withNew, at, true);
            };
            const cancel = () => {
              window.removeEventListener('pointermove', waitForDrag);
              window.removeEventListener('pointerup', cancel);
            };
            window.addEventListener('pointermove', waitForDrag);
            window.addEventListener('pointerup', cancel);
          }}
        />
      )}
      {data.editable &&
        bends.map((b, i) => (
          <circle
            key={i}
            className="bend-dot nodrag nopan"
            cx={b.x}
            cy={b.y}
            r={5}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              dragBend(bends, i);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              data.onBendsChange(
                data.edgeKey,
                bends.filter((_, j) => j !== i),
                true,
              );
            }}
          >
            <title>Drag to move · double-click to remove this bend</title>
          </circle>
        ))}
      {label && (
        <EdgeLabelRenderer>
          <div
            className="lane-label"
            style={{
              transform: `translate(-50%, -50%) translate(${labelAt.x}px, ${labelAt.y}px)`,
              color: data.color,
              borderColor: data.color,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}
