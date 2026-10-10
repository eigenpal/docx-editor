#!/usr/bin/env node
/**
 * Fail if React and Vue adapters drift on either:
 *   1. `package.json` `exports` subpaths (STRICT)
 *   2. Named exports from `src/index.ts` (STRICT; `@deprecated` symbols are excluded)
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectNamedExports } from './lib/named-exports.mjs';
import { collectDeprecatedExports } from './lib/deprecated-exports.mjs';
import { diffSets, formatDiff } from './lib/parity-report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REACT_PKG = resolve(ROOT, 'packages/react/package.json');
const VUE_PKG = resolve(ROOT, 'packages/vue/package.json');
const REACT_INDEX = resolve(ROOT, 'packages/react/src/index.ts');
const VUE_INDEX = resolve(ROOT, 'packages/vue/src/index.ts');
const REACT_SNAPSHOT = resolve(ROOT, 'docs/api/docx-editor-react/index.api.md');
const VUE_SNAPSHOT = resolve(ROOT, 'docs/api/docx-editor-vue/index.api.md');

const STRICT_NAMED_EXPORTS = true;

function exportSubpaths(pkgPath) {
  return new Set(Object.keys(JSON.parse(readFileSync(pkgPath, 'utf8')).exports ?? {}));
}

function deprecatedAllowlist() {
  const allowed = new Set();
  for (const path of [REACT_SNAPSHOT, VUE_SNAPSHOT]) {
    for (const name of collectDeprecatedExports(path)) allowed.add(name);
  }
  return allowed;
}

const allowed = deprecatedAllowlist();
let failed = false;

// 1) Subpath parity (strict)
{
  const reactSubpaths = exportSubpaths(REACT_PKG);
  const vueSubpaths = exportSubpaths(VUE_PKG);
  const { leftOnly, rightOnly } = diffSets(reactSubpaths, vueSubpaths, allowed);

  if (leftOnly.length || rightOnly.length) {
    failed =
      formatDiff({
        label: 'subpath parity (package.json `exports`)',
        leftLabel: 'React-only',
        rightLabel: 'Vue-only',
        leftOnly,
        rightOnly,
        strict: true,
      }) || failed;
  } else {
    console.log(`✓ subpath parity: ${reactSubpaths.size} subpaths match`);
  }
}

// 2) Named-export parity
{
  const reactNames = collectNamedExports(REACT_INDEX);
  const vueNames = collectNamedExports(VUE_INDEX);
  const { leftOnly, rightOnly } = diffSets(reactNames, vueNames, allowed);

  if (leftOnly.length || rightOnly.length) {
    failed =
      formatDiff({
        label: 'named-export parity (src/index.ts)',
        leftLabel: 'react-only',
        rightLabel: 'vue-only',
        leftOnly,
        rightOnly,
        strict: STRICT_NAMED_EXPORTS,
      }) || failed;
  } else {
    console.log(`✓ named-export parity: ${reactNames.size} names match`);
  }
}

if (failed) {
  console.error('Resolution: add the missing surface to the lagging adapter.');
  process.exit(1);
}
