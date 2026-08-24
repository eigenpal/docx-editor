#!/usr/bin/env node
// What a consumer actually receives, exercised against the tarball rather than against `src`.
//
// Everything else in this package is checked against source: the tests import `../index.ts`, the
// API snapshots are extracted from `dist/*.d.ts`, and the boundary tests read the import graph.
// None of that can catch the failures that only exist in the published artifact:
//
//   - a `files` list that ships the whole compat corpus, or forgets `dist`;
//   - an `exports` target pointing at a file the build never emitted;
//   - a bundle that resolves at build time and throws on `import` in a plain Node process;
//   - `require()` of the CJS output returning something a consumer cannot use;
//   - the font shaper, the editor lane or a Node builtin leaking into the SERVER bundle;
//   - a bare import other than the declared core peer, or core being inlined and creating
//     a second engine in a page that already has one through an adapter.
//
// So this packs the package with `npm pack`, unpacks it into a temporary directory, and drives the
// unpacked files with a plain `node`. No registry and no network: the unpacked package is linked to
// the workspace's built core, exactly the one declared peer dependency a real install resolves.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';

const PACKAGE = path.resolve(import.meta.dirname, '..');
const CORE_PACKAGE = path.resolve(PACKAGE, '..', 'core');
const manifest = JSON.parse(readFileSync(path.join(PACKAGE, 'package.json'), 'utf8'));
const coreManifest = JSON.parse(readFileSync(path.join(CORE_PACKAGE, 'package.json'), 'utf8'));

/** Bare `@docx-editor.dev/core` specifiers a bundle may keep external. */
function allowedCoreBareSpecifiers(exports) {
  const allowed = new Set();
  for (const [subpath, target] of Object.entries(exports)) {
    if (subpath === './package.json') continue;
    if (typeof target === 'string') continue;
    if (typeof target !== 'object') continue;
    allowed.add(
      subpath === '.' ? '@docx-editor.dev/core' : `@docx-editor.dev/core${subpath.slice(1)}`
    );
  }
  return allowed;
}

/** Built output each allowed bare specifier must resolve to. */
function coreExportTargets(exports) {
  const targets = new Map();
  for (const [subpath, target] of Object.entries(exports)) {
    if (typeof target !== 'object') continue;
    const bare =
      subpath === '.' ? '@docx-editor.dev/core' : `@docx-editor.dev/core${subpath.slice(1)}`;
    targets.set(bare, { import: target.import, require: target.require });
  }
  return targets;
}

const ALLOWED_CORE = allowedCoreBareSpecifiers(coreManifest.exports);
const CORE_TARGETS = coreExportTargets(coreManifest.exports);

function bareImports(source) {
  return [
    ...source.matchAll(
      /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']([^"'.][^"']*)["']/g
    ),
  ].map((match) => match[1]);
}

const failures = [];
function check(ok, message) {
  if (ok) return;
  failures.push(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? PACKAGE,
    encoding: 'utf8',
    input: options.input,
    // A smoke test that reached the network would pass or fail for reasons that have nothing to
    // do with this package. Off explicitly rather than by assumption.
    env: {
      ...process.env,
      npm_config_offline: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
  });
  if (result.status !== 0 && !options.allowFailure) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}`);
  }
  return result;
}

/** A minimal real DOCX, so the smoke test drives a document instead of only importing a module. */
function fixtureDocx(text) {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${CT}">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `</Types>`
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL}"/>`
    ),
    'word/document.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>` +
        `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>` +
        `</w:body></w:document>`
    ),
  });
}

