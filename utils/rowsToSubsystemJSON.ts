
import { ConnectionRowExtended } from './jsonToConnectionRows';

// Shape written to connections/{sub}.json
export interface ConnectionFileEntry {
  id: string;
  source: string;
  destination: string;
  architectureType: string;
  wireName: string;
  wireSpec: string;
  functionalGroup: string;
  maxContinuousPower: string;
  averagePower: string;
  peakPower: string;
  peakPowerTransientTime: string;
  powerDirection: string;
  voltage: string;
  notes: string;
  flagged: boolean;
  assembly: unknown;
}

function str(v: string | undefined): string {
  return v?.trim() ?? '';
}

/**
 * Converts editor rows back to the normalized connections/{sub}.json format.
 * Part names / datasheets / compartments are NOT written — those live in
 * catalog/ and nodes/ and are looked up at read time.
 *
 * @param rows        Rows for a single subsystem from the editor
 * @param assemblyMap Optional map of connectionId → assembly object to preserve
 *                    existing assembly state from the data repo
 */
export function rowsToConnectionsJSON(
  rows: ConnectionRowExtended[],
  assemblyMap: Record<string, unknown> = {}
): ConnectionFileEntry[] {
  const defaultAssembly = {
    status: 'not_started',
    assembledBy: null,
    assembledDate: null,
    deviation: null,
  };
  return rows.map((row) => {
    const id = row._connectionId ?? '';
    return {
      id,
      source: str(row.SourceComponent),
      destination: str(row.DestinationComponent),
      architectureType: str(row.ArchitectureType),
      wireName: str(row.FunctionalWireName),
      wireSpec: str(row.WireSpecifications),
      functionalGroup: str(row.FunctionalGroup),
      maxContinuousPower: str(row.MaxContinuousPower),
      averagePower: str(row.AveragePower),
      peakPower: str(row.PeakPower),
      peakPowerTransientTime: str(row.PeakPowerTransientTime),
      powerDirection: str(row.PowerDirection),
      voltage: str(row.Voltage),
      notes: str(row.Notes),
      flagged: row._flagged ?? false,
      assembly: assemblyMap[id] ?? defaultAssembly,
    };
  });
}
