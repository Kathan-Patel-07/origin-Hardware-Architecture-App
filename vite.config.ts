import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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
function canvasArchitectureStore(): Plugin {
  return {
    name: 'canvas-architecture-store',
    configureServer(server) {
      server.middlewares.use('/api/architecture', async (req, res, next) => {
        if (!['', '/'].includes((req.url ?? '').split('?')[0])) return next();
        const host = req.headers.host ?? '';
        const origin = req.headers.origin;
        const sameOrigin = !origin || origin === `http://${host}`;
        if (!LOOPBACK.has(req.socket.remoteAddress ?? '') || !LOCAL_HOSTNAMES.has(hostnameOf(host)) || !sameOrigin) {
          res.statusCode = 403;
          res.end('canvas store is only available from this machine');
          return;
        }
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
  plugins: [react(), canvasArchitectureStore()],
  server: {
    host: '0.0.0.0',
    port: 8080,
    watch: {
      // The canvas saves this file itself; reloading on those saves would reset the page.
      ignored: ['**/canvas/data/architecture.json'],
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 8080,
  },
});
