
import React, { useState, useMemo } from 'react';
import { ConnectionRowExtended } from '../utils/jsonToConnectionRows';
import { AssemblyStateReturn } from '../hooks/useAssemblyState';
import { DeviationForm } from './DeviationForm';

type StatusFilter = 'all' | 'pending' | 'assembled' | 'deviation';

interface AssemblyTrackerProps {
  rows: ConnectionRowExtended[];
  assemblyState: AssemblyStateReturn;
  onSave: () => Promise<void>;
  isSaving: boolean;
  saveError: string | null;
}

export const AssemblyTracker: React.FC<AssemblyTrackerProps> = ({
  rows,
  assemblyState,
  onSave,
  isSaving,
  saveError,
}) => {
  const { statuses, isDirty, markAssembled, unmark, logDeviation, clearDeviation } = assemblyState;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [deviationOpenFor, setDeviationOpenFor] = useState<string | null>(null);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let assembled = 0;
    let withDeviation = 0;
    for (const row of rows) {
      const id = row._connectionId!;
      const s = statuses[id]?.status;
      if (s === 'assembled') assembled++;
      else if (s === 'assembled_with_deviation') { assembled++; withDeviation++; }
    }
    return { total: rows.length, assembled, withDeviation, pending: rows.length - assembled };
  }, [rows, statuses]);

  const pct = stats.total > 0 ? Math.round((stats.assembled / stats.total) * 100) : 0;

  // ── Filtered rows ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (statusFilter === 'all') return rows;
    return rows.filter((row) => {
      const s = statuses[row._connectionId!]?.status ?? 'pending';
      if (statusFilter === 'pending') return s === 'pending';
      if (statusFilter === 'assembled') return s === 'assembled';
      if (statusFilter === 'deviation') return s === 'assembled_with_deviation';
      return true;
    });
  }, [rows, statuses, statusFilter]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header bar */}
      <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center gap-4 shrink-0">
        {/* Progress */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-slate-700">
              {stats.assembled} / {stats.total} assembled
              {stats.withDeviation > 0 && (
                <span className="ml-2 text-amber-600">· {stats.withDeviation} with deviations</span>
              )}
            </span>
            <span className="text-xs font-bold text-slate-500">{pct}%</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pct}%`,
                background: stats.withDeviation > 0
                  ? 'linear-gradient(to right, #22c55e, #f59e0b)'
                  : '#22c55e',
              }}
            />
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex bg-slate-100 p-0.5 rounded-lg shrink-0">
          {([
            { id: 'all',       label: 'All',      count: stats.total },
            { id: 'pending',   label: 'Pending',  count: stats.pending },
            { id: 'assembled', label: 'Done',     count: stats.assembled - stats.withDeviation },
            { id: 'deviation', label: 'Deviation',count: stats.withDeviation },
          ] as { id: StatusFilter; label: string; count: number }[]).map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1 ${
                statusFilter === f.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {f.label}
              <span className={`text-[10px] px-1 rounded ${
                statusFilter === f.id ? 'bg-slate-100 text-slate-600' : 'bg-transparent'
              }`}>
                {f.count}
              </span>
            </button>
          ))}
        </div>

        {/* Save button */}
        <button
          onClick={onSave}
          disabled={!isDirty || isSaving}
          className="shrink-0 flex items-center gap-1.5 text-xs font-semibold bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          {isSaving ? (
            <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          )}
          {isDirty ? 'Save Status' : 'Saved'}
        </button>
      </div>

      {saveError && (
        <div className="bg-red-50 border-b border-red-100 px-5 py-2 text-xs text-red-600 font-medium shrink-0">
          {saveError}
        </div>
      )}

      {/* Connection list */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-3 flex flex-col gap-1.5">
        {filtered.length === 0 && (
          <div className="py-16 text-center text-slate-400 text-sm">
            No connections match this filter.
          </div>
        )}

        {filtered.map((row) => {
          const id = row._connectionId!;
          const s = statuses[id];
          const status = s?.status ?? 'pending';
          const isDeviationOpen = deviationOpenFor === id;

          return (
            <div key={id} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="flex items-start gap-3 px-3 py-2.5">

                {/* Checkbox */}
                <button
                  onClick={() => {
                    if (status === 'pending') {
                      markAssembled(id);
                    } else {
                      unmark(id);
                      if (isDeviationOpen) setDeviationOpenFor(null);
                    }
                  }}
                  className={`mt-0.5 shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                    status === 'pending'
                      ? 'border-slate-300 hover:border-green-400'
                      : status === 'assembled'
                      ? 'bg-green-500 border-green-500'
                      : 'bg-amber-500 border-amber-500'
                  }`}
                >
                  {status !== 'pending' && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  )}
                </button>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-slate-800 truncate">
                      {row.FunctionalWireName || id}
                    </span>
                    {row._subsystemLabel && (
                      <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-semibold shrink-0">
                        {row._subsystemLabel}
                      </span>
                    )}
                    {row.ArchitectureType && (
                      <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono shrink-0">
                        {row.ArchitectureType}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                    <span className="font-medium text-slate-600">{row.SourceComponent || '—'}</span>
                    <span className="mx-1 text-slate-400">→</span>
                    <span className="font-medium text-slate-600">{row.DestinationComponent || '—'}</span>
                    {row.WireSpecifications && (
                      <span className="ml-2 font-mono text-[10px] text-slate-400">{row.WireSpecifications}</span>
                    )}
                  </div>
                  {/* Deviation summary */}
                  {status === 'assembled_with_deviation' && s?.deviation && (
                    <div className="mt-1 text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1 border border-amber-200">
                      <span className="font-semibold">{s.deviation.field}:</span>
                      {' '}expected <span className="font-mono">{s.deviation.idealValue}</span>
                      {' '}· got <span className="font-mono">{s.deviation.actualValue}</span>
                      {s.deviation.reason && <span className="text-amber-500"> · {s.deviation.reason}</span>}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {status === 'pending' && (
                    <button
                      onClick={() => markAssembled(id)}
                      className="text-[11px] font-semibold text-green-600 hover:text-green-700 border border-green-200 hover:border-green-400 px-2 py-1 rounded transition-colors"
                    >
                      Mark Done
                    </button>
                  )}
                  {status !== 'pending' && (
                    <button
                      onClick={() => setDeviationOpenFor(isDeviationOpen ? null : id)}
                      className={`text-[11px] font-semibold px-2 py-1 rounded border transition-colors ${
                        status === 'assembled_with_deviation'
                          ? 'text-amber-600 border-amber-200 hover:border-amber-400'
                          : 'text-slate-500 border-slate-200 hover:text-amber-600 hover:border-amber-300'
                      }`}
                    >
                      {status === 'assembled_with_deviation' ? '⚠ Edit Deviation' : '⚠ Deviation'}
                    </button>
                  )}
                  {status === 'assembled_with_deviation' && (
                    <button
                      onClick={() => clearDeviation(id)}
                      className="text-[11px] text-slate-400 hover:text-slate-600 border border-slate-200 px-2 py-1 rounded transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Inline deviation form */}
              {isDeviationOpen && (
                <div className="px-3 pb-3">
                  <DeviationForm
                    row={row}
                    existing={s?.deviation}
                    onSave={(dev) => {
                      logDeviation(id, dev);
                      setDeviationOpenFor(null);
                    }}
                    onCancel={() => setDeviationOpenFor(null)}
                  />
                </div>
              )}
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
};
