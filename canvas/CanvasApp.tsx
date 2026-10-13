import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type Edge,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './canvas.css';
import type { ArchitectureDataSource } from './dataSource';

import {
  DEFAULT_MAIN_SHEET_NAME,
  DEFAULT_TITLE,
  HARNESS_TYPE_COLORS,
  HARNESS_TYPES,
  LINK_COLORS,
  type ArchNode,
  type Harness,
  type HarnessLabelPos,
  type HarnessType,
  type LinkKind,
  type XY,
} from './data/architecture';
import { ArchNodeCard, type ArchFlowNode } from './ArchNodeCard';
import {
  BlockEditor,
  ConfirmDialog,
  ConnectDialog,
  ContextMenu,
  HarnessEditDialog,
  NamePrompt,
  ParentPicker,
  type MenuItem,
} from './EditDialogs';
import { HarnessTypeFilter } from './HarnessTypeFilter';
import { CanvasSearch } from './CanvasSearch';
import { InlineEdit } from './InlineEdit';
import { HarnessEdge, type BlockSide, type HarnessFlowEdge, type HarnessPort } from './HarnessEdge';
import {
  harnessColor,
  harnessDisplayName,
  harnessEdgeId,
  harnessMatches,
  joinBlockedReason,
  type FilterMode,
  junctionDegree,
  junctionTopLeft,
  JUNCTION_SIZE,
  type HarnessPoint,
} from './harness';
import { JunctionNode, type JunctionFlowNode } from './JunctionNode';
import { BendableEdge, type BendableFlowEdge } from './BendableEdge';
import { layoutTree, NODE_WIDTH } from './layout';
import { boundaryPoint, SHAPE_SIZE, shapeOf, sizeOf } from './shapes';
import {
  descendantsOf,
  findBlock,
  getSheet,
  nestedSheetCount,
  sheetPath,
  useArchitecture,
  type SaveStatus,
  type SheetId,
} from './useArchitecture';

const nodeTypes = { arch: ArchNodeCard, junction: JunctionNode };
const edgeTypes = { bendable: BendableEdge, harness: HarnessEdge };
// Cross-link lanes start below the collapse toggle and stack downward, staying
// clear of the tree connectors that run through the middle of each row gap.
const LANE_START = 20;
const LANE_SPACING = 14;
// Gap between harnesses leaving the same side of a block (shrinks to fit busy sides).
const PORT_SPACING = 26;
// Harness exits on a block's top/bottom (offsets from centre): between the tree
// line at the centre and the mechanical-connection points at the quarters.
const TOP_BOTTOM_SLOTS = [-NODE_WIDTH * 0.375, -NODE_WIDTH * 0.125, NODE_WIDTH * 0.125, NODE_WIDTH * 0.375];
// A dragged bend snaps level/plumb with a neighbouring point when this close.
const SNAP_DISTANCE = 10;
const DRAW_COLORS = { harness: '#94a3b8', mechanical: LINK_COLORS.mechanical };

/**
 * True when a key event belongs to the rest of the Studio rather than the canvas: focus is
 * on an element outside the canvas (a sidebar button, the tab bar). The canvas's shortcuts
 * listen on window, so without this Backspace on a focused Studio button deleted the
 * selected block. Focus on <body> (nothing focused) still counts as the canvas.
 */
/** Hash clear scheduled by an unmount; a remount cancels it (StrictMode's dev-only
 * unmount/remount must not strip the sheet the user is looking at from the URL). */
let pendingHashClear: ReturnType<typeof setTimeout> | undefined;

function outsideCanvas(e: KeyboardEvent) {
  const t = e.target;
  if (!(t instanceof Element) || t === document.body || t === document.documentElement) return false;
  return !t.closest('.canvas-root');
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'All changes saved',
  error: 'Not saved — the dev server did not answer; retrying (your edits are kept)',
  conflict: 'Not saved — changed in another window. Reload to see that version; your unsaved edits will then be offered for download.',
  rejected: 'Not saved — the store refused this document',
  load_error: 'Could not load the saved document — showing the bundled copy, editing is off',
  readonly: 'View only',
};

type Dialog =
  | { type: 'create'; parent?: string }
  | { type: 'edit'; id: string }
  | { type: 'parent'; id: string }
  | { type: 'connect'; from?: string; kind?: LinkKind }
  | { type: 'harnessEdit'; harnessId: string };

/** Name prompts shown after drawing (isNew) or from "Rename…". */
type Prompt =
  | { type: 'harnessName'; harnessId: string; isNew: boolean }
  | { type: 'linkName'; linkId: string; isNew: boolean };

type Menu = {
  x: number;
  y: number;
  id?: string;
  harness?: { id: string; segment: string; junctionId?: string };
  link?: string;
  /** Child-connect line, by child block id. */
  tree?: string;
};

/** One end of a harness or mechanical connection picked with the mouse. */
type DrawEnd = { type: 'block'; id: string } | { type: 'harness'; point: HarnessPoint };
/** Click-to-draw state; `bends` are turns clicked on empty canvas (flow coordinates, centre points). */
type Draw = { kind: 'harness' | 'mechanical'; start?: DrawEnd; bends: XY[] };

type FlowNode = ArchFlowNode | JunctionFlowNode;

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

// The harness type filter is a per-viewer preference kept in this browser only.
const FILTER_STORAGE_KEY = 'robot-arch.harnessFilter';
function loadFilter(): { types: HarnessType[]; mode: FilterMode } {
  try {
    const v = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) ?? 'null');
    if (v && Array.isArray(v.types) && (v.mode === 'any' || v.mode === 'all')) {
      return { types: HARNESS_TYPES.filter((t) => v.types.includes(t)), mode: v.mode };
    }
  } catch {
    // Storage unavailable or corrupt: start without a filter.
  }
  return { types: [], mode: 'any' };
}

// Each sheet has its own URL: #/sheet/<owner block id>; no hash = main sheet.
const sheetFromHash = (): SheetId => {
  const m = window.location.hash.match(/^#\/sheet\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
};

// How long after opening a sheet (or auto-arranging) canvas resizes still re-fit,
// so the first fit survives the page settling into its final size.
const FIT_SETTLE_MS = 1500;

// Fit the diagram to the canvas when a sheet opens (AutoFit remounts with each
// sheet) and when `fitKey` changes (Auto-arrange). Editing — ticking a harness
// type, renaming, adding blocks — never re-fits, so the view stays where the
// user left it; the fit-view button re-fits on demand.
/** Below this zoom a block's title (14px) drops under ~9px and stops being readable. */
const READABLE_ZOOM = 0.8;
/** Never open a sheet magnified past this (a 3-block sheet at 1.2x looked like a mistake). */
const MAX_OPEN_ZOOM = 1;

function AutoFit({ fitKey, direction }: { fitKey: string; direction: 'TB' | 'LR' }) {
  const { fitView, getNodes, setViewport } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const initialized = useNodesInitialized();
  const lastKey = useRef<string | null>(null);
  const settleUntil = useRef(0);
  useEffect(() => {
    if (!initialized) return;
    if (lastKey.current !== fitKey) {
      lastKey.current = fitKey;
      settleUntil.current = Date.now() + FIT_SETTLE_MS;
    } else if (Date.now() > settleUntil.current) {
      return; // a later resize (e.g. the top bar re-wrapping): keep the user's view
    }
    // Defer briefly so React Flow has applied the new node list first. (A timer,
    // not requestAnimationFrame, so it still runs in background/hidden tabs.)
    // Fit the sheet if it fits readably; otherwise open at a readable zoom anchored on where
    // the flow starts (top of a top-down tree, left end of a left-to-right flow) and let the
    // user scroll - a whole 120-block sheet at 1.4px text is a picture of specks.
    const timer = setTimeout(() => {
      const ns = getNodes().filter((n) => n.type === 'arch');
      if (!ns.length || !width || !height) return;
      // Decide from the blocks' extent and the canvas size (reading the zoom right after
      // fitView returned the previous, stale value).
      const minX = Math.min(...ns.map((n) => n.position.x));
      const minY = Math.min(...ns.map((n) => n.position.y));
      const maxX = Math.max(...ns.map((n) => n.position.x + (n.width ?? 250)));
      const maxY = Math.max(...ns.map((n) => n.position.y + (n.height ?? 112)));
      const fitZoom = Math.min(1.2, width / ((maxX - minX) * 1.3), height / ((maxY - minY) * 1.3));
      // Content is laid out from its top-left: open it there, top-aligned (centring a
      // short sheet left the top half of the screen empty), centred across when it fits.
      const PAD = 40;
      const z = Math.max(READABLE_ZOOM, Math.min(MAX_OPEN_ZOOM, fitZoom));
      const cw = (maxX - minX) * z;
      const ch = (maxY - minY) * z;
      let x = cw + 2 * PAD <= width ? (width - cw) / 2 - minX * z : PAD - minX * z;
      let y = ch + 2 * PAD <= height ? Math.min(PAD, (height - ch) / 2) - minY * z : PAD - minY * z;
      // A flow that does not fit opens on where it starts: that block must be on screen.
      const first = ns.reduce((a, n) =>
        direction === 'LR' ? (n.position.x < a.position.x ? n : a) : (n.position.y < a.position.y ? n : a));
      const fx = first.position.x * z + x;
      const fy = first.position.y * z + y;
      if (fy + 112 * z > height - PAD) y -= fy + 112 * z - height + PAD + (height - 112 * z) / 3;
      if (fx + 250 * z > width - PAD) x -= fx + 250 * z - width + PAD + (width - 250 * z) / 3;
      setViewport({ x, y, zoom: z }, { duration: 200 });
    }, 50);
    return () => clearTimeout(timer);
  }, [fitView, getNodes, setViewport, direction, width, height, fitKey, initialized]);
  return null;
}

type FlowItem = { id: string; data?: unknown; position?: XY } & Record<string, unknown>;

function sameShallow(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a as object);
  if (ka.length !== Object.keys(b as object).length) return false;
  return ka.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
}

function sameItem(a: FlowItem, b: FlowItem): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const x = a[k];
    const y = b[k];
    if (x === y) continue;
    if (k === 'position' || k === 'measured' || k === 'data' || k === 'style') {
      if (k === 'data' ? sameData(x, y) : sameShallow(x, y)) continue;
    }
    return false;
  }
  return true;
}

