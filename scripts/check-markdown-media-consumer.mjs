#!/usr/bin/env node
// Build packages first. Test installed tarballs, never workspace source aliases.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build, preview } from 'vite';
import { chromium } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'markdown-media-consumer-')));
const consumer = path.join(temporary, 'consumer');
let server;
let browser;
function run(command, args, cwd = consumer) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    process.stderr.write(String(error.stdout ?? '') + String(error.stderr ?? ''));
    throw error;
  }
}

try {
  await mkdir(consumer);
  const dependencies = {};
  for (const name of ['core', 'fonts', 'i18n', 'docx-to-markdown']) {
    const directory = path.join(root, 'packages', name);
    const packed = JSON.parse(
      run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], directory)
    )[0];
    dependencies[`@docx-editor.dev/${name}`] = `file:${path.join(temporary, packed.filename)}`;
  }
  dependencies['@types/node'] = '22.19.17';
  dependencies.typescript = JSON.parse(
    await readFile(path.join(root, 'node_modules/typescript/package.json'), 'utf8')
  ).version;
  await writeFile(
    path.join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module', dependencies })
  );
  run('bun', ['install', '--ignore-scripts']);
  await cp(
    path.join(root, 'e2e/fixtures/example-with-image.docx'),
    path.join(consumer, 'input.docx')
  );

  const program = `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as api from '@docx-editor.dev/docx-to-markdown';
import { writeMarkdownBundle } from '@docx-editor.dev/docx-to-markdown/node';
async function main() {
  const error: api.MarkdownMediaError = new api.MarkdownMediaError('media-limit', 'Limit');
  const bundleError: api.MarkdownBundleError = new api.MarkdownBundleError('output-not-empty', 'Folder');
  void [error, bundleError];
  const result: api.MarkdownExportResult = await api.exportMarkdown(await readFile('input.docx'), { images: true });
  assert.equal(result.media.length, 1);
  assert.equal(result.media[0]!.byteLength, 789);
  assert.ok(result.markdown.includes('!['));
  const sized = await api.exportMarkdown(await readFile('input.docx'), { images: { syntax: 'html' } });
  assert.ok(sized.markdown.includes('<img '));
  assert.ok(sized.markdown.includes('width="' + Math.round(sized.media[0]!.occurrences[0]!.displayWidthPx) + '"'));
  assert.ok(sized.media[0]!.occurrences[0]!.displayHeightPx > 0);
  assert.ok((await api.createMarkdownZip(result)).length > 789);
  assert.ok((await api.createMarkdownZip({ ...result, markdown: 'Large ZIP payload\\n'.repeat(20000) })).length > 789);
  assert.ok(!('bytes' in api.toMarkdownJSON(result).media[0]!));
  await writeMarkdownBundle(result, { directory: 'OUTPUT' });
  const exported: typeof import('@docx-editor.dev/docx-to-markdown', { with: { 'resolution-mode': 'import' } }) = api;
  void exported;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
`;
  for (const extension of ['mts', 'cts']) {
    const filename = `consumer.${extension}`;
    await writeFile(
      path.join(consumer, filename),
      program.replace('OUTPUT', `output-${extension}`)
    );
    const config = `tsconfig-${extension}.json`;
    await writeFile(
      path.join(consumer, config),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          lib: ['ES2022'],
          types: ['node'],
          strict: true,
          skipLibCheck: false,
          outDir: `compiled-${extension}`,
        },
        files: [filename],
      })
    );
    run('node', ['node_modules/typescript/bin/tsc', '-p', config]);
    run('node', [`compiled-${extension}/consumer.${extension === 'mts' ? 'mjs' : 'cjs'}`]);
    await rm(path.join(consumer, `output-${extension}`), { recursive: true });
    run('bun', [`compiled-${extension}/consumer.${extension === 'mts' ? 'mjs' : 'cjs'}`]);
  }
  console.log('Packed Node/Bun ESM/CommonJS: types, conversion, JSON, large ZIP, filesystem OK');

  await writeFile(
    path.join(consumer, 'index.html'),
    '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="worker-src \'none\'"></head><body><main>Image export smoke test</main><script type="module" src="/main.js"></script></body></html>'
  );
  await writeFile(
    path.join(consumer, 'main.js'),
    `
import { exportMarkdown, createMarkdownZip, toMarkdownJSON } from '@docx-editor.dev/docx-to-markdown';
window.runImageExport = async () => {
  const result = await exportMarkdown(new Uint8Array(await (await fetch('/input.docx')).arrayBuffer()), { images: true });
  const asset = result.media[0];
  const image = document.createElement('img');
  const url = URL.createObjectURL(new Blob([asset.bytes], {type: asset.mimeType}));
  image.src = url; document.querySelector('main').append(image); await image.decode();
  const width = image.naturalWidth;
  const zip = await createMarkdownZip(result);
  const largeZip = await createMarkdownZip({ ...result, markdown: 'Large ZIP payload\\n'.repeat(20000) });
  URL.revokeObjectURL(url);
  return { bytes: asset.byteLength, width, zipBytes: zip.length, largeZipBytes: largeZip.length, markdown: result.markdown, json: toMarkdownJSON(result), warnings: result.warnings };
};
`
  );
  // Vite copies public assets, including the test input, into the actual production output.
  await mkdir(path.join(consumer, 'public'));
  await cp(path.join(consumer, 'input.docx'), path.join(consumer, 'public/input.docx'));
  await build({
    configFile: false,
    root: consumer,
    logLevel: 'error',
    build: { outDir: 'browser-dist', emptyOutDir: true },
  });
  server = await preview({
    configFile: false,
    root: consumer,
    logLevel: 'error',
    build: { outDir: 'browser-dist' },
    preview: { host: '127.0.0.1', port: 0, strictPort: true },
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => typeof window.runImageExport === 'function');
  const result = await page.evaluate(() => window.runImageExport());
  assert.equal(result.bytes, 789);
  assert.ok(result.width > 0);
  assert.ok(result.zipBytes > result.bytes);
  assert.ok(result.largeZipBytes > result.bytes);
  assert.ok(!('bytes' in result.json.media[0]));
  assert.ok(
    !result.warnings.some(
      (w) => w.code === 'font-origin-failed' || w.code === 'image-placement-fallback'
    )
  );
  console.log(
    'Packed browser production bundle: fonts/WASM, image decode, large ZIP with workers blocked, JSON OK'
  );

  // Isolate the Markdown facade to measure its own ZIP dependency, not Core's required DOCX ZIP parser.
  await writeFile(
    path.join(consumer, 'shake.js'),
    "export { exportMarkdown } from '@docx-editor.dev/docx-to-markdown';"
  );
  let output;
  let retainedModules;
  let retainedImports;
  await build({
    configFile: false,
    root: consumer,
    logLevel: 'error',
    plugins: [
      {
        name: 'capture-output',
        generateBundle(_options, bundle) {
          const chunks = Object.values(bundle).filter((entry) => entry.type === 'chunk');
          output = chunks.map((entry) => entry.code).join('\n');
          retainedModules = chunks.flatMap((entry) =>
            Object.entries(entry.modules)
              .filter(([, details]) => details.renderedLength > 0)
              .map(([id]) => id)
          );
          retainedImports = chunks.flatMap((entry) => entry.imports);
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: path.join(consumer, 'shake.js'), formats: ['es'] },
      rollupOptions: {
        external: (id) =>
          id.startsWith('@docx-editor.dev/core') || id.startsWith('@docx-editor.dev/fonts'),
        input: path.join(consumer, 'shake.js'),
      },
    },
  });
  assert.ok(!output.includes('__vite-browser-external'));
  assert.ok(!retainedImports.some((id) => /^(?:node:)?fs(?:\/|$)/.test(id)));
  assert.ok(!retainedModules.some((id) => /[/\\]fflate[/\\]/.test(id)));
  console.log(
    'Unused ZIP helper: fflate eliminated; main browser graph contains no filesystem import'
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
