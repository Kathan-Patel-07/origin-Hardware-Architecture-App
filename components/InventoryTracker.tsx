
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { CatalogItem } from '../services/github';

type SortKey = 'usedAs' | 'partId' | 'qtyPerRobot' | 'qtyPer3' | 'qtyInStock' | 'qtyForPurchase' | 'purchaseStatus';
type SortDir = 'asc' | 'desc';
interface SortConfig { key: SortKey | null; dir: SortDir }

export type PurchaseStatus = '' | 'pr_raised' | 'approved' | 'purchased' | 'order_received';

export interface InventoryOverride {
  qtyPerRobot: number;
  qtyInStock: number;
  purchaseStatus: PurchaseStatus;
  assemblyDate?: string; // ISO date string e.g. "2026-04-15"
  comment: string;
}

const PURCHASE_STATUS_OPTIONS: { value: PurchaseStatus; label: string }[] = [
  { value: '',               label: '—'              },
  { value: 'pr_raised',     label: 'PR Raised'      },
  { value: 'approved',      label: 'Approved'       },
  { value: 'purchased',     label: 'Purchased'      },
  { value: 'order_received',label: 'Order Received' },
];

const PURCHASE_STATUS_ORDER: Record<PurchaseStatus, number> = {
  '': 0, pr_raised: 1, approved: 2, purchased: 3, order_received: 4,
};

const statusStyle = (s: PurchaseStatus) => {
  switch (s) {
    case 'pr_raised':      return 'bg-yellow-50 text-yellow-700 border-yellow-300';
    case 'approved':       return 'bg-blue-50 text-blue-700 border-blue-300';
    case 'purchased':      return 'bg-emerald-50 text-emerald-700 border-emerald-300';
    case 'order_received': return 'bg-green-100 text-green-800 border-green-400';
    default:               return 'bg-white text-slate-400 border-slate-200';
  }
};

