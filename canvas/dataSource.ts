import type { ArchData } from './data/architecture';
import { assertArchDoc } from './validateDoc';

/**
 * Where the canvas document is loaded from and saved to.
 *
 * The canvas never talks to storage directly — it only sees this interface — so the
 * backing store (dev file today; GitHub API or a real backend later) can be swapped
 * without touching the editor.
 */
export interface ArchitectureDataSource {
  /** Shown in the UI when saving fails, e.g. which service to check. */
  readonly label: string;
  /** False for read-only sources: the editor hides every edit control. */
  readonly canSave: boolean;
  load(): Promise<ArchData>;
  save(doc: ArchData): Promise<void>;
}

/** Why a save failed, in terms the editor can show. */
export class SaveError extends Error {
  /** 'conflict': someone else saved first; 'rejected': the store refused the document;
   *  'unreachable': no answer. */
  readonly kind: 'conflict' | 'rejected' | 'unreachable';
  constructor(kind: 'conflict' | 'rejected' | 'unreachable', message: string) {
    super(message);
    this.kind = kind;
  }
}

/**
 * Dev-only source: the Vite middleware in vite.config.ts reads and writes
 * canvas/data/architecture.json on disk. Not available in a static build.
 */
// Saves go out one at a time, in the order they were made, so a slow earlier save can
// never land after (and overwrite) a later one; a load waits for saves still in flight,
// so returning to the tab never reads a document older than the last edit.
let saveChain: Promise<unknown> = Promise.resolve();
// Version of the document this window last loaded or saved (the store's ETag). Each save
// says which version it is based on, so another window's save is never overwritten.
let baseVersion: string | null = null;

export const devFileDataSource: ArchitectureDataSource = {
  label: 'the dev server',
  canSave: true,
  async load() {
    await saveChain.catch(() => {});
    const r = await fetch('/api/architecture', { cache: 'no-store' });
    if (!r.ok) throw new Error(`load failed: ${r.status}`);
    const doc: unknown = await r.json();
    assertArchDoc(doc);
    baseVersion = r.headers.get('ETag');
    return doc;
  },
  save(doc) {
    const body = JSON.stringify(doc);
    const run = saveChain
      .catch(() => {})
      .then(async () => {
        let r: Response;
        try {
          r = await fetch('/api/architecture', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...(baseVersion ? { 'If-Match': baseVersion } : {}) },
            body,
          });
        } catch {
          throw new SaveError('unreachable', 'the dev server did not answer');
        }
        if (r.status === 409) throw new SaveError('conflict', await r.text());
        if (!r.ok) throw new SaveError('rejected', `${r.status}: ${(await r.text()).slice(0, 200)}`);
        baseVersion = r.headers.get('ETag') ?? baseVersion;
      });
    saveChain = run;
    return run;
  },
};

/** Read-only source: the copy bundled into the build. */
export function bundledDataSource(doc: ArchData): ArchitectureDataSource {
  return {
    label: 'the bundled copy',
    canSave: false,
    load: async () => {
      assertArchDoc(doc);
      return doc;
    },
    save: async () => {
      throw new Error('read-only data source');
    },
  };
}
