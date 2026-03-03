
import React from 'react';

interface Release {
  version: string;
  date: string;
  title: string;
  type: 'major' | 'minor' | 'patch';
  changes: string[];
}

const releases: Release[] = [
  {
    version: "3.7.0",
    date: "Current",
    title: "Selection & History",
    type: "minor",
    changes: [
      "Replaced complex filtering with explicit checkbox selection for Diagram Generation.",
      "Added 'Select All / Deselect All' capability to Component Coverage table.",
      "Added Release History tab.",
      "Updated diagram generation to strictly respect user selection.",
    ]
  },
  {
    version: "3.6.0",
    date: "Feb 2025",
    title: "Grounding & Documentation",
    type: "minor",
    changes: [
      "Added 'Grounding Architecture' visualization type.",
      "Expanded User Guide with detailed schema definitions.",
      "Added 'Component Architecture Coverage' table with interactive drill-down.",
      "Implemented Spatial View grouping by Compartment.",
    ]
  },
  {
    version: "3.5.0",
    date: "Jan 2025",
    title: "Power Analysis Engine",
    type: "major",
    changes: [
      "Added Power Analysis fields (Watts, Direction) to schema.",
      "Implemented automated hazard detection for high power on thin wires.",
      "Added sorting capability to all table columns.",
      "Added wire gauge validation logic.",
    ]
  },
  {
    version: "3.0.0",
    date: "Dec 2024",
    title: "Origin Studio Rebrand",
    type: "major",
    changes: [
      "Complete UI overhaul with Tailwind CSS.",
      "Transitioned to React 19 + Vite.",
      "Added Google Sheets live sync functionality.",
      "Integrated Mermaid.js ELK renderer for auto-layout.",
    ]
  }
];

export const ReleaseHistoryViewer: React.FC = () => {
  return (
    <div className="flex-1 h-full overflow-y-auto bg-slate-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
            <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Release History</h1>
            <p className="text-slate-500 mt-2">Changelog and version tracking for Origin Architecture Studio.</p>
        </div>

        <div className="relative border-l-2 border-slate-200 ml-3 space-y-12 pb-12">
            {releases.map((release, idx) => (
                <div key={idx} className="relative pl-8">
                    {/* Timeline Dot */}
                    <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-white ${release.type === 'major' ? 'bg-blue-600 ring-4 ring-blue-100' : 'bg-slate-400'}`}></div>
                    
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                        <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <span className={`text-sm font-bold px-2 py-1 rounded ${release.type === 'major' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
                                    v{release.version}
                                </span>
                                <h3 className="font-bold text-slate-800">{release.title}</h3>
                            </div>
                            <span className="text-xs font-mono text-slate-500">{release.date}</span>
                        </div>
                        <div className="p-6">
                            <ul className="space-y-3">
                                {release.changes.map((change, cIdx) => (
                                    <li key={cIdx} className="flex items-start gap-3 text-sm text-slate-600">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500 mt-0.5 shrink-0"><polyline points="20 6 9 17 4 12"/></svg>
                                        {change}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            ))}
        </div>
      </div>
    </div>
  );
};
