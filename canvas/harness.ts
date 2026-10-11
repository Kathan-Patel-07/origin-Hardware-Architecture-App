// Pure helpers for harnesses on one sheet. A harness is a single named route
// made of segments; segments meet blocks or junction dots (branch points).

import {
  HARNESS_MIXED_COLOR,
  HARNESS_TYPE_COLORS,
  type Harness,
  type HarnessType,
  type SheetData,
  type XY,
} from './data/architecture';

export const JUNCTION_SIZE = 14;

export const harnessDisplayName = (h: Harness) => h.name || 'Unnamed harness';

/** Colour of a harness whose types haven't been chosen yet. */
export const HARNESS_UNTYPED_COLOR = '#94a3b8';

/** A single-type harness takes that type's colour; mixed harnesses share one colour. */
export const harnessColor = (h: Harness) =>
  h.types.length === 0
    ? HARNESS_UNTYPED_COLOR
    : h.types.length === 1
      ? HARNESS_TYPE_COLORS[h.types[0]]
      : HARNESS_MIXED_COLOR;

/** Id of the React Flow edge for one harness segment (parsed back in HarnessEdge). */
export const harnessEdgeId = (harnessId: string, segmentId: string) => `h__${harnessId}__${segmentId}`;

const rand = () => Math.random().toString(36).slice(2, 8);

/** A fresh id with `prefix` not used by anything on the sheet nor in `alsoTaken`. */
export function sheetUniqueId(sheet: SheetData, prefix: string, alsoTaken: string[] = []): string {
  const taken = new Set<string>([...sheet.nodes.map((n) => n.id), ...alsoTaken]);
  for (const h of sheet.harnesses ?? []) {
    taken.add(h.id);
    for (const s of h.segments) taken.add(s.id);
    for (const j of h.junctions) taken.add(j.id);
  }
  let id = `${prefix}-${rand()}`;
  while (taken.has(id)) id = `${prefix}-${rand()}`;
  return id;
}

export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export type FilterMode = 'any' | 'all';

/** Does `h` carry the filtered types — any of them, or all of them? An empty filter matches everything. */
export function harnessMatches(h: Harness, types: HarnessType[], mode: FilterMode): boolean {
  if (!types.length) return true;
  return mode === 'all' ? types.every((t) => h.types.includes(t)) : types.some((t) => h.types.includes(t));
}

/**
 * Two harnesses may only be joined directly if they carry the same name (or one
 * is still unnamed). Returns a reason when they can't, otherwise null.
 */
export function joinBlockedReason(a: Harness, b: Harness): string | null {
  if (a.id === b.id) return 'That is the same harness.';
  if (a.name.trim() && b.name.trim() && !sameName(a.name, b.name))
    return `Can't short “${a.name}” to “${b.name}”: harnesses with different names need a block (e.g. a connector or board) between them.`;
  return null;
}

/** Drop dangling branch points (junctions with ≤1 segment) and their stubs; null if nothing is left. */
export function pruneHarness(h: Harness): Harness | null {
  let segments = h.segments;
  let junctions = h.junctions;
  for (;;) {
    const degree = new Map<string, number>();
    for (const s of segments) {
      degree.set(s.from, (degree.get(s.from) ?? 0) + 1);
      degree.set(s.to, (degree.get(s.to) ?? 0) + 1);
    }
    const dead = new Set(junctions.filter((j) => (degree.get(j.id) ?? 0) <= 1).map((j) => j.id));
    if (!dead.size) break;
    junctions = junctions.filter((j) => !dead.has(j.id));
    segments = segments.filter((s) => !dead.has(s.from) && !dead.has(s.to));
  }
  if (!segments.length) return null;
  const label = h.label && segments.some((s) => s.id === h.label!.segment) ? h.label : undefined;
  return { ...h, segments, junctions, label };
}

/** Apply `fn` to every harness on the sheet, dropping any that end up empty. */
export function mapHarnesses(sheet: SheetData, fn: (h: Harness) => Harness | null): SheetData {
  if (!sheet.harnesses) return sheet;
  return { ...sheet, harnesses: sheet.harnesses.map(fn).filter((h): h is Harness => h !== null) };
}

