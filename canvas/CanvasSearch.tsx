import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArchData } from './data/architecture';
import type { SheetId } from './useArchitecture';

/**
 * Find a component anywhere in the document (Ctrl+K). Lists every sheet a match appears
 * on; picking one opens that sheet and centres the block. Matches name, part numbers and
 * the details text (IPN, MPN, vendor…).
 */
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
    const rows: { sheet: SheetId; id: string; label: string; summary: string; text: string }[] = [];
    const add = (sheet: SheetId, nodes: ArchData['nodes']) => {
      for (const n of nodes) {
        if (n.id.endsWith(':from')) continue; // off-sheet reference blocks
        rows.push({ sheet, id: n.id, label: n.label, summary: n.summary ?? '',
                    text: `${n.label} ${n.summary ?? ''} ${n.description ?? ''}`.toLowerCase() });
      }
    };
    add(null, doc.nodes);
    for (const [k, s] of Object.entries(doc.sheets ?? {})) add(k, s.nodes);
    return rows;
  }, [doc]);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    const exact = index.filter((r) => r.label.toLowerCase() === t);
    const starts = index.filter((r) => r.label.toLowerCase().startsWith(t) && !exact.includes(r));
    const rest = index.filter((r) => !r.label.toLowerCase().startsWith(t) && r.text.includes(t));
    return [...exact, ...starts, ...rest].slice(0, 40);
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

  const pick = (i: number) => {
    const r = results[i];
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
          {results.map((r, i) => (
            <button
              key={`${r.sheet}|${r.id}`}
              className={`canvas-search-row${i === active ? ' active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
            >
              <span className="csr-label">{r.label}</span>
              <span className="csr-where">{sheetName(r.sheet)}</span>
              {r.summary && <span className="csr-summary">{r.summary}</span>}
            </button>
          ))}
        </div>
      )}
      {open && q.trim().length >= 2 && results.length === 0 && (
        <div className="canvas-search-results"><div className="csr-empty">No part matches “{q}”.</div></div>
      )}
    </div>
  );
}
