import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { validateArchDoc } from './canvas/validateDoc';

const CANVAS_DATA_FILE = fileURLToPath(new URL('./canvas/data/architecture.json', import.meta.url));

// Dev-only store behind the canvas's devFileDataSource (canvas/dataSource.ts):
//   GET  /api/architecture  -> current JSON on disk
//   PUT  /api/architecture  -> overwrite it with the request body
// The dev server listens on 0.0.0.0 (so the Studio can be opened from other devices), which
// would also expose this WRITE endpoint to the LAN. It therefore answers loopback only, the
// exact path only (connect's use() is a prefix match), and writes only a valid document.
// Loopback by socket is not enough on its own: a DNS-rebinding page in the user's own browser
// connects from 127.0.0.1 too, and this middleware runs before Vite's host check. So the Host
// header must also name this machine, and a browser-sent Origin must be the same origin.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const hostnameOf = (hostHeader: string) => hostHeader.replace(/:\d+$/, '').toLowerCase();
/** Loopback socket + local Host + same-origin browser request; answers 403 otherwise. */
function refuseUnlessLocal(req: IncomingMessage, res: ServerResponse): boolean {
  const host = req.headers.host ?? '';
  const origin = req.headers.origin;
  const sameOrigin = !origin || origin === `http://${host}`;
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '') || !LOCAL_HOSTNAMES.has(hostnameOf(host)) || !sameOrigin) {
    res.statusCode = 403;
    res.end('canvas store is only available from this machine');
    return true;
  }
  return false;
}

// Writes are serialised and atomic: a debounced save and an unmount flush can arrive
// together, and a reader must never see a half-written file.
let writeChain: Promise<void> = Promise.resolve();
const MAX_BYTES = 20 * 1024 * 1024;
// Version of the stored document: a save must say which version it was based on (If-Match),
// so a second window cannot silently overwrite the first window's edits.
const etagOf = (text: string) => `"${createHash('sha1').update(text).digest('hex')}"`;
class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  // Raw bytes decoded once: decoding chunk by chunk corrupts a character split across chunks.
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new HttpError(413, 'document larger than 20 MB');
    chunks.push(chunk);
  }
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new HttpError(400, 'request body is not valid UTF-8');
  }
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new HttpError(400, `not JSON: ${(e as Error).message}`);
  }
}

// V4 (PRD-v4 D9): the data is the source of truth. The canvas edits it through operations on
// nodes/connections/catalog/harness map in a checkout of the data repo's `v4` branch
// (ORIGIN_V4_DIR, default ../Origin-Hardware-Architecture-v4); the drawing is rebuilt after each
// by that repo's tools/arch_ops.mjs. Dragged positions are saved to its v4/layout.json.
//   GET  /api/v4/status   is V4 available here; the last edits that Undo would take back
//   GET  /api/v4/data     nodes, connections, parts, harnesses (for the edit forms)
//   GET  /api/v4/canvas   the drawing          PUT /api/v4/canvas   positions only (If-Match)
//   POST /api/v4/op       one operation        POST /api/v4/undo    take the last one back
const V4_DIR = resolve(process.env.ORIGIN_V4_DIR ?? fileURLToPath(new URL('../Origin-Hardware-Architecture-v4', import.meta.url)));
type ArchOps = {
  PLAT: string;
  OpError: new (m: string) => Error;
  loadData(repo: string): unknown;
  planOp(repo: string, op: unknown): { files: Map<string, string | null>; summary: string };
  writeFiles(repo: string, files: Map<string, string | null>): Map<string, string | null>;
  logEdit(repo: string, entry: object): void;
  saveLayout(repo: string, doc: unknown): { layoutRel: string; text: string; canvasText: string };
  regenerate(repo: string): string;
};
function v4ArchitectureStore(): Plugin {
  const opsPath = resolve(V4_DIR, 'tools/arch_ops.mjs');
  // Re-imported when the file changes (a pull of the data repo), else Node keeps the first copy.
  let ops: { mtime: number; mod: Promise<ArchOps> } | null = null;
  const load = () => {
    const mtime = statSync(opsPath).mtimeMs;
    if (!ops || ops.mtime !== mtime)
      ops = { mtime, mod: import(/* @vite-ignore */ `${pathToFileURL(opsPath).href}?v=${mtime}`) as Promise<ArchOps> };
    return ops.mod;
  };
  // Undo: what the files held before each operation, newest last (this dev-server session).
  const undoStack: { summary: string; before: Map<string, string | null> }[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T,>(f: () => Promise<T> | T): Promise<T> => {
    const run = chain.then(f, f);
    chain = run.catch(() => {});
    return run;
  };
  return {
    name: 'canvas-v4-architecture-store',
    configureServer(server) {
      server.middlewares.use('/api/v4', async (req, res) => {
        if (refuseUnlessLocal(req, res)) return;
        const path = (req.url ?? '').split('?')[0].replace(/\/+$/, '');
        const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
          res.statusCode = status;
          res.setHeader('Cache-Control', 'no-store');
          for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
          if (typeof body === 'string') res.end(body);
          else {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(body));
          }
        };
        if (!existsSync(opsPath)) return send(404, `V4 data not found: no ${opsPath} (set ORIGIN_V4_DIR)`);
        try {
          const a = await load();
          const canvasFile = resolve(V4_DIR, `${a.PLAT}/canvas.json`);
          if (req.method === 'GET' && path === '/status')
            return send(200, { available: true, dir: V4_DIR, undo: undoStack.map((u) => u.summary).slice(-5) });
          if (req.method === 'GET' && path === '/data') return send(200, await serial(() => a.loadData(V4_DIR)));
          if (req.method === 'GET' && path === '/canvas') {
            const text = await serial(() => readFile(canvasFile, 'utf8'));
            return send(200, text, { 'Content-Type': 'application/json', ETag: etagOf(text) });
          }
          if (req.method === 'PUT' && path === '/canvas') {
            const doc = await readJsonBody(req);
            const problems = validateArchDoc(doc);
            if (problems.length) throw new HttpError(400, `invalid canvas document: ${problems.slice(0, 5).join('; ')}`);
            const tag = await serial(async () => {
              const current = etagOf(await readFile(canvasFile, 'utf8'));
              if (req.headers['if-match'] !== current)
                throw new HttpError(409, 'the V4 drawing was rebuilt since you loaded it - reload to see it');
              const saved = a.saveLayout(V4_DIR, doc);
              a.writeFiles(V4_DIR, new Map([[saved.layoutRel, saved.text], [`${a.PLAT}/canvas.json`, saved.canvasText]]));
              return etagOf(saved.canvasText);
            });
            return send(204, '', { ETag: tag });
          }
          if (req.method === 'POST' && path === '/op') {
            const op = await readJsonBody(req);
            const out = await serial(() => {
              const { files, summary } = a.planOp(V4_DIR, op);
              const before = a.writeFiles(V4_DIR, files);
              a.logEdit(V4_DIR, { op, summary, files: [...files.keys()] });
              undoStack.push({ summary, before });
              return { summary, etag: etagOf(a.regenerate(V4_DIR)) };
            });
            return send(200, out);
          }
          if (req.method === 'POST' && path === '/undo') {
            const out = await serial(() => {
              const last = undoStack.pop();
              if (!last) throw new HttpError(409, 'nothing to undo');
              a.writeFiles(V4_DIR, last.before);
              a.logEdit(V4_DIR, { undo: last.summary, files: [...last.before.keys()] });
              return { summary: `undid: ${last.summary}`, etag: etagOf(a.regenerate(V4_DIR)) };
            });
            return send(200, out);
          }
          send(404, 'unknown V4 endpoint');
        } catch (err) {
          const a = await load().catch(() => null);
          // OpError of any loaded copy of the module: a refusal, not a crash.
          const refused = (a && err instanceof a.OpError) || (err instanceof Error && err.constructor.name === 'OpError');
          const status = err instanceof HttpError ? err.status : refused ? 400 : 500;
          send(status, err instanceof Error ? err.message : String(err));
        }
      });
    },
  };
}

