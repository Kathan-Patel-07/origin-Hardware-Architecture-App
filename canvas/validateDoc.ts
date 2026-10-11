import type { ArchData, HarnessType, LinkKind, NodeKind } from './data/architecture';
import type { BlockShape } from './shapes';

// Vocabularies, repeated here so this file needs no runtime imports (vite.config.ts loads it
// in Node). The `satisfies` clauses make tsc fail if they drift from the editor's types.
const NODE_KINDS = ['system', 'group', 'subsystem', 'variant', 'accessory', 'module', 'component'] as const satisfies readonly NodeKind[];
const LINK_KINDS = ['power', 'data', 'mechanical', 'signal', 'other'] as const satisfies readonly LinkKind[];
const HARNESS_TYPES = ['power', 'communication', 'safety', 'ground'] as const satisfies readonly HarnessType[];
const BLOCK_SHAPES = ['rectangle', 'oval', 'diamond', 'circle'] as const satisfies readonly BlockShape[];
// ...and the other direction: every member of each type must be listed.
type Exhaustive<T, L extends readonly T[]> = [T] extends [L[number]] ? true : never;
const _exhaustive: [
  Exhaustive<NodeKind, typeof NODE_KINDS>,
  Exhaustive<LinkKind, typeof LINK_KINDS>,
  Exhaustive<HarnessType, typeof HARNESS_TYPES>,
  Exhaustive<BlockShape, typeof BLOCK_SHAPES>,
] = [true, true, true, true];
void _exhaustive;
const oneOf = (list: readonly string[], v: unknown) => typeof v === 'string' && list.includes(v);

/**
 * Structural check of a canvas document, shared by the dev store (refuses to write a bad
 * document) and the editor (refuses to load one). Shape only — it does not judge whether the
 * architecture makes sense. Returns the problems found; empty means usable.
 *
 * Kept free of imports beyond types so vite.config.ts can use it in Node.
 */
