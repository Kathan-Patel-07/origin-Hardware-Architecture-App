
import React, { useState, useMemo, useCallback } from 'react';
import { CSV_HEADER } from './constants';
import { parseCSV } from './services/csvParser';
import { clearToken, getRobotMeta, loadAllSubsystems, RobotMeta, SubsystemJSON } from './services/github';
import { GuideViewer } from './components/GuideViewer';
import { AnalysisViewer } from './components/AnalysisViewer';
import { AuthGate } from './components/AuthGate';
import { BranchSelector } from './components/BranchSelector';
import { ConnectionRow } from './types';
import { allSubsystemsToRows, ConnectionRowExtended } from './utils/jsonToConnectionRows';

// ── Data source mode ──────────────────────────────────────────────────────────
type DataMode = 'github' | 'csv';

// Subsystem display config — order matches the feature spec
const SUBSYSTEM_TABS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'moma', label: 'MoMa' },
  { key: 'mapper', label: 'Handheld Mapper' },
  { key: 'sander', label: 'Tools Sander' },
  { key: 'sprayer', label: 'Tools Sprayer' },
  { key: 'opStation', label: 'Operation Station' },
];

const SUBSYSTEM_LABEL_MAP: Record<string, string> = Object.fromEntries(
  SUBSYSTEM_TABS.filter((t) => t.key !== 'all').map((t) => [t.key, t.label])
);

