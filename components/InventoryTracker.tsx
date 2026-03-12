
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { CatalogItem } from '../services/github';

export interface InventoryOverride {
  qtyPerRobot: number;
  qtyInStock: number;
  purchaseDone: boolean;
  comment: string;
}

interface InventoryTrackerProps {
  items: CatalogItem[];
  instanceNames: Record<string, string[]>; // partId → [nodeId, ...]
  quantities: Record<string, number>;       // partId → qty from catalog nodes
  overrides: Record<string, InventoryOverride>;
  onOverrideChange: (partId: string, patch: Partial<InventoryOverride>, seedQtyPerRobot?: number) => void;
}

// ── Inline editable number cell ───────────────────────────────────────────────
const NumCell: React.FC<{
  value: number;
  onChange: (v: number) => void;
  highlight?: boolean;
  readOnly?: boolean;
}> = ({ value, onChange, highlight, readOnly }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const n = parseInt(draft, 10);
    if (!isNaN(n) && n >= 0) onChange(n);
    else setDraft(String(value));
  };

  if (readOnly) {
    return (
      <div className={`px-2 py-1.5 text-xs font-mono font-semibold text-center ${
        highlight ? 'text-red-600 bg-red-50' : value === 0 ? 'text-slate-300' : 'text-slate-700'
      }`}>
        {value}
      </div>
    );
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min="0"
        className="w-full px-2 py-1 text-xs font-mono bg-white border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-800 text-center"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setDraft(String(value)); setEditing(false); }
        }}
      />
    );
  }

  return (
    <div
      className={`px-2 py-1.5 text-xs font-mono font-semibold cursor-text text-center rounded transition-colors hover:bg-blue-50 ${
        value === 0 ? 'text-slate-300' : 'text-slate-700'
      }`}
      onClick={() => setEditing(true)}
    >
      {value}
    </div>
  );
};

