
import React, { useState, useRef, useEffect } from 'react';
import { ConnectionRowExtended } from '../utils/jsonToConnectionRows';

interface TableEditorProps {
  data: ConnectionRowExtended[];
  activeSubsystem: string; // key e.g. "moma" or "all"
  activeSubsystemLabel?: string;
  isDirty?: boolean;
  onCellChange: (id: string, field: string, oldValue: string, newValue: string, subsystem: string) => void;
  onDeleteRow: (id: string, subsystem: string) => void;
  onAddRow: (subsystem: string, label?: string) => void;
}

type SortDirection = 'asc' | 'desc';
interface SortConfig { key: string | null; direction: SortDirection }

// All editable columns in display order
const COLUMNS: { key: string; label: string; width?: string }[] = [
  { key: 'SourceComponent',                    label: 'Source',           width: 'min-w-[130px]' },
  { key: 'SourceComponentPartName',            label: 'Part Name',        width: 'min-w-[130px]' },
  { key: 'SourceComponentDatasheetLink',       label: 'Src Datasheet',    width: 'min-w-[120px]' },
  { key: 'SourceComponentPurchaseLink',        label: 'Src Purchase',     width: 'min-w-[120px]' },
  { key: 'DestinationComponent',               label: 'Destination',      width: 'min-w-[130px]' },
  { key: 'DestinationComponentDatasheetLink',  label: 'Dst Datasheet',    width: 'min-w-[120px]' },
  { key: 'DestinationComponentPurchaseLink',   label: 'Dst Purchase',     width: 'min-w-[120px]' },
  { key: 'ArchitectureType',                   label: 'Type',             width: 'min-w-[80px]'  },
  { key: 'FunctionalWireName',                 label: 'Wire Name',        width: 'min-w-[120px]' },
  { key: 'WireSpecifications',                 label: 'Wire Spec',        width: 'min-w-[100px]' },
  { key: 'FunctionalGroup',                    label: 'Group',            width: 'min-w-[90px]'  },
  { key: 'SourceComponentCompartment',         label: 'Src Compartment',  width: 'min-w-[120px]' },
  { key: 'DestinationComponentCompartment',    label: 'Dst Compartment',  width: 'min-w-[120px]' },
  { key: 'AveragePower',                       label: 'Avg Pwr',          width: 'min-w-[80px]'  },
  { key: 'MaxContinuousPower',                 label: 'Max Pwr',          width: 'min-w-[80px]'  },
  { key: 'PeakPower',                          label: 'Peak Pwr',         width: 'min-w-[80px]'  },
  { key: 'PeakPowerTransientTime',             label: 'Trans. Time',      width: 'min-w-[80px]'  },
  { key: 'PowerDirection',                     label: 'Pwr Dir',          width: 'min-w-[70px]'  },
  { key: 'Notes',                              label: 'Notes',            width: 'min-w-[150px]' },
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

export const TableEditor: React.FC<TableEditorProps> = ({
  data,
  activeSubsystem,
  activeSubsystemLabel,
  isDirty,
  onCellChange,
  onDeleteRow,
  onAddRow,
}) => {
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: null, direction: 'asc' });

  const handleSort = (key: string) => {
    const direction =
      sortConfig.key === key && sortConfig.direction === 'asc' ? 'desc' : 'asc';
    setSortConfig({ key, direction });
  };

  const sorted = [...data].sort((a, b) => {
    if (!sortConfig.key) return 0;
    const valA = ((a as any)[sortConfig.key] ?? '').toString().toLowerCase();
    const valB = ((b as any)[sortConfig.key] ?? '').toString().toLowerCase();
    if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
    if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const flaggedCount = data.filter((r) => r._flagged).length;

  const handleAddRow = () => {
    // Use the active subsystem key; fall back to 'moma' if "all" view
    const subKey = activeSubsystem !== 'all' ? activeSubsystem : 'moma';
    const subLabel = activeSubsystem !== 'all' ? (activeSubsystemLabel ?? subKey) : 'MoMa';
    onAddRow(subKey, subLabel);
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-2 bg-white border-b border-slate-200 flex justify-between items-center shrink-0 gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Connections
          </h2>
          <span className="text-xs text-slate-400">{data.length} rows</span>
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
          <button
            onClick={handleAddRow}
            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            Add Row
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="min-w-max divide-y divide-slate-200 text-xs w-full">
          <thead className="bg-slate-100 sticky top-0 z-10">
            <tr>
              <th className="px-2 py-2 text-slate-500 font-semibold w-10 text-center border-r border-slate-200 bg-slate-100">#</th>
              <th className="w-16 bg-slate-100 border-r border-slate-200" />
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`px-2 py-2 text-left text-slate-600 font-semibold border-r border-slate-200 last:border-r-0 cursor-pointer hover:bg-slate-200 select-none group ${col.width ?? ''}`}
                  onClick={() => handleSort(col.key)}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    <span className={`${sortConfig.key === col.key ? 'text-blue-500' : 'text-slate-300 opacity-0 group-hover:opacity-60'}`}>
                      {sortConfig.key === col.key
                        ? sortConfig.direction === 'asc' ? '↑' : '↓'
                        : '↕'}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 2} className="p-8 text-center text-slate-400 text-xs">
                  No connections. Click "Add Row" to create one.
                </td>
              </tr>
            )}
            {sorted.map((row, idx) => {
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
                        flagged={flagged && (col.key === 'SourceComponentDatasheetLink' || col.key === 'SourceComponentPurchaseLink')}
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
    </div>
  );
};
