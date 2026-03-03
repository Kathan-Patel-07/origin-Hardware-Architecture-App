
import React, { useState } from 'react';
import { ConnectionRow } from '../types';
import { serializeCSV } from '../services/csvParser';

interface TableEditorProps {
  data: ConnectionRow[];
  onUpdate: (newCsv: string) => void;
}

type SortDirection = 'asc' | 'desc';

interface SortConfig {
  key: keyof ConnectionRow | null;
  direction: SortDirection;
}

export const TableEditor: React.FC<TableEditorProps> = ({ data, onUpdate }) => {
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: null, direction: 'asc' });

  // Order of columns in the editor
  const headers: (keyof ConnectionRow)[] = [
    'SourceComponent', 
    'SourceComponentPartName',
    'SourceComponentDatasheetLink',
    'DestinationComponent', 
    'ArchitectureType', 
    'FunctionalWireName', 
    'WireSpecifications', 
    'MaxContinuousPower', // Added
    'PowerDirection',     // Added
    'FunctionalGroup', 
    'SourceComponentCompartment', 
    'DestinationComponentCompartment', 
    'AveragePower',           // Added (Optional/Secondary)
    'PeakPower',              // Added
    'PeakPowerTransientTime', // Added
    'Notes'
  ];

  const handleSort = (key: keyof ConnectionRow) => {
    let direction: SortDirection = 'asc';
    
    // Toggle direction if clicking the same header
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }

    setSortConfig({ key, direction });

    const sortedData = [...data].sort((a, b) => {
      // Safe string comparison
      const valA = (a[key] || '').toString().toLowerCase();
      const valB = (b[key] || '').toString().toLowerCase();

      if (valA < valB) return direction === 'asc' ? -1 : 1;
      if (valA > valB) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    // We update the actual CSV order to persist the sort
    onUpdate(serializeCSV(sortedData));
  };

  const handleCellChange = (rowIndex: number, field: keyof ConnectionRow, value: string) => {
    const newData = [...data];
    newData[rowIndex] = { ...newData[rowIndex], [field]: value };
    onUpdate(serializeCSV(newData));
  };

  const handleDeleteRow = (rowIndex: number) => {
    const newData = data.filter((_, i) => i !== rowIndex);
    onUpdate(serializeCSV(newData));
  };

  const handleAddRow = () => {
    const newRow: ConnectionRow = {
      SourceComponent: 'New',
      SourceComponentPartName: '',
      SourceComponentDatasheetLink: '',
      DestinationComponent: 'New',
      ArchitectureType: 'Power',
      FunctionalWireName: '-',
      WireSpecifications: '1x 18AWG',
      FunctionalGroup: 'Main',
      SourceComponentCompartment: 'Main',
      DestinationComponentCompartment: 'Main',
      Notes: ''
    };
    const newData = [...data, newRow];
    onUpdate(serializeCSV(newData));
  };

  const formatHeader = (key: string) => {
      // Custom overrides for length/clarity
      if (key === 'MaxContinuousPower') return 'Max Pwr (W)';
      if (key === 'AveragePower') return 'Avg Pwr';
      if (key === 'PeakPower') return 'Peak Pwr';
      if (key === 'PowerDirection') return 'Pwr Dir (SD/DS)';
      if (key === 'PeakPowerTransientTime') return 'Trans. Time';

      // Add spaces before capital letters and trim
      return key.replace(/([A-Z])/g, ' $1').trim();
  }

  const SortIcon = ({ columnKey }: { columnKey: keyof ConnectionRow }) => {
    if (sortConfig.key !== columnKey) return <span className="text-slate-300 opacity-0 group-hover:opacity-50 transition-opacity ml-1">↕</span>;
    return (
      <span className="text-blue-500 ml-1">
        {sortConfig.direction === 'asc' ? '↑' : '↓'}
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      <div className="p-2 bg-white border-b border-slate-200 flex justify-between items-center shrink-0">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider px-2">Electrical Table</h2>
        <button 
          onClick={handleAddRow}
          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-medium flex items-center gap-1 transition-colors"
        >
          <span>+ Add Connection</span>
        </button>
      </div>
      
      <div className="flex-1 overflow-auto p-2">
        <div className="bg-white shadow-sm rounded border border-slate-200 inline-block min-w-full">
          <table className="min-w-max divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-100 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-2 py-2 text-left font-semibold text-slate-600 w-8 bg-slate-100 border-r border-slate-200">#</th>
                <th className="px-1 py-2 w-8 bg-slate-100 border-r border-slate-200"></th>
                {headers.map(h => (
                  <th 
                    key={h} 
                    className="px-2 py-2 text-left font-semibold text-slate-600 min-w-[100px] bg-slate-100 border-r border-slate-200 last:border-r-0 cursor-pointer hover:bg-slate-200 transition-colors select-none group"
                    onClick={() => handleSort(h)}
                    title={`Sort by ${h}`}
                  >
                      <div className="flex items-center justify-between">
                        {formatHeader(h)}
                        <SortIcon columnKey={h} />
                      </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {data.map((row, idx) => (
                <tr key={idx} className="hover:bg-blue-50 transition-colors group">
                  <td className="px-2 py-1 text-slate-400 font-mono text-[10px] select-none text-center border-r border-slate-100 bg-white group-hover:bg-blue-50">{idx + 1}</td>
                   <td className="px-1 py-1 text-center border-r border-slate-100 bg-white group-hover:bg-blue-50">
                    <button 
                      onClick={() => handleDeleteRow(idx)}
                      className="text-slate-300 hover:text-red-500 transition-colors p-1"
                      title="Delete Row"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                  </td>
                  {headers.map((col) => (
                    <td key={`${idx}-${col}`} className="p-0 border-r border-slate-100 last:border-r-0">
                      <input 
                        className="w-full px-2 py-1.5 border-transparent bg-transparent focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none transition-all text-slate-700 placeholder-slate-300 font-medium"
                        value={row[col] || ''}
                        onChange={(e) => handleCellChange(idx, col, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {data.length === 0 && (
            <div className="p-4 text-center text-slate-400 text-xs">
              Empty table.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
