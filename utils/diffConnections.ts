
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

// Semantic key: identity of a connection is who it connects and what it carries.
// This is stable across deletions/renumbering of other connections in the array.
function semanticKey(row: ConnectionRowExtended): string {
  const sub  = row._subsystem ?? '';
  const src  = row.SourceComponent ?? '';
  const dst  = row.DestinationComponent ?? '';
  const grp  = row.FunctionalGroup ?? '';
  const wire = row.FunctionalWireName ?? '';
  return `${sub}::${src}::${dst}::${grp}::${wire}`;
}

export function diffConnections(
  baseRows: ConnectionRowExtended[],
  compareRows: ConnectionRowExtended[]
): DiffResult {
  const baseMap = new Map<string, ConnectionRowExtended>();
  const compareMap = new Map<string, ConnectionRowExtended>();

  for (const row of baseRows) {
    baseMap.set(semanticKey(row), row);
  }
  for (const row of compareRows) {
    compareMap.set(semanticKey(row), row);
  }

  const allKeys = new Set([...baseMap.keys(), ...compareMap.keys()]);
  const entries: DiffEntry[] = [];
  let added = 0, removed = 0, modified = 0;

  for (const key of allKeys) {
    const base = baseMap.get(key);
    const compare = compareMap.get(key);

    if (!base && compare) {
      added++;
      entries.push({
        type: 'added',
        connectionId: compare._connectionId ?? key,
        subsystem: compare._subsystem ?? '',
        subsystemLabel: compare._subsystemLabel ?? compare._subsystem ?? '',
        compareRow: compare,
      });
    } else if (base && !compare) {
      removed++;
      entries.push({
        type: 'removed',
        connectionId: base._connectionId ?? key,
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
          connectionId: base._connectionId ?? key,
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
