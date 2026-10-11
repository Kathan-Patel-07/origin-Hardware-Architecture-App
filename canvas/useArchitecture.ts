import { useCallback, useEffect, useRef, useState } from 'react';
import {
  INITIAL_DATA,
  type ArchData,
  type ArchLink,
  type ArchNode,
  type HarnessLabelPos,
  type HarnessType,
  type LinkKind,
  type NodeKind,
  type SheetData,
  type XY,
} from './data/architecture';
import type { BlockShape } from './shapes';
import type { ArchitectureDataSource } from './dataSource';
import {
  connectBlockToHarness,
  createHarness,
  detachBlock,
  insertBend,
  joinHarnessesAt,
  removeBend,
  mapHarnesses,
  pruneHarness,
  sheetUniqueId,
  type HarnessPoint,
} from './harness';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'load_error' | 'readonly';


/** Number of undo steps kept. */
const HISTORY_LIMIT = 100;

/** `null` is the main sheet; otherwise the id of the block that owns the sheet. */
export type SheetId = string | null;

export interface BlockFields {
  kind: NodeKind;
  label: string;
  summary: string;
  shape: BlockShape;
}

/** Apply the form fields to a block; rectangle (the default) isn't stored. */
function withFields(n: ArchNode, f: BlockFields): ArchNode {
  const next: ArchNode = { ...n, kind: f.kind, label: f.label, summary: f.summary || undefined };
  if (f.shape === 'rectangle') delete next.shape;
  else next.shape = f.shape;
  return next;
}

export interface LinkFields {
  target: string;
  kind: LinkKind;
  label: string;
}

export function getSheet(doc: ArchData, sheetId: SheetId): SheetData | undefined {
  return sheetId === null ? doc : doc.sheets?.[sheetId];
}

/** Every block id in the document, across all sheets (plus harness junction ids, which share the canvas). */
function allIds(doc: ArchData): Set<string> {
  const ids = new Set<string>();
  for (const s of [doc, ...Object.values(doc.sheets ?? {})]) {
    for (const n of s.nodes) ids.add(n.id);
    for (const h of s.harnesses ?? []) for (const j of h.junctions) ids.add(j.id);
  }
  return ids;
}

/** The sheet that contains block `id`, or undefined if it isn't in any. */
export function sheetContaining(doc: ArchData, id: string): SheetId | undefined {
  if (doc.nodes.some((n) => n.id === id)) return null;
  for (const [owner, s] of Object.entries(doc.sheets ?? {})) if (s.nodes.some((n) => n.id === id)) return owner;
  return undefined;
}

/** Breadcrumb from the main sheet down to `sheetId`: [null, owner1, owner2, …]. */
export function sheetPath(doc: ArchData, sheetId: SheetId): SheetId[] {
  const path: SheetId[] = [];
  let cur: SheetId | undefined = sheetId;
  while (cur !== undefined && !path.includes(cur)) {
    path.unshift(cur);
    if (cur === null) break;
    cur = sheetContaining(doc, cur);
  }
  return path[0] === null ? path : [null, ...path];
}

/** The block (in whichever sheet it lives) with this id. */
export function findBlock(doc: ArchData, id: string): ArchNode | undefined {
  const sheet = sheetContaining(doc, id);
  return sheet === undefined ? undefined : getSheet(doc, sheet)?.nodes.find((n) => n.id === id);
}

function newId(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'block';
  let id = base;
  while (taken.has(id)) id = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  return id;
}

