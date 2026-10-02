// The lint gates that AGENTS.md relies on — the HTML-sink ban, global `@keyframes` names,
// varargs spreads in the engine lanes, raw compatibility-mode comparisons, and framework
// isolation — must keep firing. The
// repository has no violations, so a clean lint run cannot tell a working rule from one that
// silently stopped running. oxlint's JavaScript plugins are alpha and outside semver, so this
// test lints a fixture of every banned shape with the real `.oxlintrc.json`, at the paths its
// overrides name, and checks the exact reports.

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const root = join(import.meta.dir, '..', '..');
let workspace = '';

const SINKS = [
  "el.innerHTML = '<b>x</b>';",
  "el.outerHTML = '<b>x</b>';",
  "el.insertAdjacentHTML('beforeend', '<b>x</b>');",
  "document.write('<b>x</b>');",
  "popup.document.write('<b>x</b>');",
  'export const slide = `@keyframes slideIn { from { opacity: 0 } }`;',
  "export const fade = '@keyframes fadeOut { }';",
].join('\n');
const ALLOWED = [
  'export const ok = `@keyframes docx-fade { }`;',
  "export const ok2 = '@-webkit-keyframes hf-pulse { }';",
  'el.textContent = "x";',
].join('\n');
const SPREADS = [
  'f(...items);',
  'export const s = new Set(...items);',
  'out.push(...items);',
  'out.splice(0, 0, ...items);',
  'Math.max(...items);',
].join('\n');
// Lines 1-4 declare; lines 5-10 are banned; lines 11-14 are allowed.
const COMPAT_MODE = [
  'declare const deps: { compatibilityMode?: number };',
  'declare const compatibilityMode: number | undefined;',
  'declare const mode: number;',
  'declare const legacy: number[];',
  'export const a = compatibilityMode !== undefined && compatibilityMode >= 15;',
  'export const b = (deps.compatibilityMode ?? 0) >= 15;',
  'export const c = 14 === mode;',
  'export const d = [11, 12, 14].includes(mode);',
  'export const e = deps.compatibilityMode !== 14;',
  'switch (compatibilityMode) { default: }',
  'export const ok = compatibilityMode === undefined;',
  'export const ok2 = deps.compatibilityMode;',
  'export const ok3 = mode === undefined || legacy.length > 0;',
].join('\n');
const PRELUDE = [
  'declare const el: HTMLElement;',
  'declare const popup: Window;',
  'declare const items: number[];',
  'declare const out: number[];',
  'declare function f(...a: number[]): void;',
].join('\n');

const FILES: Record<string, string> = {
  // An engine lane: every sink, every spread except the grandfathered ones.
  'packages/core/src/store/sample.ts': `${PRELUDE}\n${SINKS}\n${ALLOWED}\n${SPREADS}\n`,
  // Tests in the engine are exempt from the sink, keyframes, and spread rules.
  'packages/core/src/store/__tests__/sample.test.ts': `${PRELUDE}\n${SINKS}\n${SPREADS}\n`,
  // Outside the engine lanes, spreads are allowed.
  'packages/core/src/editor/sample.ts': `${PRELUDE}\n${SPREADS}\n`,
  // Adapters check their tests for sinks too (parity with the ESLint configuration).
  'packages/react/src/__tests__/sample.test.ts': `${PRELUDE}\n${SINKS}\n`,
  'packages/react/src/sample.ts': [
    "import { ref } from 'vue';",
    "export const load = () => import('@docx-editor.dev/vue');",
    'export { ref };',
    "export * from 'vue/server-renderer';",
    '',
  ].join('\n'),
  'packages/vue/src/sample.ts': [
    "import { useState } from 'react';",
    "import { createRoot } from 'react-dom/client';",
    "export const load = () => import('react-dom/client');",
    'export { useState, createRoot };',
    "export { jsx } from 'react/jsx-runtime';",
    '',
  ].join('\n'),
  'packages/pro/src/vue/sample.ts': [
    "import { useState } from '@docx-editor.dev/react';",
    'export { useState };',
    "export { jsx } from 'react/jsx-runtime';",
    '',
  ].join('\n'),
  'packages/editor-api/src/sample.ts': [
    "import { ref } from 'vue';",
    "import { useState } from 'react';",
    "export const load = () => import('vue');",
    'export { ref, useState };',
    "export { renderToString } from 'vue/server-renderer';",
    "export { jsx } from 'react/jsx-runtime';",
    '',
  ].join('\n'),
  // Vue adapter tests are checked for sinks too.
  'packages/vue/src/__tests__/sample.test.ts': `${PRELUDE}\n${SINKS}\n`,
  // A single-file component: the JavaScript plugin runs on its script block.
  'packages/vue/src/Sample.vue': [
    '<template><div /></template>',
    '<script setup lang="ts">',
    "document.body.innerHTML = '<b>x</b>';",
    '</script>',
    '',
  ].join('\n'),
  // In the engine lanes only `__tests__` is exempt, so a test beside the source is checked.
  'packages/core/src/store/beside.test.ts': `${PRELUDE}\n${SINKS}\n`,
  // Only root-level `*.config.ts` files are ignored.
  'packages/core/src/editor/tailwind.config.ts': `${PRELUDE}\nel.innerHTML = '<b>x</b>';\n`,
  // Library code branches on the compatibility mode only through named rules; the
  // compatibility module and tests may compare numbers.
  'packages/core/src/layout/compat-sample.ts': `${COMPAT_MODE}\n`,
  'packages/core/src/layout/compatibility/sample.ts': `${COMPAT_MODE}\n`,
  'packages/core/src/layout/__tests__/compat-sample.test.ts': `${COMPAT_MODE}\n`,
  'packages/react/src/compat-sample.ts': `${COMPAT_MODE}\n`,
  // The global cap.
  'packages/core/src/layout/long.ts': Array.from(
    { length: 1001 },
    (_, i) => `export const x${i} = ${i};`
  )
    .join('\n')
    .concat('\n'),
};

