import type { ArchData } from './data/architecture';
import { SaveError, type ArchitectureDataSource } from './dataSource';
import { assertArchDoc } from './validateDoc';

/**
 * V4 (PRD-v4 D9): the data is the source of truth and the drawing is derived from it.
 *
 * The dev server (vite.config.ts, /api/v4/*) runs the data repo's tools/arch_ops.mjs on a
 * checkout of its `v4` branch. Parts and connections change through operations (`runOp`);
 * the drawing is rebuilt after each one. Saving the drawing itself keeps only positions.
 */

export type ArchType = 'Power' | 'Comm' | 'Safety' | 'Ground';
export const ARCH_TYPES: ArchType[] = ['Power', 'Comm', 'Safety', 'Ground'];

export interface V4Node {
  nodeId: string;
  catalogRef: string;
  compartment: string;
  subsystem: string;
  flagged?: boolean;
}
export interface V4Connection {
  id: string;
  source: string;
  destination: string;
  architectureType: ArchType | '';
  wireName: string;
  wireSpec: string;
  functionalGroup: string;
  voltage?: string;
  notes?: string;
}
export interface V4TrackerPart {
  ipn: string;
  mpn: string;
  description: string;
  subsystem: string;
  subassembly: string;
}
export interface V4Data {
  platform: string;
  subsystems: string[];
  subsystemLabels: Record<string, string>;
  nodes: Record<string, V4Node[]>;
  connections: Record<string, V4Connection[]>;
  catalog: { partId: string; partName: string }[];
  tracker: V4TrackerPart[];
  harnesses: { subsystem: string; list: { key: string; name: string; what: string }[]; byConnection: Record<string, string> } | null;
}

export type V4Op =
  | { type: 'addPart'; subsystem: string; nodeId: string; catalogRef?: string; tracker?: Pick<V4TrackerPart, 'ipn' | 'mpn' | 'description'>; newPartName?: string; compartment?: string }
  | { type: 'editPart'; subsystem: string; nodeId: string; catalogRef?: string; tracker?: Pick<V4TrackerPart, 'ipn' | 'mpn' | 'description'>; newPartName?: string; compartment?: string }
  | { type: 'removePart'; subsystem: string; nodeId: string }
  | ({ type: 'addConnection'; subsystem: string; harness?: string } & Omit<V4Connection, 'id'>)
  | ({ type: 'editConnection'; subsystem: string; id: string; harness?: string } & Partial<Omit<V4Connection, 'id'>>)
  | { type: 'removeConnection'; subsystem: string; id: string }
  | { type: 'batch'; ops: V4Op[] };

async function text(r: Response) {
  return (await r.text()).slice(0, 300);
}

/** Is V4 editing available here (dev server with a v4 checkout)? */
export async function v4Available(): Promise<boolean> {
  if (!import.meta.env.DEV) return false;
  try {
    const r = await fetch('/api/v4/status', { cache: 'no-store' });
    return r.ok && Boolean(((await r.json()) as { available?: boolean }).available);
  } catch {
    return false;
  }
}

export async function v4Status(): Promise<{ undo: string[] }> {
  const r = await fetch('/api/v4/status', { cache: 'no-store' });
  if (!r.ok) throw new Error(await text(r));
  return r.json();
}

export async function loadV4Data(): Promise<V4Data> {
  const r = await fetch('/api/v4/data', { cache: 'no-store' });
  if (!r.ok) throw new Error(await text(r));
  return r.json();
}

/** Apply one operation; resolves with what it did, rejects with why it was refused. */
export async function runOp(op: V4Op): Promise<string> {
  const r = await fetch('/api/v4/op', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(op) });
  if (!r.ok) throw new Error(await text(r));
  return ((await r.json()) as { summary: string }).summary;
}

export async function undoOp(): Promise<string> {
  const r = await fetch('/api/v4/undo', { method: 'POST' });
  if (!r.ok) throw new Error(await text(r));
  return ((await r.json()) as { summary: string }).summary;
}

/** Block id on a generated sheet -> the architecture node it draws, if it draws one. */
export function nodeOfBlock(data: V4Data | null, blockId: string): { subsystem: string; nodeId: string } | null {
  if (!data) return null;
  const parts = blockId.split(':');
  const subsystem = parts[0];
  const nodeId = parts[parts.length - 1];
  return parts.length > 1 && data.nodes[subsystem]?.some((n) => n.nodeId === nodeId) ? { subsystem, nodeId } : null;
}

/** The drawing of V4: loaded from the dev server; a save keeps only positions. */
export function v4DataSource(): ArchitectureDataSource {
  let saveChain: Promise<unknown> = Promise.resolve();
  let baseVersion: string | null = null;
  return {
    label: 'the V4 data (dev server)',
    canSave: true,
    version: () => baseVersion,
    async load() {
      await saveChain.catch(() => {});
      const r = await fetch('/api/v4/canvas', { cache: 'no-store' });
      if (!r.ok) throw new Error(`load failed: ${r.status}`);
      const doc: unknown = await r.json();
      assertArchDoc(doc);
      baseVersion = r.headers.get('ETag');
      return doc as ArchData;
    },
    save(doc) {
      const body = JSON.stringify(doc);
      const run = saveChain
        .catch(() => {})
        .then(async () => {
          let r: Response;
          try {
            r = await fetch('/api/v4/canvas', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', ...(baseVersion ? { 'If-Match': baseVersion } : {}) },
              body,
            });
          } catch {
            throw new SaveError('unreachable', 'the dev server did not answer');
          }
          if (r.status === 409) throw new SaveError('conflict', await text(r));
          if (!r.ok) throw new SaveError('rejected', await text(r));
          baseVersion = r.headers.get('ETag') ?? baseVersion;
        });
      saveChain = run;
      return run;
    },
  };
}
