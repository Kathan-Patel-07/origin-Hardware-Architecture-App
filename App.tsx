
import React, { useState, useMemo, useCallback } from 'react';
import { CSV_HEADER } from './constants';
import { parseCSV } from './services/csvParser';
import { clearToken, getRobotMeta, loadAllSubsystems, loadAssemblyStatus, loadAssemblyFile, loadAllCatalogItems, loadAllNodes, loadInventoryFile, getFile, createBranch, commitFile, deleteFile, createPR, RobotMeta, SubsystemJSON, CatalogItem, AssemblyFile, NodeEntry } from './services/github';
import { GuideViewer } from './components/GuideViewer';
import { AnalysisViewer } from './components/AnalysisViewer';
import { TableEditor } from './components/TableEditor';
import { SaveDialog } from './components/SaveDialog';
import { AuthGate } from './components/AuthGate';
import { BranchSelector } from './components/BranchSelector';
import { ConnectionRow } from './types';
import { allSubsystemsToRows, ConnectionRowExtended } from './utils/jsonToConnectionRows';
import { rowsToConnectionsJSON } from './utils/rowsToSubsystemJSON';
import { useEditorState } from './hooks/useEditorState';
import { useAssemblyState } from './hooks/useAssemblyState';
import { AssemblyTracker } from './components/AssemblyTracker';
import { DiffViewer } from './components/DiffViewer';
import { CatalogViewer } from './components/CatalogViewer';
import { CatalogSaveDialog } from './components/CatalogSaveDialog';
import { InventoryTracker, InventoryOverride } from './components/InventoryTracker';
import { InventorySaveDialog } from './components/InventorySaveDialog';

