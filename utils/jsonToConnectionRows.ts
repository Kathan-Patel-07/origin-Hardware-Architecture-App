
import { ConnectionRow } from '../types';
import { SubsystemJSON, SubsystemConnection } from '../services/github';

export interface ConnectionRowExtended extends ConnectionRow {
  _subsystem?: string;        // subsystem key e.g. "moma"
  _subsystemLabel?: string;   // display name e.g. "MoMa"
  _connectionId?: string;     // stable ID for edits/saves
  _flagged?: boolean;
  SourceComponentPurchaseLink?: string;
  DestinationComponentDatasheetLink?: string;
  DestinationComponentPurchaseLink?: string;
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

export function subsystemToRows(
  sub: SubsystemJSON,
  subsystemLabel?: string
): ConnectionRowExtended[] {
  return sub.connections.map((c: SubsystemConnection, idx: number) => {
    const flagged =
      c.flagged === true ||
      (!c.sourceDatasheet && !c.sourcePurchaseLink);

    return {
      // Core ConnectionRow fields
      SourceComponent: toStr(c.source),
      SourceComponentPartName: toStr(c.sourcePartName),
      SourceComponentDatasheetLink: toStr(c.sourceDatasheet),
      DestinationComponent: toStr(c.destination),
      ArchitectureType: toStr(c.architectureType),
      FunctionalWireName: toStr(c.wireName),
      WireSpecifications: toStr(c.wireSpec),
      FunctionalGroup: toStr(c.functionalGroup),
      SourceComponentCompartment: toStr(c.sourceCompartment),
      DestinationComponentCompartment: toStr(c.destCompartment),
      AveragePower: toStr(c.averagePower),
      MaxContinuousPower: toStr(c.maxContinuousPower),
      PeakPower: toStr(c.peakPower),
      PeakPowerTransientTime: toStr(c.peakPowerTransientTime),
      PowerDirection: toStr(c.powerDirection) as 'SD' | 'DS' | '',
      Notes: toStr(c.notes),

      // Extended fields
      SourceComponentPurchaseLink: toStr(c.sourcePurchaseLink),
      DestinationComponentDatasheetLink: toStr(c.destDatasheet),
      DestinationComponentPurchaseLink: toStr(c.destPurchaseLink),

      // Metadata
      _subsystem: sub.key,
      _subsystemLabel: subsystemLabel ?? sub.name ?? sub.key,
      _connectionId: toStr(c.id) || `${sub.key}-${idx}`,
      _flagged: flagged,
    } as ConnectionRowExtended;
  });
}

export function allSubsystemsToRows(
  subsystems: SubsystemJSON[],
  labelMap?: Record<string, string>
): ConnectionRowExtended[] {
  return subsystems.flatMap((sub) =>
    subsystemToRows(sub, labelMap?.[sub.key] ?? sub.name ?? sub.key)
  );
}
