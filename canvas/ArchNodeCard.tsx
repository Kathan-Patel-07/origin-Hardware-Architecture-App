import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { NodeKind } from './data/architecture';
import { formatAmps, type BlockCurrent } from './currents';
import { edgeInset, SHAPE_SIZE, type BlockShape } from './shapes';

export type ArchNodeData = {
  label: string;
  kind: NodeKind;
  summary?: string;
  shape: BlockShape;
  /** Block has its own hierarchy sheet (opened by double-click). */
  hasSheet: boolean;
  childCount: number;
  collapsed: boolean;
  onToggle: (id: string) => void;
  /** Current drawn: its own (a load) or the sum of the loads below it. */
  current?: BlockCurrent;
};

export type ArchFlowNode = Node<ArchNodeData, 'arch'>;

/** Outline of a non-rectangular shape, drawn to fill the w×h box (1.5px stroke inset). */
function ShapeOutline({ shape, w, h }: { shape: BlockShape; w: number; h: number }) {
  const s = 1.5;
  const outline =
    shape === 'diamond' ? (
      <polygon points={`${w / 2},${s} ${w - s},${h / 2} ${w / 2},${h - s} ${s},${h / 2}`} />
    ) : (
      <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - s} ry={h / 2 - s} />
    );
  return (
    <svg className="arch-shape-outline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {outline}
    </svg>
  );
}

export function ArchNodeCard({ id, data, selected }: NodeProps<ArchFlowNode>) {
  const { shape } = data;
  const { w, h } = SHAPE_SIZE[shape];
  // Mechanical-connection handles sit a quarter of the way along the top/bottom
  // edge; on curved or slanted shapes, move them in onto the outline.
  const quarterInset = edgeInset(shape, w / 2, h / 2, w / 4);

  return (
    <div
      className={`arch-node shape-${shape} kind-${data.kind}${selected ? ' selected' : ''}${data.hasSheet ? ' has-sheet' : ''}`}
      style={{ width: w, height: h }}
      title={data.hasSheet ? 'Double-click to open its hierarchy sheet' : undefined}
    >
      {shape !== 'rectangle' && <ShapeOutline shape={shape} w={w} h={h} />}

      {/* Tree edges use top/bottom centre. Cross-links use off-centre handles
          on the top or bottom, whichever faces the lane they run along. */}
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="link-out-bottom" style={{ left: '25%', bottom: quarterInset }} />
      <Handle type="target" position={Position.Bottom} id="link-in-bottom" style={{ left: '75%', bottom: quarterInset }} />
      <Handle type="source" position={Position.Top} id="link-out-top" style={{ left: '25%', top: quarterInset }} />
      <Handle type="target" position={Position.Top} id="link-in-top" style={{ left: '75%', top: quarterInset }} />

      <div className="arch-content">
        {/* The kind kicker only where it tells something: "component" on every part was
            noise that took a line from the part's own data. */}
        {(data.kind !== 'component' || data.hasSheet || data.current) && (
          <div className="arch-kind">
            {data.kind !== 'component' && data.kind}
            {data.hasSheet && <span className="sheet-badge">⧉ sheet</span>}
            {/* In the header line, not after the label: a long label is cut with "…" and took
                the current with it. */}
            {data.current && (
              <span
                className={`arch-current${data.current.own ? '' : ' sum'}`}
                title={data.current.own ? 'Current this load draws' : `Sum of the ${data.current.loads} load(s) below it`}
              >
                {data.current.own ? '' : 'Σ '}
                {formatAmps(data.current.amps)}
              </span>
            )}
          </div>
        )}
        <div className="arch-label">{data.label}</div>
        {data.summary && <div className="arch-summary">{data.summary}</div>}
      </div>

      {data.childCount > 0 && (
        <button
          className="arch-toggle nodrag"
          title={data.collapsed ? 'Expand' : 'Collapse'}
          onClick={(e) => {
            e.stopPropagation();
            data.onToggle(id);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {data.collapsed ? `+${data.childCount}` : '−'}
        </button>
      )}

      <Handle type="source" position={Position.Bottom} id="bottom" />
    </div>
  );
}
