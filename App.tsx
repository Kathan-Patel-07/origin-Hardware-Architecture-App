
import React, { useState, useMemo, useCallback } from 'react';
import { CSV_HEADER } from './constants';
import { parseCSV } from './services/csvParser';
import { clearToken, getRobotMeta, loadAllSubsystems, loadAssemblyStatus, loadAllCatalogItems, loadAllNodes, getFile, createBranch, commitFile, deleteFile, createPR, RobotMeta, SubsystemJSON, CatalogItem } from './services/github';
import { GuideViewer } from './components/GuideViewer';
import { AnalysisViewer } from './components/AnalysisViewer';
import { TableEditor } from './components/TableEditor';
import { SaveDialog } from './components/SaveDialog';
import { AuthGate } from './components/AuthGate';
import { BranchSelector } from './components/BranchSelector';
import { ConnectionRow } from './types';
import { allSubsystemsToRows, ConnectionRowExtended } from './utils/jsonToConnectionRows';
import { rowsToSubsystemJSON } from './utils/rowsToSubsystemJSON';
import { useEditorState } from './hooks/useEditorState';
import { useAssemblyState } from './hooks/useAssemblyState';
import { AssemblyTracker } from './components/AssemblyTracker';
import { DiffViewer } from './components/DiffViewer';
import { CatalogViewer } from './components/CatalogViewer';
import { CatalogSaveDialog } from './components/CatalogSaveDialog';

// ── Types ─────────────────────────────────────────────────────────────────────
type DataMode = 'github' | 'csv';
type MainTab = 'dashboard' | 'connections' | 'catalog' | 'assembly' | 'guide' | 'diff';

// Subsystem tab config
const SUBSYSTEM_TABS: { key: string; label: string }[] = [
  { key: 'all',       label: 'All'               },
  { key: 'moma',      label: 'MoMa'              },
  { key: 'mapper',    label: 'Handheld Mapper'   },
  { key: 'sander',    label: 'Tools Sander'      },
  { key: 'sprayer',   label: 'Tools Sprayer'     },
  { key: 'opStation', label: 'Operation Station' },
];

const SUBSYSTEM_LABEL_MAP: Record<string, string> = Object.fromEntries(
  SUBSYSTEM_TABS.filter((t) => t.key !== 'all').map((t) => [t.key, t.label])
);

