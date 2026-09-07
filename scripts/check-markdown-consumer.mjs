#!/usr/bin/env node
// Run after installing the packed packages in a consumer project. Exercise real server
// bundles outside that project's node_modules tree, including fonts and pagination.
import assert from 'node:assert/strict';
import { realpathSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const consumer = realpathSync(path.resolve(process.argv[2]));
const root = path.resolve(import.meta.dirname, '..');
const fixture = path.join(root, 'packages/docx-to-markdown/test/fixtures/narrow-pages.docx');
function run(command, args, cwd = consumer) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
run('npm', [
  'install',
  '--ignore-scripts',
  'next@16.3.4',
  '@langchain/core@1.2.9',
  '@types/node@22',
]);
cpSync(fixture, path.join(consumer, 'narrow-pages.docx'));
writeFileSync(
  path.join(consumer, 'markdown-node.mts'),
  `
import { readFile } from 'node:fs/promises';
import { Document } from '@langchain/core/documents';
import { exportMarkdown } from '@docx-editor.dev/docx-to-markdown';
const docxBytes = await readFile('narrow-pages.docx');
const result = await exportMarkdown(docxBytes);
console.log(result.markdown);
const documents = result.pages.map(page => new Document({
  pageContent: page.markdown, metadata: { source: 'narrow-pages.docx', page: page.number },
}));
if (documents.length !== 15 || documents[14]?.metadata.page !== 15) throw new Error('Page metadata lost');
if (result.warnings.length) throw new Error(JSON.stringify(result.warnings));
`
);
run('node', [
  'node_modules/typescript/bin/tsc',
  '--target',
  'ES2022',
  '--lib',
  'ES2022',
  '--module',
  'NodeNext',
  '--types',
  'node',
  '--strict',
  '--skipLibCheck',
  'false',
  '--outDir',
  'markdown-check',
  'markdown-node.mts',
]);
run('node', ['markdown-check/markdown-node.mjs']);

const nextApp = path.join(consumer, 'markdown-next');
mkdirSync(path.join(nextApp, 'app/api/convert'), { recursive: true });
writeFileSync(
  path.join(nextApp, 'package.json'),
  JSON.stringify({ private: true, type: 'module' })
);
writeFileSync(
  path.join(nextApp, 'app/layout.js'),
  'export default function Layout({children}) { return <html><body>{children}</body></html>; }'
);
writeFileSync(
  path.join(nextApp, 'app/page.js'),
  'export default function Page() { return <p>DOCX conversion test</p>; }'
);
writeFileSync(
  path.join(nextApp, 'app/api/convert/route.js'),
  `
import { exportMarkdown } from '@docx-editor.dev/docx-to-markdown';
export const runtime = 'nodejs';
export async function POST(request) {
  const docxBytes = new Uint8Array(await request.arrayBuffer());
  const result = await exportMarkdown(docxBytes);
  return Response.json(result);
}`
);
async function availablePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
for (const [bundler, external] of [
  ['--webpack', true],
  ['--turbopack', true],
  ['--webpack', false],
]) {
  writeFileSync(
    path.join(nextApp, 'next.config.mjs'),
    `export default {
  output: 'standalone', outputFileTracingRoot: ${JSON.stringify(consumer)},
  serverExternalPackages: ${JSON.stringify(external ? ['@docx-editor.dev/docx-to-markdown', '@docx-editor.dev/core', '@docx-editor.dev/fonts'] : [])},
};`
  );

  rmSync(path.join(nextApp, '.next'), { recursive: true, force: true });
  run('node', [path.join(consumer, 'node_modules/next/dist/bin/next'), 'build', bundler], nextApp);
  const isolated = mkdtempSync(path.join(tmpdir(), 'markdown-standalone-'));
  let server;
  try {
    cpSync(path.join(nextApp, '.next/standalone'), isolated, { recursive: true });
    const port = await availablePort();
    server = spawn('node', ['markdown-next/server.js'], {
      cwd: isolated,
      stdio: 'inherit',
      env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1' },
    });
    const endpoint = `http://127.0.0.1:${port}/api/convert`;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw new Error('Standalone server exited');
      try {
        await fetch(endpoint, { signal: AbortSignal.timeout(1000) });
        ready = true;
        break;
      } catch {
        await delay(100);
      }
    }
    assert.ok(ready, 'Standalone server did not start');
    const { readFile } = await import('node:fs/promises');
    const response = await fetch(endpoint, {
      method: 'POST',
      body: await readFile(fixture),
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    if (external) {
      assert.equal(result.pages.length, 15, 'Font regression changed page boundaries');
      assert.deepEqual(result.warnings, []);
      assert.ok(
        result.fontResolution.families.some(
          (family) => family.family === 'Calibri' && family.coverage === 'complete'
        )
      );
      assert.ok(result.pages.every((page, index) => page.number === index + 1 && page.markdown));
      console.log(`Markdown ${bundler}: 15 pages, complete bundled font coverage, no warnings`);
    } else {
      assert.ok(
        result.warnings.some(
          (warning) =>
            warning.code === 'font-origin-failed' &&
            warning.message.includes('serverExternalPackages')
        ),
        'Missing fonts must explain the deployment fix'
      );
      assert.ok(result.warnings.some((warning) => warning.code === 'incomplete-font'));
      console.log('Markdown bundled Webpack: font failures are reported in the result');
    }
  } finally {
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise((resolve) => server.once('exit', resolve));
    }
    rmSync(isolated, { recursive: true, force: true });
  }
}
