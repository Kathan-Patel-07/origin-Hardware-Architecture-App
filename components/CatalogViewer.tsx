
import React, { useState, useMemo, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { CatalogItem } from '../services/github';

interface CatalogViewerProps {
  items: CatalogItem[];
  quantities: Record<string, number>;
  instanceNames: Record<string, string[]>; // partId → [nodeId, ...]
  edits: Record<string, Record<string, string>>; // partId → { field → newValue }
  newPartIds: Set<string>;
  deletedPartIds: Set<string>;
  onCellChange: (partId: string, field: string, oldValue: string, newValue: string) => void;
  onDeleteRow: (partId: string) => void;
  onAddRow: (item: CatalogItem) => void;
}

type SortDirection = 'asc' | 'desc';
interface SortConfig { key: string | null; direction: SortDirection }

const EDITABLE_COLS: { key: keyof CatalogItem; label: string; width?: string; isLink?: boolean }[] = [
  { key: 'partName',           label: 'Part Name',   width: 'min-w-[180px]' },
  { key: 'category',           label: 'Category',    width: 'min-w-[110px]' },
  { key: 'datasheetUrl',       label: 'Datasheet',   width: 'min-w-[110px]', isLink: true },
  { key: 'purchaseLink',       label: 'Purchase',    width: 'min-w-[110px]', isLink: true },
  { key: 'averagePower',       label: 'Avg Power',   width: 'min-w-[90px]'  },
  { key: 'maxContinuousPower', label: 'Max Power',   width: 'min-w-[90px]'  },
  { key: 'peakPower',          label: 'Peak Power',  width: 'min-w-[90px]'  },
  { key: 'specRef',            label: 'Spec Ref',    width: 'min-w-[110px]' },
];

const ALL_COLS = [
  { key: '__usedAs', label: 'Used As',  width: 'min-w-[160px]', readOnly: true,  isCheckbox: false },
  { key: 'partId',   label: 'Part ID',  width: 'min-w-[130px]', readOnly: false, isCheckbox: false },
  ...EDITABLE_COLS.map((c) => ({ ...c, readOnly: false, isCheckbox: false })),
  { key: 'inStock',  label: 'In Stock', width: 'min-w-[80px]',  readOnly: false, isCheckbox: true  },
  { key: '__qty',    label: 'Qty',      width: 'min-w-[60px]',  readOnly: true,  isCheckbox: false },
];

// ── Inline editable cell ──────────────────────────────────────────────────────
const EditableCell: React.FC<{
  value: string;
  edited?: boolean;
  isLink?: boolean;
  onChange: (val: string) => void;
}> = ({ value, edited, isLink, onChange }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  // Only sync draft from prop when NOT actively editing, so typing in-progress is never clobbered
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  // Reset commit guard each time a new edit session begins
  useEffect(() => { if (editing) committedRef.current = false; }, [editing]);

  const commit = () => {
    if (committedRef.current) return; // guard against double-fire (Enter key + subsequent blur)
    committedRef.current = true;
    setEditing(false);
    onChange(draft);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="w-full px-2 py-1 text-xs bg-white border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-800"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { committedRef.current = true; setDraft(value); setEditing(false); }
        }}
      />
    );
  }

  return (
    <div
      className={`px-2 py-1.5 text-xs cursor-text truncate max-w-[200px] rounded transition-colors hover:bg-blue-50 ${
        edited ? 'bg-yellow-50' : ''
      }`}
      title={value || '(empty — click to edit)'}
      onClick={() => setEditing(true)}
    >
      {isLink && value ? (
        <div className="flex items-center gap-1">
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            Link
          </a>
          <span className="text-slate-300 text-[10px]">↗</span>
        </div>
      ) : (
        <span className={value ? 'text-slate-700' : 'text-slate-300 select-none'}>
          {value || '—'}
        </span>
      )}
    </div>
  );
};