/** Data objects one level deep: arrays (bends, ports) compared element by element. */
function sameData(a: unknown, b: unknown): boolean {
  if (sameShallow(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra);
  if (ka.length !== Object.keys(rb).length) return false;
  return ka.every((k) => {
    const x = ra[k];
    const y = rb[k];
    if (x === y) return true;
    if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((v, i) => sameShallow(v, y[i]));
    return sameShallow(x, y);
  });
}

function useStableItems<T extends { id: string }>(items: T[]): T[] {
  const prev = useRef(new Map<string, T>());
  return useMemo(() => {
    const next = new Map<string, T>();
    const out = items.map((it) => {
      const old = prev.current.get(it.id);
      const keep = old && sameItem(old as unknown as FlowItem, it as unknown as FlowItem) ? old : it;
      next.set(it.id, keep);
      return keep;
    });
    prev.current = next;
    return out;
  }, [items]);
}

export default function CanvasApp({ dataSource }: { dataSource: ArchitectureDataSource }) {
  const {
    doc,
    status,
    undo,
    redo,
    canUndo,
    canRedo,
    setTitles,
    renameBlock,
    setLineBends,
    addBlock,
    editBlock,
    setParent,
    deleteBlock,
    addSheet,
    removeSheet,
    addLink,
    renameLink,
    deleteLink,
    setPositions,
    clearPositions,
    addHarness,
    connectToHarness,
    joinHarnesses,
    addBend,
    deleteBend,
    editHarness,
    setHarnessLabel,
    deleteHarnessSegment,
    deleteHarness,
    canSave: CAN_SAVE,
    saveMessage,
    notice: loadNotice,
    staleDraft,
    discardStaleDraft,
    loaded: docLoaded,
  } = useArchitecture(dataSource);

  const [sheetId, setSheetIdState] = useState<SheetId>(sheetFromHash);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedHarnessId, setSelectedHarnessId] = useState<string | null>(null);
  const [hoveredHarnessId, setHoveredHarnessId] = useState<string | null>(null);
  const [selectedJunctionId, setSelectedJunctionId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  // Opens in view mode: most visits are to read the architecture, and a stray drag or
  // Delete should not edit it. Edit mode is a deliberate switch (and off whenever saving
  // is impossible).
  const [editMode, setEditMode] = useState(false);
  useEffect(() => {
    if (!CAN_SAVE) setEditMode(false);
  }, [CAN_SAVE]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  // Click-to-draw mode for harnesses and mechanical connections.
  const [draw, setDraw] = useState<Draw | null>(null);
  const [cursor, setCursor] = useState<XY | null>(null);
  const [rf, setRf] = useState<ReactFlowInstance<FlowNode, Edge> | null>(null);
  // Live positions of blocks/junctions while they are being dragged (saved on drop).
  const [dragPos, setDragPos] = useState<Record<string, XY>>({});
  // Live bends of a child-connect / mechanical line while it is being reshaped (saved on drop).
  const [lineDrag, setLineDrag] = useState<Record<string, XY[]>>({});
  // Live position of a harness name while it is being dragged (saved on drop).
  const [labelDrag, setLabelDrag] = useState<Record<string, HarnessLabelPos>>({});
  const [arrangeCount, setArrangeCount] = useState(0);
  const [confirmArrange, setConfirmArrange] = useState(false);
  // Harness type filter: matching harnesses are highlighted, the rest dimmed.
  const [filter, setFilter] = useState(loadFilter);
  useEffect(() => {
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filter));
    } catch {
      // Not saved (e.g. private window); the filter still works for this visit.
    }
  }, [filter]);
  const toggleFilterType = (t: HarnessType) =>
    setFilter((f) => ({ ...f, types: HARNESS_TYPES.filter((x) => (x === t ? !f.types.includes(t) : f.types.includes(x))) }));

  // A sheet that no longer exists (deleted, undone, or a stale link) falls back to the main
  // sheet - and the state and URL follow, so a later redo does not jump back into it.
  const sheet = getSheet(doc, sheetId) ?? doc;
  const activeSheet: SheetId = getSheet(doc, sheetId) ? sheetId : null;
  useEffect(() => {
    // Only once the stored document is in: the bundled copy may not have the sheet a link
    // points at yet, and resetting then broke every sheet link.
    if (docLoaded && sheetId !== null && activeSheet === null) {
      setSheetIdState(null);
      if (/^#\/sheet\//.test(window.location.hash))
        history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, [docLoaded, sheetId, activeSheet]);
  const { nodes, links } = sheet;
  const harnesses = useMemo(() => sheet.harnesses ?? [], [sheet.harnesses]);
  const sheets = useMemo(() => doc.sheets ?? {}, [doc.sheets]);

  // One thing is selected at a time: a block, a harness (optionally one of its
  // bend/branch points), or a connection line. The Delete key deletes it.
  const selectBlock = useCallback((id: string | null) => {
    setSelectedId(id);
    setSelectedHarnessId(null);
    setSelectedJunctionId(null);
    setSelectedLinkId(null);
  }, []);
  // A search result to centre and select once its sheet has rendered.
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const selectHarness = useCallback((id: string | null, junctionId: string | null = null) => {
    setSelectedHarnessId(id);
    setSelectedJunctionId(junctionId);
    setSelectedId(null);
    setSelectedLinkId(null);
  }, []);
  const selectLink = useCallback((id: string | null) => {
    setSelectedLinkId(id);
    setSelectedId(null);
    setSelectedHarnessId(null);
    setSelectedJunctionId(null);
  }, []);

  const cancelDraw = useCallback(() => {
    setDraw(null);
    setCursor(null);
  }, []);

  const openSheet = useCallback(
    (id: SheetId, opts?: { replace?: boolean }) => {
      setSheetIdState(id);
      setCollapsed(new Set());
      selectBlock(null);
      setMenu(null);
      setDialog(null);
      setDragPos({});
      setLabelDrag({});
      cancelDraw();
      const hash = id === null ? '' : `#/sheet/${encodeURIComponent(id)}`;
      const url = hash || window.location.pathname + window.location.search;
      // Each pushed entry remembers the sheet it came from, so "Up" to that sheet can step
      // Back instead. Replacing the entry left two copies of the parent in the history, and
      // the next Back then seemed to do nothing; pushing made Back go down again.
      if (window.location.hash === hash) return;
      const st = history.state as { canvasFrom?: SheetId } | null;
      if (opts?.replace && st && 'canvasFrom' in st && st.canvasFrom === id) history.back();
      else if (opts?.replace) history.replaceState(null, '', url);
      else history.pushState({ canvasFrom: sheetFromHash() }, '', url);
    },
    [cancelDraw, selectBlock],
  );

  // Browser back/forward and pasted links.
  useEffect(() => {
    const onPop = () => {
      setSheetIdState(sheetFromHash());
      setCollapsed(new Set());
      selectBlock(null);
      setDraw(null);
    };
    clearTimeout(pendingHashClear);
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
      // Leaving the Canvas tab: drop the sheet hash so the Studio's URL no longer claims a
      // canvas sheet is open (Back on another tab would otherwise change only the URL).
      pendingHashClear = setTimeout(() => {
        if (/^#\/sheet\//.test(window.location.hash))
          history.replaceState(null, '', window.location.pathname + window.location.search);
      }, 0);
    };
  }, [selectBlock]);

  // Esc leaves draw mode; Backspace undoes the last bend.
  useEffect(() => {
    if (!draw) return;
    const onKey = (e: KeyboardEvent) => {
      if (outsideCanvas(e)) return;
      if (e.key === 'Escape') cancelDraw();
      else if (e.key === 'Backspace' && draw.bends.length && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        setDraw({ ...draw, bends: draw.bends.slice(0, -1) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draw, cancelDraw]);

  // Undo / redo shortcuts, as in Microsoft Office: Ctrl+Z, and Ctrl+Y or Ctrl+Shift+Z
  // (⌘ on a Mac). Text boxes keep their own undo, and nothing happens behind an
  // open dialog. While drawing, Ctrl+Z takes back the last bend.
  useEffect(() => {
    if (!editMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (outsideCanvas(e)) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const isUndo = key === 'z' && !e.shiftKey;
      const isRedo = key === 'y' || (key === 'z' && e.shiftKey);
      if (!isUndo && !isRedo) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (dialog || prompt || confirmArrange) return;
      e.preventDefault();
      if (draw) {
        if (isUndo && draw.bends.length) setDraw({ ...draw, bends: draw.bends.slice(0, -1) });
        return;
      }
      setMenu(null);
      if (isUndo) undo();
      else redo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editMode, dialog, prompt, confirmArrange, draw, undo, redo]);

  // Delete / Backspace deletes what's selected (undo brings it back). Not while
  // typing, behind a dialog, or while drawing (Backspace removes a bend there).
  const deleteSelectedRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!editMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (outsideCanvas(e)) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (dialog || prompt || confirmArrange || draw) return;
      e.preventDefault();
      setMenu(null);
      deleteSelectedRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editMode, dialog, prompt, confirmArrange, draw]);

  // The browser tab shows the project title.
  useEffect(() => {
    const previous = document.title;
    document.title = doc.title ?? DEFAULT_TITLE;
    return () => {
      document.title = previous;
    };
  }, [doc.title]);

  // Messages fade after a few seconds.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.error ? 8000 : 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  // Layout depends only on which blocks are shown - not on selection or a drag in progress -
  // so it is computed once here instead of on every render (a 500-block sheet re-ran it on
  // every drag frame and every click).
  const visible = useMemo(() => {
    const isVisible = (n: ArchNode): boolean => {
      let p = n.parent;
      const seen = new Set<string>([n.id]);
      while (p && !seen.has(p)) {
        if (collapsed.has(p)) return false;
        seen.add(p);
        p = byId.get(p)?.parent;
      }
      return true;
    };
    return nodes.filter(isVisible);
  }, [nodes, byId, collapsed]);
  const sheetDirection = sheet.direction ?? 'TB';
  // Block pairs joined by a harness (through its branch points), in harness order: the
  // first block is the feed. The layout uses them to keep connected blocks together.
  const layoutLinks = useMemo(() => {
    const out: [string, string][] = [];
    for (const h of harnesses) {
      const jids = new Set(h.junctions.map((j) => j.id));
      const blocks = [...new Set(h.segments.flatMap((s) => [s.from, s.to]).filter((x) => !jids.has(x)))];
      for (let i = 1; i < blocks.length; i++) out.push([blocks[0], blocks[i]]);
    }
    return out;
  }, [harnesses]);
  const layoutPositions = useMemo(() => layoutTree(visible, sheetDirection, layoutLinks), [visible, sheetDirection, layoutLinks]);
  const childrenOf = useCallback((id: string) => nodes.filter((n) => n.parent === id), [nodes]);

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Harness callbacks handed to the edges. They are stable and delegate to
  // refs, so edges don't re-render on every state change yet see current state.
  const labelClickRef = useRef<(harnessId: string, segmentId: string, x: number, y: number) => void>(() => {});
  const harnessMenuRef = useRef<(harnessId: string, segmentId: string, x: number, y: number) => void>(() => {});
  const lineDragStartRef = useRef<(harnessId: string, segmentId: string, at: XY) => string | null>(() => null);
  const lineDragRef = useRef<(junctionId: string, to: XY, done: boolean) => void>(() => {});
  const onLineDragStart = useCallback((h: string, s: string, at: XY) => lineDragStartRef.current(h, s, at), []);
  const onLineDrag = useCallback((j: string, to: XY, done: boolean) => lineDragRef.current(j, to, done), []);
  // Child-connect / mechanical line reshaped: show it live, save when released.
  const onBendsChange = useCallback(
    (edgeKey: string, bends: XY[], done: boolean) => {
      if (done) {
        setLineBends(activeSheet, edgeKey, bends);
        setLineDrag((prev) => {
          const next = { ...prev };
          delete next[edgeKey];
          return next;
        });
      } else {
        setLineDrag((prev) => ({ ...prev, [edgeKey]: bends }));
      }
    },
    [activeSheet, setLineBends],
  );
  const onLabelClick = useCallback(
    (h: string, s: string, x: number, y: number) => labelClickRef.current(h, s, x, y),
    [],
  );
  const onHarnessMenu = useCallback(
    (h: string, s: string, x: number, y: number) => harnessMenuRef.current(h, s, x, y),
    [],
  );
  const onLabelMove = useCallback(
    (harnessId: string, pos: HarnessLabelPos, done: boolean) => {
      if (done) {
        setHarnessLabel(activeSheet, harnessId, pos);
        setLabelDrag((prev) => {
          const next = { ...prev };
          delete next[harnessId];
          return next;
        });
      } else {
        setLabelDrag((prev) => ({ ...prev, [harnessId]: pos }));
      }
    },
    [activeSheet, setHarnessLabel],
  );

  const linesDraggable = editMode && !draw;

  const { flowNodes: rawFlowNodes, flowEdges: rawFlowEdges, centers, anchors } = useMemo(() => {
    // A node is hidden when any ancestor is collapsed.
    const visibleIds = new Set(visible.map((n) => n.id));
    const positions = new Map(layoutPositions);
    for (const [id, p] of Object.entries(dragPos)) if (positions.has(id)) positions.set(id, p);
    // Each block's bounding box (top-left + size of its shape) and shape.
    const shapeById = new Map(visible.map((n) => [n.id, shapeOf(n)]));
    const boxOf = (id: string) => {
      const p = positions.get(id);
      const shape = shapeById.get(id);
      return p && shape ? { ...p, ...SHAPE_SIZE[shape], shape } : undefined;
    };

    // Centre points of blocks and junctions (draw-mode rubber band starts here).
    const centers = new Map<string, XY>();
    for (const id of positions.keys()) {
      const b = boxOf(id)!;
      centers.set(id, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
    }

    const blockNodes: ArchFlowNode[] = visible.map((n) => {
      const { w, h } = sizeOf(n);
      return {
        id: n.id,
        type: 'arch',
        position: positions.get(n.id)!,
        // Fixed size so fitView, the minimap and dragging work without measuring
        // the DOM (React Flow treats nodes without `measured` as uninitialised).
        width: w,
        height: h,
        measured: { width: w, height: h },
        selected: n.id === selectedId,
        data: {
          label: n.label,
          kind: n.kind,
          summary: n.summary,
          shape: shapeOf(n),
          hasSheet: Boolean(sheets[n.id]),
          childCount: childrenOf(n.id).length,
          collapsed: collapsed.has(n.id),
          onToggle: toggle,
        },
      };
    });
    // Harness branch points, shown while their harness reaches a visible block.
    const junctionNodes: JunctionFlowNode[] = [];
    const endpointIds = new Set(visibleIds);
    // A junction without a stored position sits at the centre of the blocks it joins, shifted
    // a third of the way toward its first block (the feed), so the branches fan out from there.
    const autoJunctionPos = (h: Harness, jid: string): XY => {
      const ends = h.segments.flatMap((s) => (s.from === jid ? [s.to] : s.to === jid ? [s.from] : []));
      const pts = ends
        .map((id) => {
          const p = positions.get(id);
          const n = byId.get(id);
          return p && n ? { x: p.x + sizeOf(n).w / 2, y: p.y + sizeOf(n).h / 2 } : null;
        })
        .filter((p): p is XY => p !== null);
      if (!pts.length) return { x: 0, y: 0 };
      // Halfway between the feed (first block) and the centre of the ends: the trunk then
      // runs in the gap between them instead of through the column of ends.
      const feed = pts[0];
      const rest = pts.length > 1 ? pts.slice(1) : pts;
      const c = { x: rest.reduce((a, p) => a + p.x, 0) / rest.length, y: rest.reduce((a, p) => a + p.y, 0) / rest.length };
      const horizontal = Math.abs(c.x - feed.x) >= Math.abs(c.y - feed.y);
      return horizontal
        ? { x: (feed.x + c.x) / 2 - JUNCTION_SIZE / 2, y: c.y - JUNCTION_SIZE / 2 }
        : { x: c.x - JUNCTION_SIZE / 2, y: (feed.y + c.y) / 2 - JUNCTION_SIZE / 2 };
    };
    for (const h of harnesses) {
      const reachesVisible = h.segments.some((s) => visibleIds.has(s.from) || visibleIds.has(s.to));
      if (!reachesVisible) continue;
      for (const j of h.junctions) {
        const pos = dragPos[j.id] ?? j.position ?? autoJunctionPos(h, j.id);
        endpointIds.add(j.id);
        centers.set(j.id, { x: pos.x + JUNCTION_SIZE / 2, y: pos.y + JUNCTION_SIZE / 2 });
        junctionNodes.push({
          id: j.id,
          type: 'junction',
          position: pos,
          width: JUNCTION_SIZE,
          height: JUNCTION_SIZE,
          measured: { width: JUNCTION_SIZE, height: JUNCTION_SIZE },
          selected: h.id === selectedHarnessId,
          zIndex: 5,
          data: {
            color: harnessColor(h),
            harnessName: h.name,
            bend: junctionDegree(h, j.id) === 2,
            dimmed: !harnessMatches(h, filter.types, filter.mode),
            hovered: h.id === hoveredHarnessId,
          },
        });
      }
    }

    // Child-connect lines; drag one to bend it (bends are stored on the child block).
    // A parent link that is also a drawn harness (generated flow views) is shown once - as
    // the harness, which carries the wire name and type.
    const harnessPairs = new Set(
      harnesses.flatMap((h) => h.segments.flatMap((s) => [`${s.from}>${s.to}`, `${s.to}>${s.from}`])),
    );
    const treeEdges: BendableFlowEdge[] = visible
      .filter((n) => sheet.treeLines !== false && n.parent && visibleIds.has(n.parent) && !harnessPairs.has(`${n.parent}>${n.id}`))
      .map((n) => {
        const edgeKey = `tree:${n.id}`;
        return {
          id: `tree-${n.id}`,
          source: n.parent!,
          target: n.id,
          sourceHandle: 'bottom',
          targetHandle: 'top',
          type: 'bendable',
          className: 'tree-edge',
          data: {
            kind: 'tree',
            edgeKey,
            bends: lineDrag[edgeKey] ?? n.parentBends ?? [],
            editable: linesDraggable,
            showBends: false,
            onBendsChange,
          },
        };
      });

    // Each cross-link runs along a horizontal lane. Blocks side by side are
    // joined by a lane just below both; otherwise the lane runs through the gap
    // between the upper block's bottom and the lower block's top. Links sharing
    // a gap get stacked lanes. Recomputed from live positions, so connections
    // follow blocks while they are dragged.
    const lanesUsed = new Map<number, number>();
    const crossEdges: BendableFlowEdge[] = links
      .filter((l) => visibleIds.has(l.source) && visibleIds.has(l.target))
      .map((l) => {
        const s = boxOf(l.source)!;
        const t = boxOf(l.target)!;
        const sameRow = Math.abs(s.y + s.h / 2 - (t.y + t.h / 2)) < (s.h + t.h) / 2;
        const sourceAbove = s.y + s.h / 2 < t.y + t.h / 2;
        const upper = sourceAbove ? s : t;
        const lower = sourceAbove ? t : s;
        const base = sameRow ? Math.max(s.y + s.h, t.y + t.h) : upper.y + upper.h;
        const key = Math.round(base);
        const lane = lanesUsed.get(key) ?? 0;
        lanesUsed.set(key, lane + 1);
        const offset = LANE_START + lane * LANE_SPACING;
        const gap = lower.y - base;
        const laneY = sameRow ? base + offset : base + Math.min(offset, Math.max(gap / 2, 8));
        const sourceUpper = sameRow || sourceAbove;
        const targetUpper = sameRow || !sourceAbove;
        const color = LINK_COLORS[l.kind];
        return {
          id: `link-${l.id}`,
          source: l.source,
          target: l.target,
          sourceHandle: sourceUpper ? 'link-out-bottom' : 'link-out-top',
          targetHandle: targetUpper ? 'link-in-bottom' : 'link-in-top',
          type: 'bendable',
          label: l.label,
          data: {
            kind: 'lane',
            edgeKey: `link:${l.id}`,
            bends: lineDrag[`link:${l.id}`] ?? l.bends ?? [],
            laneY,
            color,
            editable: linesDraggable,
            showBends: l.id === selectedLinkId,
            onBendsChange,
          },
          animated: true,
          style:
            l.id === selectedLinkId
              ? { stroke: color, strokeWidth: 3.5, strokeDasharray: '6 4', filter: `drop-shadow(0 0 4px ${color})` }
              : { stroke: color, strokeWidth: 2, strokeDasharray: '6 4' },
          interactionWidth: 16,
          markerEnd: { type: MarkerType.ArrowClosed, color },
        };
      });

    // Harness ends that meet the same side of a block get their own port along
    // that side, ordered by where each harness is heading, so harnesses leaving
    // one block keep a gap instead of being drawn on top of each other (shorted).
    const ports = new Map<string, HarnessPort>(); // key: `${segmentId}:from` / `${segmentId}:to`
    const anchors = new Map<string, XY>(); // same keys: where that end meets its block's outline
    const fanRank = new Map<string, { i: number; n: number }>(); // same keys: place among the ends on that side
    type Box = NonNullable<ReturnType<typeof boxOf>>;
    type PortReq = { key: string; along: number; rel: number; seg: string; box: Box };
    const sides = new Map<string, PortReq[]>();
    for (const h of harnesses) {
      for (const s of h.segments) {
        if (!endpointIds.has(s.from) || !endpointIds.has(s.to)) continue;
        for (const [end, here, there] of [
          ['from', s.from, s.to],
          ['to', s.to, s.from],
        ] as const) {
          const box = boxOf(here); // blocks only; junction ends meet at the dot
          const other = centers.get(there);
          if (!box || !other) continue;
          const dx = other.x - (box.x + box.w / 2);
          const dy = other.y - (box.y + box.h / 2);
          // Attach on the side that faces the other end along the sheet's flow: on a
          // left-to-right sheet a line whose other end is beside the block (clear of its
          // width) leaves through the left/right side, even when that end is far up or down
          // - leaving through the top/bottom ran it straight through the blocks stacked above.
          // Top-down sheets mirror this. Otherwise: the side the other end is mostly towards.
          const clearX = other.x < box.x || other.x > box.x + box.w;
          const clearY = other.y < box.y || other.y > box.y + box.h;
          const side: BlockSide =
            sheetDirection === 'LR' && clearX ? (dx > 0 ? 'right' : 'left')
            : sheetDirection === 'TB' && clearY && !clearX ? (dy > 0 ? 'bottom' : 'top')
            : Math.abs(dx) * box.h > Math.abs(dy) * box.w ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top';
          const k = `${here}\n${side}`;
          if (!sides.has(k)) sides.set(k, []);
          const horizontalSide = side === 'top' || side === 'bottom';
          sides.get(k)!.push({
            key: `${s.id}:${end}`,
            along: horizontalSide ? other.x : other.y,
            rel: horizontalSide ? dx : dy,
            seg: s.id,
            box,
          });
        }
      }
    }
    for (const [k, list] of sides) {
      const side = k.split('\n')[1] as BlockSide;
      const box = list[0].box;
      list.sort((a, b) => a.along - b.along || a.seg.localeCompare(b.seg));
      let offsets: number[];
      if ((side === 'top' || side === 'bottom') && list.length <= TOP_BOTTOM_SLOTS.length) {
        // Top/bottom: use the slots between the tree-line attachment (centre) and the
        // mechanical-connection points (quarters), picking the run of slots that
        // best matches where the harnesses are heading. Slots scale with the block width.
        const slots = TOP_BOTTOM_SLOTS.map((v) => (v * box.w) / NODE_WIDTH);
        const mean = Math.max(-box.w / 2, Math.min(box.w / 2, list.reduce((a, p) => a + p.rel, 0) / list.length));
        let best = 0;
        let bestD = Infinity;
        for (let start = 0; start + list.length <= slots.length; start++) {
          const win = slots.slice(start, start + list.length);
          const d = Math.abs(win.reduce((a, v) => a + v, 0) / win.length - mean);
          if (d < bestD) [best, bestD] = [start, d];
        }
        offsets = slots.slice(best, best + list.length);
      } else {
        // Curved/slanted sides have less usable length near the ends.
        const usable = (side === 'top' || side === 'bottom' ? box.w : box.h) * (box.shape === 'rectangle' ? 1 : 0.6);
        const spacing = list.length > 1 ? Math.min(PORT_SPACING, (usable - 24) / (list.length - 1)) : 0;
        offsets = list.map((_, i) => (i - (list.length - 1) / 2) * spacing);
      }
      list.forEach((p, i) => {
        ports.set(p.key, { side, offset: offsets[i] });
        anchors.set(p.key, boundaryPoint(p.box.shape, p.box, side, offsets[i]));
        fanRank.set(p.key, { i, n: list.length });
      });
    }
    // Where a route turns, per segment: shifted by its port offset so parallel runs keep a gap.
    // Runs fanning out of one side cross unless the line turning first is the one whose end is
    // furthest out on its side of the fan: lines heading up turn in top-to-bottom order, lines
    // heading down in bottom-to-top order. So the shift flips sign for a line heading down
    // (heading right on a top-down sheet); with one sign for all, every downward pair crossed.
    // The turns of a fan are spaced by each line's place in the fan, TURN_GAP apart (the runs
    // read as one thick line at the old 8 px, and spacing them by port offset still squeezed a
    // nine-line fan to 16 px), fitted into the half of the gap next to the source: the run after
    // the turn carries the name, so it stays at least half the gap long.
    const TURN_GAP = 30;
    const turnStagger = (segId: string, sourcePort?: HarnessPort, targetPort?: HarnessPort) => {
      const a = anchors.get(`${segId}:from`);
      const b = anchors.get(`${segId}:to`);
      const ra = fanRank.get(`${segId}:from`), rb = fanRank.get(`${segId}:to`);
      if (!a || !b) return (((sourcePort?.offset ?? 0) + (targetPort?.offset ?? 0)) / 2) * 0.6;
      const across = sheetDirection === 'LR' ? b.y - a.y : b.x - a.x;
      const along = sheetDirection === 'LR' ? b.x - a.x : b.y - a.y;
      const fan = !rb || (ra && ra.n >= rb.n) ? ra : rb;  // the busier end sets the spacing
      if (!fan || fan.n < 2) return -Math.sign(along) * 12;
      const gap = Math.max(0, Math.min(TURN_GAP, (Math.abs(along) / 2 - 36) / (fan.n - 1)));
      const k = fan.i - (fan.n - 1) / 2;
      // the turns bunch next to the busier end, leaving the long run (with the name - see
      // labelAtSource) at the other end
      const toward = fan === rb && fan !== ra ? 1 : -1;
      return (across * along > 0 ? -k : k) * gap + toward * Math.sign(along) * (((fan.n - 1) / 2) * gap + 12);
    };
    // Harness segments. The harness name sits on one segment, by default at the
    // middle of the first one; it can be dragged anywhere along the harness.
    const harnessEdges: HarnessFlowEdge[] = [];
    for (const h of harnesses) {
      const shown = h.segments.filter((s) => endpointIds.has(s.from) && endpointIds.has(s.to));
      if (!shown.length) continue;
      let label = labelDrag[h.id] ?? h.label;
      if (!label || !shown.some((s) => s.id === label!.segment)) label = { segment: shown[0].id, t: 0.5, side: 'above' };
      const filterState = !filter.types.length ? 'none' : harnessMatches(h, filter.types, filter.mode) ? 'match' : 'dim';
      for (const s of shown) {
        const sourcePort = ports.get(`${s.id}:from`);
        const targetPort = ports.get(`${s.id}:to`);
        harnessEdges.push({
          id: harnessEdgeId(h.id, s.id),
          source: s.from,
          target: s.to,
          type: 'harness',
          zIndex: 1,
          data: {
            harnessId: h.id,
            segmentId: s.id,
            name: h.name,
            types: h.types,
            color: harnessColor(h),
            selected: h.id === selectedHarnessId,
            label: s.id === label.segment ? { t: label.t, side: label.side, anchor: label.anchor } : undefined,
            labelAtSource: (fanRank.get(`${s.id}:to`)?.n ?? 1) > (fanRank.get(`${s.id}:from`)?.n ?? 1),
            labelDragging: labelDrag[h.id] !== undefined,
            onLabelMove,
            onLabelClick,
            onMenu: onHarnessMenu,
            sourcePort,
            targetPort,
            stagger: turnStagger(s.id, sourcePort, targetPort),
            filter: filterState,
            draggable: linesDraggable,
            onLineDragStart,
            onLineDrag,
          },
        });
      }
    }

    return {
      flowNodes: [...blockNodes, ...junctionNodes] as FlowNode[],
      flowEdges: [...treeEdges, ...crossEdges, ...harnessEdges] as Edge[],
      centers,
      anchors,
    };
  }, [
    nodes,
    links,
    harnesses,
    sheets,
    byId,
    childrenOf,
    collapsed,
    visible,
    layoutPositions,
    sheetDirection,
    sheet.treeLines,
    selectedId,
    selectedHarnessId,
    hoveredHarnessId,
    selectedLinkId,
    toggle,
    dragPos,
    labelDrag,
    onLabelMove,
    onLabelClick,
    onHarnessMenu,
    linesDraggable,
    onLineDragStart,
    onLineDrag,
    filter,
    lineDrag,
    onBendsChange,
  ]);
  // Keep the identity of every node/edge whose content did not change. The memo above
  // rebuilds all objects on any change (a click, a drag frame), and React Flow re-renders
  // and re-measures every element whose object is new - 500 blocks made a click take ~0.7 s.
  const flowNodes = useStableItems(rawFlowNodes);
  const flowEdges = useStableItems(rawFlowEdges);
  // Centre and select a search result once its sheet is drawn (after the sheet's own
  // fit-to-view, which would otherwise move it away again).
  useEffect(() => {
    if (!pendingFocus || !rf) return;
    if (!flowNodes.some((n) => n.id === pendingFocus)) return;
    const id = pendingFocus;
    const t = setTimeout(() => {
      const n = rf.getNode(id);
      if (n) {
        selectBlock(id);
        rf.setCenter(n.position.x + (n.width ?? 250) / 2, n.position.y + (n.height ?? 112) / 2, { zoom: 1, duration: 400 });
      }
      setPendingFocus(null);
    }, 900);
    return () => clearTimeout(t);
  }, [pendingFocus, rf, flowNodes, selectBlock]);

  // Anything that Auto-arrange would reset: moved blocks or bent lines.
  // With a designed preset, "manual" means moved away from it.
  const preset = sheet.preset;
  const movedFrom = (id: string, p?: XY) => !preset?.[id] || !p || preset[id].x !== p.x || preset[id].y !== p.y;
  const hasManualLayout = preset
    ? nodes.some((n) => movedFrom(n.id, n.position) || n.parentBends) ||
      harnesses.some((h) => h.junctions.some((j) => preset[j.id] && movedFrom(j.id, j.position)))
    : nodes.some((n) => n.position || n.parentBends) || links.some((l) => l.bends);
  const autoArrange = () => {
    clearPositions(activeSheet);
    setDragPos({});
    setArrangeCount((c) => c + 1);
  };

  const selected = selectedId ? byId.get(selectedId) : undefined;
  const selectedHarness = selectedHarnessId ? harnesses.find((h) => h.id === selectedHarnessId) : undefined;
  const selectedLink = selectedLinkId ? links.find((l) => l.id === selectedLinkId) : undefined;
  const selectedLinks = selected
    ? links.filter((l) => l.source === selected.id || l.target === selected.id)
    : [];
  const harnessesAt = (blockId: string) =>
    harnesses.filter((h) => h.segments.some((s) => s.from === blockId || s.to === blockId));
  const breadcrumb = sheetPath(doc, activeSheet);
  // A "◀ part" block stands for a part drawn on another sheet - the feed of this sheet (the
  // block it opens from, one sheet up) or the other end of a loop or cross link. Double-clicking
  // it goes there and shows that part.
  const openReference = (blockId: string): boolean => {
    const name = byId.get(blockId)?.label.match(/^◀\s*(.+)$/)?.[1].trim();
    if (!name) return false;
    const up = breadcrumb.length > 1 ? breadcrumb[breadcrumb.length - 2] : undefined;
    const real = (id: SheetId) =>
      getSheet(doc, id)?.nodes.find((n) => (id === up && n.id === activeSheet) || n.label === name);
    for (const id of [...breadcrumb.slice(0, -1).reverse(), ...Object.keys(sheets)]) {
      const hit = id !== activeSheet ? real(id) : undefined;
      if (!hit) continue;
      openSheet(id, id === up ? { replace: true } : undefined);
      setPendingFocus(hit.id);
      return true;
    }
    return false;
  };
  const projectTitle = doc.title ?? DEFAULT_TITLE;
  const mainSheetName = doc.mainSheetName ?? DEFAULT_MAIN_SHEET_NAME;
  const sheetName = (id: SheetId) => (id === null ? mainSheetName : (findBlock(doc, id)?.label ?? id));
  const junctionHarness = (junctionId: string) => harnesses.find((h) => h.junctions.some((j) => j.id === junctionId));

  /**
   * Snap a bend/branch point being dragged (top-left `pos`) so it lines up
   * level or plumb with a neighbouring point on its harness — another bend, a
   * branch point, or where the harness meets a block — when within SNAP_DISTANCE.
   */
  const snapJunction = (junctionId: string, pos: XY): XY => {
    const h = harnesses.find((x) => x.junctions.some((j) => j.id === junctionId));
    if (!h) return pos;
    const c = { x: pos.x + JUNCTION_SIZE / 2, y: pos.y + JUNCTION_SIZE / 2 };
    let x = c.x;
    let y = c.y;
    let dx = SNAP_DISTANCE;
    let dy = SNAP_DISTANCE;
    for (const s of h.segments) {
      if (s.from !== junctionId && s.to !== junctionId) continue;
      const otherEnd = s.from === junctionId ? 'to' : 'from';
      const p = anchors.get(`${s.id}:${otherEnd}`) ?? centers.get(s[otherEnd]);
      if (!p) continue;
      if (Math.abs(p.x - c.x) < dx) [x, dx] = [p.x, Math.abs(p.x - c.x)];
      if (Math.abs(p.y - c.y) < dy) [y, dy] = [p.y, Math.abs(p.y - c.y)];
    }
    return { x: x - JUNCTION_SIZE / 2, y: y - JUNCTION_SIZE / 2 };
  };
  const isJunction = (id: string) => harnesses.some((h) => h.junctions.some((j) => j.id === id));

  /** A point on harness segment `segmentId` at a screen position (becomes a branch point's top-left). */
  const harnessPointAt = (harnessId: string, segmentId: string, clientX: number, clientY: number): HarnessPoint | null => {
    if (!rf) return null;
    const p = rf.screenToFlowPosition({ x: clientX, y: clientY });
    return { harnessId, segmentId, pos: { x: p.x - JUNCTION_SIZE / 2, y: p.y - JUNCTION_SIZE / 2 } };
  };

  const endpointXY = (end: DrawEnd): XY | undefined => {
    if (end.type === 'block') return centers.get(end.id);
    const p = end.point;
    return 'junctionId' in p ? centers.get(p.junctionId) : { x: p.pos.x + JUNCTION_SIZE / 2, y: p.pos.y + JUNCTION_SIZE / 2 };
  };

  const startDraw = (kind: Draw['kind'], start?: DrawEnd) => {
    setMenu(null);
    setCursor(null);
    setDraw({ kind, start, bends: [] });
    if (start?.type === 'block') selectBlock(start.id);
  };

  /** Empty canvas clicked while drawing a harness: add a bend there. */
  const addDrawBend = (clientX: number, clientY: number) => {
    if (!draw || draw.kind !== 'harness' || !draw.start || !rf) return;
    setDraw({ ...draw, bends: [...draw.bends, rf.screenToFlowPosition({ x: clientX, y: clientY })] });
  };

  /** A block, harness spot or branch point was clicked while drawing. */
  const pickDraw = (end: DrawEnd) => {
    if (!draw) return;
    if (draw.kind === 'mechanical' && end.type !== 'block') {
      setNotice({ text: 'A mechanical connection joins two blocks — click a block.', error: true });
      return;
    }
    if (!draw.start) {
      setDraw({ ...draw, start: end });
      if (end.type === 'block') selectBlock(end.id);
      else selectHarness(end.point.harnessId);
      return;
    }
    const a = draw.start;
    const b = end;
    const bends = draw.bends;
    if (a.type === 'block' && b.type === 'block' && a.id === b.id) return; // same block: keep waiting for the end
    cancelDraw();

    if (draw.kind === 'mechanical') {
      if (a.type !== 'block' || b.type !== 'block') return;
      const id = addLink(activeSheet, a.id, { target: b.id, kind: 'mechanical', label: '' });
      selectBlock(a.id);
      setPrompt({ type: 'linkName', linkId: id, isNew: true });
      return;
    }

    if (a.type === 'block' && b.type === 'block') {
      const id = addHarness(activeSheet, a.id, b.id, '', [], bends);
      selectHarness(id);
      setPrompt({ type: 'harnessName', harnessId: id, isNew: true });
      return;
    }

    if (a.type === 'harness' && b.type === 'harness') {
      const A = harnesses.find((h) => h.id === a.point.harnessId);
      const B = harnesses.find((h) => h.id === b.point.harnessId);
      if (!A || !B) return;
      const reason = joinBlockedReason(A, B);
      if (reason) {
        setNotice({ text: reason, error: true });
        return;
      }
      joinHarnesses(activeSheet, a.point, b.point, bends);
      selectHarness(A.id);
      setNotice({ text: `Joined into one harness: “${A.name || B.name || 'Unnamed harness'}”.` });
      return;
    }

    // One end on a harness, the other on a block: a branch of that harness.
    const point = a.type === 'harness' ? a.point : (b as Extract<DrawEnd, { type: 'harness' }>).point;
    const blockId = a.type === 'block' ? a.id : (b as Extract<DrawEnd, { type: 'block' }>).id;
    const h = harnesses.find((x) => x.id === point.harnessId);
    // Bends were clicked from start to end; the branch is built from the harness side.
    connectToHarness(activeSheet, point, blockId, a.type === 'harness' ? bends : [...bends].reverse());
    selectHarness(point.harnessId);
    if (h) setNotice({ text: `Branch added — it is part of “${harnessDisplayName(h)}” and shares its name.` });
  };

  /** Delete whatever is selected (Delete key). Every case can be undone with Ctrl+Z. */
  const deleteSelected = () => {
    const undoHint = ' — press Ctrl+Z to undo.';
    if (selectedLinkId) {
      const l = links.find((x) => x.id === selectedLinkId);
      if (!l) return;
      deleteLink(activeSheet, l.id);
      selectLink(null);
      setNotice({ text: `Deleted ${l.kind} connection${l.label ? ` “${l.label}”` : ''}${undoHint}` });
      return;
    }
    if (selectedJunctionId && selectedHarnessId) {
      const h = harnesses.find((x) => x.id === selectedHarnessId);
      if (h && junctionDegree(h, selectedJunctionId) === 2) {
        deleteBend(activeSheet, h.id, selectedJunctionId);
        setSelectedJunctionId(null);
        setNotice({ text: `Removed a bend point from “${harnessDisplayName(h)}”${undoHint}` });
        return;
      }
      // A branch point joins several runs; deleting it is ambiguous.
      setNotice({ text: 'That is a branch point. Right-click it to delete one segment or the whole harness.' });
      return;
    }
    if (selectedHarnessId) {
      const h = harnesses.find((x) => x.id === selectedHarnessId);
      if (!h) return;
      deleteHarness(activeSheet, h.id);
      selectHarness(null);
      setNotice({ text: `Deleted harness “${harnessDisplayName(h)}”${undoHint}` });
      return;
    }
    if (selectedId) {
      const n = byId.get(selectedId);
      if (!n) return;
      const extras = [
        childrenOf(n.id).length ? 'its children moved up a level' : '',
        sheets[n.id] ? 'its hierarchy sheet was removed' : '',
      ].filter(Boolean);
      deleteBlock(activeSheet, n.id);
      selectBlock(null);
      setNotice({ text: `Deleted “${n.label}”${extras.length ? ` (${extras.join('; ')})` : ''}${undoHint}` });
    }
  };

  // Keep the edge callbacks pointing at the latest state.
  useLayoutEffect(() => {
    deleteSelectedRef.current = deleteSelected;
    labelClickRef.current = (harnessId, segmentId, x, y) => {
      if (draw) {
        const point = harnessPointAt(harnessId, segmentId, x, y);
        if (point) pickDraw({ type: 'harness', point });
      } else {
        selectHarness(harnessId);
      }
    };
    harnessMenuRef.current = (harnessId, segmentId, x, y) => {
      if (!editMode) return;
      if (draw) {
        cancelDraw();
        return;
      }
      selectHarness(harnessId);
      setMenu({ x, y, harness: { id: harnessId, segment: segmentId } });
    };
    lineDragStartRef.current = (harnessId, segmentId, at) => {
      selectHarness(harnessId);
      return addBend(activeSheet, harnessId, segmentId, junctionTopLeft(at));
    };
    lineDragRef.current = (junctionId, to, done) => {
      const pos = snapJunction(junctionId, junctionTopLeft(to));
      if (done) {
        setPositions(activeSheet, { [junctionId]: pos });
        setDragPos((prev) => {
          const next = { ...prev };
          delete next[junctionId];
          return next;
        });
      } else {
        setDragPos((prev) => ({ ...prev, [junctionId]: pos }));
      }
    };
  });

  const confirmDelete = (id: string) => {
    const n = byId.get(id);
    if (!n) return;
    const kids = childrenOf(id).length;
    const sheetCount = nestedSheetCount(doc, id);
    const wired = harnessesAt(id).length;
    let note = '';
    if (kids) note += `\n\nIts ${kids} child block(s) will move up to ${n.parent ? `“${byId.get(n.parent)?.label}”` : 'the top level'}.`;
    if (sheetCount) note += `\n\nIts hierarchy sheet${sheetCount > 1 ? ` (and ${sheetCount - 1} nested sheet(s))` : ''} will be deleted too.`;
    if (wired) note += `\n\nHarness segments ending at it (${wired} harness${wired > 1 ? 'es' : ''}) will be removed.`;
    if (window.confirm(`Delete “${n.label}”?${note}`)) {
      deleteBlock(activeSheet, id);
      if (selectedId === id) setSelectedId(null);
    }
  };

  const confirmRemoveSheet = (id: string) => {
    const n = byId.get(id);
    const count = nestedSheetCount(doc, id);
    const blocks = sheets[id]?.nodes.length ?? 0;
    const nested = count > 1 ? ` and ${count - 1} nested sheet(s)` : '';
    if (window.confirm(`Remove the hierarchy sheet of “${n?.label}”?\n\nIts ${blocks} block(s)${nested} will be deleted.`)) {
      removeSheet(id);
    }
  };

  const confirmDeleteHarness = (h: Harness) => {
    if (window.confirm(`Delete the whole harness “${harnessDisplayName(h)}” (${h.segments.length} segment(s))?`)) {
      deleteHarness(activeSheet, h.id);
      setSelectedHarnessId(null);
    }
  };

  const menuItems = (m: Menu): MenuItem[] => {
    if (m.link) {
      const linkId = m.link;
      const bent = Boolean(links.find((l) => l.id === linkId)?.bends?.length);
      return [
        { label: 'Rename connection…', onClick: () => setPrompt({ type: 'linkName', linkId, isNew: false }) },
        ...(bent ? [{ label: 'Straighten line', onClick: () => setLineBends(activeSheet, `link:${linkId}`, []) }] : []),
        { label: 'Delete connection', danger: true, onClick: () => deleteLink(activeSheet, linkId) },
      ];
    }
    if (m.tree) {
      const childId = m.tree;
      const bent = Boolean(byId.get(childId)?.parentBends?.length);
      return bent
        ? [{ label: 'Straighten line', onClick: () => setLineBends(activeSheet, `tree:${childId}`, []) }]
        : [{ label: 'Drag the line to bend it', onClick: () => {} }];
    }
    if (m.harness) {
      const h = harnesses.find((x) => x.id === m.harness!.id);
      if (!h) return [];
      const side = (labelDrag[h.id] ?? h.label)?.side ?? 'above';
      const labelPos =
        h.label && h.segments.some((s) => s.id === h.label!.segment) ? h.label : { segment: h.segments[0].id, t: 0.5, side };
      const here: HarnessPoint | null = m.harness.junctionId
        ? { harnessId: h.id, junctionId: m.harness.junctionId }
        : harnessPointAt(h.id, m.harness.segment, m.x, m.y);
      const bendId = m.harness.junctionId && junctionDegree(h, m.harness.junctionId) === 2 ? m.harness.junctionId : null;
      return [
        ...(bendId ? [{ label: 'Remove bend point', onClick: () => deleteBend(activeSheet, h.id, bendId) }] : []),
        { label: 'Rename harness…', onClick: () => setPrompt({ type: 'harnessName', harnessId: h.id, isNew: false }) },
        // Harness types: tick as many as the harness carries; the menu stays open.
        ...HARNESS_TYPES.map((t, i) => ({
          label: capitalize(t),
          checked: h.types.includes(t),
          keepOpen: true,
          color: HARNESS_TYPE_COLORS[t],
          divider: i === 0,
          onClick: () =>
            editHarness(
              activeSheet,
              h.id,
              h.name,
              HARNESS_TYPES.filter((x) => (x === t ? !h.types.includes(t) : h.types.includes(x))),
            ),
        })),
        ...(here
          ? [{ label: 'Branch / connect from here…', divider: true, onClick: () => startDraw('harness', { type: 'harness', point: here }) }]
          : []),
        {
          label: side === 'above' ? 'Show name below the harness' : 'Show name above the harness',
          divider: !here,
          onClick: () => setHarnessLabel(activeSheet, h.id, { ...labelPos, side: side === 'above' ? 'below' : 'above' }),
        },
        ...(h.segments.length > 1
          ? [{ label: 'Delete this segment', danger: true, onClick: () => deleteHarnessSegment(activeSheet, h.id, m.harness!.segment) }]
          : []),
        { label: 'Delete whole harness', danger: true, onClick: () => confirmDeleteHarness(h) },
      ];
    }
    if (!m.id)
      return [
        { label: 'Add block', onClick: () => setDialog({ type: 'create' }) },
        { label: 'Add harness', onClick: () => startDraw('harness') },
        { label: 'Add mechanical connection', onClick: () => startDraw('mechanical') },
        ...(hasManualLayout ? [{ label: 'Auto-arrange this sheet…', onClick: () => setConfirmArrange(true) }] : []),
      ];
    const id = m.id;
    const n = byId.get(id);
    if (!n) return [];
    const hasSheet = Boolean(sheets[id]);
    return [
      { label: 'Edit text…', onClick: () => setDialog({ type: 'edit', id }) },
      { label: n.parent ? 'Change parent…' : 'Link to parent…', onClick: () => setDialog({ type: 'parent', id }) },
      ...(n.parent ? [{ label: 'Make it a parent (unlink)', onClick: () => setParent(activeSheet, id, undefined) }] : []),
      { label: 'Add child block', onClick: () => setDialog({ type: 'create', parent: id }) },
      { label: 'Draw harness from here', onClick: () => startDraw('harness', { type: 'block', id }) },
      { label: 'Draw mechanical connection from here', onClick: () => startDraw('mechanical', { type: 'block', id }) },
      { label: 'Connect to…', onClick: () => setDialog({ type: 'connect', from: id }) },
      hasSheet
        ? { label: 'Open hierarchy sheet', onClick: () => openSheet(id) }
        : { label: 'Add hierarchy sheet', onClick: () => addSheet(id) },
      ...(hasSheet ? [{ label: 'Remove hierarchy sheet', danger: true, onClick: () => confirmRemoveSheet(id) }] : []),
      { label: 'Delete block', danger: true, onClick: () => confirmDelete(id) },
    ];
  };

  const dialogNode = dialog && 'id' in dialog ? byId.get(dialog.id) : undefined;
  const dialogHarness = dialog && 'harnessId' in dialog ? harnesses.find((h) => h.id === dialog.harnessId) : undefined;
  const promptHarness = prompt?.type === 'harnessName' ? harnesses.find((h) => h.id === prompt.harnessId) : undefined;
  const promptLink = prompt?.type === 'linkName' ? links.find((l) => l.id === prompt.linkId) : undefined;

  // Rubber-band line from the picked start, through any bends, to the mouse while drawing.
  const startXY = draw?.start ? endpointXY(draw.start) : undefined;
  const startScreen = startXY && rf ? rf.flowToScreenPosition(startXY) : undefined;
  const bendScreens = draw && rf ? draw.bends.map((b) => rf.flowToScreenPosition(b)) : [];
  const rubberBand = startScreen ? [startScreen, ...bendScreens, ...(cursor ? [cursor] : [])] : [];
  const drawHint = !draw
    ? ''
    : draw.kind === 'harness'
      ? draw.start
        ? `Click empty space to add a bend${draw.bends.length ? ` (${draw.bends.length}; Backspace undoes)` : ''} · click the end: a block, or a harness to branch into / join.`
        : 'Add harness — click the start: a block, a harness line or a branch point.'
      : draw.start
        ? 'Now click the second block.'
        : 'Add mechanical connection — click the first block.';

  return (
    <div className="canvas-root app">
      {/* Two-row top bar (grid, see .topbar in index.css):
          row 1: title | edit mode + undo/redo | + Add block   | + Add harness | Harness type ▾          | status | Auto-arrange
          row 2: title | legend                | + Add mechanical |              | Power/Comm/Safety/Ground |        |            */}
      <header className="topbar">
        <div className="tb-title title-block">
          <h1>
            <InlineEdit
              value={projectTitle}
              editable={CAN_SAVE && editMode}
              label="the project"
              onSave={(v) => setTitles({ title: v })}
            />
          </h1>
          <CanvasSearch doc={doc} sheetName={sheetName} onPick={(sheetId, blockId) => {
            openSheet(sheetId);
            setPendingFocus(blockId);
          }} />
          <nav className="breadcrumb" aria-label="Sheets">
            {breadcrumb.map((id, i) => (
              <span key={id ?? 'main'} className="crumb">
                {i > 0 && <span className="crumb-sep">›</span>}
                {i === breadcrumb.length - 1 ? (
                  // The current sheet's name: the main sheet's own name, or the
                  // block that owns this hierarchy sheet (renaming renames the block).
                  <InlineEdit
                    className="crumb-current"
                    value={sheetName(id)}
                    editable={CAN_SAVE && editMode}
                    label={id === null ? 'this sheet' : 'this block'}
                    onSave={(v) => (id === null ? setTitles({ mainSheetName: v }) : renameBlock(id, v))}
                  />
                ) : (
                  <button className="link" onClick={() => openSheet(id)}>
                    {sheetName(id)}
                  </button>
                )}
              </span>
            ))}
          </nav>
        </div>

        <div className="tb-edit">
          {activeSheet !== null && (
            <button
              className="btn"
              title={`Up to ${sheetName(breadcrumb[breadcrumb.length - 2] ?? null)}`}
              onClick={() => openSheet(breadcrumb[breadcrumb.length - 2] ?? null, { replace: true })}
            >
              ↑ Up
            </button>
          )}
          {CAN_SAVE && (
            <label className="switch">
              <input
                type="checkbox"
                checked={editMode}
                onChange={(e) => {
                  setEditMode(e.target.checked);
                  cancelDraw();
                }}
              />
              Edit mode
            </label>
          )}
          {CAN_SAVE && editMode && (
            <span className="undo-redo" role="group" aria-label="Undo and redo">
              <button
                className="btn icon"
                onClick={() => {
                  cancelDraw();
                  undo();
                }}
                disabled={!canUndo}
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
              >
                ↶
              </button>
              <button
                className="btn icon"
                onClick={() => {
                  cancelDraw();
                  redo();
                }}
                disabled={!canRedo}
                title="Redo (Ctrl+Y)"
                aria-label="Redo"
              >
                ↷
              </button>
            </span>
          )}
        </div>

        <div className="tb-legend legend">
          <span className="legend-item">
            <span className="swatch tree" /> child-connect
          </span>
          {/* Only the connection types actually used on this sheet. */}
          {(Object.keys(LINK_COLORS) as LinkKind[]).filter((k) => links.some((l) => l.kind === k)).map((k) => (
            <span key={k} className="legend-item">
              <span className="swatch" style={{ borderColor: LINK_COLORS[k] }} /> {k}
            </span>
          ))}
          {harnesses.length > 0 && (
            <span className="legend-item">
              <span className="swatch harness" /> harness
            </span>
          )}
        </div>

        {CAN_SAVE && editMode && (
          <>
            <button className="btn primary tb-add-block" onClick={() => setDialog({ type: 'create' })}>
              + Add block
            </button>
            <button
              className={`btn mechanical tb-add-mech${draw?.kind === 'mechanical' ? ' active' : ''}`}
              aria-pressed={draw?.kind === 'mechanical'}
              onClick={() => (draw?.kind === 'mechanical' ? cancelDraw() : startDraw('mechanical'))}
              title="Click two blocks to draw a mechanical connection"
            >
              + Add mechanical
            </button>
            <button
              className={`btn primary tb-add-harness${draw?.kind === 'harness' ? ' active' : ''}`}
              aria-pressed={draw?.kind === 'harness'}
              onClick={() => (draw?.kind === 'harness' ? cancelDraw() : startDraw('harness'))}
              title="Click a start and an end on the diagram to draw a harness"
            >
              + Add harness
            </button>
          </>
        )}

        {harnesses.length > 0 && (
          <>
            <div className="tb-filter">
              <HarnessTypeFilter
                types={filter.types}
                mode={filter.mode}
                matched={harnesses.filter((h) => harnessMatches(h, filter.types, filter.mode)).length}
                total={harnesses.length}
                onToggle={toggleFilterType}
                onMode={(m) => setFilter((f) => ({ ...f, mode: m }))}
                onClear={() => setFilter((f) => ({ ...f, types: [] }))}
              />
            </div>
            {/* Harness type colours, under the filter they belong to. */}
            <div className="tb-types legend" aria-label="Harness type colours">
              {HARNESS_TYPES.map((t) => (
                <span key={t} className="legend-item">
                  <span className="type-dot" style={{ background: HARNESS_TYPE_COLORS[t] }} />
                  {t}
                </span>
              ))}
            </div>
          </>
        )}

        <span
          className={`tb-status save-status ${status}${['conflict', 'rejected', 'load_error'].includes(status) ? ' error' : ''}`}
          title={[saveMessage, loadNotice].filter(Boolean).join(' — ') || undefined}
        >
          {/* Error details only with an error status; a stale message next to "Saving…" misled. */}
          {[status === 'rejected' && saveMessage ? `${STATUS_TEXT[status]}: ${saveMessage}` : STATUS_TEXT[status], loadNotice]
            .filter(Boolean)
            .join(' · ')}
          {staleDraft && (
            <>
              {' '}
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(staleDraft, null, 2) + '\n'], { type: 'application/json' }),
                  );
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'canvas-unsaved-edits.json';
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                Download my edits
              </button>{' '}
              <button type="button" className="btn" onClick={discardStaleDraft}>
                Discard
              </button>
            </>
          )}
        </span>
        {CAN_SAVE && editMode && hasManualLayout && (
          // Far right, away from the everyday buttons; asks before resetting the layout.
          <button
            className="btn tb-arrange auto-arrange"
            onClick={() => setConfirmArrange(true)}
            title="Reset every block on this sheet to the automatic layout"
          >
            Auto-arrange
          </button>
        )}
      </header>

      <div className="main">
        <div
          className={`canvas${draw ? ' drawing' : ''}`}
          onMouseMove={(e) => draw?.start && setCursor({ x: e.clientX, y: e.clientY })}
          onMouseLeave={() => setCursor(null)}
        >
          <ReactFlow
            key={activeSheet ?? 'main'}
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={setRf}
            onNodeClick={(_, n) => {
              if (n.type === 'junction') {
                const h = junctionHarness(n.id);
                if (draw && h) pickDraw({ type: 'harness', point: { harnessId: h.id, junctionId: n.id } });
                else selectHarness(h?.id ?? null, n.id);
              } else if (draw) {
                pickDraw({ type: 'block', id: n.id });
              } else {
                selectBlock(n.id);
              }
            }}
            onNodeDoubleClick={(_, n) => !draw && (sheets[n.id] ? openSheet(n.id) : openReference(n.id))}
            onEdgeMouseEnter={(_, edge) => {
              const hid = (edge.data as { harnessId?: string } | undefined)?.harnessId;
              if (edge.type === 'harness' && hid) setHoveredHarnessId(hid);
            }}
            onEdgeMouseLeave={(_, edge) => {
              if (edge.type === 'harness') setHoveredHarnessId(null);
            }}
            onEdgeClick={(e, edge) => {
              if (edge.type === 'bendable') {
                if (!draw && (edge as BendableFlowEdge).data?.kind === 'lane') selectLink(edge.id.replace(/^link-/, ''));
                return;
              }
              if (edge.type !== 'harness') return;
              const d = (edge as HarnessFlowEdge).data!;
              if (draw) {
                const point = harnessPointAt(d.harnessId, d.segmentId, e.clientX, e.clientY);
                if (point) pickDraw({ type: 'harness', point });
              } else {
                selectHarness(d.harnessId);
              }
            }}
            onPaneClick={(e) => (draw ? addDrawBend(e.clientX, e.clientY) : selectBlock(null))}
            onNodeContextMenu={(e, n) => {
              if (!editMode) return;
              e.preventDefault();
              if (draw) return cancelDraw();
              if (n.type === 'junction') {
                const h = junctionHarness(n.id);
                const seg = h?.segments.find((s) => s.from === n.id || s.to === n.id);
                if (h && seg) {
                  selectHarness(h.id);
                  setMenu({ x: e.clientX, y: e.clientY, harness: { id: h.id, segment: seg.id, junctionId: n.id } });
                }
                return;
              }
              selectBlock(n.id);
              setMenu({ x: e.clientX, y: e.clientY, id: n.id });
            }}
            onEdgeContextMenu={(e, edge) => {
              if (!editMode) return;
              if (edge.type === 'harness') {
                e.preventDefault();
                const d = (edge as HarnessFlowEdge).data!;
                onHarnessMenu(d.harnessId, d.segmentId, e.clientX, e.clientY);
              } else if (edge.type === 'bendable') {
                e.preventDefault();
                if (draw) return cancelDraw();
                if ((edge as BendableFlowEdge).data?.kind === 'lane') {
                  setMenu({ x: e.clientX, y: e.clientY, link: edge.id.replace(/^link-/, '') });
                } else {
                  setMenu({ x: e.clientX, y: e.clientY, tree: edge.id.replace(/^tree-/, '') });
                }
              }
            }}
            onPaneContextMenu={(e) => {
              if (!editMode) return;
              e.preventDefault();
              if (draw) return cancelDraw();
              setMenu({ x: e.clientX, y: e.clientY });
            }}
            zoomOnDoubleClick={false}
            nodesDraggable={editMode && !draw}
            onNodesChange={(changes) => {
              const moved = changes.filter((c) => c.type === 'position' && c.position);
              if (!moved.length) return;
              setDragPos((prev) => {
                const next = { ...prev };
                for (const c of moved)
                  if (c.type === 'position' && c.position)
                    next[c.id] = isJunction(c.id) ? snapJunction(c.id, c.position) : c.position;
                return next;
              });
            }}
            onNodeDragStop={(_, __, dragged) => {
              // The first move on a sheet pins every block where it is now, so
              // the rest of the diagram doesn't re-flow around the moved block.
              const pin: Record<string, XY> = {};
              if (!hasManualLayout) for (const fn of flowNodes) if (fn.type === 'arch') pin[fn.id] = fn.position;
              for (const d of dragged) pin[d.id] = isJunction(d.id) ? snapJunction(d.id, d.position) : d.position;
              setPositions(activeSheet, pin);
              setDragPos({});
            }}
            nodesConnectable={false}
            fitView
            minZoom={0.1}
            fitViewOptions={{ padding: 0.1, minZoom: 0.35, maxZoom: MAX_OPEN_ZOOM }}
            proOptions={{ hideAttribution: true }}
          >
            <AutoFit fitKey={String(arrangeCount)} direction={sheetDirection} />
            <Background gap={20} />
            <Controls showInteractive={false} />
            {/* Only where the sheet is too big to see at once: on small sheets it covered blocks. */}
            {visible.length > 20 && <MiniMap
              pannable
              zoomable
              nodeColor="#3b82f6"
              maskColor="color-mix(in srgb, var(--bg) 70%, transparent)"
              style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}
            />}
          </ReactFlow>
          {draw ? (
            <div className="draw-banner" role="status">
              <span>{drawHint}</span>
              <span className="muted">Esc or right-click to cancel</span>
              <button className="btn" onClick={cancelDraw}>
                Cancel
              </button>
            </div>
          ) : nodes.length === 0 ? (
            <div className="empty-sheet">
              <h2>{sheetName(activeSheet)} — hierarchy sheet</h2>
              <p className="muted">
                This sheet is empty.
                {editMode ? ' Click “+ Add block” or right-click the canvas to start building it.' : ''}
              </p>
            </div>
          ) : (
            editMode && <div className="canvas-hint">Drag blocks to move them · right-click for options · double-click ⧉ to open its sheet</div>
          )}
        </div>

        <aside className="panel">
          {selectedLink ? (
            <>
              <div className="panel-kind">{selectedLink.kind} connection</div>
              <h2 className={selectedLink.label ? undefined : 'unnamed'}>{selectedLink.label || 'Unnamed connection'}</h2>
              <section>
                <h3>Connects</h3>
                <button className="chip" onClick={() => selectBlock(selectedLink.source)}>
                  {byId.get(selectedLink.source)?.label}
                </button>
                <span className="muted"> → </span>
                <button className="chip" onClick={() => selectBlock(selectedLink.target)}>
                  {byId.get(selectedLink.target)?.label}
                </button>
              </section>
              {editMode && (
                <div className="panel-actions">
                  <button className="btn" onClick={() => setPrompt({ type: 'linkName', linkId: selectedLink.id, isNew: false })}>
                    Rename
                  </button>
                  <button className="btn danger" onClick={deleteSelected} title="Delete (Del)">
                    Delete
                  </button>
                </div>
              )}
            </>
          ) : selectedHarness ? (
            <>
              <div className="panel-kind">harness</div>
              <h2 className={selectedHarness.name ? undefined : 'unnamed'}>{harnessDisplayName(selectedHarness)}</h2>
              <div className="panel-types">
                {selectedHarness.types.length === 0 && (
                  <p className="muted">No type yet — right-click the harness to choose power, communication, safety or ground.</p>
                )}
                {selectedHarness.types.map((t) => (
                  <span key={t} className="type-chip" style={{ borderColor: HARNESS_TYPE_COLORS[t] }}>
                    <span className="type-dot" style={{ background: HARNESS_TYPE_COLORS[t] }} />
                    {t}
                  </span>
                ))}
              </div>
              {editMode && (
                <div className="panel-actions">
                  <button className="btn" onClick={() => setPrompt({ type: 'harnessName', harnessId: selectedHarness.id, isNew: false })}>
                    Rename
                  </button>
                  <button className="btn" onClick={() => setDialog({ type: 'harnessEdit', harnessId: selectedHarness.id })}>
                    Name & type…
                  </button>
                  <button className="btn danger" onClick={() => confirmDeleteHarness(selectedHarness)}>
                    Delete
                  </button>
                </div>
              )}
              {selectedHarness.sources && selectedHarness.sources.length > 0 && (
                <section>
                  <h3>Drawing & documents</h3>
                  <ul className="sources">
                    {selectedHarness.sources.map((s) => (
                      <li key={s.url}>
                        <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {selectedHarness.description && (
                <section>
                  <h3>Details</h3>
                  <p className="muted" style={{ whiteSpace: 'pre-line' }}>{selectedHarness.description}</p>
                </section>
              )}
              <section>
                <h3>Connects blocks</h3>
                {[...new Set(selectedHarness.segments.flatMap((s) => [s.from, s.to]))]
                  .filter((id) => byId.has(id))
                  .map((id) => (
                    <button key={id} className="chip" onClick={() => selectBlock(id)}>
                      {byId.get(id)!.label}
                    </button>
                  ))}
              </section>
              <section>
                <h3>Route</h3>
                <p className="muted">
                  {selectedHarness.segments.length} segment(s), {selectedHarness.junctions.length} branch point(s).
                </p>
                {editMode && (
                  <p className="muted" style={{ marginTop: 6 }}>
                    Drag the name along the harness to move it; drag a branch point to reshape the route. Right-click the
                    harness to set its types, branch from it, or delete it.
                  </p>
                )}
              </section>
            </>
          ) : selected ? (
            <>
              <div className="panel-kind">{selected.kind}</div>
              <h2>{selected.label}</h2>
              <p className="muted" style={{ whiteSpace: 'pre-line' }}>{selected.description || selected.summary || 'No description yet.'}</p>
              {/* Datasheet / drawing first: it is what an engineer opens a part for. */}
              {selected.sources && selected.sources.length > 0 && (
                <section>
                  <h3>Sources</h3>
                  <ul className="sources">
                    {selected.sources.map((s) => (
                      <li key={s.url}>
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {s.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {editMode && (
                <div className="panel-actions">
                  <button className="btn" onClick={() => setDialog({ type: 'edit', id: selected.id })}>
                    Edit text
                  </button>
                  <button className="btn" onClick={() => setDialog({ type: 'parent', id: selected.id })}>
                    {selected.parent ? 'Change parent' : 'Link to parent'}
                  </button>
                  <button className="btn" onClick={() => startDraw('harness', { type: 'block', id: selected.id })}>
                    Draw harness
                  </button>
                  <button className="btn" onClick={() => setDialog({ type: 'connect', from: selected.id })}>
                    Connect to…
                  </button>
                </div>
              )}

              {(sheets[selected.id] || editMode) && <section>
                <h3>Hierarchy sheet</h3>
                {sheets[selected.id] ? (
                  <button className="btn primary" onClick={() => openSheet(selected.id)}>
                    Open sheet ({sheets[selected.id].nodes.length} blocks) →
                  </button>
                ) : editMode ? (
                  <button className="btn" onClick={() => addSheet(selected.id)}>
                    + Add hierarchy sheet
                  </button>
                ) : null}
              </section>}

              {/* In view mode these say what they are: the position in this drawing, which
                  is not a statement that one part powers or owns the other. */}
              {selected.parent && (
                <section>
                  <h3>{editMode ? 'Parent' : 'Upstream on this sheet'}</h3>
                  <button className="chip" onClick={() => selectBlock(selected.parent!)}>
                    {byId.get(selected.parent)?.label}
                  </button>
                </section>
              )}

              {selected.kind === 'variant' && selected.parent && (
                <section>
                  <h3>Alternative to</h3>
                  <p className="muted" style={{ marginBottom: 8 }}>Only one variant is fitted at a time.</p>
                  {childrenOf(selected.parent)
                    .filter((s) => s.kind === 'variant' && s.id !== selected.id)
                    .map((s) => (
                      <button key={s.id} className="chip" onClick={() => selectBlock(s.id)}>
                        {s.label}
                      </button>
                    ))}
                </section>
              )}

              {(editMode || childrenOf(selected.id).length > 0) && <section>
                <h3>{editMode ? 'Children' : 'Downstream on this sheet'} ({childrenOf(selected.id).length})</h3>
                {childrenOf(selected.id).length === 0 && <p className="muted">None</p>}
                {childrenOf(selected.id).map((c) => (
                  <button key={c.id} className="chip" onClick={() => selectBlock(c.id)}>
                    {c.label}
                  </button>
                ))}
              </section>}

              {(editMode || harnessesAt(selected.id).length > 0) && <section>
                <h3>Harnesses ({harnessesAt(selected.id).length})</h3>
                {harnessesAt(selected.id).length === 0 && <p className="muted">None</p>}
                {harnessesAt(selected.id).map((h) => (
                  <button key={h.id} className="chip" style={{ borderColor: harnessColor(h) }} onClick={() => selectHarness(h.id)}>
                    {harnessDisplayName(h)}
                  </button>
                ))}
              </section>}

              {/* "Connections (0)" next to a block whose wires are drawn as harnesses read as
                  "this has no wires"; the section only shows when there is something in it. */}
              {(selectedLinks.length > 0 || (editMode && harnessesAt(selected.id).length === 0)) && <section>
                <h3>Connections ({selectedLinks.length})</h3>
                {selectedLinks.length === 0 && <p className="muted">None</p>}
                {selectedLinks.map((l) => {
                  const otherId = l.source === selected.id ? l.target : l.source;
                  return (
                    <div key={l.id} className="conn" style={{ borderLeftColor: LINK_COLORS[l.kind] }}>
                      <span>{l.source === selected.id ? '→' : '←'}</span>
                      <button className="link" onClick={() => selectBlock(otherId)}>
                        {byId.get(otherId)?.label}
                      </button>
                      <span className="muted">
                        {l.kind}
                        {l.label ? ` · ${l.label}` : ''}
                      </span>
                      {editMode && (
                        <button
                          className="conn-remove"
                          title="Remove connection"
                          onClick={() => deleteLink(activeSheet, l.id)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
              </section>}

            </>
          ) : (
            <p className="muted">
              Click a block or harness to see its details.
              {editMode && ' Right-click a block, harness, connection or the empty canvas for edit options.'}
            </p>
          )}
        </aside>
      </div>

      {draw && rubberBand.length > 1 && (
        <svg className="draw-overlay" aria-hidden="true">
          <polyline
            points={rubberBand.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={DRAW_COLORS[draw.kind]}
            strokeWidth={draw.kind === 'harness' ? 4 : 2}
            strokeDasharray="8 6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={rubberBand[0].x} cy={rubberBand[0].y} r={6} fill={DRAW_COLORS[draw.kind]} />
          {bendScreens.map((b, i) => (
            <circle key={i} cx={b.x} cy={b.y} r={5} fill="var(--panel)" stroke={DRAW_COLORS[draw.kind]} strokeWidth={2.5} />
          ))}
        </svg>
      )}

      {notice && (
        <div className={`notice${notice.error ? ' error' : ''}`} role={notice.error ? 'alert' : 'status'}>
          <span>{notice.text}</span>
          <button className="conn-remove" aria-label="Dismiss" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} />}

      {confirmArrange && (
        <ConfirmDialog
          title="Auto-arrange this sheet?"
          message={
            <>
              <p>
                All blocks on <b>{sheetName(activeSheet)}</b> go back to the automatic layout. The positions you set by
                dragging will be lost.
              </p>
              <p className="muted">You can still undo this with Ctrl+Z.</p>
            </>
          }
          yesLabel="Yes, auto-arrange"
          noLabel="No"
          onNo={() => setConfirmArrange(false)}
          onYes={() => {
            setConfirmArrange(false);
            autoArrange();
          }}
        />
      )}

      {dialog?.type === 'create' && (
        <BlockEditor
          title={dialog.parent ? `Add child block to “${byId.get(dialog.parent)?.label}”` : 'Add block'}
          initial={{
            kind: dialog.parent ? 'module' : activeSheet === null ? 'system' : 'module',
            shape: 'rectangle',
            label: '',
            summary: '',
          }}
          onClose={() => setDialog(null)}
          onSave={(fields) => {
            const id = addBlock(activeSheet, fields, dialog.parent);
            if (dialog.parent) setCollapsed((prev) => new Set([...prev].filter((c) => c !== dialog.parent)));
            selectBlock(id);
            setDialog(null);
          }}
        />
      )}

      {dialog?.type === 'edit' && dialogNode && (
        <BlockEditor
          title={`Edit “${dialogNode.label}”`}
          initial={{
            kind: dialogNode.kind,
            shape: shapeOf(dialogNode),
            label: dialogNode.label,
            summary: dialogNode.summary ?? '',
          }}
          onClose={() => setDialog(null)}
          onSave={(fields) => {
            editBlock(activeSheet, dialogNode.id, fields);
            setDialog(null);
          }}
        />
      )}

      {dialog?.type === 'parent' && dialogNode && (
        <ParentPicker
          node={dialogNode}
          candidates={(() => {
            const blocked = descendantsOf(nodes, dialogNode.id);
            return nodes.filter((n) => !blocked.has(n.id));
          })()}
          onClose={() => setDialog(null)}
          onPick={(parentId) => {
            setParent(activeSheet, dialogNode.id, parentId);
            if (parentId) setCollapsed((prev) => new Set([...prev].filter((c) => c !== parentId)));
            setDialog(null);
          }}
        />
      )}

      {dialog?.type === 'connect' && (
        <ConnectDialog
          blocks={nodes}
          initialFrom={dialog.from}
          fixedKind={dialog.kind}
          onClose={() => setDialog(null)}
          onSave={(from, fields) => {
            addLink(activeSheet, from, fields);
            setDialog(null);
          }}
        />
      )}

      {dialog?.type === 'harnessEdit' && dialogHarness && (
        <HarnessEditDialog
          harness={dialogHarness}
          onClose={() => setDialog(null)}
          onSave={(name, types) => {
            editHarness(activeSheet, dialogHarness.id, name, types);
            setDialog(null);
          }}
        />
      )}

      {prompt?.type === 'harnessName' && promptHarness && (
        <NamePrompt
          title={prompt.isNew ? 'Name the new harness' : `Rename harness “${harnessDisplayName(promptHarness)}”`}
          label="Harness name"
          initial={promptHarness.name}
          placeholder="e.g. H-MOMA-PWR-01"
          note={
            prompt.isNew
              ? 'Optional — you can name it later. Then right-click the harness to choose its type: power, communication, safety, ground.'
              : 'The name applies to the whole harness, including all its branches.'
          }
          onClose={() => setPrompt(null)}
          onSave={(name) => {
            editHarness(activeSheet, promptHarness.id, name, promptHarness.types);
            setPrompt(null);
          }}
        />
      )}

      {prompt?.type === 'linkName' && promptLink && (
        <NamePrompt
          title={prompt.isNew ? 'Name the mechanical connection' : 'Rename connection'}
          label="Name"
          initial={promptLink.label ?? ''}
          placeholder="e.g. Mounts on, Bolted to, Docks into"
          note="Shown in the middle of the connection line."
          onClose={() => setPrompt(null)}
          onSave={(name) => {
            renameLink(activeSheet, promptLink.id, name);
            setPrompt(null);
          }}
        />
      )}
    </div>
  );
}
