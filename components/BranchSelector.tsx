
import React, { useEffect, useState, useMemo } from 'react';
import { listBranches, BranchInfo } from '../services/github';

interface BranchSelectorProps {
  selectedBranch: string | null;
  onBranchSelect: (branch: string) => void;
  onDisconnect: () => void;
}

// Group branches by version prefix: v2, v2.1, v3, etc.
function groupBranches(branches: BranchInfo[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  const ungrouped: string[] = [];

  for (const b of branches) {
    const match = b.name.match(/^(v\d+(?:\.\d+)?)/i);
    if (match) {
      const key = match[1].toLowerCase();
      if (!groups[key]) groups[key] = [];
      groups[key].push(b.name);
    } else {
      ungrouped.push(b.name);
    }
  }

  // Sort version groups numerically
  const sorted: Record<string, string[]> = {};
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    const [aMaj, aMin = '0'] = a.slice(1).split('.');
    const [bMaj, bMin = '0'] = b.slice(1).split('.');
    const diff = Number(aMaj) - Number(bMaj);
    return diff !== 0 ? diff : Number(aMin) - Number(bMin);
  });
  for (const k of sortedKeys) {
    sorted[k] = groups[k].sort();
  }
  if (ungrouped.length) sorted['other'] = ungrouped.sort();

  return sorted;
}

export const BranchSelector: React.FC<BranchSelectorProps> = ({
  selectedBranch,
  onBranchSelect,
  onDisconnect,
}) => {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBranches = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listBranches();
      setBranches(result);
    } catch (e: any) {
      setError(e.message || 'Failed to load branches.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  const grouped = useMemo(() => groupBranches(branches), [branches]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
          Architecture Branch
        </label>
        <button
          onClick={onDisconnect}
          className="text-[10px] text-slate-400 hover:text-red-500 transition-colors font-medium"
          title="Disconnect and clear token"
        >
          Disconnect
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-slate-400 py-1">
          <div className="w-3 h-3 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin" />
          Loading branches…
        </div>
      )}

      {error && (
        <div className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-100">
          {error}
          <button onClick={fetchBranches} className="ml-2 underline text-red-700">Retry</button>
        </div>
      )}

      {!isLoading && !error && branches.length === 0 && (
        <p className="text-xs text-slate-400">No branches found in the data repo.</p>
      )}

      {!isLoading && branches.length > 0 && (
        <>
          <select
            value={selectedBranch ?? ''}
            onChange={(e) => e.target.value && onBranchSelect(e.target.value)}
            className="w-full text-xs border border-slate-300 rounded-lg px-2 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none text-slate-900 bg-white font-medium shadow-sm"
          >
            <option value="" disabled>
              Select a branch…
            </option>
            {Object.entries(grouped).map(([group, names]) => (
              <optgroup key={group} label={group === 'other' ? 'Other' : group.toUpperCase()}>
                {names.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          {selectedBranch && (
            <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              {selectedBranch}
            </div>
          )}

          <button
            onClick={fetchBranches}
            className="text-[10px] text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors self-start"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
              <path d="M21 3v5h-5"/>
            </svg>
            Refresh branches
          </button>
        </>
      )}
    </div>
  );
};