// ── Funnel icon ───────────────────────────────────────────────────────────────
const FunnelIcon: React.FC<{ size?: number }> = ({ size = 11 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
  </svg>
);

// ── Delete button with confirm ────────────────────────────────────────────────
const DeleteButton: React.FC<{ onConfirm: () => void }> = ({ onConfirm }) => {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <button onClick={() => { onConfirm(); setConfirming(false); }} className="text-[10px] bg-red-500 hover:bg-red-600 text-white px-1.5 py-0.5 rounded font-semibold">Delete</button>
        <button onClick={() => setConfirming(false)} className="text-[10px] text-slate-400 hover:text-slate-600 px-1 py-0.5">Cancel</button>
      </div>
    );
  }
  return (
    <button onClick={() => setConfirming(true)} className="text-slate-300 hover:text-red-500 transition-colors p-1 rounded" title="Delete part">
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
    </button>
  );
};

// ── Add Row Modal ─────────────────────────────────────────────────────────────
const BLANK_ITEM: CatalogItem = { partId: '', partName: '', category: '', datasheetUrl: '', purchaseLink: '', averagePower: '', maxContinuousPower: '', peakPower: '', specRef: '' };

const AddRowModal: React.FC<{
  existingIds: Set<string>;
  onConfirm: (item: CatalogItem) => void;
  onClose: () => void;
}> = ({ existingIds, onConfirm, onClose }) => {
  const [draft, setDraft] = useState<CatalogItem>({ ...BLANK_ITEM });
  const [error, setError] = useState('');

  const set = (field: keyof CatalogItem, val: string) => setDraft((p) => ({ ...p, [field]: val }));

  const handleAdd = () => {
    const id = draft.partId.trim();
    if (!id) { setError('Part ID is required.'); return; }
    if (existingIds.has(id)) { setError(`Part ID "${id}" already exists.`); return; }
    onConfirm({ ...draft, partId: id });
  };

  const fields: { key: keyof CatalogItem; label: string; required?: boolean }[] = [
    { key: 'partId',              label: 'Part ID',        required: true },
    { key: 'partName',            label: 'Part Name' },
    { key: 'category',            label: 'Category' },
    { key: 'datasheetUrl',        label: 'Datasheet URL' },
    { key: 'purchaseLink',        label: 'Purchase Link' },
    { key: 'averagePower',        label: 'Avg Power' },
    { key: 'maxContinuousPower',  label: 'Max Power' },
    { key: 'peakPower',           label: 'Peak Power' },
    { key: 'specRef',             label: 'Spec Ref' },
  ];

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md border border-slate-200 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700">Add Catalog Part</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div className="flex flex-col gap-2.5 max-h-[60vh] overflow-y-auto pr-1">
          {fields.map(({ key, label, required }) => (
            <div key={key}>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                {label}{required && <span className="text-red-500 ml-0.5">*</span>}
              </label>
              <input
                value={draft[key] ?? ''}
                onChange={(e) => { set(key, e.target.value); if (key === 'partId') setError(''); }}
                className="w-full text-xs border border-slate-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono"
                placeholder={required ? 'Required' : 'Optional'}
              />
            </div>
          ))}
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 border border-slate-300 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-xs font-semibold">Cancel</button>
          <button onClick={handleAdd} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-semibold">Add Part</button>
        </div>
      </div>
    </div>,
    document.body
  );
};

