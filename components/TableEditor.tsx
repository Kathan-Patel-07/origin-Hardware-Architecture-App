
import React, { useState, useRef, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { ConnectionRowExtended } from '../utils/jsonToConnectionRows';

interface TableEditorProps {
  data: ConnectionRowExtended[];
  activeSubsystem: string; // key e.g. "moma" or "all"
  activeSubsystemLabel?: string;
  isDirty?: boolean;
  onCellChange: (id: string, field: string, oldValue: string, newValue: string, subsystem: string) => void;
  onDeleteRow: (id: string, subsystem: string) => void;
  onBulkDelete: (rows: { id: string; subsystem: string }[]) => void;
  onAddRow: (subsystem: string, label?: string) => void;
}

type SortDirection = 'asc' | 'desc';
interface SortConfig { key: string | null; direction: SortDirection }

// All editable columns in display order
const COLUMNS: { key: string; label: string; width?: string }[] = [
  { key: 'SourceComponent',                    label: 'Source',           width: 'min-w-[130px]' },
  { key: 'DestinationComponent',               label: 'Destination',      width: 'min-w-[130px]' },
  { key: 'ArchitectureType',                   label: 'Type',             width: 'min-w-[80px]'  },
  { key: 'FunctionalWireName',                 label: 'Wire Name',        width: 'min-w-[120px]' },
  { key: 'WireSpecifications',                 label: 'Wire Spec',        width: 'min-w-[100px]' },
  { key: 'FunctionalGroup',                    label: 'Group',            width: 'min-w-[90px]'  },
  { key: 'SourceComponentCompartment',         label: 'Src Compartment',  width: 'min-w-[120px]' },
  { key: 'DestinationComponentCompartment',    label: 'Dst Compartment',  width: 'min-w-[120px]' },
  { key: 'MaxContinuousPower',                 label: 'Max Power',        width: 'min-w-[80px]'  },
  { key: 'PowerDirection',                     label: 'Pwr Dir',          width: 'min-w-[70px]'  },
];

// Inline editable cell
const EditableCell: React.FC<{
  value: string;
  onChange: (val: string) => void;
  flagged?: boolean;
}> = ({ value, onChange, flagged }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);

  const commit = () => {
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
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
      />
    );
  }

  return (
    <div
      className={`px-2 py-1.5 text-xs cursor-text truncate max-w-[200px] rounded transition-colors hover:bg-blue-50 ${
        flagged && !value ? 'text-red-400 italic' : 'text-slate-700'
      } ${!value ? 'text-slate-300' : ''}`}
      title={value || '(empty — click to edit)'}
      onClick={() => setEditing(true)}
    >
      {value || <span className="text-slate-300 select-none">—</span>}
    </div>
  );
};

// Confirm delete dialog (inline)
const DeleteButton: React.FC<{ onConfirm: () => void }> = ({ onConfirm }) => {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => { onConfirm(); setConfirming(false); }}
          className="text-[10px] bg-red-500 hover:bg-red-600 text-white px-1.5 py-0.5 rounded font-semibold"
        >
          Delete
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-[10px] text-slate-400 hover:text-slate-600 px-1 py-0.5"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="text-slate-300 hover:text-red-500 transition-colors p-1 rounded"
      title="Delete row"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
    </button>
  );
};