/** Remove every segment touching block `blockId` (the block is being deleted). */
export function detachBlock(sheet: SheetData, blockId: string): SheetData {
  return mapHarnesses(sheet, (h) =>
    pruneHarness({ ...h, segments: h.segments.filter((s) => s.from !== blockId && s.to !== blockId) }),
  );
}

/** Top-left of a junction dot centred on `p`. */
export const junctionTopLeft = (p: XY): XY => ({ x: p.x - JUNCTION_SIZE / 2, y: p.y - JUNCTION_SIZE / 2 });

/**
 * Route from endpoint `from` to endpoint `to` through `bends` (centre points):
 * one bend junction per bend and a segment between each consecutive pair.
 * `taken` are ids already reserved by the caller.
 */
function route(sheet: SheetData, from: string, bends: XY[], to: string, taken: string[] = []) {
  const reserved = [...taken];
  const fresh = (prefix: string) => {
    const id = sheetUniqueId(sheet, prefix, reserved);
    reserved.push(id);
    return id;
  };
  const junctions = bends.map((b) => ({ id: fresh('jn'), position: junctionTopLeft(b) }));
  const stops = [from, ...junctions.map((j) => j.id), to];
  const segments = stops.slice(1).map((stop, i) => ({ id: fresh('sg'), from: stops[i], to: stop }));
  return { junctions, segments };
}

/** New harness `id` running from block `from` to block `to`, turning at `bends`. */
export function createHarness(
  sheet: SheetData,
  id: string,
  from: string,
  to: string,
  name: string,
  types: HarnessType[],
  bends: XY[] = [],
): SheetData {
  const { junctions, segments } = route(sheet, from, bends, to, [id]);
  return {
    ...sheet,
    harnesses: [...(sheet.harnesses ?? []), { id, name: name.trim(), types, segments, junctions }],
  };
}

/** Insert a junction at `pos` (top-left) into segment `segId`, splitting it in two. */
function splitSegment(
  sheet: SheetData,
  h: Harness,
  segId: string,
  pos: XY,
  junctionId = sheetUniqueId(sheet, 'jn'),
): { harness: Harness; junctionId: string } {
  const seg = h.segments.find((s) => s.id === segId) ?? h.segments[0];
  const a = sheetUniqueId(sheet, 'sg', [junctionId]);
  const b = sheetUniqueId(sheet, 'sg', [junctionId, a]);
  const segments = h.segments.flatMap((s) =>
    s.id === seg.id
      ? [
          { id: a, from: s.from, to: junctionId },
          { id: b, from: junctionId, to: s.to },
        ]
      : [s],
  );
  // Keep the name label on the half that holds its fraction of the old segment.
  const label = h.label?.segment === seg.id
    ? h.label.t <= 0.5
      ? { ...h.label, segment: a, t: h.label.t * 2 }
      : { ...h.label, segment: b, t: (h.label.t - 0.5) * 2 }
    : h.label;
  return { harness: { ...h, segments, junctions: [...h.junctions, { id: junctionId, position: pos }], label }, junctionId };
}

/** Add a bend point `junctionId` at `pos` (top-left) on segment `segId`, e.g. when the line is dragged. */
export function insertBend(sheet: SheetData, harnessId: string, segId: string, pos: XY, junctionId: string): SheetData {
  const h = sheet.harnesses?.find((x) => x.id === harnessId);
  if (!h || !h.segments.some((s) => s.id === segId)) return sheet;
  const { harness } = splitSegment(sheet, h, segId, pos, junctionId);
  return { ...sheet, harnesses: sheet.harnesses!.map((x) => (x.id === harnessId ? harness : x)) };
}

/** Number of segments meeting at `junctionId`. A bend point has exactly 2. */
export const junctionDegree = (h: Harness, junctionId: string) =>
  h.segments.filter((s) => s.from === junctionId || s.to === junctionId).length;