const App: React.FC = () => {
  // ── Mode ─────────────────────────────────────────────────────────────────────
  const [dataMode, setDataMode] = useState<DataMode>('github');

  // ── GitHub state ──────────────────────────────────────────────────────────────
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [robotMeta, setRobotMeta] = useState<RobotMeta | null>(null);

  // Loaded subsystems (raw JSON)
  const [subsystems, setSubsystems] = useState<SubsystemJSON[]>([]);
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [dataLoadError, setDataLoadError] = useState<string | null>(null);

  // Subsystem tab filter (GitHub mode)
  const [activeSubsystem, setActiveSubsystem] = useState<string>('all');

  // ── CSV legacy state ──────────────────────────────────────────────────────────
  const [csvContent, setCsvContent] = useState<string>(CSV_HEADER);

  // ── Shared UI state ───────────────────────────────────────────────────────────
  const [compartmentFilter, setCompartmentFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'guide'>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // ── Branch loading ─────────────────────────────────────────────────────────────
  const handleBranchSelect = useCallback(async (branch: string) => {
    setSelectedBranch(branch);
    setRobotMeta(null);
    setSubsystems([]);
    setLoadErrors({});
    setDataLoadError(null);
    setActiveSubsystem('all');
    setIsDataLoading(true);

    try {
      // 1. Try to get robot.json for subsystem list
      let subsystemKeys: string[] | undefined;
      try {
        const meta = await getRobotMeta(branch);
        setRobotMeta(meta);
        subsystemKeys = meta.subsystems?.length ? meta.subsystems : undefined;
      } catch {
        // robot.json is optional — fall back to defaults
      }

      // 2. Load all subsystems
      const { subsystems: loaded, errors } = await loadAllSubsystems(branch, subsystemKeys);
      setSubsystems(loaded);
      setLoadErrors(errors);

      if (loaded.length === 0) {
        setDataLoadError('No subsystem files found on this branch. Expected subsystems/{name}.json.');
      }
    } catch (e: any) {
      setDataLoadError(e.message || 'Failed to load data from branch.');
    } finally {
      setIsDataLoading(false);
    }
  }, []);

  const handleDisconnect = () => {
    clearToken();
    setIsAuthenticated(false);
    setSelectedBranch(null);
    setRobotMeta(null);
    setSubsystems([]);
    setLoadErrors({});
    setDataLoadError(null);
  };

  // ── Data derivation ───────────────────────────────────────────────────────────

  // All rows from all loaded subsystems
  const allRows = useMemo<ConnectionRowExtended[]>(
    () => allSubsystemsToRows(subsystems, SUBSYSTEM_LABEL_MAP),
    [subsystems]
  );

  // Rows filtered to active subsystem tab
  const subsystemFilteredRows = useMemo<ConnectionRowExtended[]>(() => {
    if (activeSubsystem === 'all') return allRows;
    return allRows.filter((r) => r._subsystem === activeSubsystem);
  }, [allRows, activeSubsystem]);

  // Flag counts per subsystem (for tab badges)
  const flagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of allRows) {
      const key = row._subsystem ?? '';
      if (row._flagged) counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [allRows]);

  const totalFlags = useMemo(
    () => Object.values(flagCounts).reduce((a, b) => a + b, 0),
    [flagCounts]
  );

  // Available compartments from current subsystem view
  const availableCompartments = useMemo(() => {
    const set = new Set<string>();
    subsystemFilteredRows.forEach((row) => {
      if (row.SourceComponentCompartment) set.add(row.SourceComponentCompartment.trim());
      if (row.DestinationComponentCompartment) set.add(row.DestinationComponentCompartment.trim());
    });
    return Array.from(set).filter(Boolean).sort();
  }, [subsystemFilteredRows]);

  // Final data after compartment filter
  const finalRows = useMemo<ConnectionRow[]>(() => {
    if (compartmentFilter === 'all') return subsystemFilteredRows;
    return subsystemFilteredRows.filter(
      (row) =>
        row.SourceComponentCompartment?.trim() === compartmentFilter ||
        row.DestinationComponentCompartment?.trim() === compartmentFilter
    );
  }, [subsystemFilteredRows, compartmentFilter]);

  // ── CSV legacy ────────────────────────────────────────────────────────────────
  const csvParsed = useMemo(() => parseCSV(csvContent), [csvContent]);

  const csvCompartments = useMemo(() => {
    const set = new Set<string>();
    csvParsed.forEach((row) => {
      if (row.SourceComponentCompartment) set.add(row.SourceComponentCompartment.trim());
      if (row.DestinationComponentCompartment) set.add(row.DestinationComponentCompartment.trim());
    });
    return Array.from(set).filter(Boolean).sort();
  }, [csvParsed]);

  const csvFiltered = useMemo<ConnectionRow[]>(() => {
    if (compartmentFilter === 'all') return csvParsed;
    return csvParsed.filter(
      (row) =>
        row.SourceComponentCompartment?.trim() === compartmentFilter ||
        row.DestinationComponentCompartment?.trim() === compartmentFilter
    );
  }, [csvParsed, compartmentFilter]);

  const displayData = dataMode === 'github' ? finalRows : csvFiltered;
  const displayCompartments = dataMode === 'github' ? availableCompartments : csvCompartments;

  const handleDownloadCSV = () => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', 'origin_architecture.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ── Sidebar ───────────────────────────────────────────────────────────────────
  const renderSidebarContent = () => {
    if (dataMode === 'github') {
      return (
        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Data Source
            </label>
            <button
              onClick={() => setDataMode('csv')}
              className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
            >
              Use CSV instead
            </button>
          </div>

          {!isAuthenticated ? (
            <AuthGate onAuthenticated={() => setIsAuthenticated(true)} />
          ) : (
            <BranchSelector
              selectedBranch={selectedBranch}
              onBranchSelect={handleBranchSelect}
              onDisconnect={handleDisconnect}
            />
          )}

          {/* Loading state */}
          {isDataLoading && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <div className="w-3 h-3 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin" />
              Loading subsystem data…
            </div>
          )}

          {/* Data load error */}
          {dataLoadError && !isDataLoading && (
            <div className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-100">
              {dataLoadError}
            </div>
          )}

          {/* Per-subsystem load errors */}
          {Object.keys(loadErrors).length > 0 && !isDataLoading && (
            <div className="text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-100 flex flex-col gap-1">
              <span className="font-semibold">Some subsystems failed to load:</span>
              {Object.entries(loadErrors).map(([key, msg]) => (
                <span key={key} className="font-mono text-[10px]">{key}: {msg}</span>
              ))}
            </div>
          )}

          {/* Robot metadata card */}
          {robotMeta && (
            <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">{robotMeta.name}</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  robotMeta.type === 'robot'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-amber-100 text-amber-700'
                }`}>
                  {robotMeta.type}
                </span>
              </div>
              {robotMeta.version && (
                <div className="text-[10px] text-slate-400 font-mono">{robotMeta.version}</div>
              )}
              {robotMeta.subsystems?.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {robotMeta.subsystems.map((s) => (
                    <span key={s} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Data summary */}
          {subsystems.length > 0 && !isDataLoading && (
            <div className="text-[10px] text-slate-400 flex gap-3">
              <span>{subsystems.length} subsystem{subsystems.length !== 1 ? 's' : ''} loaded</span>
              <span>{allRows.length} connections</span>
              {totalFlags > 0 && (
                <span className="text-amber-500 font-semibold">{totalFlags} flagged</span>
              )}
            </div>
          )}
        </div>
      );
    }

    // CSV legacy mode
    return (
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            CSV Import (Legacy)
          </label>
          <button
            onClick={() => setDataMode('github')}
            className="text-[10px] text-blue-500 hover:text-blue-700 transition-colors font-medium"
          >
            Switch to GitHub
          </button>
        </div>
        <input
          type="file"
          accept=".csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => setCsvContent((ev.target?.result as string) ?? CSV_HEADER);
            reader.readAsText(file);
          }}
          className="text-xs text-slate-600 file:mr-2 file:text-xs file:font-semibold file:border-0 file:bg-blue-50 file:text-blue-700 file:rounded file:px-2 file:py-1 hover:file:bg-blue-100 cursor-pointer"
        />
        <button
          onClick={handleDownloadCSV}
          className="flex items-center justify-center gap-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
          Export CSV
        </button>
      </div>
    );
  };

  // ── Subsystem tabs (GitHub mode only) ─────────────────────────────────────────
  const renderSubsystemTabs = () => {
    if (dataMode !== 'github' || subsystems.length === 0) return null;

    // Only show tabs for subsystems that actually loaded + "All"
    const loadedKeys = new Set(subsystems.map((s) => s.key));
    const visibleTabs = SUBSYSTEM_TABS.filter(
      (t) => t.key === 'all' || loadedKeys.has(t.key)
    );

    return (
      <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-4 overflow-x-auto shrink-0">
        {visibleTabs.map((tab) => {
          const flags = tab.key === 'all' ? totalFlags : (flagCounts[tab.key] ?? 0);
          const isActive = activeSubsystem === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => { setActiveSubsystem(tab.key); setCompartmentFilter('all'); }}
              className={`px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-all flex items-center gap-1.5 ${
                isActive
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              {tab.label}
              {flags > 0 && (
                <span className={`text-[10px] font-bold px-1 rounded ${
                  isActive ? 'bg-amber-100 text-amber-600' : 'bg-amber-50 text-amber-500'
                }`}>
                  {flags} ⚠
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-screen overflow-hidden font-sans bg-slate-50 text-slate-900">

      {/* Sidebar */}
      <div
        className={`flex-shrink-0 border-r border-slate-200 bg-white transition-all duration-300 ease-in-out flex flex-col shadow-xl z-20 ${
          isSidebarOpen ? 'w-[380px] translate-x-0' : 'w-0 -translate-x-full opacity-0'
        } overflow-hidden`}
      >
        <div className="p-6 border-b border-slate-100 flex flex-col gap-6 h-full">
          <div className="flex justify-between items-center shrink-0">
            <h1 className="font-bold text-lg text-slate-800 tracking-tight leading-tight">
              Origin Hardware<br />Architecture Studio
            </h1>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
          </div>

          <div className="flex-1 flex flex-col gap-4 overflow-y-auto min-h-0 pr-2 -mr-2">
            {renderSidebarContent()}
            <div className="mt-auto shrink-0">
              <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 text-sm text-blue-900">
                <h4 className="font-bold mb-2">How it works</h4>
                <ol className="list-decimal pl-4 space-y-1 text-blue-800/80 text-xs">
                  <li>Connect with a GitHub PAT (repo read access).</li>
                  <li>Select a hardware architecture branch.</li>
                  <li>Origin loads subsystem JSON data automatically.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full min-w-0 bg-slate-50 relative overflow-hidden">

        {/* Top Navigation Bar */}
        <div className="h-14 bg-white border-b border-slate-200 flex items-center px-6 justify-between shrink-0 z-10">
          <div className="flex items-center gap-4">
            {!isSidebarOpen && (
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="p-2 -ml-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
                title="Open Sidebar"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="9" x2="9" y1="3" y2="21"/></svg>
              </button>
            )}

            <nav className="flex bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${activeTab === 'dashboard' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Analysis Dashboard
              </button>
              <button
                onClick={() => setActiveTab('guide')}
                className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${activeTab === 'guide' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                User Guide
              </button>
            </nav>

            {/* Compartment filter — always available when data exists */}
            {activeTab === 'dashboard' && displayCompartments.length > 0 && (
              <div className="flex flex-col ml-2 border-l border-slate-200 pl-4">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                  Compartment
                </label>
                <select
                  value={compartmentFilter}
                  onChange={(e) => setCompartmentFilter(e.target.value)}
                  className="text-xs font-semibold border border-slate-300 rounded-md px-2 py-1 bg-white text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm hover:border-blue-400 transition-colors max-w-[150px]"
                >
                  <option value="all">All Compartments</option>
                  {displayCompartments.map((comp) => (
                    <option key={comp} value={comp}>{comp}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Branch indicator */}
            {dataMode === 'github' && selectedBranch && (
              <div className="border-l border-slate-200 pl-4 flex items-center gap-2 text-xs text-slate-500 font-mono">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                {selectedBranch}
              </div>
            )}
          </div>
        </div>

        {/* Subsystem tabs */}
        {activeTab === 'dashboard' && renderSubsystemTabs()}

        {/* Viewport */}
        <div className="flex-1 overflow-hidden relative w-full h-full">
          {activeTab === 'dashboard' && (
            isDataLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-400 rounded-full animate-spin" />
                <p className="text-sm">Loading subsystem data from GitHub…</p>
              </div>
            ) : dataMode === 'github' && !selectedBranch ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
                  <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/>
                  <path d="M9 18c-4.51 2-5-2-7-2"/>
                </svg>
                <div className="text-center">
                  <p className="font-semibold text-slate-500">No branch selected</p>
                  <p className="text-sm mt-1">Connect to GitHub and select an architecture branch.</p>
                </div>
              </div>
            ) : (
              <AnalysisViewer data={displayData} />
            )
          )}
          {activeTab === 'guide' && <GuideViewer />}
        </div>
      </div>
    </div>
  );
};

export default App;
