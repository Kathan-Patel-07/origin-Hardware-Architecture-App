
import React, { useEffect, useState, useCallback } from 'react';
import { listBranches, loadAllSubsystems, loadAllCatalogItems, getRobotMeta, BranchInfo, CatalogItem, getToken } from '../services/github';
import { allSubsystemsToRows } from '../utils/jsonToConnectionRows';
import { diffConnections, DiffResult, DiffEntry, DiffType } from '../utils/diffConnections';

// ── Catalog diff types ────────────────────────────────────────────────────────
const CATALOG_FIELDS: { key: keyof CatalogItem; label: string }[] = [
  { key: 'partName',           label: 'Part Name'        },
  { key: 'category',           label: 'Category'         },
  { key: 'datasheetUrl',       label: 'Datasheet URL'    },
  { key: 'purchaseLink',       label: 'Purchase Link'    },
  { key: 'averagePower',       label: 'Avg Power'        },
  { key: 'maxContinuousPower', label: 'Max Power'        },
  { key: 'peakPower',          label: 'Peak Power'       },
  { key: 'specRef',            label: 'Spec Ref'         },
];

interface CatalogFieldChange { field: string; label: string; base: string; compare: string; }
interface CatalogDiffEntry {
  type: DiffType;
  partId: string;
  baseItem?: CatalogItem;
  compareItem?: CatalogItem;
  changes?: CatalogFieldChange[];
}
interface CatalogDiffResult { entries: CatalogDiffEntry[]; added: number; removed: number; modified: number; }

function diffCatalog(base: CatalogItem[], compare: CatalogItem[]): CatalogDiffResult {
  const baseMap = new Map(base.map((i) => [i.partId, i]));
  const compareMap = new Map(compare.map((i) => [i.partId, i]));
  const allIds = new Set([...baseMap.keys(), ...compareMap.keys()]);
  const entries: CatalogDiffEntry[] = [];
  let added = 0, removed = 0, modified = 0;

  for (const id of allIds) {
    const b = baseMap.get(id);
    const c = compareMap.get(id);
    if (!b && c) { added++; entries.push({ type: 'added', partId: id, compareItem: c }); }
    else if (b && !c) { removed++; entries.push({ type: 'removed', partId: id, baseItem: b }); }
    else if (b && c) {
      const changes: CatalogFieldChange[] = [];
      for (const { key, label } of CATALOG_FIELDS) {
        const bv = String(b[key] ?? ''), cv = String(c[key] ?? '');
        if (bv !== cv) changes.push({ field: key as string, label, base: bv, compare: cv });
      }
      if (changes.length) { modified++; entries.push({ type: 'modified', partId: id, baseItem: b, compareItem: c, changes }); }
    }
  }
  entries.sort((a, b) => a.partId.localeCompare(b.partId));
  return { entries, added, removed, modified };
}

// ── Branch loaders ────────────────────────────────────────────────────────────
async function loadBranchRows(branch: string) {
  let subsystemKeys: string[] | undefined;
  try {
    const meta = await getRobotMeta(branch);
    if (meta.subsystems?.length) subsystemKeys = meta.subsystems;
  } catch { /* optional */ }
  const { subsystems } = await loadAllSubsystems(branch, subsystemKeys);
  const labelMap: Record<string, string> = {};
  for (const s of subsystems) labelMap[s.key] = s.name ?? s.key;
  return allSubsystemsToRows(subsystems, labelMap);
}

async function loadBranchCatalog(branch: string): Promise<CatalogItem[]> {
  try { return (await loadAllCatalogItems(branch)).items; } catch { return []; }
}

// ── Shared style helpers ──────────────────────────────────────────────────────
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