const temp = mkdtempSync(path.join(tmpdir(), 'docx-editor-editor-api-pack-'));
try {
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    if (typeof target !== 'object') continue;
    for (const file of Object.values(target)) {
      if (!existsSync(path.join(PACKAGE, file))) {
        console.error(
          `${manifest.name} ${subpath} points at ${file}, which is not built.\n` +
            `Fix: bun run --filter '${manifest.name}' build`
        );
        process.exit(1);
      }
    }
  }

  const packDir = path.join(temp, 'packs');
  mkdirSync(packDir, { recursive: true });
  const packed = JSON.parse(
    run('npm', ['pack', PACKAGE, '--json', '--pack-destination', packDir]).stdout
  );
  const tarball = path.join(packDir, packed[0].filename);

  const unpacked = path.join(temp, 'unpacked');
  mkdirSync(unpacked, { recursive: true });
  run('tar', ['-xzf', tarball, '-C', unpacked]);
  const root = path.join(unpacked, 'package');

  // ---- the tarball holds only what it should ------------------------------------------------
  const shipped = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const absolute = path.join(directory, entry);
      if (statSync(absolute).isDirectory()) walk(absolute);
      else shipped.push(path.relative(root, absolute));
    }
  };
  walk(root);

  const allowed = /^(?:package\.json|LICENSE\.md|README\.md|dist\/)/;
  const strays = shipped.filter((file) => !allowed.test(file));
  check(strays.length === 0, `the tarball ships files it should not: ${strays.join(', ')}`);
  check(
    !shipped.some((file) => /\.map$/.test(file)),
    'the tarball ships source maps, which point at files that are not in it'
  );
  check(
    !shipped.some((file) => /(?:^|\/)(?:__tests__|compat|src)\//.test(file)),
    'the tarball ships sources, tests or the compat corpus'
  );
  // The licence is a term of use, not a courtesy file: a tarball without it ships code a consumer
  // has no stated right to run.
  check(
    shipped.includes('LICENSE.md'),
    'the tarball is missing LICENSE.md, so it ships unlicensed to a consumer'
  );
  for (const expected of [
    'dist/index.mjs',
    'dist/index.js',
    'dist/index.d.ts',
    'dist/browser.mjs',
    'dist/browser.js',
    'dist/browser.d.ts',
  ]) {
    check(shipped.includes(expected), `the tarball is missing ${expected}`);
  }

  // ---- the SERVER bundle is the neutral one -------------------------------------------------
  const serverBundle = readFileSync(path.join(root, 'dist/index.mjs'), 'utf8');
  const browserBundle = readFileSync(path.join(root, 'dist/browser.mjs'), 'utf8');
  for (const forbidden of [
    'harfbuzzjs',
    'prosemirror-view',
    'prosemirror-state',
    'prosemirror-model',
  ]) {
    check(
      !serverBundle.includes(forbidden),
      `dist/index.mjs carries ${forbidden}: the server entry has reached the editor lane`
    );
  }
  check(
    !/\bfrom\s*["']node:/.test(serverBundle) && !/\brequire\(\s*["']node:/.test(serverBundle),
    'dist/index.mjs imports a Node builtin, so it no longer runs in a worker'
  );
  check(
    manifest.peerDependencies?.['@docx-editor.dev/core'],
    'the package does not declare the external core engine as a peer dependency'
  );
  check(
    serverBundle.includes('@docx-editor.dev/core/automation'),
    'dist/index.mjs does not import the external automation lane'
  );
  check(
    !serverBundle.includes('@docx-editor.dev/core/editor'),
    'dist/index.mjs reaches the browser-only editor lane'
  );
  check(
    browserBundle.includes('@docx-editor.dev/core/editor'),
    'dist/browser.mjs does not reach the editor lane'
  );

  // Core is the only bare specifier, declared as a peer. Keeping it external is the one-core invariant:
  // browser adapters and automation must resolve the same engine copy. Any other bare import is an
  // undeclared bundle leak, including the font shaper deliberately externalized for resolution.
  for (const name of ['dist/index.mjs', 'dist/index.js', 'dist/browser.mjs', 'dist/browser.js']) {
    const source = readFileSync(path.join(root, name), 'utf8');
    const bare = [...new Set(bareImports(source))];
    const nonCore = bare.filter((specifier) => !specifier.startsWith('@docx-editor.dev/core'));
    check(
      nonCore.length === 0,
      `${name} imports ${nonCore.join(', ')} unexpectedly`
    );
    const coreImports = bare.filter((specifier) => specifier.startsWith('@docx-editor.dev/core'));
    const disallowedCore = coreImports.filter((specifier) => !ALLOWED_CORE.has(specifier));
    check(
      disallowedCore.length === 0,
      `${name} imports undeclared core subpaths: ${disallowedCore.join(', ')}`
    );
    const condition = name.endsWith('.mjs') ? 'import' : 'require';
    for (const specifier of coreImports) {
      const target = CORE_TARGETS.get(specifier)?.[condition];
      check(
        target,
        `${name} imports ${specifier}, which has no ${condition} export target in core`
      );
      if (!target) continue;
      check(
        existsSync(path.join(CORE_PACKAGE, target)),
        `${name} imports ${specifier}, whose ${condition} target ${target} is not built`
      );
    }
  }

  // ---- a consumer can import it, both ways -------------------------------------------------
  const scope = path.join(root, 'node_modules', '@docx-editor.dev');
  mkdirSync(scope, { recursive: true });
  check(
    existsSync(path.join(CORE_PACKAGE, 'dist', 'index.js')),
    'core is not built; run bun run --filter @docx-editor.dev/core build before pack:smoke'
  );
  if (existsSync(path.join(CORE_PACKAGE, 'dist', 'index.js'))) {
    symlinkSync(CORE_PACKAGE, path.join(scope, 'core'), 'dir');
  }
  const bytes = Buffer.from(fixtureDocx('packed')).toString('base64');
  writeFileSync(
    path.join(root, 'smoke.mjs'),
    `import { DocxEditor, DocxEditorError, isDocxEditorError, Body } from './dist/index.mjs';
if (typeof DocxEditor.createServer !== 'function') throw new Error('no createServer');
if ('createBrowser' in DocxEditor) throw new Error('the root entry offers createBrowser');
for (const named of [DocxEditorError, isDocxEditorError, Body]) {
  if (typeof named !== 'function') throw new Error('a named export is missing');
}
const runtime = await DocxEditor.createServer(new Uint8Array(Buffer.from(${JSON.stringify(bytes)}, 'base64')));
const text = await runtime.run(async (context) => {
  const body = context.document.body;
  body.load('text');
  await context.sync();
  body.insertText(' and edited', 'End');
  await context.sync();
  body.load('text');
  await context.sync();
  return body.text;
});
if (text !== 'packed and edited') throw new Error('round trip read back ' + JSON.stringify(text));
const saved = await runtime.save();
if (!(saved instanceof Uint8Array) || saved.byteLength === 0) throw new Error('save produced nothing');
runtime.dispose();
process.stdout.write('esm ok\\n');
`
  );
  const esm = run('node', ['smoke.mjs'], { cwd: root, allowFailure: true });
  check(
    esm.status === 0 && esm.stdout.includes('esm ok'),
    `a plain Node ESM import failed:\n${esm.stdout}${esm.stderr}`
  );

  // The CJS output exists so `require()` resolves rather than throwing ERR_REQUIRE_ESM. The
  // factory is async in both formats, which is the whole of the "supported CJS behavior": there is
  // no synchronous entry point to lose.
  writeFileSync(
    path.join(root, 'smoke.cjs'),
    `const entry = require('./dist/index.js');
if (typeof entry.DocxEditor.createServer !== 'function') throw new Error('no createServer');
if ('createBrowser' in entry.DocxEditor) throw new Error('the root entry offers createBrowser');
if (typeof entry.isDocxEditorError !== 'function') throw new Error('no isDocxEditorError');
entry.DocxEditor.createServer(new Uint8Array(Buffer.from(${JSON.stringify(bytes)}, 'base64')))
  .then((runtime) => runtime.run(async (context) => {
    const body = context.document.body;
    body.load('text');
    await context.sync();
    return body.text;
  }))
  .then((text) => {
    if (text !== 'packed') throw new Error('cjs round trip read back ' + JSON.stringify(text));
    process.stdout.write('cjs ok\\n');
  })
  .catch((error) => {
    process.stderr.write(String(error && error.stack) + '\\n');
    process.exit(1);
  });
`
  );
  const cjs = run('node', ['smoke.cjs'], { cwd: root, allowFailure: true });
  check(
    cjs.status === 0 && cjs.stdout.includes('cjs ok'),
    `a plain Node CJS require failed:\n${cjs.stdout}${cjs.stderr}`
  );

  // The browser entry is not imported here on purpose: it reaches the editor lane, which reads
  // DOM globals at module scope. `src/__tests__/entry-surface.test.ts` covers it under happy-dom,
  // and the bundle assertions above cover what is in it.
} finally {
  rmSync(temp, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`${manifest.name} tarball smoke failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`${manifest.name} tarball smoke passed: ESM and CJS imports drive a real document.`);
