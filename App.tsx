
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { CSV_HEADER } from './constants';
import { parseCSV } from './services/csvParser';
import { GuideViewer } from './components/GuideViewer';
import { AnalysisViewer } from './components/AnalysisViewer';
import { ConnectionRow } from './types';

type SubsystemKey = 'moma' | 'sprayer' | 'sander' | 'opStation' | 'mapper';

const SUBSYSTEMS: { key: SubsystemKey; label: string }[] = [
    { key: 'moma', label: 'MoMa' },
    { key: 'sprayer', label: 'Tool System: Sprayer' },
    { key: 'sander', label: 'Tool System: Sander' },
    { key: 'opStation', label: 'Operation Station' },
    { key: 'mapper', label: 'Handheld Mapper' }
];

const App: React.FC = () => {
  const [csvContent, setCsvContent] = useState<string>(CSV_HEADER);
  // Separate loaded data by subsystem
  const [loadedData, setLoadedData] = useState<Record<string, string[]>>({});
  
  // Tier 1 Scope: Subsystem
  const [viewFilter, setViewFilter] = useState<string>('all');
  // Tier 2 Scope: Compartment
  const [compartmentFilter, setCompartmentFilter] = useState<string>('all');

  const [activeTab, setActiveTab] = useState<'dashboard' | 'guide'>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  // Sheet Management State
  const [subsystemUrls, setSubsystemUrls] = useState<Record<SubsystemKey, string>>({
      moma: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQMVdUNZE2iajlnhpEG8jbqubDCIdNoUQC6rkt4SP74ulWwgNPVY-MhoavMxRO3K3jlamWa63Oiy88Y/pub?gid=251520535&single=true&output=csv',
      sprayer: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQMVdUNZE2iajlnhpEG8jbqubDCIdNoUQC6rkt4SP74ulWwgNPVY-MhoavMxRO3K3jlamWa63Oiy88Y/pub?gid=1828243183&single=true&output=csv',
      sander: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQMVdUNZE2iajlnhpEG8jbqubDCIdNoUQC6rkt4SP74ulWwgNPVY-MhoavMxRO3K3jlamWa63Oiy88Y/pub?gid=938040379&single=true&output=csv',
      opStation: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQMVdUNZE2iajlnhpEG8jbqubDCIdNoUQC6rkt4SP74ulWwgNPVY-MhoavMxRO3K3jlamWa63Oiy88Y/pub?gid=1389546293&single=true&output=csv',
      mapper: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQMVdUNZE2iajlnhpEG8jbqubDCIdNoUQC6rkt4SP74ulWwgNPVY-MhoavMxRO3K3jlamWa63Oiy88Y/pubhtml?gid=64337072&single=true'
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  
  // Sync State
  const [isAutoSync, setIsAutoSync] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  
  // Load last used URLs on mount
  useEffect(() => {
    try {
        const saved = localStorage.getItem('origin_subsystem_urls');
        if (saved) {
            const parsed = JSON.parse(saved);
            setSubsystemUrls(prev => ({ ...prev, ...parsed }));
        }
    } catch (e) {
        console.error("Failed to load saved URLs", e);
    }
  }, []);

  // 1. Combine Data based on View Filter (Subsystem)
  useEffect(() => {
      let combined = CSV_HEADER;
      if (viewFilter === 'all') {
          Object.values(loadedData).forEach(rows => {
              if (rows && rows.length > 0) combined += '\n' + rows.join('\n');
          });
      } else {
          const rows = loadedData[viewFilter];
          if (rows && rows.length > 0) combined += '\n' + rows.join('\n');
      }
      setCsvContent(combined);
      // Reset compartment filter when subsystem changes
      setCompartmentFilter('all');
  }, [loadedData, viewFilter]);

  // 2. Parse Data
  const parsedData = useMemo(() => parseCSV(csvContent), [csvContent]);

  // 3. Extract Available Compartments from current parsed data
  const availableCompartments = useMemo(() => {
      const compartments = new Set<string>();
      parsedData.forEach(row => {
          if (row.SourceComponentCompartment) compartments.add(row.SourceComponentCompartment.trim());
          if (row.DestinationComponentCompartment) compartments.add(row.DestinationComponentCompartment.trim());
      });
      return Array.from(compartments).filter(Boolean).sort();
  }, [parsedData]);

  // 4. Apply Tier 2 Filter (Compartment)
  const filteredData = useMemo(() => {
      if (compartmentFilter === 'all') return parsedData;
      return parsedData.filter(row => 
          row.SourceComponentCompartment?.trim() === compartmentFilter ||
          row.DestinationComponentCompartment?.trim() === compartmentFilter
      );
  }, [parsedData, compartmentFilter]);

  const processSheetUrl = (url: string): string => {
    try {
        let cleanUrl = url.trim();
        if (!cleanUrl) return '';
        if (cleanUrl.includes('/pubhtml')) {
            cleanUrl = cleanUrl.replace('/pubhtml', '/pub');
        }
        const urlObj = new URL(cleanUrl);
        if (cleanUrl.includes('/pub')) {
            urlObj.searchParams.set('output', 'csv');
        } else if (cleanUrl.includes('/edit')) {
            urlObj.pathname = urlObj.pathname.replace(/\/edit.*$/, '/export');
            urlObj.searchParams.set('format', 'csv');
        }
        return urlObj.toString();
    } catch (e) {
        let fallback = url.trim();
        if (fallback.includes('/pub') && !fallback.includes('output=csv')) {
             fallback += fallback.includes('?') ? '&output=csv' : '?output=csv';
        }
        return fallback;
    }
  };

  const fetchAllData = async (currentUrls: Record<SubsystemKey, string>, isSilent: boolean = false) => {
    const activeEntries = Object.entries(currentUrls).filter(([_, url]) => url && url.trim() !== '');
    
    if (activeEntries.length === 0) {
        if (!isSilent) setImportError("Please enter at least one Google Sheet link.");
        setLoadedData({});
        return;
    }

    if (!isSilent) setIsLoading(true);
    setImportError(null);
    localStorage.setItem('origin_subsystem_urls', JSON.stringify(currentUrls));

    try {
        const fetchPromises = activeEntries.map(async ([key, url]) => {
            const processedUrl = processSheetUrl(url);
            const fetchUrl = processedUrl + (processedUrl.includes('?') ? '&' : '?') + `_t=${Date.now()}`;
            
            const res = await fetch(fetchUrl);
            if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
            
            const text = await res.text();
            if (text.trim().toLowerCase().startsWith('<!doctype html') || text.includes('<html')) {
                throw new Error(`${SUBSYSTEMS.find(s => s.key === key)?.label || key}: returned HTML. Check "Publish to Web" settings.`);
            }
            return text;
        });

        const results = await Promise.all(fetchPromises);
        
        const newLoaded: Record<string, string[]> = {};
        let totalRows = 0;

        activeEntries.forEach(([key, _], index) => {
            const text = results[index];
            const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
            if (lines.length > 1) {
                const dataRows = lines.slice(1);
                newLoaded[key] = dataRows;
                totalRows += dataRows.length;
            } else {
                newLoaded[key] = [];
            }
        });

        setLoadedData(newLoaded);
        setLastSyncTime(new Date());
        if (!isSilent && totalRows === 0) {
            setImportError("Imported sheets appear to be empty (only headers found).");
        }

    } catch (e: any) {
        console.error(e);
        if (!isSilent) setImportError(e.message || "Failed to fetch data.");
    } finally {
        if (!isSilent) setIsLoading(false);
    }
  };

  const handleManualImport = () => {
      fetchAllData(subsystemUrls, false);
  };

  // Sync Logic
  const urlsRef = useRef(subsystemUrls);
  useEffect(() => { urlsRef.current = subsystemUrls; }, [subsystemUrls]);
  
  useEffect(() => {
      if (!isAutoSync) return;
      fetchAllData(urlsRef.current, true);
      const id = setInterval(() => {
          fetchAllData(urlsRef.current, true);
      }, 15000);
      return () => clearInterval(id);
  }, [isAutoSync]);


  const handleDownloadCSV = () => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `origin_architecture_${viewFilter}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadTemplate = () => {
    const exampleRow = "Battery_Pack,Samsung 21700,http://link.com,Inverter_Main,Power,48V DC,2x 4AWG,Powertrain,Rear_Chassis,Inv_Compartment,500W,1500W,3000W,2s,SD,Main feed";
    const content = `${CSV_HEADER}\n${exampleRow}`;
    
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'origin_template.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleUrlChange = (key: SubsystemKey, val: string) => {
      setSubsystemUrls(prev => ({...prev, [key]: val}));
      if (isAutoSync) setIsAutoSync(false); // Pause sync on edit
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden font-sans bg-slate-50 text-slate-900">
      
      {/* Sidebar */}
      <div 
        className={`flex-shrink-0 border-r border-slate-200 bg-white transition-all duration-300 ease-in-out flex flex-col shadow-xl z-20 ${isSidebarOpen ? 'w-[400px] translate-x-0' : 'w-0 -translate-x-full opacity-0'} overflow-hidden`}
      >
        <div className="p-6 border-b border-slate-100 flex flex-col gap-6 h-full">
            <div className="flex justify-between items-center shrink-0">
                 <h1 className="font-bold text-lg text-slate-800 tracking-tight leading-tight">Origin Hardware<br/>Architecture Studio</h1>
                 <button onClick={() => setIsSidebarOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                </button>
            </div>

            <div className="flex-1 flex flex-col gap-4 overflow-y-auto min-h-0 pr-2 -mr-2">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-sm shrink-0">
                    <div className="flex justify-between items-center mb-4">
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Subsystem Data Sources</label>
                        <button 
                            onClick={handleDownloadTemplate}
                            className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline font-medium flex items-center gap-1"
                            title="Download CSV Template with Headers"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                            Get Template
                        </button>
                    </div>
                    
                    <div className="flex flex-col gap-3 mb-4">
                        {SUBSYSTEMS.map((sub) => (
                            <div key={sub.key}>
                                <label className="block text-[10px] font-semibold text-slate-400 mb-1">{sub.label}</label>
                                <input 
                                    type="text" 
                                    value={subsystemUrls[sub.key]}
                                    onChange={(e) => handleUrlChange(sub.key, e.target.value)}
                                    placeholder={`Paste CSV link for ${sub.label}...`}
                                    className="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:outline-none text-slate-900 bg-white placeholder-slate-300"
                                />
                            </div>
                        ))}
                    </div>

                    {importError && (
                        <div className="text-xs text-red-600 font-medium bg-red-50 p-2 rounded border border-red-100 mb-3">
                            {importError}
                        </div>
                    )}
                    
                    <div className="flex gap-2">
                        <button 
                            onClick={handleManualImport}
                            disabled={isLoading}
                            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm flex justify-center items-center gap-2"
                        >
                            {isLoading ? (
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                            ) : (
                                <>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                                    Import All
                                </>
                            )}
                        </button>
                        <button 
                            onClick={handleDownloadCSV}
                            className="px-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg transition-all"
                            title="Download Current View as CSV"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                        </button>
                    </div>

                    <div className="flex items-center justify-between pt-4 mt-2 border-t border-slate-100">
                        <div className="flex items-center gap-3">
                            <input 
                                type="checkbox" 
                                id="sync-toggle" 
                                checked={isAutoSync}
                                onChange={(e) => {
                                    const hasAny = Object.values(subsystemUrls).some(u => u.trim() !== '');
                                    if (!hasAny && e.target.checked) {
                                        alert("Please enter at least one URL first");
                                        return;
                                    }
                                    setIsAutoSync(e.target.checked);
                                }}
                                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-slate-300 cursor-pointer"
                            />
                            <label htmlFor="sync-toggle" className="text-xs font-semibold text-slate-600 cursor-pointer select-none">Auto-Sync</label>
                        </div>
                        
                        {lastSyncTime && (
                            <div className="text-[10px] text-slate-400 font-mono">
                                Updated: {lastSyncTime.toLocaleTimeString()}
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-auto shrink-0">
                    <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 text-sm text-blue-900">
                        <h4 className="font-bold mb-2">How it works</h4>
                        <ol className="list-decimal pl-4 space-y-1 text-blue-800/80 text-xs">
                            <li>Manage subsystems in separate Google Sheets.</li>
                            <li>Publish each to Web (CSV format).</li>
                            <li>Paste links above. Origin combines them automatically.</li>
                        </ol>
                    </div>
                </div>
            </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full min-w-0 bg-slate-50 relative overflow-hidden">
        
        {/* Top Navigation Bar */}
        <div className="h-16 bg-white border-b border-slate-200 flex items-center px-6 justify-between shrink-0 z-10">
            <div className="flex items-center gap-4">
                {!isSidebarOpen && (
                    <button 
                        onClick={() => setIsSidebarOpen(true)} 
                        className="p-2 -ml-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
                        title="Open Sidebar"
                    >
                         <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="9" x2="9" y1="3" y2="21"/></svg>
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

                {activeTab === 'dashboard' && (
                    <div className="flex items-center gap-2 ml-4 border-l border-slate-200 pl-4 h-8">
                        {/* Scope Tier 1: Subsystem */}
                        <div className="flex flex-col">
                             <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Subsystem Scope</label>
                             <select 
                                value={viewFilter} 
                                onChange={(e) => setViewFilter(e.target.value)}
                                className="text-xs font-semibold border border-slate-300 rounded-md px-2 py-1 bg-white text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm hover:border-blue-400 transition-colors"
                            >
                                <option value="all">Full Architecture</option>
                                <optgroup label="Subsystems">
                                    {SUBSYSTEMS.map(sub => (
                                        <option key={sub.key} value={sub.key}>{sub.label}</option>
                                    ))}
                                </optgroup>
                            </select>
                        </div>

                        {/* Scope Tier 2: Compartment */}
                        <div className="flex flex-col ml-2">
                             <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Compartment Scope</label>
                             <select 
                                value={compartmentFilter} 
                                onChange={(e) => setCompartmentFilter(e.target.value)}
                                className="text-xs font-semibold border border-slate-300 rounded-md px-2 py-1 bg-white text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm hover:border-blue-400 transition-colors max-w-[150px]"
                            >
                                <option value="all">All Compartments</option>
                                {availableCompartments.map(comp => (
                                    <option key={comp} value={comp}>{comp}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                 )}
            </div>
        </div>

        {/* Viewport */}
        <div className="flex-1 overflow-hidden relative w-full h-full">
            {activeTab === 'dashboard' && <AnalysisViewer data={filteredData} />}
            {activeTab === 'guide' && <GuideViewer />}
        </div>
      </div>
    </div>
  );
};

export default App;
