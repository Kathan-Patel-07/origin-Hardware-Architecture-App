
import React, { useMemo, useState, useRef, useEffect } from 'react';
import mermaid from 'mermaid';
import { ConnectionRow, ViewType } from '../types';
import { analyzeArchitecture, ComponentCoverage } from '../services/analysisEngine';
import { generateMermaidCode } from '../services/mermaidGenerator';
import { THEME_COLORS } from '../constants';
// @ts-ignore
import pako from 'pako';

interface AnalysisViewerProps {
    data: ConnectionRow[];
}

type SortKey = 'id' | 'hasPower' | 'hasComm' | 'hasSafety' | 'hasGround' | 'partName' | 'maxContinuousPowerIn' | 'maxContinuousPowerOut';
type SortDirection = 'asc' | 'desc';

// --- Tooltip Component ---
const DiagramTooltip = ({ nodeId, x, y, data, showWireSpecs }: { nodeId: string, x: number, y: number, data: ConnectionRow[], showWireSpecs: boolean }) => {
    const [svg, setSvg] = useState<string>('');
    
    // Dynamic sizing based on complexity
    const { width, height } = useMemo(() => {
        // Count connections for this node
        const edges = data.filter(r => 
            (r.SourceComponent === nodeId || r.DestinationComponent === nodeId) &&
            r.DestinationComponent && r.DestinationComponent.trim() !== ''
        ).length;
        
        // Size buckets
        if (edges <= 3) return { width: 300, height: 250 };
        if (edges <= 6) return { width: 450, height: 350 };
        if (edges <= 10) return { width: 600, height: 500 };
        return { width: 800, height: 600 };
    }, [data, nodeId]);

    useEffect(() => {
        let mounted = true;
        const render = async () => {
             // Generate code for THIS specific node. Using Spatial view to ensure all connection types are included.
             const code = generateMermaidCode(data, ViewType.Spatial, showWireSpecs, nodeId);
             try {
                 const id = `preview-${Date.now()}`;
                 // Re-initialize to ensure simplified styling for small preview
                 mermaid.initialize({ 
                     startOnLoad: false, 
                     theme: 'base',
                     flowchart: { curve: 'basis', padding: 10 },
                     securityLevel: 'loose',
                 });
                 const { svg } = await mermaid.render(id, code);
                 if (mounted) setSvg(svg);
             } catch (e) {
                 if (mounted) setSvg('<div class="text-red-400 text-[10px] p-4 text-center">Preview unavailable</div>');
             }
        }
        render();
        return () => { mounted = false; };
    }, [nodeId, data, showWireSpecs]);

    // Intelligent positioning
    let left = x + 20;
    let top = y + 10;
    
    // Horizontal Flip: If tooltip goes off right edge, flip to left
    if (left + width > window.innerWidth - 20) {
        left = x - width - 20;
    }
    
    // Vertical Clamp: Ensure it doesn't go off bottom
    if (top + height > window.innerHeight - 20) {
        top = window.innerHeight - height - 20;
    }
    
    // Safety Clamps for Top/Left
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    
    return (
        <div 
            className="fixed z-50 bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col pointer-events-none overflow-hidden transition-all duration-200 ease-out"
            style={{ 
                top, 
                left, 
                width: `${width}px`, 
                height: `${height}px` 
            }}
        >
             <div className="bg-slate-50 border-b border-slate-100 px-4 py-2 flex justify-between items-center shrink-0">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Quick Preview</span>
                <span className="text-xs font-bold text-slate-800 truncate max-w-[200px]">{nodeId}</span>
             </div>
             <div className="flex-1 overflow-hidden p-4 flex items-center justify-center bg-white relative">
                 {svg ? (
                     <div 
                        className="w-full h-full flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:h-auto"
                        dangerouslySetInnerHTML={{ __html: svg }} 
                     />
                 ) : (
                     <div className="absolute inset-0 flex items-center justify-center">
                         <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                     </div>
                 )}
             </div>
        </div>
    );
};