/** Ids of `id` and everything below it in the tree. */
export function descendantsOf(nodes: ArchNode[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (n.parent && out.has(n.parent) && !out.has(n.id)) {
        out.add(n.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Remove the sheet owned by `ownerId` and, recursively, every sheet owned by its blocks. */
function withoutSheet(sheets: Record<string, SheetData>, ownerId: string): Record<string, SheetData> {
  const sheet = sheets[ownerId];
  if (!sheet) return sheets;
  let rest = { ...sheets };
  delete rest[ownerId];
  for (const n of sheet.nodes) rest = withoutSheet(rest, n.id);
  return rest;
}

/** Number of sheets that would be removed together with `ownerId`'s sheet. */
export function nestedSheetCount(doc: ArchData, ownerId: string): number {
  const sheets = doc.sheets ?? {};
  return Object.keys(sheets).length - Object.keys(withoutSheet(sheets, ownerId)).length;
}

export function useArchitecture(source: ArchitectureDataSource) {
  const canSave = source.canSave;
  const [doc, setDoc] = useState<ArchData>(INITIAL_DATA);
  const [status, setStatus] = useState<SaveStatus>(canSave ? 'idle' : 'readonly');
  const dirty = useRef(false);
  /** Always the latest document (see undo/redo below). */
  const docRef = useRef(doc);
  /**
   * Edits are ignored until the stored document has loaded. Otherwise an edit made against
   * the bundled copy is replaced by the load, while undo still holds the bundled (stale)
   * copy — and undoing would save that stale copy over the real one.
   */
  const loaded = useRef(false);
  const past = useRef<ArchData[]>([]);
  const future = useRef<ArchData[]>([]);
  const [, setHistoryVersion] = useState(0); // re-render so canUndo/canRedo stay current

  // The bundled copy can lag behind the stored document, so load the current one
  // once on startup. Not an undo step.
  useEffect(() => {
    let cancelled = false;
    loaded.current = false;
    source
      .load()
      .then((d) => {
        if (cancelled) return;
        docRef.current = d;
        past.current = [];
        future.current = [];
        dirty.current = false;
        loaded.current = true;
        setDoc(d);
        setHistoryVersion((v) => v + 1);
      })
      .catch(() => {
        if (!cancelled) setStatus('load_error');
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  // Debounced auto-save after every edit. `pending` lets the unmount below flush a save
  // the debounce had not sent yet: leaving the Canvas tab unmounts the editor, and a
  // click on another tab commits an in-progress rename (blur) in the same gesture.
  const pending = useRef<ArchData | null>(null);
  useEffect(() => {
    if (!canSave || !dirty.current) return;
    setStatus('saving');
    pending.current = doc;
    const timer = setTimeout(() => {
      pending.current = null;
      source
        .save(doc)
        .then(() => setStatus('saved'))
        .catch(() => setStatus('error'));
    }, 400);
    return () => clearTimeout(timer);
  }, [doc, canSave, source]);
  useEffect(
    () => () => {
      if (pending.current) {
        const unsaved = pending.current;
        pending.current = null;
        source.save(unsaved).catch(() => {
          /* the editor is gone; nothing left to show the error in */
        });
      }
    },
    [source],
  );

  // ── Undo / redo ────────────────────────────────────────────────────────────
  // Every edit goes through `update`, which records the previous document. The
  // history lives in refs (not inside a setState updater, which React may run
  // twice in development and would record each step twice).

  const commit = useCallback((next: ArchData) => {
    docRef.current = next;
    dirty.current = true;
    setDoc(next);
    setHistoryVersion((v) => v + 1);
  }, []);

  const update = useCallback(
    (fn: (d: ArchData) => ArchData) => {
      if (!loaded.current) return;
      const prev = docRef.current;
      const next = fn(prev);
      if (next === prev) return;
      past.current.push(prev);
      if (past.current.length > HISTORY_LIMIT) past.current.shift();
      future.current = []; // a new edit after undoing discards the redo steps
      commit(next);
    },
    [commit],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(docRef.current);
    commit(prev);
  }, [commit]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(docRef.current);
    commit(next);
  }, [commit]);

  /** Apply `fn` to one sheet of the document. */
  const updateSheet = useCallback(
    (sheetId: SheetId, fn: (s: SheetData) => SheetData) =>
      update((d) => {
        if (sheetId === null) {
          const s = fn({ nodes: d.nodes, links: d.links, harnesses: d.harnesses });
          return { ...d, nodes: s.nodes, links: s.links, harnesses: s.harnesses };
        }
        const sheet = d.sheets?.[sheetId];
        return sheet ? { ...d, sheets: { ...d.sheets, [sheetId]: fn(sheet) } } : d;
      }),
    [update],
  );

  const addBlock = useCallback(
    (sheetId: SheetId, fields: BlockFields, parent?: string): string => {
      const id = newId(fields.label, allIds(doc));
      updateSheet(sheetId, (s) => ({
        ...s,
        nodes: [...s.nodes, withFields({ id, kind: fields.kind, label: fields.label, parent }, fields)],
      }));
      return id;
    },
    [doc, updateSheet],
  );

  const editBlock = useCallback(
    (sheetId: SheetId, id: string, fields: BlockFields) =>
      updateSheet(sheetId, (s) => ({
        ...s,
        nodes: s.nodes.map((n) =>
          n.id === id ? withFields(n, fields) : n,
        ),
      })),
    [updateSheet],
  );

  /** Re-parent a block; `undefined` makes it a top-level parent of its own tree. */
  const setParent = useCallback(
    (sheetId: SheetId, id: string, parent: string | undefined) =>
      updateSheet(sheetId, (s) => {
        if (parent && descendantsOf(s.nodes, id).has(parent)) return s; // would create a loop
        return { ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, parent } : n)) };
      }),
    [updateSheet],
  );

  /** Delete a block (and its hierarchy sheet); its children move up to its parent. */
  const deleteBlock = useCallback(
    (sheetId: SheetId, id: string) =>
      update((d) => {
        const strip = (s: SheetData): SheetData => {
          const gone = s.nodes.find((n) => n.id === id);
          return detachBlock(
            {
              ...s,
              nodes: s.nodes.filter((n) => n.id !== id).map((n) => (n.parent === id ? { ...n, parent: gone?.parent } : n)),
              links: s.links.filter((l) => l.source !== id && l.target !== id),
            },
            id,
          );
        };
        const sheets = withoutSheet(d.sheets ?? {}, id);
        if (sheetId === null) return { ...d, ...strip(d), sheets };
        return sheets[sheetId] ? { ...d, sheets: { ...sheets, [sheetId]: strip(sheets[sheetId]) } } : { ...d, sheets };
      }),
    [update],
  );

  /** Give a block its own (empty) hierarchy sheet. */
  const addSheet = useCallback(
    (ownerId: string) =>
      update((d) => (d.sheets?.[ownerId] ? d : { ...d, sheets: { ...d.sheets, [ownerId]: { nodes: [], links: [] } } })),
    [update],
  );

  const removeSheet = useCallback(
    (ownerId: string) => update((d) => ({ ...d, sheets: withoutSheet(d.sheets ?? {}, ownerId) })),
    [update],
  );

  /** Add a connection; returns its id. */
  const addLink = useCallback(
    (sheetId: SheetId, source: string, fields: LinkFields): string => {
      const taken = new Set((getSheet(doc, sheetId)?.links ?? []).map((l) => l.id));
      const link: ArchLink = {
        id: newId(`${source}-${fields.target}`, taken),
        source,
        target: fields.target,
        kind: fields.kind,
        label: fields.label || undefined,
      };
      updateSheet(sheetId, (s) => ({ ...s, links: [...s.links, link] }));
      return link.id;
    },
    [doc, updateSheet],
  );

  const renameLink = useCallback(
    (sheetId: SheetId, linkId: string, label: string) =>
      updateSheet(sheetId, (s) => ({
        ...s,
        links: s.links.map((l) => (l.id === linkId ? { ...l, label: label.trim() || undefined } : l)),
      })),
    [updateSheet],
  );

  const deleteLink = useCallback(
    (sheetId: SheetId, linkId: string) =>
      updateSheet(sheetId, (s) => ({ ...s, links: s.links.filter((l) => l.id !== linkId) })),
    [updateSheet],
  );

  /** Rename the project title and/or the main sheet (empty → back to the default). */
  const setTitles = useCallback(
    (titles: { title?: string; mainSheetName?: string }) =>
      update((d) => {
        const next = { ...d };
        for (const key of ['title', 'mainSheetName'] as const) {
          if (titles[key] === undefined) continue;
          const v = titles[key]!.trim();
          if (v) next[key] = v;
          else delete next[key];
        }
        return next.title === d.title && next.mainSheetName === d.mainSheetName ? d : next;
      }),
    [update],
  );

  /** Rename a block wherever it lives (e.g. from a sheet's subtitle). */
  const renameBlock = useCallback(
    (id: string, label: string) => {
      const v = label.trim();
      const sheetId = sheetContaining(docRef.current, id);
      if (!v || sheetId === undefined) return;
      updateSheet(sheetId, (s) =>
        s.nodes.some((n) => n.id === id && n.label !== v) ? { ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, label: v } : n)) } : s,
      );
    },
    [updateSheet],
  );

  /** Save dragged positions for blocks and harness junctions on a sheet. */
  const setPositions = useCallback(
    (sheetId: SheetId, positions: Record<string, XY>) =>
      updateSheet(sheetId, (s) => {
        const round = (p: XY) => ({ x: Math.round(p.x), y: Math.round(p.y) });
        return {
          ...s,
          nodes: s.nodes.map((n) => (positions[n.id] ? { ...n, position: round(positions[n.id]) } : n)),
          harnesses: s.harnesses?.map((h) => ({
            ...h,
            junctions: h.junctions.map((j) => (positions[j.id] ? { ...j, position: round(positions[j.id]) } : j)),
          })),
        };
      }),
    [updateSheet],
  );

  // ── Harnesses ──────────────────────────────────────────────────────────────

  /** New harness between two blocks, turning at `bends` (centre points); returns its id. */
  const addHarness = useCallback(
    (sheetId: SheetId, from: string, to: string, name: string, types: HarnessType[], bends: XY[] = []): string => {
      const sheet = getSheet(doc, sheetId);
      const id = sheet ? sheetUniqueId(sheet, 'hn') : 'hn-new';
      updateSheet(sheetId, (s) => createHarness(s, id, from, to, name, types, bends));
      return id;
    },
    [doc, updateSheet],
  );

  /** Branch from a point on a harness to a block, through `bends` (harness side first). */
  const connectToHarness = useCallback(
    (sheetId: SheetId, point: HarnessPoint, blockId: string, bends: XY[] = []) =>
      updateSheet(sheetId, (s) => connectBlockToHarness(s, point, blockId, bends)),
    [updateSheet],
  );

  /** Join two harnesses at the given points (refused if their names differ). */
  const joinHarnesses = useCallback(
    (sheetId: SheetId, a: HarnessPoint, b: HarnessPoint, bends: XY[] = []) =>
      updateSheet(sheetId, (s) => joinHarnessesAt(s, a, b, bends)),
    [updateSheet],
  );

  /** Put a bend point on a segment (when its line is dragged); returns the new junction id. */
  const addBend = useCallback(
    (sheetId: SheetId, harnessId: string, segId: string, pos: XY): string => {
      const sheet = getSheet(doc, sheetId);
      const junctionId = sheet ? sheetUniqueId(sheet, 'jn') : 'jn-new';
      updateSheet(sheetId, (s) => insertBend(s, harnessId, segId, pos, junctionId));
      return junctionId;
    },
    [doc, updateSheet],
  );

  const deleteBend = useCallback(
    (sheetId: SheetId, harnessId: string, junctionId: string) =>
      updateSheet(sheetId, (s) => removeBend(s, harnessId, junctionId)),
    [updateSheet],
  );

  const editHarness = useCallback(
    (sheetId: SheetId, id: string, name: string, types: HarnessType[]) =>
      updateSheet(sheetId, (s) => mapHarnesses(s, (h) => (h.id === id ? { ...h, name: name.trim(), types } : h))),
    [updateSheet],
  );

  const setHarnessLabel = useCallback(
    (sheetId: SheetId, id: string, label: HarnessLabelPos) =>
      updateSheet(sheetId, (s) => mapHarnesses(s, (h) => (h.id === id ? { ...h, label } : h))),
    [updateSheet],
  );

  /** Delete one segment; dangling branch stubs go with it, and an empty harness is removed. */
  const deleteHarnessSegment = useCallback(
    (sheetId: SheetId, id: string, segId: string) =>
      updateSheet(sheetId, (s) =>
        mapHarnesses(s, (h) => (h.id === id ? pruneHarness({ ...h, segments: h.segments.filter((x) => x.id !== segId) }) : h)),
      ),
    [updateSheet],
  );

  const deleteHarness = useCallback(
    (sheetId: SheetId, id: string) => updateSheet(sheetId, (s) => mapHarnesses(s, (h) => (h.id === id ? null : h))),
    [updateSheet],
  );

  /**
   * Forget all dragged positions on a sheet so it is laid out automatically
   * again — block positions and the bends of child-connect and mechanical lines.
   */
  const clearPositions = useCallback(
    (sheetId: SheetId) =>
      updateSheet(sheetId, (s) => ({
        ...s,
        nodes: s.nodes.map((n) => {
          if (!n.position && !n.parentBends) return n;
          const rest = { ...n };
          delete rest.position;
          delete rest.parentBends;
          return rest;
        }),
        links: s.links.map((l) => {
          if (!l.bends) return l;
          const rest = { ...l };
          delete rest.bends;
          return rest;
        }),
      })),
    [updateSheet],
  );

  /**
   * Save the bends of a child-connect line ('tree:<child id>') or a mechanical
   * connection ('link:<link id>'). An empty list straightens the line.
   */
  const setLineBends = useCallback(
    (sheetId: SheetId, edgeKey: string, bends: XY[]) => {
      const [type, id] = [edgeKey.slice(0, edgeKey.indexOf(':')), edgeKey.slice(edgeKey.indexOf(':') + 1)];
      const clean = bends.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y) }));
      updateSheet(sheetId, (s) => {
        if (type === 'tree') {
          return {
            ...s,
            nodes: s.nodes.map((n) => {
              if (n.id !== id) return n;
              const next = { ...n };
              if (clean.length) next.parentBends = clean;
              else delete next.parentBends;
              return next;
            }),
          };
        }
        return {
          ...s,
          links: s.links.map((l) => {
            if (l.id !== id) return l;
            const next = { ...l };
            if (clean.length) next.bends = clean;
            else delete next.bends;
            return next;
          }),
        };
      });
    },
    [updateSheet],
  );

  return {
    doc,
    status,
    // A document that failed to load must not be edited: saving it would overwrite the
    // stored one with the bundled copy.
    canSave: canSave && status !== 'load_error',
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
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
  };
}