function canvasArchitectureStore(): Plugin {
  return {
    name: 'canvas-architecture-store',
    configureServer(server) {
      server.middlewares.use('/api/architecture', async (req, res, next) => {
        if (!['', '/'].includes((req.url ?? '').split('?')[0])) return next();
        if (refuseUnlessLocal(req, res)) return;
        try {
          if (req.method === 'GET') {
            await writeChain; // never read past a write that is still landing
            const text = await readFile(CANVAS_DATA_FILE, 'utf8');
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('ETag', etagOf(text));
            res.setHeader('Cache-Control', 'no-store');
            res.end(text);
            return;
          }
          if (req.method === 'PUT') {
            // Collect raw bytes and decode once. Decoding chunk by chunk (body += chunk)
            // corrupted any multi-byte character split across two network chunks.
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of req as AsyncIterable<Buffer>) {
              size += chunk.length;
              if (size > MAX_BYTES) throw new HttpError(413, 'document larger than 20 MB');
              chunks.push(chunk);
            }
            let body: string;
            try {
              body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
            } catch {
              throw new HttpError(400, 'request body is not valid UTF-8');
            }
            let data: unknown;
            try {
              data = JSON.parse(body);
            } catch (e) {
              throw new HttpError(400, `not JSON: ${(e as Error).message}`);
            }
            const problems = validateArchDoc(data);
            if (problems.length) throw new HttpError(400, `invalid canvas document: ${problems.slice(0, 5).join('; ')}`);
            const text = JSON.stringify(data, null, 2) + '\n';
            let newTag = '';
            const write = writeChain.then(async () => {
              const current = etagOf(await readFile(CANVAS_DATA_FILE, 'utf8'));
              const basedOn = req.headers['if-match'];
              if (!basedOn) throw new HttpError(428, 'If-Match required: say which version this edit is based on');
              if (basedOn !== current)
                throw new HttpError(409, 'the document was changed elsewhere since you loaded it - reload to see it');
              const tmp = `${CANVAS_DATA_FILE}.${process.pid}.tmp`;
              await writeFile(tmp, text);
              await rename(tmp, CANVAS_DATA_FILE);
              newTag = etagOf(text);
            });
            writeChain = write.catch(() => {});
            await write;
            res.statusCode = 204;
            res.setHeader('ETag', newTag);
            res.end();
            return;
          }
          res.statusCode = 405;
          res.end();
        } catch (err) {
          res.statusCode = err instanceof HttpError ? err.status : 400;
          res.end(err instanceof Error ? err.message : String(err));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), canvasArchitectureStore(), v4ArchitectureStore()],
  server: {
    host: '0.0.0.0',
    port: 8080,
    watch: {
      // The canvas saves this file itself; reloading on those saves would reset the page.
      ignored: ['**/canvas/data/architecture.json', `${V4_DIR}/**`],
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 8080,
  },
});
