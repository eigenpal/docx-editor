import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { Worker } from 'node:worker_threads';

const root = fileURLToPath(new URL('.', import.meta.url));
const MAX_UPLOAD = 20 * 1024 * 1024;
const DEFAULT_DEADLINE = 60_000;
/**
 * Old-space ceiling for one conversion, in MiB. Bounded on purpose; see the worker below.
 * The environment value is clamped: `NaN`, zero and absurd sizes would otherwise pass straight
 * into `resourceLimits` and either refuse every document or remove the ceiling entirely.
 */
const WORKER_HEAP_MB = clampHeapMb(process.env.WORKER_HEAP_MB);
function clampHeapMb(value) {
  const parsed = Number(value ?? 512);
  if (!Number.isFinite(parsed)) return 512;
  return Math.min(4096, Math.max(64, Math.round(parsed)));
}
/** One worker at a time. No upload, result, or job is retained after its request. */
export async function createPdfDemo({
  production = false,
  workerUrl = new URL('./worker.mjs', import.meta.url),
  deadlineMs = DEFAULT_DEADLINE,
} = {}) {
  const DEADLINE = deadlineMs;
  const vite = production
    ? null
    : await (
        await import('vite')
      ).createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  let active = false;
  const workers = new Set();
  const server = createServer(async (req, res) => {
    const json = (status, value) => {
      if (!res.destroyed && !res.writableEnded) {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(value));
      }
    };
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/convert') {
      if (req.method !== 'POST') return json(405, { message: 'Use POST.' });
      if (
        req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}` &&
        req.headers.origin !== `https://${req.headers.host}`
      )
        return json(403, { message: 'Use the same-origin demo.' });
      if (active)
        return json(503, { message: 'A conversion is already running. Retry when it finishes.' });
      const displayMode = url.searchParams.get('displayMode') ?? 'proposed';
      const comments = url.searchParams.get('comments') ?? 'true';
      const fidelityPolicy = url.searchParams.get('fidelityPolicy') ?? 'strict';
      if (
        !['proposed', 'original', 'all-markup'].includes(displayMode) ||
        !['true', 'false'].includes(comments) ||
        !['strict', 'best-effort'].includes(fidelityPolicy)
      )
        return json(400, { message: 'Invalid conversion option.' });
      if (Number(req.headers['content-length']) > MAX_UPLOAD)
        return json(413, { message: 'Upload limit is 20 MiB.' });
      active = true;
      let worker;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        active = false;
        clearTimeout(timer);
        if (worker) {
          workers.delete(worker);
          void worker.terminate();
        }
      };
      const timer = setTimeout(() => {
        json(408, { message: `Conversion exceeded ${Math.round(DEADLINE / 1000)} seconds.` });
        finish();
        req.destroy();
      }, DEADLINE);
      res.once('close', finish);
      try {
        const chunks = [];
        let length = 0;
        for await (const chunk of req) {
          if (finished) return;
          length += chunk.length;
          if (length > MAX_UPLOAD) {
            json(413, { message: 'Upload limit is 20 MiB.' });
            finish();
            return;
          }
          chunks.push(chunk);
        }
        if (finished) return;
        if (!length) {
          json(400, { message: 'Choose a DOCX file.' });
          finish();
          return;
        }
        const bytes = new Uint8Array(Buffer.concat(chunks));
        worker = new Worker(workerUrl, {
          workerData: {
            bytes: bytes.buffer,
            options: {
              displayMode,
              comments: comments === 'true',
              fidelityPolicy,
              timeoutMs: DEADLINE,
            },
          },
          transferList: [bytes.buffer],
          // A 521-page document converts inside 512 MiB with about 380 MiB of old space in
          // use, and fails below roughly 448. The cap is deliberate — one request must not
          // be able to take the host down — so a document past it is refused, not served
          // slowly. `WORKER_HEAP_MB` raises it for a local experiment.
          resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
        });
        workers.add(worker);
        worker.once('message', (result) => {
          if (finished) return;
          if (result.ok)
            json(200, {
              ...result,
              bytes: undefined,
              pdf: Buffer.from(result.bytes).toString('base64'),
            });
          else json(result.error === 'PdfFidelityError' ? 422 : 400, result);
          finish();
        });
        // A heap the worker cannot grow arrives as `ERR_WORKER_OUT_OF_MEMORY`. That, and only
        // that, is "the document is too large for the budget", which is worth saying because
        // a generic failure reads as a converter bug and invites a pointless retry. Every
        // other failure — an import that did not resolve, a thrown bug, a bare non-zero exit —
        // is a 500: calling those "needs more memory" would send the operator to raise a
        // limit that has nothing to do with it.
        const tooLarge = () => {
          json(507, {
            message: `The document needs more memory than this demo allows (${WORKER_HEAP_MB} MiB). Convert a smaller document, or raise WORKER_HEAP_MB.`,
          });
          finish();
        };
        worker.once('error', (error) => {
          if (finished) return;
          if (error?.code === 'ERR_WORKER_OUT_OF_MEMORY') tooLarge();
          else {
            json(500, { message: 'The conversion worker failed.' });
            finish();
          }
        });
        worker.once('exit', (code) => {
          if (finished) return;
          json(500, {
            message:
              code === 0
                ? 'The conversion worker stopped without a result.'
                : `The conversion worker failed (exit ${code}).`,
          });
          finish();
        });
      } catch {
        json(400, { message: 'The upload could not be read.' });
        finish();
      }
      return;
    }
    if (url.pathname === '/sample.docx') {
      try {
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        res.end(await readFile(resolve(root, 'public/sample.docx')));
      } catch {
        res.writeHead(404);
        res.end();
      }
      return;
    }
    if (vite) return vite.middlewares(req, res);
    try {
      const target = url.pathname.startsWith('/assets/')
        ? resolve(root, `dist${url.pathname}`)
        : resolve(root, 'dist/index.html');
      if (!target.startsWith(resolve(root, 'dist') + '/')) {
        res.writeHead(404);
        res.end();
        return;
      }
      const content = await readFile(target);
      res.writeHead(200, {
        // `.wasm` needs its own type or `WebAssembly.compileStreaming` refuses the response
        // and the shaper falls back to a slower ArrayBuffer instantiation. A fixed map, not
        // a lookup library: these are the only types this demo serves.
        'Content-Type':
          {
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.html': 'text/html',
            '.svg': 'image/svg+xml',
            '.wasm': 'application/wasm',
            '.woff2': 'font/woff2',
            '.json': 'application/json',
          }[extname(target)] ?? 'application/octet-stream',
      });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return {
    server,
    async close() {
      for (const worker of workers) await worker.terminate();
      await vite?.close();
      await new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
    },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createPdfDemo({ production: process.argv.includes('--production') });
  const port = Number(process.env.PORT ?? 5180);
  app.server.listen(port, '127.0.0.1', () => console.log(`DOCX to PDF: http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void app.close().then(() => process.exit());
    });
}
