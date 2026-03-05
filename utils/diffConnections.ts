
import { ConnectionRowExtended } from './jsonToConnectionRows';

export type DiffType = 'added' | 'removed' | 'modified';

export interface FieldChange {
  field: string;
  label: string;
  base: string;
  compare: string;
}

export interface DiffEntry {
  type: DiffType;
  connectionId: string;
  subsystem: string;
  subsystemLabel: string;
  baseRow?: ConnectionRowExtended;
  compareRow?: ConnectionRowExtended;
  changes?: FieldChange[];
}

export interface DiffResult {
  entries: DiffEntry[];
  added: number;
  removed: number;
  modified: number;
}

const COMPARABLE_FIELDS: { field: keyof ConnectionRowExtended; label: string }[] = [
  { field: 'SourceComponent',                   label: 'Source Component'       },
  { field: 'DestinationComponent',              label: 'Destination Component'  },
  { field: 'ArchitectureType',                  label: 'Architecture Type'      },
  { field: 'FunctionalWireName',                label: 'Wire Name'              },
  { field: 'WireSpecifications',                label: 'Wire Spec'              },
  { field: 'FunctionalGroup',                   label: 'Functional Group'       },
  { field: 'SourceComponentCompartment',        label: 'Source Compartment'     },
  { field: 'DestinationComponentCompartment',   label: 'Destination Compartment'},
  { field: 'MaxContinuousPower',                label: 'Max Continuous Power'   },
  { field: 'PowerDirection',                    label: 'Power Direction'        },
];

export function diffConnections(
  baseRows: ConnectionRowExtended[],
  compareRows: ConnectionRowExtended[]
): DiffResult {
  const baseMap = new Map<string, ConnectionRowExtended>();
  const compareMap = new Map<string, ConnectionRowExtended>();

  for (const row of baseRows) {
    if (row._connectionId) baseMap.set(row._connectionId, row);
  }
  for (const row of compareRows) {
    if (row._connectionId) compareMap.set(row._connectionId, row);
  }

  const allIds = new Set([...baseMap.keys(), ...compareMap.keys()]);
  const entries: DiffEntry[] = [];
  let added = 0, removed = 0, modified = 0;

  for (const id of allIds) {
    const base = baseMap.get(id);
    const compare = compareMap.get(id);

    if (!base && compare) {
      added++;
      entries.push({
        type: 'added',
        connectionId: id,
        subsystem: compare._subsystem ?? '',
        subsystemLabel: compare._subsystemLabel ?? compare._subsystem ?? '',
        compareRow: compare,
      });
    } else if (base && !compare) {
      removed++;
      entries.push({
        type: 'removed',
        connectionId: id,
        subsystem: base._subsystem ?? '',
        subsystemLabel: base._subsystemLabel ?? base._subsystem ?? '',
        baseRow: base,
      });
    } else if (base && compare) {
      const changes: FieldChange[] = [];
      for (const { field, label } of COMPARABLE_FIELDS) {
        const b = String(base[field] ?? '');
        const c = String(compare[field] ?? '');
        if (b !== c) changes.push({ field: field as string, label, base: b, compare: c });
      }
      if (changes.length > 0) {
        modified++;
        entries.push({
          type: 'modified',
          connectionId: id,
          subsystem: base._subsystem ?? '',
          subsystemLabel: base._subsystemLabel ?? base._subsystem ?? '',
          baseRow: base,
          compareRow: compare,
          changes,
        });
      }
    }
  }

  // Sort: by subsystem then connectionId for stable ordering
  entries.sort((a, b) =>
    a.subsystem.localeCompare(b.subsystem) || a.connectionId.localeCompare(b.connectionId)
  );

  return { entries, added, removed, modified };
}
