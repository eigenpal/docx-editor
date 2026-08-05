#!/usr/bin/env node
// Roll up published package declarations after tsup/vite build.
//
// Usage:
//   node scripts/rollup-package-dts.mjs --package @docx-editor.dev/react
//   node scripts/rollup-package-dts.mjs --package @docx-editor.dev/i18n

import { readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLocaleCodes } from '../packages/i18n/locale-files.mjs';
import { packageByName } from './lib/packages.mjs';
import {
  finalizeAdapterIndex,
  finalizeReactAdapterIndex,
  finalizeVueAdapterIndex,
  rollupLocaleDts,
  rollupPackageDts,
  stripAgentsDeclarationTree,
} from './lib/rollup-package-dts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const pkgIdx = args.indexOf('--package');
const packageName = pkgIdx !== -1 ? args[pkgIdx + 1] : null;
if (!packageName) {
  console.error('Usage: node scripts/rollup-package-dts.mjs --package <name>');
  process.exit(1);
}

const pkg = packageByName(packageName);
if (!pkg) {
  console.error(`Unknown package ${packageName}`);
  process.exit(1);
}

const packageRoot = path.join(repoRoot, pkg.root);
const tsconfigPath = pkg.tsconfigPath
  ? path.join(repoRoot, pkg.tsconfigPath)
  : path.join(packageRoot, 'tsconfig.json');

if (packageName === '@docx-editor.dev/react') {
  finalizeReactAdapterIndex({ repoRoot, packageRoot });
  console.log(`[rollup-package-dts] ${packageName}: adapter contract inlined`);
  process.exit(0);
}

if (packageName === '@docx-editor.dev/vue') {
  finalizeVueAdapterIndex({ repoRoot, packageRoot });
  console.log(`[rollup-package-dts] ${packageName}: adapter contract inlined`);
  process.exit(0);
}

if (packageName === '@docx-editor.dev/agents') {
  stripAgentsDeclarationTree(path.join(packageRoot, 'dist'), repoRoot);
  console.log(`[rollup-package-dts] ${packageName}: agents headless types inlined`);
  process.exit(0);
}

if (packageName === '@docx-editor.dev/i18n') {
  rollupPackageDts({
    repoRoot,
    packageRoot,
    bundledPackages: [],
    tsconfigPath,
    mode: 'i18n',
  });
  for (const localeCode of readLocaleCodes(path.join(repoRoot, 'packages/i18n'))) {
    rollupLocaleDts({ repoRoot, packageRoot, localeCode });
  }
  console.log(`[rollup-package-dts] ${packageName}: index + locale declarations rolled up`);
  process.exit(0);
}

rollupPackageDts({
  repoRoot,
  packageRoot,
  bundledPackages: [],
  tsconfigPath,
  mode: 'plain',
});
console.log(`[rollup-package-dts] ${packageName}: declarations rolled up`);
