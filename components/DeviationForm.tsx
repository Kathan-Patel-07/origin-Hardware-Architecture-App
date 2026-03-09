
import React, { useState } from 'react';
import { AssemblyDeviation } from '../services/github';
import { ConnectionRowExtended } from '../utils/jsonToConnectionRows';

const DEVIATION_FIELDS: { key: string; label: string }[] = [
  { key: 'WireSpecifications',              label: 'Wire Spec'          },
  { key: 'SourceComponentPartName',         label: 'Source Part Name'   },
  { key: 'SourceComponentDatasheetLink',    label: 'Source Datasheet'   },
  { key: 'SourceComponentPurchaseLink',     label: 'Source Purchase'    },
  { key: 'DestinationComponent',            label: 'Destination'        },
  { key: 'DestinationComponentDatasheetLink', label: 'Dest Datasheet'   },
  { key: 'FunctionalWireName',              label: 'Wire Name'          },
  { key: 'ArchitectureType',                label: 'Architecture Type'  },
  { key: 'FunctionalGroup',                 label: 'Functional Group'   },
  { key: 'SourceComponentCompartment',      label: 'Source Compartment' },
  { key: 'DestinationComponentCompartment', label: 'Dest Compartment'   },
  { key: 'Notes',                           label: 'Notes'              },
];

interface DeviationFormProps {
  row?: ConnectionRowExtended;
  existing?: AssemblyDeviation;
  onSave: (deviation: AssemblyDeviation) => void;
  onClear?: () => void;
  onCancel: () => void;
}

export const DeviationForm: React.FC<DeviationFormProps> = ({ row, existing, onSave, onClear, onCancel }) => {
  const [field, setField] = useState(existing?.field ?? 'WireSpecifications');
  const [actualValue, setActualValue] = useState(existing?.actualValue ?? '');
  const [reason, setReason] = useState(existing?.reason ?? '');

  const idealValue = row ? ((row as any)[field] ?? '(not set)') : '(not set)';

  const handleSave = () => {
    if (!actualValue.trim()) return;
    onSave({ field, idealValue: String(idealValue), actualValue: actualValue.trim(), reason: reason.trim() });
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mt-1 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-amber-700">Log Deviation</span>
        <button onClick={onCancel} className="text-amber-400 hover:text-amber-600 p-0.5">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>

      {/* Field selector */}
      <div>
        <label className="block text-[10px] font-semibold text-amber-600 uppercase tracking-wider mb-1">
          Which field deviated?
        </label>
        <select
          value={field}
          onChange={(e) => setField(e.target.value)}
          className="w-full text-xs border border-amber-300 rounded px-2 py-1.5 bg-white focus:ring-1 focus:ring-amber-400 focus:outline-none"
        >
          {DEVIATION_FIELDS.map((f) => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </select>
      </div>

      {/* Ideal value (read-only) */}
      <div>
        <label className="block text-[10px] font-semibold text-amber-600 uppercase tracking-wider mb-1">
          Ideal Value (from architecture)
        </label>
        <div className="text-xs bg-amber-100/60 border border-amber-200 rounded px-2 py-1.5 text-amber-800 font-mono">
          {String(idealValue) || <span className="italic text-amber-400">(empty)</span>}
        </div>
      </div>

      {/* Actual value */}
      <div>
        <label className="block text-[10px] font-semibold text-amber-600 uppercase tracking-wider mb-1">
          Actual Value (as built) *
        </label>
        <input
          value={actualValue}
          onChange={(e) => setActualValue(e.target.value)}
          placeholder="What was actually used?"
          className="w-full text-xs border border-amber-300 rounded px-2 py-1.5 bg-white focus:ring-1 focus:ring-amber-400 focus:outline-none"
        />
      </div>

      {/* Reason */}
      <div>
        <label className="block text-[10px] font-semibold text-amber-600 uppercase tracking-wider mb-1">
          Reason
        </label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. wrong stock, design change…"
          className="w-full text-xs border border-amber-300 rounded px-2 py-1.5 bg-white focus:ring-1 focus:ring-amber-400 focus:outline-none"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 text-xs border border-amber-300 text-amber-600 hover:bg-amber-100 px-3 py-1.5 rounded font-semibold transition-colors"
        >
          Cancel
        </button>
        {onClear && (
          <button
            onClick={onClear}
            className="flex-1 text-xs border border-slate-300 text-slate-500 hover:bg-slate-100 px-3 py-1.5 rounded font-semibold transition-colors"
          >
            Clear
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={!actualValue.trim()}
          className="flex-1 text-xs bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded font-semibold transition-colors"
        >
          Save Deviation
        </button>
      </div>
    </div>
  );
};