export function validateArchDoc(doc: unknown): string[] {
  const problems: string[] = [];
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  const isStr = (v: unknown) => typeof v === 'string' && v.length > 0;
  const isXY = (v: unknown) => isObj(v) && typeof v.x === 'number' && typeof v.y === 'number';
  const optStr = (v: unknown) => v === undefined || typeof v === 'string';
  const optXYs = (v: unknown) => v === undefined || (Array.isArray(v) && v.every(isXY));

  // Block ids are unique across ALL sheets (sheets are keyed by their owner's id); link and
  // harness ids are unique within a sheet.
  const blockIds = new Map<string, string>();
  const checkSheet = (s: unknown, where: string) => {
    if (!isObj(s)) return void problems.push(`${where}: not an object`);
    if (!Array.isArray(s.nodes)) problems.push(`${where}.nodes: not an array`);
    else
      s.nodes.forEach((n, i) => {
        const at = `${where}.nodes[${i}]`;
        if (!isObj(n)) return void problems.push(`${at}: not an object`);
        if (!isStr(n.id)) problems.push(`${at}.id: missing`);
        else if (blockIds.has(n.id as string)) problems.push(`${at}.id: '${n.id}' is also a block in ${blockIds.get(n.id as string)}`);
        else blockIds.set(n.id as string, where);
        if (typeof n.label !== 'string') problems.push(`${at}.label: missing`);
        if (!oneOf(NODE_KINDS, n.kind)) problems.push(`${at}.kind: '${String(n.kind)}' is not one of ${NODE_KINDS.join(', ')}`);
        if (n.shape !== undefined && !oneOf(BLOCK_SHAPES, n.shape)) problems.push(`${at}.shape: '${String(n.shape)}' is not a shape`);
        if (n.sources !== undefined && !(Array.isArray(n.sources) && n.sources.every((x) => isObj(x) && typeof x.title === 'string' && typeof x.url === 'string')))
          problems.push(`${at}.sources: must be a list of {title, url}`);
        if (!optStr(n.parent) || !optStr(n.summary) || !optStr(n.description))
          problems.push(`${at}: parent/summary/description must be strings`);
        if (n.position !== undefined && !isXY(n.position)) problems.push(`${at}.position: not {x, y}`);
        if (!optXYs(n.parentBends)) problems.push(`${at}.parentBends: not a list of {x, y}`);
      });
    // Separate namespaces, matching what the editor guarantees (links and harnesses
    // generate ids independently of each other).
    const seenIn = { link: new Set<string>(), harness: new Set<string>() };
    const dupe = (kind: 'link' | 'harness', at: string, id: unknown) => {
      if (typeof id !== 'string') return;
      if (seenIn[kind].has(id)) problems.push(`${at}.id: '${id}' is used by two ${kind}s in ${where}`);
      seenIn[kind].add(id);
    };
    if (!Array.isArray(s.links)) problems.push(`${where}.links: not an array`);
    else
      s.links.forEach((l, i) => {
        const at = `${where}.links[${i}]`;
        if (!isObj(l)) return void problems.push(`${at}: not an object`);
        if (!isStr(l.id) || !isStr(l.source) || !isStr(l.target))
          problems.push(`${at}: id, source and target are required`);
        if (!oneOf(LINK_KINDS, l.kind)) problems.push(`${at}.kind: '${String(l.kind)}' is not one of ${LINK_KINDS.join(', ')}`);
        if (!optStr(l.label)) problems.push(`${at}.label: must be a string`);
        dupe('link', at, l.id);
        if (!optXYs(l.bends)) problems.push(`${at}.bends: not a list of {x, y}`);
      });
    if (s.harnesses !== undefined) {
      if (!Array.isArray(s.harnesses)) problems.push(`${where}.harnesses: not an array`);
      else
        s.harnesses.forEach((h, i) => {
          const at = `${where}.harnesses[${i}]`;
          if (!isObj(h)) return void problems.push(`${at}: not an object`);
          if (!isStr(h.id) || typeof h.name !== 'string') problems.push(`${at}: id and name are required`);
          dupe('harness', at, h.id);
          if (!Array.isArray(h.types) || !h.types.every((t) => oneOf(HARNESS_TYPES, t)))
            problems.push(`${at}.types: must be a list of ${HARNESS_TYPES.join(', ')}`);
          if (h.label !== undefined && !(isObj(h.label) && typeof h.label.segment === 'string'
              && typeof h.label.t === 'number' && oneOf(['above', 'below'], h.label.side)))
            problems.push(`${at}.label: must be {segment, t, side: above|below}`);
          if (!Array.isArray(h.segments) || !h.segments.every((g) => isObj(g) && isStr(g.id) && isStr(g.from) && isStr(g.to)))
            problems.push(`${at}.segments: each needs id, from and to`);
          if (!Array.isArray(h.junctions) || !h.junctions.every((j) => isObj(j) && isStr(j.id) && isXY(j.position)))
            problems.push(`${at}.junctions: each needs id and position`);
        });
    }
  };

  if (!isObj(doc)) return ['document: not an object'];
  checkSheet(doc, 'document');
  if (doc.sheets !== undefined) {
    if (!isObj(doc.sheets)) problems.push('document.sheets: not an object');
    else for (const [k, s] of Object.entries(doc.sheets)) checkSheet(s, `sheets[${JSON.stringify(k)}]`);
  }
  if (!optStr(doc.title) || !optStr(doc.mainSheetName)) problems.push('document: title/mainSheetName must be strings');
  return problems;
}

/** Throws with the first few problems if `doc` is not a usable canvas document. */
export function assertArchDoc(doc: unknown): asserts doc is ArchData {
  const problems = validateArchDoc(doc);
  if (problems.length)
    throw new Error(`invalid canvas document (${problems.length} problem(s)): ${problems.slice(0, 5).join('; ')}`);
}