export const AnalysisViewer: React.FC<AnalysisViewerProps> = ({ data }) => {
    const results = useMemo(() => analyzeArchitecture(data), [data]);
    const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'id', direction: 'asc' });
    const [showWireSpecs, setShowWireSpecs] = useState(false);
    
    // Selection State
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Effect to select all by default when data loads/changes
    useEffect(() => {
        setSelectedIds(new Set(results.componentCoverage.map(c => c.id)));
    }, [results.componentCoverage]);
    
    // Hover State
    const [previewNode, setPreviewNode] = useState<{ id: string; x: number; y: number } | null>(null);
    const hoverTimeout = useRef<number | null>(null);

    // Calculate Metrics
    const missingDatasheetsCount = useMemo(() => {
        return results.componentCoverage.filter(c => !c.datasheetLink || c.datasheetLink.trim() === '').length;
    }, [results.componentCoverage]);

    const missingCompartmentCount = useMemo(() => {
        return results.componentCoverage.filter(c => !c.compartment || c.compartment.trim() === '').length;
    }, [results.componentCoverage]);

    const missingPowerCount = useMemo(() => {
        // Count components that have Power connections but 0 Watts recorded
        return results.componentCoverage.filter(c => c.hasPower && (c.maxContinuousPowerIn + c.maxContinuousPowerOut === 0)).length;
    }, [results.componentCoverage]);

    // Readiness Score (Simple percentage of "Good" attributes)
    const readinessScore = useMemo(() => {
        if (results.nodeCount === 0) return 0;
        
        // Weighting: 
        // Datasheets (Component Level), Compartments (Component Level), Power Data (Component Level)
        // Wire Specs (Connection Level), Func Names (Connection Level)
        
        const compCount = results.nodeCount;
        const connCount = results.totalConnections || 1; 

        const dsScore = Math.max(0, 1 - (missingDatasheetsCount / compCount));
        const compScore = Math.max(0, 1 - (missingCompartmentCount / compCount));
        const powerScore = Math.max(0, 1 - (missingPowerCount / compCount));
        
        const wireScore = Math.max(0, 1 - (results.missingWireSpecsCount / connCount));
        const nameScore = Math.max(0, 1 - (results.missingFunctionalNamesCount / connCount));
        
        // A simple average of the 5 metrics
        const score = (dsScore + compScore + powerScore + wireScore + nameScore) / 5;
        return Math.round(score * 100);
    }, [results, missingDatasheetsCount, missingCompartmentCount, missingPowerCount]);

    const handleSort = (key: SortKey) => {
        setSortConfig(current => ({
            key,
            direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedIds(new Set(results.componentCoverage.map(c => c.id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleSelectRow = (id: string, checked: boolean) => {
        const next = new Set(selectedIds);
        if (checked) next.add(id);
        else next.delete(id);
        setSelectedIds(next);
    };

    const openMermaidUrl = (code: string) => {
        const state = {
            code: code,
            mermaid: { 
                theme: 'default',
                flowchart: { defaultRenderer: 'elk' } 
            },
            autoSync: true, 
            updateDiagram: true
        };
        const json = JSON.stringify(state);
        const encodedData = new TextEncoder().encode(json);
        const compressed = pako.deflate(encodedData, { level: 9 });
        const payload = btoa(String.fromCharCode(...compressed)).replace(/\+/g, '-').replace(/\//g, '_');
        window.open(`https://mermaid.ai/play?utm_medium=toggle&utm_source=mermaid_live_editor#pako:${payload}`, '_blank');
    }

    const generateLink = (view: ViewType) => {
        const code = generateMermaidCode(data, view, showWireSpecs);
        openMermaidUrl(code);
    };

    const openComponentDiagram = (componentId: string) => {
        const code = generateMermaidCode(data, ViewType.Spatial, showWireSpecs, componentId);
        openMermaidUrl(code);
    };

    const handleExportBOM = () => {
        // Group by Part Name
        const bomMap: Record<string, { partName: string, quantity: number, datasheet: string, components: string[] }> = {};
        const unGroupedItems: { partName: string, quantity: number, datasheet: string, components: string[] }[] = [];

        results.componentCoverage.forEach(c => {
            const rawPart = c.partName ? c.partName.trim() : '';
            if (rawPart) {
                if (!bomMap[rawPart]) {
                    bomMap[rawPart] = {
                        partName: rawPart,
                        quantity: 0,
                        datasheet: c.datasheetLink || '',
                        components: []
                    };
                }
                bomMap[rawPart].quantity++;
                bomMap[rawPart].components.push(c.id);
                // Prefer an existing datasheet link if available
                if (!bomMap[rawPart].datasheet && c.datasheetLink) {
                    bomMap[rawPart].datasheet = c.datasheetLink;
                }
            } else {
                // No part name, list individually
                unGroupedItems.push({
                    partName: '-', // Placeholder for missing part name
                    quantity: 1,
                    datasheet: c.datasheetLink || '',
                    components: [c.id]
                });
            }
        });

        const sortedGrouped = Object.values(bomMap).sort((a, b) => a.partName.localeCompare(b.partName));
        const finalData = [...sortedGrouped, ...unGroupedItems];

        // Generate CSV
        const headers = ['Part Name', 'Quantity', 'Datasheet Link', 'Component Names'];
        const rows = finalData.map(item => [
            `"${item.partName.replace(/"/g, '""')}"`,
            item.quantity,
            `"${item.datasheet.replace(/"/g, '""')}"`,
            `"${item.components.join(' / ').replace(/"/g, '""')}"`
        ]);
        
        const csvContent = [
            headers.join(','),
            ...rows.map(r => r.join(','))
        ].join('\n');

        // Create Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'origin_procurement_bom.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Hover Handlers
    const onMouseEnterId = (e: React.MouseEvent, id: string) => {
        const x = e.clientX;
        const y = e.clientY;
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        
        // 500ms delay to prevent flashing when scrolling
        hoverTimeout.current = window.setTimeout(() => {
            setPreviewNode({ id, x, y });
        }, 500);
    };

    const onMouseLeaveId = () => {
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        setPreviewNode(null);
    };

    // Sorted Data
    const sortedCoverage = useMemo(() => {
        let processed = [...results.componentCoverage];

        // Robust Sort
        processed.sort((a, b) => {
            const getVal = (obj: any, k: string) => {
                const v = obj[k];
                if (typeof v === 'string') return v.toLowerCase();
                if (typeof v === 'boolean') return v ? 1 : 0;
                if (typeof v === 'number') return v;
                return ''; // treat undefined/null as empty string for sorting
            };

            const valA = getVal(a, sortConfig.key);
            const valB = getVal(b, sortConfig.key);

            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
        
        return processed;
    }, [results.componentCoverage, sortConfig]);

    // Generate Diagram for Selected Items
    const handleGenerateSelectedDiagram = () => {
        if (selectedIds.size === 0) {
            alert("Please select at least one component to generate a diagram.");
            return;
        }

        // Pass full data and selection list. The generator will handle strict filtering.
        const code = generateMermaidCode(data, ViewType.Spatial, showWireSpecs, undefined, Array.from(selectedIds));
        openMermaidUrl(code);
    };

    const BooleanIcon = ({ value, color }: { value: boolean, color: string }) => {
        if (!value) return <span className="text-slate-200 text-lg">•</span>;
        return (
            <span style={{ color: color }} className="text-lg font-bold">●</span>
        );
    };

    const SortHeader = ({ label, columnKey, colorClass, children }: { label: string, columnKey: SortKey, colorClass?: string, children?: React.ReactNode }) => (
        <th 
            className={`px-4 py-3 bg-slate-50 border-b border-slate-200 min-w-[100px] cursor-pointer hover:bg-slate-100 transition-colors group select-none ${colorClass}`}
            onClick={() => handleSort(columnKey)}
        >
            <div className="flex items-center gap-1 font-semibold uppercase tracking-wider text-slate-600">
                {label}
                <span className={`text-xs ml-1 transition-opacity text-blue-600 ${sortConfig.key === columnKey ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}>
                    {sortConfig.key === columnKey && sortConfig.direction === 'desc' ? '↓' : '↑'}
                </span>
            </div>
            {children}
        </th>
    );

    const diagramTypes = [
        { id: ViewType.Power, label: 'Power Architecture', color: 'bg-red-500', desc: 'Distribution, fuses, and loads' },
        { id: ViewType.Comm, label: 'Communication Bus', color: 'bg-blue-500', desc: 'CAN, Ethernet, and signals' },
        { id: ViewType.Safety, label: 'Safety Systems', color: 'bg-yellow-500', desc: 'E-Stops and Interlocks' },
        { id: ViewType.Spatial, label: 'Spatial Layout', color: 'bg-slate-600', desc: 'Compartment mapping' },
        { id: ViewType.Grounding, label: 'Grounding Topology', color: 'bg-green-500', desc: 'Earthing points and straps' },
    ];

    const formatPower = (watts: number) => {
        if (watts === 0) return <span className="text-slate-300">-</span>;
        if (watts >= 1000) return `${(watts / 1000).toFixed(1)} kW`;
        return `${watts} W`;
    };

    return (
        <div className="flex-1 h-full overflow-y-auto p-8 bg-slate-50">
            {previewNode && (
                <DiagramTooltip 
                    nodeId={previewNode.id} 
                    x={previewNode.x} 
                    y={previewNode.y} 
                    data={data}
                    showWireSpecs={showWireSpecs}
                />
            )}
            
            <div className="max-w-6xl mx-auto space-y-8">
                
                {/* 1. Diagram Generator Section */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <div className="flex justify-between items-start mb-6">
                        <div>
                            <h2 className="text-xl font-bold text-slate-800">Architecture Schematics</h2>
                            <p className="text-slate-500 text-sm mt-1">Generate high-resolution diagrams in Mermaid.AI</p>
                        </div>
                        <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-lg border border-slate-100">
                             <input 
                                type="checkbox" 
                                id="wire-specs"
                                checked={showWireSpecs}
                                onChange={(e) => setShowWireSpecs(e.target.checked)}
                                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-slate-300"
                            />
                            <label htmlFor="wire-specs" className="text-sm font-medium text-slate-700 cursor-pointer select-none">
                                Include Wire Specs
                            </label>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                        {diagramTypes.map((type) => (
                            <button
                                key={type.id}
                                onClick={() => generateLink(type.id)}
                                className="group flex flex-col items-start p-4 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all text-left bg-white shadow-sm hover:shadow-md"
                            >
                                <div className={`w-8 h-1 rounded-full mb-3 ${type.color}`}></div>
                                <span className="font-bold text-slate-800 group-hover:text-blue-700">{type.label}</span>
                                <span className="text-xs text-slate-500 mt-1">{type.desc}</span>
                                <div className="mt-4 text-xs font-semibold text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                    Open Diagram 
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* 2. Architecture Readiness Dashboard */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h2 className="text-xl font-bold text-slate-800">Architecture Readiness</h2>
                            <p className="text-slate-500 text-sm mt-1">Health Score derived from data completeness and specification fidelity.</p>
                        </div>
                        <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-xl border border-slate-100">
                            <div className="text-right">
                                <div className="text-2xl font-bold text-slate-800 leading-none">{readinessScore}%</div>
                                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Health Score</div>
                            </div>
                            <div className="w-12 h-12 rounded-full flex items-center justify-center relative">
                                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                                        <path className="text-slate-200" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4" />
                                        <path className={`${readinessScore > 80 ? 'text-green-500' : readinessScore > 50 ? 'text-yellow-500' : 'text-red-500'} transition-all duration-1000 ease-out`} strokeDasharray={`${readinessScore}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                                </svg>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {/* 2.1 Context Metrics (Totals) */}
                        <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex flex-col justify-center">
                            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Total Components</h3>
                            <div className="text-3xl font-bold text-slate-800">{results.nodeCount}</div>
                        </div>
                        <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex flex-col justify-center">
                            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Total Connections</h3>
                            <div className="text-3xl font-bold text-slate-800">{results.totalConnections}</div>
                        </div>

                        {/* 2.2 Component Gaps */}
                        <div className="p-4 rounded-lg bg-white border border-slate-200 flex flex-col justify-center">
                            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Missing Datasheets</h3>
                            <div className="text-3xl font-bold text-red-600">{missingDatasheetsCount}</div>
                            <div className="text-[10px] text-slate-400 mt-1">
                                {results.nodeCount > 0 ? ((missingDatasheetsCount / results.nodeCount) * 100).toFixed(0) : 0}% of BOM
                            </div>
                        </div>

                        <div className="p-4 rounded-lg bg-white border border-slate-200 flex flex-col justify-center">
                            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Missing Loc Info</h3>
                            <div className="text-3xl font-bold text-orange-500">{missingCompartmentCount}</div>
                            <div className="text-[10px] text-slate-400 mt-1">
                                {results.nodeCount > 0 ? ((missingCompartmentCount / results.nodeCount) * 100).toFixed(0) : 0}% of Layout
                            </div>
                        </div>

                        <div className="p-4 rounded-lg bg-white border border-slate-200 flex flex-col justify-center">
                            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Missing Power Info</h3>
                            <div className="text-3xl font-bold text-blue-500">{missingPowerCount}</div>
                            <div className="text-[10px] text-slate-400 mt-1">
                                0W In/Out Recorded
                            </div>
                        </div>

                        {/* 2.3 Connection Gaps (New) */}
                        <div className="p-4 rounded-lg bg-white border border-slate-200 flex flex-col justify-center">
                            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Missing Wire Specs</h3>
                            <div className="text-3xl font-bold text-purple-600">{results.missingWireSpecsCount}</div>
                            <div className="text-[10px] text-slate-400 mt-1">
                                {results.totalConnections > 0 ? ((results.missingWireSpecsCount / results.totalConnections) * 100).toFixed(0) : 0}% Unspecified
                            </div>
                        </div>

                        <div className="p-4 rounded-lg bg-white border border-slate-200 flex flex-col justify-center">
                            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Missing Func Names</h3>
                            <div className="text-3xl font-bold text-pink-600">{results.missingFunctionalNamesCount}</div>
                             <div className="text-[10px] text-slate-400 mt-1">
                                {results.totalConnections > 0 ? ((results.missingFunctionalNamesCount / results.totalConnections) * 100).toFixed(0) : 0}% Unlabeled
                            </div>
                        </div>
                    </div>
                </div>

                {/* 3. Validation Warnings */}
                {results.warnings.length > 0 && (
                    <div className="p-4 rounded-lg bg-orange-50 border border-orange-200">
                        <h3 className="text-orange-800 font-bold mb-2">Validation Warnings</h3>
                        <ul className="list-disc pl-5 space-y-1">
                            {results.warnings.map((w, i) => (
                                <li key={i} className="text-orange-700 text-sm">{w}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* 4. Component Matrix */}
                <div className="rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-white flex flex-col min-h-[600px]">
                    <div className="px-6 py-4 border-b border-slate-200 shrink-0 bg-white flex justify-between items-end">
                        <div>
                            <button 
                                onClick={handleGenerateSelectedDiagram}
                                className="group text-left"
                            >
                                <h3 className="font-bold text-slate-800 text-lg group-hover:text-blue-600 group-hover:underline decoration-2 underline-offset-2 flex items-center gap-2">
                                    Component Architecture Coverage
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-0 group-hover:opacity-100 transition-opacity"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
                                </h3>
                                <p className="text-xs text-slate-500 mt-1">
                                    Click title to generate diagram for <strong>{selectedIds.size} selected</strong> components.
                                </p>
                            </button>
                        </div>
                        <div className="flex items-center gap-4">
                            <button
                                onClick={handleExportBOM}
                                className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200 transition-all flex items-center gap-2"
                                title="Download BOM as CSV"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                                Export BOM
                            </button>
                            <span className="text-xs text-slate-400">
                                {selectedIds.size} of {results.componentCoverage.length} selected
                            </span>
                        </div>
                    </div>
                    <div className="overflow-auto flex-1">
                        <table className="min-w-full text-sm text-left relative">
                            <thead className="bg-slate-50 text-slate-600 sticky top-0 shadow-sm z-10">
                                <tr>
                                    <th className="px-4 py-3 bg-slate-50 border-b border-slate-200 w-12 text-center">
                                        <input 
                                            type="checkbox" 
                                            checked={selectedIds.size === results.componentCoverage.length && results.componentCoverage.length > 0}
                                            onChange={(e) => handleSelectAll(e.target.checked)}
                                            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-slate-300 cursor-pointer"
                                        />
                                    </th>
                                    <th className="px-4 py-3 bg-slate-50 border-b border-slate-200 w-16 text-center text-slate-400 font-semibold">#</th>
                                    
                                    <SortHeader label="Component ID" columnKey="id" />
                                    <SortHeader label="Part Name" columnKey="partName" />
                                    <SortHeader label="Pwr In" columnKey="maxContinuousPowerIn" colorClass="bg-red-50/50" />
                                    <SortHeader label="Pwr Out" columnKey="maxContinuousPowerOut" colorClass="bg-red-50/50" />
                                    <SortHeader label="Comm" columnKey="hasComm" colorClass="bg-blue-50/30" />
                                    <SortHeader label="Safe" columnKey="hasSafety" colorClass="bg-yellow-50/30" />
                                    <SortHeader label="Gnd" columnKey="hasGround" colorClass="bg-green-50/30" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {sortedCoverage.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="p-8 text-center text-slate-400">
                                            No data available.
                                        </td>
                                    </tr>
                                ) : (
                                    sortedCoverage.map((comp, index) => {
                                        const isSelected = selectedIds.has(comp.id);
                                        return (
                                            <tr 
                                                key={comp.id} 
                                                className={`transition-colors ${isSelected ? 'bg-blue-50/30 hover:bg-blue-50' : 'hover:bg-slate-50'}`}
                                            >
                                                <td className="px-4 py-2 text-center">
                                                    <input 
                                                        type="checkbox" 
                                                        checked={isSelected}
                                                        onChange={(e) => handleSelectRow(comp.id, e.target.checked)}
                                                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-slate-300 cursor-pointer"
                                                    />
                                                </td>
                                                <td className="px-4 py-2 text-center font-mono text-slate-400 text-xs">{index + 1}</td>
                                                <td className="px-4 py-2 font-mono font-medium text-xs">
                                                    <button 
                                                        onClick={() => openComponentDiagram(comp.id)}
                                                        onMouseEnter={(e) => onMouseEnterId(e, comp.id)}
                                                        onMouseLeave={onMouseLeaveId}
                                                        className="text-blue-600 hover:text-blue-800 hover:underline text-left font-bold"
                                                        title="Hover to Preview, Click to Open External Diagram"
                                                    >
                                                        {comp.id}
                                                    </button>
                                                </td>
                                                <td className="px-4 py-2 text-xs">
                                                    {comp.datasheetLink ? (
                                                        <a 
                                                            href={comp.datasheetLink} 
                                                            target="_blank" 
                                                            rel="noopener noreferrer"
                                                            className="text-slate-600 hover:text-blue-600 hover:underline font-medium flex items-center gap-1"
                                                        >
                                                            {comp.partName || 'Datasheet'}
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
                                                        </a>
                                                    ) : (
                                                        <span className="text-slate-400 italic">{comp.partName || '-'}</span>
                                                    )}
                                                </td>
                                                
                                                <td className="px-4 py-2 text-center bg-red-50/10 border-l border-red-100 font-mono text-xs font-semibold text-slate-700">
                                                    {formatPower(comp.maxContinuousPowerIn)}
                                                </td>
                                                <td className="px-4 py-2 text-center bg-red-50/10 border-r border-red-100 font-mono text-xs font-semibold text-slate-700">
                                                    {formatPower(comp.maxContinuousPowerOut)}
                                                </td>

                                                <td className="px-4 py-2 text-center">
                                                    <BooleanIcon value={comp.hasComm} color={THEME_COLORS.comm} />
                                                </td>
                                                <td className="px-4 py-2 text-center bg-slate-50/30">
                                                    <BooleanIcon value={comp.hasSafety} color={THEME_COLORS.safety} />
                                                </td>
                                                <td className="px-4 py-2 text-center">
                                                    <BooleanIcon value={comp.hasGround} color={THEME_COLORS.ground} />
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};