/** The rules under test; everything else in the fixture is noise. */
const CHECKED = /^(docx\(|eslint\(no-restricted-imports\)|eslint\(max-lines\))/;

/** `file:line rule` for every finding of a checked rule, sorted. */
function reports(): string[] {
  const result = spawnSync(
    join(root, 'node_modules', '.bin', 'oxlint'),
    ['-f', 'json', '-c', join(workspace, '.oxlintrc.json'), 'packages'],
    { cwd: workspace, encoding: 'utf8' }
  );
  if (result.error) throw result.error;
  // Exit 1 is expected: the fixture has errors. Anything on stderr (a plugin that failed to
  // load, an invalid config) is the real failure, so report it rather than a diff.
  if (result.stderr.trim()) throw new Error(`oxlint failed:\n${result.stderr}`);
  const { diagnostics } = JSON.parse(result.stdout) as {
    diagnostics: { code: string; filename: string; labels: { span: { line: number } }[] }[];
  };
  // oxlint reports a restricted import again where the binding is re-exported; compare
  // unique findings.
  const found = diagnostics
    .filter((d) => CHECKED.test(d.code ?? ''))
    .map((d) => `${d.filename}:${d.labels[0]?.span.line} ${d.code}`);
  return [...new Set(found)].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

beforeAll(() => {
  // Real path: override globs match paths relative to the config, and on macOS the temporary
  // directory is a symlink that oxlint resolves, which would put every file outside them.
  workspace = realpathSync(mkdtempSync(join(tmpdir(), 'docx-oxlint-rules-')));
  // The real config, with its plugin path made absolute so it loads from the workspace.
  const parsed = ts.parseConfigFileTextToJson(
    '.oxlintrc.json',
    readFileSync(join(root, '.oxlintrc.json'), 'utf8')
  );
  if (parsed.error) {
    throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'));
  }
  const config = parsed.config as {
    jsPlugins: string[];
    $schema?: string;
  };
  config.jsPlugins = config.jsPlugins.map((path) => join(root, path));
  delete config.$schema;
  writeFileSync(join(workspace, '.oxlintrc.json'), JSON.stringify(config));
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(join(workspace, dirname(path)), { recursive: true });
    writeFileSync(join(workspace, path), text);
  }
});

afterAll(() => rmSync(workspace, { recursive: true, force: true }));

test('every banned shape is reported where the configuration applies it, and nowhere else', () => {
  const sink = 'docx(no-html-sinks)';
  const keyframes = 'docx(no-global-keyframes)';
  const spread = 'docx(no-varargs-spread)';
  const restrictedImport = 'eslint(no-restricted-imports)';
  const rawMode = 'docx(no-raw-compatibility-mode)';
  const rawModeLines = (file: string) =>
    [5, 6, 7, 8, 9, 10].map((line) => `${file}:${line} ${rawMode}`);
  const sinkLines = (file: string, first: number) => [
    `${file}:${first} ${sink}`,
    `${file}:${first + 1} ${sink}`,
    `${file}:${first + 2} ${sink}`,
    `${file}:${first + 3} ${sink}`,
    `${file}:${first + 4} ${sink}`,
    `${file}:${first + 5} ${keyframes}`,
    `${file}:${first + 6} ${keyframes}`,
  ];
  const store = 'packages/core/src/store/sample.ts';
  expect(reports()).toEqual(
    [
      'packages/core/src/layout/long.ts:1001 eslint(max-lines)',
      ...rawModeLines('packages/core/src/layout/compat-sample.ts'),
      ...rawModeLines('packages/react/src/compat-sample.ts'),
      `packages/core/src/editor/tailwind.config.ts:6 ${sink}`,
      ...sinkLines('packages/core/src/store/beside.test.ts', 6),
      ...sinkLines('packages/vue/src/__tests__/sample.test.ts', 6),
      `packages/vue/src/Sample.vue:3 ${sink}`,
      ...sinkLines(store, 6),
      `${store}:16 ${spread}`,
      `${store}:17 ${spread}`,
      'packages/editor-api/src/sample.ts:1 ' + restrictedImport,
      'packages/editor-api/src/sample.ts:2 ' + restrictedImport,
      'packages/editor-api/src/sample.ts:3 ' + restrictedImport,
      'packages/pro/src/vue/sample.ts:1 ' + restrictedImport,
      'packages/pro/src/vue/sample.ts:3 ' + restrictedImport,
      'packages/editor-api/src/sample.ts:5 ' + restrictedImport,
      'packages/editor-api/src/sample.ts:6 ' + restrictedImport,
      'packages/react/src/sample.ts:4 ' + restrictedImport,
      'packages/vue/src/sample.ts:5 ' + restrictedImport,
      ...sinkLines('packages/react/src/__tests__/sample.test.ts', 6),
      'packages/react/src/sample.ts:1 ' + restrictedImport,
      'packages/react/src/sample.ts:2 ' + restrictedImport,
      'packages/vue/src/sample.ts:1 ' + restrictedImport,
      'packages/vue/src/sample.ts:2 ' + restrictedImport,
      'packages/vue/src/sample.ts:3 ' + restrictedImport,
    ].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  );
});
