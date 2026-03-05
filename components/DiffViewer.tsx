
import React, { useEffect, useState, useCallback } from 'react';
import { listBranches, loadAllSubsystems, BranchInfo, getToken } from '../services/github';
import { allSubsystemsToRows } from '../utils/jsonToConnectionRows';
import { diffConnections, DiffResult, DiffEntry, DiffType } from '../utils/diffConnections';

const SUBSYSTEM_LABEL_MAP: Record<string, string> = {
  moma:      'MoMa',
  mapper:    'Handheld Mapper',
  sander:    'Tools Sander',
  sprayer:   'Tools Sprayer',
  opStation: 'Operation Station',
};

type FilterType = 'all' | DiffType;

function diffTypeStyle(type: DiffType) {
  switch (type) {
    case 'added':    return { badge: 'bg-green-100 text-green-700',  row: 'bg-green-50 border-green-200',  icon: '✚', iconColor: 'text-green-600' };
    case 'removed':  return { badge: 'bg-red-100 text-red-700',    row: 'bg-red-50 border-red-200',    icon: '✕', iconColor: 'text-red-500'   };
    case 'modified': return { badge: 'bg-amber-100 text-amber-700', row: 'bg-amber-50 border-amber-200', icon: '●', iconColor: 'text-amber-500' };
  }
}

function rowSummary(entry: DiffEntry): string {
  const row = entry.compareRow ?? entry.baseRow;
  if (!row) return entry.connectionId;
  const parts: string[] = [];
  if (row.ArchitectureType) parts.push(row.ArchitectureType);
  if (row.FunctionalWireName) parts.push(row.FunctionalWireName);
  if (row.SourceComponent && row.DestinationComponent)
    parts.push(`${row.SourceComponent} → ${row.DestinationComponent}`);
  return parts.join('  ·  ') || entry.connectionId;
}

