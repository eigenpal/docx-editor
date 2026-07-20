#!/usr/bin/env node
/**
 * Fail if React and Vue adapters drift on either:
 *   1. `package.json` `exports` subpaths (STRICT)
 *   2. Named exports from `src/index.ts` (STRICT after Vue un-stub readiness;
 *      documented framework-native divergences stay in the opt-out file)
 * Drift opt-out: backticked specifiers in
 *   openspec/changes/vue-editor-robust-implementation/notes/intentional-export-divergence.md
 *
 * Spec: openspec/changes/vue-editor-robust-implementation/specs/vue-react-parity/spec.md
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectNamedExports } from './lib/named-exports.mjs';
import { diffSets, formatDiff } from './lib/parity-report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REACT_PKG = resolve(ROOT, 'packages/react/package.json');
const VUE_PKG = resolve(ROOT, 'packages/vue/package.json');
const REACT_INDEX = resolve(ROOT, 'packages/react/src/index.ts');
const VUE_INDEX = resolve(ROOT, 'packages/vue/src/index.ts');
const OPT_OUT = resolve(
  ROOT,
  'openspec/changes/vue-editor-robust-implementation/notes/intentional-export-divergence.md'
);

const STRICT_NAMED_EXPORTS = true;

function exportSubpaths(pkgPath) {
  return new Set(Object.keys(JSON.parse(readFileSync(pkgPath, 'utf8')).exports ?? {}));
}

function loadAllowedDivergences() {
  if (!existsSync(OPT_OUT)) return new Set();
  // Match only the FIRST backtick group on a list-item line. Prose secondary
  // backticks (`renamed from \`A\` to \`B\``) won't widen the opt-out.
  const allowed = new Set();
  for (const line of readFileSync(OPT_OUT, 'utf8').split('\n')) {
    const m = line.match(/^\s*-\s+`([^`]+)`/);
    if (m) allowed.add(m[1]);
  }
  return allowed;
}

const allowed = loadAllowedDivergences();
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
    console.log(
      `✓ subpath parity: ${reactSubpaths.size} subpaths match (${allowed.size} documented divergences)`
    );
  }
}

// 2) Named-export parity (informational during hardening)
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
        informationalNote: 'Document intentional divergences in the OpenSpec notes file.',
      }) || failed;
  } else {
    console.log(`✓ named-export parity: ${reactNames.size} names match`);
  }
}

if (failed) {
  console.error(
    'Resolution: add the missing surface to the lagging adapter, or document the intentional divergence in\n' +
      '  openspec/changes/vue-editor-robust-implementation/notes/intentional-export-divergence.md'
  );
  process.exit(1);
}