// ── FieldDiffTable (shared between connections + catalog) ─────────────────────
const FieldDiffTable: React.FC<{
  changes: { field: string; label: string; base: string; compare: string }[];
  baseBranch: string;
  compareBranch: string;
}> = ({ changes, baseBranch, compareBranch }) => (
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
        {changes.map((change) => (
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
);

// ── Main component ────────────────────────────────────────────────────────────
export const DiffViewer: React.FC = () => {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [baseBranch, setBaseBranch] = useState('');
  const [compareBranch, setCompareBranch] = useState('');
  const [connDiff, setConnDiff] = useState<DiffResult | null>(null);
  const [catalogDiff, setCatalogDiff] = useState<CatalogDiffResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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
    setConnDiff(null);
    setCatalogDiff(null);
    setExpandedIds(new Set());
    setFilter('all');

    try {
      const [baseRows, compareRows, baseCatalog, compareCatalog] = await Promise.all([
        loadBranchRows(baseBranch),
        loadBranchRows(compareBranch),
        loadBranchCatalog(baseBranch),
        loadBranchCatalog(compareBranch),
      ]);
      setConnDiff(diffConnections(baseRows, compareRows));
      setCatalogDiff(diffCatalog(baseCatalog, compareCatalog));
    } catch (e: any) {
      setError(e.message || 'Failed to load data');
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

  // Combined totals
  const totalAdded    = (connDiff?.added    ?? 0) + (catalogDiff?.added    ?? 0);
  const totalRemoved  = (connDiff?.removed  ?? 0) + (catalogDiff?.removed  ?? 0);
  const totalModified = (connDiff?.modified ?? 0) + (catalogDiff?.modified ?? 0);
  const hasResults = connDiff !== null || catalogDiff !== null;

  const filteredConnEntries = connDiff
    ? (filter === 'all' ? connDiff.entries : connDiff.entries.filter((e) => e.type === filter))
    : [];

  const filteredCatalogEntries = catalogDiff
    ? (filter === 'all' ? catalogDiff.entries : catalogDiff.entries.filter((e) => e.type === filter))
    : [];

  const groupedConns = filteredConnEntries.reduce<Map<string, DiffEntry[]>>((acc, entry) => {
    const key = entry.subsystemLabel || entry.subsystem || 'Unknown';
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key)!.push(entry);
    return acc;
  }, new Map());

  const isUnauthenticated = !getToken();

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
            {branches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
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
            {branches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
          </select>
        </div>

        <button
          onClick={handleCompare}
          disabled={!baseBranch || !compareBranch || isLoading || baseBranch === compareBranch}
          className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isLoading ? (
            <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Comparing…</>
          ) : 'Compare →'}
        </button>

        {branchesError && <span className="text-xs text-red-500">{branchesError}</span>}
      </div>

      {/* Summary bar */}
      {hasResults && (
        <div className="bg-white border-b border-slate-200 px-6 py-2 flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-3 text-xs font-semibold">
            <span className="text-green-600">+{totalAdded} added</span>
            <span className="text-red-500">-{totalRemoved} removed</span>
            <span className="text-amber-600">~{totalModified} modified</span>
            {totalAdded + totalRemoved + totalModified === 0 && (
              <span className="text-slate-400 font-normal ml-2">No differences found.</span>
            )}
          </div>
          <div className="flex items-center gap-1 ml-auto">
            {(['all', 'added', 'removed', 'modified'] as FilterType[]).map((f) => {
              const count = f === 'all'
                ? totalAdded + totalRemoved + totalModified
                : f === 'added' ? totalAdded : f === 'removed' ? totalRemoved : totalModified;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all capitalize ${
                    filter === f ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {f === 'all' ? `All (${count})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${count})`}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">

        {isUnauthenticated && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <p className="text-sm font-medium text-slate-500">Connect with a GitHub PAT to compare branches</p>
          </div>
        )}

        {!isUnauthenticated && !hasResults && !isLoading && !error && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
              <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/>
            </svg>
            <p className="text-sm font-medium text-slate-500">Select two branches and click Compare</p>
          </div>
        )}

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-4 max-w-xl mx-auto mt-8">{error}</div>
        )}

        {hasResults && totalAdded + totalRemoved + totalModified === 0 && !error && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
            <p className="text-sm">No {filter !== 'all' ? filter : ''} changes to show.</p>
          </div>
        )}

        {hasResults && (filteredConnEntries.length > 0 || filteredCatalogEntries.length > 0) && (
          <div className="flex flex-col gap-8 max-w-5xl">

            {/* ── Catalog changes ── */}
            {filteredCatalogEntries.length > 0 && (
              <div>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
                  Catalog
                  <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                    {filteredCatalogEntries.length} change{filteredCatalogEntries.length !== 1 ? 's' : ''}
                  </span>
                </h2>
                <div className="flex flex-col gap-1.5">
                  {filteredCatalogEntries.map((entry) => {
                    const style = diffTypeStyle(entry.type);
                    const isExpanded = expandedIds.has(`cat-${entry.partId}`);
                    const displayName = (entry.compareItem ?? entry.baseItem)?.partName || entry.partId;
                    return (
                      <div key={entry.partId} className={`border rounded-lg overflow-hidden ${style.row}`}>
                        <button
                          className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:brightness-95 transition-all"
                          onClick={() => entry.type === 'modified' && toggleExpand(`cat-${entry.partId}`)}
                        >
                          <span className={`font-bold text-base leading-none ${style.iconColor}`}>{style.icon}</span>
                          <span className="font-mono text-xs text-slate-500 shrink-0">{entry.partId}</span>
                          <span className="text-xs text-slate-700 truncate flex-1">{displayName}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize shrink-0 ${style.badge}`}>{entry.type}</span>
                          {entry.type === 'modified' && (
                            <span className="text-slate-400 text-xs shrink-0">{isExpanded ? '▲' : '▼'}</span>
                          )}
                        </button>
                        {entry.type === 'modified' && isExpanded && entry.changes && (
                          <FieldDiffTable changes={entry.changes} baseBranch={baseBranch} compareBranch={compareBranch} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Connection changes ── */}
            {groupedConns.size > 0 && (
              <div>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 16.98h-5.99c-1.1 0-1.95.68-2.23 1.62l-.3 1.08c-.38 1.38-.88 2.32-2.48 2.32H5"/><path d="M6 7H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2"/><rect width="10" height="14" x="8" y="5" rx="2"/></svg>
                  Connections
                  <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                    {filteredConnEntries.length} change{filteredConnEntries.length !== 1 ? 's' : ''}
                  </span>
                </h2>
                <div className="flex flex-col gap-6">
                  {Array.from(groupedConns.entries()).map(([subsystemLabel, entries]) => (
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
                          return (
                            <div key={entry.connectionId} className={`border rounded-lg overflow-hidden ${style.row}`}>
                              <button
                                className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:brightness-95 transition-all"
                                onClick={() => entry.type === 'modified' && toggleExpand(entry.connectionId)}
                              >
                                <span className={`font-bold text-base leading-none ${style.iconColor}`}>{style.icon}</span>
                                <span className="font-mono text-xs text-slate-500 shrink-0">{entry.connectionId}</span>
                                <span className="text-xs text-slate-700 truncate flex-1">{rowSummary(entry)}</span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize shrink-0 ${style.badge}`}>{entry.type}</span>
                                {entry.type === 'modified' && (
                                  <span className="text-slate-400 text-xs shrink-0">{isExpanded ? '▲' : '▼'}</span>
                                )}
                              </button>
                              {entry.type === 'modified' && isExpanded && entry.changes && (
                                <FieldDiffTable changes={entry.changes} baseBranch={baseBranch} compareBranch={compareBranch} />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
};