interface InventoryTrackerProps {
  items: CatalogItem[];
  instanceNames: Record<string, string[]>; // partId → [nodeId, ...]
  quantities: Record<string, number>;       // partId → qty from catalog nodes
  partSubsystems?: Record<string, string[]>; // partId → [subsystemKey, ...]
  subsystemTabs?: { key: string; label: string }[];
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

// ── Inline editable date cell ─────────────────────────────────────────────────
const DateCell: React.FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const formatted = value
    ? new Date(value + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="date"
        className="w-full px-2 py-1 text-xs bg-white border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-800"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Enter') setEditing(false);
        }}
      />
    );
  }

  return (
    <div
      className="px-2 py-1.5 text-xs cursor-pointer rounded transition-colors hover:bg-blue-50 min-w-[110px]"
      onClick={() => setEditing(true)}
    >
      {formatted
        ? <span className="text-slate-700 font-mono">{formatted}</span>
        : <span className="text-slate-300 italic select-none">Set date…</span>
      }
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
export const InventoryTracker: React.FC<InventoryTrackerProps> = ({
  items,
  instanceNames,
  quantities,
  partSubsystems,
  subsystemTabs,
  overrides,
  onOverrideChange,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [hideDone, setHideDone] = useState(false);
  const [showNeedsPurchase, setShowNeedsPurchase] = useState(false);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: null, dir: 'asc' });
  const [activeSubsystem, setActiveSubsystem] = useState('all');

  const toggleSort = (key: SortKey) => {
    setSortConfig((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    );
  };

  const rows = useMemo(() => {
    return items.map((item) => {
      const catalogQty = quantities[item.partId] ?? 0;
      const o = overrides[item.partId] ?? { qtyPerRobot: catalogQty, qtyInStock: 0, purchaseStatus: '' as PurchaseStatus, comment: '' };
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
        purchaseStatus: (o.purchaseStatus ?? '') as PurchaseStatus,
        assemblyDate: o.assemblyDate ?? '',
        comment: o.comment,
      };
    });
  }, [items, instanceNames, quantities, overrides]);

  const sorted = useMemo(() => {
    if (!sortConfig.key) return rows;
    const k = sortConfig.key;
    const mul = sortConfig.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[k];
      const bv = b[k];
      if (k === 'purchaseStatus') {
        return (PURCHASE_STATUS_ORDER[av as PurchaseStatus] - PURCHASE_STATUS_ORDER[bv as PurchaseStatus]) * mul;
      }
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul;
      return String(av).localeCompare(String(bv)) * mul;
    });
  }, [rows, sortConfig]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sorted.filter((r) => {
      if (hideDone && r.purchaseStatus === 'order_received') return false;
      if (showNeedsPurchase && r.qtyForPurchase === 0) return false;
      if (activeSubsystem !== 'all') {
        const subs = partSubsystems?.[r.partId] ?? [];
        if (!subs.includes(activeSubsystem)) return false;
      }
      if (!q) return true;
      return (
        r.partId.toLowerCase().includes(q) ||
        r.partName.toLowerCase().includes(q) ||
        r.usedAs.toLowerCase().includes(q)
      );
    });
  }, [sorted, searchQuery, hideDone, showNeedsPurchase, activeSubsystem, partSubsystems]);

  const totalNeedsPurchase = useMemo(() => rows.filter((r) => r.qtyForPurchase > 0 && r.purchaseStatus !== 'order_received').length, [rows]);
  const totalDone = useMemo(() => rows.filter((r) => r.purchaseStatus === 'order_received').length, [rows]);

  const set = (partId: string, patch: Partial<InventoryOverride>) => {
    const currentRow = rows.find((r) => r.partId === partId);
    onOverrideChange(partId, patch, currentRow?.qtyPerRobot ?? 0);
  };

  const COLS: { label: string; width: string; sortKey?: SortKey }[] = [
    { label: 'Used As',         width: 'min-w-[160px]', sortKey: 'usedAs'        },
    { label: 'Part ID',         width: 'min-w-[130px]', sortKey: 'partId'        },
    { label: 'Qty / Robot',     width: 'min-w-[90px]',  sortKey: 'qtyPerRobot'   },
    { label: 'Qty / 3 Robots',  width: 'min-w-[100px]', sortKey: 'qtyPer3'       },
    { label: 'Qty in Stock',    width: 'min-w-[90px]',  sortKey: 'qtyInStock'    },
    { label: 'Qty to Purchase', width: 'min-w-[110px]', sortKey: 'qtyForPurchase'},
    { label: 'Purchase Status', width: 'min-w-[140px]', sortKey: 'purchaseStatus'},
    { label: 'Assembly Date',   width: 'min-w-[120px]'                           },
    { label: 'Comment',         width: 'min-w-[200px]'                           },
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

      {/* Subsystem tabs */}
      {subsystemTabs && subsystemTabs.length > 1 && (
        <div className="flex items-center gap-0 border-b border-slate-200 bg-white px-4 overflow-x-auto shrink-0">
          {subsystemTabs.map((tab) => {
            const count = tab.key === 'all'
              ? rows.length
              : rows.filter((r) => (partSubsystems?.[r.partId] ?? []).includes(tab.key)).length;
            const isActive = activeSubsystem === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveSubsystem(tab.key)}
                className={`px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-all flex items-center gap-1.5 ${
                  isActive
                    ? 'border-blue-500 text-blue-700 bg-blue-50/30'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab.label}
                <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${isActive ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

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
                {COLS.map((col) => {
                  const isActive = col.sortKey && sortConfig.key === col.sortKey;
                  return (
                    <th
                      key={col.label}
                      onClick={col.sortKey ? () => toggleSort(col.sortKey!) : undefined}
                      className={`px-2 py-2 text-left font-semibold border-r border-slate-200 last:border-r-0 select-none ${col.width} ${
                        col.sortKey ? 'cursor-pointer hover:bg-slate-200 transition-colors' : ''
                      } ${isActive ? 'text-blue-700 bg-blue-50' : 'text-slate-600'}`}
                    >
                      <span className="flex items-center gap-1">
                        {col.label}
                        {col.sortKey && (
                          <span className={`text-[10px] ${isActive ? 'text-blue-500' : 'text-slate-300'}`}>
                            {isActive ? (sortConfig.dir === 'asc' ? '▲' : '▼') : '⇅'}
                          </span>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={COLS.length + 1} className="p-8 text-center text-slate-400 text-xs">No rows match the current filters.</td>
                </tr>
              )}
              {filtered.map((row, idx) => {
                const needsPurchase = row.qtyForPurchase > 0 && row.purchaseStatus !== 'order_received';
                const rowBg = row.purchaseStatus === 'order_received'
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
                        highlight={row.qtyForPurchase > 0 && row.purchaseStatus !== 'order_received'}
                      />
                    </td>
                    {/* Purchase Status */}
                    <td className="px-2 py-1.5 border-r border-slate-100 min-w-[140px]">
                      <select
                        value={row.purchaseStatus}
                        onChange={(e) => set(row.partId, { purchaseStatus: e.target.value as PurchaseStatus })}
                        className={`w-full px-2 py-1 text-[11px] font-semibold rounded border cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-400 transition-colors ${statusStyle(row.purchaseStatus)}`}
                      >
                        {PURCHASE_STATUS_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </td>
                    {/* Assembly Date */}
                    <td className="p-0 border-r border-slate-100 min-w-[120px]">
                      <DateCell
                        value={row.assemblyDate}
                        onChange={(v) => set(row.partId, { assemblyDate: v })}
                      />
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
