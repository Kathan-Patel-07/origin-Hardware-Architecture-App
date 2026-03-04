
import { SubsystemJSON, SubsystemConnection } from '../services/github';
import { ConnectionRowExtended } from './jsonToConnectionRows';

function val(v: string | undefined): string | undefined {
  return v && v.trim() !== '' ? v.trim() : undefined;
}

export function rowsToSubsystemJSON(
  rows: ConnectionRowExtended[],
  original: SubsystemJSON
): SubsystemJSON {
  const connections: SubsystemConnection[] = rows.map((row) => {
    const flagged =
      !row.SourceComponentDatasheetLink?.trim() &&
      !row.SourceComponentPurchaseLink?.trim();

    return {
      id: row._connectionId,
      source: row.SourceComponent ?? '',
      sourcePartName: val(row.SourceComponentPartName),
      sourceDatasheet: val(row.SourceComponentDatasheetLink),
      sourcePurchaseLink: val(row.SourceComponentPurchaseLink),
      destination: row.DestinationComponent ?? '',
      destDatasheet: val(row.DestinationComponentDatasheetLink),
      destPurchaseLink: val(row.DestinationComponentPurchaseLink),
      architectureType: row.ArchitectureType ?? '',
      wireName: row.FunctionalWireName ?? '',
      wireSpec: row.WireSpecifications ?? '',
      functionalGroup: row.FunctionalGroup ?? '',
      sourceCompartment: row.SourceComponentCompartment ?? '',
      destCompartment: row.DestinationComponentCompartment ?? '',
      averagePower: val(row.AveragePower),
      maxContinuousPower: val(row.MaxContinuousPower),
      peakPower: val(row.PeakPower),
      peakPowerTransientTime: val(row.PeakPowerTransientTime),
      powerDirection: val(row.PowerDirection),
      notes: val(row.Notes),
      flagged: flagged || undefined,
    };
  });

  // Preserve all original top-level fields, only replace connections
  return { ...original, connections };
}
