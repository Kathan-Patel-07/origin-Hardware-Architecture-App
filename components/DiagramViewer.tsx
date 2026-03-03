
import React, { useEffect, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';
import { ViewType } from '../types';
import html2canvas from 'html2canvas';
// @ts-ignore
import pako from 'pako';

interface DiagramViewerProps {
  code: string;
  view: ViewType;
}

export const DiagramViewer: React.FC<DiagramViewerProps> = ({ code, view }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  
  // Zoom/Pan State
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  
  // Mouse interaction state
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Initialize Mermaid - Minimal config to let the code string dictate styles
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'loose', 
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      // We rely on the %%{init}%% block in the code for curve/spacing settings
    });
  }, []);

  // Render Mermaid Code
  useEffect(() => {
    const renderDiagram = async () => {
      try {
        setError(null);
        setSvgContent('');
        
        const id = `mermaid-${Date.now()}`;
        // Using mermaid.render directly. 
        const { svg } = await mermaid.render(id, code);
        setSvgContent(svg);
        
        // Reset view on new render
        setScale(1);
        setPosition({ x: 50, y: 50 });
      } catch (err: any) {
        console.error("Mermaid Render Error:", err);
        let msg = err.message || "Failed to render diagram.";
        if (msg.includes("Parse error")) msg += " (Check CSV data for invalid characters)";
        setError(msg);
      }
    };
    
    // Small timeout to ensure DOM is ready
    const timeout = setTimeout(renderDiagram, 50);
    return () => clearTimeout(timeout);
  }, [code]);

  // --- Zoom Logic ---
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    
    // Configuration for smoother zoom
    const zoomFactor = 1.1; 
    const minScale = 0.1;
    const maxScale = 50;

    // Calculate new scale (Standard geometric zoom)
    const direction = e.deltaY > 0 ? -1 : 1;
    let newScale = direction > 0 ? scale * zoomFactor : scale / zoomFactor;
    newScale = Math.min(Math.max(minScale, newScale), maxScale);
    
    // Get mouse position relative to container (viewport)
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Calculate the point in the "world" (content) that is currently under the mouse
    // worldX = (mouseX - currentTranslateX) / currentScale
    const worldX = (mouseX - position.x) / scale;
    const worldY = (mouseY - position.y) / scale;

    // Calculate new translation to keep that world point under the mouse
    // newTranslateX = mouseX - (worldX * newScale)
    const newX = mouseX - (worldX * newScale);
    const newY = mouseY - (worldY * newScale);

    setScale(newScale);
    setPosition({ x: newX, y: newY });
  }, [scale, position]);

  // --- Pan Logic ---
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only Left Click
    setIsPointerDown(true);
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => {
    setIsPointerDown(false);
    setIsDragging(false);
  };

  const resetZoom = () => {
    setScale(1);
    setPosition({ x: 50, y: 50 });
  };

  const openMermaidAi = () => {
    if (!code) return;
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
    const data = new TextEncoder().encode(json);
    const compressed = pako.deflate(data, { level: 9 });
    const payload = btoa(String.fromCharCode(...compressed)).replace(/\+/g, '-').replace(/\//g, '_');
    window.open(`https://mermaid.ai/play?utm_medium=toggle&utm_source=mermaid_live_editor#pako:${payload}`, '_blank');
  };

  const downloadPNG = async () => {
    if (contentRef.current) {
        try {
            const canvas = await html2canvas(contentRef.current, {
                scale: 3,
                backgroundColor: '#ffffff',
                ignoreElements: (element) => element.classList.contains('exclude-export')
            });
            const link = document.createElement('a');
            link.download = `architecture-${view.toLowerCase()}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        } catch (e) {
            alert("Export failed: " + e);
        }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 relative print:bg-white print:overflow-visible print:h-auto print:block">
      {/* Toolbar */}
      <div className="absolute top-4 right-4 z-10 flex flex-col items-end gap-2 print:hidden">
        <div className="flex gap-2 bg-white p-2 rounded-lg shadow-md border border-slate-200 items-center">
            <button onClick={resetZoom} className="p-2 hover:bg-slate-100 rounded text-slate-600" title="Reset View">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 12"/></svg>
            </button>
            <button onClick={() => setScale(s => Math.min(s * 1.2, 50))} className="p-2 hover:bg-slate-100 rounded text-slate-600" title="Zoom In">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/></svg>
            </button>
            <button onClick={() => setScale(s => Math.max(s / 1.2, 0.1))} className="p-2 hover:bg-slate-100 rounded text-slate-600" title="Zoom Out">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/></svg>
            </button>
            <div className="w-px h-6 bg-slate-200 mx-1"></div>
            <button onClick={openMermaidAi} className="p-2 hover:bg-slate-100 rounded text-slate-600" title="Open in Mermaid.AI">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
            </button>
            <button onClick={downloadPNG} className="p-2 hover:bg-slate-100 rounded text-slate-600" title="Export PNG">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            </button>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div 
        ref={containerRef}
        className="w-full h-full overflow-hidden cursor-move bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] print:bg-none print:overflow-visible print:h-auto print:cursor-default relative"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {error ? (
          <div className="flex items-center justify-center h-full text-red-500 font-mono p-10 bg-red-50">
            <div className="max-w-2xl text-center">
                <h3 className="font-bold text-xl mb-4">Rendering Error</h3>
                <p className="whitespace-pre-wrap">{error}</p>
            </div>
          </div>
        ) : (
            <div 
                ref={contentRef}
                className="absolute top-0 left-0 origin-top-left transition-transform duration-75 ease-out p-10 print:p-0 print:transform-none pointer-events-none"
                style={{ 
                    // Explicitly use 0 0 origin so our math matches coordinates
                    transformOrigin: '0 0',
                    transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`
                }}
                dangerouslySetInnerHTML={{ __html: svgContent }}
            />
        )}
      </div>
    </div>
  );
};
