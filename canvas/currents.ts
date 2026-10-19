import type { ArchData, ArchNode } from './data/architecture';

/** A block's current: its own (a load) or the sum of the loads below it. */
export interface BlockCurrent {
  amps: number;
  /** Entered on this block (a load), not added up from its children. */
  own: boolean;
  /** Loads with a current somewhere below it (0 for a load). */
  loads: number;
}

/** A sheet's feed block ("◀ X", id `X:from`) stands for X, the block that owns the sheet. */
const FEED = ':from';
const base = (id: string) => (id.endsWith(FEED) ? id.slice(0, -FEED.length) : id);

/**
 * Current of every block, across all sheets. A block with its own `current` is a load and
 * shows that; any other block shows the sum of its children: the blocks under it on its
 * sheet plus, when it has a hierarchy sheet, everything under that sheet's feed block. Block
 * ids are unique across sheets, so each load is counted once. Blocks with nothing below them
 * are left out.
 */
export function blockCurrents(doc: ArchData): Map<string, BlockCurrent> {
  const all: ArchNode[] = [...doc.nodes, ...Object.values(doc.sheets ?? {}).flatMap((s) => s.nodes)];
  const children = new Map<string, string[]>();
  const own = new Map<string, number>();
  for (const n of all) {
    if (typeof n.current === 'number') own.set(base(n.id), n.current);
    if (n.parent) {
      const p = base(n.parent);
      const list = children.get(p) ?? [];
      list.push(n.id);
      children.set(p, list);
    }
  }
  const memo = new Map<string, BlockCurrent | null>();
  const visit = (id: string, path: Set<string>): BlockCurrent | null => {
    if (memo.has(id)) return memo.get(id)!;
    if (own.has(id)) {
      const r = { amps: own.get(id)!, own: true, loads: 0 };
      memo.set(id, r);
      return r;
    }
    if (path.has(id)) return null; // a parent loop: count nothing twice
    path.add(id);
    let amps = 0;
    let loads = 0;
    for (const c of children.get(id) ?? []) {
      const r = visit(base(c), path);
      if (!r) continue;
      amps += r.amps;
      loads += r.own ? 1 : r.loads;
    }
    path.delete(id);
    const r = loads ? { amps, own: false, loads } : null;
    memo.set(id, r);
    return r;
  };
  const out = new Map<string, BlockCurrent>();
  for (const n of all) {
    const r = visit(base(n.id), new Set());
    if (r) out.set(n.id, r);
  }
  return out;
}

/** "12.8 A" - one decimal, trailing ".0" dropped. */
export const formatAmps = (a: number) => `${Number(a.toFixed(1))} A`;
