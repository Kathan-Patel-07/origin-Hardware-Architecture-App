import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArchData } from './data/architecture';
import type { SheetId } from './useArchitecture';

/**
 * Find a component anywhere in the document (Ctrl+K). Lists every sheet a match appears
 * on; picking one opens that sheet and centres the block. Matches name, part numbers and
 * the details text (IPN, MPN, vendor…).
 */
/** Words of a text, split at spaces, punctuation, underscores and camelCase humps. */
function wordsOf(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Which sheet a search hit should open first: specific views before the overview tree. */
function sheetRank(sheet: SheetId): number {
  if (sheet === null) return 2;
  if (/:Bus:|:HNS:|^hd:|:ends$/.test(sheet)) return 0;
  if (/^view:[^:]+:All$|:All:/.test(sheet)) return 5;
  if (/^view:|^sub:/.test(sheet)) return 3;
  return 1;
}

export function CanvasSearch({
  doc,
  sheetName,
  onPick,
}: {
  doc: ArchData;
  sheetName: (id: SheetId) => string;
  onPick: (sheetId: SheetId, blockId: string) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const index = useMemo(() => {
    const rows: { sheet: SheetId; id: string; label: string; summary: string; text: string; words: string[] }[] = [];
    const add = (sheet: SheetId, nodes: ArchData['nodes']) => {
      for (const n of nodes) {
        if (n.id.endsWith(':from')) continue; // off-sheet reference blocks
        const text = `${n.label} ${n.summary ?? ''} ${n.description ?? ''}`;
        rows.push({ sheet, id: n.id, label: n.label, summary: n.summary ?? '', text: text.toLowerCase(),
                    words: wordsOf(text) });
      }
    };
    add(null, doc.nodes);
    for (const [k, s] of Object.entries(doc.sheets ?? {})) add(k, s.nodes);
    return rows;
  }, [doc]);

  // One row per part: it opens on the most specific sheet (its bus, harness or domain
  // view - not the everything-at-once "All connections"), other sheets as chips.
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    const terms = t.split(/\s+/);
    const score = (r: (typeof index)[number]) => {
      const l = r.label.toLowerCase();
      if (l === t) return 0;
      if (l.startsWith(t)) return 1;
      if (terms.every((w) => l.includes(w))) return 2;
      // details text: whole words or word starts, so "CAN" finds Comm_CAN_1, not "scanner"
      if (terms.every((w) => r.words.some((x) => x.startsWith(w)) || (w.length > 3 && r.text.includes(w)))) return 3;
      return -1;
    };
    const groups = new Map<string, { label: string; best: number; hits: (typeof index)[number][] }>();
    for (const r of index) {
      const sc = score(r);
      if (sc < 0) continue;
      const g = groups.get(r.label) ?? { label: r.label, best: 9, hits: [] };
      g.best = Math.min(g.best, sc);
      g.hits.push(r);
      groups.set(r.label, g);
    }
    return [...groups.values()]
      .map((g) => ({ ...g, hits: g.hits.sort((a, b) => sheetRank(a.sheet) - sheetRank(b.sheet)) }))
      .sort((a, b) => a.best - b.best || a.label.localeCompare(b.label))
      .slice(0, 30);
  }, [q, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pick = (i: number, j = 0) => {
    const r = results[i]?.hits[j];
    if (!r) return;
    onPick(r.sheet, r.id);
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className="canvas-search">
      <input
        ref={input}
        className="search"
        value={q}
        placeholder="Find a part… (Ctrl+K)"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter') pick(active);
          else if (e.key === 'Escape') input.current?.blur();
          else return;
          e.preventDefault();
        }}
      />
      {open && results.length > 0 && (
        <div className="canvas-search-results" role="listbox">
          {results.map((g, i) => (
            <div key={g.label} className={`canvas-search-row${i === active ? ' active' : ''}`}
                 onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}>
              <span className="csr-label">{g.label}</span>
              <span className="csr-where">{sheetName(g.hits[0].sheet)}</span>
              {g.hits[0].summary && <span className="csr-summary">{g.hits[0].summary}</span>}
              {g.hits.length > 1 && (
                <span className="csr-also">
                  also on:{' '}
                  {g.hits.slice(1, 6).map((h, j) => (
                    <button key={`${h.sheet}|${h.id}`} className="csr-chip"
                            onClick={(e) => { e.stopPropagation(); pick(i, j + 1); }}>
                      {sheetName(h.sheet)}
                    </button>
                  ))}
                  {g.hits.length > 6 ? ` +${g.hits.length - 6}` : ''}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {open && q.trim().length >= 2 && results.length === 0 && (
        <div className="canvas-search-results"><div className="csr-empty">No part matches “{q}”.</div></div>
      )}
    </div>
  );
}
