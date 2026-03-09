
import React, { useState, useMemo } from 'react';
import { ConnectionRowExtended } from '../utils/jsonToConnectionRows';
import { AssemblyStateReturn } from '../hooks/useAssemblyState';
import { DeviationForm } from './DeviationForm';
import { NodeEntry } from '../services/github';

type StatusFilter = 'all' | 'pending' | 'assembled' | 'deviation';
type Section = 'wiring' | 'placement';

interface AssemblyTrackerProps {
  rows: ConnectionRowExtended[];
  assemblyState: AssemblyStateReturn;
  nodes: NodeEntry[];
  assemblyId: string | null;
  assemblyOptions: string[];
  onAssemblyChange: (id: string) => void;
  onSave: () => Promise<void>;
  isSaving: boolean;
  saveError: string | null;
  savedPrUrl: string | null;
}

export const AssemblyTracker: React.FC<AssemblyTrackerProps> = ({
  rows,
  assemblyState,
  nodes,
  assemblyId,
  assemblyOptions,
  onAssemblyChange,
  onSave,
  isSaving,
  saveError,
  savedPrUrl,
}) => {
  const { statuses, placements, isDirty, markAssembled, unmark, logDeviation, clearDeviation, markPlaced, unmarkPlaced } = assemblyState;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [section, setSection] = useState<Section>('wiring');
  const [deviationOpenFor, setDeviationOpenFor] = useState<string | null>(null);

  // ── Wiring stats ──────────────────────────────────────────────────────────
  const wiringStats = useMemo(() => {
    let assembled = 0, withDeviation = 0;
    for (const row of rows) {
      const s = statuses[row._connectionId!]?.status;
      if (s === 'assembled') assembled++;
      else if (s === 'assembled_with_deviation') { assembled++; withDeviation++; }
    }
    return { total: rows.length, assembled, withDeviation, pending: rows.length - assembled };
  }, [rows, statuses]);

  // ── Placement stats ───────────────────────────────────────────────────────
  const placementStats = useMemo(() => {
    const placed = nodes.filter(n => placements[n.nodeId]?.placed).length;
    return { total: nodes.length, placed, pending: nodes.length - placed };
  }, [nodes, placements]);

  const wiringPct = wiringStats.total > 0 ? Math.round((wiringStats.assembled / wiringStats.total) * 100) : 0;
  const placementPct = placementStats.total > 0 ? Math.round((placementStats.placed / placementStats.total) * 100) : 0;

  // ── Filtered wiring rows ──────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
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
      <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center gap-4 shrink-0 flex-wrap">
        {/* Assembly selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Assembly</span>
          <select
            value={assemblyId ?? ''}
            onChange={e => onAssemblyChange(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 text-slate-700 font-semibold"
          >
            {assemblyOptions.length === 0 && <option value="">— select branch first —</option>}
            {assemblyOptions.map(opt => (
              <option key={opt} value={opt}>Robot {opt}</option>
            ))}
          </select>
        </div>

        {/* Progress bars */}
        <div className="flex items-center gap-6 flex-1">
          {/* Wiring progress */}
          <div className="flex items-center gap-2 min-w-[180px]">
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider whitespace-nowrap">Wiring</span>
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden min-w-[80px]">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${wiringPct}%` }}
              />
            </div>
            <span className="text-[10px] font-bold text-slate-600 whitespace-nowrap">
              {wiringStats.assembled}/{wiringStats.total} ({wiringPct}%)
            </span>
          </div>
          {/* Placement progress */}
          <div className="flex items-center gap-2 min-w-[180px]">
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider whitespace-nowrap">Placed</span>
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden min-w-[80px]">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                style={{ width: `${placementPct}%` }}
              />
            </div>
            <span className="text-[10px] font-bold text-slate-600 whitespace-nowrap">
              {placementStats.placed}/{placementStats.total} ({placementPct}%)
            </span>
          </div>
        </div>

        {/* Save → PR button */}
        <button
          onClick={onSave}
          disabled={!isDirty || isSaving || !assemblyId}
          className={`ml-auto px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            isDirty && assemblyId
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          }`}
        >
          {isSaving ? 'Creating PR…' : 'Save → PR'}
        </button>
      </div>

      {saveError && (
        <div className="px-5 py-2 bg-red-50 border-b border-red-200 text-xs text-red-600 shrink-0">{saveError}</div>
      )}
      {savedPrUrl && (
        <div className="px-5 py-2 bg-emerald-50 border-b border-emerald-200 text-xs text-emerald-700 shrink-0 flex items-center gap-2">
          <span>✓ PR created:</span>
          <a href={savedPrUrl} target="_blank" rel="noopener noreferrer" className="underline font-semibold hover:text-emerald-900 truncate">{savedPrUrl}</a>
        </div>
      )}

      {/* Section tabs */}
      <div className="bg-white border-b border-slate-200 px-5 flex gap-1 shrink-0">
        {(['wiring', 'placement'] as Section[]).map(s => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors capitalize ${
              section === s
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {s === 'wiring' ? `Wiring (${wiringStats.assembled}/${wiringStats.total})` : `Placement (${placementStats.placed}/${placementStats.total})`}
          </button>
        ))}
      </div>

      {/* ── WIRING SECTION ── */}
      {section === 'wiring' && (
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Filter pills */}
          <div className="px-5 py-2 bg-white border-b border-slate-100 flex gap-2 shrink-0">
            {(['all', 'pending', 'assembled', 'deviation'] as StatusFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                  statusFilter === f
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {f === 'all' ? `All (${wiringStats.total})` :
                 f === 'pending' ? `Pending (${wiringStats.pending})` :
                 f === 'assembled' ? `Assembled (${wiringStats.assembled - wiringStats.withDeviation})` :
                 `Deviation (${wiringStats.withDeviation})`}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-10">Done</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Source</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Destination</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Wire</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-28">Status</th>
                  <th className="px-4 py-2 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map(row => {
                  const id = row._connectionId!;
                  const s = statuses[id];
                  const status = s?.status ?? 'pending';
                  const isAssembled = status === 'assembled' || status === 'assembled_with_deviation';
                  return (
                    <React.Fragment key={id}>
                      <tr className={`transition-colors ${
                        status === 'assembled' ? 'bg-emerald-50/40 hover:bg-emerald-50' :
                        status === 'assembled_with_deviation' ? 'bg-amber-50/40 hover:bg-amber-50' :
                        'bg-white hover:bg-slate-50'
                      }`}>
                        <td className="px-4 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={isAssembled}
                            onChange={() => isAssembled ? unmark(id) : markAssembled(id)}
                            className="accent-blue-500 w-4 h-4 cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-2 text-slate-700 font-medium">{row.SourceComponent || '—'}</td>
                        <td className="px-4 py-2 text-slate-700">{row.DestinationComponent || '—'}</td>
                        <td className="px-4 py-2 text-slate-500">{row.FunctionalWireName || '—'}</td>
                        <td className="px-4 py-2 text-slate-400">{row.ArchitectureType || '—'}</td>
                        <td className="px-4 py-2">
                          {status === 'pending' && <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">Pending</span>}
                          {status === 'assembled' && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Assembled</span>}
                          {status === 'assembled_with_deviation' && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Deviation</span>}
                        </td>
                        <td className="px-2 py-2">
                          {isAssembled && (
                            <button
                              onClick={() => setDeviationOpenFor(deviationOpenFor === id ? null : id)}
                              className="text-[10px] text-slate-400 hover:text-amber-600 transition-colors"
                              title="Log deviation"
                            >⚠</button>
                          )}
                        </td>
                      </tr>
                      {deviationOpenFor === id && (
                        <tr>
                          <td colSpan={7} className="px-4 py-2 bg-amber-50/60">
                            <DeviationForm
                              existing={s?.deviation}
                              onSave={(dev) => { logDeviation(id, dev); setDeviationOpenFor(null); }}
                              onClear={() => { clearDeviation(id); setDeviationOpenFor(null); }}
                              onCancel={() => setDeviationOpenFor(null)}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {filteredRows.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No connections match this filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── PLACEMENT SECTION ── */}
      {section === 'placement' && (
        <div className="flex-1 overflow-y-auto">
          {nodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
              <p className="text-sm">No component nodes found for this branch.</p>
              <p className="text-xs">Nodes are loaded from nodes/*.json in the data repo.</p>
            </div>
          ) : (
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-10">Placed</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Component</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Subsystem</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Compartment</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-28">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {nodes.map(node => {
                  const p = placements[node.nodeId];
                  const isPlaced = p?.placed === true;
                  return (
                    <tr
                      key={node.nodeId}
                      className={`transition-colors ${isPlaced ? 'bg-emerald-50/40 hover:bg-emerald-50' : 'bg-white hover:bg-slate-50'}`}
                    >
                      <td className="px-4 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isPlaced}
                          onChange={() => isPlaced ? unmarkPlaced(node.nodeId) : markPlaced(node.nodeId)}
                          className="accent-emerald-500 w-4 h-4 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-2 text-slate-700 font-medium">{node.nodeId}</td>
                      <td className="px-4 py-2 text-slate-500 capitalize">{node.subsystem}</td>
                      <td className="px-4 py-2 text-slate-400">{node.compartment || '—'}</td>
                      <td className="px-4 py-2">
                        {isPlaced
                          ? <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Placed</span>
                          : <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">Pending</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};