const App: React.FC = () => {
  // ── Mode ─────────────────────────────────────────────────────────────────────
  const [dataMode, setDataMode] = useState<DataMode>('github');

  // ── GitHub state ─────────────────────────────────────────────────────────────
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [robotMeta, setRobotMeta] = useState<RobotMeta | null>(null);
  const [subsystems, setSubsystems] = useState<SubsystemJSON[]>([]);
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [dataLoadError, setDataLoadError] = useState<string | null>(null);
  const [activeSubsystem, setActiveSubsystem] = useState<string>('all');
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [catalogSHAs, setCatalogSHAs] = useState<Record<string, string>>({});
  const [nodeQuantities, setNodeQuantities] = useState<Record<string, number>>({});
  const [catalogEdits, setCatalogEdits] = useState<Record<string, Record<string, string>>>({});
  const [catalogNewItems, setCatalogNewItems] = useState<CatalogItem[]>([]);
  const [catalogDeleted, setCatalogDeleted] = useState<Set<string>>(new Set());
  const [showCatalogSaveDialog, setShowCatalogSaveDialog] = useState(false);

  // ── CSV state ─────────────────────────────────────────────────────────────────
  const [csvContent, setCsvContent] = useState<string>(CSV_HEADER);

  // ── UI state ──────────────────────────────────────────────────────────────────
  const [compartmentFilter, setCompartmentFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<MainTab>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // ── Derived: all rows from loaded subsystems ──────────────────────────────────
  const allRows = useMemo<ConnectionRowExtended[]>(
    () => allSubsystemsToRows(subsystems, SUBSYSTEM_LABEL_MAP),
    [subsystems]
  );

  // ── Editor state (tracks edits, isDirty, changeLog) ──────────────────────────
  const { currentData, isDirty, changedSubsystems, changeLog, applyChange, deleteRow, addRow, reset } =
    useEditorState(allRows);

  // ── Assembly tracker state ────────────────────────────────────────────────────
  const assemblyState = useAssemblyState();
  const [assemblyFileSHA, setAssemblyFileSHA] = useState<string | null>(null);
  const [isSavingAssembly, setIsSavingAssembly] = useState(false);
  const [assemblySaveError, setAssemblySaveError] = useState<string | null>(null);

  // ── Filtered views from currentData ──────────────────────────────────────────
  const subsystemFiltered = useMemo<ConnectionRowExtended[]>(() => {
    if (activeSubsystem === 'all') return currentData;
    return currentData.filter((r) => r._subsystem === activeSubsystem);
  }, [currentData, activeSubsystem]);

  const flagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of currentData) {
      const key = row._subsystem ?? '';
      if (row._flagged) counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [currentData]);

  const totalFlags = useMemo(
    () => Object.values(flagCounts).reduce((a, b) => a + b, 0),
    [flagCounts]
  );

  // ── Catalog editor state ──────────────────────────────────────────────────────
  const currentCatalogItems = useMemo(
    () => [
      ...catalogItems
        .filter((item) => !catalogDeleted.has(item.partId))
        .map((item) => ({ ...item, ...(catalogEdits[item.partId] ?? {}) } as CatalogItem)),
      ...catalogNewItems.map((item) => ({ ...item, ...(catalogEdits[item.partId] ?? {}) } as CatalogItem)),
    ],
    [catalogItems, catalogEdits, catalogDeleted, catalogNewItems]
  );

  const catalogChangeCount = useMemo(
    () => Object.values(catalogEdits).reduce((sum, e) => sum + Object.keys(e).length, 0),
    [catalogEdits]
  );

  const catalogIsDirty = catalogChangeCount > 0 || catalogDeleted.size > 0 || catalogNewItems.length > 0;
  const changedCatalogPartIds = Object.keys(catalogEdits).filter((id) => !catalogNewItems.find((n) => n.partId === id));
  const newPartIds = useMemo(() => new Set(catalogNewItems.map((i) => i.partId)), [catalogNewItems]);

  const handleCatalogDeleteRow = useCallback((partId: string) => {
    if (newPartIds.has(partId)) {
      // Just remove from new items — no repo file to delete
      setCatalogNewItems((prev) => prev.filter((i) => i.partId !== partId));
      setCatalogEdits((prev) => { const { [partId]: _, ...rest } = prev; return rest; });
    } else {
      setCatalogDeleted((prev) => new Set([...prev, partId]));
    }
  }, [newPartIds]);

  const handleCatalogAddRow = useCallback((item: CatalogItem) => {
    setCatalogNewItems((prev) => [...prev, item]);
  }, []);

  const handleCatalogCellChange = useCallback((partId: string, field: string, oldValue: string, newValue: string) => {
    if (oldValue === newValue) return;

    // ── Part ID rename ────────────────────────────────────────────────────────
    if (field === 'partId') {
      const newPartId = newValue.trim();
      if (!newPartId) return;
      const isNew = catalogNewItems.some((i) => i.partId === partId);
      if (isNew) {
        // Just update the partId in the new-items list and migrate any edits
        setCatalogNewItems((prev) => prev.map((i) => i.partId === partId ? { ...i, partId: newPartId } : i));
        setCatalogEdits((prev) => {
          const { [partId]: existing, ...rest } = prev;
          return existing ? { ...rest, [newPartId]: existing } : rest;
        });
      } else {
        // Existing item: treat as delete-old + add-new
        const current = currentCatalogItems.find((i) => i.partId === partId);
        if (!current) return;
        setCatalogDeleted((prev) => new Set([...prev, partId]));
        setCatalogNewItems((prev) => [...prev, { ...current, partId: newPartId }]);
        setCatalogEdits((prev) => { const { [partId]: _, ...rest } = prev; return rest; });
      }
      return;
    }

    // ── Regular field edit ────────────────────────────────────────────────────
    setCatalogEdits((prev) => {
      const itemEdits = { ...(prev[partId] ?? {}) };
      const original = catalogItems.find((i) => i.partId === partId);
      const originalVal = original ? String((original as any)[field] ?? '') : '';
      if (newValue === originalVal) {
        delete itemEdits[field];
        if (Object.keys(itemEdits).length === 0) {
          const { [partId]: _removed, ...rest } = prev;
          return rest;
        }
      } else {
        itemEdits[field] = newValue;
      }
      return { ...prev, [partId]: itemEdits };
    });
  }, [catalogItems, catalogNewItems, currentCatalogItems]);

  const handleCatalogSave = useCallback(async (
    featureBranch: string,
    commitMessage: string,
    prTitle: string,
    prBody: string
  ): Promise<string> => {
    if (!selectedBranch) throw new Error('No branch selected');

    await createBranch(featureBranch, selectedBranch);

    // Commit edits to existing items
    for (const partId of changedCatalogPartIds) {
      const original = catalogItems.find((i) => i.partId === partId);
      if (!original) continue;
      const updated = { ...original, ...(catalogEdits[partId] ?? {}) };
      await commitFile(`catalog/${partId}.json`, JSON.stringify(updated, null, 2), commitMessage, featureBranch, catalogSHAs[partId] ?? null);
    }

    // Commit new items
    for (const item of catalogNewItems) {
      const updated = { ...item, ...(catalogEdits[item.partId] ?? {}) };
      await commitFile(`catalog/${updated.partId}.json`, JSON.stringify(updated, null, 2), commitMessage, featureBranch, null);
    }

    // Delete removed items
    for (const partId of catalogDeleted) {
      const sha = catalogSHAs[partId];
      if (!sha) continue;
      await deleteFile(`catalog/${partId}.json`, sha, commitMessage, featureBranch);
    }

    const pr = await createPR(prTitle, prBody, featureBranch, selectedBranch);
    setCatalogEdits({});
    setCatalogNewItems([]);
    setCatalogDeleted(new Set());
    await handleBranchSelect(selectedBranch);
    return pr.html_url;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranch, changedCatalogPartIds, catalogItems, catalogEdits, catalogSHAs, catalogNewItems, catalogDeleted]);

  const availableCompartments = useMemo(() => {
    const set = new Set<string>();
    subsystemFiltered.forEach((row) => {
      if (row.SourceComponentCompartment) set.add(row.SourceComponentCompartment.trim());
      if (row.DestinationComponentCompartment) set.add(row.DestinationComponentCompartment.trim());
    });
    return Array.from(set).filter(Boolean).sort();
  }, [subsystemFiltered]);

  const finalRows = useMemo<ConnectionRow[]>(() => {
    if (compartmentFilter === 'all') return subsystemFiltered;
    return subsystemFiltered.filter(
      (row) =>
        row.SourceComponentCompartment?.trim() === compartmentFilter ||
        row.DestinationComponentCompartment?.trim() === compartmentFilter
    );
  }, [subsystemFiltered, compartmentFilter]);

  // ── Branch loading ────────────────────────────────────────────────────────────
  const handleBranchSelect = useCallback(async (branch: string) => {
    setSelectedBranch(branch);
    setRobotMeta(null);
    setSubsystems([]);
    setLoadErrors({});
    setDataLoadError(null);
    setActiveSubsystem('all');
    setCompartmentFilter('all');
    setIsDataLoading(true);

    try {
      let subsystemKeys: string[] | undefined;
      try {
        const meta = await getRobotMeta(branch);
        setRobotMeta(meta);
        subsystemKeys = meta.subsystems?.length ? meta.subsystems : undefined;
      } catch { /* robot.json optional */ }

      const { subsystems: loaded, errors } = await loadAllSubsystems(branch, subsystemKeys);
      setSubsystems(loaded);
      setLoadErrors(errors);

      if (loaded.length === 0) {
        setDataLoadError('No subsystem files found. Expected subsystems/{name}.json.');
      }

      // Load assembly status
      const { status: asmStatus, sha: asmSHA } = await loadAssemblyStatus(branch);
      assemblyState.reset(asmStatus);
      setAssemblyFileSHA(asmSHA);

      // Load catalog + nodes (optional — gracefully handle missing dirs)
      try {
        const { items, shas } = await loadAllCatalogItems(branch);
        setCatalogItems(items);
        setCatalogSHAs(shas);
        const keys = subsystemKeys ?? ['moma', 'mapper', 'sander', 'sprayer', 'opStation'];
        const nodes = await loadAllNodes(branch, keys);
        const qty: Record<string, number> = {};
        for (const entries of Object.values(nodes)) {
          for (const n of entries) {
            qty[n.catalogRef] = (qty[n.catalogRef] ?? 0) + 1;
          }
        }
        setNodeQuantities(qty);
      } catch {
        setCatalogItems([]);
        setNodeQuantities({});
      }
    } catch (e: any) {
      setDataLoadError(e.message || 'Failed to load data from branch.');
    } finally {
      setIsDataLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDisconnect = () => {
    clearToken();
    setIsAuthenticated(false);
    setSelectedBranch(null);
    setRobotMeta(null);
    setSubsystems([]);
    setLoadErrors({});
    setDataLoadError(null);
    reset([]);
    assemblyState.reset();
    setAssemblyFileSHA(null);
    setCatalogItems([]);
    setCatalogSHAs({});
    setNodeQuantities({});
    setCatalogEdits({});
    setCatalogNewItems([]);
    setCatalogDeleted(new Set());
  };

  // ── Save assembly status ───────────────────────────────────────────────────
  const handleSaveAssembly = useCallback(async () => {
    if (!selectedBranch) return;
    setIsSavingAssembly(true);
    setAssemblySaveError(null);
    try {
      const statusFile = assemblyState.toStatusFile(selectedBranch);
      const content = JSON.stringify(statusFile, null, 2);
      await commitFile('assembly_status.json', content, 'chore: update assembly status', selectedBranch, assemblyFileSHA);
      // Re-fetch to get updated SHA
      const { sha } = await loadAssemblyStatus(selectedBranch);
      setAssemblyFileSHA(sha);
      assemblyState.reset(statusFile);
    } catch (e: any) {
      setAssemblySaveError(e.message || 'Failed to save assembly status.');
    } finally {
      setIsSavingAssembly(false);
    }
  }, [selectedBranch, assemblyState, assemblyFileSHA]);

  // ── Save → branch → PR flow ──────────────────────────────────────────────────
  const handleSave = useCallback(async (
    featureBranch: string,
    commitMessage: string,
    prTitle: string,
    prBody: string
  ): Promise<string> => {
    if (!selectedBranch) throw new Error('No branch selected');

    // 1. Get current file SHAs from the base branch for each changed subsystem
    const fileSHAs: Record<string, string> = {};
    await Promise.all(
      Array.from(changedSubsystems).map(async (subKey) => {
        try {
          const file = await getFile(`subsystems/${subKey}.json`, selectedBranch);
          fileSHAs[subKey] = file.sha;
        } catch {
          fileSHAs[subKey] = ''; // new file — sha not needed
        }
      })
    );

    // 2. Create the feature branch from base
    await createBranch(featureBranch, selectedBranch);

    // 3. Commit each changed subsystem JSON
    for (const subKey of changedSubsystems) {
      const originalSub = subsystems.find((s) => s.key === subKey);
      if (!originalSub) continue;
      const subRows = currentData.filter((r) => r._subsystem === subKey);
      const newSubJSON = rowsToSubsystemJSON(subRows, originalSub);
      const content = JSON.stringify(newSubJSON, null, 2);
      await commitFile(
        `subsystems/${subKey}.json`,
        content,
        commitMessage,
        featureBranch,
        fileSHAs[subKey]
      );
    }

    // 4. Open PR against the base branch
    const pr = await createPR(prTitle, prBody, featureBranch, selectedBranch);

    // 5. Reset editor and reload fresh data from base branch
    reset();
    await handleBranchSelect(selectedBranch);

    return pr.html_url;
  }, [selectedBranch, changedSubsystems, subsystems, currentData, reset, handleBranchSelect]);

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

  // ── What gets passed to viewers ───────────────────────────────────────────────
  const displayData = dataMode === 'github' ? finalRows : csvFiltered;
  const displayCompartments = dataMode === 'github' ? availableCompartments : csvCompartments;

  // For the TableEditor — always show filtered currentData regardless of compartment
  const tableEditorData = dataMode === 'github' ? subsystemFiltered : (currentData.length ? subsystemFiltered : []);

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

  // ── Subsystem tabs ────────────────────────────────────────────────────────────
  const renderSubsystemTabs = () => {
    if (dataMode !== 'github' || subsystems.length === 0) return null;
    const loadedKeys = new Set(subsystems.map((s) => s.key));
    const visibleTabs = SUBSYSTEM_TABS.filter((t) => t.key === 'all' || loadedKeys.has(t.key));

    return (
      <div className="flex items-center gap-0 border-b border-slate-200 bg-white px-4 overflow-x-auto shrink-0">
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

  // ── Sidebar ───────────────────────────────────────────────────────────────────
  const renderSidebarContent = () => {
    if (dataMode === 'github') {
      return (
        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Data Source</label>
            <button onClick={() => setDataMode('csv')} className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors">
              Use CSV instead
            </button>
          </div>

          {!isAuthenticated ? (
            <AuthGate onAuthenticated={() => setIsAuthenticated(true)} />
          ) : (
            <BranchSelector selectedBranch={selectedBranch} onBranchSelect={handleBranchSelect} onDisconnect={handleDisconnect} />
          )}

          {isDataLoading && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <div className="w-3 h-3 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin" />
              Loading subsystem data…
            </div>
          )}

          {dataLoadError && !isDataLoading && (
            <div className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-100">{dataLoadError}</div>
          )}

          {Object.keys(loadErrors).length > 0 && !isDataLoading && (
            <div className="text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-100 flex flex-col gap-1">
              <span className="font-semibold">Some subsystems failed:</span>
              {Object.entries(loadErrors).map(([key, msg]) => (
                <span key={key} className="font-mono text-[10px]">{key}: {msg}</span>
              ))}
            </div>
          )}

          {robotMeta && (
            <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">{robotMeta.name}</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${robotMeta.type === 'robot' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                  {robotMeta.type}
                </span>
              </div>
              {robotMeta.version && <div className="text-[10px] text-slate-400 font-mono">{robotMeta.version}</div>}
              {robotMeta.subsystems?.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {robotMeta.subsystems.map((s) => (
                    <span key={s} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">{s}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {subsystems.length > 0 && !isDataLoading && (
            <div className="text-[10px] text-slate-400 flex gap-3">
              <span>{subsystems.length} subsystem{subsystems.length !== 1 ? 's' : ''}</span>
              <span>{currentData.length} connections</span>
              {totalFlags > 0 && <span className="text-amber-500 font-semibold">{totalFlags} flagged</span>}
              {isDirty && <span className="text-amber-600 font-semibold">{changeLog.length} unsaved</span>}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">CSV Import (Legacy)</label>
          <button onClick={() => setDataMode('github')} className="text-[10px] text-blue-500 hover:text-blue-700 font-medium transition-colors">
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
            <button onClick={() => setIsSidebarOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100">
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
                  <li>Edit connections directly in the table. Save → PR to commit changes.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full min-w-0 bg-slate-50 relative overflow-hidden">

        {/* Top Nav */}
        <div className="h-14 bg-white border-b border-slate-200 flex items-center px-6 justify-between shrink-0 z-10">
          <div className="flex items-center gap-3">
            {!isSidebarOpen && (
              <button onClick={() => setIsSidebarOpen(true)} className="p-2 -ml-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="9" x2="9" y1="3" y2="21"/></svg>
              </button>
            )}

            <nav className="flex bg-slate-100 p-1 rounded-lg">
              {([
                { id: 'dashboard',   label: 'Analysis' },
                { id: 'connections', label: 'Connections' },
                { id: 'catalog',     label: 'Catalog' },
                { id: 'assembly',    label: 'Assembly' },
                { id: 'diff',        label: 'Compare' },
                { id: 'guide',       label: 'Guide' },
              ] as { id: MainTab; label: string }[]).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all relative ${
                    activeTab === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {tab.label}
                  {tab.id === 'connections' && isDirty && dataMode === 'github' && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-400 rounded-full" />
                  )}
                  {tab.id === 'assembly' && assemblyState.isDirty && dataMode === 'github' && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-400 rounded-full" />
                  )}
                  {tab.id === 'catalog' && catalogIsDirty && dataMode === 'github' && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-400 rounded-full" />
                  )}
                </button>
              ))}
            </nav>

            {/* Compartment filter */}
            {(activeTab === 'dashboard') && displayCompartments.length > 0 && (
              <div className="flex flex-col border-l border-slate-200 pl-3">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Compartment</label>
                <select
                  value={compartmentFilter}
                  onChange={(e) => setCompartmentFilter(e.target.value)}
                  className="text-xs font-semibold border border-slate-300 rounded-md px-2 py-1 bg-white text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm hover:border-blue-400 transition-colors max-w-[150px]"
                >
                  <option value="all">All Compartments</option>
                  {displayCompartments.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}

            {/* Branch indicator */}
            {dataMode === 'github' && selectedBranch && (
              <div className="border-l border-slate-200 pl-3 flex items-center gap-2 text-xs text-slate-500 font-mono">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                {selectedBranch}
              </div>
            )}
          </div>

          {/* Catalog save toolbar */}
          {catalogIsDirty && activeTab === 'catalog' && dataMode === 'github' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full font-semibold flex items-center gap-1.5">
                {catalogNewItems.length > 0 && <span className="text-green-600">+{catalogNewItems.length}</span>}
                {catalogDeleted.size > 0 && <span className="text-red-500">-{catalogDeleted.size}</span>}
                {catalogChangeCount > 0 && <span>~{catalogChangeCount} edit{catalogChangeCount !== 1 ? 's' : ''}</span>}
                {(catalogNewItems.length > 0 || catalogDeleted.size > 0) && catalogChangeCount === 0 ? '' : ''}
              </span>
              <button
                onClick={() => { setCatalogEdits({}); setCatalogNewItems([]); setCatalogDeleted(new Set()); }}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors border border-slate-200 px-2 py-1 rounded"
              >
                Discard
              </button>
              <button
                onClick={() => setShowCatalogSaveDialog(true)}
                className="text-xs bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
                Save Changes
              </button>
            </div>
          )}

          {/* Connections save / Discard toolbar */}
          {isDirty && dataMode === 'github' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full font-semibold">
                {changeLog.filter(c => c.field !== '__deleted__' && c.field !== '__added__').length} unsaved edit{changeLog.length !== 1 ? 's' : ''}
                {changedSubsystems.size > 0 && ` · ${changedSubsystems.size} subsystem${changedSubsystems.size !== 1 ? 's' : ''}`}
              </span>
              <button
                onClick={() => reset()}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors border border-slate-200 px-2 py-1 rounded"
              >
                Discard
              </button>
              <button
                onClick={() => setShowSaveDialog(true)}
                className="text-xs bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
                Save Changes
              </button>
            </div>
          )}
        </div>

        {/* Subsystem tabs (shown for dashboard, connections, and assembly views) */}
        {(activeTab === 'dashboard' || activeTab === 'connections' || activeTab === 'assembly') && renderSubsystemTabs()}


        {/* Viewport */}
        <div className="flex-1 overflow-hidden relative w-full h-full">
          {activeTab === 'diff' && <DiffViewer />}

          {activeTab === 'guide' && <GuideViewer />}

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

          {activeTab === 'connections' && (
            dataMode === 'github' && !selectedBranch ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4">
                <p className="font-semibold text-slate-500">No branch selected</p>
                <p className="text-sm">Connect to GitHub and select a branch to edit connections.</p>
              </div>
            ) : isDataLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-400 rounded-full animate-spin" />
                <p className="text-sm">Loading…</p>
              </div>
            ) : (
              <TableEditor
                data={tableEditorData}
                activeSubsystem={activeSubsystem}
                activeSubsystemLabel={SUBSYSTEM_TABS.find(t => t.key === activeSubsystem)?.label}
                isDirty={isDirty}
                onCellChange={applyChange}
                onDeleteRow={deleteRow}
                onAddRow={addRow}
              />
            )
          )}

          {activeTab === 'catalog' && (
            dataMode === 'github' && !selectedBranch ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4">
                <p className="font-semibold text-slate-500">No branch selected</p>
                <p className="text-sm">Connect to GitHub and select a branch to view the catalog.</p>
              </div>
            ) : isDataLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-400 rounded-full animate-spin" />
                <p className="text-sm">Loading catalog…</p>
              </div>
            ) : (
              <CatalogViewer
                items={currentCatalogItems}
                quantities={nodeQuantities}
                edits={catalogEdits}
                newPartIds={newPartIds}
                deletedPartIds={catalogDeleted}
                onCellChange={handleCatalogCellChange}
                onDeleteRow={handleCatalogDeleteRow}
                onAddRow={handleCatalogAddRow}
              />
            )
          )}

          {activeTab === 'assembly' && (
            dataMode === 'github' && !selectedBranch ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4">
                <p className="font-semibold text-slate-500">No branch selected</p>
                <p className="text-sm">Connect to GitHub and select a branch to track assembly.</p>
              </div>
            ) : isDataLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-400 rounded-full animate-spin" />
                <p className="text-sm">Loading assembly status…</p>
              </div>
            ) : (
              <AssemblyTracker
                rows={subsystemFiltered}
                assemblyState={assemblyState}
                onSave={handleSaveAssembly}
                isSaving={isSavingAssembly}
                saveError={assemblySaveError}
              />
            )
          )}
        </div>
      </div>

      {/* Catalog Save → PR dialog */}
      {showCatalogSaveDialog && selectedBranch && (
        <CatalogSaveDialog
          baseBranch={selectedBranch}
          changedPartIds={changedCatalogPartIds}
          changeCount={catalogChangeCount}
          addedPartIds={catalogNewItems.map((i) => i.partId)}
          deletedPartIds={Array.from(catalogDeleted)}
          onSave={handleCatalogSave}
          onClose={() => setShowCatalogSaveDialog(false)}
        />
      )}

      {/* Connections Save → PR dialog */}
      {showSaveDialog && selectedBranch && (
        <SaveDialog
          baseBranch={selectedBranch}
          changedSubsystems={changedSubsystems}
          changeLog={changeLog}
          onSave={handleSave}
          onClose={() => setShowSaveDialog(false)}
        />
      )}
    </div>
  );
};

export default App;