/** Remove a bend point (a junction with exactly two segments), joining its two segments into one. */
export function removeBend(sheet: SheetData, harnessId: string, junctionId: string): SheetData {
  return mapHarnesses(sheet, (h) => {
    if (h.id !== harnessId) return h;
    const [s1, s2] = h.segments.filter((s) => s.from === junctionId || s.to === junctionId);
    if (!s1 || !s2 || junctionDegree(h, junctionId) !== 2) return h;
    const a = s1.from === junctionId ? s1.to : s1.from;
    const b = s2.from === junctionId ? s2.to : s2.from;
    const joined = { id: s1.id, from: a, to: b };
    const label = h.label && (h.label.segment === s1.id || h.label.segment === s2.id) ? { ...h.label, segment: s1.id, t: 0.5 } : h.label;
    return {
      ...h,
      segments: h.segments.filter((s) => s.id !== s2.id).map((s) => (s.id === s1.id ? joined : s)),
      junctions: h.junctions.filter((j) => j.id !== junctionId),
      label,
    };
  });
}

/**
 * A point on a harness picked with the mouse: an existing branch point, or a
 * spot on a segment (where a new branch point will be inserted).
 */
export type HarnessPoint =
  | { harnessId: string; junctionId: string }
  | { harnessId: string; segmentId: string; pos: XY };

/** Junction for `p`: the existing one, or a new one splitting the segment at `p.pos`. */
function ensureJunction(sheet: SheetData, p: HarnessPoint): { sheet: SheetData; junctionId: string } | null {
  const h = sheet.harnesses?.find((x) => x.id === p.harnessId);
  if (!h) return null;
  if ('junctionId' in p) return h.junctions.some((j) => j.id === p.junctionId) ? { sheet, junctionId: p.junctionId } : null;
  const { harness, junctionId } = splitSegment(sheet, h, p.segmentId, p.pos);
  return { sheet: { ...sheet, harnesses: sheet.harnesses!.map((x) => (x.id === h.id ? harness : x)) }, junctionId };
}

/**
 * Branch off the harness at `p` and run the new branch to `blockId` through
 * `bends` (ordered from the harness towards the block). It joins that harness.
 */
export function connectBlockToHarness(sheet: SheetData, p: HarnessPoint, blockId: string, bends: XY[] = []): SheetData {
  const r = ensureJunction(sheet, p);
  if (!r) return sheet;
  const { junctions, segments } = route(r.sheet, r.junctionId, bends, blockId);
  return mapHarnesses(r.sheet, (h) =>
    h.id === p.harnessId ? { ...h, segments: [...h.segments, ...segments], junctions: [...h.junctions, ...junctions] } : h,
  );
}

/**
 * Join the harnesses at points `a` and `b` with a new run between them (through
 * `bends`, ordered from a to b). The result keeps one name (whichever is set)
 * and the union of their types. Does nothing if joinBlockedReason forbids it.
 */
export function joinHarnessesAt(sheet: SheetData, pa: HarnessPoint, pb: HarnessPoint, bends: XY[] = []): SheetData {
  const a0 = sheet.harnesses?.find((x) => x.id === pa.harnessId);
  const b0 = sheet.harnesses?.find((x) => x.id === pb.harnessId);
  if (!a0 || !b0 || joinBlockedReason(a0, b0)) return sheet;
  const ra = ensureJunction(sheet, pa);
  if (!ra) return sheet;
  const rb = ensureJunction(ra.sheet, pb);
  if (!rb) return sheet;
  const s = rb.sheet;
  const A = s.harnesses!.find((x) => x.id === pa.harnessId)!;
  const B = s.harnesses!.find((x) => x.id === pb.harnessId)!;
  const bridge = route(s, ra.junctionId, bends, rb.junctionId);
  const merged: Harness = {
    id: A.id,
    name: A.name.trim() || B.name.trim(),
    types: [...new Set([...A.types, ...B.types])],
    segments: [...A.segments, ...B.segments, ...bridge.segments],
    junctions: [...A.junctions, ...B.junctions, ...bridge.junctions],
    label: A.label ?? B.label,
  };
  return { ...s, harnesses: s.harnesses!.filter((x) => x.id !== B.id).map((x) => (x.id === A.id ? merged : x)) };
}

