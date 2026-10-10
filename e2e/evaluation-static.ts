/** Static harness serving keeps the compiler outside the browser's memory budget. */
import { file, serve } from 'bun';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ENTRY = 'e2e/evaluation-browser.html';

export async function staticHarness(cachedDirectory?: string) {
  const directory = cachedDirectory
    ? resolve(cachedDirectory)
    : await mkdtemp(resolve(tmpdir(), 'docx-browser-build-'));
  let ready = false;
  try {
    ready =
      (await readFile(resolve(directory, '.complete'), 'utf8')) === 'static-harness-v1' &&
      (await file(resolve(directory, ENTRY)).exists());
  } catch {
    /* Build below. */
  }
  if (!ready) {
    await mkdir(dirname(directory), { recursive: true });
    try {
      await rmdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(
          'Build cache must be empty or contain a completed harness; choose a new --build-dir'
        );
    }
    const staging = await mkdtemp(resolve(dirname(directory), '.browser-build-'));
    try {
      await new Promise<void>((done, reject) => {
        const child = spawn(
          'node',
          [
            resolve(ROOT, 'examples/vite/node_modules/vite/bin/vite.js'),
            'build',
            '--config',
            resolve(ROOT, 'e2e/evaluation-vite.config.mjs'),
            '--outDir',
            staging,
          ],
          {
            cwd: ROOT,
            stdio: ['ignore', 'ignore', 'pipe'],
            env: {
              ...process.env,
              NODE_ENV: 'production',
              USE_PUBLISHED_PACKAGES: 'false',
              VITE_BASE_PATH: '/',
              NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=512`.trim(),
            },
          }
        );
        let errors = '';
        child.stderr.on('data', (chunk: Buffer) => {
          errors = (errors + chunk.toString()).slice(-4000);
        });
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error('Browser harness build exceeded 120 seconds'));
        }, 120_000);
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          if (code === 0) done();
          else reject(new Error(`Browser harness build exited ${code}: ${errors}`));
        });
      });
      if (!(await file(resolve(staging, ENTRY)).exists()))
        throw new Error('Browser harness build produced no entry');
      await writeFile(resolve(staging, '.complete'), 'static-harness-v1');
      await rename(staging, directory);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  const server = serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(request.url).pathname);
      } catch {
        return new Response('Invalid URL', { status: 400 });
      }
      const target = resolve(directory, pathname === '/' ? ENTRY : `.${pathname}`);
      if (!target.startsWith(`${directory}${sep}`))
        return new Response('Not found', { status: 404 });
      const asset = file(target);
      return (await asset.exists())
        ? new Response(asset)
        : new Response('Not found', { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    async stop() {
      await server.stop(true);
      if (!cachedDirectory) await rm(directory, { recursive: true, force: true });
    },
  };
}
