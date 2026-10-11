import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

/** `bend`: only two segments meet here (a turn in the route) rather than a branch. */
export type JunctionData = { color: string; harnessName: string; bend: boolean; dimmed: boolean; hovered?: boolean };
export type JunctionFlowNode = Node<JunctionData, 'junction'>;

/** A branch point on a harness. Harness segments attach to its centre. */
export function JunctionNode({ data, selected }: NodeProps<JunctionFlowNode>) {
  return (
    <div
      className={`junction${data.bend ? ' bend' : ''}${selected ? ' selected' : ''}${data.dimmed ? ' dimmed' : ''}${data.hovered ? ' hovered' : ''}`}
      style={{ background: data.color }}
      title={`${data.harnessName || 'Unnamed harness'} — ${data.bend ? 'bend' : 'branch'} point (drag to move)`}
    >
      {/* Harness edges compute their own anchor points; these only satisfy React Flow. */}
      <Handle type="source" position={Position.Top} />
      <Handle type="target" position={Position.Bottom} />
    </div>
  );
}