// ── Types ─────────────────────────────────────────────────────────────────────
type DataMode = 'github' | 'csv';
type MainTab = 'dashboard' | 'connections' | 'catalog' | 'assembly' | 'inventory' | 'guide' | 'diff';


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
  const [nodeInstanceNames, setNodeInstanceNames] = useState<Record<string, string[]>>({});
  const [nodePartSubsystems, setNodePartSubsystems] = useState<Record<string, string[]>>({});
  const [catalogEdits, setCatalogEdits] = useState<Record<string, Record<string, string>>>({});
  const [catalogNewItems, setCatalogNewItems] = useState<CatalogItem[]>([]);
  const [catalogDeleted, setCatalogDeleted] = useState<Set<string>>(new Set());
  const [showCatalogSaveDialog, setShowCatalogSaveDialog] = useState(false);

  // ── Inventory state ───────────────────────────────────────────────────────────
  const [inventoryOverrides, setInventoryOverrides] = useState<Record<string, InventoryOverride>>({});
  const [inventoryBaseline, setInventoryBaseline] = useState<Record<string, InventoryOverride>>({});
  const [inventoryFileSHA, setInventoryFileSHA] = useState<string | null>(null);
  const [showInventorySaveDialog, setShowInventorySaveDialog] = useState(false);

  const inventoryIsDirty = useMemo(
    () => JSON.stringify(inventoryOverrides) !== JSON.stringify(inventoryBaseline),
    [inventoryOverrides, inventoryBaseline]
  );

  const inventoryChangedCount = useMemo(
    () => Object.keys(inventoryOverrides).length,
    [inventoryOverrides]
  );

  const handleInventoryChange = useCallback((partId: string, patch: Partial<InventoryOverride>, seedQtyPerRobot: number = 0) => {
    setInventoryOverrides((prev) => ({
      ...prev,
      [partId]: { qtyPerRobot: seedQtyPerRobot, qtyInStock: 0, purchaseDone: false, comment: '', ...(prev[partId] ?? {}), ...patch },
    }));
  }, []);

  const handleInventorySave = useCallback(async (
    featureBranch: string,
    commitMessage: string,
    prTitle: string,
    prBody: string
  ): Promise<string> => {
    if (!selectedBranch) throw new Error('No branch selected');

    // Pull the latest saved inventory from the branch and merge our session
    // changes ON TOP of it — this prevents overwriting data saved by others
    // or in a previous session that isn't in our current in-memory state.
    let latestSHA: string | null = null;
    let baseData: Record<string, InventoryOverride> = {};
    try {
      const existing = await getFile('inventory/inventory.json', selectedBranch);
      latestSHA = existing.sha;
      baseData = JSON.parse(existing.content) as Record<string, InventoryOverride>;
    } catch { /* file doesn't exist yet — start fresh */ }

    // Merge: base (from branch) ← our overrides (session changes win)
    const merged = { ...baseData, ...inventoryOverrides };

    await createBranch(featureBranch, selectedBranch);
    await commitFile(
      'inventory/inventory.json',
      JSON.stringify(merged, null, 2),
      commitMessage,
      featureBranch,
      latestSHA
    );
    const pr = await createPR(prTitle, prBody, featureBranch, selectedBranch);
    setInventoryOverrides(merged);
    setInventoryBaseline(merged);
    setInventoryFileSHA(latestSHA);
    return pr.html_url;
  }, [selectedBranch, inventoryOverrides, inventoryFileSHA]);

  // ── CSV state ─────────────────────────────────────────────────────────────────
  const [csvContent, setCsvContent] = useState<string>(CSV_HEADER);

  // ── UI state ──────────────────────────────────────────────────────────────────
  const [compartmentFilter, setCompartmentFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<MainTab>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // ── Dynamic subsystem tabs + label map (built from loaded subsystems) ─────────
  const subsystemLabelMap = useMemo<Record<string, string>>(
    () => Object.fromEntries(subsystems.map((s) => [s.key, s.name ?? s.key])),
    [subsystems]
  );

  const subsystemTabs = useMemo(
    () => [{ key: 'all', label: 'All' }, ...subsystems.map((s) => ({ key: s.key, label: s.name ?? s.key }))],
    [subsystems]
  );

  // ── Derived: all rows from loaded subsystems ──────────────────────────────────
  const allRows = useMemo<ConnectionRowExtended[]>(
    () => allSubsystemsToRows(subsystems, subsystemLabelMap),
    [subsystems, subsystemLabelMap]
  );

  // ── Editor state (tracks edits, isDirty, changeLog) ──────────────────────────
  const { currentData, isDirty, changedSubsystems, changeLog, applyChange, deleteRow, bulkDelete, addRow, reset } =
    useEditorState(allRows);

  // ── Assembly tracker state ────────────────────────────────────────────────────
  const assemblyState = useAssemblyState();
  const [assemblyFileSHA, setAssemblyFileSHA] = useState<string | null>(null);
  const [isSavingAssembly, setIsSavingAssembly] = useState(false);
  const [assemblySaveError, setAssemblySaveError] = useState<string | null>(null);
  const [selectedAssemblyId, setSelectedAssemblyId] = useState<string | null>(null);
  const [assemblyFileSHAv2, setAssemblyFileSHAv2] = useState<string | null>(null);
  const [allNodesFlat, setAllNodesFlat] = useState<NodeEntry[]>([]);

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

  // Components in connections that have no matching catalog entry via usedAs or instanceNames
  const uncataloguedComponents = useMemo(() => {
    if (currentData.length === 0 || currentCatalogItems.length === 0) return [];
    const catalogued = new Set<string>();
    // From catalog usedAs field
    for (const item of currentCatalogItems) {
      const raw = (item as any).usedAs;
      const list: string[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split('/').map((s: string) => s.trim()).filter(Boolean) : [];
      list.forEach((n) => catalogued.add(n.trim()));
    }
    // From nodes-derived instanceNames (takes priority in display, must also be excluded)
    for (const names of Object.values(nodeInstanceNames)) {
      names.forEach((n) => catalogued.add(n.trim()));
    }
    const all = new Set<string>();
    for (const row of currentData) {
      if (row.SourceComponent?.trim()) all.add(row.SourceComponent.trim());
      if (row.DestinationComponent?.trim()) all.add(row.DestinationComponent.trim());
    }
    return Array.from(all).filter((c) => !catalogued.has(c)).sort();
  }, [currentData, currentCatalogItems, nodeInstanceNames]);

  // Derive assembly options and auto-selected ID from branch name
  // e.g. "v2.1-feature" → major "2", minor "1" → autoId "2.1", options ["2.1","2.2","2.3"]
  const assemblyOptions = useMemo<string[]>(() => {
    if (!selectedBranch) return [];
    const match = selectedBranch.match(/^v(\d+)/);
    if (!match) return [];
    const major = match[1];
    return [`${major}.1`, `${major}.2`, `${major}.3`];
  }, [selectedBranch]);

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
        // Migrate instanceNames/quantities in case this was previously renamed from an existing item
        setNodeInstanceNames((prev) => {
          if (!(partId in prev)) return prev;
          const { [partId]: instances, ...rest } = prev;
          return { ...rest, [newPartId]: instances };
        });
        setNodeQuantities((prev) => {
          if (!(partId in prev)) return prev;
          const { [partId]: qty, ...rest } = prev;
          return { ...rest, [newPartId]: qty };
        });
      } else {
        // Existing item: treat as delete-old + add-new
        const current = currentCatalogItems.find((i) => i.partId === partId);
        if (!current) return;
        setCatalogDeleted((prev) => new Set([...prev, partId]));
        setCatalogNewItems((prev) => [...prev, { ...current, partId: newPartId }]);
        setCatalogEdits((prev) => { const { [partId]: _, ...rest } = prev; return rest; });
        // Migrate instanceNames/quantities to the new partId so "Used As" and Qty stay visible
        setNodeInstanceNames((prev) => {
          if (!(partId in prev)) return prev;
          const { [partId]: instances, ...rest } = prev;
          return { ...rest, [newPartId]: instances };
        });
        setNodeQuantities((prev) => {
          if (!(partId in prev)) return prev;
          const { [partId]: qty, ...rest } = prev;
          return { ...rest, [newPartId]: qty };
        });
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

    const normalizeCatalogItem = (item: Record<string, any>) => {
      const out = { ...item };
      if ('inStock' in out) out.inStock = out.inStock === true || out.inStock === 'true';
      if ('usedAs' in out && typeof out.usedAs === 'string') {
        out.usedAs = (out.usedAs as string).split('/').map((s: string) => s.trim()).filter(Boolean);
      }
      return out;
    };

    // Commit edits to existing items
    for (const partId of changedCatalogPartIds) {
      const original = catalogItems.find((i) => i.partId === partId);
      if (!original) continue;
      const updated = normalizeCatalogItem({ ...original, ...(catalogEdits[partId] ?? {}) });
      await commitFile(`catalog/${partId}.json`, JSON.stringify(updated, null, 2), commitMessage, featureBranch, catalogSHAs[partId] ?? null);
    }

    // Commit new items (sha may exist if a file with this partId already exists on the branch)
    for (const item of catalogNewItems) {
      const updated = normalizeCatalogItem({ ...item, ...(catalogEdits[item.partId] ?? {}) });
      const existingSha = catalogSHAs[updated.partId] ?? null;
      await commitFile(`catalog/${updated.partId}.json`, JSON.stringify(updated, null, 2), commitMessage, featureBranch, existingSha);
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
        setDataLoadError('No subsystem files found. Expected connections/{name}.json.');
      }

      // Load catalog + nodes (optional — gracefully handle missing dirs)
      try {
        const { items, shas } = await loadAllCatalogItems(branch);
        setCatalogItems(items);
        setCatalogSHAs(shas);
        const keys = subsystemKeys ?? ['moma', 'mapper', 'sander', 'sprayer', 'opStation'];
        const nodes = await loadAllNodes(branch, keys);
        const qty: Record<string, number> = {};
        const instanceNames: Record<string, string[]> = {};
        const partSubs: Record<string, Set<string>> = {};
        for (const [subsystemKey, entries] of Object.entries(nodes)) {
          for (const n of entries) {
            qty[n.catalogRef] = (qty[n.catalogRef] ?? 0) + 1;
            if (!instanceNames[n.catalogRef]) instanceNames[n.catalogRef] = [];
            instanceNames[n.catalogRef].push(n.nodeId);
            if (!partSubs[n.catalogRef]) partSubs[n.catalogRef] = new Set();
            partSubs[n.catalogRef].add(subsystemKey);
          }
        }
        setNodeQuantities(qty);
        setNodeInstanceNames(instanceNames);
        setNodePartSubsystems(Object.fromEntries(Object.entries(partSubs).map(([k, v]) => [k, Array.from(v)])));
        setAllNodesFlat(Object.values(nodes).flat());
      } catch {
        setCatalogItems([]);
        setNodeQuantities({});
        setNodeInstanceNames({});
        setAllNodesFlat([]);
      }

      // Auto-select assembly ID from branch name and load its file
      const branchMatch = branch.match(/^v(\d+)(?:\.(\d+))?/);
      if (branchMatch) {
        const major = branchMatch[1];
        const minor = branchMatch[2] ?? '1';
        const autoId = `${major}.${minor}`;
        setSelectedAssemblyId(autoId);
        const { file: asmFile, sha: asmSHA } = await loadAssemblyFile(autoId, branch);
        assemblyState.reset(asmFile);
        setAssemblyFileSHAv2(asmSHA);
      }

      // Load inventory data (optional — gracefully handle missing file)
      const { data: invData, sha: invSHA } = await loadInventoryFile(branch);
      setInventoryOverrides(invData as Record<string, InventoryOverride>);
      setInventoryBaseline(invData as Record<string, InventoryOverride>);
      setInventoryFileSHA(invSHA);
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
    setSelectedAssemblyId(null);
    setAssemblyFileSHAv2(null);
    setAllNodesFlat([]);
    setCatalogItems([]);
    setCatalogSHAs({});
    setNodeQuantities({});
    setCatalogEdits({});
    setCatalogNewItems([]);
    setCatalogDeleted(new Set());
    setInventoryOverrides({});
    setInventoryBaseline({});
    setInventoryFileSHA(null);
  };

  // ── Save assembly status → branch → PR ────────────────────────────────────
  const [assemblySavePrUrl, setAssemblySavePrUrl] = useState<string | null>(null);

  const handleSaveAssembly = useCallback(async () => {
    if (!selectedBranch || !selectedAssemblyId) return;
    setIsSavingAssembly(true);
    setAssemblySaveError(null);
    setAssemblySavePrUrl(null);
    try {
      const assemblyFile = assemblyState.toAssemblyFile(selectedAssemblyId);
      const content = JSON.stringify(assemblyFile, null, 2);
      // Create a feature branch so we never push directly to the base branch
      const timestamp = Date.now();
      const featureBranch = `assembly/${selectedAssemblyId}-update-${timestamp}`;
      await createBranch(featureBranch, selectedBranch);
      await commitFile(
        `assembly/${selectedAssemblyId}.json`,
        content,
        `chore: update assembly ${selectedAssemblyId} status`,
        featureBranch,
        assemblyFileSHAv2  // null if file is new, existing SHA if file already exists
      );
      const pr = await createPR(
        `Assembly ${selectedAssemblyId} status update`,
        `Updates wiring and component placement progress for robot assembly **${selectedAssemblyId}**.`,
        featureBranch,
        selectedBranch
      );
      setAssemblySavePrUrl(pr.html_url);
      assemblyState.reset(assemblyFile);
    } catch (e: any) {
      setAssemblySaveError(e.message || 'Failed to save assembly status.');
    } finally {
      setIsSavingAssembly(false);
    }
  }, [selectedBranch, selectedAssemblyId, assemblyState]);

  const handleAssemblyIdChange = useCallback(async (assemblyId: string) => {
    if (!selectedBranch) return;
    setSelectedAssemblyId(assemblyId);
    const { file, sha } = await loadAssemblyFile(assemblyId, selectedBranch);
    assemblyState.reset(file);
    setAssemblyFileSHAv2(sha);
  }, [selectedBranch, assemblyState]);

  // ── Save → branch → PR flow ──────────────────────────────────────────────────
  const handleSave = useCallback(async (
    featureBranch: string,
    commitMessage: string,
    prTitle: string,
    prBody: string
  ): Promise<string> => {
    if (!selectedBranch) throw new Error('No branch selected');

    // 1. Get current file SHAs + assembly maps from the base branch for each changed subsystem
    const fileSHAs: Record<string, string> = {};
    const assemblyMaps: Record<string, Record<string, unknown>> = {};
    await Promise.all(
      Array.from(changedSubsystems).map(async (subKey) => {
        try {
          const file = await getFile(`connections/${subKey}.json`, selectedBranch);
          fileSHAs[subKey] = file.sha;
          // Preserve existing assembly state keyed by connection id
          const existing = JSON.parse(file.content) as { id: string; assembly?: unknown }[];
          assemblyMaps[subKey] = Object.fromEntries(
            existing.filter((c) => c.id).map((c) => [c.id, c.assembly])
          );
        } catch {
          fileSHAs[subKey] = ''; // new file — sha not needed
          assemblyMaps[subKey] = {};
        }
      })
    );

    // 2. Create the feature branch from base
    await createBranch(featureBranch, selectedBranch);

    // 3. Commit each changed subsystem JSON
    for (const subKey of changedSubsystems) {
      const subRows = currentData.filter((r) => r._subsystem === subKey);
      const newConns = rowsToConnectionsJSON(subRows, assemblyMaps[subKey] ?? {});
      const content = JSON.stringify(newConns, null, 2);
      await commitFile(
        `connections/${subKey}.json`,
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
    const visibleTabs = subsystemTabs;

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
                { id: 'inventory',   label: 'Inventory' },
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
                  {tab.id === 'inventory' && inventoryIsDirty && dataMode === 'github' && (
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

          {/* Inventory save toolbar */}
          {inventoryIsDirty && activeTab === 'inventory' && dataMode === 'github' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full font-semibold">
                {inventoryChangedCount} row{inventoryChangedCount !== 1 ? 's' : ''} edited
              </span>
              <button
                onClick={() => { setInventoryOverrides(inventoryBaseline); }}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors border border-slate-200 px-2 py-1 rounded"
              >
                Discard
              </button>
              <button
                onClick={() => setShowInventorySaveDialog(true)}
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
                {changeLog.length} unsaved change{changeLog.length !== 1 ? 's' : ''}
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
                activeSubsystemLabel={subsystemTabs.find(t => t.key === activeSubsystem)?.label}
                isDirty={isDirty}
                onCellChange={applyChange}
                onDeleteRow={deleteRow}
                onBulkDelete={bulkDelete}
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
                instanceNames={nodeInstanceNames}
                partSubsystems={nodePartSubsystems}
                subsystemTabs={subsystemTabs}
                edits={catalogEdits}
                newPartIds={newPartIds}
                deletedPartIds={catalogDeleted}
                uncataloguedComponents={uncataloguedComponents}
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
                nodes={allNodesFlat}
                assemblyId={selectedAssemblyId}
                assemblyOptions={assemblyOptions}
                onAssemblyChange={handleAssemblyIdChange}
                onSave={handleSaveAssembly}
                isSaving={isSavingAssembly}
                saveError={assemblySaveError}
                savedPrUrl={assemblySavePrUrl}
              />
            )
          )}

          {activeTab === 'inventory' && (
            isDataLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-400 rounded-full animate-spin" />
                <p className="text-sm">Loading catalog…</p>
              </div>
            ) : (
              <InventoryTracker
                items={currentCatalogItems}
                instanceNames={nodeInstanceNames}
                quantities={nodeQuantities}
                overrides={inventoryOverrides}
                onOverrideChange={handleInventoryChange}
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

      {/* Inventory Save → PR dialog */}
      {showInventorySaveDialog && selectedBranch && (
        <InventorySaveDialog
          baseBranch={selectedBranch}
          changedCount={inventoryChangedCount}
          onSave={handleInventorySave}
          onClose={() => setShowInventorySaveDialog(false)}
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