// ── Main component ────────────────────────────────────────────────────────────
export const CatalogViewer: React.FC<CatalogViewerProps> = ({ items, quantities, instanceNames, edits, newPartIds, deletedPartIds, onCellChange, onDeleteRow, onAddRow }) => {
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: null, direction: 'asc' });
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({});
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null);
  const [filterSearch, setFilterSearch] = useState('');
  const [filterDropdownPos, setFilterDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [outOfStockOnly, setOutOfStockOnly] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const existingIds = useMemo(() => new Set(items.map((i) => i.partId)), [items]);

  // Merge edits + computed fields into display rows
  const rows = useMemo(
    () => items.map((item) => ({
      ...item,
      ...(edits[item.partId] ?? {}),
      __qty: quantities[item.partId] ?? 0,
      __usedAs: (instanceNames[item.partId] ?? []).join(' / '),
    })),
    [items, quantities, instanceNames, edits]
  );

  const sorted = useMemo(() => {
    if (!sortConfig.key) return rows;
    return [...rows].sort((a, b) => {
      const valA = String((a as any)[sortConfig.key!] ?? '').toLowerCase();
      const valB = String((b as any)[sortConfig.key!] ?? '').toLowerCase();
      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [rows, sortConfig]);

  const filtered = useMemo(() => {
    const active = (Object.entries(columnFilters) as [string, Set<string>][]).filter(([, v]) => v.size > 0);
    const q = searchQuery.trim().toLowerCase();
    return sorted.filter((row) => {
      if (outOfStockOnly && String((row as any).inStock) === 'true') return false;
      if (active.length > 0 && !active.every(([col, vals]) => vals.has(String((row as any)[col] ?? '')))) return false;
      if (!q) return true;
      return (
        row.partId.toLowerCase().includes(q) ||
        (row.partName ?? '').toLowerCase().includes(q) ||
        (row.category ?? '').toLowerCase().includes(q) ||
        (row.specRef ?? '').toLowerCase().includes(q) ||
        ((row as any).__usedAs ?? '').toLowerCase().includes(q)
      );
    });
  }, [sorted, columnFilters, searchQuery, outOfStockOnly]);

  const activeFilterCount = (Object.values(columnFilters) as Set<string>[]).filter((s) => s.size > 0).length;

  const getColumnValues = (col: string): string[] => {
    const vals = new Set<string>();
    for (const row of rows) vals.add(String((row as any)[col] ?? ''));
    return Array.from(vals).sort((a, b) => {
      if (a === '') return 1;
      if (b === '') return -1;
      return a.localeCompare(b);
    });
  };

  const handleSort = (key: string) => {
    const direction = sortConfig.key === key && sortConfig.direction === 'asc' ? 'desc' : 'asc';
    setSortConfig({ key, direction });
  };

  const openFilter = (col: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (openFilterCol === col) { setOpenFilterCol(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setFilterDropdownPos({ top: rect.bottom + 4, left: rect.left });
    setOpenFilterCol(col);
    setFilterSearch('');
  };

  const toggleFilterValue = (col: string, val: string) => {
    setColumnFilters((prev) => {
      const current = new Set(prev[col] ?? []);
      if (current.has(val)) current.delete(val); else current.add(val);
      return { ...prev, [col]: current };
    });
  };

  useEffect(() => {
    if (!openFilterCol) return;
    const onMouseDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpenFilterCol(null);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenFilterCol(null); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('mousedown', onMouseDown); document.removeEventListener('keydown', onKeyDown); };
  }, [openFilterCol]);

  const filterDropdown = openFilterCol && filterDropdownPos
    ? ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: filterDropdownPos.top, left: filterDropdownPos.left, zIndex: 9999 }}
          className="min-w-[220px] max-h-[300px] bg-white border border-slate-200 rounded-lg shadow-xl flex flex-col overflow-hidden"
        >
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="Search values…"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
          <div className="flex gap-1 px-2 py-1.5 border-b border-slate-100">
            <button className="text-[10px] text-blue-600 hover:underline" onClick={() => {
              setColumnFilters((prev) => ({ ...prev, [openFilterCol]: new Set(getColumnValues(openFilterCol)) }));
            }}>Select all</button>
            <span className="text-slate-300 text-[10px]">|</span>
            <button className="text-[10px] text-slate-500 hover:underline" onClick={() =>
              setColumnFilters((prev) => ({ ...prev, [openFilterCol]: new Set<string>() }))
            }>Clear</button>
          </div>
          <div className="overflow-y-auto flex-1 py-1">
            {getColumnValues(openFilterCol)
              .filter((v) => !filterSearch || (v === '' ? '(empty)' : v).toLowerCase().includes(filterSearch.toLowerCase()))
              .map((v) => {
                const checked = (columnFilters[openFilterCol] ?? new Set()).has(v);
                return (
                  <label key={v === '' ? '__empty__' : v} className="flex items-center gap-2 px-3 py-1 hover:bg-slate-50 cursor-pointer text-xs text-slate-700">
                    <input type="checkbox" checked={checked} onChange={() => toggleFilterValue(openFilterCol, v)} className="accent-blue-500" />
                    <span className="truncate">{v === '' ? <span className="text-slate-400 italic">(empty)</span> : v}</span>
                  </label>
                );
              })}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-2 bg-white border-b border-slate-200 flex items-center shrink-0 gap-4">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider shrink-0">Catalog</h2>
        {/* Search bar */}
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input
            type="text"
            placeholder="Search by part ID, name, category, used as, spec ref…"
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
          {filtered.length} parts{filtered.length !== rows.length ? ` of ${rows.length}` : ''}
        </span>
        {/* Out-of-stock filter toggle */}
        <button
          onClick={() => setOutOfStockOnly((v) => !v)}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
            outOfStockOnly
              ? 'bg-red-50 border-red-300 text-red-600'
              : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
          }`}
          title="Show only parts not in stock"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1"/>
            <path d="m15 17 5 5"/>
            <path d="m20 17-5 5"/>
          </svg>
          Out of stock
        </button>
        <button
          onClick={() => setShowAddModal(true)}
          className="ml-auto shrink-0 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
          Add Part
        </button>
      </div>

      {/* Active filter chips */}
      {activeFilterCount > 0 && (
        <div className="px-4 py-1.5 bg-white border-b border-slate-200 flex flex-wrap items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mr-1">Filtered:</span>
          {(Object.entries(columnFilters) as [string, Set<string>][])
            .filter(([, v]) => v.size > 0)
            .map(([col, vals]) => {
              const colDef = ALL_COLS.find((c) => c.key === col);
              const label = colDef?.label ?? col;
              const valList = Array.from(vals).map((v) => v === '' ? '(empty)' : v).join(', ');
              return (
                <span key={col} className="flex items-center gap-1 text-[10px] bg-blue-50 border border-blue-200 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                  {label}: {valList}
                  <button onClick={() => setColumnFilters((prev) => ({ ...prev, [col]: new Set<string>() }))} className="ml-0.5 text-blue-400 hover:text-blue-700" title={`Clear ${label} filter`}>×</button>
                </span>
              );
            })}
          <button onClick={() => setColumnFilters({})} className="text-[10px] text-slate-400 hover:text-slate-600 underline ml-1">Clear all</button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
            <p className="text-sm">No catalog items found for this branch.</p>
          </div>
        ) : (
          <table className="min-w-max divide-y divide-slate-200 text-xs w-full">
            <thead className="bg-slate-100 sticky top-0 z-10">
              <tr>
                <th className="px-2 py-2 text-slate-500 font-semibold w-10 text-center border-r border-slate-200 bg-slate-100">#</th>
                <th className="w-14 bg-slate-100 border-r border-slate-200" />
                {ALL_COLS.map((col) => {
                  const hasFilter = (columnFilters[col.key]?.size ?? 0) > 0;
                  const filterCount = columnFilters[col.key]?.size ?? 0;
                  return (
                    <th key={col.key} className={`px-2 py-2 text-left text-slate-600 font-semibold border-r border-slate-200 last:border-r-0 select-none group ${col.width ?? ''}`}>
                      <div className="flex items-center gap-1 justify-between">
                        <span className="flex items-center gap-1 cursor-pointer hover:text-slate-800" onClick={() => handleSort(col.key)}>
                          {col.label}
                          <span className={`${sortConfig.key === col.key ? 'text-blue-500' : 'text-slate-300 opacity-0 group-hover:opacity-60'}`}>
                            {sortConfig.key === col.key ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                          </span>
                        </span>
                        <button
                          onClick={(e) => openFilter(col.key, e)}
                          className={`flex items-center gap-0.5 rounded px-0.5 py-0.5 transition-colors ${hasFilter ? 'text-blue-500 opacity-100' : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-slate-500'}`}
                          title={`Filter by ${col.label}`}
                        >
                          <FunnelIcon />
                          {hasFilter && filterCount > 0 && <span className="text-[9px] font-bold text-blue-600 leading-none">{filterCount}</span>}
                        </button>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={ALL_COLS.length + 2} className="p-8 text-center text-slate-400 text-xs">No rows match the current filters.</td>
                </tr>
              )}
              {filtered.map((row, idx) => {
                const partEdits = edits[row.partId] ?? {};
                const isNew = newPartIds.has(row.partId);
                const isEdited = !isNew && Object.keys(partEdits).length > 0;
                const rowBg = isNew
                  ? 'bg-green-50/60 hover:bg-green-50'
                  : isEdited
                  ? 'bg-yellow-50/60 hover:bg-yellow-50'
                  : 'bg-white hover:bg-blue-50/40';
                return (
                  <tr key={row.partId} className={`transition-colors ${rowBg}`}>
                    <td className="px-2 py-1 text-center border-r border-slate-100 text-slate-400 font-mono text-[10px] select-none">
                      {isNew
                        ? <span className="text-green-600 font-bold text-[9px]">NEW</span>
                        : idx + 1}
                    </td>
                    {/* Delete button */}
                    <td className="px-1 py-1 text-center border-r border-slate-100">
                      <DeleteButton onConfirm={() => onDeleteRow(row.partId)} />
                    </td>
                    {ALL_COLS.map((col) => {
                      const val = String((row as any)[col.key] ?? '');
                      if (col.readOnly) {
                        if (col.key === '__usedAs') {
                          return (
                            <td key={col.key} className="px-2 py-1.5 border-r border-slate-100 text-xs bg-slate-50/60 max-w-[200px]">
                              <span className={`truncate block ${val ? 'text-slate-700' : 'text-slate-300'}`} title={val || '—'}>
                                {val || '—'}
                              </span>
                            </td>
                          );
                        }
                        // __qty
                        return (
                          <td key={col.key} className="px-2 py-1.5 border-r border-slate-100 last:border-r-0 text-xs bg-slate-50/60">
                            <span className={`font-mono font-semibold ${Number(val) === 0 ? 'text-slate-300' : 'text-slate-700'}`}>{val}</span>
                          </td>
                        );
                      }
                      const fieldKey = col.key as string;
                      const isPartIdCol = fieldKey === 'partId';
                      const isCellEdited = !isPartIdCol && fieldKey in partEdits;
                      // ── Checkbox column (inStock) ──────────────────────────
                      if (col.isCheckbox) {
                        const checked = val === 'true';
                        return (
                          <td key={col.key} className={`px-2 py-1.5 border-r border-slate-100 last:border-r-0 text-center ${isCellEdited ? 'bg-yellow-50' : ''}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const originalBool = String((items.find((i) => i.partId === row.partId) as any)?.[fieldKey] ?? '');
                                onCellChange(row.partId, fieldKey, originalBool, e.target.checked ? 'true' : 'false');
                              }}
                              className="w-3.5 h-3.5 accent-green-500 cursor-pointer"
                              title={checked ? 'In stock' : 'Not in stock'}
                            />
                          </td>
                        );
                      }
                      // For partId col, originalVal = the current stable key so the handler knows what to rename
                      const originalVal = isPartIdCol
                        ? row.partId
                        : String((items.find((i) => i.partId === row.partId) as any)?.[fieldKey] ?? '');
                      return (
                        <td key={col.key} className={`p-0 border-r border-slate-100 last:border-r-0 ${isCellEdited ? 'bg-yellow-50' : ''}`}>
                          <EditableCell
                            value={val}
                            edited={isCellEdited}
                            isLink={(col as any).isLink}
                            onChange={(newVal) => onCellChange(row.partId, fieldKey, originalVal, newVal)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {filterDropdown}
      {showAddModal && (
        <AddRowModal
          existingIds={existingIds}
          onConfirm={(item) => { onAddRow(item); setShowAddModal(false); }}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
};
