// The robot's hardware architecture: types, colours and the initial data.
//
// The blocks and links themselves live in `architecture.json`, which the
// in-app editor saves to while the dev server is running.
//
// - `nodes` form one or more trees: every node except a root names its `parent`.
// - `links` are cross-connections between any two nodes (e.g. sibling to sibling).

import initialData from './architecture.json';
import type { BlockShape } from '../shapes';

// `group` collects separate products (e.g. accessories); `variant` marks
// interchangeable options of which only one is fitted at a time.
export const NODE_KINDS = ['system', 'group', 'subsystem', 'variant', 'accessory', 'module', 'component'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export interface ArchSource {
  title: string;
  url: string;
}

export interface ArchNode {
  id: string;
  label: string;
  kind: NodeKind;
  parent?: string;
  /** Short functionality line shown inside the box on the diagram. */
  summary?: string;
  /** Longer notes shown in the side panel. */
  description?: string;
  /** Where the information came from (Confluence pages, etc.). */
  sources?: ArchSource[];
  /** Position set by dragging; blocks without one are laid out automatically. */
  position?: XY;
  /** Drawn shape; rectangle when absent. */
  shape?: BlockShape;
  /** Bend points of the child-connect line from the parent to this block. */
  parentBends?: XY[];
}

export interface XY {
  x: number;
  y: number;
}

export type LinkKind = 'power' | 'data' | 'mechanical' | 'signal' | 'other';

export interface ArchLink {
  id: string;
  source: string;
  target: string;
  kind: LinkKind;
  label?: string;
  /** Bend points set by dragging the line. */
  bends?: XY[];
}

// ── Harnesses ────────────────────────────────────────────────────────────────

export const HARNESS_TYPES = ['power', 'communication', 'safety', 'ground'] as const;
export type HarnessType = (typeof HARNESS_TYPES)[number];

export const HARNESS_TYPE_COLORS: Record<HarnessType, string> = {
  power: '#ef4444',
  communication: '#3b82f6',
  safety: '#eab308',
  ground: '#22c55e',
};

/** Colour for a harness carrying several types. */
export const HARNESS_MIXED_COLOR = '#14b8a6';

/** A point on a harness where it branches, or where two harnesses were joined. */
export interface HarnessJunction {
  id: string;
  /** Top-left of the junction dot (see JUNCTION_SIZE). */
  position: XY;
}

/** One stretch of harness between two endpoints (block ids or junction ids). */
export interface HarnessSegment {
  id: string;
  from: string;
  to: string;
}

export interface HarnessLabelPos {
  /** Segment the name sits on. */
  segment: string;
  /** Fraction (0–1) along that segment's path. */
  t: number;
  side: 'above' | 'below';
}

/**
 * A harness: one name for the whole thing, the signal types it carries, and
 * the segments (with branch junctions) that make up its route between blocks.
 */
export interface Harness {
  id: string;
  /** Empty until named; joined harnesses must share a name. */
  name: string;
  types: HarnessType[];
  segments: HarnessSegment[];
  junctions: HarnessJunction[];
  label?: HarnessLabelPos;
}

/** One diagram: a set of blocks (forming trees) plus connections between them. */
export interface SheetData {
  nodes: ArchNode[];
  links: ArchLink[];
  harnesses?: Harness[];
}

/**
 * The whole document. The top-level `nodes`/`links` are the main sheet; `sheets`
 * holds each block's own detailed hierarchy, keyed by the id of the block that
 * owns it. Block ids are unique across all sheets, so sheets can nest.
 */
export interface ArchData extends SheetData {
  sheets?: Record<string, SheetData>;
  /** Project title shown at the top (default "Robot Hardware Architecture"). */
  title?: string;
  /** Name of the main sheet, shown under the title (default "Robot Architecture"). */
  mainSheetName?: string;
}

export const DEFAULT_TITLE = 'Robot Hardware Architecture';
export const DEFAULT_MAIN_SHEET_NAME = 'Robot Architecture';

export const LINK_KINDS = ['power', 'data', 'signal', 'mechanical', 'other'] as const satisfies readonly LinkKind[];

export const INITIAL_DATA = initialData as ArchData;

export const LINK_COLORS: Record<LinkKind, string> = {
  power: '#ef4444',
  data: '#3b82f6',
  signal: '#a855f7',
  mechanical: '#f59e0b',
  other: '#64748b',
};