// ── Inline editable comment cell ──────────────────────────────────────────────
const CommentCell: React.FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    onChange(draft);
  };

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        className="w-full min-w-[180px] px-2 py-1 text-xs bg-white border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-800 resize-none"
        rows={2}
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
          if (e.key === 'Enter' && e.shiftKey === false) { e.preventDefault(); commit(); }
        }}
      />
    );
  }

  return (
    <div
      className="px-2 py-1.5 text-xs cursor-text min-w-[180px] max-w-[280px] rounded transition-colors hover:bg-blue-50 text-slate-600 whitespace-pre-wrap break-words"
      title={value || 'Click to add comment'}
      onClick={() => setEditing(true)}
    >
      {value || <span className="text-slate-300 select-none italic">Add comment…</span>}
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
export const InventoryTracker: React.FC<InventoryTrackerProps> = ({
  items,
  instanceNames,
  quantities,
  overrides,
  onOverrideChange,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [hideDone, setHideDone] = useState(false);
  const [showNeedsPurchase, setShowNeedsPurchase] = useState(false);

  const rows = useMemo(() => {
    return items.map((item) => {
      const catalogQty = quantities[item.partId] ?? 0;
      const o = overrides[item.partId] ?? { qtyPerRobot: catalogQty, qtyInStock: 0, purchaseDone: false, comment: '' };
      // If no explicit override for qtyPerRobot, fall back to catalog qty
      const qtyPerRobot = overrides[item.partId]?.qtyPerRobot !== undefined ? o.qtyPerRobot : catalogQty;
      const fromNodes = instanceNames[item.partId] ?? [];
      const rawUsedAs = (item as any).usedAs;
      const fromCatalog: string[] = Array.isArray(rawUsedAs)
        ? rawUsedAs
        : typeof rawUsedAs === 'string'
        ? rawUsedAs.split('/').map((s: string) => s.trim()).filter(Boolean)
        : [];
      const usedAsList = fromNodes.length > 0 ? fromNodes : fromCatalog;
      const qtyPer3 = qtyPerRobot * 3;
      const qtyForPurchase = Math.max(0, qtyPer3 - o.qtyInStock);
      return {
        partId: item.partId,
        partName: item.partName ?? '',
        usedAs: usedAsList.join(' / '),
        qtyPerRobot,
        qtyPer3,
        qtyInStock: o.qtyInStock,
        qtyForPurchase,
        purchaseDone: o.purchaseDone,
        comment: o.comment,
      };
    });
  }, [items, instanceNames, quantities, overrides]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (hideDone && r.purchaseDone) return false;
      if (showNeedsPurchase && r.qtyForPurchase === 0) return false;
      if (!q) return true;
      return (
        r.partId.toLowerCase().includes(q) ||
        r.partName.toLowerCase().includes(q) ||
        r.usedAs.toLowerCase().includes(q)
      );
    });
  }, [rows, searchQuery, hideDone, showNeedsPurchase]);

  const totalNeedsPurchase = useMemo(() => rows.filter((r) => r.qtyForPurchase > 0 && !r.purchaseDone).length, [rows]);
  const totalDone = useMemo(() => rows.filter((r) => r.purchaseDone).length, [rows]);

  const set = (partId: string, patch: Partial<InventoryOverride>) => {
    const currentRow = rows.find((r) => r.partId === partId);
    onOverrideChange(partId, patch, currentRow?.qtyPerRobot ?? 0);
  };

  const COLS = [
    { label: 'Used As',              width: 'min-w-[160px]' },
    { label: 'Part ID',              width: 'min-w-[130px]' },
    { label: 'Qty / Robot',          width: 'min-w-[90px]'  },
    { label: 'Qty / 3 Robots',       width: 'min-w-[100px]' },
    { label: 'Qty in Stock',         width: 'min-w-[90px]'  },
    { label: 'Qty to Purchase',      width: 'min-w-[110px]' },
    { label: 'Purchase Done',        width: 'min-w-[110px]' },
    { label: 'Comment',              width: 'min-w-[200px]' },
  ];

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-2 bg-white border-b border-slate-200 flex items-center shrink-0 gap-4">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider shrink-0">Inventory</h2>

        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input
            type="text"
            placeholder="Search by part ID, name, used as…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-7 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:bg-white placeholder-slate-400 transition-colors"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          )}
        </div>

        <span className="text-xs text-slate-400 shrink-0">
          {filtered.length} part{filtered.length !== 1 ? 's' : ''}{filtered.length !== rows.length ? ` of ${rows.length}` : ''}
        </span>

        {/* Needs purchase filter */}
        <button
          onClick={() => setShowNeedsPurchase((v) => !v)}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
            showNeedsPurchase
              ? 'bg-red-50 border-red-300 text-red-600'
              : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
          }`}
          title="Show only parts that need purchasing"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
          Needs purchase
          {totalNeedsPurchase > 0 && (
            <span className={`text-[10px] font-bold px-1 rounded ${showNeedsPurchase ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>
              {totalNeedsPurchase}
            </span>
          )}
        </button>

        {/* Hide done filter */}
        <button
          onClick={() => setHideDone((v) => !v)}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
            hideDone
              ? 'bg-slate-800 border-slate-700 text-white'
              : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
          }`}
          title="Hide parts with purchase done"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          Hide done
          {totalDone > 0 && (
            <span className={`text-[10px] font-bold px-1 rounded ${hideDone ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
              {totalDone}
            </span>
          )}
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
            <p className="text-sm">No catalog items loaded. Select a branch first.</p>
          </div>
        ) : (
          <table className="min-w-max divide-y divide-slate-200 text-xs w-full">
            <thead className="bg-slate-100 sticky top-0 z-10">
              <tr>
                <th className="px-2 py-2 text-slate-500 font-semibold w-10 text-center border-r border-slate-200 bg-slate-100">#</th>
                {COLS.map((col) => (
                  <th
                    key={col.label}
                    className={`px-2 py-2 text-left text-slate-600 font-semibold border-r border-slate-200 last:border-r-0 select-none ${col.width}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={COLS.length + 1} className="p-8 text-center text-slate-400 text-xs">No rows match the current filters.</td>
                </tr>
              )}
              {filtered.map((row, idx) => {
                const needsPurchase = row.qtyForPurchase > 0 && !row.purchaseDone;
                const rowBg = row.purchaseDone
                  ? 'bg-green-50/50 hover:bg-green-50'
                  : needsPurchase
                  ? 'bg-red-50/30 hover:bg-red-50/60'
                  : 'bg-white hover:bg-blue-50/40';

                return (
                  <tr key={row.partId} className={`transition-colors ${rowBg}`}>
                    {/* # */}
                    <td className="px-2 py-1 text-center border-r border-slate-100 text-slate-400 font-mono text-[10px] select-none">
                      {idx + 1}
                    </td>
                    {/* Used As */}
                    <td className="px-2 py-1.5 border-r border-slate-100 min-w-[160px]">
                      <div className="text-xs text-slate-600 truncate max-w-[200px]" title={row.usedAs || row.partName}>
                        {row.usedAs || <span className="text-slate-300 italic">{row.partName || '—'}</span>}
                      </div>
                    </td>
                    {/* Part ID */}
                    <td className="px-2 py-1.5 border-r border-slate-100 min-w-[130px]">
                      <span className="text-xs font-mono text-slate-700">{row.partId}</span>
                    </td>
                    {/* Qty per Robot */}
                    <td className="p-0 border-r border-slate-100 min-w-[90px]">
                      <NumCell
                        value={row.qtyPerRobot}
                        onChange={(v) => set(row.partId, { qtyPerRobot: v })}
                      />
                    </td>
                    {/* Qty per 3 Robots (auto) */}
                    <td className="p-0 border-r border-slate-100 min-w-[100px] bg-slate-50/60">
                      <NumCell
                        value={row.qtyPer3}
                        onChange={() => {}}
                        readOnly
                      />
                    </td>
                    {/* Qty in Stock */}
                    <td className="p-0 border-r border-slate-100 min-w-[90px]">
                      <NumCell
                        value={row.qtyInStock}
                        onChange={(v) => set(row.partId, { qtyInStock: v })}
                      />
                    </td>
                    {/* Qty for Purchase (auto) */}
                    <td className="p-0 border-r border-slate-100 min-w-[110px] bg-slate-50/60">
                      <NumCell
                        value={row.qtyForPurchase}
                        onChange={() => {}}
                        readOnly
                        highlight={row.qtyForPurchase > 0 && !row.purchaseDone}
                      />
                    </td>
                    {/* Purchase Done */}
                    <td className="px-2 py-1.5 border-r border-slate-100 min-w-[110px] text-center">
                      <label className="flex items-center justify-center gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={row.purchaseDone}
                          onChange={(e) => set(row.partId, { purchaseDone: e.target.checked })}
                          className="w-3.5 h-3.5 accent-green-500 cursor-pointer"
                        />
                        <span className={`text-[10px] font-semibold select-none ${row.purchaseDone ? 'text-green-600' : 'text-slate-400'}`}>
                          {row.purchaseDone ? 'Done' : 'Pending'}
                        </span>
                      </label>
                    </td>
                    {/* Comment */}
                    <td className="p-0 border-r border-slate-100 last:border-r-0 min-w-[200px]">
                      <CommentCell
                        value={row.comment}
                        onChange={(v) => set(row.partId, { comment: v })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