export const DiffViewer: React.FC = () => {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [baseBranch, setBaseBranch] = useState('');
  const [compareBranch, setCompareBranch] = useState('');
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Load branches on mount (only if token exists)
  useEffect(() => {
    if (!getToken()) return;
    listBranches()
      .then(setBranches)
      .catch((e) => setBranchesError(e.message || 'Failed to load branches'));
  }, []);

  const handleCompare = useCallback(async () => {
    if (!baseBranch || !compareBranch) return;
    setIsLoading(true);
    setError(null);
    setDiffResult(null);
    setExpandedIds(new Set());
    setFilter('all');

    try {
      const [baseResult, compareResult] = await Promise.all([
        loadAllSubsystems(baseBranch),
        loadAllSubsystems(compareBranch),
      ]);
      const baseRows = allSubsystemsToRows(baseResult.subsystems, SUBSYSTEM_LABEL_MAP);
      const compareRows = allSubsystemsToRows(compareResult.subsystems, SUBSYSTEM_LABEL_MAP);
      setDiffResult(diffConnections(baseRows, compareRows));
    } catch (e: any) {
      setError(e.message || 'Failed to load subsystem data');
    } finally {
      setIsLoading(false);
    }
  }, [baseBranch, compareBranch]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Group filtered entries by subsystem
  const filteredEntries = diffResult
    ? (filter === 'all' ? diffResult.entries : diffResult.entries.filter((e) => e.type === filter))
    : [];

  const grouped = filteredEntries.reduce<Map<string, DiffEntry[]>>((acc, entry) => {
    const key = entry.subsystemLabel || entry.subsystem || 'Unknown';
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key)!.push(entry);
    return acc;
  }, new Map());

  const isUnauthenticated = !getToken();

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Branch selectors */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-500 whitespace-nowrap">Base</label>
          <select
            value={baseBranch}
            onChange={(e) => setBaseBranch(e.target.value)}
            disabled={isUnauthenticated || branches.length === 0}
            className="text-xs font-semibold border border-slate-300 rounded-md px-2 py-1.5 bg-white text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm hover:border-blue-400 transition-colors min-w-[160px] disabled:opacity-50"
          >
            <option value="">Select branch…</option>
            {branches.map((b) => (
              <option key={b.name} value={b.name}>{b.name}</option>
            ))}
          </select>
        </div>

        <div className="text-slate-300 font-light text-lg">→</div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-500 whitespace-nowrap">Compare</label>
          <select
            value={compareBranch}
            onChange={(e) => setCompareBranch(e.target.value)}
            disabled={isUnauthenticated || branches.length === 0}
            className="text-xs font-semibold border border-slate-300 rounded-md px-2 py-1.5 bg-white text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm hover:border-blue-400 transition-colors min-w-[160px] disabled:opacity-50"
          >
            <option value="">Select branch…</option>
            {branches.map((b) => (
              <option key={b.name} value={b.name}>{b.name}</option>
            ))}
          </select>
        </div>

        <button
          onClick={handleCompare}
          disabled={!baseBranch || !compareBranch || isLoading || baseBranch === compareBranch}
          className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isLoading ? (
            <>
              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Comparing…
            </>
          ) : (
            'Compare →'
          )}
        </button>

        {branchesError && (
          <span className="text-xs text-red-500">{branchesError}</span>
        )}
      </div>

      {/* Summary bar */}
      {diffResult && (
        <div className="bg-white border-b border-slate-200 px-6 py-2 flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-3 text-xs font-semibold">
            <span className="text-green-600">+{diffResult.added} added</span>
            <span className="text-red-500">-{diffResult.removed} removed</span>
            <span className="text-amber-600">~{diffResult.modified} modified</span>
            {diffResult.entries.length === 0 && (
              <span className="text-slate-400 font-normal ml-2">No differences found.</span>
            )}
          </div>
          <div className="flex items-center gap-1 ml-auto">
            {(['all', 'added', 'removed', 'modified'] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all capitalize ${
                  filter === f
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                }`}
              >
                {f === 'all'
                  ? `All (${diffResult.entries.length})`
                  : f === 'added'
                  ? `Added (${diffResult.added})`
                  : f === 'removed'
                  ? `Removed (${diffResult.removed})`
                  : `Modified (${diffResult.modified})`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">

        {/* Unauthenticated state */}
        {isUnauthenticated && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <p className="text-sm font-medium text-slate-500">Connect with a GitHub PAT to compare branches</p>
          </div>
        )}

        {/* Initial state */}
        {!isUnauthenticated && !diffResult && !isLoading && !error && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
              <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/>
            </svg>
            <p className="text-sm font-medium text-slate-500">Select two branches and click Compare</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-4 max-w-xl mx-auto mt-8">
            {error}
          </div>
        )}

        {/* Diff results */}
        {diffResult && filteredEntries.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
            <p className="text-sm">No {filter !== 'all' ? filter : ''} changes to show.</p>
          </div>
        )}

        {diffResult && grouped.size > 0 && (
          <div className="flex flex-col gap-6 max-w-5xl">
            {Array.from(grouped.entries()).map(([subsystemLabel, entries]) => (
              <div key={subsystemLabel}>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                  {subsystemLabel}
                  <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                    {entries.length} change{entries.length !== 1 ? 's' : ''}
                  </span>
                </h3>
                <div className="flex flex-col gap-1.5">
                  {entries.map((entry) => {
                    const style = diffTypeStyle(entry.type);
                    const isExpanded = expandedIds.has(entry.connectionId);
                    const summary = rowSummary(entry);

                    return (
                      <div
                        key={entry.connectionId}
                        className={`border rounded-lg overflow-hidden ${style.row}`}
                      >
                        <button
                          className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:brightness-95 transition-all"
                          onClick={() => entry.type === 'modified' && toggleExpand(entry.connectionId)}
                        >
                          <span className={`font-bold text-base leading-none ${style.iconColor}`}>
                            {style.icon}
                          </span>
                          <span className="font-mono text-xs text-slate-500 shrink-0">{entry.connectionId}</span>
                          <span className="text-xs text-slate-700 truncate flex-1">{summary}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize shrink-0 ${style.badge}`}>
                            {entry.type}
                          </span>
                          {entry.type === 'modified' && (
                            <span className="text-slate-400 text-xs shrink-0">
                              {isExpanded ? '▲' : '▼'}
                            </span>
                          )}
                        </button>

                        {entry.type === 'modified' && isExpanded && entry.changes && (
                          <div className="border-t border-amber-200 bg-white">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-slate-50 border-b border-slate-100">
                                  <th className="text-left px-4 py-1.5 font-semibold text-slate-500 w-40">Field</th>
                                  <th className="text-left px-4 py-1.5 font-semibold text-red-500">Base ({baseBranch})</th>
                                  <th className="text-left px-4 py-1.5 font-semibold text-green-600">Compare ({compareBranch})</th>
                                </tr>
                              </thead>
                              <tbody>
                                {entry.changes.map((change) => (
                                  <tr key={change.field} className="border-b border-slate-50 last:border-0">
                                    <td className="px-4 py-1.5 text-slate-500 font-medium">{change.label}</td>
                                    <td className="px-4 py-1.5 font-mono text-red-600 bg-red-50">
                                      {change.base || <span className="text-slate-300 italic">empty</span>}
                                    </td>
                                    <td className="px-4 py-1.5 font-mono text-green-700 bg-green-50">
                                      {change.compare || <span className="text-slate-300 italic">empty</span>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
