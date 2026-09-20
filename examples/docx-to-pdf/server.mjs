import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { Worker } from 'node:worker_threads';

const root = fileURLToPath(new URL('.', import.meta.url));
const MAX_UPLOAD = 20 * 1024 * 1024;
const DEADLINE = 60_000;
/** One worker at a time. No upload, result, or job is retained after its request. */
export async function createPdfDemo({
  production = false,
  workerUrl = new URL('./worker.mjs', import.meta.url),
} = {}) {
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
        json(408, { message: 'Conversion exceeded 60 seconds.' });
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
          resourceLimits: { maxOldGenerationSizeMb: 512 },
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
        worker.once('error', () => {
          json(500, { message: 'The conversion worker failed.' });
          finish();
        });
        worker.once('exit', () => {
          if (!finished) {
            json(500, { message: 'The conversion worker stopped.' });
            finish();
          }
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