// Funnel icon SVG
const FunnelIcon: React.FC<{ size?: number }> = ({ size = 11 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
  </svg>
);

export const TableEditor: React.FC<TableEditorProps> = ({
  data,
  activeSubsystem,
  activeSubsystemLabel,
  isDirty,
  onCellChange,
  onDeleteRow,
  onBulkDelete,
  onAddRow,
}) => {
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: null, direction: 'asc' });
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({});
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null);
  const [filterSearch, setFilterSearch] = useState('');
  const [filterDropdownPos, setFilterDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const [showSubPicker, setShowSubPicker] = useState(false);
  const [pickerSubsystem, setPickerSubsystem] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Available subsystems derived from data
  const availableSubsystems = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of data) {
      if (row._subsystem && !seen.has(row._subsystem))
        seen.set(row._subsystem, row._subsystemLabel ?? row._subsystem);
    }
    return Array.from(seen.entries()).map(([key, label]) => ({ key, label }));
  }, [data]);

  // Initialize picker subsystem to first available
  useEffect(() => {
    if (availableSubsystems.length > 0 && !pickerSubsystem) {
      setPickerSubsystem(availableSubsystems[0].key);
    }
  }, [availableSubsystems, pickerSubsystem]);

  // Reset filters when switching subsystems so stale filters don't bleed across subsystems
  useEffect(() => {
    setColumnFilters({});
    setSortConfig({ key: null, direction: 'asc' });
  }, [activeSubsystem]);

  const handleSort = (key: string) => {
    const direction =
      sortConfig.key === key && sortConfig.direction === 'asc' ? 'desc' : 'asc';
    setSortConfig({ key, direction });
  };

  const sorted = useMemo(() => [...data].sort((a, b) => {
    if (!sortConfig.key) return 0;
    const valA = ((a as any)[sortConfig.key] ?? '').toString().toLowerCase();
    const valB = ((b as any)[sortConfig.key] ?? '').toString().toLowerCase();
    if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
    if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  }), [data, sortConfig]);

  const filtered = useMemo(() => {
    const active = (Object.entries(columnFilters) as [string, Set<string>][]).filter(([, v]) => v.size > 0);
    if (active.length === 0) return sorted;
    return sorted.filter(row =>
      active.every(([col, vals]) => vals.has(String((row as any)[col] ?? '')))
    );
  }, [sorted, columnFilters]);

  const flaggedCount = data.filter((r) => r._flagged).length;
  const activeFilterCount = (Object.values(columnFilters) as Set<string>[]).filter(s => s.size > 0).length;

  // Rows with no destination (source-only / incomplete)
  const incompleteRows = data.filter((r) => !r.DestinationComponent?.trim());
  const [confirmCleanup, setConfirmCleanup] = useState(false);

  // Unique values for a column (from full data, not filtered)
  const getColumnValues = (col: string): string[] => {
    const vals = new Set<string>();
    for (const row of data) {
      vals.add(String((row as any)[col] ?? ''));
    }
    return Array.from(vals).sort((a, b) => {
      if (a === '') return 1;
      if (b === '') return -1;
      return a.localeCompare(b);
    });
  };

  const openFilter = (col: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (openFilterCol === col) {
      setOpenFilterCol(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setFilterDropdownPos({ top: rect.bottom + 4, left: rect.left });
    setOpenFilterCol(col);
    setFilterSearch('');
  };

  const toggleFilterValue = (col: string, val: string) => {
    setColumnFilters(prev => {
      const current = new Set(prev[col] ?? []);
      if (current.has(val)) current.delete(val);
      else current.add(val);
      return { ...prev, [col]: current };
    });
  };

  const selectAllForCol = (col: string) => {
    setColumnFilters(prev => ({ ...prev, [col]: new Set<string>() }));
  };

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!openFilterCol) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenFilterCol(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenFilterCol(null);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openFilterCol]);

  const handleAddRow = () => {
    if (activeSubsystem === 'all') {
      // Reset picker to first subsystem and show modal
      if (availableSubsystems.length > 0) {
        setPickerSubsystem(availableSubsystems[0].key);
      }
      setShowSubPicker(true);
    } else {
      onAddRow(activeSubsystem, activeSubsystemLabel ?? activeSubsystem);
    }
  };

  const confirmSubPicker = () => {
    const entry = availableSubsystems.find(s => s.key === pickerSubsystem);
    onAddRow(pickerSubsystem, entry?.label ?? pickerSubsystem);
    setShowSubPicker(false);
  };

  // Filter dropdown portal
  const filterDropdown = openFilterCol && filterDropdownPos
    ? ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: filterDropdownPos.top,
            left: filterDropdownPos.left,
            zIndex: 9999,
          }}
          className="min-w-[220px] max-h-[300px] bg-white border border-slate-200 rounded-lg shadow-xl flex flex-col overflow-hidden"
        >
          {/* Search */}
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="Search values…"
              value={filterSearch}
              onChange={e => setFilterSearch(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
            />
          </div>
          {/* Column label + Select all / Clear */}
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-100">
            <span className="text-[10px] font-semibold text-slate-500 truncate mr-2">
              {COLUMNS.find(c => c.key === openFilterCol)?.label ?? openFilterCol}
            </span>
            <div className="flex gap-1 shrink-0">
              <button
                className="text-[10px] text-blue-600 hover:underline"
                onClick={() => selectAllForCol(openFilterCol)}
              >
                Select all
              </button>
              <span className="text-slate-300 text-[10px]">|</span>
              <button
                className="text-[10px] text-slate-500 hover:underline"
                onClick={() => selectAllForCol(openFilterCol)}
              >
                Clear
              </button>
            </div>
          </div>
          {/* Value list */}
          <div className="overflow-y-auto flex-1 py-1">
            {getColumnValues(openFilterCol)
              .filter(v => {
                if (!filterSearch) return true;
                const display = v === '' ? '(empty)' : v;
                return display.toLowerCase().includes(filterSearch.toLowerCase());
              })
              .map(v => {
                const checked = (columnFilters[openFilterCol] ?? new Set()).has(v);
                const display = v === '' ? <span className="text-slate-400 italic">(empty)</span> : v;
                return (
                  <label
                    key={v === '' ? '__empty__' : v}
                    className="flex items-center gap-2 px-3 py-1 hover:bg-slate-50 cursor-pointer text-xs text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleFilterValue(openFilterCol, v)}
                      className="accent-blue-500"
                    />
                    <span className="truncate">{display}</span>
                  </label>
                );
              })}
          </div>
        </div>,
        document.body
      )
    : null;

  // Subsystem picker modal
  const subPickerModal = showSubPicker
    ? ReactDOM.createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-2xl p-5 min-w-[260px] border border-slate-200">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Add row to subsystem</h3>
            <div className="flex flex-col gap-1.5 mb-4">
              {availableSubsystems.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:bg-slate-50 px-2 py-1 rounded">
                  <input
                    type="radio"
                    name="subsystem-picker"
                    value={key}
                    checked={pickerSubsystem === key}
                    onChange={() => setPickerSubsystem(key)}
                    className="accent-blue-500"
                  />
                  {label}
                </label>
              ))}
              {availableSubsystems.length === 0 && (
                <p className="text-xs text-slate-400 italic">No subsystems available.</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSubPicker(false)}
                className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded border border-slate-200 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmSubPicker}
                disabled={!pickerSubsystem}
                className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded font-semibold"
              >
                Add
              </button>
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-2 bg-white border-b border-slate-200 flex justify-between items-center shrink-0 gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Connections
          </h2>
          <span className="text-xs text-slate-400">
            {filtered.length} rows{filtered.length !== data.length ? ` (of ${data.length})` : ''}
          </span>
          {flaggedCount > 0 && (
            <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
              {flaggedCount} ⚠ flagged
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded font-semibold animate-pulse">
              Unsaved changes
            </span>
          )}
          {incompleteRows.length > 0 && (
            confirmCleanup ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-500">Delete {incompleteRows.length} source-only rows?</span>
                <button
                  onClick={() => {
                    onBulkDelete(incompleteRows.map((r) => ({ id: r._connectionId!, subsystem: r._subsystem ?? '' })));
                    setConfirmCleanup(false);
                  }}
                  className="text-[10px] bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded font-semibold"
                >
                  Delete all
                </button>
                <button onClick={() => setConfirmCleanup(false)} className="text-[10px] text-slate-400 hover:text-slate-600 px-1 py-1">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmCleanup(true)}
                className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-2.5 py-1.5 rounded transition-colors flex items-center gap-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                Remove {incompleteRows.length} source-only
              </button>
            )
          )}
          <button
            onClick={handleAddRow}
            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            Add Row
          </button>
        </div>
      </div>

      {/* Active filter chips */}
      {activeFilterCount > 0 && (
        <div className="px-4 py-1.5 bg-white border-b border-slate-200 flex flex-wrap items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mr-1">Filtered:</span>
          {(Object.entries(columnFilters) as [string, Set<string>][])
            .filter(([, v]) => v.size > 0)
            .map(([col, vals]) => {
              const colDef = COLUMNS.find(c => c.key === col);
              const label = colDef?.label ?? col;
              const valList = Array.from(vals).map(v => v === '' ? '(empty)' : v).join(', ');
              return (
                <span
                  key={col}
                  className="flex items-center gap-1 text-[10px] bg-blue-50 border border-blue-200 text-blue-700 px-2 py-0.5 rounded-full font-medium"
                >
                  {label}: {valList}
                  <button
                    onClick={() => setColumnFilters(prev => ({ ...prev, [col]: new Set<string>() }))}
                    className="ml-0.5 text-blue-400 hover:text-blue-700"
                    title={`Clear ${label} filter`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          <button
            onClick={() => setColumnFilters({})}
            className="text-[10px] text-slate-400 hover:text-slate-600 underline ml-1"
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="min-w-max divide-y divide-slate-200 text-xs w-full">
          <thead className="bg-slate-100 sticky top-0 z-10">
            <tr>
              <th className="px-2 py-2 text-slate-500 font-semibold w-10 text-center border-r border-slate-200 bg-slate-100">#</th>
              <th className="w-16 bg-slate-100 border-r border-slate-200" />
              {COLUMNS.map((col) => {
                const hasFilter = (columnFilters[col.key]?.size ?? 0) > 0;
                const filterCount = columnFilters[col.key]?.size ?? 0;
                return (
                  <th
                    key={col.key}
                    className={`px-2 py-2 text-left text-slate-600 font-semibold border-r border-slate-200 last:border-r-0 select-none group ${col.width ?? ''}`}
                  >
                    <div className="flex items-center gap-1 justify-between">
                      {/* Sort area */}
                      <span
                        className="flex items-center gap-1 cursor-pointer hover:text-slate-800"
                        onClick={() => handleSort(col.key)}
                      >
                        {col.label}
                        <span className={`${sortConfig.key === col.key ? 'text-blue-500' : 'text-slate-300 opacity-0 group-hover:opacity-60'}`}>
                          {sortConfig.key === col.key
                            ? sortConfig.direction === 'asc' ? '↑' : '↓'
                            : '↕'}
                        </span>
                      </span>
                      {/* Funnel button */}
                      <button
                        onClick={(e) => openFilter(col.key, e)}
                        className={`flex items-center gap-0.5 rounded px-0.5 py-0.5 transition-colors ${
                          hasFilter
                            ? 'text-blue-500 opacity-100'
                            : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-slate-500'
                        }`}
                        title={`Filter by ${col.label}`}
                      >
                        <FunnelIcon />
                        {hasFilter && filterCount > 0 && (
                          <span className="text-[9px] font-bold text-blue-600 leading-none">{filterCount}</span>
                        )}
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
                <td colSpan={COLUMNS.length + 2} className="p-8 text-center text-slate-400 text-xs">
                  {data.length === 0
                    ? 'No connections. Click "Add Row" to create one.'
                    : 'No rows match the current filters.'}
                </td>
              </tr>
            )}
            {filtered.map((row, idx) => {
              const id = row._connectionId ?? `row-${idx}`;
              const sub = row._subsystem ?? '';
              const flagged = row._flagged;

              return (
                <tr
                  key={id}
                  className={`group transition-colors ${
                    flagged
                      ? 'bg-amber-50/60 hover:bg-amber-50'
                      : 'bg-white hover:bg-blue-50/40'
                  }`}
                >
                  {/* Row number + flag indicator */}
                  <td className="px-2 py-1 text-center border-r border-slate-100 text-slate-400 font-mono text-[10px] select-none">
                    <div className="flex items-center justify-center gap-1">
                      {flagged && <span className="text-amber-500" title="Missing datasheet or purchase link">⚠</span>}
                      <span>{idx + 1}</span>
                    </div>
                  </td>
                  {/* Delete */}
                  <td className="px-1 py-1 text-center border-r border-slate-100">
                    <DeleteButton onConfirm={() => onDeleteRow(id, sub)} />
                  </td>
                  {/* Editable cells */}
                  {COLUMNS.map((col) => (
                    <td key={col.key} className="p-0 border-r border-slate-100 last:border-r-0">
                      <EditableCell
                        value={(row as any)[col.key] ?? ''}
                        onChange={(newVal) =>
                          onCellChange(id, col.key, (row as any)[col.key] ?? '', newVal, sub)
                        }
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add Row footer */}
      {data.length > 0 && (
        <div className="border-t border-slate-200 bg-white px-4 py-2 shrink-0">
          <button
            onClick={handleAddRow}
            className="text-xs text-slate-400 hover:text-blue-600 flex items-center gap-1.5 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            Add row
            {activeSubsystem !== 'all' && activeSubsystemLabel && (
              <span className="text-slate-300">to {activeSubsystemLabel}</span>
            )}
          </button>
        </div>
      )}

      {filterDropdown}
      {subPickerModal}
    </div>
  );
};
